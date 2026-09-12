import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { PartDefinition } from '@circuitgit/schema';
import { config, partSymbols } from '../state/library.js';

/**
 * One component on the canvas.
 *
 * Entirely generic: the symbol, colour, size and pin layout all come from the
 * part definition. Adding a part to the library adds it to the canvas with no
 * change here.
 *
 * Two layouts, chosen by data: a part that gives every pin a grid position (a
 * breadboard) is drawn at scale with a handle in each hole; anything else gets
 * its pins down the two edges.
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

/** A grid to draw on, when the part places every pin on one. */
export function holeGrid(part: PartDefinition): [number, number] | undefined {
  const size = part.footprint.gridSize;
  if (!size) return undefined;
  return part.pins.every((pin) => part.pinLayout[pin.id]) ? size : undefined;
}

function pinClasses(base: string, id: string, data: PartNodeData): string {
  return [
    base,
    data.faultyPins.has(id) ? `${base}--faulty` : '',
    data.groundPin === id ? `${base}--ground` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function Flag() {
  return (
    <span className="part-node__flag" title="This part has a finding">
      !
    </span>
  );
}

function BoardNode({ data, selected }: { data: PartNodeData; selected: boolean }) {
  const { part, label, faulty, componentId } = data;
  const [width, height] = holeGrid(part) ?? [0, 0];
  const pitch = config.ui.boardPitchPx;
  const svg = partSymbols[part.visual.symbol2d.path];

  return (
    <div
      className={`part-node part-node--board${selected ? ' part-node--selected' : ''}${faulty ? ' part-node--faulty' : ''}`}
      style={{ '--part-accent': part.visual.accent } as React.CSSProperties}
    >
      <div className="part-node__header">
        <span className="part-node__label">{label}</span>
        <span className="part-node__summary">{part.name}</span>
      </div>
      <div className="board" style={{ width: width * pitch, height: height * pitch }}>
        {svg && (
          <span className="board__art" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
        )}
        {part.pins.map((pin) => {
          const [x, y] = part.pinLayout[pin.id] ?? [0, 0];
          return (
            <Handle
              key={pin.id}
              type="source"
              id={pin.id}
              position={Position.Top}
              className={pinClasses('hole', `${componentId}.${pin.id}`, data)}
              style={{ left: x * pitch, top: y * pitch }}
              title={pin.name}
            />
          );
        })}
      </div>
      {faulty && <Flag />}
    </div>
  );
}

export function PartNode({ data: raw, selected }: NodeProps) {
  const data = raw as unknown as PartNodeData;
  if (holeGrid(data.part)) return <BoardNode data={data} selected={selected} />;

  const { part, label, summary, faulty, componentId } = data;
  const { left, right } = pinSides(part);
  const svg = partSymbols[part.visual.symbol2d.path];
  const rows = Math.max(left.length, right.length);

  const renderPin = (pinId: string, side: 'left' | 'right') => {
    const pin = part.pins.find((candidate) => candidate.id === pinId);
    return (
      <div key={pinId} className={`pin-row pin-row--${side}`}>
        <Handle
          type="source"
          id={pinId}
          position={side === 'left' ? Position.Left : Position.Right}
          className={pinClasses('pin', `${componentId}.${pinId}`, data)}
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

      <div
        className="part-node__body"
        style={
          { '--pin-rows': rows, '--pin-row-px': `${config.ui.pinRowPx}px` } as React.CSSProperties
        }
      >
        <div className="pin-col pin-col--left">
          {left.map((pinId) => renderPin(pinId, 'left'))}
        </div>
        {svg ? (
          <span
            className="part-node__symbol"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <span className="part-node__symbol part-node__symbol--missing">{part.name}</span>
        )}
        <div className="pin-col pin-col--right">
          {right.map((pinId) => renderPin(pinId, 'right'))}
        </div>
      </div>

      {faulty && <Flag />}
    </div>
  );
}
