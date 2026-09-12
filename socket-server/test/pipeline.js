require('dotenv').config();
const { diagnoseAndVerify } = require('../reasoning/diagnoseAndVerify');

const cases = [
  {
    name: 'correct LED circuit',
    circuit: {
      components: [
        { id: 'led-1', type: 'led', anode: 'LED1_L1', cathode: 'LED1_L2' },
        { id: 'resistor-1', type: 'resistor', a: 'RES1_R1', b: 'RES1_R2', value: '220 ohm' }
      ],
      wires: [
        { from: 'D1', to: 'RES1_R1' }, { from: 'RES1_R2', to: 'LED1_L1' }, { from: 'LED1_L2', to: 'GND' }
      ]
    }
  },
  {
    name: 'reversed LED',
    circuit: {
      components: [
        { id: 'led-1', type: 'led', anode: 'LED1_L1', cathode: 'LED1_L2' },
        { id: 'resistor-1', type: 'resistor', a: 'RES1_R1', b: 'RES1_R2', value: '220 ohm' }
      ],
      wires: [
        { from: 'D1', to: 'RES1_R1' }, { from: 'RES1_R2', to: 'LED1_L2' }, { from: 'LED1_L1', to: 'GND' }
      ]
    }
  },
  {
    name: 'PIR VCC on 3.3V',
    circuit: {
      components: [{ id: 'pir-1', type: 'pir', vcc: 'PIR_VCC', signal: 'PIR_SIGNAL', gnd: 'PIR_GND' }],
      wires: [
        { from: '3V3', to: 'PIR_VCC' }, { from: 'GND', to: 'PIR_GND' }, { from: 'PIR_SIGNAL', to: 'D4' }
      ]
    }
  }
];

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY in socket-server/.env before running this test.');
  for (const testCase of cases) {
    console.log(`\n=== ${testCase.name} ===`);
    const pipeline = await diagnoseAndVerify(testCase.circuit, {
      onStage(stage, details) {
        console.log(`[${stage}] ${JSON.stringify(details, null, 2)}`);
      }
    });
    console.log(`[final circuit:result] ${JSON.stringify(pipeline.result, null, 2)}`);
  }
}

main().catch((error) => {
  console.error('[pipeline] test failed:', error.message);
  process.exitCode = 1;
});
