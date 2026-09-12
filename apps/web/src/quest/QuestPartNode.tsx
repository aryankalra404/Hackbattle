import { useEffect, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { holeOffset, partDef, partHeight, type PartDef, type PartHole } from '../parts/catalog.js';

/**
 * One part on the canvas, drawn with its real artwork and carrying a
 * connectable dot over every lead, leg or header hole the drawing has — the
 * browser equivalent of a `PinPoint` on the headset build. Positions come from
 * the catalog, which measured them off each SVG, so a dot sits on the metal it
 * represents at any zoom.
 *
 * A type with no artwork (a `pir` spawned on the Quest, say) still renders as
 * the small labelled box the mirror has always used, so an AR build is never
 * invisible here just because this app has no drawing for one of its parts.
 */

export type QuestPartNodeData = {
  label: string;
  kind: string;
  /** Set on LED nodes only, from the last `code:simulate-result` — see QuestMirrorCanvas. */
  simPattern?: 'on' | 'off' | 'blink' | 'pattern' | undefined;
  simOnMs?: number | undefined;
  simOffMs?: number | undefined;
  /** True when the last `circuit:result` named this part as a suspect. */
  faulted?: boolean | undefined;
};

function Dot({ def, item }: { def: PartDef; item: PartHole }) {
  return (
    <Handle
      type="source"
      id={item.handle}
      position={Position.Top}
      className={`quest-handle quest-handle--${item.kind}`}
      style={holeOffset(def, item)}
      title={item.label}
    />
  );
}

/**
 * Drives the lit/unlit glow from the last simulation result: steady for
 * 'on', a self-scheduling timeout loop for 'blink' (CSS keyframes can't take
 * two independently-variable durations without per-node keyframe rules, and
 * this is simpler and just as smooth for a two-state glow).
 */
function useSimulatedLit(
  pattern: QuestPartNodeData['simPattern'],
  onMs?: number,
  offMs?: number,
): boolean {
  const [lit, setLit] = useState(pattern === 'on');

  useEffect(() => {
    if (pattern === 'on') {
      setLit(true);
      return;
    }
    if (pattern !== 'blink' || !onMs || !offMs) {
      setLit(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = (state: boolean) => {
      if (cancelled) return;
      setLit(state);
      timer = setTimeout(() => tick(!state), state ? onMs : offMs);
    };
    tick(true);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pattern, onMs, offMs]);

  return lit;
}

function ArtNode({ def, data }: { def: PartDef; data: QuestPartNodeData }) {
  const lit = useSimulatedLit(data.simPattern, data.simOnMs, data.simOffMs);
  const className = [
    'quest-art',
    `quest-art--${def.type}`,
    def.type === 'led' && lit ? 'quest-art--lit' : '',
    data.faulted ? 'quest-art--faulted' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      style={{ width: def.width, height: partHeight(def) }}
      title={`${data.label} — ${def.label}`}
    >
      <span className="quest-art__label">{data.label}</span>
      <span className="quest-art__svg" aria-hidden="true" dangerouslySetInnerHTML={{ __html: def.art }} />
      {def.holes.map((item) => (
        <Dot key={item.handle} def={def} item={item} />
      ))}
    </div>
  );
}

/** Fallback for a part type the catalog has no drawing for — an AR-only part, say. */
function PlainNode({ data }: { data: QuestPartNodeData }) {
  return (
    <div className={`quest-node${data.faulted ? ' quest-node--faulted' : ''}`}>
      <span className="quest-node__id">{data.label}</span>
      <span className="quest-node__kind">{data.kind}</span>
      <Handle type="source" id="pin" position={Position.Bottom} className="quest-handle" />
    </div>
  );
}

export function QuestPartNode({ data }: NodeProps) {
  const node = data as unknown as QuestPartNodeData;
  const def = partDef(node.kind);
  return def ? <ArtNode def={def} data={node} /> : <PlainNode data={node} />;
}
