import { z } from 'zod';

/**
 * Part definition schema.
 *
 * A part definition is DATA. It supplies everything an engine needs to handle a
 * part it has never seen: pins, polarity, ratings, SPICE model, the rules that
 * turn simulation output into a UI state, visuals and footprint. No engine ever
 * names a part.
 */

/** `led-5mm`, `resistor`, `ne555` — lowercase, digits and dashes. */
export const partIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'part id must be lowercase kebab-case');

export const pinIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'pin id must be lowercase snake_case');

/** A reference to a value in config, so tunables never get baked into part files. */
export const configRefSchema = z.object({ configRef: z.string().min(1) }).strict();

/**
 * A reference to one of this part's own params — e.g. a supply whose current
 * limit is set per instance rather than fixed by a datasheet.
 */
export const paramRefSchema = z.object({ paramRef: z.string().min(1) }).strict();

/** A literal number, a pointer into config, or a pointer at one of the part's params. */
export const numberOrConfigRefSchema = z.union([z.number(), configRefSchema, paramRefSchema]);
export type NumberOrConfigRef = z.infer<typeof numberOrConfigRefSchema>;

export const pinSchema = z
  .object({
    id: pinIdSchema,
    name: z.string().min(1),
    /** Free-text role used by generic checks (e.g. which pins expect a supply). */
    role: z.enum(['passive', 'input', 'output', 'power', 'ground']).default('passive'),
  })
  .strict();
export type PinDefinition = z.infer<typeof pinSchema>;

const paramBase = { label: z.string().min(1), description: z.string().optional() };

export const paramSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...paramBase,
      type: z.literal('number'),
      /** Empty for dimensionless quantities such as a wiper position. */
      unit: z.string(),
      default: z.number(),
      min: z.number().optional(),
      max: z.number().optional(),
      /** Preferred values offered in the UI; the field stays free-entry. */
      presets: z.array(z.number()).optional(),
      /** Render with an SI prefix (k, M, µ, n) rather than raw digits. */
      siPrefix: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      ...paramBase,
      type: z.literal('enum'),
      values: z.array(z.string().min(1)).min(1),
      default: z.string().min(1),
    })
    .strict(),
  z.object({ ...paramBase, type: z.literal('boolean'), default: z.boolean() }).strict(),
]);
export type ParamDefinition = z.infer<typeof paramSchema>;

export const quantitySchema = z.enum([
  'current',
  'voltage',
  'reverse_voltage',
  'power',
  'frequency',
]);
export type Quantity = z.infer<typeof quantitySchema>;

/** Where a quantity is measured: through a pin pair, across a pin pair, or over the whole part. */
const measurementTarget = {
  through: z.tuple([pinIdSchema, pinIdSchema]).optional(),
  across: z.tuple([pinIdSchema, pinIdSchema]).optional(),
  part: z.boolean().optional(),
};

export const ratingSchema = z
  .object({
    quantity: quantitySchema,
    ...measurementTarget,
    max: numberOrConfigRefSchema,
    unit: z.string().min(1),
    /** Optional note explaining the limit, shown in findings. */
    note: z.string().optional(),
  })
  .strict()
  .refine(
    (r) => Boolean(r.through) || Boolean(r.across) || r.part === true,
    'a rating must specify through, across, or part',
  );
export type RatingDefinition = z.infer<typeof ratingSchema>;

export const stateConditionSchema = z
  .object({
    quantity: quantitySchema,
    ...measurementTarget,
    gt: numberOrConfigRefSchema.optional(),
    lt: numberOrConfigRefSchema.optional(),
    abs: z.boolean().default(true),
  })
  .strict()
  .refine((c) => c.gt !== undefined || c.lt !== undefined, 'a condition needs gt or lt');

export const stateRuleSchema = z
  .object({
    state: z.string().min(1),
    when: stateConditionSchema.optional(),
    otherwise: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (s) => (s.when === undefined) !== (s.otherwise === undefined),
    'a state rule needs exactly one of when / otherwise',
  );
export type StateRule = z.infer<typeof stateRuleSchema>;

export const spiceSchema = z
  .object({
    /** SPICE element letter (R, C, D, Q, V, X...). Used by the SPICE importer too. */
    element: z.string().regex(/^[A-Z]$/),
    /**
     * Netlist line. Placeholders: {label}, {pin.<pinId>}, {param.<paramId>},
     * {model}. Rendered only by the netlist generator.
     */
    template: z.string().min(1),
    /** Model card per enum param value, or a single `default` entry. */
    models: z.record(z.string(), z.string()).optional(),
    /** Which enum param selects the model. */
    modelParam: z.string().optional(),
    /** .subckt body for parts modelled as a subcircuit. */
    subcircuit: z.string().optional(),
  })
  .strict();

export const visualSchema = z
  .object({
    symbol2d: z.string().min(1),
    model3d: z.string().optional(),
    /** State name that makes the part light up in 2D and AR. */
    glowOnState: z.string().optional(),
    /** Accent colour for the palette chip and node header. */
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    /** Node size in grid units, so the canvas needs no per-part sizing code. */
    size: z.tuple([z.number().positive(), z.number().positive()]).default([2, 1]),
  })
  .strict();

export const footprintSchema = z
  .object({
    breadboard: z
      .object({ pins: z.record(pinIdSchema, z.tuple([z.number(), z.number()])) })
      .strict()
      .optional(),
  })
  .strict();

export const partDefinitionSchema = z
  .object({
    id: partIdSchema,
    version: z.number().int().positive(),
    name: z.string().min(1),
    /** Palette grouping. Data, so a new category needs no UI change. */
    category: z.string().min(1),
    description: z.string().min(1),
    labelPrefix: z.string().min(1).max(3),
    /** Citation for every rating and model number in this file. Required. */
    source: z.string().min(1),
    pins: z.array(pinSchema).min(1),
    requiredPins: z.array(pinIdSchema).default([]),
    polarized: z.object({ positive: pinIdSchema, negative: pinIdSchema }).strict().optional(),
    params: z.record(z.string(), paramSchema).default({}),
    spice: spiceSchema,
    ratings: z.array(ratingSchema).default([]),
    states: z.array(stateRuleSchema).default([]),
    visual: visualSchema,
    footprint: footprintSchema.default({}),
    /** Old part version -> { old pin id: new pin id }. Resolves conflict C12. */
    pinMigrations: z.record(z.string(), z.record(z.string(), pinIdSchema)).default({}),
  })
  .strict()
  .superRefine((part, ctx) => {
    const pinIds = new Set(part.pins.map((pin) => pin.id));

    const requirePin = (pin: string, path: (string | number)[]) => {
      if (!pinIds.has(pin)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `unknown pin "${pin}" (declared pins: ${[...pinIds].join(', ')})`,
        });
      }
    };

    part.requiredPins.forEach((pin, i) => requirePin(pin, ['requiredPins', i]));
    if (part.polarized) {
      requirePin(part.polarized.positive, ['polarized', 'positive']);
      requirePin(part.polarized.negative, ['polarized', 'negative']);
    }
    part.ratings.forEach((rating, i) => {
      for (const pin of rating.through ?? rating.across ?? []) requirePin(pin, ['ratings', i]);
    });
    part.states.forEach((state, i) => {
      const target = state.when?.through ?? state.when?.across ?? [];
      for (const pin of target) requirePin(pin, ['states', i]);
    });
    for (const [pin, position] of Object.entries(part.footprint.breadboard?.pins ?? {})) {
      requirePin(pin, ['footprint', 'breadboard', 'pins', pin]);
      void position;
    }

    // Exactly one fallback state, and it must be last.
    const fallbacks = part.states.filter((s) => s.otherwise === true);
    if (part.states.length > 0 && fallbacks.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['states'],
        message: 'state rules need exactly one `otherwise: true` fallback',
      });
    }
    if (part.states.length > 0 && part.states[part.states.length - 1]?.otherwise !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['states'],
        message: 'the `otherwise: true` fallback must be the last state rule',
      });
    }

    // Every {pin.x} in the SPICE template must exist.
    for (const match of part.spice.template.matchAll(/\{pin\.([a-z0-9_]+)\}/g)) {
      requirePin(match[1] ?? '', ['spice', 'template']);
    }
    // Every {param.x} must exist.
    for (const match of part.spice.template.matchAll(/\{param\.([a-zA-Z0-9_]+)\}/g)) {
      const param = match[1] ?? '';
      if (!part.params[param]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['spice', 'template'],
          message: `unknown param "${param}"`,
        });
      }
    }
    if (part.spice.modelParam && !part.params[part.spice.modelParam]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['spice', 'modelParam'],
        message: `unknown param "${part.spice.modelParam}"`,
      });
    }
    if (part.visual.glowOnState) {
      const states = new Set(part.states.map((s) => s.state));
      if (!states.has(part.visual.glowOnState)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['visual', 'glowOnState'],
          message: `glowOnState "${part.visual.glowOnState}" is not a declared state`,
        });
      }
    }
  });

export type PartDefinition = z.infer<typeof partDefinitionSchema>;

/** `led-5mm@2` — a part id pinned to a library version. */
export const partRefSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*@\d+$/, 'expected "<part-id>@<version>"');

export function partRef(part: Pick<PartDefinition, 'id' | 'version'>): string {
  return `${part.id}@${part.version}`;
}

export function parsePartRef(ref: string): { id: string; version: number } {
  const [id, version] = ref.split('@');
  if (!id || !version) throw new Error(`Malformed part reference "${ref}"`);
  return { id, version: Number(version) };
}
