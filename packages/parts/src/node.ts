import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PartLibrary } from './library.js';
import { parseYamlEntries } from './index.js';

/**
 * Disk loader for Node contexts (tests, the API service, scripts).
 * The browser loads the same YAML through Vite's glob import instead, so both
 * paths end at `PartLibrary.fromRaw` and validate identically.
 */

export function partsDirectory(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../parts');
}

export function loadPartLibraryFromDisk(directory = partsDirectory()): PartLibrary {
  const files = readdirSync(directory)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => ({ source: name, text: readFileSync(join(directory, name), 'utf8') }));

  if (files.length === 0) {
    throw new Error(`No part definitions found in ${directory}`);
  }
  return PartLibrary.fromRaw(parseYamlEntries(files));
}
