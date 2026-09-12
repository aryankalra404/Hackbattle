import { useEffect, useRef, useState } from 'react';
import { useQuestBridge } from './QuestBridgeContext.js';

/**
 * Back-and-forth chat with CircuitDoctor, grounded on the live circuit graph
 * and whatever's in the Context tab. Type and hit Enter, or tap Space to
 * talk: it records on the laptop mic and sends itself once it hears you go
 * quiet (or tap Space again to cut it short). Either way the reply is spoken
 * back out of the Quest's own speakers, since `chat:voice-response` is
 * broadcast to the whole session, not just this tab.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

// Voice-activity detection tuning: how loud counts as "speaking" (RMS of the
// time-domain signal, 0..1), how long a pause has to last before it counts as
// "done talking", and a hard cap so a stuck-open mic can't record forever.
const SPEECH_RMS_THRESHOLD = 0.02;
const SILENCE_STOP_MS = 1200;
const MAX_RECORDING_MS = 20000;

export function QuestChatPanel() {
  const { connected, circuit, chatHistory, chatPending, sendChatMessage, sendVoiceMessage } = useQuestBridge();
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadFrameRef = useRef<number | null>(null);
  const hasSpokenRef = useRef(false);
  const silenceStartRef = useRef<number | null>(null);
  const recordingStartRef = useRef(0);
  const componentCount = circuit?.components?.length ?? 0;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chatHistory, chatPending]);

  const send = () => {
    if (!draft.trim()) return;
    sendChatMessage(draft);
    setDraft('');
  };

  const stopVad = () => {
    if (vadFrameRef.current != null) {
      cancelAnimationFrame(vadFrameRef.current);
      vadFrameRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
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
        stopVad();
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

      // Watch the mic level so this is tap-to-talk, not hold-to-talk: once
      // you've actually said something, a long enough pause auto-sends.
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      audioCtxRef.current = audioCtx;
      hasSpokenRef.current = false;
      silenceStartRef.current = null;
      recordingStartRef.current = performance.now();

      const buffer = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (!recorderRef.current || recorderRef.current.state !== 'recording') return;
        analyser.getByteTimeDomainData(buffer);
        let sumSquares = 0;
        for (let i = 0; i < buffer.length; i++) {
          const normalized = ((buffer[i] ?? 128) - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / buffer.length);
        const now = performance.now();

        if (rms > SPEECH_RMS_THRESHOLD) {
          hasSpokenRef.current = true;
          silenceStartRef.current = null;
        } else if (hasSpokenRef.current) {
          if (silenceStartRef.current == null) silenceStartRef.current = now;
          else if (now - silenceStartRef.current > SILENCE_STOP_MS) {
            stopRecording();
            return;
          }
        }

        if (now - recordingStartRef.current > MAX_RECORDING_MS) {
          stopRecording();
          return;
        }
        vadFrameRef.current = requestAnimationFrame(tick);
      };
      vadFrameRef.current = requestAnimationFrame(tick);
    } catch {
      setMicError('Microphone access was blocked. Allow it in the browser to talk to CircuitDoctor.');
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTypingTarget(e.target)) return;
      e.preventDefault();
      if (recorderRef.current?.state === 'recording') stopRecording();
      else startRecording();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      stopVad();
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
                ? 'Build something on the Quest, then ask what\'s wrong or say what you want it to do. Tap Space to talk.'
                : 'Ask something, e.g. "why is the LED not lighting up?" Tap Space to talk.'
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
          {recording ? 'Listening... pause or tap Space to send' : micError}
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
