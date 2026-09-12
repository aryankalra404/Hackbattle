import arduinoArt from './assets/arduino.svg?raw';
import ledArt from './assets/led.svg?raw';
import resistorArt from './assets/resistor.svg?raw';
import capacitorArt from './assets/capacitor.svg?raw';
import potentiometerArt from './assets/potentiometer.svg?raw';
import pushButtonArt from './assets/push-button.svg?raw';
import ultrasonicArt from './assets/ultrasonic.svg?raw';
import dcMotorArt from './assets/dc-motor.svg?raw';
import propellorArt from './assets/propellor.svg?raw';

/**
 * The wirable part catalog, drawn with the project's own artwork
 * (`web/public/svgs`, copied into `./assets` so Vite bundles it with this app).
 *
 * Every hole position below is measured from the artwork itself — the bounding
 * box of the leg/lead/header-hole path in the file — and stored in that file's
 * own viewBox units, so a part stays pinned to its drawing at any render size.
 *
 * Pin naming follows the two sources this app has to agree with:
 *   - `socket-server/unity-scripts/CircuitComponent.cs`, which labels a spawned
 *     part's terminals `<id>-anode`/`-cathode`, `<id>-a`/`-b`,
 *     `<id>-vcc`/`-signal`/`-gnd`, and gives board holes a bare electrical name
 *     (`PinPoint.pinId`, "e.g. D13, GND, 5V");
 *   - `packages/parts/parts/*.yaml`, whose pin ids (`anode`/`cathode`, `a`/`b`,
 *     `pos`/`neg`, `wiper`) the rest of CircuitGit already uses.
 */

/**
 * Mirrors `PinPoint.PinType` + `AllowsSharedConnections()`: ground and supply
 * rails are shared electrical nodes that several parts legitimately land on,
 * while signal and passive terminals take a single wire.
 */
export type HoleKind = 'signal' | 'power' | 'ground' | 'passive';

export type PartHole = {
  /** Unique per part drawing. Two holes may share one `pin` — the board's GNDs, a tactile switch's doubled legs. */
  handle: string;
  /** The electrical terminal this hole belongs to: relative for a component, absolute for the board. */
  pin: string;
  label: string;
  kind: HoleKind;
  /** Position in the artwork's own viewBox units. */
  x: number;
  y: number;
};

export type PartDef = {
  type: string;
  label: string;
  art: string;
  viewBox: [number, number];
  /** Rendered width in canvas pixels; height follows the viewBox aspect. */
  width: number;
  holes: PartHole[];
  /**
   * True for the Arduino: the bridge protocol carries it as `circuit.board`,
   * not as a `components[]` entry, and its holes are wired by bare name.
   */
  board?: boolean;
  /** Shown in the palette; keeps a part with no terminals honest about why it cannot be wired. */
  note?: string;
};

function hole(
  handle: string,
  pin: string,
  label: string,
  kind: HoleKind,
  x: number,
  y: number,
): PartHole {
  return { handle, pin, label, kind, x, y };
}

/**
 * Arduino Uno R3 headers, from `assets/arduino.svg` (viewBox 379x304). The
 * board is drawn USB-left / barrel-jack-bottom-left, so the digital header runs
 * along the top edge and the power + analog headers along the bottom, which is
 * the order used below. Each x is the centre of that hole's dark square in the
 * file; the two rows sit at y=37.2 and y=257.1.
 */
const UNO_TOP_Y = 37.2;
const UNO_BOTTOM_Y = 257.1;

const UNO_TOP: [string, string, HoleKind, number][] = [
  ['scl', 'SCL', 'signal', 129.15],
  ['sda', 'SDA', 'signal', 140.6],
  ['aref', 'AREF', 'power', 152.25],
  ['gnd-top', 'GND', 'ground', 163.6],
  ['d13', 'D13', 'signal', 175.2],
  ['d12', 'D12', 'signal', 186.95],
  ['d11', 'D11', 'signal', 198.35],
  ['d10', 'D10', 'signal', 210.05],
  ['d9', 'D9', 'signal', 221.55],
  ['d8', 'D8', 'signal', 233.2],
  ['d7', 'D7', 'signal', 251.75],
  ['d6', 'D6', 'signal', 263.4],
  ['d5', 'D5', 'signal', 274.9],
  ['d4', 'D4', 'signal', 286.4],
  ['d3', 'D3', 'signal', 297.8],
  ['d2', 'D2', 'signal', 309.6],
  ['d1', 'D1', 'signal', 321.0],
  ['d0', 'D0', 'signal', 332.7],
];

/**
 * The R3 power header's first hole is the unconnected one next to IOREF, so
 * the eight drawn holes start at x=170.55 and only seven carry a name.
 */
const UNO_BOTTOM: [string, string, HoleKind, number][] = [
  ['ioref', 'IOREF', 'power', 182.25],
  ['reset', 'RESET', 'signal', 193.75],
  ['v3v3', '3.3V', 'power', 205.35],
  ['v5', '5V', 'power', 216.9],
  ['gnd-1', 'GND', 'ground', 228.45],
  ['gnd-2', 'GND', 'ground', 240.05],
  ['vin', 'VIN', 'power', 251.65],
  ['a0', 'A0', 'signal', 274.7],
  ['a1', 'A1', 'signal', 286.3],
  ['a2', 'A2', 'signal', 297.95],
  ['a3', 'A3', 'signal', 309.55],
  ['a4', 'A4', 'signal', 321.05],
  ['a5', 'A5', 'signal', 332.55],
];

const UNO_HOLES: PartHole[] = [
  ...UNO_TOP.map(([handle, pin, kind, x]) => hole(handle, pin, pin, kind, x, UNO_TOP_Y)),
  ...UNO_BOTTOM.map(([handle, pin, kind, x]) => hole(handle, pin, pin, kind, x, UNO_BOTTOM_Y)),
];

export const PART_DEFS: PartDef[] = [
  {
    type: 'arduino',
    label: 'Arduino Uno',
    art: arduinoArt,
    viewBox: [379, 304],
    width: 340,
    board: true,
    holes: UNO_HOLES,
  },
  {
    // Legs: the left one is the longer, and so the anode — its lead path starts
    // at y=117.9 against the right lead's y=120.3.
    type: 'led',
    label: 'LED',
    art: ledArt,
    viewBox: [172, 177],
    width: 96,
    holes: [
      hole('anode', 'anode', 'Anode (+)', 'passive', 65.0, 152),
      hole('cathode', 'cathode', 'Cathode (-)', 'passive', 110.5, 152),
    ],
  },
  {
    // Drawn upright: one lead leaves the top of the body, one the bottom.
    type: 'resistor',
    label: 'Resistor',
    art: resistorArt,
    viewBox: [95, 142],
    width: 58,
    holes: [hole('a', 'a', 'A', 'passive', 48.0, 16), hole('b', 'b', 'B', 'passive', 48.0, 112)],
  },
  {
    // A ceramic disc, not an electrolytic can: no polarity mark on the artwork
    // and two equal legs, so its terminals are named the way
    // `capacitor-ceramic.yaml` names them — either way round is correct.
    type: 'capacitor',
    label: 'Capacitor',
    art: capacitorArt,
    viewBox: [135, 176],
    width: 78,
    holes: [hole('a', 'a', 'A', 'passive', 45.8, 147), hole('b', 'b', 'B', 'passive', 95.0, 147)],
  },
  {
    // Three legs; the middle one, drawn shorter, is the wiper.
    type: 'potentiometer',
    label: 'Potentiometer',
    art: potentiometerArt,
    viewBox: [150, 168],
    width: 90,
    holes: [
      hole('a', 'a', 'End A', 'passive', 49.2, 145),
      hole('wiper', 'wiper', 'Wiper', 'passive', 72.7, 145),
      hole('b', 'b', 'End B', 'passive', 95.7, 145),
    ],
  },
  {
    // A four-leg tactile switch: the two legs down each side are one terminal
    // internally, so both carry the same `pin` and differ only in where a wire
    // is drawn to.
    type: 'push-button',
    label: 'Push Button',
    art: pushButtonArt,
    viewBox: [125, 142],
    width: 74,
    holes: [
      hole('a1', 'a', 'A', 'passive', 27.85, 22),
      hole('a2', 'a', 'A', 'passive', 29.05, 127),
      hole('b1', 'b', 'B', 'passive', 96.0, 22),
      hole('b2', 'b', 'B', 'passive', 95.75, 127),
    ],
  },
  {
    // HC-SR04: four header legs, VCC / Trig / Echo / GND left to right.
    type: 'ultrasonic',
    label: 'Ultrasonic',
    art: ultrasonicArt,
    viewBox: [435, 243],
    width: 190,
    holes: [
      hole('vcc', 'vcc', 'VCC', 'power', 178.1, 220),
      hole('trig', 'trig', 'Trig', 'signal', 198.0, 220),
      hole('echo', 'echo', 'Echo', 'signal', 218.0, 220),
      hole('gnd', 'gnd', 'GND', 'ground', 238.5, 220),
    ],
  },
  {
    // Two terminals under the can: the red one is positive, the dark one negative.
    type: 'dc-motor',
    label: 'DC Motor',
    art: dcMotorArt,
    viewBox: [170, 162],
    width: 96,
    holes: [
      hole('neg', 'neg', 'Negative (-)', 'passive', 72.45, 137),
      hole('pos', 'pos', 'Positive (+)', 'passive', 98.6, 137),
    ],
  },
  {
    type: 'propellor',
    label: 'Propellor',
    art: propellorArt,
    viewBox: [170, 188],
    width: 78,
    holes: [],
    note: 'Mechanical only — the drawing has no terminals, so nothing wires to it.',
  },
];

const BY_TYPE = new Map(PART_DEFS.map((def) => [def.type, def]));

export function partDef(type: string): PartDef | undefined {
  return BY_TYPE.get(type);
}

const BOARD = PART_DEFS.find((def) => def.board);
if (!BOARD) throw new Error('catalog: no board part is defined');
export const boardDef: PartDef = BOARD;

/** Rendered height for a part, from its artwork's aspect ratio. */
export function partHeight(def: PartDef): number {
  return (def.width * def.viewBox[1]) / def.viewBox[0];
}

/** A hole's position as a percentage of the rendered box, for CSS placement. */
export function holeOffset(def: PartDef, item: PartHole): { left: string; top: string } {
  return {
    left: `${(item.x / def.viewBox[0]) * 100}%`,
    top: `${(item.y / def.viewBox[1]) * 100}%`,
  };
}

/**
 * The wire endpoint a hole produces. Component terminals are namespaced by the
 * component id exactly as `CircuitComponent.ConfigureIdentity` does; board
 * holes keep their bare electrical name, which is what the server's rules
 * (`socket-server/rules/circuitGraph.js`) and the LED simulator match on.
 */
export function endpointFor(def: PartDef, componentId: string, item: PartHole): string {
  return def.board ? item.pin : `${componentId}-${item.pin}`;
}

/** `D13` -> `d13`, `3.3V` -> `v3v3`, `5V` -> `v5` — the same folding the server does before matching. */
export function normalizePin(pinId: string): string {
  return pinId.trim().toLowerCase().replace(/[.\s]/g, '');
}

const BOARD_HOLE_BY_PIN = new Map<string, PartHole>();
for (const item of boardDef.holes) {
  const key = normalizePin(item.pin);
  if (!BOARD_HOLE_BY_PIN.has(key)) BOARD_HOLE_BY_PIN.set(key, item);
}
// Unity's board pins are named by hand, so accept the spellings the headset
// sends for the holes this artwork draws under a different label.
BOARD_HOLE_BY_PIN.set('ground', BOARD_HOLE_BY_PIN.get('gnd') as PartHole);
BOARD_HOLE_BY_PIN.set('3v3', BOARD_HOLE_BY_PIN.get('33v') as PartHole);
BOARD_HOLE_BY_PIN.set('vcc', BOARD_HOLE_BY_PIN.get('5v') as PartHole);

/** The hole a bare board pin name is drawn at, or undefined if this board has none. */
export function boardHole(pinId: string): PartHole | undefined {
  return BOARD_HOLE_BY_PIN.get(normalizePin(pinId));
}

/** True if the board artwork has a hole for this bare pin name. */
export function isBoardPin(pinId: string): boolean {
  return BOARD_HOLE_BY_PIN.has(normalizePin(pinId));
}
