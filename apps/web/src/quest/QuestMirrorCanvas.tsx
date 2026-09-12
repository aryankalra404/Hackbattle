import { useMemo, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useQuestBridge, type QuestComponentEntry } from './QuestBridgeContext.js';
import { QuestPartNode } from './QuestPartNode.js';
import { isArduinoPin, normalizeArduinoPin } from './arduinoPins.js';

const nodeTypes = { questPart: QuestPartNode };

/** Pixels per metre of Quest desk space. Parts a few cm apart in AR need real separation here or their (small) nodes overlap and hide the wires between them. */
const SCALE = 1800;
const BOARD_NODE_ID = '__board__';

/**
 * A live 2D map of whatever is being built on the Quest right now: one node
 * per component, projected from its (x, z) world position onto this plane,
 * plus the board (e.g. the Arduino) as a fixed anchor for wires that end on
 * one of its pins rather than a spawned component.
 *
 * Resolves a wire endpoint's raw pin id (e.g. `led-1-anode`, `D13`) to the
 * node and, where the artwork has a real lead/hole for it, the exact handle
 * to draw the wire from — same idea as origin/harshit's per-pin Handles, just
 * against Unity's simpler id scheme instead of a part definition's pins.
 */
function resolvePin(
  pinId: string,
  components: QuestComponentEntry[],
): { node: string; handle: string | null } {
  const owner = components.find((c) => pinId === c.id || pinId.startsWith(`${c.id}-`));
  if (owner) return { node: owner.id, handle: pinId.slice(owner.id.length + 1) || null };

  const normalized = normalizeArduinoPin(pinId);
  return { node: BOARD_NODE_ID, handle: isArduinoPin(normalized) ? normalized : null };
}

function MirrorInner() {
  const { circuit, connected, simulateResult, sessionId } = useQuestBridge();
  const components = circuit?.components ?? [];
  const wires = circuit?.wires ?? [];
  const board = circuit?.board;

  // Fixed once per session rather than recomputed from the live board
  // position: everything (including the board node itself) is plotted
  // relative to this point, so the Arduino visually moves like any other
  // component instead of being the frame its own offset always cancels out.
  const originRef = useRef<{ sessionId: string; x: number; z: number } | null>(null);
  if (originRef.current?.sessionId !== sessionId) originRef.current = null;
  if (originRef.current === null) {
    const seed = board?.pos ?? components[0]?.pos;
    if (seed) originRef.current = { sessionId, x: seed.x, z: seed.z };
  }
  const originX = originRef.current?.x ?? 0;
  const originZ = originRef.current?.z ?? 0;

  const simulatedLeds = useMemo(() => {
    const byId = new Map<string, { pattern: 'on' | 'off' | 'blink' | 'pattern'; onMs?: number; offMs?: number }>();
    if (simulateResult?.stage === 'simulate') {
      for (const led of simulateResult.leds) byId.set(led.ledId, led);
    }
    return byId;
  }, [simulateResult]);

  const nodes: Node[] = useMemo(() => {
    const list: Node[] = components.map((component) => {
      const sim = simulatedLeds.get(component.id);
      return {
        id: component.id,
        type: 'questPart',
        position: {
          x: ((component.pos?.x ?? 0) - originX) * SCALE + 300,
          y: ((component.pos?.z ?? 0) - originZ) * SCALE + 200,
        },
        data: {
          label: component.id,
          kind: component.type,
          simPattern: sim?.pattern,
          simOnMs: sim?.onMs,
          simOffMs: sim?.offMs,
        },
        draggable: false,
        selectable: false,
      };
    });

    if (board || wires.some((w) => resolvePin(w.from, components).node === BOARD_NODE_ID)) {
      list.push({
        id: BOARD_NODE_ID,
        type: 'questPart',
        position: {
          x: ((board?.pos?.x ?? originX) - originX) * SCALE + 300,
          y: ((board?.pos?.z ?? originZ) - originZ) * SCALE + 200,
        },
        data: { label: 'Arduino', kind: 'board' },
        draggable: false,
        selectable: false,
      });
    }
    return list;
  }, [components, board, wires, originX, originZ, simulatedLeds]);

  const edges: Edge[] = useMemo(
    () =>
      wires.map((wire, index) => {
        const from = resolvePin(wire.from, components);
        const to = resolvePin(wire.to, components);
        return {
          id: `${wire.from}--${wire.to}--${index}`,
          source: from.node,
          sourceHandle: from.handle,
          target: to.node,
          targetHandle: to.handle,
          type: 'smoothstep',
          style: { stroke: '#0969da', strokeWidth: 2 },
        };
      }),
    [wires, components],
  );

  return (
    <div className={`canvas quest-canvas${connected ? '' : ' quest-canvas--offline'}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        panOnDrag
        zoomOnScroll
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.25}
        maxZoom={2.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="#c9d4e0" />
        <Controls showInteractive={false} />
      </ReactFlow>

      {components.length === 0 && (
        <div className="canvas__hint">
          <strong>
            {connected ? 'Build something on the Quest to see it here.' : 'Not connected to the Quest bridge.'}
          </strong>
          <span>
            {connected
              ? 'This map stays in sync live as you place parts and wire them in AR.'
              : 'Open the Quest panel settings (⚙) and connect to the bridge server.'}
          </span>
        </div>
      )}
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
