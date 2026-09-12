"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

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
    // Private browsing or storage disabled — the field just won't persist.
  }
}

export default function Home() {
  const [serverUrl, setServerUrl] = useState(() => loadDefault("circuitdoctor.serverUrl", DEFAULTS.serverUrl));
  const [sessionId, setSessionId] = useState(() => loadDefault("circuitdoctor.sessionId", DEFAULTS.sessionId));
  const [connected, setConnected] = useState(false);
  const [circuit, setCircuit] = useState<Circuit | null>(null);
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [message, setMessage] = useState("");
  const [author, setAuthor] = useState("web");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const connect = useCallback(() => {
    socketRef.current?.disconnect();
    setError(null);

    const socket = io(serverUrl, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("session:join", { sessionId });
      socket.emit("commit:list", { sessionId });
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (err: Error) => setError(`Could not connect: ${err.message}`));

    socket.on("circuit:update", (payload: { circuit: Circuit }) => {
      setCircuit(payload.circuit);
    });
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
      setBusy(null);
    });
    socket.on("commit:error", (payload: { message: string }) => {
      setError(payload.message);
      setBusy(null);
    });

    saveDefault("circuitdoctor.serverUrl", serverUrl);
    saveDefault("circuitdoctor.sessionId", sessionId);
  }, [serverUrl, sessionId]);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

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

  const componentCount = circuit?.components?.length ?? 0;
  const wireCount = circuit?.wires?.length ?? 0;

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 py-10 font-sans dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col gap-8">
        <header>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            CircuitDoctor — Commits
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Version control for the circuit being built live on the Quest.
          </p>
        </header>

        <section className="flex flex-col gap-3 rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500">Bridge server URL</label>
            <input
              className="rounded-md border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://192.168.1.5:3001"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500">Session ID</label>
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

        <section className="rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Live mirror
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {componentCount} component{componentCount === 1 ? "" : "s"}, {wireCount} wire
            {wireCount === 1 ? "" : "s"}
          </p>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Commit</h2>
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

        <section className="flex flex-col gap-3 rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">History</h2>
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
                    <span className="font-mono">{commit.id}</span> · {commit.author} ·{" "}
                    {new Date(commit.createdAt).toLocaleString()} · {commit.componentCount}{" "}
                    components, {commit.wireCount} wires
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
