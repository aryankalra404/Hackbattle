const http = require('http');
require('dotenv').config();
const { Server } = require('socket.io');
// Kept as a deterministic offline fallback if the LLM is unavailable.
const { diagnoseCircuit } = require('./rules');
const { diagnoseAndVerify } = require('./reasoning/diagnoseAndVerify');
const { answerChatMessage, transcribeAudio, createVoiceReplyAudio, appendChatTurn, fallbackResponse } = require('./server/chat');
const { getClient } = require('./reasoning/openaiCircuitReasoner');
const { createCommit, listCommits, getCommit, clearCommits, summarizeCommit, detectCommitIntent } = require('./commits');
const { compileSketch } = require('./compile/compileSketch');
const { simulateSketch } = require('./simulate/simulateSketch');

const PORT = Number(process.env.PORT || 3001);
const REASONING_DEBOUNCE_MS = 1200;
// Bounds how much room a stated goal has to smuggle in an elaborate prompt
// injection payload, not just a UX nicety — the reasoner treats this as
// untrusted text regardless, but a short cap costs nothing.
const MAX_INTENT_LENGTH = 300;
// Generous enough for a real Arduino sketch, small enough that a runaway
// paste can't blow up the in-memory session or a commit file.
const MAX_CODE_LENGTH = 20000;
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
    if (!sessions.has(sessionId)) sessions.set(sessionId, { circuit: null, code: '', updatedAt: null, intent: '', latestResult: null, chatHistory: [] });
    // A dashboard joining after the Quest has already built something should
    // see it immediately, not wait for the next live change.
    const existingSession = sessions.get(sessionId);
    if (existingSession.circuit) socket.emit('circuit:update', { sessionId, circuit: existingSession.circuit });
    // Same for whatever sketch is already open in the IDE tab, and the last
    // check: without these, a client that reconnects mid session (a page
    // reload, a dropped socket) is stuck stale until the next live edit.
    if (existingSession.code) socket.emit('code:update', { sessionId, code: existingSession.code });
    if (existingSession.latestResult) socket.emit('circuit:result', existingSession.latestResult);
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

  // A live, continuous signal from UltrasonicProximityController.cs — a hand
  // near the sensor prop. Deliberately not persisted into `sessions` and
  // never triggers the LLM reasoning pipeline: it's a fast demo trigger, not
  // a circuit-topology change.
  socket.on('sensor:proximity', (payload = {}) => {
    const sessionId = cleanSessionId(payload.sessionId);
    if (!sessionId) return;

    if (socket.data.sessionId !== sessionId) {
      if (socket.data.sessionId) socket.leave(socket.data.sessionId);
      socket.data.sessionId = sessionId;
      socket.join(sessionId);
    }

    io.to(sessionId).emit('sensor:proximity', {
      sessionId,
      near: !!payload.near,
      ledStates: payload.ledStates && typeof payload.ledStates === 'object' ? payload.ledStates : {}
    });
  });

  socket.on('circuit:intent', (payload = {}) => {
    const sessionId = cleanSessionId(payload.sessionId);
    if (!sessionId) return;
    const intent = typeof payload.intent === 'string' ? payload.intent.trim().slice(0, MAX_INTENT_LENGTH) : '';
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
      sessions.set(sessionId, { circuit: null, code: '', updatedAt: null, intent, latestResult: null, chatHistory: [] });
    }
    console.log(`[intent] ${sessionId} (${socket.id}): ${intent ? `"${intent}"` : '(cleared)'}`);
  });

  // The Arduino sketch open in the web IDE. Quest never writes this — only
  // the dashboard does — but it rides the same session so a commit can pair
  // the code with whatever the Quest has physically built.
  socket.on('code:update', (payload = {}) => {
    const sessionId = cleanSessionId(payload.sessionId);
    if (!sessionId) return;
    const code = typeof payload.code === 'string' ? payload.code.slice(0, MAX_CODE_LENGTH) : '';
    const session = sessions.get(sessionId);
    if (session) {
      session.code = code;
    } else {
      sessions.set(sessionId, { circuit: null, code, updatedAt: null, intent: '', latestResult: null, chatHistory: [] });
    }
    // Not echoed back to the sender: its own textarea is already the source
    // of truth for what it just typed. Other open tabs for the same session
    // get the update, same as circuit:update.
    socket.to(sessionId).emit('code:update', { sessionId, code });
  });

  // Compiles the sketch with the real Arduino toolchain, then — only if it
  // compiles — deterministically simulates which wired LEDs it turns on or
  // blinks and at what timing. No LLM involved; broadcast to the room so the
  // 2D mirror and the Quest headset can both animate the result live.
  socket.on('code:simulate', async (payload = {}) => {
    const sessionId = cleanSessionId(payload.sessionId);
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    const code = session?.code || '';

    console.log(`[simulate] ${sessionId}: compiling (${code.length} chars)`);
    const compileResult = await compileSketch(code);
    if (!compileResult.ok) {
      io.to(sessionId).emit('code:simulate-result', { ok: false, stage: 'compile', errors: compileResult.errors });
      return;
    }

    const circuit = session?.circuit || { components: [], wires: [] };
    const simResult = simulateSketch(circuit, code);
    console.log(`[simulate] ${sessionId}: ${simResult.leds.length} LED(s) driven, ${simResult.warnings.length} warning(s)`);
    io.to(sessionId).emit('code:simulate-result', {
      ok: true,
      stage: 'simulate',
      leds: simResult.leds,
      warnings: simResult.warnings
    });
  });

  // --- Version control -----------------------------------------------------
  // A commit snapshots whatever circuit is currently mirrored for the session
  // (streamed live from the Quest, including each component's position and
  // rotation) together with whatever Arduino sketch is open in the web IDE.
  // Unlike `sessions`, commit history is written to disk so it survives a
  // server restart — it is the actual "version control" data.

  socket.on('commit:create', (payload = {}) => {
    const sessionId = cleanSessionId(payload.sessionId);
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!sessionId) {
      socket.emit('commit:error', { message: 'A valid sessionId is required.' });
      return;
    }
    const hasComponents = Array.isArray(session?.circuit?.components) && session.circuit.components.length > 0;
    const hasCode = typeof session?.code === 'string' && session.code.trim().length > 0;
    if (!hasComponents && !hasCode) {
      socket.emit('commit:error', { message: 'Nothing to commit yet — build something on the Quest or write some code first.' });
      return;
    }
    try {
      const commit = createCommit(sessionId, {
        message: payload.message,
        author: payload.author,
        circuit: session.circuit || { components: [], wires: [] },
        code: session.code || '',
      });
      console.log(`[commit] ${sessionId}: created ${commit.id} "${commit.message}" (${commit.circuit.components.length} components, ${commit.code.length} chars of code)`);
      io.to(sessionId).emit('commit:created', { commit: summarizeCommit(commit) });
      io.to(sessionId).emit('commit:list', { sessionId, commits: listCommits(sessionId) });
    } catch (error) {
      console.error(`[commit] ${sessionId}: create failed: ${error.message}`);
      socket.emit('commit:error', { message: 'Could not create the commit.' });
    }
  });

  socket.on('commit:list', (payload = {}) => {
    const sessionId = cleanSessionId(payload.sessionId);
    if (!sessionId) {
      socket.emit('commit:error', { message: 'A valid sessionId is required.' });
      return;
    }
    socket.emit('commit:list', { sessionId, commits: listCommits(sessionId) });
  });

  socket.on('commit:clear', (payload = {}) => {
    const sessionId = cleanSessionId(payload.sessionId);
    if (!sessionId) {
      socket.emit('commit:error', { message: 'A valid sessionId is required.' });
      return;
    }
    try {
      clearCommits(sessionId);
      console.log(`[commit] ${sessionId}: history cleared by ${socket.id}`);
      // Broadcast to the whole room so every open tab sees the list empty instantly.
      io.to(sessionId).emit('commit:list', { sessionId, commits: [] });
    } catch (error) {
      console.error(`[commit] ${sessionId}: clear failed: ${error.message}`);
      socket.emit('commit:error', { message: 'Could not clear commit history.' });
    }
  });

  socket.on('commit:load', (payload = {}) => {
    const sessionId = cleanSessionId(payload.sessionId);
    const commitId = typeof payload.commitId === 'string' ? payload.commitId : null;
    if (!sessionId || !commitId) {
      socket.emit('commit:error', { message: 'commit:load needs a sessionId and commitId.' });
      return;
    }
    const commit = getCommit(sessionId, commitId);
    if (!commit) {
      socket.emit('commit:error', { message: `Commit ${commitId} was not found.` });
      return;
    }

    const previous = sessions.get(sessionId);
    const revision = (previous?.revision || 0) + 1;
    sessions.set(sessionId, {
      ...previous,
      circuit: commit.circuit,
      code: commit.code || '',
      updatedAt: new Date().toISOString(),
      revision,
      intent: previous?.intent || '',
      latestResult: null,
      chatHistory: previous?.chatHistory || [],
    });

    console.log(`[commit] ${sessionId}: loading ${commit.id} "${commit.message}" onto the room`);
    // The Quest and any dashboard mirror both live in this room, so restoring
    // is a broadcast: the headset rebuilds the physical layout, the dashboard
    // updates its mirror and its IDE tab.
    io.to(sessionId).emit('commit:restore', {
      sessionId,
      commit: summarizeCommit(commit),
      circuit: commit.circuit,
      code: commit.code || '',
    });
    reasoningDebouncer.schedule(sessionId, revision);
  });

  // Matches greetings and simple conversational messages that should always get
  // a friendly reply regardless of whether the user has a circuit loaded yet.
  const CONVERSATIONAL_RE = /^\s*(hi+|hey+|hello+|howdy|sup|what'?s up|good\s*(morning|afternoon|evening|night)|how are you|who are you|what (can|do) you do|thanks?|thank you|thx|bye|goodbye|ok|okay|cool|nice|great|yes|no|sure|yep|nope|nah|got it|i see|alright|right)[\.!\?,]*\s*$/i;

  socket.on('chat:message', async (payload = {}) => {
    const sessionId = cleanSessionId(payload.sessionId);
    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    const language = typeof payload.language === 'string' && payload.language.trim() ? payload.language.trim() : 'en';
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
    const isConversational = CONVERSATIONAL_RE.test(message);
    if (!isConversational && !session?.circuit && !session?.latestResult) {
      const response = 'Build or diagnose a circuit first so I have live context to reference.';
      if (wantsVoiceReply) {
        let audioUrl;
        try { audioUrl = await createVoiceReplyAudio(response); } catch (error) { console.warn(`[chat] ${sessionId}: speech generation failed: ${error.message}`); }
        socket.emit('chat:response', { ok: false, message: response, audioUrl });
      } else socket.emit('chat:response', { ok: false, message: response });
      return;
    }

    console.log(`[chat] ${sessionId} (${socket.id}): message received (lang=${language})`);
    try {
      const response = await answerChatMessage({ session, message, language });
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
    const language = typeof payload.language === 'string' && payload.language.trim() ? payload.language.trim() : 'en';
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session?.circuit && !session?.latestResult) {
      io.to(sessionId).emit('chat:voice-response', { ok: false, message: 'Build or diagnose a circuit first so I have live context to reference.' });
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
      // Broadcast to the whole room, not just the sender: asking from the
      // laptop still needs the reply spoken out of the headset, and asking
      // from the headset still needs the dashboard transcript to update.
      io.to(sessionId).emit('chat:voice-response', { ok, transcript, message, audioUrl });
    };
    // Transcription and answering fail for different reasons and need different
    // messages: a transcription failure has no real transcript to show, while an
    // answering failure still has one and should show it as what the user said
    // instead of masking it behind a made-up "could not transcribe" quote.
    let transcript;
    try {
      transcript = await transcribeAudio(audioUrl, getClient(), language);
    } catch (error) {
      console.warn(`[voice] ${sessionId}: transcription failed: ${error.message}`);
      await emitVoiceResponse({ ok: false, message: 'I could not understand that recording. Please try again or type your question.' });
      return;
    }

    appendChatTurn(session, 'user', transcript);
    try {
      const commitIntent = detectCommitIntent(transcript);
      if (commitIntent) {
        const hasComponents = Array.isArray(session.circuit?.components) && session.circuit.components.length > 0;
        const hasCode = typeof session.code === 'string' && session.code.trim().length > 0;
        const canCommit = hasComponents || hasCode;
        const reply = canCommit
          ? (() => {
              const commit = createCommit(sessionId, {
                message: commitIntent.message,
                author: 'voice',
                circuit: session.circuit || { components: [], wires: [] },
                code: session.code || '',
              });
              console.log(`[voice] ${sessionId}: committed ${commit.id} "${commit.message}" by voice`);
              io.to(sessionId).emit('commit:created', { commit: summarizeCommit(commit) });
              io.to(sessionId).emit('commit:list', { sessionId, commits: listCommits(sessionId) });
              return `Committed as "${commit.message}".`;
            })()
          : 'Nothing to commit yet, build something first.';
        appendChatTurn(session, 'assistant', reply);
        await emitVoiceResponse({ ok: canCommit, transcript, message: reply });
        return;
      }

      const answer = await answerChatMessage({ session, message: transcript, language });
      appendChatTurn(session, 'assistant', answer);
      await emitVoiceResponse({ ok: true, transcript, message: answer });
    } catch (error) {
      console.warn(`[voice] ${sessionId}: failed to answer; returning grounded fallback: ${error.message}`);
      const response = fallbackResponse(session);
      appendChatTurn(session, 'assistant', response);
      await emitVoiceResponse({ ok: false, transcript, message: response });
    }
  });

  socket.on('disconnect', (reason) => console.log(`[socket] disconnected ${socket.id} (${reason})`));
});

if (require.main === module) {
  httpServer.listen(PORT, () => console.log(`CircuitDoctor Socket.IO bridge listening on http://0.0.0.0:${PORT}`));
}

module.exports = { createCircuitUpdateDebouncer, REASONING_DEBOUNCE_MS };
