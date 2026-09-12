import { useState } from 'react';
import { useQuestBridge } from './QuestBridgeContext.js';

/**
 * Left rail: connection status, a commit message, and the commit history for
 * the circuit being built live on the Quest — separate from CircuitGit's own
 * commit graph (the "Commit" button in the top bar).
 */
export function QuestCommitPanel() {
  const {
    serverUrl,
    setServerUrl,
    sessionId,
    setSessionId,
    connected,
    connect,
    circuit,
    code,
    commits,
    error,
    busy,
    createCommit,
    loadCommit,
  } = useQuestBridge();

  const [settingsOpen, setSettingsOpen] = useState(!connected);
  const [message, setMessage] = useState('');
  const author = 'quest';

  const componentCount = circuit?.components?.length ?? 0;
  const hasCode = code.trim().length > 0;

  return (
    <section className="panel quest-panel">
      <div className="panel__header">
        Quest
        <span className={`badge ${connected ? 'badge--pass' : 'badge--pending'}`}>
          {connected ? 'connected' : 'offline'}
        </span>
        <span className="panel__header-actions">
          <button
            type="button"
            className="panel__collapse"
            title="Connection settings"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            ⚙
          </button>
        </span>
      </div>

      {settingsOpen && (
        <div className="quest-panel__settings">
          <label className="field">
            <span className="field__label">Bridge server URL</span>
            <input
              className="input"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://192.168.1.5:3001"
            />
          </label>
          <label className="field">
            <span className="field__label">Session ID</span>
            <input
              className="input"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              placeholder="demo-room"
            />
          </label>
          <button type="button" className="btn btn--sm" onClick={connect}>
            {connected ? 'Reconnect' : 'Connect'}
          </button>
        </div>
      )}

      {error && <p className="quest-panel__error">{error}</p>}

      <div className="quest-panel__commit">
        <label className="field">
          <span className="field__label">Commit message</span>
          <textarea
            className="input quest-panel__message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What did you build on the Quest?"
            rows={2}
          />
        </label>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={!connected || (componentCount === 0 && !hasCode) || busy !== null}
          onClick={() => {
            createCommit(message, author);
            setMessage('');
          }}
        >
          {busy === 'commit' ? 'Committing…' : 'Commit build'}
        </button>
      </div>

      <div className="panel__header quest-panel__history-header">
        History
        <span className="chip">{commits.length}</span>
      </div>
      <div className="scroll quest-panel__list">
        {commits.length === 0 && (
          <p className="empty">Build something on the Quest, then commit it.</p>
        )}
        {commits.map((commit) => (
          <div key={commit.id} className="quest-commit">
            <div className="quest-commit__main">
              <span className="commit__message">{commit.message}</span>
              <span className="commit__meta">
                <span className="mono">{commit.id}</span>
                <span>·</span>
                <span>{commit.author}</span>
              </span>
              <span className="commit__meta">
                {new Date(commit.createdAt).toLocaleString()} · {commit.componentCount} parts,{' '}
                {commit.wireCount} wires{commit.hasCode ? ' · code' : ''}
              </span>
            </div>
            <button
              type="button"
              className="btn btn--sm"
              disabled={!connected || busy !== null}
              onClick={() => loadCommit(commit.id)}
            >
              {busy === commit.id ? '…' : 'Load'}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
