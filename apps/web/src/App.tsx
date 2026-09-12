import { useEffect } from 'react';
import { TopBar } from './components/TopBar.js';
import { RightRail } from './components/RightRail.js';
import { useStore } from './state/store.js';
import { PART_DEFS } from './parts/catalog.js';
import { QuestBridgeProvider, useQuestBridge } from './quest/QuestBridgeContext.js';
import { CircuitEditorProvider } from './quest/CircuitEditorContext.js';
import { QuestCommitPanel } from './quest/QuestCommitPanel.js';
import { QuestMirrorCanvas } from './quest/QuestMirrorCanvas.js';
import { QuestCodeEditor } from './quest/QuestCodeEditor.js';

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) => setTimeout(() => dismiss(toast.id), 6000));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          <span>{toast.text}</span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => dismiss(toast.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/** Banner shown while a session holds the circuit still. */
function SessionBanner() {
  const simulatingHash = useStore((s) => s.simulatingHash);
  const stopSimulation = useStore((s) => s.stopSimulation);

  return (
    <div className="session-banner" role="status">
      <span className="session-banner__pulse" aria-hidden="true" />
      <span className="session-banner__main">
        <strong>Session live — circuit locked</strong>
        <span>
          Parts and wires cannot be added or changed until you stop. Pinned to{' '}
          <span className="mono">{simulatingHash?.slice(0, 7)}</span>, so a connected headset can
          confirm it is showing the same circuit.
        </span>
      </span>
      <span className="session-banner__note">
        No values shown: the solver is not connected yet.
      </span>
      <button type="button" className="btn btn--sm" onClick={stopSimulation}>
        Stop session
      </button>
    </div>
  );
}

function StatusBar() {
  const branch = useStore((s) => s.branch);
  const baseCommit = useStore((s) => s.baseCommit);
  const dirty = useStore((s) => s.dirty);
  // Counts come from the live bridge circuit, which is what the canvas draws —
  // whether it was built here or on the headset.
  const { circuit, checkResult, checking } = useQuestBridge();

  const parts = (circuit?.components?.length ?? 0) + (circuit?.board ? 1 : 0);
  const wires = circuit?.wires?.length ?? 0;
  const faults = checkResult?.faults.length ?? 0;

  return (
    <footer className="statusbar">
      <span>{parts} parts</span>
      <span>{wires} wires</span>
      <span>{PART_DEFS.length} parts in palette</span>
      <span className="statusbar__spacer" />
      <span className={!checking && checkResult && !checkResult.ok ? 'statusbar__error' : undefined}>
        {checking
          ? 'checking…'
          : !checkResult
            ? 'not checked yet'
            : checkResult.ok
              ? 'checks clear'
              : `${faults || 1} findings`}
      </span>
      <span>
        on <strong>{branch}</strong>
      </span>
      <span className="mono">{baseCommit ? baseCommit.slice(0, 7) : 'no commits'}</span>
      {dirty && <span className="statusbar__dirty">uncommitted</span>}
    </footer>
  );
}

function Workspace() {
  const { workspaceView } = useQuestBridge();

  return (
    <main className="workspace">
      <QuestCommitPanel />
      {workspaceView === 'ide' ? <QuestCodeEditor /> : <QuestMirrorCanvas />}
      <RightRail />
    </main>
  );
}

export function App() {
  const mode = useStore((s) => s.mode);

  return (
    <QuestBridgeProvider>
      <CircuitEditorProvider>
        <div className={`app${mode === 'simulate' ? ' app--locked' : ''}`}>
          <TopBar />
          {mode === 'simulate' && <SessionBanner />}

          <Workspace />

          <StatusBar />
          <Toasts />
        </div>
      </CircuitEditorProvider>
    </QuestBridgeProvider>
  );
}
