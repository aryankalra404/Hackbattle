import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '@circuitgit/schema/node';
import { boardDef, endpointFor, isBoardPin, PART_DEFS, partDef } from '../parts/catalog.js';
import {
  BOARD_NODE_ID,
  componentEntry,
  connectionError,
  nextComponentId,
  resolveEndpoint,
  toCanvas,
  toWorld,
} from './circuitModel.js';
import type { QuestCircuit } from './QuestBridgeContext.js';

/**
 * The canvas is only useful if a circuit built in the browser is the same
 * document a circuit built on the headset is. These tests hold that line at
 * both ends: the drawn pins have to sit on their artwork, and the JSON the
 * canvas produces has to drive the server's real LED simulator.
 */

function led(): ReturnType<typeof partDef> {
  return partDef('led');
}

describe('part catalog', () => {
  it('keeps every drawn terminal inside its own artwork', () => {
    for (const def of PART_DEFS) {
      const [width, height] = def.viewBox;
      for (const hole of def.holes) {
        expect(hole.x, `${def.type}.${hole.handle} x`).toBeGreaterThanOrEqual(0);
        expect(hole.x, `${def.type}.${hole.handle} x`).toBeLessThanOrEqual(width);
        expect(hole.y, `${def.type}.${hole.handle} y`).toBeGreaterThanOrEqual(0);
        expect(hole.y, `${def.type}.${hole.handle} y`).toBeLessThanOrEqual(height);
      }
    }
  });

  it('gives every part drawing a unique handle per hole', () => {
    for (const def of PART_DEFS) {
      const handles = def.holes.map((hole) => hole.handle);
      expect(new Set(handles).size, def.type).toBe(handles.length);
    }
  });

  it('draws every board pin a sketch can address', () => {
    // The pins `simulateSketch` normalizes to and the rules engine treats as
    // supply or ground — all of them need a hole to wire to.
    for (const pin of ['D13', 'D9', 'A0', 'GND', '5V', '3.3V', 'VIN']) {
      expect(isBoardPin(pin), pin).toBe(true);
    }
  });

  it('spaces the Uno header holes at one pitch', () => {
    const top = boardDef.holes
      .filter((hole) => hole.y < boardDef.viewBox[1] / 2)
      .map((hole) => hole.x)
      .sort((a, b) => a - b);

    // Neighbouring holes are one 0.1" pitch apart, except across the single
    // gap the Uno leaves between D8 and D7.
    const gaps = top.slice(1).map((x, index) => x - (top[index] as number));
    const pitch = Math.min(...gaps);
    expect(gaps.filter((gap) => gap > pitch * 1.4)).toHaveLength(1);
  });
});

describe('canvas <-> world positions', () => {
  it('round-trips a dragged position exactly', () => {
    const at = { x: 742, y: 318 };
    expect(toCanvas(toWorld(at))).toEqual(at);
  });
});

describe('circuit payload', () => {
  it('names terminals the way the headset does', () => {
    const def = led();
    if (!def) throw new Error('fixture: no led in the catalog');
    const entry = componentEntry(def, 'led-1', { x: 0, y: 0 });

    expect(entry.id).toBe('led-1');
    expect(entry.type).toBe('led');
    expect(entry['anode']).toBe('led-1-anode');
    expect(entry['cathode']).toBe('led-1-cathode');
    expect(entry.pos).toBeDefined();
  });

  it('continues the numbering already in the circuit', () => {
    const circuit: QuestCircuit = {
      components: [
        { id: 'led-1', type: 'led' },
        { id: 'led-4', type: 'led' },
        { id: 'resistor-1', type: 'resistor' },
      ],
    };
    expect(nextComponentId(circuit, 'led')).toBe('led-5');
    expect(nextComponentId(circuit, 'resistor')).toBe('resistor-2');
    expect(nextComponentId(null, 'capacitor')).toBe('capacitor-1');
  });

  it('gives a tactile switch one electrical name for each doubled leg', () => {
    const def = partDef('push-button');
    if (!def) throw new Error('fixture: no push-button in the catalog');
    const names = def.holes.map((hole) => endpointFor(def, 'push-button-1', hole));
    expect(new Set(names)).toEqual(new Set(['push-button-1-a', 'push-button-1-b']));
  });
});

describe('endpoint resolution', () => {
  const components = [
    { id: 'led-1', type: 'led' },
    { id: 'resistor-1', type: 'resistor' },
  ];

  it('finds a component terminal', () => {
    const end = resolveEndpoint('led-1-anode', components);
    expect(end.node).toBe('led-1');
    expect(end.hole?.handle).toBe('anode');
  });

  it('finds a board pin by its bare name', () => {
    const end = resolveEndpoint('D13', components);
    expect(end.node).toBe(BOARD_NODE_ID);
    expect(end.hole?.pin).toBe('D13');
  });

  it('keeps a wire on the ground hole it was drawn to', () => {
    const grounds = boardDef.holes.filter((hole) => hole.pin === 'GND');
    expect(grounds.length).toBeGreaterThan(1);

    const second = grounds[1];
    if (!second) throw new Error('fixture: the board needs two grounds');
    expect(resolveEndpoint('GND', components, second.handle).hole?.handle).toBe(second.handle);
    // With no hint it falls back to the first one rather than dropping the wire.
    expect(resolveEndpoint('GND', components).hole).toBeDefined();
  });
});

describe('connection rules', () => {
  const def = partDef('led');
  const resistor = partDef('resistor');
  if (!def || !resistor) throw new Error('fixture: catalog is missing a part');

  const anode = def.holes[0];
  const cathode = def.holes[1];
  const resistorA = resistor.holes[0];
  const gnd = boardDef.holes.find((hole) => hole.pin === 'GND');
  const d13 = boardDef.holes.find((hole) => hole.pin === 'D13');
  if (!anode || !cathode || !resistorA || !gnd || !d13) {
    throw new Error('fixture: catalog is missing a hole');
  }

  const led1Anode = { endpoint: 'led-1-anode', node: 'led-1', hole: anode };
  const led1Cathode = { endpoint: 'led-1-cathode', node: 'led-1', hole: cathode };
  const res1A = { endpoint: 'resistor-1-a', node: 'resistor-1', hole: resistorA };
  const boardGnd = { endpoint: 'GND', node: BOARD_NODE_ID, hole: gnd };
  const boardD13 = { endpoint: 'D13', node: BOARD_NODE_ID, hole: d13 };

  it('allows a fresh wire between two parts', () => {
    expect(connectionError({ wires: [] }, led1Anode, res1A)).toBeNull();
  });

  it('refuses to wire a part to itself', () => {
    expect(connectionError({ wires: [] }, led1Anode, led1Cathode)).toMatch(/same part/i);
  });

  it('refuses the same pair twice, drawn either way round', () => {
    const circuit: QuestCircuit = { wires: [{ from: 'resistor-1-a', to: 'led-1-anode' }] };
    expect(connectionError(circuit, led1Anode, res1A)).toMatch(/already wired/i);
  });

  it('gives a signal terminal one wire', () => {
    const circuit: QuestCircuit = { wires: [{ from: 'D13', to: 'resistor-1-a' }] };
    expect(connectionError(circuit, boardD13, led1Anode)).toMatch(/already has a wire/i);
  });

  it('lets ground take as many wires as land on it', () => {
    // `PinPoint.AllowsSharedConnections` — a rail is one shared node.
    const circuit: QuestCircuit = {
      wires: [
        { from: 'GND', to: 'led-1-cathode' },
        { from: 'GND', to: 'resistor-1-b' },
      ],
    };
    expect(connectionError(circuit, boardGnd, res1A)).toBeNull();
  });
});

describe('a browser-built circuit drives the real server simulator', () => {
  // The same module `socket-server/server.js` runs on `code:simulate`, loaded
  // here directly so this asserts against the actual behaviour rather than a
  // restatement of it.
  const require = createRequire(import.meta.url);
  const { simulateSketch } = require(
    join(repoRoot(), 'socket-server', 'simulate', 'simulateSketch.js'),
  ) as {
    simulateSketch: (
      circuit: unknown,
      code: string,
    ) => { ok: boolean; leds: { ledId: string; pin: string; pattern: string; onMs?: number }[] };
  };

  /** D13 -> resistor -> LED -> GND, exactly as the palette and the canvas would build it. */
  function blinkCircuit(): QuestCircuit {
    const ledDef = partDef('led');
    const resistorDef = partDef('resistor');
    if (!ledDef || !resistorDef) throw new Error('fixture: catalog is missing a part');

    return {
      components: [
        componentEntry(ledDef, 'led-1', { x: 420, y: 260 }),
        componentEntry(resistorDef, 'resistor-1', { x: 260, y: 260 }),
      ],
      wires: [
        { from: 'D13', to: 'resistor-1-a' },
        { from: 'resistor-1-b', to: 'led-1-anode' },
        { from: 'led-1-cathode', to: 'GND' },
      ],
      board: { pos: { x: 0, y: 0, z: 0 } },
    };
  }

  const sketch = `
    void setup() { pinMode(13, OUTPUT); }
    void loop() {
      digitalWrite(13, HIGH);
      delay(500);
      digitalWrite(13, LOW);
      delay(500);
    }
  `;

  it('blinks the LED the canvas wired to D13 through a resistor', () => {
    const result = simulateSketch(blinkCircuit(), sketch);

    expect(result.ok).toBe(true);
    expect(result.leds).toHaveLength(1);
    expect(result.leds[0]).toMatchObject({ ledId: 'led-1', pin: 'D13', pattern: 'blink', onMs: 500 });
  });

  it('finds no LED once the wire to the board is pulled', () => {
    const circuit = blinkCircuit();
    circuit.wires = (circuit.wires ?? []).filter((wire) => wire.from !== 'D13');

    expect(simulateSketch(circuit, sketch).leds).toHaveLength(0);
  });
});
