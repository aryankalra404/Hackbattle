import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { CircuitGitConfig } from './config.js';
import { parseConfig } from './parseConfig.js';

/**
 * Node-only config loading.
 *
 * Kept out of the package barrel so a browser bundle never pulls `node:fs` in.
 * Import it as `@circuitgit/schema/node`.
 */

/**
 * Repo root, derived from this file's location rather than process.cwd(), so the
 * loader behaves the same from a test, an app, or a script.
 */
export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
}

export function defaultConfigPath(): string {
  return resolve(repoRoot(), 'config/default.yaml');
}

/**
 * Read and validate config from disk. Fails fast: an invalid or missing file
 * throws rather than falling back to defaults, because a silently wrong
 * tolerance or model ID would corrupt every downstream check.
 */
export function loadConfig(path = defaultConfigPath()): CircuitGitConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(`Could not read CircuitGit config at ${path}`, { cause });
  }

  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (cause) {
    throw new Error(`Could not parse YAML in CircuitGit config at ${path}`, { cause });
  }

  return parseConfig(raw, path);
}

let cached: CircuitGitConfig | undefined;

/** Process-wide config, loaded once. */
export function getConfig(): CircuitGitConfig {
  cached ??= loadConfig();
  return cached;
}

/** Test-only escape hatch so a suite can point at a fixture config. */
export function setConfigForTesting(config: CircuitGitConfig | undefined): void {
  cached = config;
}
