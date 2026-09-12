import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from '@circuitgit/schema/node';
import { loadPartLibraryFromDisk, partsDirectory } from './node.js';
import { defaultParams, resolveNumber } from './library.js';

const library = loadPartLibraryFromDisk();
const config = loadConfig();

describe('part library', () => {
  it('loads and validates every definition on disk', () => {
    expect(library.all().length).toBeGreaterThanOrEqual(12);
  });

  it('covers the initial part list from the build prompt', () => {
    // Naming parts is fine here: this is a test file, not engine code.
    for (const id of [
      'dc-supply',
      'resistor',
      'potentiometer',
      'led-5mm',
      'diode-1n4148',
      'capacitor-ceramic',
      'capacitor-electrolytic',
      'switch-spst',
      'pushbutton',
      'transistor-2n3904',
      'timer-ne555',
      'buzzer-piezo',
    ]) {
      expect(library.has(id), `missing part ${id}`).toBe(true);
    }
  });

  it('cites a source for every part', () => {
    for (const part of library.all()) {
      expect(part.source.length, `${part.id} has no source citation`).toBeGreaterThan(40);
    }
  });

  it('gives every part at least one rating for the generic rating check', () => {
    for (const part of library.all()) {
      expect(part.ratings.length, `${part.id} declares no ratings`).toBeGreaterThan(0);
    }
  });

  it('gives every part a resolvable symbol file', () => {
    const symbols = resolve(partsDirectory(), '../');
    for (const part of library.all()) {
      expect(existsSync(join(symbols, part.visual.symbol2d)), `${part.id} symbol`).toBe(true);
    }
  });

  it('resolves every rating limit to a number', () => {
    for (const part of library.all()) {
      const params = defaultParams(part);
      for (const rating of part.ratings) {
        const limit = resolveNumber(rating.max, config, params);
        expect(limit, `${part.id} rating ${rating.quantity}`).toBeTypeOf('number');
      }
    }
  });

  it('resolves every state threshold, including config refs', () => {
    for (const part of library.all()) {
      const params = defaultParams(part);
      for (const state of part.states) {
        const bound = state.when?.gt ?? state.when?.lt;
        if (bound === undefined) continue;
        expect(resolveNumber(bound, config, params), `${part.id} state ${state.state}`).toBeTypeOf(
          'number',
        );
      }
    }
  });

  it('marks polarized parts so the generic polarity check can find them', () => {
    const polarized = library.all().filter((part) => part.polarized);
    expect(polarized.length).toBeGreaterThan(0);
    for (const part of polarized) {
      const pins = new Set(part.pins.map((pin) => pin.id));
      expect(pins.has(part.polarized?.positive ?? '')).toBe(true);
      expect(pins.has(part.polarized?.negative ?? '')).toBe(true);
    }
  });

  it('gives every part unique pin ids', () => {
    for (const part of library.all()) {
      const ids = part.pins.map((pin) => pin.id);
      expect(new Set(ids).size, `${part.id} has duplicate pins`).toBe(ids.length);
    }
  });

  it('groups parts into categories for the palette', () => {
    const categories = library.categories();
    expect(categories.length).toBeGreaterThan(1);
    const total = categories.reduce((sum, group) => sum + group.parts.length, 0);
    expect(total).toBe(library.all().length);
  });

  it('rejects an unknown part reference', () => {
    expect(() => library.get('not-a-real-part')).toThrow(/Unknown part/);
  });
});

describe('default params', () => {
  it('produces a value for every declared param', () => {
    for (const part of library.all()) {
      const params = defaultParams(part);
      expect(Object.keys(params).sort()).toEqual(Object.keys(part.params).sort());
    }
  });
});
