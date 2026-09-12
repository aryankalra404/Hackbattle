import type { CircuitSnapshot } from '@circuitgit/schema';

/**
 * Canonical form and hashing.
 *
 * Two snapshots that describe the same circuit must produce the same hash no
 * matter what order their keys arrived in, and a wire must hash the same
 * whichever end was drawn first — a wire has no direction.
 */

/** Normalise numbers so 1.0, 1 and 1.0000000000000002 do not fork the hash. */
function normalizeNumber(value: number): number | string {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
  if (value === 0) return 0; // collapse -0
  // 12 significant digits is well inside float64 precision and past any
  // component tolerance we care about.
  return Number(value.toPrecision(12));
}

function canonicalize(value: unknown): unknown {
  if (typeof value === 'number') return normalizeNumber(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, canonicalize(v)]));
  }
  return value;
}

/** Sort a wire's endpoints so direction cannot affect the hash. */
function canonicalWire(wire: { a: string; b: string; style?: unknown }): unknown {
  const [a, b] = wire.a <= wire.b ? [wire.a, wire.b] : [wire.b, wire.a];
  return canonicalize({ ...wire, a, b });
}

function canonicalSnapshot(snapshot: CircuitSnapshot, electricalOnly: boolean): unknown {
  const wires = Object.fromEntries(
    Object.entries(snapshot.wires).map(([id, wire]) => [
      id,
      electricalOnly
        ? canonicalWire({ a: wire.a, b: wire.b }) // style is cosmetic
        : canonicalWire(wire),
    ]),
  );

  const blocks = Object.fromEntries(
    Object.entries(snapshot.blocks).map(([id, block]) => [
      id,
      canonicalize({
        source: block.source,
        ports: block.ports,
        snapshot: canonicalSnapshot(block.snapshot, electricalOnly),
      }),
    ]),
  );

  const base = {
    schemaVersion: snapshot.schemaVersion,
    settings: snapshot.settings,
    components: snapshot.components,
    wires,
    blocks,
    tests: snapshot.tests,
  };

  if (electricalOnly) return canonicalize(base);

  return canonicalize({
    ...base,
    meta: snapshot.meta,
    annotations: snapshot.annotations,
    layout: snapshot.layout,
  });
}

export function canonicalJson(snapshot: CircuitSnapshot, electricalOnly = false): string {
  return JSON.stringify(canonicalSnapshot(snapshot, electricalOnly));
}

/**
 * SHA-256 as lowercase hex.
 *
 * Uses WebCrypto, which is available in browsers and in Node 20+, so the same
 * hash is produced on the Quest, in the 2D app and on the server.
 */
export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Covers everything, including layout and cosmetics. */
export function snapshotHash(snapshot: CircuitSnapshot): Promise<string> {
  return sha256(canonicalJson(snapshot, false));
}

/**
 * Covers only what changes the circuit electrically. Check results and LLM
 * calls key on this, so moving a part never re-runs the simulator or a model.
 */
export function electricalHash(snapshot: CircuitSnapshot): Promise<string> {
  return sha256(canonicalJson(snapshot, true));
}

export async function hashSnapshot(
  snapshot: CircuitSnapshot,
): Promise<{ snapshotHash: string; electricalHash: string }> {
  const [full, electrical] = await Promise.all([snapshotHash(snapshot), electricalHash(snapshot)]);
  return { snapshotHash: full, electricalHash: electrical };
}

/** Short display form, as a version-control UI shows a commit. */
export function shortHash(hash: string, length = 7): string {
  return hash.slice(0, length);
}
