import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { createXRStore, XR, XROrigin } from '@react-three/xr';
import { Text } from '@react-three/drei';
import { parsePinRef, type CircuitSnapshot, type PartDefinition } from '@circuitgit/schema';
import { partLibrary, config } from '../state/library.js';
import { useStore } from '../state/store.js';

/**
 * The headset view.
 *
 * A live mirror of whatever the room holds: parts laid out on a virtual bench
 * in front of you, wires drawn between their pins, and the session state shown
 * on a panel. It is read-only by design for now — the laptop is the authority,
 * and the hub refuses a circuit change from anywhere while a session is live.
 */

const store = createXRStore();

/** Metres per 2D layout unit. A 200px gap on the canvas becomes 20cm on the bench. */
const SCALE = 0.001;
const BENCH_Y = config.ar.workbenchDefaultHeightMetres;

type Placed = {
  id: string;
  part: PartDefinition;
  label: string;
  position: [number, number, number];
};

function place(snapshot: CircuitSnapshot): Placed[] {
  return Object.entries(snapshot.components).flatMap(([id, component]) => {
    if (!partLibrary.has(component.part)) return [];
    const layout = snapshot.layout['2d'][id] ?? { x: 0, y: 0 };
    return [
      {
        id,
        part: partLibrary.get(component.part),
        label: component.label,
        // The 2D canvas y-axis runs down the screen; on the bench it runs away
        // from the viewer, so it maps to z.
        position: [layout.x * SCALE, BENCH_Y, layout.y * SCALE] as [number, number, number],
      },
    ];
  });
}

function PartBody({ placed, faulty }: { placed: Placed; faulty: boolean }) {
  const [w, h] = placed.part.visual.size;
  const color = faulty ? '#cf222e' : placed.part.visual.accent;

  return (
    <group position={placed.position}>
      <mesh castShadow>
        <boxGeometry args={[w * 0.02, 0.012, h * 0.02]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={faulty ? 0.6 : 0.15}
          roughness={0.5}
        />
      </mesh>
      <Text
        position={[0, 0.022, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.012}
        color="#1f2328"
        anchorX="center"
        anchorY="middle"
      >
        {placed.label}
      </Text>
    </group>
  );
}

function Wires({ snapshot, placed }: { snapshot: CircuitSnapshot; placed: Placed[] }) {
  const byId = useMemo(() => new Map(placed.map((item) => [item.id, item])), [placed]);

  return (
    <>
      {Object.entries(snapshot.wires).flatMap(([id, wire]) => {
        const a = byId.get(parsePinRef(wire.a).componentId);
        const b = byId.get(parsePinRef(wire.b).componentId);
        if (!a || !b) return [];

        const mid: [number, number, number] = [
          (a.position[0] + b.position[0]) / 2,
          (a.position[1] + b.position[1]) / 2 + 0.01,
          (a.position[2] + b.position[2]) / 2,
        ];
        const dx = b.position[0] - a.position[0];
        const dz = b.position[2] - a.position[2];
        const length = Math.hypot(dx, dz);
        if (length === 0) return [];

        return [
          <mesh key={id} position={mid} rotation={[0, Math.atan2(dz, dx) + Math.PI / 2, 0]}>
            <cylinderGeometry args={[0.0015, 0.0015, length, 6]} />
            <meshStandardMaterial color={wire.style.color ?? '#59636e'} />
          </mesh>,
        ];
      })}
    </>
  );
}

function Bench() {
  return (
    <mesh position={[0, BENCH_Y - 0.008, 0]} receiveShadow>
      <boxGeometry args={[0.9, 0.008, 0.6]} />
      <meshStandardMaterial color="#e8edf2" roughness={0.9} transparent opacity={0.55} />
    </mesh>
  );
}

function StatusPanel() {
  const mode = useStore((s) => s.mode);
  const room = useStore((s) => s.room);
  const connection = useStore((s) => s.connection);
  const snapshot = useStore((s) => s.snapshot);
  const findings = useStore((s) => s.findings);

  const parts = Object.keys(snapshot.components).length;
  const errors = findings.filter((finding) => finding.severity === 'error').length;

  const lines = [
    snapshot.meta.name || 'Untitled circuit',
    `${room ?? 'no room'} · ${connection}`,
    `${parts} parts · ${Object.keys(snapshot.wires).length} wires`,
    mode === 'simulate' ? 'SESSION LIVE — circuit locked' : 'editing on the laptop',
    errors > 0 ? `${errors} failing check${errors === 1 ? '' : 's'}` : 'checks clear',
  ];

  return (
    <group position={[0, BENCH_Y + 0.28, -0.3]}>
      <mesh>
        <planeGeometry args={[0.42, 0.2]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.85} />
      </mesh>
      {lines.map((line, index) => (
        <Text
          key={index}
          position={[0, 0.07 - index * 0.033, 0.001]}
          fontSize={index === 0 ? 0.02 : 0.014}
          color={index === 3 && mode === 'simulate' ? '#cf222e' : '#1f2328'}
          anchorX="center"
          anchorY="middle"
          maxWidth={0.38}
        >
          {line}
        </Text>
      ))}
    </group>
  );
}

function Scene() {
  const snapshot = useStore((s) => s.snapshot);
  const findings = useStore((s) => s.findings);
  const placed = useMemo(() => place(snapshot), [snapshot]);
  const faulty = useMemo(
    () => new Set(findings.flatMap((finding) => finding.componentIds)),
    [findings],
  );

  return (
    <>
      <ambientLight intensity={1.1} />
      <directionalLight position={[1, 2, 1]} intensity={1.4} castShadow />
      <XROrigin position={[0, 0, 0.5]} />
      <Bench />
      <StatusPanel />
      {placed.map((item) => (
        <PartBody key={item.id} placed={item} faulty={faulty.has(item.id)} />
      ))}
      <Wires snapshot={snapshot} placed={placed} />
    </>
  );
}

export function XrApp() {
  const room = useStore((s) => s.room);
  const connection = useStore((s) => s.connection);
  const peers = useStore((s) => s.peers);
  const mode = useStore((s) => s.mode);
  const snapshot = useStore((s) => s.snapshot);
  const joinRoom = useStore((s) => s.joinRoom);
  const leaveRoom = useStore((s) => s.leaveRoom);

  // Room comes from ?room= so a headset can be pointed straight at a session.
  const requested = new URLSearchParams(globalThis.location?.search ?? '').get('room') ?? 'demo';
  const [name, setName] = useState(requested);

  // Join once on mount; the room input handles later changes. joinRoom and
  // leaveRoom are stable store actions, so re-running on them would only churn
  // the socket.
  const [initialRoom] = useState(requested);
  useEffect(() => {
    joinRoom(initialRoom, 'xr');
    return () => leaveRoom();
  }, [initialRoom, joinRoom, leaveRoom]);

  const supported = typeof navigator !== 'undefined' && 'xr' in navigator;

  return (
    <div className="xr">
      <header className="xr__bar">
        <span className="brand__name">{config.product.name} · Headset</span>

        <span className={`chip chip--${connection}`}>
          {connection === 'online' ? `synced · ${room}` : connection}
        </span>

        {mode === 'simulate' && <span className="badge badge--fail">session live · locked</span>}

        <span className="xr__spacer" />

        <input
          className="input xr__room"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="Room name"
        />
        <button type="button" className="btn btn--sm" onClick={() => joinRoom(name.trim(), 'xr')}>
          Join
        </button>

        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={!supported}
          onClick={() => void store.enterAR()}
          title={supported ? 'Enter passthrough AR' : 'This browser has no WebXR support'}
        >
          Enter AR
        </button>
      </header>

      {!supported && (
        <p className="xr__note">
          No WebXR here. Open this page in the Quest browser over HTTPS, or use the Immersive Web
          Emulator in desktop Chrome. The mirror below still updates live.
        </p>
      )}

      <div className="xr__stage">
        <Canvas shadows camera={{ position: [0, 1.4, 0.9], fov: 55 }}>
          <XR store={store}>
            <color attach="background" args={['#f6f8fa']} />
            <Scene />
          </XR>
        </Canvas>
      </div>

      <footer className="xr__foot">
        <span>{Object.keys(snapshot.components).length} parts mirrored</span>
        <span>
          {peers.length} device{peers.length === 1 ? '' : 's'} in room
        </span>
        <span>Read-only mirror — edit on the laptop.</span>
      </footer>
    </div>
  );
}
