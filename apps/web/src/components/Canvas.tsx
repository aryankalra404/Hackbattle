import { useCallback, useMemo, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { faultyComponentIds, faultyPinRefs } from '@circuitgit/rules';
import { partLibrary } from '../state/library.js';
import { useStore } from '../state/store.js';
import { holeGrid, PartNode } from './PartNode.js';
import { formatParamSummary } from '../format.js';

const nodeTypes = { part: PartNode };

function CanvasInner() {
  const snapshot = useStore((s) => s.snapshot);
  const findings = useStore((s) => s.findings);
  const selection = useStore((s) => s.selection);
  const addComponent = useStore((s) => s.addComponent);
  const moveComponent = useStore((s) => s.moveComponent);
  const addWire = useStore((s) => s.addWire);
  const removeWire = useStore((s) => s.removeWire);
  const removeComponent = useStore((s) => s.removeComponent);
  const select = useStore((s) => s.select);
  const locked = useStore((s) => s.mode === 'simulate');

  const wrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const faulty = useMemo(() => faultyComponentIds(findings), [findings]);
  const faultyPins = useMemo(() => faultyPinRefs(findings), [findings]);

  const nodes: Node[] = useMemo(
    () =>
      Object.entries(snapshot.components).flatMap(([id, component]) => {
        if (!partLibrary.has(component.part)) return [];
        const part = partLibrary.get(component.part);
        return [
          {
            id,
            type: 'part',
            position: snapshot.layout['2d'][id] ?? { x: 0, y: 0 },
            selected: selection === id,
            // Boards are what parts plug into, so they always sit underneath.
            zIndex: holeGrid(part) ? 0 : 1,
            data: {
              part,
              componentId: id,
              label: component.label,
              summary: formatParamSummary(part, component.params),
              faulty: faulty.has(id),
              faultyPins,
              groundPin: snapshot.settings.ground,
            },
          } satisfies Node,
        ];
      }),
    [snapshot, selection, faulty, faultyPins],
  );

  const edges: Edge[] = useMemo(
    () =>
      Object.entries(snapshot.wires).map(([id, wire]) => {
        const [sourceId, sourceHandle] = splitRef(wire.a);
        const [targetId, targetHandle] = splitRef(wire.b);
        return {
          id,
          source: sourceId,
          sourceHandle,
          target: targetId,
          targetHandle,
          type: 'smoothstep',
          style: { stroke: wire.style.color ?? '#59636e', strokeWidth: 2 },
        } satisfies Edge;
      }),
    [snapshot.wires],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          moveComponent(change.id, change.position);
        }
        if (change.type === 'remove') removeComponent(change.id);
        if (change.type === 'select' && change.selected) select(change.id);
      }
    },
    [moveComponent, removeComponent, select],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (!connection.sourceHandle || !connection.targetHandle) return;
      addWire(
        `${connection.source}.${connection.sourceHandle}`,
        `${connection.target}.${connection.targetHandle}`,
      );
    },
    [addWire],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (locked) return;
      const partId = event.dataTransfer.getData('application/circuitgit-part');
      if (!partId || !partLibrary.has(partId)) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addComponent(partLibrary.get(partId), position);
    },
    [addComponent, screenToFlowPosition, locked],
  );

  return (
    <div
      className={`canvas${locked ? ' canvas--locked' : ''}`}
      ref={wrapper}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onEdgesDelete={(deleted) => deleted.forEach((edge) => removeWire(edge.id))}
        onPaneClick={() => select(undefined)}
        // Keeps the stacking above: a selected board must not cover its parts.
        elevateNodesOnSelect={false}
        // A wire has no direction and every pin is the same kind of handle, so
        // any pin may connect to any other. Strict mode would refuse them all.
        connectionMode={ConnectionMode.Loose}
        nodesDraggable={!locked}
        nodesConnectable={!locked}
        edgesReconnectable={!locked}
        deleteKeyCode={locked ? null : ['Backspace', 'Delete']}
        connectionLineStyle={{ stroke: '#0969da', strokeWidth: 2 }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.25}
        maxZoom={2.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="#c9d4e0" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) =>
            ((node.data as { part?: { visual?: { accent?: string } } }).part?.visual?.accent ??
              '#8c959f') as string
          }
          maskColor="rgba(246, 248, 250, 0.75)"
        />
      </ReactFlow>

      {Object.keys(snapshot.components).length === 0 && (
        <div className="canvas__hint">
          <strong>Drag a part from the left to start building.</strong>
          <span>Then drag from one pin to another to wire them together.</span>
        </div>
      )}
    </div>
  );
}

function splitRef(ref: string): [string, string] {
  const dot = ref.lastIndexOf('.');
  return [ref.slice(0, dot), ref.slice(dot + 1)];
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
