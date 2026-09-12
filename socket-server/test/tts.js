const assert = require('node:assert/strict');
const { createVoiceReplyAudio } = require('../server/chat');

async function run() {
  let request;
  const audioUrl = await createVoiceReplyAudio('The LED is connected backwards.', {
    audio: { speech: { create: async (payload) => {
      request = payload;
      return { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    } } }
  });

  assert.equal(request.model, process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts');
  assert.equal(request.voice, process.env.OPENAI_TTS_VOICE || 'alloy');
  assert.match(audioUrl, /^data:audio\/mpeg;base64,AQID$/);
  console.log('Voice reply audio generation test passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
