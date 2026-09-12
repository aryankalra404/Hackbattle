import {
  boardDef,
  boardHole,
  endpointFor,
  isBoardPin,
  partDef,
  partHeight,
  type PartDef,
  type PartHole,
} from '../parts/catalog.js';
import type { QuestCircuit, QuestComponentEntry, QuestWire } from './QuestBridgeContext.js';

/**
 * The shared rules for turning the bridge's circuit JSON into something the 2D
 * canvas can draw, and for turning canvas edits back into the exact JSON shape
 * `QuestCircuitBridge.BuildCircuit()` emits — so a circuit built in the browser
 * and one built on the headset are the same document to the server, the rules
 * engine, the LED simulator and the commit store.
 */

/** The node id the board is drawn under; the protocol keeps it out of `components[]`. */
export const BOARD_NODE_ID = '__board__';

/**
 * Pixels per metre of Quest desk space. Parts a few centimetres apart in AR
 * need real separation here or their nodes overlap and hide the wires between
 * them. Locally placed parts are converted back through the same constant, so
 * a browser-built circuit lands on a plausible desk-sized layout in AR.
 */
const SCALE = 1800;
const ORIGIN_X = 300;
const ORIGIN_Y = 200;

export type Vec3 = { x: number; y: number; z: number };
export type XY = { x: number; y: number };

/** World (x, z) metres -> canvas pixels. The transform is fixed, so dragging any node moves only that node. */
export function toCanvas(pos: Vec3 | undefined): XY {
  return { x: (pos?.x ?? 0) * SCALE + ORIGIN_X, y: (pos?.z ?? 0) * SCALE + ORIGIN_Y };
}

/** Canvas pixels -> world metres, the exact inverse of `toCanvas` so a drag round-trips. */
export function toWorld(point: XY, height = 0): Vec3 {
  return { x: (point.x - ORIGIN_X) / SCALE, y: height, z: (point.y - ORIGIN_Y) / SCALE };
}

/** Unity's identity rotation, which is what a part dropped on this flat canvas has. */
const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Builds one `components[]` entry in the same shape the headset sends: an id,
 * a type, one field per terminal holding that terminal's full pin id, and the
 * transform the part sits at.
 */
export function componentEntry(def: PartDef, id: string, at: XY): QuestComponentEntry {
  const entry: QuestComponentEntry = { id, type: def.type };
  for (const item of def.holes) entry[item.pin] = endpointFor(def, id, item);
  entry['pos'] = toWorld(at);
  entry['rot'] = { ...IDENTITY_ROT };
  return entry;
}

/** The next free `<type>-<n>` id, continuing whatever numbering the circuit already uses. */
export function nextComponentId(circuit: QuestCircuit | null, type: string): string {
  const prefix = `${type}-`;
  let highest = 0;
  for (const component of circuit?.components ?? []) {
    if (!component.id.startsWith(prefix)) continue;
    const suffix = Number(component.id.slice(prefix.length));
    if (Number.isInteger(suffix) && suffix > highest) highest = suffix;
  }
  return `${prefix}${highest + 1}`;
}

type Box = XY & { w: number; h: number };

/** The canvas box every part in this circuit occupies, board included. */
function occupied(circuit: QuestCircuit): Box[] {
  const boxes: Box[] = [];
  for (const component of circuit.components ?? []) {
    const def = partDef(component.type);
    const at = toCanvas(component.pos);
    boxes.push({ ...at, w: def?.width ?? 140, h: def ? partHeight(def) : 44 });
  }
  if (circuit.board) {
    boxes.push({ ...toCanvas(circuit.board.pos), w: boardDef.width, h: partHeight(boardDef) });
  }
  return boxes;
}

/**
 * Where a part added from the palette lands: `fallback` (the middle of the
 * view) while the canvas is empty, then a row underneath whatever is already
 * there. Parts are compared as whole boxes rather than corners, since an
 * Arduino is wide enough to swallow anything dropped over it.
 *
 * Placed against the circuit rather than the rendered nodes, so several parts
 * added in one go still lay out instead of landing on the same spot.
 */
export function placePart(circuit: QuestCircuit, def: PartDef, fallback: XY): XY {
  const size = { w: def.width, h: partHeight(def) };
  const boxes = occupied(circuit);
  if (boxes.length === 0) return { x: fallback.x - size.w / 2, y: fallback.y - size.h / 2 };

  const GAP = 40;
  const left = Math.min(...boxes.map((box) => box.x));
  const clear = (at: XY) =>
    !boxes.some(
      (box) =>
        at.x < box.x + box.w + GAP / 2 &&
        at.x + size.w + GAP / 2 > box.x &&
        at.y < box.y + box.h + GAP / 2 &&
        at.y + size.h + GAP / 2 > box.y,
    );

  // Fill the row under the lowest thing placed so far, then start another.
  const spot = { x: left, y: Math.max(...boxes.map((box) => box.y + box.h)) + GAP };
  for (let step = 0; step < 40 && !clear(spot); step += 1) {
    spot.x += size.w + GAP;
    if (step % 6 === 5) {
      spot.x = left;
      spot.y += size.h + GAP;
    }
  }
  return spot;
}

/** Which drawn node and which of its holes a wire endpoint lands on. */
export type Endpoint = { node: string; hole: PartHole | null; def: PartDef | null };

/**
 * Resolves a raw endpoint (`led-1-anode`, `D13`, `GND`) the way the mirror
 * always has: a component's own terminals first, then the board's holes.
 * `preferredHandle` picks between holes that share one electrical pin — the
 * board's three grounds, a tactile switch's doubled legs — so a wire stays on
 * the hole it was drawn to instead of snapping to the first match.
 */
export function resolveEndpoint(
  endpoint: string,
  components: QuestComponentEntry[],
  preferredHandle?: string | undefined,
): Endpoint {
  const owner = components.find(
    (component) => endpoint === component.id || endpoint.startsWith(`${component.id}-`),
  );
  if (owner) {
    const def = partDef(owner.type) ?? null;
    const pin = endpoint.slice(owner.id.length + 1);
    const holes = def?.holes.filter((item) => item.pin === pin) ?? [];
    const picked = holes.find((item) => item.handle === preferredHandle) ?? holes[0] ?? null;
    return { node: owner.id, hole: picked, def };
  }

  if (isBoardPin(endpoint)) {
    const holes = boardDef.holes.filter(
      (item) => item.pin.toLowerCase() === endpoint.trim().toLowerCase(),
    );
    const picked =
      holes.find((item) => item.handle === preferredHandle) ?? holes[0] ?? boardHole(endpoint) ?? null;
    return { node: BOARD_NODE_ID, hole: picked, def: boardDef };
  }

  return { node: BOARD_NODE_ID, hole: null, def: boardDef };
}

/** Same identity a wire has on the server: undirected, so A->B and B->A are one wire. */
export function sameWire(a: QuestWire, from: string, to: string): boolean {
  return (a.from === from && a.to === to) || (a.from === to && a.to === from);
}

/**
 * Whether a new wire between two holes is allowed, and why not when it isn't.
 *
 * The occupancy rule is `PinPoint.CanAcceptPlug` / `AllowsSharedConnections`
 * from the headset build: ground and supply rails are shared electrical nodes
 * that several parts land on at once, while a signal or passive terminal takes
 * one wire so the canvas can't quietly build a short that AR would refuse.
 */
export function connectionError(
  circuit: QuestCircuit | null,
  from: { endpoint: string; node: string; hole: PartHole },
  to: { endpoint: string; node: string; hole: PartHole },
): string | null {
  if (from.endpoint === to.endpoint) return 'A wire needs two different terminals.';
  if (from.node === to.node) {
    return 'Both ends land on the same part — wire it to something else.';
  }

  const wires = circuit?.wires ?? [];
  if (wires.some((wire) => sameWire(wire, from.endpoint, to.endpoint))) {
    return 'Those two terminals are already wired together.';
  }

  for (const end of [from, to]) {
    if (end.hole.kind === 'ground' || end.hole.kind === 'power') continue;
    const used = wires.filter((wire) => wire.from === end.endpoint || wire.to === end.endpoint);
    if (used.length > 0) {
      return `${end.endpoint} already has a wire — signal terminals take one each.`;
    }
  }

  return null;
}
