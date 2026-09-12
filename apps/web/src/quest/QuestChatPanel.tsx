import { useEffect, useRef, useState } from 'react';
import { useQuestBridge } from './QuestBridgeContext.js';

/**
 * Back-and-forth chat with CircuitDoctor, grounded on the live circuit graph
 * and whatever's in the Context tab — the text-side counterpart to
 * `VoiceChatController` on the headset. Same `chat:message`/`chat:response`
 * events, so a question asked here and one spoken on the Quest share the
 * same server-side history for the session.
 */
export function QuestChatPanel() {
  const { connected, circuit, chatHistory, chatPending, sendChatMessage } = useQuestBridge();
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const componentCount = circuit?.components?.length ?? 0;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chatHistory, chatPending]);

  const send = () => {
    if (!draft.trim()) return;
    sendChatMessage(draft);
    setDraft('');
  };

  return (
    <section className="panel quest-chat">
      <div className="scroll quest-chat__list" ref={listRef}>
        {chatHistory.length === 0 && (
          <p className="empty">
            {connected
              ? componentCount === 0
                ? 'Build something on the Quest, then ask what\'s wrong or say what you want it to do.'
                : 'Ask something, e.g. "why is the LED not lighting up?"'
              : 'Not connected to the Quest bridge.'}
          </p>
        )}
        {chatHistory.map((turn, index) => (
          <div key={index} className={`quest-chat__turn quest-chat__turn--${turn.role}`}>
            <span className="quest-chat__role">{turn.role === 'user' ? 'You' : 'CircuitDoctor'}</span>
            <p>{turn.content}</p>
          </div>
        ))}
        {chatPending && (
          <div className="quest-chat__turn quest-chat__turn--assistant quest-chat__turn--pending">
            <span className="quest-chat__role">CircuitDoctor</span>
            <p>
              <span className="quest-checks__spinner" aria-hidden="true" /> thinking…
            </p>
          </div>
        )}
      </div>

      <div className="quest-chat__composer">
        <textarea
          className="input quest-chat__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask CircuitDoctor..."
          rows={2}
          disabled={!connected}
        />
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={!connected || !draft.trim()}
          onClick={send}
        >
          Send
        </button>
      </div>
    </section>
  );
}
