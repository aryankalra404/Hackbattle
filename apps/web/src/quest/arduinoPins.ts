/**
 * Header hole positions for the Arduino Uno R3 artwork (`assets/arduino-uno-r3.svg`,
 * viewBox `0 0 27 21`) — copied from `origin/harshit`'s
 * `packages/parts/parts/arduino-uno-r3.yaml` `pinLayout`, which lays pins out on
 * the board's real 0.1" header grid. Positions are fractions of the viewBox so
 * they work at any rendered size.
 *
 * Keyed by a normalized form of Unity's `PinPoint.pinId` strings (see
 * `socket-server/unity-scripts/PinPoint.cs`), not the yaml's own pin ids —
 * the two projects named pins differently (`D13` vs `d13`, `5V` vs `v5`).
 */

const GRID: Record<string, [number, number]> = {
  gnd3: [10.5, 1],
  d13: [11.5, 1],
  d12: [12.5, 1],
  d11: [13.5, 1],
  d10: [14.5, 1],
  d9: [15.5, 1],
  d8: [16.5, 1],
  d7: [18, 1],
  d6: [19, 1],
  d5: [20, 1],
  d4: [21, 1],
  d3: [22, 1],
  d2: [23, 1],
  d1: [24, 1],
  d0: [25, 1],
  v3v3: [8.5, 20],
  v5: [9.5, 20],
  gnd1: [10.5, 20],
  gnd2: [11.5, 20],
  vin: [12.5, 20],
  a0: [14.5, 20],
  a1: [15.5, 20],
  a2: [16.5, 20],
  a3: [17.5, 20],
  a4: [18.5, 20],
  a5: [19.5, 20],
};

const VIEWBOX: [number, number] = [27, 21];

/** `D13` -> `d13`, `3.3V` -> `v3v3`, `5V` -> `v5`, `GND` -> `gnd1`, `A0` -> `a0`. */
export function normalizeArduinoPin(pinId: string): string {
  const key = pinId.trim().toLowerCase().replace(/[.\s]/g, '');
  if (key === 'gnd') return 'gnd1';
  if (key === '5v') return 'v5';
  if (key === '33v' || key === '3v3') return 'v3v3';
  return key;
}

/** Every hole this board's artwork draws, as (normalized id, fractional x, fractional y). */
export const ARDUINO_HANDLES: { id: string; x: number; y: number }[] = Object.entries(GRID).map(
  ([id, [x, y]]) => ({ id, x: x / VIEWBOX[0], y: y / VIEWBOX[1] }),
);

/** True if this board's artwork has a hole for the (normalized) pin id. */
export function isArduinoPin(normalizedId: string): boolean {
  return normalizedId in GRID;
}
