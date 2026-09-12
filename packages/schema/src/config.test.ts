import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'node:fs';
import { defaultConfigPath, loadConfig } from './loadConfig.js';
import { ConfigValidationError, parseConfig } from './parseConfig.js';
import { conflictIdSchema, llmJobNameSchema, ruleKindSchema } from './config.js';

/** The shipped config, re-read raw so tests can mutate a copy without touching disk. */
function rawConfig(): Record<string, unknown> {
  return parseYaml(readFileSync(defaultConfigPath(), 'utf8')) as Record<string, unknown>;
}

describe('config/default.yaml', () => {
  it('loads and validates', () => {
    const config = loadConfig();
    expect(config.configVersion).toBeGreaterThan(0);
    expect(config.product.name).toBe('CircuitGit');
  });

  it('configures every LLM job', () => {
    const config = loadConfig();
    for (const job of llmJobNameSchema.options) {
      expect(config.llm.jobs[job], `job ${job}`).toBeDefined();
    }
  });

  it('configures every rule kind', () => {
    const config = loadConfig();
    for (const kind of ruleKindSchema.options) {
      expect(config.rules.kinds[kind], `rule ${kind}`).toBeDefined();
    }
  });

  it('sets a merge policy for every conflict in the catalogue C1..C37', () => {
    const config = loadConfig();
    for (const id of conflictIdSchema.options) {
      expect(config.versionControl.merge.policies[id], `conflict ${id}`).toBeDefined();
    }
  });

  it('protects the default branch', () => {
    const config = loadConfig();
    expect(config.versionControl.protectedBranches).toContain(config.versionControl.defaultBranch);
  });

  it('selects a backend for every analysis kind', () => {
    const config = loadConfig();
    expect(config.simulation.backends.op).toBeDefined();
    expect(config.simulation.backends.transient).toBeDefined();
  });
});

describe('config validation fails fast', () => {
  it('rejects an unknown top-level key', () => {
    const raw = { ...rawConfig(), somethingUnexpected: true };
    expect(() => parseConfig(raw)).toThrow(ConfigValidationError);
  });

  it('rejects a missing LLM job', () => {
    const raw = rawConfig();
    const llm = raw['llm'] as { jobs: Record<string, unknown> };
    delete llm.jobs['blind_verifier'];
    expect(() => parseConfig(raw)).toThrow(/blind_verifier/);
  });

  it('rejects a missing merge policy', () => {
    const raw = rawConfig();
    const vc = raw['versionControl'] as { merge: { policies: Record<string, unknown> } };
    delete vc.merge.policies['C24'];
    expect(() => parseConfig(raw)).toThrow(/C24/);
  });

  it('rejects an out-of-range tolerance', () => {
    const raw = rawConfig();
    (raw['comparator'] as Record<string, unknown>)['relativeTolerance'] = 5;
    expect(() => parseConfig(raw)).toThrow(ConfigValidationError);
  });

  it('rejects a transient step larger than its stop time', () => {
    const raw = rawConfig();
    const sim = raw['simulation'] as { transient: Record<string, unknown> };
    sim.transient['defaultStepSeconds'] = 10;
    expect(() => parseConfig(raw)).toThrow(/step must be smaller/);
  });

  it('reports every issue, not just the first', () => {
    const raw = rawConfig();
    (raw['comparator'] as Record<string, unknown>)['relativeTolerance'] = 5;
    (raw['eval'] as Record<string, unknown>)['datasetSize'] = -1;
    try {
      parseConfig(raw);
      expect.unreachable('expected validation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect((error as ConfigValidationError).issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});
