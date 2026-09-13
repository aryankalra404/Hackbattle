import { useEffect, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import ledArt from './assets/led-5mm.svg?raw';
import resistorArt from './assets/resistor.svg?raw';
import arduinoArt from './assets/arduino-uno-r3.svg?raw';
import motorArt from './assets/dc-motor.svg?raw';
import ultrasonicArt from './assets/ultrasonic.svg?raw';
import { ARDUINO_HANDLES } from './arduinoPins.js';

export type QuestPartNodeData = {
  label: string;
  kind: string;
  /** Set on LED nodes only, from the last `code:simulate-result` — see QuestMirrorCanvas. */
  simPattern?: 'on' | 'off' | 'blink' | 'pattern' | undefined;
  simOnMs?: number | undefined;
  simOffMs?: number | undefined;
  /** Set on ultrasonic nodes only, from the live `sensor:proximity` event — see QuestMirrorCanvas. */
  sensorActive?: boolean | undefined;
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

/**
 * Drives the lit/unlit glow from the last simulation result: steady for
 * 'on', a self-scheduling timeout loop for 'blink' (CSS keyframes can't take
 * two independently-variable durations without per-node keyframe rules, and
 * this is simpler and just as smooth for a two-state glow).
 */
function useSimulatedLit(pattern: QuestPartNodeData['simPattern'], onMs?: number, offMs?: number): boolean {
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

function LedNode({ label, simPattern, simOnMs, simOffMs }: QuestPartNodeData) {
  const lit = useSimulatedLit(simPattern, simOnMs, simOffMs);
  return (
    <div className={`quest-art quest-art--led${lit ? ' quest-art--lit' : ''}`}>
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

function MotorNode({ label }: { label: string }) {
  return (
    <div className="quest-art quest-art--motor">
      <span className="quest-art__label">{label}</span>
      <span className="quest-art__svg" aria-hidden="true" dangerouslySetInnerHTML={{ __html: motorArt }} />
      <Dot id="positive" x={0.38} y={0.94} />
      <Dot id="negative" x={0.62} y={0.94} />
    </div>
  );
}

function UltrasonicNode({ label, sensorActive }: { label: string; sensorActive?: boolean | undefined }) {
  return (
    <div className={`quest-art quest-art--ultrasonic${sensorActive ? ' quest-art--active' : ''}`}>
      <span className="quest-art__label">{label}</span>
      <span className="quest-art__svg" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ultrasonicArt }} />
      <Dot id="vcc" x={0.12} y={0.95} />
      <Dot id="trig" x={0.38} y={0.95} />
      <Dot id="echo" x={0.62} y={0.95} />
      <Dot id="gnd" x={0.88} y={0.95} />
    </div>
  );
}

export function QuestPartNode({ data }: NodeProps) {
  const { label, kind, simPattern, simOnMs, simOffMs, sensorActive } = data as unknown as QuestPartNodeData;
  if (kind === 'led') return <LedNode label={label} kind={kind} simPattern={simPattern} simOnMs={simOnMs} simOffMs={simOffMs} />;
  if (kind === 'resistor') return <ResistorNode label={label} />;
  if (kind === 'board') return <BoardNode label={label} />;
  if (kind === 'pir') return <PirNode label={label} />;
  if (kind === 'motor') return <MotorNode label={label} />;
  if (kind === 'ultrasonic') return <UltrasonicNode label={label} sensorActive={sensorActive} />;
  return (
    <div className="quest-node">
      <span className="quest-node__id">{label}</span>
      <span className="quest-node__kind">{kind}</span>
    </div>
  );
}
