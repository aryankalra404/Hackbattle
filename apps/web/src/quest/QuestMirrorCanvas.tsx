import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { boardDef, endpointFor, partDef, partHeight, type PartHole } from '../parts/catalog.js';
import { useStore } from '../state/store.js';
import { useCircuitEditor } from './CircuitEditorContext.js';
import { useQuestBridge, type QuestCircuit } from './QuestBridgeContext.js';
import { PART_DRAG_TYPE } from './QuestPartsPanel.js';
import { QuestPartNode } from './QuestPartNode.js';
import {
  BOARD_NODE_ID,
  connectionError,
  resolveEndpoint,
  sameWire,
  toCanvas,
  toWorld,
  type XY,
} from './circuitModel.js';

/**
 * The circuit workspace: a live 2D map of whatever is being built on the Quest,
 * and — since the same `circuit:update` event carries a build in either
 * direction — a place to build one here instead. Parts come from the drawn
 * catalog, wires are drawn pin to pin, and every edit goes out over the bridge
 * in the shape `QuestCircuitBridge.BuildCircuit()` uses, so the rules engine,
 * the LED simulator and the commit history treat it exactly like an AR build.
 */

const nodeTypes = { questPart: QuestPartNode };

/** A wire carries only its two pin names, so which hole it was drawn to is remembered here. */
type HandleHint = { from?: string | undefined; to?: string | undefined };

function wireKey(from: string, to: string): string {
  return `${from}::${to}`;
}

const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 };

function MirrorInner() {
  const { circuit, connected, simulateResult, checkResult, editCircuit } = useQuestBridge();
  const { addPart, setViewCentre, refitRequest } = useCircuitEditor();
  const toast = useStore((s) => s.toast);
  const { screenToFlowPosition, fitView, getViewport } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hintsRef = useRef(new Map<string, HandleHint>());

  const components = useMemo(() => circuit?.components ?? [], [circuit]);
  const wires = useMemo(() => circuit?.wires ?? [], [circuit]);
  const board = circuit?.board;

  const simulatedLeds = useMemo(() => {
    const byId = new Map<
      string,
      { pattern: 'on' | 'off' | 'blink' | 'pattern'; onMs?: number; offMs?: number }
    >();
    if (simulateResult?.stage === 'simulate') {
      for (const led of simulateResult.leds) byId.set(led.ledId, led);
    }
    return byId;
  }, [simulateResult]);

  /** Parts the last check called out, so the canvas shows the suspects the Checks tab lists. */
  const faulted = useMemo(() => {
    if (!checkResult || checkResult.ok) return new Set<string>();
    return new Set(checkResult.suspectedComponents);
  }, [checkResult]);

  /** True once a wire lands on a board pin, even if no board entry arrived with the circuit. */
  const boardUsed = useMemo(
    () =>
      Boolean(board) ||
      wires.some(
        (wire) =>
          resolveEndpoint(wire.from, components).node === BOARD_NODE_ID ||
          resolveEndpoint(wire.to, components).node === BOARD_NODE_ID,
      ),
    [board, wires, components],
  );

  const derivedNodes: Node[] = useMemo(() => {
    const list: Node[] = components.map((component) => {
      const sim = simulatedLeds.get(component.id);
      return {
        id: component.id,
        type: 'questPart',
        position: toCanvas(component.pos),
        data: {
          label: component.id,
          kind: component.type,
          simPattern: sim?.pattern,
          simOnMs: sim?.onMs,
          simOffMs: sim?.offMs,
          faulted: faulted.has(component.id),
        },
      };
    });

    if (boardUsed) {
      list.push({
        id: BOARD_NODE_ID,
        type: 'questPart',
        position: toCanvas(board?.pos),
        data: { label: boardDef.label, kind: boardDef.type },
      });
    }
    return list;
  }, [components, board, boardUsed, simulatedLeds, faulted]);

  const derivedEdges: Edge[] = useMemo(
    () =>
      wires.map((wire, index) => {
        const hint = hintsRef.current.get(wireKey(wire.from, wire.to));
        const from = resolveEndpoint(wire.from, components, hint?.from);
        const to = resolveEndpoint(wire.to, components, hint?.to);
        return {
          id: `${wire.from}--${wire.to}--${index}`,
          source: from.node,
          sourceHandle: from.hole?.handle ?? null,
          target: to.node,
          targetHandle: to.hole?.handle ?? null,
          type: 'smoothstep',
          data: { from: wire.from, to: wire.to },
          style: { stroke: '#0969da', strokeWidth: 2 },
        };
      }),
    [wires, components],
  );

  /**
   * React Flow is driven from local state so it can own the things the circuit
   * has no opinion about — what is selected, and where a part is mid-drag. The
   * circuit stays the source of truth: whenever it changes, it is folded back
   * in here, keeping only the selection.
   */
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>(derivedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(derivedEdges);

  useEffect(() => {
    setNodes((previous) => {
      const selected = new Set(previous.filter((node) => node.selected).map((node) => node.id));
      return derivedNodes.map((node) =>
        selected.has(node.id) ? { ...node, selected: true } : node,
      );
    });
  }, [derivedNodes, setNodes]);

  useEffect(() => {
    setEdges((previous) => {
      const selected = new Set(previous.filter((edge) => edge.selected).map((edge) => edge.id));
      return derivedEdges.map((edge) =>
        selected.has(edge.id) ? { ...edge, selected: true } : edge,
      );
    });
  }, [derivedEdges, setEdges]);

  /**
   * Drag to move. The intermediate frames stay local; the resting position is
   * written back as world metres through the same inverse transform the mirror
   * projects with, so a browser layout round-trips and reaches AR unchanged.
   */
  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      onNodesChangeBase(changes);

      const settled = changes.filter(
        (change) => change.type === 'position' && change.dragging === false,
      );
      if (settled.length === 0) return;

      const moved = new Map<string, XY>();
      for (const change of settled) {
        if (change.type !== 'position') continue;
        const at = change.position ?? nodes.find((node) => node.id === change.id)?.position;
        if (at) moved.set(change.id, at);
      }
      if (moved.size === 0) return;

      editCircuit((current): QuestCircuit => {
        let next = current;
        for (const [id, at] of moved) {
          if (id === BOARD_NODE_ID) {
            next = { ...next, board: { ...next.board, pos: toWorld(at), rot: { ...IDENTITY_ROT } } };
            continue;
          }
          next = {
            ...next,
            components: (next.components ?? []).map((component) =>
              component.id === id ? { ...component, pos: toWorld(at) } : component,
            ),
          };
        }
        return next;
      });
    },
    [editCircuit, nodes, onNodesChangeBase],
  );

  /**
   * Where a part clicked in the Parts tab should go: the middle of whatever is
   * on screen. Published to the editor context, since the tab has no idea what
   * the canvas is currently showing.
   */
  useEffect(() => {
    setViewCentre(() => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return { x: 300, y: 200 };
      return screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    });
    return () => setViewCentre(null);
  }, [screenToFlowPosition, setViewCentre]);

  /**
   * Keeps the build in frame. A headset publishes real desk coordinates, which
   * can be a long way from wherever this view happens to be looking, so a
   * circuit arriving from AR would otherwise land off-screen and the canvas
   * would sit there apparently empty. Fitting only when nothing at all is
   * visible leaves a view the user has deliberately panned or zoomed alone.
   */
  useEffect(() => {
    if (nodes.length === 0) return;
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;

    const view = getViewport();
    const left = -view.x / view.zoom;
    const top = -view.y / view.zoom;
    const right = left + rect.width / view.zoom;
    const bottom = top + rect.height / view.zoom;

    const anyVisible = nodes.some((node) => {
      const def = partDef(String((node.data as { kind?: string }).kind ?? ''));
      const width = def?.width ?? 140;
      const height = def ? partHeight(def) : 44;
      return (
        node.position.x < right &&
        node.position.x + width > left &&
        node.position.y < bottom &&
        node.position.y + height > top
      );
    });
    if (anyVisible) return;

    const timer = setTimeout(() => fitView({ duration: 250, maxZoom: 1, padding: 0.15 }), 60);
    return () => clearTimeout(timer);
  }, [nodes, fitView, getViewport]);

  // A part added without a chosen spot lands below whatever is already there,
  // which can be past the edge of the view, so bring it back into frame once
  // React Flow has measured it. Skipped on the first render, when there is
  // nothing to refit and `fitView` already ran.
  const refitsSeen = useRef(refitRequest);
  useEffect(() => {
    if (refitsSeen.current === refitRequest) return;
    refitsSeen.current = refitRequest;
    const timer = setTimeout(() => fitView({ duration: 200, maxZoom: 1, padding: 0.15 }), 80);
    return () => clearTimeout(timer);
  }, [refitRequest, fitView]);

  /** A part dragged out of the Parts tab lands exactly where it was dropped. */
  const onDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const type = event.dataTransfer.getData(PART_DRAG_TYPE);
      const def = partDef(type);
      if (!def) return;
      event.preventDefault();
      addPart(def, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [addPart, screenToFlowPosition],
  );

  const onDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    // getData is unreadable during a drag, so the private MIME type in `types`
    // is what says this drag is one of ours and not a stray file.
    if (!event.dataTransfer.types.includes(PART_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  /** Pin to pin. The hole a wire was drawn to is remembered here; the wire itself carries pin names only. */
  const onConnect = useCallback(
    (connection: Connection) => {
      const read = (nodeId: string, handleId: string | null) => {
        const def =
          nodeId === BOARD_NODE_ID
            ? boardDef
            : partDef(components.find((component) => component.id === nodeId)?.type ?? '');
        const hole: PartHole | undefined = def?.holes.find((item) => item.handle === handleId);
        return def && hole ? { def, hole, node: nodeId } : null;
      };

      const source = read(connection.source, connection.sourceHandle);
      const target = read(connection.target, connection.targetHandle);
      if (!source || !target) {
        toast('error', 'Start and finish a wire on a terminal.');
        return;
      }

      const from = {
        endpoint: endpointFor(source.def, source.node, source.hole),
        node: source.node,
        hole: source.hole,
      };
      const to = {
        endpoint: endpointFor(target.def, target.node, target.hole),
        node: target.node,
        hole: target.hole,
      };

      const problem = connectionError(circuit, from, to);
      if (problem) {
        toast('error', problem);
        return;
      }

      hintsRef.current.set(wireKey(from.endpoint, to.endpoint), {
        from: source.hole.handle,
        to: target.hole.handle,
      });
      editCircuit(
        (current): QuestCircuit => ({
          ...current,
          wires: [...(current.wires ?? []), { from: from.endpoint, to: to.endpoint }],
        }),
      );
    },
    [circuit, components, editCircuit, toast],
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      const ids = new Set(deleted.map((node) => node.id));
      editCircuit((current): QuestCircuit => {
        const before = current.components ?? [];
        const next: QuestCircuit = {
          ...current,
          components: before.filter((component) => !ids.has(component.id)),
          // A part takes its wires with it, the same as unplugging it in AR.
          wires: (current.wires ?? []).filter(
            (wire) =>
              !ids.has(resolveEndpoint(wire.from, before).node) &&
              !ids.has(resolveEndpoint(wire.to, before).node),
          ),
        };
        if (ids.has(BOARD_NODE_ID)) delete next.board;
        return next;
      });
    },
    [editCircuit],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      editCircuit((current): QuestCircuit => {
        let kept = current.wires ?? [];
        for (const edge of deleted) {
          const { from, to } = (edge.data ?? {}) as { from?: string; to?: string };
          if (!from || !to) continue;
          const index = kept.findIndex((wire) => sameWire(wire, from, to));
          if (index >= 0) kept = [...kept.slice(0, index), ...kept.slice(index + 1)];
        }
        return { ...current, wires: kept };
      });
    },
    [editCircuit],
  );

  const empty = components.length === 0 && !boardUsed;

  return (
    <div className="canvas-pane">
      <div
        ref={wrapperRef}
        className={`canvas quest-canvas${connected ? '' : ' quest-canvas--offline'}`}
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          connectionMode={ConnectionMode.Loose}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          edgesReconnectable={false}
          // React Flow only binds Backspace by default, and Delete is the key
          // this canvas tells people to press.
          deleteKeyCode={['Delete', 'Backspace']}
          panOnDrag
          zoomOnScroll
          fitView
          // Without a ceiling, an empty or one-part canvas fits to maxZoom and
          // everything dropped next lands enormous and half off-screen.
          fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.25}
          maxZoom={2.5}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="#c9d4e0" />
          <Controls showInteractive={false} />
        </ReactFlow>

        {empty && (
          <div className="canvas__hint">
            <strong>
              {connected
                ? 'Drag a part in from the Parts tab, or build on the Quest to see it here.'
                : 'Not connected to the Quest bridge.'}
            </strong>
            <span>
              {connected
                ? 'Anything built here goes over the same bridge as an AR build, so the checks, the simulator, commits and a connected headset all see it.'
                : 'Open the Quest panel settings (⚙) and connect to the bridge server. You can keep building here in the meantime.'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function QuestMirrorCanvas() {
  return (
    <ReactFlowProvider>
      <MirrorInner />
    </ReactFlowProvider>
  );
}
