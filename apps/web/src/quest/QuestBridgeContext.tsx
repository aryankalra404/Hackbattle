import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';

/**
 * Live connection to the CircuitDoctor Socket.IO bridge (`socket-server/`),
 * the same one `QuestCircuitBridge.cs` on the headset talks to.
 *
 * Deliberately independent of the CircuitGit store/schema: the Quest app is
 * native Unity/OVR, not WebXR, so it streams its own simple wire protocol
 * (`circuit:update`, `commit:*`) rather than a CircuitSnapshot. This context
 * is shared by the commit panel (left rail) and the 2D mirror (canvas) so
 * both read one live connection instead of opening their own.
 */

export type QuestComponentEntry = {
  id: string;
  type: string;
  pos?: { x: number; y: number; z: number };
  rot?: { x: number; y: number; z: number; w: number };
  [key: string]: unknown;
};

export type QuestCircuit = {
  components?: QuestComponentEntry[];
  wires?: { from: string; to: string }[];
  board?: { pos: { x: number; y: number; z: number } };
};

export type QuestCommitSummary = {
  id: string;
  message: string;
  author: string;
  createdAt: string;
  parentId: string | null;
  componentCount: number;
  wireCount: number;
};

type QuestBridgeState = {
  serverUrl: string;
  setServerUrl: (value: string) => void;
  sessionId: string;
  setSessionId: (value: string) => void;
  connected: boolean;
  connect: () => void;
  circuit: QuestCircuit | null;
  commits: QuestCommitSummary[];
  error: string | null;
  busy: string | null;
  createCommit: (message: string, author: string) => void;
  loadCommit: (commitId: string) => void;
};

const DEFAULTS = { serverUrl: 'http://localhost:3001', sessionId: 'demo-room' };

function loadDefault(key: string, fallback: string): string {
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
    // Private browsing or storage disabled — the field just won't persist.
  }
}

const QuestBridgeCtx = createContext<QuestBridgeState | null>(null);

export function QuestBridgeProvider({ children }: { children: ReactNode }) {
  const [serverUrl, setServerUrl] = useState(() =>
    loadDefault('circuitdoctor.serverUrl', DEFAULTS.serverUrl),
  );
  const [sessionId, setSessionId] = useState(() =>
    loadDefault('circuitdoctor.sessionId', DEFAULTS.sessionId),
  );
  const [connected, setConnected] = useState(false);
  const [circuit, setCircuit] = useState<QuestCircuit | null>(null);
  const [commits, setCommits] = useState<QuestCommitSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const connect = useCallback(() => {
    socketRef.current?.disconnect();
    setError(null);

    const socket = io(serverUrl, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('session:join', { sessionId });
      socket.emit('commit:list', { sessionId });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err: Error) => setError(`Could not connect: ${err.message}`));

    socket.on('circuit:update', (payload: { circuit: QuestCircuit }) =>
      setCircuit(payload.circuit),
    );
    socket.on('commit:list', (payload: { commits: QuestCommitSummary[] }) => {
      setCommits(payload.commits);
      setBusy(null);
    });
    socket.on('commit:created', () => setBusy(null));
    socket.on('commit:restore', (payload: { circuit: QuestCircuit }) => {
      setCircuit(payload.circuit);
      setBusy(null);
    });
    socket.on('commit:error', (payload: { message: string }) => {
      setError(payload.message);
      setBusy(null);
    });

    saveDefault('circuitdoctor.serverUrl', serverUrl);
    saveDefault('circuitdoctor.sessionId', sessionId);
  }, [serverUrl, sessionId]);

  useEffect(() => {
    connect();
    return () => {
      socketRef.current?.disconnect();
    };
    // Only auto-connect once on mount with whatever was last saved; further
    // connects happen explicitly when the user edits the fields and reconnects.
  }, []);

  const createCommit = useCallback(
    (message: string, author: string) => {
      if (!socketRef.current || !connected) return;
      setBusy('commit');
      setError(null);
      socketRef.current.emit('commit:create', { sessionId, message, author });
    },
    [connected, sessionId],
  );

  const loadCommit = useCallback(
    (commitId: string) => {
      if (!socketRef.current || !connected) return;
      setBusy(commitId);
      setError(null);
      socketRef.current.emit('commit:load', { sessionId, commitId });
    },
    [connected, sessionId],
  );

  const value: QuestBridgeState = {
    serverUrl,
    setServerUrl,
    sessionId,
    setSessionId,
    connected,
    connect,
    circuit,
    commits,
    error,
    busy,
    createCommit,
    loadCommit,
  };

  return <QuestBridgeCtx.Provider value={value}>{children}</QuestBridgeCtx.Provider>;
}

export function useQuestBridge(): QuestBridgeState {
  const ctx = useContext(QuestBridgeCtx);
  if (!ctx) throw new Error('useQuestBridge must be used within a QuestBridgeProvider');
  return ctx;
}
