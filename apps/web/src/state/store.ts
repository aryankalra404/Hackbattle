import { useMemo } from 'react';
import { create } from 'zustand';
import {
  emptySnapshot,
  pinRef,
  type CircuitSnapshot,
  type Commit,
  type DiffChange,
  type Finding,
  type PartDefinition,
} from '@circuitgit/schema';
import { defaultParams } from '@circuitgit/parts';
import { Repository, diffSnapshots, electricalHash, HeadMovedError } from '@circuitgit/core';
import { runTopologyChecks } from '@circuitgit/rules';
import { config, partLibrary } from './library.js';
import { deviceId, SyncClient, type ConnectionStatus } from './sync.js';
import type { Peer, RoomState, SyncRole } from '@circuitgit/schema';

/**
 * Editor state.
 *
 * The working snapshot is the draft; committing hands it to the Repository,
 * which is the same content-addressed commit graph the API will run. Topology
 * findings are recomputed on every edit, exactly as the check pipeline
 * specifies.
 */

export type View = 'editor' | 'history';

/**
 * Edit mode allows changes. Simulate mode holds the circuit still: a running
 * session and a moving circuit would make every measured value ambiguous, and
 * any connected device would be mirroring a snapshot that no longer exists.
 */
export type Mode = 'edit' | 'simulate';

export type Toast = { id: string; tone: 'info' | 'success' | 'error'; text: string };

type State = {
  repo: Repository;
  branch: string;
  /** Head the working copy is based on; used for the compare-and-swap. */
  baseCommit: string | undefined;
  snapshot: CircuitSnapshot;
  findings: Finding[];
  deferred: { kind: string; reason: string }[];
  selection: string | undefined;
  view: View;
  /** Commit being inspected in the history view. */
  inspecting: string | undefined;
  /** Two commits being compared, or undefined for "against its parent". */
  compare: { from: string; to: string } | undefined;
  electricalOnly: boolean;
  mode: Mode;
  /** Electrical hash the session was started on, so drift is detectable. */
  simulatingHash: string | undefined;
  /** Whether the parts palette is expanded. Remembered per browser. */
  paletteOpen: boolean;

  // ---- sync ----
  /** Room this device mirrors, or undefined when working alone. */
  room: string | undefined;
  connection: ConnectionStatus;
  peers: Peer[];
  /** Room version this device last saw, for the compare-and-swap on push. */
  roomVersion: number;
  /** True while applying a remote update, so it is not echoed back. */
  applyingRemote: boolean;
  toasts: Toast[];
  dirty: boolean;
};

type Actions = {
  addComponent: (part: PartDefinition, position: { x: number; y: number }) => void;
  removeComponent: (id: string) => void;
  moveComponent: (id: string, position: { x: number; y: number }) => void;
  setParam: (id: string, param: string, value: number | string | boolean) => void;
  setLabel: (id: string, label: string) => void;
  addWire: (a: string, b: string) => void;
  removeWire: (id: string) => void;
  setGround: (ref: string | undefined) => void;
  setMeta: (patch: Partial<CircuitSnapshot['meta']>) => void;
  select: (id: string | undefined) => void;
  setView: (view: View) => void;
  inspect: (commitId: string | undefined) => void;
  setCompare: (compare: { from: string; to: string } | undefined) => void;
  toggleElectricalOnly: () => void;
  togglePalette: () => void;
  startSimulation: () => Promise<void>;
  stopSimulation: () => void;
  joinRoom: (room: string, role?: SyncRole) => void;
  leaveRoom: () => void;
  applyRemoteState: (state: RoomState) => void;
  pushToRoom: () => void;
  commit: (message: string, author: string) => Promise<void>;
  createBranch: (name: string) => void;
  switchBranch: (name: string) => void;
  deleteBranch: (name: string) => void;
  restore: (commitId: string) => Promise<void>;
  checkout: (commitId: string) => void;
  toast: (tone: Toast['tone'], text: string) => void;
  dismissToast: (id: string) => void;
  loadSnapshot: (snapshot: CircuitSnapshot) => void;
};

const uuid = (): string => crypto.randomUUID();

/** Next free label for a part, e.g. R1, R2 — display only, never identity. */
function nextLabel(snapshot: CircuitSnapshot, prefix: string): string {
  const used = new Set(Object.values(snapshot.components).map((c) => c.label));
  for (let n = 1; ; n += 1) {
    const candidate = `${prefix}${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

function recheck(snapshot: CircuitSnapshot) {
  const report = runTopologyChecks({ snapshot, library: partLibrary, config });
  return { findings: report.findings, deferred: report.deferred };
}

const PALETTE_KEY = 'circuitgit.paletteOpen';

/**
 * Panel layout is a per-viewer convenience, so it lives in localStorage rather
 * than in the circuit. Storage can be unavailable (private window, blocked site
 * data), so both sides fall back to the expanded default.
 */
function readPaletteOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(PALETTE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function writePaletteOpen(open: boolean): void {
  try {
    globalThis.localStorage?.setItem(PALETTE_KEY, String(open));
  } catch {
    // Not being able to remember the layout is not worth an error.
  }
}

/** Shown whenever an edit is refused because a session is live. */
export const LOCKED_MESSAGE = 'The circuit is locked while simulating. Stop the session to edit.';

/**
 * True when an edit must be refused. The UI already disables these controls;
 * this is the backstop that makes the lock real rather than cosmetic, and it
 * covers keyboard shortcuts, drag-and-drop and anything a synced device sends.
 */
function locked(get: () => State & Actions): boolean {
  if (get().mode !== 'simulate') return false;
  get().toast('error', LOCKED_MESSAGE);
  return true;
}

/** The live socket. Kept out of state because React never needs to render it. */
let client: SyncClient | undefined;

const initialSnapshot = emptySnapshot('Untitled circuit');

export const useStore = create<State & Actions>((set, get) => ({
  repo: new Repository('local', config.versionControl.protectedBranches),
  branch: config.versionControl.defaultBranch,
  baseCommit: undefined,
  snapshot: initialSnapshot,
  ...recheck(initialSnapshot),
  selection: undefined,
  view: 'editor',
  inspecting: undefined,
  compare: undefined,
  electricalOnly: false,
  mode: 'edit',
  simulatingHash: undefined,
  paletteOpen: readPaletteOpen(),
  room: undefined,
  connection: 'offline',
  peers: [],
  roomVersion: 0,
  applyingRemote: false,
  toasts: [],
  dirty: false,

  // ---- editing ----------------------------------------------------------

  addComponent: (part, position) =>
    set((state) => {
      if (locked(get)) return {};
      const id = uuid();
      const snapshot = structuredClone(state.snapshot);
      snapshot.components[id] = {
        part: `${part.id}@${part.version}`,
        label: nextLabel(snapshot, part.labelPrefix),
        params: defaultParams(part),
      };
      snapshot.layout['2d'][id] = position;
      return { snapshot, selection: id, dirty: true, ...recheck(snapshot) };
    }),

  removeComponent: (id) =>
    set((state) => {
      if (locked(get)) return {};
      const snapshot = structuredClone(state.snapshot);
      delete snapshot.components[id];
      delete snapshot.layout['2d'][id];
      // A wire to a deleted part would dangle, so it goes too.
      for (const [wireId, wire] of Object.entries(snapshot.wires)) {
        if (wire.a.startsWith(`${id}.`) || wire.b.startsWith(`${id}.`)) {
          delete snapshot.wires[wireId];
        }
      }
      if (snapshot.settings.ground?.startsWith(`${id}.`)) delete snapshot.settings.ground;
      for (const [noteId, note] of Object.entries(snapshot.annotations)) {
        if (note.attachedTo === id)
          snapshot.annotations[noteId] = { ...note, attachedTo: 'circuit' };
      }
      return {
        snapshot,
        selection: state.selection === id ? undefined : state.selection,
        dirty: true,
        ...recheck(snapshot),
      };
    }),

  moveComponent: (id, position) =>
    set((state) => {
      if (locked(get)) return {};
      const snapshot = structuredClone(state.snapshot);
      snapshot.layout['2d'][id] = position;
      // Layout is cosmetic: no need to re-run checks.
      return { snapshot, dirty: true };
    }),

  setParam: (id, param, value) =>
    set((state) => {
      if (locked(get)) return {};
      const snapshot = structuredClone(state.snapshot);
      const component = snapshot.components[id];
      if (!component) return {};
      component.params = { ...component.params, [param]: value };
      return { snapshot, dirty: true, ...recheck(snapshot) };
    }),

  setLabel: (id, label) =>
    set((state) => {
      if (locked(get)) return {};
      const snapshot = structuredClone(state.snapshot);
      const component = snapshot.components[id];
      if (!component || label.trim() === '') return {};
      component.label = label.trim();
      return { snapshot, dirty: true, ...recheck(snapshot) };
    }),

  addWire: (a, b) =>
    set((state) => {
      if (locked(get)) return {};
      if (a === b) return {};
      const snapshot = structuredClone(state.snapshot);
      // Same connection twice is a duplicate, not a second wire (cf. C9).
      const exists = Object.values(snapshot.wires).some(
        (wire) => (wire.a === a && wire.b === b) || (wire.a === b && wire.b === a),
      );
      if (exists) return {};
      snapshot.wires[uuid()] = { a, b, style: {} };
      return { snapshot, dirty: true, ...recheck(snapshot) };
    }),

  removeWire: (id) =>
    set((state) => {
      if (locked(get)) return {};
      const snapshot = structuredClone(state.snapshot);
      delete snapshot.wires[id];
      return { snapshot, dirty: true, ...recheck(snapshot) };
    }),

  setGround: (ref) =>
    set((state) => {
      if (locked(get)) return {};
      const snapshot = structuredClone(state.snapshot);
      if (ref) snapshot.settings.ground = ref;
      else delete snapshot.settings.ground;
      return { snapshot, dirty: true, ...recheck(snapshot) };
    }),

  setMeta: (patch) =>
    set((state) => {
      if (locked(get)) return {};
      const snapshot = structuredClone(state.snapshot);
      snapshot.meta = { ...snapshot.meta, ...patch };
      return { snapshot, dirty: true, ...recheck(snapshot) };
    }),

  loadSnapshot: (next) =>
    set(() =>
      locked(get) ? {} : { snapshot: next, dirty: true, selection: undefined, ...recheck(next) },
    ),

  // ---- navigation -------------------------------------------------------

  select: (id) => set({ selection: id }),
  setView: (view) => set({ view }),
  inspect: (commitId) => set({ inspecting: commitId, compare: undefined }),
  setCompare: (compare) => set({ compare }),
  toggleElectricalOnly: () => set((state) => ({ electricalOnly: !state.electricalOnly })),

  togglePalette: () =>
    set((state) => {
      const paletteOpen = !state.paletteOpen;
      writePaletteOpen(paletteOpen);
      return { paletteOpen };
    }),

  // ---- simulation session -----------------------------------------------

  startSimulation: async () => {
    const { snapshot, findings } = get();

    if (Object.keys(snapshot.components).length === 0) {
      get().toast('error', 'Add some parts before starting a session.');
      return;
    }
    if (!snapshot.settings.ground) {
      get().toast('error', 'Set a ground reference before simulating.');
      return;
    }
    if (findings.some((finding) => finding.severity === 'error')) {
      get().toast('error', 'Fix the failing checks before starting a session.');
      return;
    }

    // The session is pinned to one electrical state. Anything mirroring this
    // circuit can compare hashes to know it is showing the same thing.
    set({ mode: 'simulate', simulatingHash: await electricalHash(snapshot) });
    get().toast(
      'info',
      'Session live — the circuit is locked. The solver is not connected yet (P2), so no values are shown.',
    );
    get().pushToRoom();
  },

  stopSimulation: () => {
    set({ mode: 'edit', simulatingHash: undefined });
    get().toast('info', 'Session stopped. The circuit is editable again.');
    get().pushToRoom();
  },

  // ---- room sync ---------------------------------------------------------

  joinRoom: (room, role = 'editor') => {
    get().leaveRoom();

    const device = deviceId();
    client = new SyncClient(room, device, role, `${role} ${device}`, {
      onState: (state) => get().applyRemoteState(state),
      onPeers: (peers) => set({ peers }),
      onStatus: (connection) => set({ connection }),
      onRejected: (reason, detail) => {
        // A rejection is not a failure to hide: the user needs to know their
        // change did not land, and why.
        get().toast('error', `Sync rejected (${reason}): ${detail}`);
      },
    });

    set({ room, roomVersion: 0, connection: 'connecting' });
    client.connect();

    // Seed an empty room with whatever this device already has.
    setTimeout(() => {
      if (client?.isOpen() && get().roomVersion === 0) get().pushToRoom();
    }, 400);
  },

  leaveRoom: () => {
    client?.disconnect();
    client = undefined;
    set({ room: undefined, connection: 'offline', peers: [], roomVersion: 0 });
  },

  applyRemoteState: (state) => {
    // Ignore anything not newer than what we hold, so a late delivery cannot
    // undo a change that has already been accepted.
    if (state.version <= get().roomVersion) return;

    set({
      applyingRemote: true,
      roomVersion: state.version,
      snapshot: state.snapshot,
      mode: state.mode,
      simulatingHash: state.simulatingHash ?? undefined,
      dirty: true,
      ...recheck(state.snapshot),
    });
    set({ applyingRemote: false });
  },

  pushToRoom: () => {
    const { room, snapshot, mode, simulatingHash, roomVersion, applyingRemote } = get();
    if (!room || !client || applyingRemote) return;

    client.send({
      type: 'push',
      snapshot,
      mode,
      simulatingHash: simulatingHash ?? null,
      baseVersion: roomVersion,
    });
  },

  // ---- version control --------------------------------------------------

  commit: async (message, author) => {
    const { repo, branch, snapshot, baseCommit, findings } = get();

    // Protected branches take no commit with a failing check (§7.5).
    const failing = findings.some((finding) => finding.severity === 'error');
    if (repo.isProtected(branch) && failing) {
      get().toast(
        'error',
        `${branch} is protected and this circuit has ${findings.filter((f) => f.severity === 'error').length} failing check(s).`,
      );
      return;
    }

    try {
      const commit = await repo.commit(branch, {
        snapshot,
        message,
        author,
        source: 'web',
        expectedHead: baseCommit,
        checks: {
          rules: failing ? 'fail' : findings.length > 0 ? 'warn' : 'pass',
          // Not run yet: reported honestly rather than assumed to pass.
          sim: 'pending',
          llm: 'unavailable',
        },
      });
      set({ baseCommit: commit.id, dirty: false, repo });
      get().toast('success', `Committed ${commit.id.slice(0, 7)}`);
    } catch (error) {
      if (error instanceof HeadMovedError) {
        get().toast('error', `${error.message} (conflict C32 — rebase or merge)`);
      } else {
        get().toast('error', error instanceof Error ? error.message : String(error));
      }
    }
  },

  createBranch: (name) => {
    const { repo, baseCommit } = get();
    if (!baseCommit) {
      get().toast('error', 'Commit something before branching.');
      return;
    }
    try {
      repo.createBranch(name, baseCommit);
      set({ branch: name, repo });
      get().toast('success', `Created ${name}`);
    } catch (error) {
      get().toast('error', error instanceof Error ? error.message : String(error));
    }
  },

  switchBranch: (name) => {
    if (locked(get)) return;
    const { repo, dirty } = get();
    if (dirty) {
      // Conflict C33: uncommitted work when the checkout target changes.
      get().toast('error', 'Commit or discard your changes before switching branch (C33).');
      return;
    }
    try {
      const head = repo.getBranch(name).head;
      set({
        branch: name,
        baseCommit: head,
        snapshot: repo.snapshotOf(head),
        selection: undefined,
        ...recheck(repo.snapshotOf(head)),
        dirty: false,
      });
    } catch (error) {
      get().toast('error', error instanceof Error ? error.message : String(error));
    }
  },

  deleteBranch: (name) => {
    const { repo, branch } = get();
    try {
      repo.deleteBranch(name);
      set({ repo });
      if (branch === name) get().switchBranch(config.versionControl.defaultBranch);
      get().toast('info', `Deleted ${name}`);
    } catch (error) {
      get().toast('error', error instanceof Error ? error.message : String(error));
    }
  },

  restore: async (commitId) => {
    if (locked(get)) return;
    const { repo, branch } = get();
    try {
      const commit = await repo.restore(branch, commitId, 'you');
      const snapshot = repo.snapshotOf(commit.id);
      set({ baseCommit: commit.id, snapshot, dirty: false, repo, ...recheck(snapshot) });
      get().toast('success', `Restored to ${commitId.slice(0, 7)}`);
    } catch (error) {
      get().toast('error', error instanceof Error ? error.message : String(error));
    }
  },

  checkout: (commitId) => {
    if (locked(get)) return;
    const { repo, dirty } = get();
    if (dirty) {
      get().toast('error', 'Commit or discard your changes first (C33).');
      return;
    }
    const snapshot = repo.snapshotOf(commitId);
    set({
      snapshot,
      baseCommit: commitId,
      selection: undefined,
      dirty: false,
      ...recheck(snapshot),
    });
  },

  // ---- toasts -----------------------------------------------------------

  toast: (tone, text) =>
    set((state) =>
      // Identical messages collapse: a blocked drag can fire many times.
      state.toasts.some((toast) => toast.text === text)
        ? {}
        : { toasts: [...state.toasts, { id: uuid(), tone, text }] },
    ),

  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

/**
 * Push local edits to the room.
 *
 * A subscription rather than a call inside every action: one place to debounce,
 * and no way to add a new editing action and forget to sync it. Dragging a part
 * fires continuously, so the push is coalesced.
 */
let pushTimer: ReturnType<typeof setTimeout> | undefined;

useStore.subscribe((state, previous) => {
  if (!state.room || state.applyingRemote) return;
  const changed =
    state.snapshot !== previous.snapshot ||
    state.mode !== previous.mode ||
    state.simulatingHash !== previous.simulatingHash;
  if (!changed) return;

  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = undefined;
    useStore.getState().pushToRoom();
  }, 120);
});

/**
 * Diff shown in the history view: an explicit pair, or a commit against its
 * parent.
 *
 * The diff is computed in a memo rather than inside the zustand selector. A
 * selector that builds a fresh array returns a new reference on every render,
 * which the store reads as a change and re-renders forever.
 */
export function useInspectedDiff(): DiffChange[] {
  const repo = useStore((state) => state.repo);
  const inspecting = useStore((state) => state.inspecting);
  const compare = useStore((state) => state.compare);
  const electricalOnly = useStore((state) => state.electricalOnly);

  return useMemo(() => {
    try {
      if (compare) return repo.diff(compare.from, compare.to, electricalOnly);
      if (!inspecting) return [];

      const parent = repo.getCommit(inspecting).parents[0];
      if (!parent) {
        // First commit: everything in it counts as an addition.
        const snapshot = repo.snapshotOf(inspecting);
        return diffSnapshots(
          { ...snapshot, components: {}, wires: {}, blocks: {}, tests: {} },
          snapshot,
          { electricalOnly },
        );
      }
      return repo.diff(parent, inspecting, electricalOnly);
    } catch {
      return [];
    }
  }, [repo, inspecting, compare, electricalOnly]);
}

export function commitList(repo: Repository): Commit[] {
  return repo.allCommits();
}

export { pinRef };
