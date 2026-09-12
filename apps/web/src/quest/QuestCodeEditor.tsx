import { useQuestBridge } from './QuestBridgeContext.js';

/**
 * The IDE pane: the Arduino sketch paired with this session's circuit. Plain
 * textarea, not a real code editor — good enough for a hackathon sketch, and
 * one less dependency. Typing here streams `code:update` to the server (see
 * QuestBridgeContext.setCode), and a commit snapshots whatever is in here
 * alongside the circuit, so loading a past commit brings the code back too.
 *
 * Simulate compiles the sketch with the real Arduino toolchain
 * (socket-server/compile) and, if it compiles, deterministically works out
 * which wired LEDs it turns on or blinks (socket-server/simulate) — no LLM
 * involved. The result is broadcast to the whole session, so the 2D mirror
 * and the Quest headset both animate the same outcome.
 */
export function QuestCodeEditor() {
  const { connected, code, setCode, simulateResult, simulating, runSimulation } = useQuestBridge();

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart, selectionEnd, value } = el;
    const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
    setCode(next);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = selectionStart + 2;
    });
  };

  return (
    <section className="panel quest-ide">
      <div className="panel__header">
        sketch.ino
        <span className="panel__header-actions">
          <span className="quest-ide__hint">Committed with the circuit</span>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={!connected || !code.trim() || simulating}
            onClick={runSimulation}
          >
            {simulating ? 'Simulating…' : 'Simulate'}
          </button>
        </span>
      </div>
      <textarea
        className="quest-ide__editor"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={
          connected
            ? 'void setup() {\n  // runs once\n}\n\nvoid loop() {\n  // runs forever\n}'
            : 'Not connected to the Quest bridge.'
        }
        disabled={!connected}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />

      {simulateResult && (
        <div className="quest-ide__result">
          {simulateResult.stage === 'compile' ? (
            <>
              <p className="quest-ide__result-title quest-ide__result-title--error">
                Compile failed
              </p>
              <ul className="quest-ide__errors">
                {simulateResult.errors.map((error, index) => (
                  <li key={index}>
                    {error.line != null ? <span className="mono">line {error.line}: </span> : null}
                    {error.message}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="quest-ide__result-title">
                Compiled. {simulateResult.leds.length === 0
                  ? 'No LED is actually driven by this code.'
                  : simulateResult.leds
                      .map((led) =>
                        led.pattern === 'blink'
                          ? `${led.ledId} blinks (${led.onMs}ms on / ${led.offMs}ms off)`
                          : led.pattern === 'on'
                            ? `${led.ledId} turns on`
                            : `${led.ledId} stays off`,
                      )
                      .join(', ')}
              </p>
              {simulateResult.warnings.length > 0 && (
                <ul className="quest-ide__errors quest-ide__errors--warning">
                  {simulateResult.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
