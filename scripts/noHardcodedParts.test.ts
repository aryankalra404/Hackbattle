import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { repoRoot } from '@circuitgit/schema/node';

/**
 * Non-negotiable rule 1: nothing part-specific in engine code.
 *
 * Pins, polarity, ratings, SPICE models, state rules, visuals and footprints all
 * live in part definition files. If a part ID or part name leaks into an engine
 * as a string literal, the engine has stopped being generic and this test fails.
 *
 * This is a test file, so naming parts here is allowed and expected.
 */

const ENGINE_DIRS = ['packages/core', 'packages/rules', 'packages/sim', 'packages/llm'];

/** Part-name stems that must never appear as a string literal in engine code. */
const RESERVED_PART_WORDS = [
  'led',
  'resistor',
  'potentiometer',
  'diode',
  'capacitor',
  'electrolytic',
  'ceramic',
  'battery',
  'switch',
  'pushbutton',
  'transistor',
  'npn',
  'buzzer',
  '555',
  'timer',
  'breadboard',
  'arduino',
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']);

function isTestFile(path: string): boolean {
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || /(^|[\\/])(__tests__|fixtures)[\\/]/.test(path)
  );
}

function sourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return []; // package not built yet
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (SOURCE_EXTENSIONS.has(extname(entry)) && !isTestFile(full)) {
      found.push(full);
    }
  }
  return found;
}

/** String and template literals, with their 1-based line numbers. */
function stringLiterals(source: string): { value: string; line: number }[] {
  const pattern = /'([^'\\\n]|\\.)*'|"([^"\\\n]|\\.)*"|`([^`\\]|\\.)*`/g;
  const literals: { value: string; line: number }[] = [];
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    literals.push({
      value: match[0].slice(1, -1),
      line: source.slice(0, index).split('\n').length,
    });
  }
  return literals;
}

/** Part IDs declared by the part library, once packages/parts exists. */
function libraryPartWords(): string[] {
  const partsDir = join(repoRoot(), 'packages/parts/parts');
  let files: string[];
  try {
    files = readdirSync(partsDir);
  } catch {
    return []; // part library not built yet (pre-P1)
  }
  const words = new Set<string>();
  for (const file of files) {
    if (!/\.ya?ml$/.test(file)) continue;
    const idLine = readFileSync(join(partsDir, file), 'utf8').match(/^id:\s*(\S+)/m);
    const id = idLine?.[1];
    if (!id) continue;
    for (const token of id.toLowerCase().split(/[^a-z0-9]+/)) {
      if (token.length > 1) words.add(token);
    }
  }
  return [...words];
}

describe('engines contain no part-specific literals', () => {
  const forbidden = [...new Set([...RESERVED_PART_WORDS, ...libraryPartWords()])];
  const wordPattern = new RegExp(`(^|[^a-z0-9])(${forbidden.join('|')})([^a-z0-9]|$)`, 'i');

  for (const dir of ENGINE_DIRS) {
    it(`${dir} has no hard-coded part names`, () => {
      const root = repoRoot();
      const violations: string[] = [];

      for (const file of sourceFiles(join(root, dir))) {
        const source = readFileSync(file, 'utf8');
        for (const literal of stringLiterals(source)) {
          const match = wordPattern.exec(literal.value);
          if (match) {
            violations.push(
              `${relative(root, file)}:${literal.line} contains part name "${match[2]}" ` +
                `in the literal ${JSON.stringify(literal.value)}`,
            );
          }
        }
      }

      expect(violations, violations.join('\n')).toEqual([]);
    });
  }

  it('knows which words are reserved', () => {
    // Guards the guard: an empty forbidden list would make the checks above vacuous.
    expect(forbidden.length).toBeGreaterThan(0);
  });
});
