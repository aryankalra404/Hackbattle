import { useQuestBridge } from './QuestBridgeContext.js';

/**
 * What the user is building, in their own words. Sent to the bridge server
 * as `circuit:intent`, which folds it into the next LLM check (see
 * `socket-server/reasoning/openaiCircuitReasoner.js`'s `intentAddendum`) so
 * the checker can also catch "wired correctly but doesn't do what you said"
 * faults, not just per-component wiring mistakes. Optional — with nothing
 * here the checker still runs, just without that extra pass.
 */
export function QuestContextPanel() {
  const { intent, setIntent, connected } = useQuestBridge();

  return (
    <section className="panel quest-context">
      <div className="quest-context__body">
        <label className="field">
          <span className="field__label">What are you building?</span>
          <textarea
            className="input quest-context__textarea"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="e.g. A motion-activated LED — the PIR should turn on the LED when it detects movement."
            rows={6}
            disabled={!connected}
          />
          <span className="field__hint">
            Sent to the checker with every LLM pass. It can then flag a circuit that is
            wired correctly per-component but doesn't do what you described — not just
            wiring mistakes.
          </span>
        </label>
      </div>
    </section>
  );
}
