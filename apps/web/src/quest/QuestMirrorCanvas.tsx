import { useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useQuestBridge, type QuestComponentEntry } from './QuestBridgeContext.js';
import { QuestPartNode } from './QuestPartNode.js';

const nodeTypes = { questPart: QuestPartNode };

/** Pixels per metre of Quest desk space. Parts a few cm apart in AR need real separation here or their (small) nodes overlap and hide the wires between them. */
const SCALE = 1800;
const BOARD_NODE_ID = '__board__';

/**
 * A live 2D map of whatever is being built on the Quest right now: one node
 * per component, projected from its (x, z) world position onto this plane,
 * plus the board (e.g. the Arduino) as a fixed anchor for wires that end on
 * one of its pins rather than a spawned component.
 */
function ownerOf(pinId: string, components: QuestComponentEntry[]): string {
  const owner = components.find((c) => pinId === c.id || pinId.startsWith(`${c.id}-`));
  return owner ? owner.id : BOARD_NODE_ID;
}

function MirrorInner() {
  const { circuit, connected } = useQuestBridge();
  const components = circuit?.components ?? [];
  const wires = circuit?.wires ?? [];
  const board = circuit?.board;

  const originX = board?.pos.x ?? components[0]?.pos?.x ?? 0;
  const originZ = board?.pos.z ?? components[0]?.pos?.z ?? 0;

  const nodes: Node[] = useMemo(() => {
    const list: Node[] = components.map((component) => ({
      id: component.id,
      type: 'questPart',
      position: {
        x: ((component.pos?.x ?? 0) - originX) * SCALE + 300,
        y: ((component.pos?.z ?? 0) - originZ) * SCALE + 200,
      },
      data: { label: component.id, kind: component.type },
      draggable: false,
      selectable: false,
    }));

    if (board || wires.some((w) => ownerOf(w.from, components) === BOARD_NODE_ID)) {
      list.push({
        id: BOARD_NODE_ID,
        type: 'questPart',
        position: { x: 300, y: 200 },
        data: { label: 'Arduino', kind: 'board' },
        draggable: false,
        selectable: false,
      });
    }
    return list;
  }, [components, board, originX, originZ]);

  const edges: Edge[] = useMemo(
    () =>
      wires.map((wire, index) => ({
        id: `${wire.from}--${wire.to}--${index}`,
        source: ownerOf(wire.from, components),
        target: ownerOf(wire.to, components),
        type: 'smoothstep',
        style: { stroke: '#0969da', strokeWidth: 2 },
      })),
    [wires, components],
  );

  return (
    <div className={`canvas quest-canvas${connected ? '' : ' quest-canvas--offline'}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
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
