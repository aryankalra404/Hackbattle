import { useState } from 'react';
import { useStore } from '../state/store.js';
import { config } from '../state/library.js';
import { BranchMenu } from './BranchMenu.js';
import { CommitDialog } from './CommitDialog.js';
import { RoomMenu } from './RoomMenu.js';

/** Icons are inline so the app pulls in no icon dependency. */
function Icon({ path, size = 16 }: { path: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  branch:
    'M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.49 2.49 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z',
  history:
    'M1.643 3.143.427 1.927A.25.25 0 0 0 0 2.104V5.75c0 .138.112.25.25.25h3.646a.25.25 0 0 0 .177-.427L2.715 4.215a6.5 6.5 0 1 1-1.18 4.458.75.75 0 0 0-1.493.154 8.001 8.001 0 1 0 1.6-5.684ZM7.75 4a.75.75 0 0 1 .75.75v3.19l2.28 1.32a.75.75 0 1 1-.75 1.3l-2.655-1.535A.75.75 0 0 1 7 8.375v-3.625A.75.75 0 0 1 7.75 4Z',
  play: 'M4.25 3v10l8.5-5-8.5-5Z',
  stop: 'M4 4.75A.75.75 0 0 1 4.75 4h6.5a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-.75.75h-6.5a.75.75 0 0 1-.75-.75v-6.5Z',
  lock: 'M4 4a4 4 0 1 1 8 0v2h.25c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5C2 6.784 2.784 6 3.75 6H4V4Zm1.5 2h5V4a2.5 2.5 0 0 0-5 0v2Z',
  scan: 'M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0Zm7.25-3.25a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 1.5 0v-3.5ZM8 10.5A.75.75 0 1 0 8 12a.75.75 0 0 0 0-1.5Z',
  edit: 'M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Z',
  logo: 'M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM4.5 8a1 1 0 1 1 2 0 1 1 0 0 1-2 0Zm5 0a1 1 0 1 1 2 0 1 1 0 0 1-2 0ZM3 7.25h1a.75.75 0 0 1 0 1.5H3a.75.75 0 0 1 0-1.5Zm4 0h2a.75.75 0 0 1 0 1.5H7a.75.75 0 0 1 0-1.5Zm5 0h1a.75.75 0 0 1 0 1.5h-1a.75.75 0 0 1 0-1.5Z',
};

export function TopBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const snapshot = useStore((s) => s.snapshot);
  const setMeta = useStore((s) => s.setMeta);
  const dirty = useStore((s) => s.dirty);
  const findings = useStore((s) => s.findings);
  const toast = useStore((s) => s.toast);
  const mode = useStore((s) => s.mode);
  const startSimulation = useStore((s) => s.startSimulation);
  const stopSimulation = useStore((s) => s.stopSimulation);

  const [committing, setCommitting] = useState(false);
  const [editingName, setEditingName] = useState(false);

  const errors = findings.filter((finding) => finding.severity === 'error').length;

  return (
    <header className="topbar">
      <div className="topbar__left">
        <span className="brand">
          <Icon path={ICONS.logo} size={20} />
          <span className="brand__name">{config.product.name}</span>
        </span>

        <span className="topbar__divider" />

        {editingName ? (
          <input
            className="input topbar__name-input"
            autoFocus
            value={snapshot.meta.name}
            onChange={(event) => setMeta({ name: event.target.value })}
            onBlur={() => setEditingName(false)}
            onKeyDown={(event) => event.key === 'Enter' && setEditingName(false)}
          />
        ) : (
          <button
            type="button"
            className="topbar__name"
            onClick={() => setEditingName(true)}
            title="Rename circuit"
          >
            {snapshot.meta.name || 'Untitled circuit'}
            <Icon path={ICONS.edit} size={12} />
          </button>
        )}

        <BranchMenu icon={<Icon path={ICONS.branch} />} />
      </div>

      <nav className="topbar__tabs" aria-label="Views">
        <button
          type="button"
          className={`tab${view === 'editor' ? ' tab--on' : ''}`}
          onClick={() => setView('editor')}
        >
          Build
        </button>
        <button
          type="button"
          className={`tab${view === 'history' ? ' tab--on' : ''}`}
          onClick={() => setView('history')}
        >
          <Icon path={ICONS.history} size={13} />
          History
        </button>
      </nav>

      <div className="topbar__right">
        <RoomMenu />
        <span className="topbar__divider" />

        {mode === 'simulate' ? (
          <button
            type="button"
            className="btn btn--stop"
            title="Stop the session and unlock the circuit"
            onClick={stopSimulation}
          >
            <Icon path={ICONS.stop} size={11} />
            Stop session
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            title="Start a simulation session — the circuit locks while it runs"
            onClick={() => void startSimulation()}
          >
            <Icon path={ICONS.play} size={13} />
            Simulate
          </button>
        )}

        <button
          type="button"
          className="btn"
          disabled={mode === 'simulate'}
          title="Explain what is wrong"
          onClick={() =>
            toast(
              'info',
              `Topology checks are live: ${findings.length} finding(s) in the right-hand panel. LLM explanations arrive with the gateway (P4).`,
            )
          }
        >
          <Icon path={ICONS.scan} size={13} />
          Detect
        </button>

        <span className="topbar__divider" />

        <button
          type="button"
          className="btn btn--primary"
          disabled={
            mode === 'simulate' || (!dirty && Object.keys(snapshot.components).length === 0)
          }
          onClick={() => setCommitting(true)}
        >
          Commit
          {dirty && <span className="dot" title="Uncommitted changes" />}
        </button>
      </div>

      {committing && <CommitDialog errorCount={errors} onClose={() => setCommitting(false)} />}
    </header>
  );
}
