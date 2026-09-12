import type { PartDefinition } from '@circuitgit/schema';

/** Display helpers. Generic: driven by each param's declared unit and prefix flag. */

const PREFIXES: { factor: number; symbol: string }[] = [
  { factor: 1e9, symbol: 'G' },
  { factor: 1e6, symbol: 'M' },
  { factor: 1e3, symbol: 'k' },
  { factor: 1, symbol: '' },
  { factor: 1e-3, symbol: 'm' },
  { factor: 1e-6, symbol: 'µ' },
  { factor: 1e-9, symbol: 'n' },
  { factor: 1e-12, symbol: 'p' },
];

/** 0.0000001 F -> "100 nF", 10000 Ω -> "10 kΩ". */
export function formatSi(value: number, unit: string): string {
  if (value === 0) return `0 ${unit}`.trim();
  const magnitude = Math.abs(value);
  const prefix = PREFIXES.find((candidate) => magnitude >= candidate.factor) ?? PREFIXES.at(-1);
  if (!prefix) return `${value} ${unit}`.trim();

  const scaled = value / prefix.factor;
  const rounded = Number(scaled.toPrecision(4));
  return `${rounded} ${prefix.symbol}${unit}`.trim();
}

export function formatNumber(value: number, unit: string, siPrefix: boolean): string {
  if (siPrefix) return formatSi(value, unit);
  const rounded = Number(value.toPrecision(4));
  return unit ? `${rounded} ${unit}` : String(rounded);
}

/** The one-line value shown on a node, built from whichever params the part declares. */
export function formatParamSummary(
  part: PartDefinition,
  params: Record<string, number | string | boolean>,
): string {
  const pieces: string[] = [];

  for (const [id, definition] of Object.entries(part.params)) {
    const value = params[id];
    if (value === undefined) continue;

    if (definition.type === 'number' && typeof value === 'number') {
      pieces.push(formatNumber(value, definition.unit, definition.siPrefix));
    } else if (definition.type === 'enum' && typeof value === 'string') {
      pieces.push(value);
    } else if (definition.type === 'boolean') {
      if (value === true) pieces.push(definition.label.toLowerCase());
    }
  }

  // Two values is enough for a node caption; the inspector shows them all.
  return pieces.slice(0, 2).join(' · ');
}

export function formatPinName(part: PartDefinition, pinId: string): string {
  return part.pins.find((pin) => pin.id === pinId)?.name ?? pinId;
}

export function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
