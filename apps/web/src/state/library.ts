import { PartLibrary, parseYamlEntries } from '@circuitgit/parts';
import { parseConfig, type CircuitGitConfig } from '@circuitgit/schema';
import { parse as parseYaml } from 'yaml';

/**
 * Browser-side loading of the part library, symbols and config.
 *
 * The YAML files are the same ones the Node loader reads; Vite inlines them at
 * build time so the browser and the server validate identical data through
 * identical schemas.
 */

const partFiles = import.meta.glob('../../../../packages/parts/parts/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const symbolFiles = import.meta.glob('../../../../packages/parts/symbols/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const configFile = import.meta.glob('../../../../config/default.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

export const partLibrary: PartLibrary = PartLibrary.fromRaw(
  parseYamlEntries(
    Object.entries(partFiles)
      .map(([path, text]) => ({ source: basename(path), text }))
      .sort((a, b) => a.source.localeCompare(b.source)),
  ),
);

/** Symbol markup keyed by the `visual.symbol2d` path in a part definition. */
export const partSymbols: Record<string, string> = Object.fromEntries(
  Object.entries(symbolFiles).map(([path, svg]) => [`symbols/${basename(path)}`, svg]),
);

const rawConfig = Object.values(configFile)[0];
if (!rawConfig) throw new Error('config/default.yaml was not bundled');

/** Validated with the same schema the server uses. Fails fast on a bad config. */
export const config: CircuitGitConfig = parseConfig(parseYaml(rawConfig), 'config/default.yaml');
