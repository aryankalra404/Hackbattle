import {
  parsePinRef,
  pinRef,
  type CircuitGitConfig,
  type CircuitSnapshot,
  type Finding,
  type RuleKind,
} from '@circuitgit/schema';
import type { PartLibrary } from '@circuitgit/parts';
import { componentsWithoutGroundPath, computeNets, type NetList } from '@circuitgit/core';

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

type TopologyCheck = (context: RuleContext, nets: NetList) => Finding[];

function severityOf(config: CircuitGitConfig, kind: RuleKind) {
  return config.rules.kinds[kind]?.severity ?? 'warning';
}

function enabled(config: CircuitGitConfig, kind: RuleKind): boolean {
  return config.rules.kinds[kind]?.enabled ?? false;
}

/** Pins that are named in at least one wire. */
function wiredPins(snapshot: CircuitSnapshot): Set<string> {
  const wired = new Set<string>();
  for (const wire of Object.values(snapshot.wires)) {
    wired.add(wire.a);
    wired.add(wire.b);
  }
  return wired;
}

const unconnectedRequiredPin: TopologyCheck = ({ snapshot, library, config }) => {
  const kind: RuleKind = 'unconnected_required_pin';
  const wired = wiredPins(snapshot);
  const findings: Finding[] = [];

  for (const [componentId, component] of Object.entries(snapshot.components)) {
    if (!library.has(component.part)) continue;
    const part = library.get(component.part);

    const missing = part.requiredPins.filter((pin) => !wired.has(pinRef(componentId, pin)));
    if (missing.length === 0) continue;

    const names = missing.map(
      (pin) => part.pins.find((candidate) => candidate.id === pin)?.name ?? pin,
    );
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

const floatingPin: TopologyCheck = ({ snapshot, library, config }) => {
  const kind: RuleKind = 'floating_pin';
  const wired = wiredPins(snapshot);
  const findings: Finding[] = [];

  for (const [componentId, component] of Object.entries(snapshot.components)) {
    if (!library.has(component.part)) continue;
    const part = library.get(component.part);

    // Required pins are covered by their own check; this catches the rest.
    const required = new Set(part.requiredPins);
    const loose = part.pins
      .filter((pin) => !required.has(pin.id))
      .filter((pin) => !wired.has(pinRef(componentId, pin.id)));

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

const noGroundPath: TopologyCheck = ({ snapshot, config }, nets) => {
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

  const stranded = componentsWithoutGroundPath(snapshot, nets);
  return stranded.map((componentId) => ({
    kind,
    severity: severityOf(config, kind),
    componentIds: [componentId],
    pinIds: [],
    message: `${snapshot.components[componentId]?.label ?? componentId} has no path to ground.`,
  }));
};

const holeOccupancy: TopologyCheck = ({ snapshot, config }) => {
  const kind: RuleKind = 'hole_occupancy';
  const occupants = new Map<string, string[]>();

  for (const [componentId, hole] of Object.entries(snapshot.layout.breadboard)) {
    const key = hole.join(',');
    const bucket = occupants.get(key);
    if (bucket) bucket.push(componentId);
    else occupants.set(key, [componentId]);
  }

  return [...occupants.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([hole, ids]) => ({
      kind,
      severity: severityOf(config, kind),
      componentIds: ids,
      pinIds: [],
      message: `${ids
        .map((id) => snapshot.components[id]?.label ?? id)
        .join(' and ')} both occupy breadboard hole ${hole}.`,
    }));
};

const TOPOLOGY_CHECKS: Record<string, TopologyCheck> = {
  unconnected_required_pin: unconnectedRequiredPin,
  floating_pin: floatingPin,
  no_ground_path: noGroundPath,
  hole_occupancy: holeOccupancy,
};

/**
 * Run the topology checks. These need no simulation, so the editor can run them
 * on every edit.
 */
export function runTopologyChecks(context: RuleContext): RuleReport {
  const { snapshot, library, config } = context;
  const pinsOf = (ref: string) =>
    library.has(ref) ? library.get(ref).pins.map((pin) => pin.id) : [];
  const nets = computeNets(snapshot, pinsOf);

  const findings: Finding[] = [];
  for (const kind of TOPOLOGY_KINDS) {
    if (!enabled(config, kind)) continue;
    findings.push(...(TOPOLOGY_CHECKS[kind]?.(context, nets) ?? []));
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
