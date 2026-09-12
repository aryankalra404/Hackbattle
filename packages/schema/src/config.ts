import { z } from 'zod';

/**
 * Schema for config/default.yaml.
 *
 * Every tunable in CircuitGit lives in config and is validated here at startup.
 * `.strict()` everywhere is deliberate: a typo in a key must fail fast rather
 * than silently fall back to a default.
 */

const positive = z.number().positive();
const nonNegative = z.number().nonnegative();
const fraction = z.number().min(0).max(1);

export const severitySchema = z.enum(['info', 'warning', 'error']);
export type Severity = z.infer<typeof severitySchema>;

export const llmJobNameSchema = z.enum([
  'fault_explainer',
  'blind_verifier',
  'mismatch_analyst',
  'intent_checker',
  'merge_advisor',
  'change_summarizer',
]);
export type LlmJobName = z.infer<typeof llmJobNameSchema>;

export const llmJobConfigSchema = z
  .object({
    model: z.string().min(1),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().positive(),
    sampleCount: z.number().int().min(1).max(9),
    timeoutMs: z.number().int().positive(),
    retries: z.number().int().min(0).max(5),
    promptVersion: z.number().int().positive(),
  })
  .strict();
export type LlmJobConfig = z.infer<typeof llmJobConfigSchema>;

export const llmConfigSchema = z
  .object({
    provider: z.enum(['anthropic']),
    jobs: z.record(llmJobNameSchema, llmJobConfigSchema),
    cache: z
      .object({
        enabled: z.boolean(),
        ttlSeconds: z.number().int().positive(),
        maxEntries: z.number().int().positive(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const job of llmJobNameSchema.options) {
      if (!value.jobs[job]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['jobs', job],
          message: `missing configuration for LLM job "${job}"`,
        });
      }
    }
  });

export const comparatorConfigSchema = z
  .object({
    relativeTolerance: fraction,
    absoluteFloor: z
      .object({
        voltage: nonNegative,
        current: nonNegative,
        power: nonNegative,
        frequency: nonNegative,
      })
      .strict(),
    stateMatch: z.enum(['exact']),
    majorityThreshold: fraction,
    minSamplesForVerdict: z.number().int().min(1),
  })
  .strict();

export const simulationBackendSchema = z.enum(['builtin-dc', 'ngspice']);
export type SimulationBackendId = z.infer<typeof simulationBackendSchema>;

export const analysisKindSchema = z.enum(['op', 'transient']);
export type AnalysisKind = z.infer<typeof analysisKindSchema>;

export const simulationConfigSchema = z
  .object({
    backends: z.record(analysisKindSchema, simulationBackendSchema),
    defaultAnalysis: analysisKindSchema,
    builtinDc: z
      .object({
        maxIterations: z.number().int().positive(),
        voltageTolerance: positive,
        currentTolerance: positive,
        gminStepping: z.boolean(),
        gmin: positive,
      })
      .strict(),
    ngspice: z
      .object({
        mode: z.enum(['native', 'wasm']),
        binaryPath: z.string().min(1),
        timeoutMs: z.number().int().positive(),
      })
      .strict(),
    transient: z
      .object({
        defaultStopSeconds: positive,
        defaultStepSeconds: positive,
        maxPoints: z.number().int().positive(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const analysis of analysisKindSchema.options) {
      if (!value.backends[analysis]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['backends', analysis],
          message: `no simulation backend configured for analysis "${analysis}"`,
        });
      }
    }
    if (value.transient.defaultStepSeconds >= value.transient.defaultStopSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['transient', 'defaultStepSeconds'],
        message: 'transient step must be smaller than stop time',
      });
    }
  });

export const ruleKindSchema = z.enum([
  'rating_exceeded',
  'polarity_reversed',
  'short_circuit',
  'floating_pin',
  'unconnected_required_pin',
  'no_ground_path',
  'power_budget',
  'hole_occupancy',
  'user_test_failed',
]);
export type RuleKind = z.infer<typeof ruleKindSchema>;

export const rulesConfigSchema = z
  .object({
    kinds: z.record(
      ruleKindSchema,
      z.object({ enabled: z.boolean(), severity: severitySchema }).strict(),
    ),
    ratingHeadroom: positive,
    thresholds: z.record(z.string(), z.number()),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const kind of ruleKindSchema.options) {
      if (!value.kinds[kind]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['kinds', kind],
          message: `missing rule configuration for kind "${kind}"`,
        });
      }
    }
  });

/** Conflict catalogue IDs C1..C37 from DESIGN.md. */
export const conflictIdSchema = z.enum([
  'C1',
  'C2',
  'C3',
  'C4',
  'C5',
  'C6',
  'C7',
  'C8',
  'C9',
  'C10',
  'C11',
  'C12',
  'C13',
  'C14',
  'C15',
  'C16',
  'C17',
  'C18',
  'C19',
  'C20',
  'C21',
  'C22',
  'C23',
  'C24',
  'C25',
  'C26',
  'C27',
  'C28',
  'C29',
  'C30',
  'C31',
  'C32',
  'C33',
  'C34',
  'C35',
  'C36',
  'C37',
]);
export type ConflictId = z.infer<typeof conflictIdSchema>;

export const conflictPolicySchema = z.enum(['auto', 'auto:ours', 'auto:theirs', 'ask', 'block']);
export type ConflictPolicy = z.infer<typeof conflictPolicySchema>;

export const versionControlConfigSchema = z
  .object({
    protectedBranches: z.array(z.string().min(1)),
    defaultBranch: z.string().min(1),
    merge: z
      .object({
        policies: z.record(conflictIdSchema, conflictPolicySchema),
        escalateOnProtected: z.array(conflictIdSchema),
        overlapNudgeDistance: positive,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const id of conflictIdSchema.options) {
      if (!value.merge.policies[id]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['merge', 'policies', id],
          message: `missing merge policy for conflict "${id}"`,
        });
      }
    }
  });

export const arConfigSchema = z
  .object({
    snapRadiusMetres: positive,
    wireSnapRadiusMetres: positive,
    currentParticleScale: positive,
    maxParticleSpeed: positive,
    glowIntensityScale: positive,
    workbenchDefaultHeightMetres: positive,
  })
  .strict();

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a #rrggbb colour');

export const uiConfigSchema = z
  .object({
    diffColors: z.object({ added: hexColor, removed: hexColor, changed: hexColor }).strict(),
    autosaveIntervalMs: z.number().int().positive(),
  })
  .strict();

export const evalConfigSchema = z
  .object({
    datasetSize: z.number().int().positive(),
    mutationsPerCircuit: z.number().int().positive(),
    thresholds: z
      .object({
        explainerPrecision: fraction,
        explainerRecall: fraction,
        falsePositiveRate: fraction,
        verifierAgreementRate: fraction,
        invalidOutputRate: fraction,
        nonexistentIdRate: fraction,
        latencyP95Ms: z.number().int().positive(),
      })
      .strict(),
    reportDir: z.string().min(1),
  })
  .strict();

export const checkStageSchema = z.enum([
  'topology',
  'simulation',
  'blind_verify',
  'explain',
  'intent',
  'connectivity',
]);
export type CheckStage = z.infer<typeof checkStageSchema>;

export const checksConfigSchema = z
  .object({
    onEdit: z.array(checkStageSchema),
    onTest: z.array(checkStageSchema),
    onDetect: z.array(checkStageSchema),
    onCommit: z.array(checkStageSchema),
    onMerge: z.array(checkStageSchema),
  })
  .strict();

export const configSchema = z
  .object({
    configVersion: z.number().int().positive(),
    product: z.object({ name: z.string().min(1), shortName: z.string().min(1) }).strict(),
    llm: llmConfigSchema,
    comparator: comparatorConfigSchema,
    simulation: simulationConfigSchema,
    rules: rulesConfigSchema,
    versionControl: versionControlConfigSchema,
    ar: arConfigSchema,
    ui: uiConfigSchema,
    eval: evalConfigSchema,
    checks: checksConfigSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.versionControl.protectedBranches.includes(value.versionControl.defaultBranch)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['versionControl', 'protectedBranches'],
        message: `defaultBranch "${value.versionControl.defaultBranch}" should be listed in protectedBranches`,
      });
    }
  });

export type CircuitGitConfig = z.infer<typeof configSchema>;
