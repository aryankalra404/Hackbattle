import { parsePinRef, pinRef, type CircuitSnapshot } from '@circuitgit/schema';

/**
 * Connectivity.
 *
 * A net is a set of pins tied together — by wires, or inside a part by its
 * internal groups (a breadboard row, a rail, two GND headers on one plane).
 * This is pure graph work: it knows nothing about what any part is, only which
 * pins it has and which of them it joins. The part library supplies both.
 */

export type Net = {
  id: string;
  /** `<componentId>.<pinId>` members, sorted for stable comparison. */
  pins: string[];
};

export type NetList = {
  nets: Net[];
  /** Pin ref -> net id. */
  netOfPin: Map<string, string>;
};

/** What the net builder needs to know about a part. Never its identity. */
export type PartTopology = {
  pins: readonly string[];
  /** Pin sets the part joins internally; each becomes part of one net. */
  groups: readonly (readonly string[])[];
  /**
   * Pure interconnect: no electrical element of its own. It joins pins within
   * each group and conducts nothing between groups.
   */
  interconnect: boolean;
};

/** Topology by part ref, or undefined for a part the library does not have. */
export type TopologyLookup = (partRef: string) => PartTopology | undefined;

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(node: string): void {
    if (!this.parent.has(node)) this.parent.set(node, node);
  }

  find(node: string): string {
    let root = node;
    while (this.parent.get(root) !== root) {
      const next = this.parent.get(root);
      if (next === undefined) return root;
      root = next;
    }
    // Path compression.
    let cursor = node;
    while (cursor !== root) {
      const next = this.parent.get(cursor) ?? root;
      this.parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    this.add(a);
    this.add(b);
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }

  roots(): string[] {
    return [...new Set([...this.parent.keys()].map((node) => this.find(node)))];
  }

  members(): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const node of this.parent.keys()) {
      const root = this.find(node);
      const bucket = groups.get(root);
      if (bucket) bucket.push(node);
      else groups.set(root, [node]);
    }
    return groups;
  }
}

/**
 * Compute nets. `topologyOf` supplies each component's pins and internal
 * groups from the part library, so this function never needs to know what a
 * component is.
 */
export function computeNets(snapshot: CircuitSnapshot, topologyOf: TopologyLookup): NetList {
  const uf = new UnionFind();

  for (const [componentId, component] of Object.entries(snapshot.components)) {
    const topology = topologyOf(component.part);
    if (!topology) continue;
    for (const pin of topology.pins) uf.add(pinRef(componentId, pin));
    for (const group of topology.groups) {
      const [first, ...rest] = group;
      if (first === undefined) continue;
      for (const pin of rest) uf.union(pinRef(componentId, first), pinRef(componentId, pin));
    }
  }
  for (const wire of Object.values(snapshot.wires)) uf.union(wire.a, wire.b);

  const netOfPin = new Map<string, string>();
  const nets: Net[] = [];

  // Name nets by their lowest-sorting member so the ids are stable across runs
  // and comparable between two snapshots.
  const groups = [...uf.members().values()]
    .map((pins) => pins.slice().sort())
    .sort((a, b) => ((a[0] ?? '') < (b[0] ?? '') ? -1 : 1));

  for (const pins of groups) {
    const id = pins[0] ?? '';
    nets.push({ id, pins });
    for (const pin of pins) netOfPin.set(pin, id);
  }

  return { nets, netOfPin };
}

/** Components whose part is a pure interconnect. */
export function interconnectComponents(
  snapshot: CircuitSnapshot,
  topologyOf: TopologyLookup,
): Set<string> {
  return new Set(
    Object.entries(snapshot.components)
      .filter(([, component]) => topologyOf(component.part)?.interconnect === true)
      .map(([id]) => id),
  );
}

/**
 * Pins that share a net with at least one other pin of a real (non-interconnect)
 * component. A lead pushed into an otherwise empty breadboard row is wired but
 * not connected to anything, and this is what tells the two apart.
 */
export function connectedPins(
  snapshot: CircuitSnapshot,
  netList: NetList,
  topologyOf: TopologyLookup,
): Set<string> {
  const passive = interconnectComponents(snapshot, topologyOf);
  const connected = new Set<string>();

  for (const net of netList.nets) {
    const real = net.pins.filter((pin) => !passive.has(parsePinRef(pin).componentId));
    if (real.length < 2) continue;
    for (const pin of real) connected.add(pin);
  }
  return connected;
}

/** Pins that belong to no wire at all. */
export function floatingPins(netList: NetList): string[] {
  return netList.nets.filter((net) => net.pins.length === 1).flatMap((net) => net.pins);
}

/** The net holding the configured ground pin, if any. */
export function groundNet(snapshot: CircuitSnapshot, netList: NetList): Net | undefined {
  const ground = snapshot.settings.ground;
  if (!ground) return undefined;
  const netId = netList.netOfPin.get(ground);
  return netList.nets.find((net) => net.id === netId);
}

/**
 * Components with no connection to the ground net. Interconnects are never
 * reported and never bridge: a breadboard carries current along a row, not from
 * one row to the next.
 */
export function componentsWithoutGroundPath(
  snapshot: CircuitSnapshot,
  netList: NetList,
  topologyOf: TopologyLookup,
): string[] {
  const passive = interconnectComponents(snapshot, topologyOf);
  const candidates = Object.keys(snapshot.components).filter((id) => !passive.has(id));

  const ground = groundNet(snapshot, netList);
  if (!ground) return candidates;

  const netsOfComponent = new Map<string, Set<string>>();
  const componentsOnNet = new Map<string, Set<string>>();
  for (const [pin, netId] of netList.netOfPin) {
    const { componentId } = parsePinRef(pin);
    if (passive.has(componentId)) continue;
    let nets = netsOfComponent.get(componentId);
    if (!nets) netsOfComponent.set(componentId, (nets = new Set()));
    nets.add(netId);
    let members = componentsOnNet.get(netId);
    if (!members) componentsOnNet.set(netId, (members = new Set()));
    members.add(componentId);
  }

  // Breadth-first from ground: a real component bridges all of its own pins.
  const reachedNets = new Set<string>([ground.id]);
  const reached = new Set<string>();
  const queue = [ground.id];
  while (queue.length > 0) {
    const netId = queue.shift() ?? '';
    for (const componentId of componentsOnNet.get(netId) ?? []) {
      if (reached.has(componentId)) continue;
      reached.add(componentId);
      for (const next of netsOfComponent.get(componentId) ?? []) {
        if (reachedNets.has(next)) continue;
        reachedNets.add(next);
        queue.push(next);
      }
    }
  }

  return candidates.filter((id) => !reached.has(id));
}

/** Compare two net lists — the raw material for conflicts C21 and C22. */
export function compareNets(
  before: NetList,
  after: NetList,
): { joined: string[][]; split: string[][] } {
  const joined: string[][] = [];
  const split: string[][] = [];

  for (const net of after.nets) {
    const previous = new Set(
      net.pins.map((pin) => before.netOfPin.get(pin)).filter((id): id is string => Boolean(id)),
    );
    if (previous.size > 1) joined.push([...previous]);
  }
  for (const net of before.nets) {
    const now = new Set(
      net.pins.map((pin) => after.netOfPin.get(pin)).filter((id): id is string => Boolean(id)),
    );
    if (now.size > 1) split.push([...now]);
  }

  return { joined, split };
}
