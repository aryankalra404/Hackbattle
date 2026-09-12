const assert = require('node:assert/strict');
const { answerVoiceMessage } = require('../server/chat');

async function run() {
  const session = {
    circuit: {
      components: [{ id: 'led-1', type: 'led' }],
      wires: [{ from: 'GND', to: 'LED1_L1' }]
    },
    latestResult: { ok: false, message: 'The LED polarity is reversed.', suspectedComponent: 'led-1' }
  };
  let request;
  const response = await answerVoiceMessage({
    session,
    audioUrl: 'data:audio/webm;base64,AAAA',
    retrieveChunks: async () => [{ source: 'led.md', heading: 'Polarity', text: 'The anode is positive.' }],
    client: { chat: { completions: { create: async (payload) => {
      request = payload;
      return { choices: [{ message: { content: '{"transcript":"Why is the LED not working?","answer":"led-1 is reversed."}' } }] };
    } } } }
  });

  assert.equal(response.transcript, 'Why is the LED not working?');
  assert.equal(response.answer, 'led-1 is reversed.');
  assert.equal(request.messages[1].content[0].type, 'audio_url');
  assert.equal(request.messages[1].content[0].audio_url.url, 'data:audio/webm;base64,AAAA');
  assert.match(request.messages[0].content, /led-1/);
  console.log('Voice transcription and grounded-answer request test passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
