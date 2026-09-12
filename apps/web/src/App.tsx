import { useEffect } from 'react';
import { TopBar } from './components/TopBar.js';
import { RightRail } from './components/RightRail.js';
import { History } from './components/History.js';
import { useStore } from './state/store.js';
import { partLibrary } from './state/library.js';
import { QuestBridgeProvider } from './quest/QuestBridgeContext.js';
import { QuestCommitPanel } from './quest/QuestCommitPanel.js';
import { QuestMirrorCanvas } from './quest/QuestMirrorCanvas.js';

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
  const snapshot = useStore((s) => s.snapshot);
  const findings = useStore((s) => s.findings);
  const branch = useStore((s) => s.branch);
  const baseCommit = useStore((s) => s.baseCommit);
  const dirty = useStore((s) => s.dirty);

  const errors = findings.filter((finding) => finding.severity === 'error').length;

  return (
    <footer className="statusbar">
      <span>{Object.keys(snapshot.components).length} parts</span>
      <span>{Object.keys(snapshot.wires).length} wires</span>
      <span>{partLibrary.all().length} parts in library</span>
      <span className="statusbar__spacer" />
      <span className={errors > 0 ? 'statusbar__error' : undefined}>
        {findings.length === 0 ? 'checks clear' : `${findings.length} findings`}
      </span>
      <span>
        on <strong>{branch}</strong>
      </span>
      <span className="mono">{baseCommit ? baseCommit.slice(0, 7) : 'no commits'}</span>
      {dirty && <span className="statusbar__dirty">uncommitted</span>}
    </footer>
  );
}

export function App() {
  const view = useStore((s) => s.view);
  const mode = useStore((s) => s.mode);

  return (
    <div className={`app${mode === 'simulate' ? ' app--locked' : ''}`}>
      <TopBar />
      {mode === 'simulate' && <SessionBanner />}

      {view === 'editor' ? (
        <QuestBridgeProvider>
          <main className="workspace">
            <QuestCommitPanel />
            <QuestMirrorCanvas />
            <RightRail />
          </main>
        </QuestBridgeProvider>
      ) : (
        <main className="workspace workspace--history">
          <History />
        </main>
      )}

      <StatusBar />
      <Toasts />
    </div>
  );
}
