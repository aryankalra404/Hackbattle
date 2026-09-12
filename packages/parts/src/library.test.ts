import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'node:fs';
import { isInterconnect, partDefinitionSchema, pinParamKey } from '@circuitgit/schema';
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
      'breadboard-full',
      'arduino-uno-r3',
    ]) {
      expect(library.has(id), `missing part ${id}`).toBe(true);
    }
  });

  it('cites a source for every part', () => {
    for (const part of library.all()) {
      expect(part.source.length, `${part.id} has no source citation`).toBeGreaterThan(40);
    }
  });

  it('gives every part with an electrical model at least one rating', () => {
    // A pure interconnect has no element of its own, so nothing to rate.
    for (const part of library.all().filter((candidate) => !isInterconnect(candidate))) {
      expect(part.ratings.length, `${part.id} declares no ratings`).toBeGreaterThan(0);
    }
  });

  it('gives every part a resolvable symbol file', () => {
    const symbols = resolve(partsDirectory(), '../');
    for (const part of library.all()) {
      expect(existsSync(join(symbols, part.visual.symbol2d.path)), `${part.id} symbol`).toBe(true);
    }
  });

  it('gives every part a 3D model or a labelled placeholder, with provenance', () => {
    for (const part of library.all()) {
      const { symbol2d, model3d } = part.visual;
      expect(model3d.path ?? model3d.placeholder, `${part.id} 3D model`).toBeTruthy();
      for (const asset of [symbol2d, model3d]) {
        expect(asset.source.length, `${part.id} asset source`).toBeGreaterThan(0);
        expect(asset.license, `${part.id} asset licence`).toBeTruthy();
      }
    }
  });

  it('says what every pin electrically is', () => {
    for (const part of library.all()) {
      for (const pin of part.pins) {
        expect(pin.functions.length, `${part.id}.${pin.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('resolves every power pin voltage it declares', () => {
    for (const part of library.all()) {
      const params = defaultParams(part);
      for (const pin of part.pins.filter((candidate) => candidate.voltage !== undefined)) {
        const voltage =
          pin.voltage === undefined ? undefined : resolveNumber(pin.voltage, config, params);
        expect(voltage, `${part.id}.${pin.id}`).toBeTypeOf('number');
      }
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

describe('expansion', () => {
  const board = library.get('arduino-uno-r3');

  it('expands a pin map into one scalar param per pin and field', () => {
    const map = board.pinMaps['pinModes'];
    expect(map?.fields).toEqual(['mode', 'value']);
    // Every pin that can be a signal gets a mode; power and ground pins do not.
    expect(map?.pins).toContain('d3');
    expect(map?.pins).toContain('a0');
    expect(map?.pins).not.toContain('gnd1');
    const mode = board.params[pinParamKey('pinModes', 'd3', 'mode')];
    expect(mode?.type).toBe('enum');
    expect(mode?.pin).toBe('d3');
  });

  it('expands an eachPin rating into one rating per selected pin', () => {
    const perPin = board.ratings.filter((rating) => rating.pin && rating.quantity === 'current');
    // 20 I/O pins, plus the separately rated 3.3 V pin.
    expect(perPin.map((rating) => rating.pin)).toContain('d13');
    expect(perPin.length).toBe(21);
  });

  it('generates breadboard holes with a grid position and one-lead capacity', () => {
    const breadboard = library.get('breadboard-full');
    const hole = breadboard.pins.find((pin) => pin.id === 'row1_a');
    expect(hole?.maxConnections).toBe(1);
    expect(hole?.optional).toBe(true);
    expect(breadboard.pinLayout['row1_a']).toEqual([1.5, 5]);
    // Rails leave a gap after every fifth hole.
    expect(breadboard.pinLayout['power_pos_top_6']).toEqual([3.5 + 6, 1.5]);
    // Every generated position lies inside the declared grid.
    const [width, height] = breadboard.footprint.gridSize ?? [0, 0];
    for (const [x, y] of Object.values(breadboard.pinLayout)) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(width);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(height);
    }
  });
});

describe('schema rejects', () => {
  const resistorYaml = readFileSync(join(partsDirectory(), 'resistor.yaml'), 'utf8');
  const base = () =>
    parseYaml(resistorYaml) as Record<string, unknown> & {
      pins: Record<string, unknown>[];
      visual: Record<string, Record<string, unknown>>;
    };
  const errorsOf = (data: unknown) => {
    const result = partDefinitionSchema.safeParse(data);
    return result.success ? [] : result.error.errors.map((issue) => issue.message);
  };

  it('accepts the unmodified fixture', () => {
    expect(errorsOf(base())).toEqual([]);
  });

  it('a voltage on a pin that is not a power pin', () => {
    const data = base();
    data.pins[0] = { ...data.pins[0], voltage: 5 };
    expect(errorsOf(data).join()).toMatch(/not a power pin/);
  });

  it('an unknown pin function', () => {
    const data = base();
    data.pins[0] = { ...data.pins[0], functions: ['telepathy'] };
    expect(errorsOf(data).length).toBeGreaterThan(0);
  });

  it('a CC-BY asset with no attribution line', () => {
    const data = base();
    data.visual['symbol2d'] = { ...data.visual['symbol2d'], license: 'CC-BY-4.0' };
    expect(errorsOf(data).join()).toMatch(/requires an attribution/);
  });

  it('a part with no 3D model or placeholder', () => {
    const data = base();
    data.visual['model3d'] = { source: 'procedural', license: 'internal' };
    expect(errorsOf(data).join()).toMatch(/path \/ placeholder/);
  });

  it('an interconnect that leaves a pin out of every group', () => {
    const data = base();
    delete data['spice'];
    data['ratings'] = [];
    expect(errorsOf(data).join()).toMatch(/must group every pin/);
  });

  it('a pin in two internal groups', () => {
    const data = base();
    data['internalGroups'] = [
      { type: 'pins', pins: ['a', 'b'] },
      { type: 'pins', pins: ['b', 'a'] },
    ];
    expect(errorsOf(data).join()).toMatch(/more than one internal group/);
  });

  it('a pin mode that is not one of the enum values', () => {
    const data = base();
    data['params'] = {
      ...(data['params'] as object),
      use: {
        type: 'enum',
        label: 'Use',
        pin: 'a',
        values: ['off', 'on'],
        default: 'off',
        modes: { blink: { requires: 'pwm' } },
      },
    };
    expect(errorsOf(data).join()).toMatch(/mode "blink" is not one of the values/);
  });
});
