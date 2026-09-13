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
  hasCode: boolean;
};

/** One fault the LLM found and the RAG-grounded verifier checked. */
export type QuestFault = {
  componentId: string;
  issue: string;
  verdict?: 'confirmed' | 'corrected' | 'uncertain';
  finalMessage?: string;
  groundedOn?: string;
};

/** `circuit:result` — the live LLM+rules check on whatever is currently wired. */
export type QuestCheckResult = {
  ok: boolean;
  message: string;
  confidence: 'confirmed' | 'corrected' | 'uncertain' | null;
  groundedOn: string | null;
  suspectedComponent: string | null;
  suspectedComponents: string[];
  faults: QuestFault[];
};

export type QuestChatTurn = { role: 'user' | 'assistant'; content: string };

/** Which pane fills the centre of the workspace: the circuit mirror or the code editor. */
export type WorkspaceView = 'circuit' | 'ide';

/** One compiler error from a failed `code:simulate` compile stage. */
export type QuestCompileError = { line: number | null; column: number | null; message: string };

/** One LED the simulator found actually driven by the compiled sketch. */
export type QuestSimulatedLed = {
  ledId: string;
  pin: string;
  pattern: 'on' | 'off' | 'blink' | 'pattern';
  onMs?: number;
  offMs?: number;
};

/** `code:simulate-result` — compiles first; only simulates LED behavior if that succeeds. */
export type QuestSimulateResult =
  | { ok: false; stage: 'compile'; errors: QuestCompileError[] }
  | { ok: true; stage: 'simulate'; leds: QuestSimulatedLed[]; warnings: string[] };

/** `sensor:proximity` — a live, continuous signal from Unity (not the one-shot
 * code:simulate), separate from simulateResult so it never fights the last
 * compiled sketch's result: a hand near the ultrasonic prop lights whichever
 * wired LEDs Unity reports, live, regardless of what code is loaded. */
export type QuestProximityEvent = { near: boolean; ledStates?: Record<string, boolean> };

type QuestBridgeState = {
  workspaceView: WorkspaceView;
  setWorkspaceView: (view: WorkspaceView) => void;
  serverUrl: string;
  setServerUrl: (value: string) => void;
  sessionId: string;
  setSessionId: (value: string) => void;
  connected: boolean;
  connect: () => void;
  circuit: QuestCircuit | null;
  code: string;
  setCode: (code: string) => void;
  simulateResult: QuestSimulateResult | null;
  simulating: boolean;
  runSimulation: () => void;
  proximityNear: boolean;
  proximityLedStates: Record<string, boolean>;
  commits: QuestCommitSummary[];
  error: string | null;
  busy: string | null;
  createCommit: (message: string, author: string) => void;
  loadCommit: (commitId: string) => void;
  clearCommits: () => void;
  intent: string;
  setIntent: (intent: string) => void;
  checkResult: QuestCheckResult | null;
  checking: boolean;
  chatHistory: QuestChatTurn[];
  chatPending: boolean;
  language: string;
  setLanguage: (language: string) => void;
  sendChatMessage: (message: string) => void;
  sendVoiceMessage: (audioDataUrl: string) => void;
};

const DEFAULTS = { serverUrl: 'http://localhost:3001', sessionId: 'demo-room', language: 'en' };

export const SUPPORTED_LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'ja', label: 'Japanese' },
];

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
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('circuit');
  const [serverUrl, setServerUrl] = useState(() =>
    loadDefault('circuitdoctor.serverUrl', DEFAULTS.serverUrl),
  );
  const [sessionId, setSessionId] = useState(() =>
    loadDefault('circuitdoctor.sessionId', DEFAULTS.sessionId),
  );
  const [connected, setConnected] = useState(false);
  const [circuit, setCircuit] = useState<QuestCircuit | null>(null);
  const [code, setCodeState] = useState('');
  const [simulateResult, setSimulateResult] = useState<QuestSimulateResult | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [proximityNear, setProximityNear] = useState(false);
  const [proximityLedStates, setProximityLedStates] = useState<Record<string, boolean>>({});
  const [commits, setCommits] = useState<QuestCommitSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [intent, setIntentState] = useState('');
  const [checkResult, setCheckResult] = useState<QuestCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [chatHistory, setChatHistory] = useState<QuestChatTurn[]>([]);
  const [chatPending, setChatPending] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const intentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    socket.on('disconnect', () => {
      setConnected(false);
      // A check or a simulation in flight when the socket drops would
      // otherwise stay stuck on "Checking..."/"Simulating..." forever.
      setChecking(false);
      setSimulating(false);
    });
    socket.on('connect_error', (err: Error) => setError(`Could not connect: ${err.message}`));

    socket.on('circuit:update', (payload: { circuit: QuestCircuit }) => {
      setCircuit(payload.circuit);
      // The server debounces ~1.2s after the last change before it re-checks,
      // so this stays true through that window plus the LLM call itself.
      setChecking(true);
    });
    socket.on('circuit:result', (payload: QuestCheckResult) => {
      setCheckResult(payload);
      setChecking(false);
    });
    // Not sent by this tab's own edits (server.js excludes the sender), so
    // this only fires for another open tab's changes or a fresh session:join.
    socket.on('code:update', (payload: { code: string }) => {
      setCodeState(payload.code);
    });
    socket.on('code:simulate-result', (payload: QuestSimulateResult) => {
      setSimulateResult(payload);
      setSimulating(false);
    });
    // Continuous live signal from UltrasonicProximityController.cs, not tied
    // to any compiled sketch — a hand near the sensor prop lights whichever
    // wired LEDs Unity reports, independent of the last code:simulate result.
    socket.on('sensor:proximity', (payload: QuestProximityEvent) => {
      setProximityNear(!!payload.near);
      if (payload.ledStates) setProximityLedStates((prev) => ({ ...prev, ...payload.ledStates }));
    });
    socket.on('commit:list', (payload: { commits: QuestCommitSummary[] }) => {
      setCommits(payload.commits);
      setBusy(null);
    });
    socket.on('commit:created', () => setBusy(null));
    socket.on('commit:restore', (payload: { circuit: QuestCircuit; code: string }) => {
      setCircuit(payload.circuit);
      setCodeState(payload.code);
      setChecking(true);
      setBusy(null);
    });
    socket.on('commit:error', (payload: { message: string }) => {
      setError(payload.message);
      setBusy(null);
    });
    socket.on('chat:response', (payload: { ok: boolean; message: string }) => {
      setChatHistory((history) => [...history, { role: 'assistant', content: payload.message }]);
      setChatPending(false);
    });
    // Broadcast to the whole room (server.js), so a question spoken on the
    // Quest shows up here too, and one typed/spoken here still gets spoken
    // back out of the headset — the transcript arrives with the reply since
    // this client never sent the text itself.
    socket.on(
      'chat:voice-response',
      (payload: { ok: boolean; transcript?: string; message: string; audioUrl?: string }) => {
        setChatHistory((history) => {
          const next = [...history];
          if (payload.transcript) next.push({ role: 'user', content: payload.transcript });
          next.push({ role: 'assistant', content: payload.message });
          return next;
        });
        setChatPending(false);
      },
    );

    saveDefault('circuitdoctor.serverUrl', serverUrl);
    saveDefault('circuitdoctor.sessionId', sessionId);
  }, [serverUrl, sessionId]);

  useEffect(() => {
    connect();
    return () => {
      socketRef.current?.disconnect();
      if (intentDebounceRef.current) clearTimeout(intentDebounceRef.current);
      if (codeDebounceRef.current) clearTimeout(codeDebounceRef.current);
    };
    // Only auto-connect once on mount with whatever was last saved; further
    // connects happen explicitly when the user edits the fields and reconnects.
  }, []);

  const setIntent = useCallback(
    (value: string) => {
      setIntentState(value);
      if (intentDebounceRef.current) clearTimeout(intentDebounceRef.current);
      intentDebounceRef.current = setTimeout(() => {
        if (!socketRef.current || !connected) return;
        socketRef.current.emit('circuit:intent', { sessionId, intent: value });
        setChecking(true);
      }, 600);
    },
    [connected, sessionId],
  );

  const setCode = useCallback(
    (value: string) => {
      setCodeState(value);
      if (codeDebounceRef.current) clearTimeout(codeDebounceRef.current);
      codeDebounceRef.current = setTimeout(() => {
        if (!socketRef.current || !connected) return;
        socketRef.current.emit('code:update', { sessionId, code: value });
      }, 500);
    },
    [connected, sessionId],
  );

  const runSimulation = useCallback(() => {
    if (!socketRef.current || !connected) return;
    setSimulating(true);
    setSimulateResult(null);
    socketRef.current.emit('code:simulate', { sessionId });
  }, [connected, sessionId]);

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

  const clearCommits = useCallback(() => {
    if (!socketRef.current || !connected) return;
    if (!window.confirm('Clear all commit history for this session? This cannot be undone.')) return;
    socketRef.current.emit('commit:clear', { sessionId });
  }, [connected, sessionId]);

  const [language, setLanguageState] = useState(() => loadDefault('circuitdoctor.language', DEFAULTS.language));

  const setLanguage = useCallback((lang: string) => {
    setLanguageState(lang);
    try { window.localStorage.setItem('circuitdoctor.language', lang); } catch { /* ignore */ }
  }, []);

  const sendChatMessage = useCallback(
    (message: string) => {
      const text = message.trim();
      if (!socketRef.current || !connected || !text) return;
      setChatHistory((history) => [...history, { role: 'user', content: text }]);
      setChatPending(true);
      socketRef.current.emit('chat:message', { sessionId, message: text, language });
    },
    [connected, sessionId, language],
  );

  const sendVoiceMessage = useCallback(
    (audioDataUrl: string) => {
      if (!socketRef.current || !connected) return;
      setChatPending(true);
      socketRef.current.emit('chat:voice', { sessionId, audioUrl: audioDataUrl, voiceReply: true, language });
    },
    [connected, sessionId, language],
  );

  const value: QuestBridgeState = {
    workspaceView,
    setWorkspaceView,
    serverUrl,
    setServerUrl,
    sessionId,
    setSessionId,
    connected,
    connect,
    circuit,
    code,
    setCode,
    simulateResult,
    simulating,
    runSimulation,
    proximityNear,
    proximityLedStates,
    commits,
    error,
    busy,
    createCommit,
    loadCommit,
    clearCommits,
    intent,
    setIntent,
    checkResult,
    checking,
    chatHistory,
    chatPending,
    language,
    setLanguage,
    sendChatMessage,
    sendVoiceMessage,
  };

  return <QuestBridgeCtx.Provider value={value}>{children}</QuestBridgeCtx.Provider>;
}

export function useQuestBridge(): QuestBridgeState {
  const ctx = useContext(QuestBridgeCtx);
  if (!ctx) throw new Error('useQuestBridge must be used within a QuestBridgeProvider');
  return ctx;
}
