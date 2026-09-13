import { useMemo, useRef } from 'react';
import { useQuestBridge } from './QuestBridgeContext.js';
import { highlightSketch } from './highlightSketch.js';

/**
 * The IDE pane: the Arduino sketch paired with this session's circuit. Still
 * a plain textarea underneath — no editor dependency — but with a syntax
 * highlight layer rendered behind it (transparent text, visible caret) and a
 * line-number gutter with a marker dot on lines a failed compile reported.
 * `wrap="off"` on the textarea keeps one logical line == one visual row, so
 * the gutter can't drift out of sync with soft-wrapped long lines.
 *
 * Typing here streams `code:update` to the server (see
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

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

  // Textarea is the only real scroll container; the highlight layer and the
  // gutter both just get their scroll position mirrored onto them each time.
  const onScroll = () => {
    const el = textareaRef.current;
    if (!el) return;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = el.scrollTop;
      highlightRef.current.scrollLeft = el.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = el.scrollTop;
  };

  const highlighted = useMemo(() => highlightSketch(code), [code]);
  const lineCount = Math.max(1, code.split('\n').length);
  const errorLines = useMemo(() => {
    const lines = new Set<number>();
    if (simulateResult?.stage === 'compile') {
      for (const error of simulateResult.errors) {
        if (error.line != null) lines.add(error.line);
      }
    }
    return lines;
  }, [simulateResult]);

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

      <div className="quest-ide__code">
        <div className="quest-ide__gutter" ref={gutterRef}>
          {Array.from({ length: lineCount }, (_, i) => i + 1).map((line) => (
            <div key={line} className="quest-ide__gutter-line">
              {errorLines.has(line) && <span className="quest-ide__error-dot" title={`Error on line ${line}`} />}
              {line}
            </div>
          ))}
        </div>
        <div className="quest-ide__editor-stack">
          <pre className="quest-ide__highlight" ref={highlightRef} aria-hidden="true">
            <span dangerouslySetInnerHTML={{ __html: highlighted + (code.endsWith('\n') ? ' ' : '') }} />
          </pre>
          <textarea
            ref={textareaRef}
            className="quest-ide__editor"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={onKeyDown}
            onScroll={onScroll}
            placeholder={
              connected
                ? 'void setup() {\n  // runs once\n}\n\nvoid loop() {\n  // runs forever\n}'
                : 'Not connected to the Quest bridge.'
            }
            disabled={!connected}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
          />
        </div>
      </div>

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
