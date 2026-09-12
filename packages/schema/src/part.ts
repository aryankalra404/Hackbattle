import { z } from 'zod';

/**
 * Part definition schema.
 *
 * A part definition is DATA. It supplies everything an engine needs to handle a
 * part it has never seen: pins and what each pin electrically is, internal
 * connectivity, polarity, ratings, SPICE model, the rules that turn simulation
 * output into a UI state, visuals and footprint. No engine ever names a part.
 *
 * Files are written in a compact form — a breadboard declares its hole grid as
 * a handful of templates, a board declares one pin-mode map — and the schema
 * expands that into the concrete form every engine reads: one entry per pin,
 * one scalar param per setting, one list of pins per internal connection.
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

// ---- pins -------------------------------------------------------------------

/**
 * What a pin electrically is. Checks and UI read these instead of ever asking
 * which part a pin belongs to. A pin may list several; which one is active is
 * chosen by a pin-bound mode param.
 */
export const pinFunctionSchema = z.enum([
  /** Supplies a voltage (`voltage` set), or is a power input/rail (no `voltage`). */
  'power',
  /** Reference / return path. */
  'ground',
  /** Ordinary analog leg: resistor, LED, capacitor legs. */
  'analog_io',
  /** Can be driven or read as logic high/low. */
  'digital_io',
  /** Can output a pulse-width-modulated signal. */
  'pwm',
  /** Can read a variable voltage (ADC input, potentiometer wiper sense). */
  'analog_in',
  'uart_tx',
  'uart_rx',
  'i2c_sda',
  'i2c_scl',
  'spi_sck',
  'spi_mosi',
  'spi_miso',
  'spi_ss',
]);
export type PinFunction = z.infer<typeof pinFunctionSchema>;

/** Functions that make a pin part of a power or return path rather than a signal. */
export const SUPPLY_FUNCTIONS: readonly PinFunction[] = ['power', 'ground'];

export const pinSchema = z
  .object({
    id: pinIdSchema,
    name: z.string().min(1),
    functions: z.array(pinFunctionSchema).min(1),
    /** Voltage a `power` pin supplies. Absent on power inputs such as VIN. */
    voltage: numberOrConfigRefSchema.optional(),
    /** Leaving it unconnected is normal (an empty breadboard hole, an unused header pin). */
    optional: z.boolean().default(false),
    /** How many wires may end on this pin — 1 for a breadboard hole. Unlimited if absent. */
    maxConnections: z.number().int().positive().optional(),
  })
  .strict();

export type PinDefinition = z.infer<typeof pinSchema> & {
  /** Set on pins the loader generated from an internal-group template. */
  generatedBy?: string;
};

/** Pins chosen explicitly, or every pin that supports at least one of some functions. */
export const pinSelectorSchema = z.union([
  z.array(pinIdSchema).min(1),
  z.object({ withAnyFunction: z.array(pinFunctionSchema).min(1) }).strict(),
]);
export type PinSelector = z.infer<typeof pinSelectorSchema>;

// ---- params -----------------------------------------------------------------

/** What choosing one value of a pin-bound mode param means for that pin. */
export const pinModeSchema = z
  .object({
    /** The pin must list this function for the mode to be valid. */
    requires: pinFunctionSchema.optional(),
    /** The pin actively drives its net in this mode (an output). */
    drives: z.boolean().default(false),
  })
  .strict();
export type PinMode = z.infer<typeof pinModeSchema>;

const paramBase = {
  label: z.string().min(1),
  description: z.string().optional(),
  /** The pin this setting configures. Set by pin maps; allowed on any scalar param. */
  pin: pinIdSchema.optional(),
  /** Pin map this param was expanded from, so the UI can show it as one table. */
  group: z.string().optional(),
};

const numberParamSchema = z
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
  .strict();

const enumParamSchema = z
  .object({
    ...paramBase,
    type: z.literal('enum'),
    values: z.array(z.string().min(1)).min(1),
    default: z.string().min(1),
    /**
     * For a pin-bound enum: what each value means for the pin. A value with no
     * entry leaves the pin inactive (e.g. `disabled`).
     */
    modes: z.record(z.string(), pinModeSchema).optional(),
  })
  .strict();

const booleanParamSchema = z
  .object({ ...paramBase, type: z.literal('boolean'), default: z.boolean() })
  .strict();

export const paramSchema = z.discriminatedUnion('type', [
  numberParamSchema,
  enumParamSchema,
  booleanParamSchema,
]);
export type ParamDefinition = z.infer<typeof paramSchema>;

/**
 * One set of fields repeated for many pins — "which port does what". Expanded
 * at load time into ordinary scalar params keyed `<map>/<pin>/<field>`, so
 * component params stay flat and diff, hash and merge per setting.
 */
const pinMapParamSchema = z
  .object({
    type: z.literal('pinMap'),
    label: z.string().min(1),
    description: z.string().optional(),
    pins: pinSelectorSchema,
    fields: z.record(
      z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
      z.discriminatedUnion('type', [
        numberParamSchema.omit({ pin: true, group: true }),
        enumParamSchema.omit({ pin: true, group: true }),
        booleanParamSchema.omit({ pin: true, group: true }),
      ]),
    ),
  })
  .strict();

const rawParamSchema = z.union([paramSchema, pinMapParamSchema]);

/** Key of one expanded pin-map setting. `/` keeps it a single segment in dotted diff paths. */
export function pinParamKey(map: string, pin: string, field: string): string {
  return `${map}/${pin}/${field}`;
}

/** A pin map after expansion: which pins and fields it has, in display order. */
export type PinMapDefinition = {
  label: string;
  description?: string;
  pins: string[];
  fields: string[];
};

// ---- ratings and states -----------------------------------------------------

export const quantitySchema = z.enum([
  'current',
  'voltage',
  'reverse_voltage',
  'power',
  'frequency',
]);
export type Quantity = z.infer<typeof quantitySchema>;

/** Where a quantity is measured: through or across a pin pair, at one pin, or over the part. */
const measurementTarget = {
  through: z.tuple([pinIdSchema, pinIdSchema]).optional(),
  across: z.tuple([pinIdSchema, pinIdSchema]).optional(),
  /** Current into or out of a single pin. */
  pin: pinIdSchema.optional(),
  part: z.boolean().optional(),
};

const hasTarget = (r: {
  through?: unknown;
  across?: unknown;
  pin?: unknown;
  part?: boolean | undefined;
}) => Boolean(r.through) || Boolean(r.across) || Boolean(r.pin) || r.part === true;

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
  .refine(hasTarget, 'a rating must specify through, across, pin, or part');
export type RatingDefinition = z.infer<typeof ratingSchema>;

/** The same limit on many pins — expanded into one `pin` rating each. */
const rawRatingSchema = z.union([
  ratingSchema,
  z
    .object({
      quantity: quantitySchema,
      eachPin: pinSelectorSchema,
      max: numberOrConfigRefSchema,
      unit: z.string().min(1),
      note: z.string().optional(),
    })
    .strict(),
]);

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

// ---- simulation -------------------------------------------------------------

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
    /**
     * Pin map whose settings the netlist generator turns into the subcircuit
     * body at simulate time (one source or input load per configured pin).
     */
    generatedFrom: z.string().optional(),
  })
  .strict();

// ---- internal connectivity --------------------------------------------------

const gridPoint = z.tuple([z.number(), z.number()]);

/**
 * Templates for pins the loader generates and ties together. The generic net
 * builder joins every pin in a group into one net, for any part — a breadboard
 * row, a power rail, two GND headers that are one copper pour.
 */
export const internalGroupSchema = z.discriminatedUnion('type', [
  z
    .object({
      /** One group per row: holes `row<n>_<column>` for each listed column. */
      type: z.literal('row'),
      columns: z.array(z.string().regex(/^[a-z][a-z0-9]*$/)).min(1),
      rows: z
        .object({ from: z.number().int().positive(), to: z.number().int().positive() })
        .strict(),
      functions: z.array(pinFunctionSchema).min(1).default(['analog_io']),
      maxConnections: z.number().int().positive().optional(),
      /** Grid position of the first hole, and the step to the next row and next column. */
      origin: gridPoint,
      rowStep: gridPoint,
      columnStep: gridPoint,
    })
    .strict(),
  z
    .object({
      /** One group of `holes` pins named `<name>_<n>`. */
      type: z.literal('rail'),
      name: pinIdSchema,
      label: z.string().min(1),
      holes: z.number().int().positive(),
      functions: z.array(pinFunctionSchema).min(1).default(['analog_io']),
      maxConnections: z.number().int().positive().optional(),
      origin: gridPoint,
      step: gridPoint,
      /** Printed rails bunch holes in fives; leave one extra step after every N. */
      gapEvery: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      /** Declared pins that are the same conductor inside the part. */
      type: z.literal('pins'),
      pins: z.array(pinIdSchema).min(2),
    })
    .strict(),
]);
export type InternalGroup = z.infer<typeof internalGroupSchema>;

// ---- visuals ----------------------------------------------------------------

/**
 * Asset licences we accept. An enum, so a typo fails the build instead of
 * slipping past the attribution check.
 */
export const assetLicenseSchema = z.enum([
  'internal',
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'MIT',
]);
export type AssetLicense = z.infer<typeof assetLicenseSchema>;

/** Licences whose terms require crediting the author wherever the asset ships. */
export const ATTRIBUTION_REQUIRED: readonly AssetLicense[] = ['CC-BY-4.0', 'CC-BY-SA-4.0', 'MIT'];

const assetProvenance = {
  /** Where the asset came from: `drawn in-repo`, `procedural`, a URL, `fritzing-parts@<commit>`. */
  source: z.string().min(1),
  license: assetLicenseSchema,
  /** Credit line, required by CC-BY / CC-BY-SA / MIT. */
  attribution: z.string().min(1).optional(),
};

export const symbolAssetSchema = z.object({ path: z.string().min(1), ...assetProvenance }).strict();

export const modelAssetSchema = z
  .object({
    /** A .glb file. Absent while a placeholder stands in. */
    path: z.string().min(1).optional(),
    /** Labelled primitive drawn in its place until a real model exists. */
    placeholder: z.enum(['box']).optional(),
    ...assetProvenance,
  })
  .strict()
  .refine(
    (asset) => (asset.path === undefined) !== (asset.placeholder === undefined),
    'a 3D model needs exactly one of path / placeholder',
  );

export const visualSchema = z
  .object({
    symbol2d: symbolAssetSchema,
    model3d: modelAssetSchema,
    /** State name that makes the part light up in 2D and AR. */
    glowOnState: z.string().optional(),
    /** Electrical pin id -> named child transform on the 3D model. */
    pinAnchors3d: z.record(pinIdSchema, z.string().min(1)).optional(),
    /** Accent colour for the palette chip and node header. */
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    /** Node size in grid units, so the canvas needs no per-part sizing code. */
    size: z.tuple([z.number().positive(), z.number().positive()]).default([2, 1]),
  })
  .strict();

export const footprintSchema = z
  .object({
    /** Where each pin lands when this part is plugged into a hole grid. */
    breadboard: z
      .object({ pins: z.record(pinIdSchema, z.tuple([z.number(), z.number()])) })
      .strict()
      .optional(),
    /** Pitch of this part's own hole grid, for parts that have one. */
    holeSpacingMm: z.number().positive().optional(),
    /** Extent of that grid in pitches, [width, height]. */
    gridSize: gridPoint.optional(),
  })
  .strict();

// ---- the definition ---------------------------------------------------------

const rawPartDefinitionSchema = z
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
    /** Declared pins. May be empty when every pin is generated from `internalGroups`. */
    pins: z.array(pinSchema).default([]),
    internalGroups: z.array(internalGroupSchema).default([]),
    /** Grid position of declared pins, for parts drawn as a hole grid. */
    pinLayout: z.record(pinIdSchema, gridPoint).default({}),
    requiredPins: z.array(pinIdSchema).default([]),
    polarized: z.object({ positive: pinIdSchema, negative: pinIdSchema }).strict().optional(),
    params: z.record(z.string(), rawParamSchema).default({}),
    /** Absent for a pure interconnect, whose only electrical effect is its internal groups. */
    spice: spiceSchema.optional(),
    ratings: z.array(rawRatingSchema).default([]),
    states: z.array(stateRuleSchema).default([]),
    visual: visualSchema,
    footprint: footprintSchema.default({}),
    /** Old part version -> { old pin id: new pin id }. Resolves conflict C12. */
    pinMigrations: z.record(z.string(), z.record(z.string(), pinIdSchema)).default({}),
  })
  .strict();

type RawPartDefinition = z.infer<typeof rawPartDefinitionSchema>;

/** The expanded form every engine reads. */
export type PartDefinition = Omit<RawPartDefinition, 'pins' | 'params' | 'ratings'> & {
  pins: PinDefinition[];
  params: Record<string, ParamDefinition>;
  ratings: RatingDefinition[];
  /** Every set of pins the part ties together internally, templates expanded. */
  pinGroups: string[][];
  /** Pin maps by id, for showing their expanded params as one table. */
  pinMaps: Record<string, PinMapDefinition>;
};

export function selectPins(pins: readonly PinDefinition[], selector: PinSelector): string[] {
  if (Array.isArray(selector)) return [...selector];
  const wanted = new Set(selector.withAnyFunction);
  return pins.filter((pin) => pin.functions.some((fn) => wanted.has(fn))).map((pin) => pin.id);
}

function expandGroups(raw: RawPartDefinition): {
  pins: PinDefinition[];
  groups: string[][];
  layout: Record<string, [number, number]>;
} {
  const pins: PinDefinition[] = raw.pins.map((pin) => ({ ...pin }));
  const groups: string[][] = [];
  const layout: Record<string, [number, number]> = { ...raw.pinLayout };

  const at = (origin: [number, number], ...steps: [[number, number], number][]) => {
    let [x, y] = origin;
    for (const [[dx, dy], count] of steps) {
      x += dx * count;
      y += dy * count;
    }
    return [x, y] as [number, number];
  };

  raw.internalGroups.forEach((group, index) => {
    const generatedBy = `internalGroups.${index}`;

    if (group.type === 'pins') {
      groups.push([...group.pins]);
      return;
    }

    if (group.type === 'row') {
      for (let row = group.rows.from; row <= group.rows.to; row += 1) {
        const members: string[] = [];
        group.columns.forEach((column, c) => {
          const id = `row${row}_${column}`;
          members.push(id);
          pins.push({
            id,
            name: `Row ${row} ${column.toUpperCase()}`,
            functions: [...group.functions],
            optional: true,
            ...(group.maxConnections ? { maxConnections: group.maxConnections } : {}),
            generatedBy,
          });
          layout[id] = at(
            group.origin,
            [group.rowStep, row - group.rows.from],
            [group.columnStep, c],
          );
        });
        groups.push(members);
      }
      return;
    }

    const members: string[] = [];
    for (let hole = 1; hole <= group.holes; hole += 1) {
      const id = `${group.name}_${hole}`;
      members.push(id);
      pins.push({
        id,
        name: `${group.label} ${hole}`,
        functions: [...group.functions],
        optional: true,
        ...(group.maxConnections ? { maxConnections: group.maxConnections } : {}),
        generatedBy,
      });
      const gaps = group.gapEvery ? Math.floor((hole - 1) / group.gapEvery) : 0;
      layout[id] = at(group.origin, [group.step, hole - 1 + gaps]);
    }
    groups.push(members);
  });

  return { pins, groups, layout };
}

function expandPart(raw: RawPartDefinition): PartDefinition {
  const { pins, groups, layout } = expandGroups(raw);

  const params: Record<string, ParamDefinition> = {};
  const pinMaps: Record<string, PinMapDefinition> = {};
  for (const [id, definition] of Object.entries(raw.params)) {
    if (definition.type !== 'pinMap') {
      params[id] = definition;
      continue;
    }
    const mapPins = selectPins(pins, definition.pins);
    pinMaps[id] = {
      label: definition.label,
      ...(definition.description ? { description: definition.description } : {}),
      pins: mapPins,
      fields: Object.keys(definition.fields),
    };
    for (const pin of mapPins) {
      for (const [field, fieldDefinition] of Object.entries(definition.fields)) {
        params[pinParamKey(id, pin, field)] = { ...fieldDefinition, pin, group: id };
      }
    }
  }

  const ratings: RatingDefinition[] = raw.ratings.flatMap((rating) => {
    if (!('eachPin' in rating)) return [rating];
    const { eachPin, ...rest } = rating;
    return selectPins(pins, eachPin).map((pin) => ({ ...rest, pin }));
  });

  return { ...raw, pins, pinLayout: layout, params, ratings, pinGroups: groups, pinMaps };
}

function validatePart(part: PartDefinition, ctx: z.RefinementCtx): void {
  const pinIds = new Set(part.pins.map((pin) => pin.id));
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

  const requirePin = (pin: string, path: (string | number)[]) => {
    if (!pinIds.has(pin)) {
      const known = [...pinIds];
      const hint = known.length > 12 ? `${known.slice(0, 12).join(', ')}, …` : known.join(', ');
      issue(path, `unknown pin "${pin}" (declared pins: ${hint})`);
    }
  };

  if (part.pins.length === 0) issue(['pins'], 'a part needs at least one pin');

  const seen = new Set<string>();
  part.pins.forEach((pin, i) => {
    if (seen.has(pin.id)) issue(['pins', i], `duplicate pin id "${pin.id}"`);
    seen.add(pin.id);
    if (pin.voltage !== undefined && !pin.functions.includes('power')) {
      issue(['pins', i, 'voltage'], `pin "${pin.id}" has a voltage but is not a power pin`);
    }
  });

  part.requiredPins.forEach((pin, i) => requirePin(pin, ['requiredPins', i]));
  if (part.polarized) {
    requirePin(part.polarized.positive, ['polarized', 'positive']);
    requirePin(part.polarized.negative, ['polarized', 'negative']);
  }
  part.ratings.forEach((rating, i) => {
    for (const pin of rating.through ?? rating.across ?? []) requirePin(pin, ['ratings', i]);
    if (rating.pin) requirePin(rating.pin, ['ratings', i, 'pin']);
  });
  part.states.forEach((state, i) => {
    const target = state.when?.through ?? state.when?.across ?? [];
    for (const pin of target) requirePin(pin, ['states', i]);
    if (state.when?.pin) requirePin(state.when.pin, ['states', i, 'pin']);
  });
  for (const pin of Object.keys(part.footprint.breadboard?.pins ?? {})) {
    requirePin(pin, ['footprint', 'breadboard', 'pins', pin]);
  }
  for (const pin of Object.keys(part.pinLayout)) requirePin(pin, ['pinLayout', pin]);
  for (const pin of Object.keys(part.visual.pinAnchors3d ?? {})) {
    requirePin(pin, ['visual', 'pinAnchors3d', pin]);
  }

  // A pin in two groups would silently merge the groups; make that explicit instead.
  const groupOf = new Map<string, number>();
  part.pinGroups.forEach((group, g) => {
    for (const pin of group) {
      requirePin(pin, ['internalGroups', g]);
      const previous = groupOf.get(pin);
      if (previous !== undefined && previous !== g) {
        issue(['internalGroups', g], `pin "${pin}" is in more than one internal group`);
      }
      groupOf.set(pin, g);
    }
  });

  // No electrical model means the part is pure interconnect: every pin must be
  // in a group, or it would be a pin that connects to nothing.
  if (!part.spice) {
    const loose = part.pins.filter((pin) => !groupOf.has(pin.id)).map((pin) => pin.id);
    if (loose.length > 0) {
      issue(
        ['spice'],
        `a part without a spice model must group every pin; loose: ${loose.join(', ')}`,
      );
    }
  }

  for (const [id, param] of Object.entries(part.params)) {
    if (param.pin) requirePin(param.pin, ['params', id, 'pin']);
    if (param.type !== 'enum') continue;
    if (!param.values.includes(param.default)) {
      issue(['params', id, 'default'], `default "${param.default}" is not one of the values`);
    }
    for (const value of Object.keys(param.modes ?? {})) {
      if (!param.values.includes(value)) {
        issue(['params', id, 'modes', value], `mode "${value}" is not one of the values`);
      }
    }
  }

  // Exactly one fallback state, and it must be last.
  const fallbacks = part.states.filter((s) => s.otherwise === true);
  if (part.states.length > 0 && fallbacks.length !== 1) {
    issue(['states'], 'state rules need exactly one `otherwise: true` fallback');
  }
  if (part.states.length > 0 && part.states[part.states.length - 1]?.otherwise !== true) {
    issue(['states'], 'the `otherwise: true` fallback must be the last state rule');
  }

  if (part.spice) {
    // Every {pin.x} in the SPICE template must exist.
    for (const match of part.spice.template.matchAll(/\{pin\.([a-z0-9_]+)\}/g)) {
      requirePin(match[1] ?? '', ['spice', 'template']);
    }
    // Every {param.x} must exist.
    for (const match of part.spice.template.matchAll(/\{param\.([a-zA-Z0-9_]+)\}/g)) {
      const param = match[1] ?? '';
      if (!part.params[param]) issue(['spice', 'template'], `unknown param "${param}"`);
    }
    if (part.spice.modelParam && !part.params[part.spice.modelParam]) {
      issue(['spice', 'modelParam'], `unknown param "${part.spice.modelParam}"`);
    }
    if (part.spice.generatedFrom && !part.pinMaps[part.spice.generatedFrom]) {
      issue(['spice', 'generatedFrom'], `unknown pin map "${part.spice.generatedFrom}"`);
    }
  }

  if (part.visual.glowOnState) {
    const states = new Set(part.states.map((s) => s.state));
    if (!states.has(part.visual.glowOnState)) {
      issue(
        ['visual', 'glowOnState'],
        `glowOnState "${part.visual.glowOnState}" is not a declared state`,
      );
    }
  }

  for (const key of ['symbol2d', 'model3d'] as const) {
    const asset = part.visual[key];
    if (ATTRIBUTION_REQUIRED.includes(asset.license) && !asset.attribution) {
      issue(['visual', key, 'attribution'], `${asset.license} requires an attribution line`);
    }
  }
}

/**
 * Validates a part file and returns the expanded definition. Output-side
 * validation runs after expansion so that references to generated pins and
 * pin-map params are checked like any other.
 */
export const partDefinitionSchema: z.ZodType<PartDefinition, z.ZodTypeDef, unknown> =
  rawPartDefinitionSchema.transform(expandPart).superRefine(validatePart);

/** No electrical model of its own: it only joins pins (breadboard, socket, header strip). */
export function isInterconnect(part: Pick<PartDefinition, 'spice'>): boolean {
  return part.spice === undefined;
}

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
