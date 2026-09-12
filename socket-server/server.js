const http = require('http');
require('dotenv').config();
const { Server } = require('socket.io');
// Kept as a deterministic offline fallback if the LLM is unavailable.
const { diagnoseCircuit } = require('./rules');
const { diagnoseAndVerify } = require('./reasoning/diagnoseAndVerify');
const { answerChatMessage, answerVoiceMessage, createVoiceReplyAudio, appendChatTurn, fallbackResponse } = require('./server/chat');

const PORT = Number(process.env.PORT || 3001);
const REASONING_DEBOUNCE_MS = 1200;
const sessions = new Map();

function createCircuitUpdateDebouncer({ delayMs = REASONING_DEBOUNCE_MS, onFire, log = console.log }) {
  const timers = new Map();

  return {
    schedule(sessionId, revision) {
      const wasReset = timers.has(sessionId);
      if (wasReset) clearTimeout(timers.get(sessionId));
      log(`[debounce] ${sessionId}: ${wasReset ? 'reset' : 'started'}; waiting ${delayMs}ms before reasoning`);
      timers.set(sessionId, setTimeout(() => {
        timers.delete(sessionId);
        log(`[debounce] ${sessionId}: fired for revision ${revision}; calling reasoning`);
        Promise.resolve(onFire(sessionId, revision)).catch((error) => {
          console.error(`[debounce] ${sessionId}: processing failed: ${error.message}`);
        });
      }, delayMs));
    },
    cancel(sessionId) {
      if (!timers.has(sessionId)) return;
      clearTimeout(timers.get(sessionId));
      timers.delete(sessionId);
    }
  };
}

const httpServer = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ service: 'CircuitDoctor Socket.IO bridge', status: 'ok' }));
});

const io = new Server(httpServer, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 2 * 1024 * 1024
});

async function runReasoningForSession(sessionId, revision) {
  const session = sessions.get(sessionId);
  // A newer update is already waiting, so never reason about an old snapshot.
  if (!session || session.revision !== revision) {
    console.log(`[result] ${sessionId}: skipped stale revision ${revision}`);
    return;
  }

  const circuit = session.circuit;
  const intent = session.intent || '';
  let result;
  try {
    const pipeline = await diagnoseAndVerify(circuit, {
      intent,
      onStage(stage, details) {
        console.log(`[pipeline] ${sessionId} ${stage}: ${JSON.stringify(details)}`);
      }
    });
    result = pipeline.result;
  } catch (error) {
    console.warn(`[pipeline] failed for ${sessionId}; using rule fallback: ${error.message}`);
    const fallback = diagnoseCircuit(circuit);
    result = {
      ...fallback,
      confidence: null,
      groundedOn: null,
      suspectedComponent: null,
      suspectedComponents: [],
      faults: []
    };
  }

  // Do not publish a slow response for an older AR circuit snapshot.
  if (sessions.get(sessionId)?.revision !== revision) {
    console.log(`[result] ${sessionId}: skipped stale revision ${revision}`);
    return;
  }
  sessions.get(sessionId).latestResult = result;
  console.log(`[result] ${sessionId}: ${result.ok ? 'OK' : 'FAULT'} (${result.confidence || 'not-applicable'}) — ${result.message}`);

  io.to(sessionId).emit('circuit:result', result);
  // Diagnosis and LED simulation are deliberately independent. A fault must
  // never turn an AR LED off; emit simulation:led only from an explicit
  // simulation source, not from a circuit:result verdict.
}

const reasoningDebouncer = createCircuitUpdateDebouncer({ onFire: runReasoningForSession });

function cleanSessionId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

io.on('connection', (socket) => {
  console.log(`[socket] connected ${socket.id}`);

  socket.on('session:join', (payload = {}) => {
    const sessionId = cleanSessionId(payload.sessionId);
    if (!sessionId) {
      socket.emit('circuit:result', { ok: false, message: 'A valid sessionId is required.' });
      return;
    }

    if (socket.data.sessionId && socket.data.sessionId !== sessionId) {
      socket.leave(socket.data.sessionId);
    }
    socket.data.sessionId = sessionId;
    socket.join(sessionId);
    if (!sessions.has(sessionId)) sessions.set(sessionId, { circuit: null, updatedAt: null, intent: '', latestResult: null, chatHistory: [] });
    console.log(`[session] ${socket.id} joined ${sessionId}`);
  });

  socket.on('circuit:update', (payload = {}) => {
    const sessionId = cleanSessionId(payload.sessionId);
    if (!sessionId || !payload.circuit || typeof payload.circuit !== 'object') {
      socket.emit('circuit:result', { ok: false, message: 'circuit:update needs a sessionId and circuit JSON.' });
      return;
    }

    // Joining is optional for convenience, but a sender is always put in its session room.
    if (socket.data.sessionId !== sessionId) {
      if (socket.data.sessionId) socket.leave(socket.data.sessionId);
      socket.data.sessionId = sessionId;
      socket.join(sessionId);
    }

    const previous = sessions.get(sessionId);
    const revision = (previous?.revision || 0) + 1;
    sessions.set(sessionId, {
      ...previous,
      circuit: payload.circuit,
      updatedAt: new Date().toISOString(),
      revision,
      intent: previous?.intent || '',
      // A new topology invalidates an older diagnosis until its debounce run completes.
      latestResult: null,
      chatHistory: previous?.chatHistory || []
    });
    const componentCount = Array.isArray(payload.circuit.components) ? payload.circuit.components.length : 0;
    const wireCount = Array.isArray(payload.circuit.wires) ? payload.circuit.wires.length : 0;
    console.log(`[circuit] ${sessionId} (${socket.id}): ${componentCount} components, ${wireCount} wires`);
    // Relay the exact structural snapshot to every client in this session so
    // the dashboard can mirror the Quest circuit while it is being built.
    io.to(sessionId).emit('circuit:update', { sessionId, circuit: payload.circuit });
    console.log(`[circuit] emitted circuit:update to ${sessionId}: ${componentCount} components, ${wireCount} wires`);
    reasoningDebouncer.schedule(sessionId, revision);
  });

  socket.on('circuit:intent', (payload = {}) => {
    const sessionId = cleanSessionId(payload.sessionId);
    if (!sessionId) return;
    const intent = typeof payload.intent === 'string' ? payload.intent.trim() : '';
    const session = sessions.get(sessionId);
    if (session) {
      session.intent = intent;
      // The goal changes the diagnosis context even when no wire moved. Run a
      // new revision so the LLM receives the latest "What are you building?"
      // text instead of waiting for another AR circuit:update event.
      if (session.circuit) {
        session.revision = (session.revision || 0) + 1;
        session.latestResult = null;
        reasoningDebouncer.schedule(sessionId, session.revision);
      }
    } else {
      sessions.set(sessionId, { circuit: null, updatedAt: null, intent, latestResult: null, chatHistory: [] });
    }
    console.log(`[intent] ${sessionId} (${socket.id}): ${intent ? `"${intent}"` : '(cleared)'}`);
  });

  socket.on('chat:message', async (payload = {}) => {
    const sessionId = cleanSessionId(payload.sessionId);
    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    const wantsVoiceReply = payload.voiceReply === true;
    const emitChatResponse = async (response) => {
      let audioUrl;
      if (wantsVoiceReply) {
        try {
          audioUrl = await createVoiceReplyAudio(response);
        } catch (error) {
          console.warn(`[chat] ${sessionId}: speech generation failed: ${error.message}`);
        }
      }
      socket.emit('chat:response', { ok: true, message: response, audioUrl });
    };
    if (!sessionId || !message) {
      const response = 'Please enter a question for CircuitDoctor.';
      if (wantsVoiceReply) {
        let audioUrl;
        try { audioUrl = await createVoiceReplyAudio(response); } catch (error) { console.warn(`[chat] ${sessionId}: speech generation failed: ${error.message}`); }
        socket.emit('chat:response', { ok: false, message: response, audioUrl });
      } else socket.emit('chat:response', { ok: false, message: response });
      return;
    }

    const session = sessions.get(sessionId);
    if (!session?.circuit && !session?.latestResult) {
      const response = 'Build or diagnose a circuit first so I have live context to reference.';
      if (wantsVoiceReply) {
        let audioUrl;
        try { audioUrl = await createVoiceReplyAudio(response); } catch (error) { console.warn(`[chat] ${sessionId}: speech generation failed: ${error.message}`); }
        socket.emit('chat:response', { ok: false, message: response, audioUrl });
      } else socket.emit('chat:response', { ok: false, message: response });
      return;
    }

    console.log(`[chat] ${sessionId} (${socket.id}): message received`);
    try {
      const response = await answerChatMessage({ session, message });
      appendChatTurn(session, 'user', message);
      appendChatTurn(session, 'assistant', response);
      await emitChatResponse(response);
      console.log(`[chat] ${sessionId} (${socket.id}): response sent`);
    } catch (error) {
      console.warn(`[chat] ${sessionId}: failed; returning grounded fallback: ${error.message}`);
      const response = fallbackResponse(session);
      appendChatTurn(session, 'user', message);
      appendChatTurn(session, 'assistant', response);
      await emitChatResponse(response);
    }
  });

  socket.on('chat:voice', async (payload = {}) => {
    const sessionId = cleanSessionId(payload.sessionId);
    const audioUrl = typeof payload.audioUrl === 'string' ? payload.audioUrl : '';
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session?.circuit && !session?.latestResult) {
      socket.emit('chat:voice-response', { ok: false, message: 'Build or diagnose a circuit first so I have live context to reference.' });
      return;
    }

    console.log(`[voice] ${sessionId} (${socket.id}): recording received`);
    const emitVoiceResponse = async ({ ok, transcript, message }) => {
      let audioUrl;
      try {
        audioUrl = await createVoiceReplyAudio(message);
      } catch (error) {
        // Text still reaches the user, and the dashboard can fall back to
        // browser synthesis where that optional API is available.
        console.warn(`[voice] ${sessionId}: speech generation failed: ${error.message}`);
      }
      socket.emit('chat:voice-response', { ok, transcript, message, audioUrl });
    };
    try {
      const response = await answerVoiceMessage({ session, audioUrl });
      appendChatTurn(session, 'user', response.transcript);
      appendChatTurn(session, 'assistant', response.answer);
      await emitVoiceResponse({ ok: true, transcript: response.transcript, message: response.answer });
    } catch (error) {
      console.warn(`[voice] ${sessionId}: failed; returning grounded fallback: ${error.message}`);
      const response = fallbackResponse(session);
      appendChatTurn(session, 'user', 'Voice question');
      appendChatTurn(session, 'assistant', response);
      await emitVoiceResponse({ ok: false, transcript: 'I could not transcribe that recording.', message: response });
    }
  });

  socket.on('disconnect', (reason) => console.log(`[socket] disconnected ${socket.id} (${reason})`));
});

if (require.main === module) {
  httpServer.listen(PORT, () => console.log(`CircuitDoctor Socket.IO bridge listening on http://0.0.0.0:${PORT}`));
}

module.exports = { createCircuitUpdateDebouncer, REASONING_DEBOUNCE_MS };
