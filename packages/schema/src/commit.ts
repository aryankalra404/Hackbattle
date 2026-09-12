import { z } from 'zod';
import { ruleKindSchema, severitySchema } from './config.js';

/** Commits, branches, working copies and check results. */

export const checkStatusSchema = z.enum(['pass', 'warn', 'fail', 'unavailable', 'pending']);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

/** A structured rule finding. Never a prose string, so the UI can highlight parts. */
export const findingSchema = z
  .object({
    kind: ruleKindSchema,
    severity: severitySchema,
    componentIds: z.array(z.string()).default([]),
    pinIds: z.array(z.string()).default([]),
    measured: z.number().optional(),
    limit: z.number().optional(),
    unit: z.string().optional(),
    message: z.string().min(1),
  })
  .strict();
export type Finding = z.infer<typeof findingSchema>;

export const commitChecksSchema = z
  .object({
    rules: checkStatusSchema,
    sim: checkStatusSchema,
    llm: checkStatusSchema,
  })
  .strict();
export type CommitChecks = z.infer<typeof commitChecksSchema>;

export const commitSourceSchema = z.enum(['quest', 'web', 'import', 'merge']);

export const commitSchema = z
  .object({
    id: z.string().min(1),
    parents: z.array(z.string()).max(2),
    snapshotHash: z.string().min(1),
    electricalHash: z.string().min(1),
    message: z.string().min(1),
    author: z.string().min(1),
    source: commitSourceSchema,
    createdAt: z.string().datetime(),
    checks: commitChecksSchema,
  })
  .strict();
export type Commit = z.infer<typeof commitSchema>;

export const branchSchema = z
  .object({
    project: z.string().min(1),
    name: z.string().min(1),
    head: z.string().min(1),
    protected: z.boolean().default(false),
  })
  .strict();
export type Branch = z.infer<typeof branchSchema>;

export const workingCopySchema = z
  .object({
    user: z.string().min(1),
    device: z.string().min(1),
    project: z.string().min(1),
    branch: z.string().min(1),
    baseCommit: z.string().min(1),
    updatedAt: z.string().datetime(),
  })
  .strict();

/** One entry in a two-commit diff. */
export const diffChangeSchema = z
  .object({
    kind: z.enum(['added', 'removed', 'changed']),
    collection: z.enum([
      'components',
      'wires',
      'blocks',
      'tests',
      'annotations',
      'settings',
      'meta',
      'layout',
    ]),
    entityId: z.string(),
    /** Dotted path within the entity, e.g. `params.resistance`. */
    field: z.string().optional(),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
    /** Cosmetic changes are hidden by the electrical-only filter. */
    electrical: z.boolean(),
    label: z.string(),
  })
  .strict();
export type DiffChange = z.infer<typeof diffChangeSchema>;
