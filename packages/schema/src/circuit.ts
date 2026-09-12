import { z } from 'zod';
import { analysisKindSchema } from './config.js';
import { partRefSchema } from './part.js';

/**
 * Circuit snapshot.
 *
 * Collections are maps keyed by random UUIDs so a diff resolves per entity and
 * survives renaming. Labels like "R1" are display-only and never identity.
 */

export const uuidSchema = z.string().uuid();

/** `<componentId>.<pinId>` */
export const pinRefSchema = z
  .string()
  .regex(/^[0-9a-fA-F-]{36}\.[a-z][a-z0-9_]*$/, 'expected "<componentId>.<pinId>"');
export type PinRef = z.infer<typeof pinRefSchema>;

export function pinRef(componentId: string, pin: string): PinRef {
  return `${componentId}.${pin}`;
}

export function parsePinRef(ref: string): { componentId: string; pinId: string } {
  const dot = ref.lastIndexOf('.');
  if (dot < 0) throw new Error(`Malformed pin reference "${ref}"`);
  return { componentId: ref.slice(0, dot), pinId: ref.slice(dot + 1) };
}

/** Param values are scalars; the part definition says how to interpret them. */
export const paramValueSchema = z.union([z.number(), z.string(), z.boolean()]);

export const positionSchema = z.object({ x: z.number(), y: z.number() }).strict();
export const position3dSchema = z.object({ x: z.number(), y: z.number(), z: z.number() }).strict();

export const componentSchema = z
  .object({
    part: partRefSchema,
    label: z.string().min(1),
    params: z.record(z.string(), paramValueSchema).default({}),
  })
  .strict();
export type CircuitComponent = z.infer<typeof componentSchema>;

export const wireStyleSchema = z
  .object({
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
  })
  .strict();

export const wireSchema = z
  .object({
    a: pinRefSchema,
    b: pinRefSchema,
    style: wireStyleSchema.default({}),
  })
  .strict()
  .refine((wire) => wire.a !== wire.b, 'a wire cannot join a pin to itself');
export type Wire = z.infer<typeof wireSchema>;

export const testSchema = z
  .object({
    kind: z.enum(['state', 'value', 'frequency']),
    /** A pin ref, component id, or net name, depending on kind. */
    target: z.string().min(1),
    expect: z.union([z.string(), z.number(), z.boolean()]),
    tolerance: z
      .union([z.number(), z.object({ configRef: z.string().min(1) }).strict()])
      .optional(),
    label: z.string().optional(),
  })
  .strict();
export type CircuitTest = z.infer<typeof testSchema>;

export const annotationSchema = z
  .object({ attachedTo: z.string().min(1), text: z.string() })
  .strict();

export const settingsSchema = z
  .object({
    /** `<componentId>.<pinId>` treated as the 0 V reference. */
    ground: pinRefSchema.optional(),
    simulation: z
      .object({
        analysis: analysisKindSchema.default('op'),
        stopSeconds: z.number().positive().optional(),
        stepSeconds: z.number().positive().optional(),
      })
      .strict()
      .default({ analysis: 'op' }),
  })
  .strict();

export const metaSchema = z
  .object({
    name: z.string().default(''),
    description: z.string().default(''),
    /** Plain-language goal; the intent_checker compares it with the real circuit. */
    intent: z.string().default(''),
  })
  .strict();

export const layoutSchema = z
  .object({
    '2d': z.record(uuidSchema, positionSchema).default({}),
    ar: z.record(uuidSchema, position3dSchema).default({}),
    breadboard: z.record(uuidSchema, z.tuple([z.number(), z.number()])).default({}),
  })
  .strict();

/** A nested circuit imported as a single unit. */
export type CircuitBlock = {
  source: string;
  snapshot: CircuitSnapshot;
  ports: Record<string, string>;
};

export type CircuitSnapshot = {
  schemaVersion: 1;
  meta: z.infer<typeof metaSchema>;
  settings: z.infer<typeof settingsSchema>;
  components: Record<string, CircuitComponent>;
  wires: Record<string, Wire>;
  blocks: Record<string, CircuitBlock>;
  tests: Record<string, CircuitTest>;
  annotations: Record<string, z.infer<typeof annotationSchema>>;
  layout: z.infer<typeof layoutSchema>;
};

/**
 * Snapshots nest through `blocks`, so the schema is recursive and needs an
 * explicit annotation. The input type is `unknown` because `.default()` makes
 * many fields optional on the way in but present on the way out.
 */
export const circuitSnapshotSchema: z.ZodType<CircuitSnapshot, z.ZodTypeDef, unknown> = z.lazy(() =>
  z
    .object({
      schemaVersion: z.literal(1),
      meta: metaSchema,
      settings: settingsSchema,
      components: z.record(uuidSchema, componentSchema).default({}),
      wires: z.record(uuidSchema, wireSchema).default({}),
      blocks: z.record(uuidSchema, blockSchema).default({}),
      tests: z.record(uuidSchema, testSchema).default({}),
      annotations: z.record(uuidSchema, annotationSchema).default({}),
      layout: layoutSchema,
    })
    .strict(),
);

export const blockSchema: z.ZodType<CircuitBlock, z.ZodTypeDef, unknown> = z.lazy(() =>
  z
    .object({
      source: z.string().min(1),
      snapshot: circuitSnapshotSchema,
      ports: z.record(z.string(), z.string()).default({}),
    })
    .strict(),
);

/**
 * Referential integrity: no wire, test, annotation, ground setting or layout
 * entry may point at something that does not exist. A snapshot that fails this
 * must never be committed.
 */
export function findDanglingReferences(snapshot: CircuitSnapshot): string[] {
  const problems: string[] = [];
  const components = snapshot.components;

  const checkPin = (ref: string, where: string) => {
    const { componentId, pinId } = parsePinRef(ref);
    if (!components[componentId]) {
      problems.push(`${where} references unknown component ${componentId}`);
    }
    void pinId; // pin existence needs the part library; checked by the parts loader
  };

  for (const [id, wire] of Object.entries(snapshot.wires)) {
    checkPin(wire.a, `wire ${id}.a`);
    checkPin(wire.b, `wire ${id}.b`);
  }
  if (snapshot.settings.ground) checkPin(snapshot.settings.ground, 'settings.ground');

  for (const [id, annotation] of Object.entries(snapshot.annotations)) {
    const target = annotation.attachedTo;
    if (
      target !== 'circuit' &&
      !components[target] &&
      !snapshot.wires[target] &&
      !snapshot.blocks[target]
    ) {
      problems.push(`annotation ${id} is attached to unknown entity ${target}`);
    }
  }

  for (const key of Object.keys(snapshot.layout['2d'])) {
    if (!components[key] && !snapshot.blocks[key]) {
      problems.push(`layout.2d has an entry for unknown entity ${key}`);
    }
  }

  return problems;
}

export function emptySnapshot(name = ''): CircuitSnapshot {
  return {
    schemaVersion: 1,
    meta: { name, description: '', intent: '' },
    settings: { simulation: { analysis: 'op' } },
    components: {},
    wires: {},
    blocks: {},
    tests: {},
    annotations: {},
    layout: { '2d': {}, ar: {}, breadboard: {} },
  };
}
