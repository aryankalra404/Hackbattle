import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { PartDefinition } from '@circuitgit/schema';
import { partSymbols } from '../state/library.js';

/**
 * One component on the canvas.
 *
 * Entirely generic: the symbol, colour, size and pin layout all come from the
 * part definition. Adding a part to the library adds it to the canvas with no
 * change here.
 */

export type PartNodeData = {
  part: PartDefinition;
  label: string;
  /** Rendered parameter summary, e.g. "330 Ω". */
  summary: string;
  faulty: boolean;
  faultyPins: Set<string>;
  groundPin: string | undefined;
  componentId: string;
};

/**
 * Pins are split between the left and right edges in declaration order, so a
 * two-pin part reads left-to-right and a multi-pin part gets two columns.
 */
function pinSides(part: PartDefinition): { left: string[]; right: string[] } {
  const ids = part.pins.map((pin) => pin.id);
  if (ids.length <= 2) return { left: ids.slice(0, 1), right: ids.slice(1) };
  const half = Math.ceil(ids.length / 2);
  return { left: ids.slice(0, half), right: ids.slice(half) };
}

function offset(index: number, count: number): string {
  return `${((index + 1) / (count + 1)) * 100}%`;
}

export function PartNode({ data, selected }: NodeProps) {
  const { part, label, summary, faulty, faultyPins, groundPin, componentId } =
    data as unknown as PartNodeData;
  const { left, right } = pinSides(part);
  const svg = partSymbols[part.visual.symbol2d];

  const renderPin = (pinId: string, index: number, count: number, side: 'left' | 'right') => {
    const pin = part.pins.find((candidate) => candidate.id === pinId);
    const id = `${componentId}.${pinId}`;
    const classes = [
      'pin',
      faultyPins.has(id) ? 'pin--faulty' : '',
      groundPin === id ? 'pin--ground' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div key={pinId} className={`pin-row pin-row--${side}`} style={{ top: offset(index, count) }}>
        <Handle
          type="source"
          id={pinId}
          position={side === 'left' ? Position.Left : Position.Right}
          className={classes}
        />
        <span className="pin-label">{pin?.name ?? pinId}</span>
      </div>
    );
  };

  return (
    <div
      className={`part-node${selected ? ' part-node--selected' : ''}${faulty ? ' part-node--faulty' : ''}`}
      style={{ '--part-accent': part.visual.accent } as React.CSSProperties}
    >
      <div className="part-node__header">
        <span className="part-node__label">{label}</span>
        {summary && <span className="part-node__summary">{summary}</span>}
      </div>

      <div className="part-node__body">
        {left.map((pinId, index) => renderPin(pinId, index, left.length, 'left'))}
        {svg ? (
          <span
            className="part-node__symbol"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <span className="part-node__symbol part-node__symbol--missing">{part.name}</span>
        )}
        {right.map((pinId, index) => renderPin(pinId, index, right.length, 'right'))}
      </div>

      {faulty && (
        <span className="part-node__flag" title="This part has a finding">
          !
        </span>
      )}
    </div>
  );
}
