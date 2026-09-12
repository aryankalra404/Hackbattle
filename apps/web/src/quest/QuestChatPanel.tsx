import { useEffect, useRef, useState } from 'react';
import { useQuestBridge } from './QuestBridgeContext.js';

/**
 * Back-and-forth chat with CircuitDoctor, grounded on the live circuit graph
 * and whatever's in the Context tab. Type and hit Enter, or hold Space to
 * talk (recorded on the laptop mic, sent as `chat:voice`) — either way the
 * reply is spoken back out of the Quest's own speakers, since `chat:voice-
 * response` is broadcast to the whole session, not just this tab.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function QuestChatPanel() {
  const { connected, circuit, chatHistory, chatPending, sendChatMessage, sendVoiceMessage } = useQuestBridge();
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const spacebarDownRef = useRef(false);
  const componentCount = circuit?.components?.length ?? 0;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chatHistory, chatPending]);

  const send = () => {
    if (!draft.trim()) return;
    sendChatMessage(draft);
    setDraft('');
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop();
  };

  const startRecording = async () => {
    if (!connected || recorderRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        setRecording(false);
        // Re-tag as a plain audio/webm blob: the recorder's own mimeType
        // usually carries a codecs= parameter the server's data-URL parser
        // doesn't expect right before ";base64,".
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size === 0) return;
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') sendVoiceMessage(reader.result);
        };
        reader.readAsDataURL(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setMicError(null);
    } catch {
      setMicError('Microphone access was blocked. Allow it in the browser to talk to CircuitDoctor.');
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTypingTarget(e.target)) return;
      e.preventDefault();
      if (spacebarDownRef.current) return;
      spacebarDownRef.current = true;
      startRecording();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      spacebarDownRef.current = false;
      stopRecording();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

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

      {(recording || micError) && (
        <p className={`quest-chat__mic-hint${recording ? ' quest-chat__mic-hint--live' : ''}`}>
          {recording ? 'Listening... release Space to send' : micError}
        </p>
      )}

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
