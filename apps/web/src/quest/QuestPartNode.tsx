import type { NodeProps } from '@xyflow/react';

export type QuestPartNodeData = {
  label: string;
  kind: string;
};

const ACCENT: Record<string, string> = {
  led: '#1a7f37',
  resistor: '#9a6700',
  pir: '#8250df',
  board: '#59636e',
};

/** A read-only, text-only node for the Quest mirror — just an id and a type tag. */
export function QuestPartNode({ data }: NodeProps) {
  const { label, kind } = data as unknown as QuestPartNodeData;
  return (
    <div className="quest-node" style={{ '--part-accent': ACCENT[kind] ?? '#8c959f' } as React.CSSProperties}>
      <span className="quest-node__id">{label}</span>
      <span className="quest-node__kind">{kind}</span>
    </div>
  );
}
