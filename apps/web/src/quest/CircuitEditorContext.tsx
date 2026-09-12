import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { partHeight, type PartDef } from '../parts/catalog.js';
import { useStore } from '../state/store.js';
import { useQuestBridge, type QuestCircuit } from './QuestBridgeContext.js';
import { componentEntry, nextComponentId, placePart, toWorld, type XY } from './circuitModel.js';

/**
 * The editing actions the workspace shares between its panes: the Parts tab
 * puts components in, the canvas decides where a dropped one lands. Both go
 * through the bridge's `editCircuit`, so a part added here reaches the rules
 * engine, the simulator, commits and any connected headset by the one route.
 */

const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 };

/** Where a part lands when the canvas has not reported a viewport yet. */
const DEFAULT_ANCHOR: XY = { x: 300, y: 200 };

type CircuitEditorState = {
  /** `at` is canvas coordinates, for a part dropped on a spot the user picked. */
  addPart: (def: PartDef, at?: XY) => void;
  /** True once the circuit holds a board; the protocol carries exactly one. */
  boardPlaced: boolean;
  /** The canvas registers how to find the middle of what is currently on screen. */
  setViewCentre: (find: (() => XY) | null) => void;
  /**
   * Bumped when a part was added without a chosen spot, so the canvas can bring
   * it into view. A part dropped on a spot the user pointed at is already
   * visible, and refitting then would only yank the view around.
   */
  refitRequest: number;
};

const CircuitEditorCtx = createContext<CircuitEditorState | null>(null);

export function CircuitEditorProvider({ children }: { children: ReactNode }) {
  const { circuit, editCircuit } = useQuestBridge();
  const toast = useStore((s) => s.toast);
  const viewCentreRef = useRef<(() => XY) | null>(null);
  const [refitRequest, setRefitRequest] = useState(0);

  const setViewCentre = useCallback((find: (() => XY) | null) => {
    viewCentreRef.current = find;
  }, []);

  const boardPlaced = Boolean(circuit?.board);

  const addPart = useCallback(
    (def: PartDef, at?: XY) => {
      if (def.holes.length === 0 && def.board !== true) {
        // A part with no terminals cannot be wired, so it would sit on the
        // canvas doing nothing and travel to the headset as a component with
        // no pins. Better to say so than to add a decoration silently.
        toast('info', `${def.label} has no terminals in its drawing, so nothing can wire to it.`);
      }

      const anchor = at ?? viewCentreRef.current?.() ?? DEFAULT_ANCHOR;
      if (!at) setRefitRequest((count) => count + 1);

      editCircuit((current): QuestCircuit => {
        const spot = at
          ? { x: anchor.x - def.width / 2, y: anchor.y - partHeight(def) / 2 }
          : placePart(current, def, anchor);

        if (def.board) {
          // `circuit.board` is a single slot in the bridge protocol, not a
          // components[] entry, so a second board would replace the first.
          if (current.board) return current;
          return { ...current, board: { pos: toWorld(spot), rot: { ...IDENTITY_ROT } } };
        }

        const id = nextComponentId(current, def.type);
        return {
          ...current,
          components: [...(current.components ?? []), componentEntry(def, id, spot)],
        };
      });
    },
    [editCircuit, toast],
  );

  const value = useMemo<CircuitEditorState>(
    () => ({ addPart, boardPlaced, setViewCentre, refitRequest }),
    [addPart, boardPlaced, setViewCentre, refitRequest],
  );

  return <CircuitEditorCtx.Provider value={value}>{children}</CircuitEditorCtx.Provider>;
}

export function useCircuitEditor(): CircuitEditorState {
  const ctx = useContext(CircuitEditorCtx);
  if (!ctx) throw new Error('useCircuitEditor must be used within a CircuitEditorProvider');
  return ctx;
}
