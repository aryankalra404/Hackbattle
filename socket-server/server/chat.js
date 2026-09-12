const { retrieve } = require('../rag/retrieve');
const { getClient, MODEL } = require('../reasoning/openaiCircuitReasoner');
const { toFile } = require('openai');

const MAX_HISTORY_MESSAGES = 10;
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'alloy';
const STT_MODEL = process.env.OPENAI_STT_MODEL || 'whisper-1';

function summarizeCircuit(circuit) {
  const components = Array.isArray(circuit?.components) ? circuit.components : [];
  const wires = Array.isArray(circuit?.wires) ? circuit.wires : [];
  return {
    components: components.map(({ id, type }) => ({ id, type })),
    wires
  };
}

function buildRetrievalQuery(message, circuit) {
  const componentTerms = (circuit?.components || []).map((component) => `${component.id} ${component.type}`).join(' ');
  return `${componentTerms} ${message}`.trim();
}

function fallbackResponse(session) {
  const faultComponent = session.latestResult?.suspectedComponent;
  if (faultComponent) return `I can see a current issue involving ${faultComponent}, but I could not retrieve enough datasheet evidence to add a grounded explanation. Please check the displayed diagnosis and wiring.`;
  return 'I do not have enough grounded component reference information to answer that confidently. Please ask about a connected LED, resistor, or PIR component.';
}

function isAudioDataUrl(value) {
  return typeof value === 'string' && /^data:audio\/[a-z0-9.+-]+;base64,/i.test(value) && value.length <= 2 * 1024 * 1024;
}

async function transcribeAudio(audioUrl, client) {
  if (!isAudioDataUrl(audioUrl)) throw new Error('Voice recording must be an audio data URL smaller than 2 MB.');
  const mimeMatch = audioUrl.match(/^data:audio\/([a-z0-9.+-]+);base64,/i);
  const extension = (mimeMatch?.[1] || 'wav').split('+')[0];
  const buffer = Buffer.from(audioUrl.slice(audioUrl.indexOf(',') + 1), 'base64');
  const file = await toFile(buffer, `recording.${extension}`);
  const transcription = await client.audio.transcriptions.create({ file, model: STT_MODEL });
  const transcript = transcription.text?.trim();
  if (!transcript) throw new Error('OpenAI returned an empty transcript.');
  return transcript;
}

/** Same grounding as text chat (answerChatMessage) — the only voice-specific step is the transcription. */
async function answerVoiceMessage({ session, audioUrl, language = 'en', retrieveChunks = retrieve, client = getClient() }) {
  const transcript = await transcribeAudio(audioUrl, client);
  const answer = await answerChatMessage({ session, message: transcript, language, retrieveChunks, client });
  return { transcript, answer };
}

const LANGUAGE_NAMES = {
  en: 'English',
  hi: 'Hindi',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
};

async function answerChatMessage({ session, message, language = 'en', retrieveChunks = retrieve, client = getClient() }) {
  const circuit = session.circuit || { components: [], wires: [] };
  const circuitSummary = summarizeCircuit(circuit);
  const diagnosis = session.latestResult || null;

  // Handle greetings and small-talk first with no RAG overhead.
  const GREETING_RE = /^\s*(hi+|hey+|hello+|howdy|sup|what'?s up|good\s*(morning|afternoon|evening|night)|who are you|what (can|do) you do)[.!?,]*\s*$/i;
  if (GREETING_RE.test(message)) {
    // Still honour the language preference for greetings.
    if (language !== 'en') {
      // Fall through to the LLM so it can greet in the right language.
    } else {
      return "Hi! I'm CircuitDoctor — I can check your circuit for faults and answer questions about it. Go ahead and build something on the Quest, or ask me anything about your current circuit!";
    }
  }

  const query = buildRetrievalQuery(message, circuit);
  let snippets = [];
  try {
    snippets = await retrieveChunks(query, 2);
  } catch (error) {
    console.warn(`[chat] RAG retrieval failed: ${error.message}`);
  }

  const evidence = snippets.map(({ source, heading, text }) => ({ source, heading, text }));
  const history = Array.isArray(session.chatHistory) ? session.chatHistory.slice(-MAX_HISTORY_MESSAGES) : [];

  // Build a plain-English verdict summary so the LLM doesn't have to re-interpret raw JSON.
  let diagnosisSummary = 'No diagnosis has been run yet.';
  if (diagnosis) {
    if (diagnosis.ok) {
      diagnosisSummary = `VERDICT: The circuit is CORRECT. ${diagnosis.message || ''}`;
    } else {
      const faultList = Array.isArray(diagnosis.faults) && diagnosis.faults.length
        ? diagnosis.faults.map((f) => `• ${f.componentId}: ${f.finalMessage || f.issue}`).join('\n')
        : diagnosis.message || 'Unknown fault.';
      diagnosisSummary = `VERDICT: The circuit has a FAULT.\n${faultList}`;
    }
  }

  const langName = LANGUAGE_NAMES[language] || 'English';

  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    max_tokens: 260,
    messages: [
      {
        role: 'system',
        content: `You are CircuitDoctor, a friendly and concise circuit assistant for a Unity AR app on Meta Quest.

LANGUAGE: You MUST respond exclusively in ${langName}. Do not switch to any other language regardless of what language the user's message is written in. Always reply in ${langName}.

IMPORTANT: The VERDICT below is the authoritative diagnosis from a dedicated circuit-fault engine. You MUST accept it as ground truth. Never contradict or override it — especially when the user asks whether their circuit is correct. If the VERDICT says the circuit is correct, confirm it is correct. If it says there is a fault, explain the fault using the details given.

Answer naturally and helpfully. For simple conversational questions not about the circuit, respond in a friendly way. Refer to exact component IDs when relevant. Do not invent values, connections, or behavior not shown in the evidence.

Live circuit summary:
${JSON.stringify(circuitSummary)}

Diagnosis (authoritative):
${diagnosisSummary}

Retrieved datasheet excerpts:
${JSON.stringify(evidence)}`
      },
      ...history,
      { role: 'user', content: message }
    ]
  });
  const answer = response.choices[0]?.message?.content?.trim();
  if (!answer) throw new Error('OpenAI returned no chat response.');
  return answer;
}

/**
 * Generates the audio returned only for a question asked by voice.  This
 * avoids depending on the browser's optional Web Speech API, which is absent
 * in several embedded and mobile browsers.
 */
async function createVoiceReplyAudio(text, client = getClient()) {
  const input = typeof text === 'string' ? text.trim().slice(0, 4096) : '';
  if (!input) throw new Error('Cannot generate speech for an empty answer.');
  const audio = await client.audio.speech.create({
    model: TTS_MODEL,
    voice: TTS_VOICE,
    input,
    response_format: 'mp3',
    instructions: 'Speak clearly, warmly, and concisely as a circuit tutor.'
  });
  const bytes = Buffer.from(await audio.arrayBuffer());
  if (!bytes.length) throw new Error('OpenAI returned an empty voice reply.');
  return `data:audio/mpeg;base64,${bytes.toString('base64')}`;
}

function appendChatTurn(session, role, content) {
  if (!Array.isArray(session.chatHistory)) session.chatHistory = [];
  session.chatHistory.push({ role, content });
  session.chatHistory = session.chatHistory.slice(-MAX_HISTORY_MESSAGES);
}

module.exports = { answerChatMessage, answerVoiceMessage, createVoiceReplyAudio, appendChatTurn, buildRetrievalQuery, summarizeCircuit, fallbackResponse, MAX_HISTORY_MESSAGES, TTS_MODEL, TTS_VOICE };
