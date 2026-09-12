import { Handle, Position, type NodeProps } from '@xyflow/react';
import ledArt from './assets/led-5mm.svg?raw';
import resistorArt from './assets/resistor.svg?raw';
import arduinoArt from './assets/arduino-uno-r3.svg?raw';
import { ARDUINO_HANDLES } from './arduinoPins.js';

export type QuestPartNodeData = {
  label: string;
  kind: string;
};

/**
 * Real breadboard-view artwork instead of a plain box — the SVGs and the
 * Arduino's pin-hole grid are copied from `origin/harshit`'s part library
 * (`packages/parts/symbols/*.svg`, `arduino-uno-r3.yaml` `pinLayout`), which
 * drew each part at true scale with a wirable hole per pin. Reused here
 * directly rather than pulling in that branch's whole part-schema rewrite,
 * since the Quest mirror never had real part refs to begin with.
 */

function Dot({ id, x, y }: { id: string; x: number; y: number }) {
  return (
    <Handle
      type="source"
      id={id}
      position={Position.Top}
      className="quest-handle"
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
    />
  );
}

function LedNode({ label }: { label: string }) {
  return (
    <div className="quest-art quest-art--led">
      <span className="quest-art__label">{label}</span>
      <span className="quest-art__svg" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ledArt }} />
      <Dot id="anode" x={29 / 78} y={60 / 62} />
      <Dot id="cathode" x={49 / 78} y={53 / 62} />
    </div>
  );
}

function ResistorNode({ label }: { label: string }) {
  return (
    <div className="quest-art quest-art--resistor">
      <span className="quest-art__label">{label}</span>
      <span
        className="quest-art__svg"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: resistorArt }}
      />
      <Dot id="a" x={2 / 120} y={22 / 44} />
      <Dot id="b" x={118 / 120} y={22 / 44} />
    </div>
  );
}

function BoardNode({ label }: { label: string }) {
  return (
    <div className="quest-art quest-art--board">
      <span className="quest-art__label">{label}</span>
      <span
        className="quest-art__svg"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: arduinoArt }}
      />
      {ARDUINO_HANDLES.map((pin) => (
        <Dot key={pin.id} id={pin.id} x={pin.x} y={pin.y} />
      ))}
    </div>
  );
}

function PirNode({ label }: { label: string }) {
  return (
    <div className="quest-node quest-node--pir">
      <span className="quest-node__id">{label}</span>
      <span className="quest-node__kind">pir</span>
      <Dot id="vcc" x={0.2} y={1} />
      <Dot id="signal" x={0.5} y={1} />
      <Dot id="gnd" x={0.8} y={1} />
    </div>
  );
}

export function QuestPartNode({ data }: NodeProps) {
  const { label, kind } = data as unknown as QuestPartNodeData;
  if (kind === 'led') return <LedNode label={label} />;
  if (kind === 'resistor') return <ResistorNode label={label} />;
  if (kind === 'board') return <BoardNode label={label} />;
  if (kind === 'pir') return <PirNode label={label} />;
  return (
    <div className="quest-node">
      <span className="quest-node__id">{label}</span>
      <span className="quest-node__kind">{kind}</span>
    </div>
  );
}
