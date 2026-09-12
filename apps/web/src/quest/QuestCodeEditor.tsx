import { useQuestBridge } from './QuestBridgeContext.js';

/**
 * The IDE pane: the Arduino sketch paired with this session's circuit. Plain
 * textarea, not a real code editor — good enough for a hackathon sketch, and
 * one less dependency. Typing here streams `code:update` to the server (see
 * QuestBridgeContext.setCode), and a commit snapshots whatever is in here
 * alongside the circuit, so loading a past commit brings the code back too.
 */
export function QuestCodeEditor() {
  const { connected, code, setCode } = useQuestBridge();

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
        <span className="quest-ide__hint">Committed with the circuit</span>
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
    </section>
  );
}
