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
async function answerVoiceMessage({ session, audioUrl, retrieveChunks = retrieve, client = getClient() }) {
  const transcript = await transcribeAudio(audioUrl, client);
  const answer = await answerChatMessage({ session, message: transcript, retrieveChunks, client });
  return { transcript, answer };
}

async function answerChatMessage({ session, message, retrieveChunks = retrieve, client = getClient() }) {
  const circuit = session.circuit || { components: [], wires: [] };
  const circuitSummary = summarizeCircuit(circuit);
  const diagnosis = session.latestResult || null;
  const query = buildRetrievalQuery(message, circuit);
  let snippets = [];
  try {
    snippets = await retrieveChunks(query, 2);
  } catch (error) {
    console.warn(`[chat] RAG retrieval failed: ${error.message}`);
  }

  // No hard bail when retrieval comes up empty: a greeting or a question about
  // the live circuit itself (e.g. "what's connected right now?") has nothing
  // to match in the datasheet vector store but is still answerable from the
  // circuit summary and diagnosis below, and the system prompt already
  // forbids inventing facts the evidence doesn't support.
  const evidence = snippets.map(({ source, heading, text }) => ({ source, heading, text }));
  const history = Array.isArray(session.chatHistory) ? session.chatHistory.slice(-MAX_HISTORY_MESSAGES) : [];
  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    max_tokens: 260,
    messages: [
      {
        role: 'system',
        content: `You are CircuitDoctor, a concise circuit assistant. Answer only using the live circuit summary, latest diagnosis, and retrieved datasheet excerpts supplied below. Do not invent values, missing connections, or component behavior. If the evidence cannot answer the question, say so clearly. Refer to exact component IDs when relevant.\n\nLive circuit summary:\n${JSON.stringify(circuitSummary)}\n\nLatest diagnosis:\n${JSON.stringify(diagnosis)}\n\nRetrieved datasheet excerpts:\n${JSON.stringify(evidence)}`
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
