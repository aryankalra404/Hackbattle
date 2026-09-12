import { parse as parseYaml } from 'yaml';

export * from './library.js';
export * from './assets.js';

/** Parse YAML part-definition sources into raw objects for `PartLibrary.fromRaw`. */
export function parseYamlEntries(
  files: readonly { source: string; text: string }[],
): { source: string; data: unknown }[] {
  return files.map((file) => {
    try {
      return { source: file.source, data: parseYaml(file.text) as unknown };
    } catch (cause) {
      throw new Error(`Could not parse YAML in part definition ${file.source}`, { cause });
    }
  });
}
