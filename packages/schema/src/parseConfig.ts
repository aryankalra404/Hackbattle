import type { ZodError } from 'zod';
import { configSchema, type CircuitGitConfig } from './config.js';

/**
 * Config validation. Browser-safe: no filesystem access, so the web and AR
 * clients validate the bundled config with exactly the same code the server
 * uses on the file it reads from disk.
 */

/** Thrown when config fails schema validation. Startup must not continue past this. */
export class ConfigValidationError extends Error {
  readonly issues: readonly string[];

  constructor(source: string, error: ZodError) {
    const issues = error.errors.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    });
    super(`Invalid CircuitGit config at ${source}:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

/** Validate an already-parsed config object. Throws ConfigValidationError on failure. */
export function parseConfig(raw: unknown, source = '(inline)'): CircuitGitConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) throw new ConfigValidationError(source, result.error);
  return result.data;
}
