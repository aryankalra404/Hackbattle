import { useState } from 'react';
import { useStore } from '../state/store.js';

/**
 * Commit dialog.
 *
 * The message field would be pre-filled by the change_summarizer job once the
 * LLM gateway exists (P4). Until then it is left to the user rather than filled
 * with a canned string — the build rules forbid fake model output.
 */
export function CommitDialog({ errorCount, onClose }: { errorCount: number; onClose: () => void }) {
  const commit = useStore((s) => s.commit);
  const branch = useStore((s) => s.branch);
  const repo = useStore((s) => s.repo);
  const findings = useStore((s) => s.findings);
  const snapshot = useStore((s) => s.snapshot);

  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const isProtected = repo.isProtected(branch);
  const blocked = isProtected && errorCount > 0;
  const parts = Object.keys(snapshot.components).length;
  const wires = Object.keys(snapshot.wires).length;

  const submit = async () => {
    if (message.trim() === '' || blocked) return;
    setBusy(true);
    await commit(message.trim(), 'you');
    setBusy(false);
    onClose();
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Commit changes">
      <div className="dialog">
        <header className="dialog__head">
          <h2>Commit to {branch}</h2>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="dialog__body">
          <div className="commit-stats">
            <span>
              <strong>{parts}</strong> part{parts === 1 ? '' : 's'}
            </span>
            <span>
              <strong>{wires}</strong> wire{wires === 1 ? '' : 's'}
            </span>
            <span>
              <strong>{findings.length}</strong> finding{findings.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="field">
            <span className="field__label">Message</span>
            <input
              className="input"
              autoFocus
              placeholder="Describe what changed"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void submit()}
            />
            <span className="field__hint">
              The change summarizer will suggest a message once the LLM gateway is connected (P4).
            </span>
          </div>

          <div className="check-preview">
            <span className="check-preview__title">Badges this commit will carry</span>
            <div className="check-preview__row">
              <span
                className={`badge badge--${errorCount > 0 ? 'fail' : findings.length > 0 ? 'warn' : 'pass'}`}
              >
                rules {errorCount > 0 ? 'fail' : findings.length > 0 ? 'warn' : 'pass'}
              </span>
              <span className="badge badge--pending">sim pending</span>
              <span className="badge badge--unavailable">llm unavailable</span>
            </div>
            <p className="field__hint">
              Simulation and LLM checks are reported as pending and unavailable because those layers
              are not connected yet. They are never reported as passing on assumption.
            </p>
          </div>

          {blocked && (
            <p className="callout callout--danger">
              <strong>{branch} is protected.</strong> It will not accept a commit with {errorCount}{' '}
              failing check{errorCount === 1 ? '' : 's'}. Fix them, or commit to a branch instead.
            </p>
          )}
        </div>

        <footer className="dialog__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--success"
            disabled={message.trim() === '' || blocked || busy}
            onClick={() => void submit()}
          >
            {busy ? 'Committing…' : 'Commit'}
          </button>
        </footer>
      </div>
    </div>
  );
}
