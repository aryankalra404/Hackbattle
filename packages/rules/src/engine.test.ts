import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { emptySnapshot, pinParamKey, pinRef, type CircuitSnapshot } from '@circuitgit/schema';
import { loadConfig } from '@circuitgit/schema/node';
import { defaultParams } from '@circuitgit/parts';
import { loadPartLibraryFromDisk } from '@circuitgit/parts/node';
import { runTopologyChecks } from './engine.js';

/**
 * Topology checks against real library parts. Naming parts is fine here: this
 * is a test file. The engine under test never sees these names.
 */

const library = loadPartLibraryFromDisk();
const config = loadConfig();

class Bench {
  readonly snapshot: CircuitSnapshot = emptySnapshot('bench');

  add(partId: string, label: string, params: Record<string, number | string | boolean> = {}) {
    const id = randomUUID();
    const part = library.get(partId);
    this.snapshot.components[id] = {
      part: `${part.id}@${part.version}`,
      label,
      params: { ...defaultParams(part), ...params },
    };
    return id;
  }

  wire(a: [string, string], b: [string, string]) {
    this.snapshot.wires[randomUUID()] = { a: pinRef(...a), b: pinRef(...b), style: {} };
  }

  ground(component: string, pin: string) {
    this.snapshot.settings.ground = pinRef(component, pin);
  }

  findings(kind?: string) {
    const all = runTopologyChecks({ snapshot: this.snapshot, library, config }).findings;
    return kind ? all.filter((finding) => finding.kind === kind) : all;
  }
}

const mode = (pin: string) => pinParamKey('pinModes', pin, 'mode');

describe('a circuit built on a breadboard', () => {
  /** Supply rails -> resistor in row 10 -> LED from row 14 to the ground rail. */
  function working() {
    const bench = new Bench();
    const bb = bench.add('breadboard-full', 'BB1');
    const v1 = bench.add('dc-supply', 'V1');
    const r1 = bench.add('resistor', 'R1');
    const d1 = bench.add('led-5mm', 'D1');

    bench.wire([v1, 'pos'], [bb, 'power_pos_top_1']);
    bench.wire([v1, 'neg'], [bb, 'power_neg_top_1']);
    bench.wire([r1, 'a'], [bb, 'power_pos_top_10']);
    bench.wire([r1, 'b'], [bb, 'row14_a']);
    bench.wire([d1, 'anode'], [bb, 'row14_c']);
    bench.wire([d1, 'cathode'], [bb, 'power_neg_top_12']);
    bench.ground(v1, 'neg');
    return { bench, bb, v1, r1, d1 };
  }

  it('passes every topology check', () => {
    expect(working().bench.findings()).toEqual([]);
  });

  it('never reports empty holes as floating or the board as ungrounded', () => {
    const { bench, bb } = working();
    const aboutBoard = bench.findings().filter((finding) => finding.componentIds.includes(bb));
    expect(aboutBoard).toEqual([]);
  });

  it('flags a lead alone in a row as unconnected', () => {
    const { bench, bb, d1 } = working();
    // Move the LED anode one row over: wired, but to nothing.
    for (const [id, wire] of Object.entries(bench.snapshot.wires)) {
      if (wire.a === pinRef(d1, 'anode')) {
        bench.snapshot.wires[id] = { ...wire, b: pinRef(bb, 'row15_c') };
      }
    }
    const findings = bench.findings('unconnected_required_pin');
    expect(findings.flatMap((finding) => finding.pinIds)).toContain(pinRef(d1, 'anode'));
  });

  it('flags two leads in one hole', () => {
    const { bench, bb, d1 } = working();
    const d2 = bench.add('led-5mm', 'D2');
    bench.wire([d2, 'anode'], [bb, 'row14_c']);
    bench.wire([d2, 'cathode'], [bb, 'power_neg_top_20']);

    const [finding] = bench.findings('hole_occupancy');
    expect(finding?.pinIds).toContain(pinRef(bb, 'row14_c'));
    expect(finding?.componentIds).toEqual(expect.arrayContaining([d1, d2]));
  });

  it('flags a return lead in a rail marked for power, at convention severity', () => {
    const { bench, bb, v1 } = working();
    for (const [id, wire] of Object.entries(bench.snapshot.wires)) {
      if (wire.a === pinRef(v1, 'neg'))
        bench.snapshot.wires[id] = { ...wire, b: pinRef(bb, 'power_pos_bottom_1') };
    }
    const findings = bench.findings('pin_function_mismatch');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe(config.rules.conventionSeverity);
    expect(findings[0]?.message).toMatch(/marked power/);
  });
});

describe('pin_function_mismatch', () => {
  function board(modes: Record<string, string> = {}) {
    const bench = new Bench();
    const params = Object.fromEntries(
      Object.entries(modes).map(([pin, value]) => [mode(pin), value]),
    );
    const u1 = bench.add('arduino-uno-r3', 'U1', params);
    bench.ground(u1, 'gnd1');
    return { bench, u1 };
  }

  it('catches pwm on a pin that cannot do pwm', () => {
    const { bench, u1 } = board({ d2: 'pwm' });
    const [finding] = bench.findings('pin_function_mismatch');
    expect(finding?.pinIds).toEqual([pinRef(u1, 'd2')]);
    expect(finding?.severity).toBe(config.rules.kinds.pin_function_mismatch?.severity);
    expect(finding?.message).toMatch(/cannot do pwm/);
  });

  it('accepts pwm on a pin that can', () => {
    const { bench } = board({ d3: 'pwm' });
    expect(bench.findings('pin_function_mismatch')).toEqual([]);
  });

  it('catches analog input on a digital-only pin', () => {
    const { bench, u1 } = board({ d7: 'analog_in' });
    expect(bench.findings('pin_function_mismatch').flatMap((finding) => finding.pinIds)).toEqual([
      pinRef(u1, 'd7'),
    ]);
  });

  it('catches an output wired straight into a ground pin', () => {
    const { bench, u1 } = board({ d4: 'digital_out' });
    bench.wire([u1, 'd4'], [u1, 'gnd2']);
    const findings = bench.findings('pin_function_mismatch');
    expect(findings.map((finding) => finding.message).join()).toMatch(/wired straight into/);
  });

  it('catches the same through a breadboard rail', () => {
    const { bench, u1 } = board({ d9: 'pwm' });
    const bb = bench.add('breadboard-full', 'BB1');
    bench.wire([u1, 'gnd1'], [bb, 'power_neg_top_1']);
    bench.wire([u1, 'd9'], [bb, 'power_neg_top_2']);
    const findings = bench.findings('pin_function_mismatch');
    expect(findings.map((finding) => finding.message).join()).toMatch(/wired straight into/);
    // The error says it all; no second, convention-level note about the same pin.
    expect(findings).toHaveLength(1);
  });

  it('notes an output in a rail marked ground when nothing powers the rail', () => {
    const { bench, u1 } = board({ d9: 'pwm' });
    const bb = bench.add('breadboard-full', 'BB1');
    bench.wire([u1, 'd9'], [bb, 'power_neg_top_2']);
    const [finding] = bench.findings('pin_function_mismatch');
    expect(finding?.severity).toBe(config.rules.conventionSeverity);
    expect(finding?.message).toMatch(/marked ground/);
  });

  it('catches two outputs fighting over one net', () => {
    const { bench, u1 } = board({ d5: 'digital_out', d6: 'pwm' });
    bench.wire([u1, 'd5'], [u1, 'd6']);
    const messages = bench.findings('pin_function_mismatch').map((finding) => finding.message);
    expect(messages.join()).toMatch(/all outputs driving the same net/);
  });

  it('leaves an output through a resistor alone', () => {
    const { bench, u1 } = board({ d3: 'pwm' });
    const r1 = bench.add('resistor', 'R1');
    bench.wire([u1, 'd3'], [r1, 'a']);
    bench.wire([r1, 'b'], [u1, 'gnd1']);
    expect(bench.findings('pin_function_mismatch')).toEqual([]);
  });
});

describe('optional pins', () => {
  it('lets unused header pins sit unconnected', () => {
    const bench = new Bench();
    const u1 = bench.add('arduino-uno-r3', 'U1');
    bench.ground(u1, 'gnd1');
    expect(bench.findings('floating_pin')).toEqual([]);
  });

  it('flags a pin given a job but left unwired', () => {
    const bench = new Bench();
    const u1 = bench.add('arduino-uno-r3', 'U1', { [mode('d3')]: 'pwm' });
    bench.ground(u1, 'gnd1');
    expect(bench.findings('floating_pin').flatMap((finding) => finding.pinIds)).toEqual([
      pinRef(u1, 'd3'),
    ]);
  });
});
