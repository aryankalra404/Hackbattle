import { parsePinRef, pinRef, type CircuitSnapshot } from '@circuitgit/schema';

/**
 * Connectivity.
 *
 * A net is a set of pins tied together by wires. This is pure graph work: it
 * knows nothing about what any part is, only which pins exist and which wires
 * join them. The part library supplies the pin list.
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
 * Compute nets. `pinsOf` supplies each component's pin ids from the part
 * library, so this function never needs to know what a component is.
 */
export function computeNets(
  snapshot: CircuitSnapshot,
  pinsOf: (partRef: string) => readonly string[],
): NetList {
  const uf = new UnionFind();

  for (const [componentId, component] of Object.entries(snapshot.components)) {
    for (const pin of pinsOf(component.part)) uf.add(pinRef(componentId, pin));
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

/** Components with no connection to the ground net. */
export function componentsWithoutGroundPath(snapshot: CircuitSnapshot, netList: NetList): string[] {
  const ground = groundNet(snapshot, netList);
  if (!ground) return Object.keys(snapshot.components);

  // Walk from ground through components: a component bridges its own pins.
  const reachableNets = new Set<string>([ground.id]);
  const reachedComponents = new Set<string>();
  let grew = true;

  while (grew) {
    grew = false;
    for (const [pin, netId] of netList.netOfPin) {
      if (!reachableNets.has(netId)) continue;
      const { componentId } = parsePinRef(pin);
      if (reachedComponents.has(componentId)) continue;
      reachedComponents.add(componentId);
      grew = true;
      for (const [otherPin, otherNet] of netList.netOfPin) {
        if (parsePinRef(otherPin).componentId === componentId) reachableNets.add(otherNet);
      }
    }
  }

  return Object.keys(snapshot.components).filter((id) => !reachedComponents.has(id));
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
