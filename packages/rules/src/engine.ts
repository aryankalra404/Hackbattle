import {
  isInterconnect,
  parsePinRef,
  pinRef,
  SUPPLY_FUNCTIONS,
  type CircuitComponent,
  type CircuitGitConfig,
  type CircuitSnapshot,
  type Finding,
  type PartDefinition,
  type PinDefinition,
  type PinFunction,
  type PinMode,
  type RuleKind,
} from '@circuitgit/schema';
import type { PartLibrary } from '@circuitgit/parts';
import {
  componentsWithoutGroundPath,
  computeNets,
  connectedPins,
  type NetList,
} from '@circuitgit/core';

/**
 * The rule engine.
 *
 * Check kinds are generic code. Which parts they apply to, and what limits they
 * apply, comes entirely from part definitions and config. Nothing here knows
 * what any part is.
 *
 * Topology checks need only the graph and run on every edit. Checks that need
 * measured values are simulation-backed and are reported as `pending` until a
 * simulation result is supplied.
 */

export const TOPOLOGY_KINDS: readonly RuleKind[] = [
  'unconnected_required_pin',
  'floating_pin',
  'no_ground_path',
  'hole_occupancy',
  'pin_function_mismatch',
];

export const SIMULATION_KINDS: readonly RuleKind[] = [
  'rating_exceeded',
  'polarity_reversed',
  'short_circuit',
  'power_budget',
  'user_test_failed',
];

export type RuleContext = {
  snapshot: CircuitSnapshot;
  library: PartLibrary;
  config: CircuitGitConfig;
};

export type RuleReport = {
  findings: Finding[];
  /** Kinds that could not run yet, and why. Never silently skipped. */
  deferred: { kind: RuleKind; reason: string }[];
};

/** Derived once per run and shared by every check. */
type Graph = {
  nets: NetList;
  /** Pins that share a net with another real (non-interconnect) pin. */
  connected: Set<string>;
};

type TopologyCheck = (context: RuleContext, graph: Graph) => Finding[];

function severityOf(config: CircuitGitConfig, kind: RuleKind) {
  return config.rules.kinds[kind]?.severity ?? 'warning';
}

function enabled(config: CircuitGitConfig, kind: RuleKind): boolean {
  return config.rules.kinds[kind]?.enabled ?? false;
}

/** Every component whose part the library knows, with its definition. */
function knownComponents(
  snapshot: CircuitSnapshot,
  library: PartLibrary,
): [string, CircuitComponent, PartDefinition][] {
  return Object.entries(snapshot.components).flatMap(([id, component]) =>
    library.has(component.part)
      ? [[id, component, library.get(component.part)] as [string, CircuitComponent, PartDefinition]]
      : [],
  );
}

function pinDefinition(part: PartDefinition, pinId: string): PinDefinition | undefined {
  return part.pins.find((pin) => pin.id === pinId);
}

/** The mode each pin-bound enum param currently selects, by pin. */
type ActiveMode = { param: string; value: string; mode: PinMode | undefined };

function pinModes(component: CircuitComponent, part: PartDefinition): Map<string, ActiveMode[]> {
  const byPin = new Map<string, ActiveMode[]>();
  for (const [param, definition] of Object.entries(part.params)) {
    if (definition.type !== 'enum' || !definition.pin || !definition.modes) continue;
    const raw = component.params[param];
    const value = typeof raw === 'string' ? raw : definition.default;
    const entry = { param, value, mode: definition.modes[value] };
    const list = byPin.get(definition.pin);
    if (list) list.push(entry);
    else byPin.set(definition.pin, [entry]);
  }
  return byPin;
}

/** A pin whose only job is to be a power or return path. */
function isSupplyOnly(pin: PinDefinition): boolean {
  return pin.functions.every((fn) => SUPPLY_FUNCTIONS.includes(fn));
}

/** The single power/ground function a pin is marked with, if it has exactly that. */
function soleSupplyFunction(pin: PinDefinition): PinFunction | undefined {
  const [only, ...rest] = pin.functions;
  return rest.length === 0 && only && SUPPLY_FUNCTIONS.includes(only) ? only : undefined;
}

const unconnectedRequiredPin: TopologyCheck = ({ snapshot, library, config }, { connected }) => {
  const kind: RuleKind = 'unconnected_required_pin';
  const findings: Finding[] = [];

  for (const [componentId, component, part] of knownComponents(snapshot, library)) {
    const missing = part.requiredPins.filter((pin) => !connected.has(pinRef(componentId, pin)));
    if (missing.length === 0) continue;

    const names = missing.map((pin) => pinDefinition(part, pin)?.name ?? pin);
    findings.push({
      kind,
      severity: severityOf(config, kind),
      componentIds: [componentId],
      pinIds: missing.map((pin) => pinRef(componentId, pin)),
      message: `${component.label} needs ${names.join(' and ')} connected.`,
    });
  }

  return findings;
};

const floatingPin: TopologyCheck = ({ snapshot, library, config }, { connected }) => {
  const kind: RuleKind = 'floating_pin';
  const findings: Finding[] = [];

  for (const [componentId, component, part] of knownComponents(snapshot, library)) {
    if (isInterconnect(part)) continue;
    const modes = pinModes(component, part);

    // Required pins are covered by their own check. Optional pins are allowed to
    // sit unused — unless the user has given one a job, which it cannot do unwired.
    const required = new Set(part.requiredPins);
    const loose = part.pins
      .filter((pin) => !required.has(pin.id))
      .filter((pin) => !pin.optional || (modes.get(pin.id) ?? []).some((m) => m.mode))
      .filter((pin) => !connected.has(pinRef(componentId, pin.id)));

    if (loose.length === 0) continue;
    findings.push({
      kind,
      severity: severityOf(config, kind),
      componentIds: [componentId],
      pinIds: loose.map((pin) => pinRef(componentId, pin.id)),
      message: `${component.label} has ${loose.map((pin) => pin.name).join(', ')} unconnected.`,
    });
  }

  return findings;
};

const noGroundPath: TopologyCheck = ({ snapshot, library, config }, { nets }) => {
  const kind: RuleKind = 'no_ground_path';

  if (!snapshot.settings.ground) {
    if (Object.keys(snapshot.components).length === 0) return [];
    return [
      {
        kind,
        severity: severityOf(config, kind),
        componentIds: [],
        pinIds: [],
        message: 'No ground reference is set. Pick a pin to act as 0 V.',
      },
    ];
  }

  const stranded = componentsWithoutGroundPath(snapshot, nets, library.topologyOf);
  return stranded.map((componentId) => ({
    kind,
    severity: severityOf(config, kind),
    componentIds: [componentId],
    pinIds: [],
    message: `${snapshot.components[componentId]?.label ?? componentId} has no path to ground.`,
  }));
};

const holeOccupancy: TopologyCheck = ({ snapshot, library, config }) => {
  const kind: RuleKind = 'hole_occupancy';
  const findings: Finding[] = [];

  // Parts placed by footprint position.
  const occupants = new Map<string, string[]>();
  for (const [componentId, hole] of Object.entries(snapshot.layout.breadboard)) {
    const key = hole.join(',');
    const bucket = occupants.get(key);
    if (bucket) bucket.push(componentId);
    else occupants.set(key, [componentId]);
  }
  for (const [hole, ids] of occupants) {
    if (ids.length < 2) continue;
    findings.push({
      kind,
      severity: severityOf(config, kind),
      componentIds: ids,
      pinIds: [],
      message: `${ids
        .map((id) => snapshot.components[id]?.label ?? id)
        .join(' and ')} both occupy hole ${hole}.`,
    });
  }

  // Leads wired into a pin that takes only so many (a hole takes one).
  const endsAt = new Map<string, string[]>();
  for (const wire of Object.values(snapshot.wires)) {
    for (const [here, there] of [
      [wire.a, wire.b],
      [wire.b, wire.a],
    ] as const) {
      const list = endsAt.get(here);
      if (list) list.push(there);
      else endsAt.set(here, [there]);
    }
  }
  for (const [ref, others] of endsAt) {
    const { componentId, pinId } = parsePinRef(ref);
    const component = snapshot.components[componentId];
    if (!component || !library.has(component.part)) continue;
    const pin = pinDefinition(library.get(component.part), pinId);
    if (!pin?.maxConnections || others.length <= pin.maxConnections) continue;

    const leadOwners = [...new Set(others.map((other) => parsePinRef(other).componentId))];
    const names = leadOwners.map((id) => snapshot.components[id]?.label ?? id);
    findings.push({
      kind,
      severity: severityOf(config, kind),
      componentIds: [componentId, ...leadOwners],
      pinIds: [ref, ...others],
      message: `${component.label} ${pin.name} takes ${pin.maxConnections} lead${
        pin.maxConnections === 1 ? '' : 's'
      } but has ${others.length} (${names.join(', ')}).`,
    });
  }

  return findings;
};

const pinFunctionMismatch: TopologyCheck = ({ snapshot, library, config }, { nets }) => {
  const kind: RuleKind = 'pin_function_mismatch';
  const severity = severityOf(config, kind);
  const findings: Finding[] = [];

  type PinInfo = {
    ref: string;
    componentId: string;
    label: string;
    pin: PinDefinition;
    interconnect: boolean;
    /** The mode that makes this pin drive its net, if one is selected. */
    driving: ActiveMode | undefined;
  };
  const info = new Map<string, PinInfo>();

  for (const [componentId, component, part] of knownComponents(snapshot, library)) {
    const modes = pinModes(component, part);

    for (const pin of part.pins) {
      const ref = pinRef(componentId, pin.id);
      const active = modes.get(pin.id) ?? [];

      // 1. A configured mode the pin cannot do.
      for (const { value, mode } of active) {
        if (!mode?.requires || pin.functions.includes(mode.requires)) continue;
        findings.push({
          kind,
          severity,
          componentIds: [componentId],
          pinIds: [ref],
          message:
            `${component.label} ${pin.name} is set to ${value}, but this pin cannot do ` +
            `${mode.requires} (it supports ${pin.functions.join(', ')}).`,
        });
      }

      info.set(ref, {
        ref,
        componentId,
        label: component.label,
        pin,
        interconnect: isInterconnect(part),
        driving: active.find((entry) => entry.mode?.drives === true),
      });
    }
  }

  const describe = (pin: PinInfo) => `${pin.label} ${pin.pin.name}`;

  for (const net of nets.nets) {
    const members = net.pins.flatMap((ref) => info.get(ref) ?? []);
    const real = members.filter((pin) => !pin.interconnect);
    const drivers = real.filter((pin) => pin.driving);

    // 2. An output wired straight into a power or return pin.
    const supplies = real.filter((pin) => isSupplyOnly(pin.pin));
    for (const driver of drivers) {
      const into = supplies[0];
      if (!into) break;
      findings.push({
        kind,
        severity,
        componentIds: [...new Set([driver.componentId, into.componentId])],
        pinIds: [driver.ref, into.ref],
        message:
          `${describe(driver)} is an output (${driver.driving?.value}) wired straight into ` +
          `${describe(into)}, a ${into.pin.functions.join('/')} pin.`,
      });
    }

    // 3. Two outputs fighting over one net.
    if (drivers.length > 1) {
      findings.push({
        kind,
        severity,
        componentIds: [...new Set(drivers.map((pin) => pin.componentId))],
        pinIds: drivers.map((pin) => pin.ref),
        message: `${drivers.map(describe).join(' and ')} are all outputs driving the same net.`,
      });
    }

    // 4. Convention: an interconnect strip marked for power or ground carrying
    //    the opposite return path, or an output. Works, but reads wrong.
    const markings = new Set(
      members.filter((pin) => pin.interconnect).flatMap((pin) => soleSupplyFunction(pin.pin) ?? []),
    );
    if (markings.size !== 1) continue;
    const [marking] = [...markings];
    const strip = members.find((pin) => pin.interconnect && soleSupplyFunction(pin.pin));
    if (!marking || !strip) continue;

    for (const pin of real) {
      const own = soleSupplyFunction(pin.pin);
      // An output already reported as wired into a power pin needs no second note.
      const reported = pin.driving !== undefined && supplies.length > 0;
      const clash =
        !reported && ((own !== undefined && own !== marking) || pin.driving !== undefined);
      if (!clash) continue;
      findings.push({
        kind,
        severity: config.rules.conventionSeverity,
        componentIds: [...new Set([pin.componentId, strip.componentId])],
        pinIds: [pin.ref],
        message:
          `${describe(pin)} (${own ?? `${pin.driving?.value} output`}) is in ` +
          `${strip.label}'s ${strip.pin.name.replace(/\s*\d+$/, '')}, which is marked ${marking}.`,
      });
    }
  }

  return findings;
};

const TOPOLOGY_CHECKS: Record<string, TopologyCheck> = {
  unconnected_required_pin: unconnectedRequiredPin,
  floating_pin: floatingPin,
  no_ground_path: noGroundPath,
  hole_occupancy: holeOccupancy,
  pin_function_mismatch: pinFunctionMismatch,
};

/**
 * Run the topology checks. These need no simulation, so the editor can run them
 * on every edit.
 */
export function runTopologyChecks(context: RuleContext): RuleReport {
  const { snapshot, library, config } = context;
  const nets = computeNets(snapshot, library.topologyOf);
  const graph: Graph = { nets, connected: connectedPins(snapshot, nets, library.topologyOf) };

  const findings: Finding[] = [];
  for (const kind of TOPOLOGY_KINDS) {
    if (!enabled(config, kind)) continue;
    findings.push(...(TOPOLOGY_CHECKS[kind]?.(context, graph) ?? []));
  }

  // Anything referencing a part the library does not have is reported rather
  // than skipped, so a bad import cannot pass silently.
  for (const [componentId, component] of Object.entries(snapshot.components)) {
    if (library.has(component.part)) continue;
    findings.push({
      kind: 'unconnected_required_pin',
      severity: 'error',
      componentIds: [componentId],
      pinIds: [],
      message: `${component.label} uses unknown part "${component.part}".`,
    });
  }

  const deferred = SIMULATION_KINDS.filter((kind) => enabled(config, kind)).map((kind) => ({
    kind,
    reason: 'Needs a simulation result.',
  }));

  return { findings: sortFindings(findings), deferred };
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.kind.localeCompare(b.kind),
  );
}

/** Which component ids any finding points at — used to highlight the canvas. */
export function faultyComponentIds(findings: readonly Finding[]): Set<string> {
  return new Set(findings.flatMap((finding) => finding.componentIds));
}

/** Pin refs a finding points at, for per-pin highlighting. */
export function faultyPinRefs(findings: readonly Finding[]): Set<string> {
  return new Set(findings.flatMap((finding) => finding.pinIds));
}

export { parsePinRef };
