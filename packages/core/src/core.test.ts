import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { emptySnapshot, pinRef, type CircuitSnapshot } from '@circuitgit/schema';
import { loadPartLibraryFromDisk } from '@circuitgit/parts/node';
import { canonicalJson, electricalHash, shortHash, snapshotHash } from './canonical.js';
import { computeNets, compareNets, floatingPins } from './nets.js';
import { diffSnapshots, isEmptyDiff, summarizeDiff } from './diff.js';
import { HeadMovedError, Repository, RepositoryError } from './repository.js';

const library = loadPartLibraryFromDisk();
const pinsOf = (ref: string) => library.get(ref).pins.map((pin) => pin.id);

/** A supply, a resistor and an LED in series. Built from library data. */
function seriesCircuit(): { snapshot: CircuitSnapshot; ids: Record<string, string> } {
  const supply = randomUUID();
  const resistor = randomUUID();
  const led = randomUUID();
  const w1 = randomUUID();
  const w2 = randomUUID();
  const w3 = randomUUID();

  const snapshot = emptySnapshot('Series test');
  snapshot.components[supply] = { part: 'dc-supply@1', label: 'V1', params: { voltage: 5 } };
  snapshot.components[resistor] = { part: 'resistor@1', label: 'R1', params: { resistance: 330 } };
  snapshot.components[led] = { part: 'led-5mm@1', label: 'D1', params: { color: 'red' } };
  snapshot.wires[w1] = { a: pinRef(supply, 'pos'), b: pinRef(resistor, 'a'), style: {} };
  snapshot.wires[w2] = { a: pinRef(resistor, 'b'), b: pinRef(led, 'anode'), style: {} };
  snapshot.wires[w3] = { a: pinRef(led, 'cathode'), b: pinRef(supply, 'neg'), style: {} };
  snapshot.settings.ground = pinRef(supply, 'neg');
  snapshot.layout['2d'][supply] = { x: 0, y: 0 };
  snapshot.layout['2d'][resistor] = { x: 200, y: 0 };
  snapshot.layout['2d'][led] = { x: 400, y: 0 };

  return { snapshot, ids: { supply, resistor, led, w1, w2, w3 } };
}

describe('canonical hashing', () => {
  it('is stable under key reordering', async () => {
    const { snapshot } = seriesCircuit();
    const reordered: CircuitSnapshot = {
      ...snapshot,
      // Rebuild the component map in reverse insertion order.
      components: Object.fromEntries(Object.entries(snapshot.components).reverse()),
    };
    expect(await snapshotHash(reordered)).toBe(await snapshotHash(snapshot));
  });

  it('treats a wire as undirected', async () => {
    const { snapshot, ids } = seriesCircuit();
    const flipped = structuredClone(snapshot);
    const wire = flipped.wires[ids['w1'] ?? ''];
    if (!wire) throw new Error('fixture wire missing');
    [wire.a, wire.b] = [wire.b, wire.a];
    expect(await snapshotHash(flipped)).toBe(await snapshotHash(snapshot));
  });

  it('normalises float noise', async () => {
    const { snapshot, ids } = seriesCircuit();
    const nudged = structuredClone(snapshot);
    const resistor = nudged.components[ids['resistor'] ?? ''];
    if (!resistor) throw new Error('fixture component missing');
    // Noise beyond the 12 significant digits the canonical form keeps.
    resistor.params['resistance'] = 330 + 1e-10;
    expect(await snapshotHash(nudged)).toBe(await snapshotHash(snapshot));
  });

  it('ignores layout in the electrical hash but not the full hash', async () => {
    const { snapshot, ids } = seriesCircuit();
    const moved = structuredClone(snapshot);
    moved.layout['2d'][ids['led'] ?? ''] = { x: 999, y: 999 };

    expect(await electricalHash(moved)).toBe(await electricalHash(snapshot));
    expect(await snapshotHash(moved)).not.toBe(await snapshotHash(snapshot));
  });

  it('ignores wire colour and notes in the electrical hash', async () => {
    const { snapshot, ids } = seriesCircuit();
    const restyled = structuredClone(snapshot);
    const wire = restyled.wires[ids['w1'] ?? ''];
    if (!wire) throw new Error('fixture wire missing');
    wire.style = { color: '#ff0000' };
    restyled.meta.description = 'some notes';

    expect(await electricalHash(restyled)).toBe(await electricalHash(snapshot));
    expect(await snapshotHash(restyled)).not.toBe(await snapshotHash(snapshot));
  });

  it('changes the electrical hash when a value changes', async () => {
    const { snapshot, ids } = seriesCircuit();
    const changed = structuredClone(snapshot);
    const resistor = changed.components[ids['resistor'] ?? ''];
    if (!resistor) throw new Error('fixture component missing');
    resistor.params['resistance'] = 150;
    expect(await electricalHash(changed)).not.toBe(await electricalHash(snapshot));
  });

  it('produces deterministic canonical JSON', () => {
    const { snapshot } = seriesCircuit();
    expect(canonicalJson(snapshot)).toBe(canonicalJson(structuredClone(snapshot)));
  });

  it('shortens hashes for display', () => {
    expect(shortHash('abcdef0123456789')).toBe('abcdef0');
  });
});

describe('nets', () => {
  it('joins pins that share a wire', () => {
    const { snapshot, ids } = seriesCircuit();
    const nets = computeNets(snapshot, pinsOf);

    // 3 series connections around a loop of 3 two-pin parts -> 3 nets.
    expect(nets.nets).toHaveLength(3);
    expect(nets.netOfPin.get(pinRef(ids['supply'] ?? '', 'pos'))).toBe(
      nets.netOfPin.get(pinRef(ids['resistor'] ?? '', 'a')),
    );
  });

  it('reports a pin with no wire as floating', () => {
    const { snapshot } = seriesCircuit();
    const loose = randomUUID();
    snapshot.components[loose] = { part: 'resistor@1', label: 'R2', params: { resistance: 1000 } };

    const floating = floatingPins(computeNets(snapshot, pinsOf));
    expect(floating).toContain(pinRef(loose, 'a'));
    expect(floating).toContain(pinRef(loose, 'b'));
  });

  it('detects two nets being joined', () => {
    const { snapshot, ids } = seriesCircuit();
    const before = computeNets(snapshot, pinsOf);

    const shorted = structuredClone(snapshot);
    shorted.wires[randomUUID()] = {
      a: pinRef(ids['supply'] ?? '', 'pos'),
      b: pinRef(ids['led'] ?? '', 'anode'),
      style: {},
    };
    const after = computeNets(shorted, pinsOf);

    expect(compareNets(before, after).joined.length).toBeGreaterThan(0);
  });

  it('detects a net being split', () => {
    const { snapshot, ids } = seriesCircuit();
    const before = computeNets(snapshot, pinsOf);

    const cut = structuredClone(snapshot);
    delete cut.wires[ids['w2'] ?? ''];
    const after = computeNets(cut, pinsOf);

    expect(compareNets(before, after).split.length).toBeGreaterThan(0);
  });
});

describe('diff', () => {
  it('is empty for identical snapshots', () => {
    const { snapshot } = seriesCircuit();
    expect(isEmptyDiff(diffSnapshots(snapshot, structuredClone(snapshot)))).toBe(true);
  });

  it('marks a moved part as cosmetic and a value change as electrical', () => {
    const { snapshot, ids } = seriesCircuit();

    const moved = structuredClone(snapshot);
    moved.layout['2d'][ids['led'] ?? ''] = { x: 999, y: 42 };
    expect(diffSnapshots(snapshot, moved, { electricalOnly: true })).toEqual([]);
    expect(diffSnapshots(snapshot, moved).length).toBeGreaterThan(0);

    const revalued = structuredClone(snapshot);
    const resistor = revalued.components[ids['resistor'] ?? ''];
    if (!resistor) throw new Error('fixture component missing');
    resistor.params['resistance'] = 150;
    const electrical = diffSnapshots(snapshot, revalued, { electricalOnly: true });
    expect(electrical).toHaveLength(1);
    expect(electrical[0]?.field).toBe('params.resistance');
  });

  it('reports additions and removals', () => {
    const { snapshot, ids } = seriesCircuit();
    const edited = structuredClone(snapshot);
    delete edited.wires[ids['w3'] ?? ''];
    edited.components[randomUUID()] = {
      part: 'resistor@1',
      label: 'R2',
      params: { resistance: 1000 },
    };

    const summary = summarizeDiff(diffSnapshots(snapshot, edited));
    expect(summary.added).toBe(1);
    expect(summary.removed).toBe(1);
  });
});

describe('repository', () => {
  it('commits, logs and reads back the snapshot', async () => {
    const repo = new Repository('demo', ['main']);
    const { snapshot } = seriesCircuit();

    const first = await repo.commit('main', {
      snapshot,
      message: 'v1 working',
      author: 'tester',
      source: 'web',
    });

    expect(first.parents).toEqual([]);
    expect(repo.getBranch('main').head).toBe(first.id);
    expect(repo.getBranch('main').protected).toBe(true);
    expect(repo.log('main')).toHaveLength(1);
    expect(repo.snapshotOf(first.id).components).toEqual(snapshot.components);
  });

  it('stores a snapshot once per hash', async () => {
    const repo = new Repository('demo');
    const { snapshot } = seriesCircuit();

    const a = await repo.putSnapshot(snapshot);
    const b = await repo.putSnapshot(structuredClone(snapshot));
    expect(a.snapshotHash).toBe(b.snapshotHash);
  });

  it('refuses a snapshot with a dangling wire', async () => {
    const repo = new Repository('demo');
    const { snapshot, ids } = seriesCircuit();
    delete snapshot.components[ids['led'] ?? ''];

    await expect(repo.putSnapshot(snapshot)).rejects.toThrow(RepositoryError);
  });

  it('rejects a stale compare-and-swap (C32)', async () => {
    const repo = new Repository('demo');
    const { snapshot } = seriesCircuit();

    const first = await repo.commit('main', {
      snapshot,
      message: 'first',
      author: 'a',
      source: 'web',
    });

    const edited = structuredClone(snapshot);
    edited.meta.description = 'device A';
    await repo.commit('main', {
      snapshot: edited,
      message: 'second',
      author: 'a',
      source: 'web',
      expectedHead: first.id,
    });

    // A second device still believes the head is `first`.
    const stale = structuredClone(snapshot);
    stale.meta.description = 'device B';
    await expect(
      repo.commit('main', {
        snapshot: stale,
        message: 'third',
        author: 'b',
        source: 'quest',
        expectedHead: first.id,
      }),
    ).rejects.toThrow(HeadMovedError);
  });

  it('creates, renames and deletes branches, and protects main', async () => {
    const repo = new Repository('demo', ['main']);
    const { snapshot } = seriesCircuit();
    const first = await repo.commit('main', {
      snapshot,
      message: 'first',
      author: 'a',
      source: 'web',
    });

    repo.createBranch('feature/brighter', first.id);
    expect(repo.listBranches().map((b) => b.name)).toEqual(['feature/brighter', 'main']);

    repo.renameBranch('feature/brighter', 'feature/bright');
    expect(repo.hasBranch('feature/bright')).toBe(true);

    repo.deleteBranch('feature/bright');
    expect(repo.hasBranch('feature/bright')).toBe(false);

    expect(() => repo.deleteBranch('main')).toThrow(/protected/);
  });

  it('finds the merge base of two branches', async () => {
    const repo = new Repository('demo', ['main']);
    const { snapshot } = seriesCircuit();

    const base = await repo.commit('main', {
      snapshot,
      message: 'base',
      author: 'a',
      source: 'web',
    });
    repo.createBranch('feature', base.id);

    const ours = structuredClone(snapshot);
    ours.meta.description = 'ours';
    await repo.commit('main', {
      snapshot: ours,
      message: 'ours',
      author: 'a',
      source: 'web',
      expectedHead: base.id,
    });

    const theirs = structuredClone(snapshot);
    theirs.meta.description = 'theirs';
    await repo.commit('feature', {
      snapshot: theirs,
      message: 'theirs',
      author: 'b',
      source: 'quest',
      expectedHead: base.id,
    });

    expect(repo.mergeBases(repo.getBranch('main').head, repo.getBranch('feature').head)).toEqual([
      base.id,
    ]);
  });

  it('restores a commit, and the diff to the target is empty', async () => {
    const repo = new Repository('demo', ['main']);
    const { snapshot, ids } = seriesCircuit();

    const good = await repo.commit('main', {
      snapshot,
      message: 'v1 working',
      author: 'a',
      source: 'web',
    });

    const broken = structuredClone(snapshot);
    const led = broken.components[ids['led'] ?? ''];
    if (!led) throw new Error('fixture component missing');
    led.params['color'] = 'blue';
    const bad = await repo.commit('main', {
      snapshot: broken,
      message: 'break it',
      author: 'a',
      source: 'web',
      expectedHead: good.id,
    });

    const restored = await repo.restore('main', good.id, 'a');
    expect(repo.diff(good.id, restored.id)).toEqual([]);
    expect(repo.getCommit(restored.id).parents).toEqual([bad.id]);
  });
});
