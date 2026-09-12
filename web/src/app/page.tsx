"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

/* ===================================================================
   Types
   =================================================================== */

type PinDef = { name: string; x: number; y: number };

type ComponentDef = {
  type: string;
  label: string;
  svgPath: string;
  width: number;
  height: number;
  pins: PinDef[];
};

type CanvasComponent = {
  id: string;
  type: string;
  x: number;
  y: number;
};

type CanvasWire = { from: string; to: string };

type CircuitComponentEntry = {
  id: string;
  type: string;
  [key: string]: unknown;
};

type Circuit = {
  components?: CircuitComponentEntry[];
  wires?: { from: string; to: string }[];
  board?: unknown;
};

type CommitSummary = {
  id: string;
  message: string;
  author: string;
  createdAt: string;
  parentId: string | null;
  componentCount: number;
  wireCount: number;
};

/* ===================================================================
   Component Library — pin positions derived from each SVG's lead/leg
   locations as fractions of the rendered component dimensions
   =================================================================== */

const LIBRARY: ComponentDef[] = [
  {
    type: "arduino",
    label: "Arduino",
    svgPath: "/svgs/arduino.svg",
    width: 240,
    height: 192,
    pins: [
      // Digital pins — top edge
      { name: "D0", x: 0.35, y: 0.02 },
      { name: "D1", x: 0.39, y: 0.02 },
      { name: "D2", x: 0.43, y: 0.02 },
      { name: "D3", x: 0.47, y: 0.02 },
      { name: "D4", x: 0.51, y: 0.02 },
      { name: "D5", x: 0.55, y: 0.02 },
      { name: "D6", x: 0.59, y: 0.02 },
      { name: "D7", x: 0.63, y: 0.02 },
      { name: "D8", x: 0.67, y: 0.02 },
      { name: "D9", x: 0.71, y: 0.02 },
      { name: "D10", x: 0.75, y: 0.02 },
      { name: "D11", x: 0.79, y: 0.02 },
      { name: "D12", x: 0.83, y: 0.02 },
      { name: "D13", x: 0.87, y: 0.02 },
      // Power + Analog — bottom edge
      { name: "GND", x: 0.15, y: 0.98 },
      { name: "5V", x: 0.22, y: 0.98 },
      { name: "3.3V", x: 0.29, y: 0.98 },
      { name: "VIN", x: 0.36, y: 0.98 },
      { name: "A0", x: 0.52, y: 0.98 },
      { name: "A1", x: 0.58, y: 0.98 },
      { name: "A2", x: 0.64, y: 0.98 },
      { name: "A3", x: 0.70, y: 0.98 },
      { name: "A4", x: 0.76, y: 0.98 },
      { name: "A5", x: 0.82, y: 0.98 },
    ],
  },
  {
    type: "led",
    label: "LED",
    svgPath: "/svgs/led.svg",
    width: 65,
    height: 67,
    pins: [
      // Left leg = anode, right leg = cathode (from SVG path endpoints)
      { name: "anode", x: 0.35, y: 0.95 },
      { name: "cathode", x: 0.62, y: 0.95 },
    ],
  },
  {
    type: "resistor",
    label: "Resistor",
    svgPath: "/svgs/resistor.svg",
    width: 42,
    height: 63,
    pins: [
      // Top lead ≈ y=13/142, bottom lead ≈ y=114/142
      { name: "a", x: 0.51, y: 0.05 },
      { name: "b", x: 0.51, y: 0.95 },
    ],
  },
  {
    type: "capacitor",
    label: "Capacitor",
    svgPath: "/svgs/capacitor.svg",
    width: 55,
    height: 72,
    pins: [
      // Left leg ≈ x=46/135, right leg ≈ x=95/135
      { name: "positive", x: 0.34, y: 0.95 },
      { name: "negative", x: 0.70, y: 0.95 },
    ],
  },
  {
    type: "potentiometer",
    label: "Potentiometer",
    svgPath: "/svgs/potentiometer.svg",
    width: 62,
    height: 70,
    pins: [
      { name: "a", x: 0.27, y: 0.95 },
      { name: "wiper", x: 0.50, y: 0.95 },
      { name: "b", x: 0.73, y: 0.95 },
    ],
  },
  {
    type: "push_button",
    label: "Push Button",
    svgPath: "/svgs/push button.svg",
    width: 55,
    height: 63,
    pins: [
      { name: "a", x: 0.20, y: 0.95 },
      { name: "b", x: 0.80, y: 0.95 },
    ],
  },
  {
    type: "ultrasonic",
    label: "Ultrasonic",
    svgPath: "/svgs/ultrasonic.svg",
    width: 150,
    height: 84,
    pins: [
      { name: "vcc", x: 0.25, y: 0.95 },
      { name: "trig", x: 0.42, y: 0.95 },
      { name: "echo", x: 0.58, y: 0.95 },
      { name: "gnd", x: 0.75, y: 0.95 },
    ],
  },
  {
    type: "dc_motor",
    label: "DC Motor",
    svgPath: "/svgs/DC Motor.svg",
    width: 65,
    height: 62,
    pins: [
      { name: "positive", x: 0.30, y: 0.95 },
      { name: "negative", x: 0.70, y: 0.95 },
    ],
  },
  {
    type: "propellor",
    label: "Propellor",
    svgPath: "/svgs/PROPELLOR.svg",
    width: 58,
    height: 64,
    pins: [{ name: "shaft", x: 0.50, y: 0.95 }],
  },
  // PIR from VR reuses ultrasonic SVG (same vcc/signal/gnd pin layout)
  {
    type: "pir",
    label: "PIR Sensor",
    svgPath: "/svgs/ultrasonic.svg",
    width: 110,
    height: 62,
    pins: [
      { name: "vcc", x: 0.25, y: 0.95 },
      { name: "signal", x: 0.50, y: 0.95 },
      { name: "gnd", x: 0.75, y: 0.95 },
    ],
  },
];

function getDef(type: string): ComponentDef | undefined {
  return LIBRARY.find((d) => d.type === type);
}

/* ===================================================================
   Helpers
   =================================================================== */

const DEFAULTS = {
  serverUrl: "http://localhost:3001",
  sessionId: "demo-room",
};

function loadDefault(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveDefault(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* noop */
  }
}

/** Pin ID = "{componentId}-{pinName}" — matches Unity QuestCircuitBridge format */
function makePinId(compId: string, pinName: string): string {
  return `${compId}-${pinName}`;
}

/** Parse pin ID → component id + pin name. Uses last dash as separator. */
function parsePinId(
  id: string
): { compId: string; pinName: string } | null {
  const i = id.lastIndexOf("-");
  if (i < 1) return null;
  return { compId: id.substring(0, i), pinName: id.substring(i + 1) };
}

/** Get the absolute canvas position of a pin */
function pinAbsPos(
  comp: CanvasComponent,
  pin: PinDef,
  def: ComponentDef
): { x: number; y: number } {
  return { x: comp.x + pin.x * def.width, y: comp.y + pin.y * def.height };
}

/**
 * Build the circuit JSON that the server / Unity expect:
 * { components: [{ id, type, <pinName>: <pinId>, … }], wires: [{ from, to }] }
 */
function buildPayload(
  comps: CanvasComponent[],
  wires: CanvasWire[]
): Circuit {
  return {
    components: comps.map((c) => {
      const def = getDef(c.type);
      const entry: CircuitComponentEntry = { id: c.id, type: c.type };
      if (def) def.pins.forEach((p) => (entry[p.name] = makePinId(c.id, p.name)));
      return entry;
    }),
    wires: wires.map((w) => ({ from: w.from, to: w.to })),
  };
}

/* ===================================================================
   Page Component
   =================================================================== */

export default function Home() {
  /* ── Connection / commit state (unchanged from original) ────────── */
  const [serverUrl, setServerUrl] = useState(() =>
    loadDefault("circuitdoctor.serverUrl", DEFAULTS.serverUrl)
  );
  const [sessionId, setSessionId] = useState(() =>
    loadDefault("circuitdoctor.sessionId", DEFAULTS.sessionId)
  );
  const [connected, setConnected] = useState(false);
  const [circuit, setCircuit] = useState<Circuit | null>(null);
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [message, setMessage] = useState("");
  const [author, setAuthor] = useState("web");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  /* ── Canvas state ───────────────────────────────────────────────── */
  const [canvasComps, setCanvasComps] = useState<CanvasComponent[]>([]);
  const [canvasWires, setCanvasWires] = useState<CanvasWire[]>([]);
  const [activePin, setActivePin] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    compId: string;
    ox: number;
    oy: number;
  } | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [faultPins, setFaultPins] = useState<Set<string>>(new Set());

  const countersRef = useRef<Record<string, number>>({});
  const lastEmittedRef = useRef("");
  const skipEmitRef = useRef(false);
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const compsRef = useRef(canvasComps);
  useEffect(() => {
    compsRef.current = canvasComps;
  }, [canvasComps]);

  /* ── Debounced emit to server on canvas change ─────────────────── */
  useEffect(() => {
    if (skipEmitRef.current) {
      skipEmitRef.current = false;
      return;
    }
    if (!socketRef.current?.connected) return;
    if (canvasComps.length === 0 && canvasWires.length === 0) return;

    if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
    emitTimerRef.current = setTimeout(() => {
      const payload = buildPayload(canvasComps, canvasWires);
      const json = JSON.stringify(payload);
      if (json === lastEmittedRef.current) return;
      lastEmittedRef.current = json;
      socketRef.current?.emit("circuit:update", { sessionId, circuit: payload });
    }, 300);

    return () => {
      if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasComps, canvasWires, sessionId]);

  /* ── Socket connection ─────────────────────────────────────────── */
  const connect = useCallback(() => {
    socketRef.current?.disconnect();
    setError(null);

    const socket = io(serverUrl, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    /** Sync incoming circuit from VR / other clients onto the canvas. */
    const syncCircuit = (incoming: Circuit) => {
      const json = JSON.stringify(incoming);
      if (json === lastEmittedRef.current) return; // own echo
      skipEmitRef.current = true;

      setCanvasComps((prev) => {
        const posMap = new Map(prev.map((c) => [c.id, { x: c.x, y: c.y }]));
        return (incoming.components || []).map((entry, idx) => {
          const pos = posMap.get(entry.id);
          // Update the per-type counter so local adds don't collide
          const m = entry.id.match(/^(.+)-(\d+)$/);
          if (m)
            countersRef.current[m[1]] = Math.max(
              countersRef.current[m[1]] ?? 0,
              parseInt(m[2])
            );
          return {
            id: entry.id,
            type: entry.type,
            x: pos?.x ?? 100 + (idx % 5) * 155,
            y: pos?.y ?? 80 + Math.floor(idx / 5) * 140,
          };
        });
      });
      setCanvasWires(
        (incoming.wires || []).map((w) => ({ from: w.from, to: w.to }))
      );
    };

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("session:join", { sessionId });
      socket.emit("commit:list", { sessionId });
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (err: Error) =>
      setError(`Could not connect: ${err.message}`)
    );

    // Live circuit sync
    socket.on("circuit:update", (payload: { circuit: Circuit }) => {
      setCircuit(payload.circuit);
      syncCircuit(payload.circuit);
    });

    // Commit events
    socket.on("commit:list", (payload: { commits: CommitSummary[] }) => {
      setCommits(payload.commits);
      setBusy(null);
    });
    socket.on("commit:created", () => {
      setBusy(null);
      setMessage("");
    });
    socket.on("commit:restore", (payload: { circuit: Circuit }) => {
      setCircuit(payload.circuit);
      syncCircuit(payload.circuit);
      setBusy(null);
    });
    socket.on("commit:error", (payload: { message: string }) => {
      setError(payload.message);
      setBusy(null);
    });

    // Fault highlighting from diagnosis pipeline
    socket.on(
      "circuit:result",
      (result: {
        ok: boolean;
        suspectedComponents?: string[];
        suspectedComponent?: string;
      }) => {
        const suspected =
          result.suspectedComponents ||
          (result.suspectedComponent ? [result.suspectedComponent] : []);
        if (!result.ok && suspected.length > 0) {
          const faulted = new Set<string>();
          for (const compId of suspected) {
            const comp = compsRef.current.find((c) => c.id === compId);
            if (!comp) continue;
            const def = getDef(comp.type);
            if (!def) continue;
            def.pins.forEach((p) => faulted.add(makePinId(comp.id, p.name)));
          }
          setFaultPins(faulted);
        } else {
          setFaultPins(new Set());
        }
      }
    );

    saveDefault("circuitdoctor.serverUrl", serverUrl);
    saveDefault("circuitdoctor.sessionId", sessionId);
  }, [serverUrl, sessionId]);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  /* ── Canvas interaction handlers ───────────────────────────────── */

  const addComponent = useCallback((type: string) => {
    const def = getDef(type);
    if (!def) return;
    const n = (countersRef.current[type] ?? 0) + 1;
    countersRef.current[type] = n;
    const id = `${type}-${n}`;
    setCanvasComps((prev) => [
      ...prev,
      {
        id,
        type,
        x: 100 + ((n - 1) % 5) * 130,
        y: 80 + Math.floor((n - 1) / 5) * 120,
      },
    ]);
  }, []);

  const deleteComponent = useCallback(
    (compId: string) => {
      setCanvasComps((prev) => prev.filter((c) => c.id !== compId));
      setCanvasWires((prev) =>
        prev.filter((w) => {
          const f = parsePinId(w.from);
          const t = parsePinId(w.to);
          return f?.compId !== compId && t?.compId !== compId;
        })
      );
      if (activePin && parsePinId(activePin)?.compId === compId)
        setActivePin(null);
    },
    [activePin]
  );

  const deleteWire = useCallback((idx: number) => {
    setCanvasWires((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handlePinClick = useCallback(
    (pinIdStr: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!activePin) {
        setActivePin(pinIdStr);
        return;
      }
      if (activePin === pinIdStr) {
        setActivePin(null);
        return;
      }
      // Don't wire two pins on the same component
      const from = parsePinId(activePin);
      const to = parsePinId(pinIdStr);
      if (from && to && from.compId === to.compId) {
        setActivePin(pinIdStr);
        return;
      }
      // Don't create duplicate
      const dup = canvasWires.some(
        (w) =>
          (w.from === activePin && w.to === pinIdStr) ||
          (w.from === pinIdStr && w.to === activePin)
      );
      if (!dup) {
        setCanvasWires((prev) => [
          ...prev,
          { from: activePin, to: pinIdStr },
        ]);
      }
      setActivePin(null);
    },
    [activePin, canvasWires]
  );

  const handleCompMouseDown = useCallback(
    (compId: string, e: React.MouseEvent) => {
      if (e.button !== 0 || activePin) return;
      const comp = canvasComps.find((c) => c.id === compId);
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!comp || !rect) return;
      setDragState({
        compId,
        ox: e.clientX - rect.left - comp.x,
        oy: e.clientY - rect.top - comp.y,
      });
      e.preventDefault();
    },
    [canvasComps, activePin]
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setCursor({ x: mx, y: my });
      if (dragState) {
        setCanvasComps((prev) =>
          prev.map((c) =>
            c.id === dragState.compId
              ? { ...c, x: mx - dragState.ox, y: my - dragState.oy }
              : c
          )
        );
      }
    },
    [dragState]
  );

  const handleCanvasMouseUp = useCallback(() => {
    if (dragState) setDragState(null);
  }, [dragState]);

  /* ── Commit handlers (unchanged) ───────────────────────────────── */
  const createCommit = () => {
    if (!socketRef.current || !connected) return;
    setBusy("commit");
    setError(null);
    socketRef.current.emit("commit:create", { sessionId, message, author });
  };

  const loadCommit = (commitId: string) => {
    if (!socketRef.current || !connected) return;
    setBusy(commitId);
    setError(null);
    socketRef.current.emit("commit:load", { sessionId, commitId });
  };

  /* ── Derived ───────────────────────────────────────────────────── */
  const componentCount = circuit?.components?.length ?? canvasComps.length;
  const wireCount = circuit?.wires?.length ?? canvasWires.length;

  /** Resolve a pinId to its absolute canvas position */
  const absPinPos = useCallback(
    (pid: string): { x: number; y: number } | null => {
      const parsed = parsePinId(pid);
      if (!parsed) return null;
      const comp = canvasComps.find((c) => c.id === parsed.compId);
      if (!comp) return null;
      const def = getDef(comp.type);
      if (!def) return null;
      const pin = def.pins.find((p) => p.name === parsed.pinName);
      if (!pin) return null;
      return pinAbsPos(comp, pin, def);
    },
    [canvasComps]
  );

  /* ── Render ────────────────────────────────────────────────────── */
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-6 font-sans dark:bg-black">
      {/* Header */}
      <header className="w-full max-w-7xl mb-4">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          CircuitDoctor — Commits
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Version control for the circuit being built live on the Quest.
        </p>
      </header>

      {/* ── Circuit Canvas + Palette ─────────────────────────────── */}
      <section className="w-full max-w-7xl flex gap-3 mb-6">
        {/* Palette */}
        <div className="flex flex-col gap-1.5 w-[88px] shrink-0">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
            Components
          </span>
          {LIBRARY.filter((d) => d.type !== "pir").map((def) => (
            <button
              key={def.type}
              onClick={() => addComponent(def.type)}
              className="flex flex-col items-center gap-0.5 rounded-lg border border-black/10 bg-white p-1.5 hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-zinc-800 transition-colors"
              title={`Add ${def.label}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={def.svgPath}
                alt={def.label}
                className="w-9 h-9 object-contain"
              />
              <span className="text-[9px] text-zinc-600 dark:text-zinc-400 leading-tight text-center">
                {def.label}
              </span>
            </button>
          ))}
        </div>

        {/* Canvas */}
        <div
          ref={canvasRef}
          className="flex-1 h-[520px] relative rounded-xl border border-black/10 dark:border-white/10 overflow-hidden select-none"
          style={{ background: "#0d1117" }}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onClick={() => {
            if (activePin) setActivePin(null);
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Grid */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <pattern
                id="grid"
                width="20"
                height="20"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 20 0 L 0 0 0 20"
                  fill="none"
                  stroke="rgba(255,255,255,0.04)"
                  strokeWidth="0.5"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>

          {/* Wires overlay */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {canvasWires.map((wire, idx) => {
              const fp = absPinPos(wire.from);
              const tp = absPinPos(wire.to);
              if (!fp || !tp) return null;
              const fault = faultPins.has(wire.from) || faultPins.has(wire.to);
              return (
                <line
                  key={`w-${idx}`}
                  x1={fp.x}
                  y1={fp.y}
                  x2={tp.x}
                  y2={tp.y}
                  stroke={fault ? "#ef4444" : "#3b82f6"}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  className="pointer-events-auto cursor-pointer"
                  style={{
                    filter: fault
                      ? "drop-shadow(0 0 4px #ef4444)"
                      : "drop-shadow(0 0 3px rgba(59,130,246,0.5))",
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    deleteWire(idx);
                  }}
                />
              );
            })}

            {/* Wire in progress (yellow dashed) */}
            {activePin &&
              (() => {
                const fp = absPinPos(activePin);
                if (!fp) return null;
                return (
                  <line
                    x1={fp.x}
                    y1={fp.y}
                    x2={cursor.x}
                    y2={cursor.y}
                    stroke="#fbbf24"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    strokeLinecap="round"
                    style={{
                      filter:
                        "drop-shadow(0 0 3px rgba(251,191,36,0.6))",
                    }}
                  />
                );
              })()}
          </svg>

          {/* Components */}
          {canvasComps.map((comp) => {
            const def = getDef(comp.type);
            if (!def) return null;
            return (
              <div
                key={comp.id}
                className="absolute"
                style={{
                  left: comp.x,
                  top: comp.y,
                  width: def.width,
                  height: def.height,
                  cursor:
                    dragState?.compId === comp.id ? "grabbing" : "grab",
                }}
                onMouseDown={(e) => handleCompMouseDown(comp.id, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  deleteComponent(comp.id);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={def.svgPath}
                  alt={def.label}
                  draggable={false}
                  className="w-full h-full object-contain pointer-events-none"
                />
                {/* Label */}
                <span className="absolute -top-4 left-0 text-[9px] text-zinc-500 whitespace-nowrap font-mono">
                  {comp.id}
                </span>
                {/* Pin dots */}
                {def.pins.map((pin) => {
                  const pid = makePinId(comp.id, pin.name);
                  const isActive = activePin === pid;
                  const isFault = faultPins.has(pid);
                  const isConnected = canvasWires.some(
                    (w) => w.from === pid || w.to === pid
                  );
                  return (
                    <div
                      key={pin.name}
                      className="pin-dot"
                      style={{
                        position: "absolute",
                        left: `${pin.x * 100}%`,
                        top: `${pin.y * 100}%`,
                        transform: "translate(-50%, -50%)",
                      }}
                      data-active={isActive ? "" : undefined}
                      data-fault={isFault ? "" : undefined}
                      data-connected={isConnected ? "" : undefined}
                      title={`${comp.id}.${pin.name}`}
                      onClick={(e) => handlePinClick(pid, e)}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <span className="pin-label">{pin.name}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Empty state */}
          {canvasComps.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-sm pointer-events-none">
              Click a component on the left to add it · Right-click to
              delete
            </div>
          )}
        </div>
      </section>

      {/* ── Existing Controls (unchanged structure) ──────────────── */}
      <main className="flex w-full max-w-2xl flex-col gap-8">
        {/* Connection */}
        <section className="flex flex-col gap-3 rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500">
              Bridge server URL
            </label>
            <input
              className="rounded-md border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://192.168.1.5:3001"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500">
              Session ID
            </label>
            <input
              className="rounded-md border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              placeholder="demo-room"
            />
          </div>
          <button
            onClick={connect}
            className="mt-1 self-start rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {connected ? "Reconnect" : "Connect"}
          </button>
          <p className="text-xs">
            <span className={connected ? "text-green-600" : "text-zinc-400"}>
              ● {connected ? "Connected" : "Not connected"}
            </span>
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </section>

        {/* Live mirror */}
        <section className="rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Live mirror
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {componentCount} component{componentCount === 1 ? "" : "s"},{" "}
            {wireCount} wire{wireCount === 1 ? "" : "s"}
          </p>
        </section>

        {/* Commit */}
        <section className="flex flex-col gap-3 rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Commit
          </h2>
          <input
            className="rounded-md border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Commit message"
          />
          <input
            className="rounded-md border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Author"
          />
          <button
            onClick={createCommit}
            disabled={!connected || componentCount === 0 || busy !== null}
            className="self-start rounded-full bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40 hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {busy === "commit" ? "Committing…" : "Commit current build"}
          </button>
        </section>

        {/* History */}
        <section className="flex flex-col gap-3 rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            History
          </h2>
          {commits.length === 0 && (
            <p className="text-sm text-zinc-500">No commits yet.</p>
          )}
          <ul className="flex flex-col gap-2">
            {commits.map((commit) => (
              <li
                key={commit.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-black/5 px-3 py-2 dark:border-white/5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-black dark:text-zinc-50">
                    {commit.message}
                  </p>
                  <p className="text-xs text-zinc-500">
                    <span className="font-mono">{commit.id}</span> ·{" "}
                    {commit.author} ·{" "}
                    {new Date(commit.createdAt).toLocaleString()} ·{" "}
                    {commit.componentCount} components, {commit.wireCount}{" "}
                    wires
                  </p>
                </div>
                <button
                  onClick={() => loadCommit(commit.id)}
                  disabled={!connected || busy !== null}
                  className="shrink-0 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium disabled:opacity-40 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
                >
                  {busy === commit.id ? "Loading…" : "Load"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
