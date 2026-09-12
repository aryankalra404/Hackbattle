const assert = require('node:assert/strict');
const { answerChatMessage } = require('../server/chat');

async function run() {
  const session = {
    circuit: {
      components: [
        { id: 'led-1', type: 'led', anode: 'LED1_L1', cathode: 'LED1_L2' },
        { id: 'resistor-1', type: 'resistor', left: 'RES1_R1', right: 'RES1_R2' }
      ],
      wires: [{ from: 'GND', to: 'LED1_L1' }, { from: 'D12', to: 'RES1_R1' }]
    },
    latestResult: {
      ok: false,
      message: 'The LED polarity is reversed.',
      confidence: 'confirmed',
      suspectedComponent: 'led-1',
      suspectedComponents: ['led-1']
    },
    chatHistory: []
  };
  let request;
  const client = {
    chat: {
      completions: {
        create: async (payload) => {
          request = payload;
          return { choices: [{ message: { content: 'led-1 is the active fault: its polarity is reversed.' } }] };
        }
      }
    }
  };
  const response = await answerChatMessage({
    session,
    message: 'Why is the LED wrong?',
    retrieveChunks: async () => [{ source: 'led.md', heading: 'Pin identification', text: 'The long lead is the anode.' }],
    client
  });

  assert.match(response, /led-1/i);
  assert.match(request.messages[0].content, /led-1/);
  assert.match(request.messages[0].content, /The LED polarity is reversed/);
  console.log('Chat active-fault grounding test passed.');
  console.log({ response, llmContext: request.messages[0].content });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
