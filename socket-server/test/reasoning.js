require('dotenv').config();
const { reasonAboutCircuit } = require('../reasoning/openaiCircuitReasoner');

const cases = [
  {
    name: 'correct three-LED circuit with PIR',
    circuit: {
      components: [
        { id: 'led-1', type: 'led', anode: 'LED1_L1', cathode: 'LED1_L2' },
        { id: 'led-2', type: 'led', anode: 'LED2_L1', cathode: 'LED2_L2' },
        { id: 'led-3', type: 'led', anode: 'LED3_L1', cathode: 'LED3_L2' },
        { id: 'resistor-1', type: 'resistor', a: 'RES1_R1', b: 'RES1_R2', value: '220 ohm' },
        { id: 'resistor-2', type: 'resistor', a: 'RES2_R1', b: 'RES2_R2', value: '220 ohm' },
        { id: 'resistor-3', type: 'resistor', a: 'RES3_R1', b: 'RES3_R2', value: '220 ohm' },
        { id: 'pir-1', type: 'pir', vcc: 'PIR_VCC', signal: 'PIR_SIGNAL', gnd: 'PIR_GND' }
      ],
      wires: [
        { from: 'D1', to: 'RES1_R1' }, { from: 'RES1_R2', to: 'LED1_L1' }, { from: 'LED1_L2', to: 'GND' },
        { from: 'D2', to: 'RES2_R1' }, { from: 'RES2_R2', to: 'LED2_L1' }, { from: 'LED2_L2', to: 'GND' },
        { from: 'D3', to: 'RES3_R1' }, { from: 'RES3_R2', to: 'LED3_L1' }, { from: 'LED3_L2', to: 'GND' },
        { from: '5V', to: 'PIR_VCC' }, { from: 'GND', to: 'PIR_GND' }, { from: 'PIR_SIGNAL', to: 'D4' }
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
        { from: 'D1', to: 'RES1_R1' },
        { from: 'RES1_R2', to: 'LED1_L2' },
        { from: 'LED1_L1', to: 'GND' }
      ]
    }
  },
  {
    name: 'PIR roles swapped',
    circuit: {
      components: [
        { id: 'pir-1', type: 'pir', vcc: 'PIR_VCC', gnd: 'PIR_GND', signal: 'PIR_SIGNAL' }
      ],
      wires: [
        { from: 'PIR_VCC', to: 'GND' },
        { from: 'PIR_GND', to: '5V' },
        { from: 'PIR_SIGNAL', to: '5V' }
      ]
    }
  }
];

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Set OPENAI_API_KEY in socket-server/.env before running this test.');
  }
  for (const testCase of cases) {
    console.log(`\n=== ${testCase.name} ===`);
    console.log(JSON.stringify(await reasonAboutCircuit(testCase.circuit), null, 2));
  }
}

main().catch((error) => {
  console.error('[test:reasoning] failed:', error.message);
  process.exitCode = 1;
});
