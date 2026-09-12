import type { CircuitSnapshot, DiffChange } from '@circuitgit/schema';

/**
 * Diff between two snapshots.
 *
 * Entities are keyed by UUID, so a change is a real change rather than a
 * reordering. Every change is tagged electrical or cosmetic so the UI can
 * filter to "what actually changes the circuit".
 */

/** Collections whose contents change the circuit electrically. */
const ELECTRICAL_COLLECTIONS = new Set(['components', 'wires', 'blocks', 'tests', 'settings']);

/** Fields that are presentation only, wherever they appear. */
const COSMETIC_FIELDS = new Set(['style', 'label']);

type Collection = DiffChange['collection'];

function isElectrical(collection: Collection, field?: string): boolean {
  if (!ELECTRICAL_COLLECTIONS.has(collection)) return false;
  if (field && COSMETIC_FIELDS.has(field.split('.')[0] ?? '')) return false;
  return true;
}

function flatten(value: unknown, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        for (const [k, v] of flatten(inner, path)) out.set(k, v);
      } else {
        out.set(path, inner);
      }
    }
  } else if (prefix) {
    out.set(prefix, value);
  }
  return out;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffRecord(
  collection: Collection,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  describe: (id: string, entity: unknown) => string,
): DiffChange[] {
  const changes: DiffChange[] = [];
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const id of ids) {
    const from = before[id];
    const to = after[id];

    if (from === undefined && to !== undefined) {
      changes.push({
        kind: 'added',
        collection,
        entityId: id,
        after: to,
        electrical: isElectrical(collection),
        label: `Added ${describe(id, to)}`,
      });
      continue;
    }
    if (from !== undefined && to === undefined) {
      changes.push({
        kind: 'removed',
        collection,
        entityId: id,
        before: from,
        electrical: isElectrical(collection),
        label: `Removed ${describe(id, from)}`,
      });
      continue;
    }
    if (same(from, to)) continue;

    const flatBefore = flatten(from);
    const flatAfter = flatten(to);
    for (const field of new Set([...flatBefore.keys(), ...flatAfter.keys()])) {
      const a = flatBefore.get(field);
      const b = flatAfter.get(field);
      if (same(a, b)) continue;
      changes.push({
        kind: 'changed',
        collection,
        entityId: id,
        field,
        before: a,
        after: b,
        electrical: isElectrical(collection, field),
        label: `${describe(id, to)}: ${field} ${format(a)} → ${format(b)}`,
      });
    }
  }

  return changes;
}

function format(value: unknown): string {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export type DiffOptions = {
  /** Drop cosmetic changes — the electrical-only filter in the UI. */
  electricalOnly?: boolean;
};

export function diffSnapshots(
  before: CircuitSnapshot,
  after: CircuitSnapshot,
  options: DiffOptions = {},
): DiffChange[] {
  const labelOf = (id: string, entity: unknown): string => {
    if (entity && typeof entity === 'object' && 'label' in entity) {
      return String((entity as { label: unknown }).label);
    }
    return id.slice(0, 8);
  };

  const changes: DiffChange[] = [
    ...diffRecord('components', before.components, after.components, labelOf),
    ...diffRecord('wires', before.wires, after.wires, (id) => `wire ${id.slice(0, 8)}`),
    ...diffRecord('blocks', before.blocks, after.blocks, (id) => `block ${id.slice(0, 8)}`),
    ...diffRecord('tests', before.tests, after.tests, (id) => `test ${id.slice(0, 8)}`),
    ...diffRecord(
      'annotations',
      before.annotations,
      after.annotations,
      (id) => `note ${id.slice(0, 8)}`,
    ),
    ...diffRecord(
      'settings',
      { settings: before.settings },
      { settings: after.settings },
      () => 'settings',
    ),
    ...diffRecord('meta', { meta: before.meta }, { meta: after.meta }, () => 'details'),
    ...diffRecord('layout', { layout: before.layout }, { layout: after.layout }, () => 'layout'),
  ];

  return options.electricalOnly ? changes.filter((change) => change.electrical) : changes;
}

export function isEmptyDiff(changes: readonly DiffChange[]): boolean {
  return changes.length === 0;
}

export function summarizeDiff(changes: readonly DiffChange[]): {
  electrical: number;
  cosmetic: number;
  added: number;
  removed: number;
  changed: number;
} {
  return {
    electrical: changes.filter((c) => c.electrical).length,
    cosmetic: changes.filter((c) => !c.electrical).length,
    added: changes.filter((c) => c.kind === 'added').length,
    removed: changes.filter((c) => c.kind === 'removed').length,
    changed: changes.filter((c) => c.kind === 'changed').length,
  };
}
