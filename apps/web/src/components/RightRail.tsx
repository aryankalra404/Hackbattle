import { useState } from 'react';
import { partLibrary } from '../state/library.js';
import { Palette } from './Palette.js';
import { QuestContextPanel } from '../quest/QuestContextPanel.js';
import { QuestChecksPanel } from '../quest/QuestChecksPanel.js';
import { useQuestBridge } from '../quest/QuestBridgeContext.js';

/**
 * The right rail: Parts (drag onto the canvas — same palette that drives the
 * web and, later, the VR builder, so both stay in sync off one source), a
 * Context tab (what you're building, sent to the LLM checker), and Checks
 * (the live LLM + rules check on the circuit built on the Quest).
 *
 * One tab fills the whole rail at a time instead of three panels each
 * fighting for a third of the height — the thing that made every one of them
 * need its own cramped scroll area.
 */

type Tab = 'parts' | 'context' | 'checks';

export function RightRail() {
  const [tab, setTab] = useState<Tab>('parts');
  const { checkResult, checking } = useQuestBridge();

  return (
    <div className="rightrail">
      <nav className="rightrail__tabs" aria-label="Right rail">
        <button
          type="button"
          className={`tab${tab === 'parts' ? ' tab--on' : ''}`}
          onClick={() => setTab('parts')}
        >
          Parts
          <span className="chip">{partLibrary.all().length}</span>
        </button>
        <button
          type="button"
          className={`tab${tab === 'context' ? ' tab--on' : ''}`}
          onClick={() => setTab('context')}
        >
          Context
        </button>
        <button
          type="button"
          className={`tab${tab === 'checks' ? ' tab--on' : ''}`}
          onClick={() => setTab('checks')}
        >
          Checks
          {checking && <span className="badge badge--pending">…</span>}
          {!checking && checkResult && (
            <span className={`badge ${checkResult.ok ? 'badge--pass' : 'badge--fail'}`}>
              {checkResult.ok ? 'clear' : checkResult.faults.length}
            </span>
          )}
        </button>
      </nav>

      <div className="rightrail__panel" hidden={tab !== 'parts'}>
        <Palette embedded />
      </div>
      <div className="rightrail__panel" hidden={tab !== 'context'}>
        <QuestContextPanel />
      </div>
      <div className="rightrail__panel" hidden={tab !== 'checks'}>
        <QuestChecksPanel />
      </div>
    </div>
  );
}
