import { useQuestBridge, type QuestFault } from './QuestBridgeContext.js';

/**
 * Live LLM + rules checks on whatever is currently wired on the Quest —
 * `circuit:result` from the bridge server. The server already re-runs this
 * ~1.2s after the last `circuit:update` (see `socket-server/server.js`), so
 * this panel is purely a renderer: it never triggers a check itself.
 *
 * Basic per-component faults (e.g. an LED wired backwards, a PIR's GND/VCC
 * swapped) are caught even with no context set; the Context tab's stated
 * intent adds a second pass for "wired fine but doesn't do what you meant."
 */

function FaultRow({ fault }: { fault: QuestFault }) {
  const badgeClass =
    fault.verdict === 'uncertain' ? 'badge--warn' : fault.verdict === 'corrected' ? 'badge--warn' : 'badge--fail';

  return (
    <div className="quest-fault">
      <div className="quest-fault__head">
        <span className="mono quest-fault__component">{fault.componentId}</span>
        {fault.verdict && <span className={`badge ${badgeClass}`}>{fault.verdict}</span>}
      </div>
      <p className="quest-fault__message">{fault.finalMessage || fault.issue}</p>
      {fault.groundedOn && <p className="quest-fault__source">Source: {fault.groundedOn}</p>}
    </div>
  );
}

export function QuestChecksPanel() {
  const { connected, circuit, checkResult, checking } = useQuestBridge();
  const componentCount = circuit?.components?.length ?? 0;

  return (
    <section className="panel quest-checks">
      {checking && (
        <div className="quest-checks__status">
          <span className="quest-checks__spinner" aria-hidden="true" />
          Checking…
        </div>
      )}

      <div className="scroll quest-checks__body">
        {!connected && <p className="empty">Not connected to the Quest bridge.</p>}

        {connected && componentCount === 0 && (
          <p className="empty">Wire something on the Quest to get it checked.</p>
        )}

        {connected && componentCount > 0 && !checkResult && !checking && (
          <p className="empty">Waiting on the first check.</p>
        )}

        {checkResult && (
          <>
            <div className={`quest-checks__verdict${checkResult.ok ? ' quest-checks__verdict--ok' : ' quest-checks__verdict--fail'}`}>
              <span className={`badge ${checkResult.ok ? 'badge--pass' : 'badge--fail'}`}>
                {checkResult.ok ? 'clear' : 'issue found'}
              </span>
              <p>{checkResult.message}</p>
            </div>

            {checkResult.faults.length > 0 && (
              <div className="quest-checks__faults">
                {checkResult.faults.map((fault) => (
                  <FaultRow key={fault.componentId} fault={fault} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
