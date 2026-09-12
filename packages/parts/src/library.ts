import {
  isInterconnect,
  partDefinitionSchema,
  partRef,
  parsePartRef,
  type CircuitGitConfig,
  type NumberOrConfigRef,
  type PartDefinition,
} from '@circuitgit/schema';

/**
 * The part library.
 *
 * Definitions are data files. This loader validates them and answers the
 * questions engines ask — "what pins does this have", "what is it rated for",
 * "which state is it in" — without any engine ever naming a part.
 */

/** Structurally the `PartTopology` the core net builder takes. */
export type PartTopology = { pins: string[]; groups: string[][]; interconnect: boolean };

export class PartLibraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PartLibraryError';
  }
}

export class PartLibrary {
  /** Keyed by `<id>@<version>`. */
  private readonly byRef = new Map<string, PartDefinition>();
  /** Latest version per id. */
  private readonly latest = new Map<string, PartDefinition>();
  /** Definitions are immutable, so each topology is built once. */
  private readonly topologies = new Map<string, PartTopology>();

  constructor(definitions: readonly PartDefinition[]) {
    for (const part of definitions) {
      const ref = partRef(part);
      if (this.byRef.has(ref)) {
        throw new PartLibraryError(`Duplicate part definition "${ref}"`);
      }
      this.byRef.set(ref, part);
      const current = this.latest.get(part.id);
      if (!current || current.version < part.version) this.latest.set(part.id, part);
    }
  }

  /** Parse and validate raw definitions. Reports the file that failed. */
  static fromRaw(entries: readonly { source: string; data: unknown }[]): PartLibrary {
    const definitions: PartDefinition[] = [];
    const problems: string[] = [];

    for (const entry of entries) {
      const result = partDefinitionSchema.safeParse(entry.data);
      if (result.success) {
        definitions.push(result.data);
      } else {
        for (const issue of result.error.errors) {
          const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
          problems.push(`${entry.source} -> ${path}: ${issue.message}`);
        }
      }
    }

    if (problems.length > 0) {
      throw new PartLibraryError(`Invalid part definitions:\n  - ${problems.join('\n  - ')}`);
    }
    return new PartLibrary(definitions);
  }

  all(): PartDefinition[] {
    return [...this.latest.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Palette grouping, derived from the `category` field rather than a fixed list. */
  categories(): { category: string; parts: PartDefinition[] }[] {
    const groups = new Map<string, PartDefinition[]>();
    for (const part of this.all()) {
      const bucket = groups.get(part.category);
      if (bucket) bucket.push(part);
      else groups.set(part.category, [part]);
    }
    return [...groups.entries()]
      .map(([category, parts]) => ({ category, parts }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }

  /** Look up by `<id>@<version>`, or by bare id for the latest version. */
  get(ref: string): PartDefinition {
    const found = ref.includes('@') ? this.byRef.get(ref) : this.latest.get(ref);
    if (!found) throw new PartLibraryError(`Unknown part "${ref}"`);
    return found;
  }

  has(ref: string): boolean {
    try {
      this.get(ref);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * What the net builder needs for a part ref: its pins, the pin sets it joins
   * internally, and whether it is a pure interconnect. Undefined when unknown.
   */
  topologyOf = (ref: string): PartTopology | undefined => {
    const cached = this.topologies.get(ref);
    if (cached) return cached;
    if (!this.has(ref)) return undefined;
    const part = this.get(ref);
    const topology = {
      pins: part.pins.map((pin) => pin.id),
      groups: part.pinGroups,
      interconnect: isInterconnect(part),
    };
    this.topologies.set(ref, topology);
    return topology;
  };

  /**
   * Map a pin id across a part-library version change, using the definition's
   * `pinMigrations`. Returns undefined when no migration covers it — that is
   * conflict C12 falling through to `ask`.
   */
  migratePin(ref: string, pinId: string): string | undefined {
    const { id, version } = parsePartRef(ref);
    const current = this.latest.get(id);
    if (!current) return undefined;
    if (current.version === version) return pinId;
    return current.pinMigrations[String(version)]?.[pinId];
  }
}

/** Default parameter values for a new instance of a part. */
export function defaultParams(part: PartDefinition): Record<string, number | string | boolean> {
  const params: Record<string, number | string | boolean> = {};
  for (const [id, definition] of Object.entries(part.params)) {
    params[id] = definition.default;
  }
  return params;
}

/** Read a value that may be a literal, a config pointer, or a param pointer. */
export function resolveNumber(
  value: NumberOrConfigRef,
  config: CircuitGitConfig,
  params: Record<string, number | string | boolean> = {},
): number | undefined {
  if (typeof value === 'number') return value;

  if ('paramRef' in value) {
    const param = params[value.paramRef];
    return typeof param === 'number' ? param : undefined;
  }

  let cursor: unknown = config;
  for (const segment of value.configRef.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === 'number' ? cursor : undefined;
}
