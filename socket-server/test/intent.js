require('dotenv').config();
const { diagnoseAndVerify } = require('../reasoning/diagnoseAndVerify');

/**
 * Three test cases for the circuit-intent feature:
 *
 * 1. Intent set + circuit structurally fine per-component but doesn't achieve
 *    the stated goal (PIR OUT never connected to LED) → should surface as a fault.
 *
 * 2. Intent set + circuit is correct and matches intent → no false-positive.
 *
 * 3. No intent set at all → identical behavior to current (regression check).
 */

const pirAndLedsCorrectButDisconnected = {
  components: [
    { id: 'led-1', type: 'led', anode: 'LED1_L1', cathode: 'LED1_L2' },
    { id: 'resistor-1', type: 'resistor', a: 'RES1_R1', b: 'RES1_R2', value: '220 ohm' },
    { id: 'pir-1', type: 'pir', vcc: 'PIR_VCC', signal: 'PIR_SIGNAL', gnd: 'PIR_GND' }
  ],
  wires: [
    // LED wired correctly: D1 → resistor → LED → GND
    { from: 'D1', to: 'RES1_R1' },
    { from: 'RES1_R2', to: 'LED1_L1' },
    { from: 'LED1_L2', to: 'GND' },
    // PIR power is correct BUT PIR_SIGNAL is tied to 3V3 (a supply pin),
    // so the sensor's output cannot reach the LED or any input.
    // Each component is individually "wired to something" but the goal
    // — PIR triggering the LED — is impossible.
    { from: '5V', to: 'PIR_VCC' },
    { from: 'GND', to: 'PIR_GND' },
    { from: 'PIR_SIGNAL', to: '3V3' }
  ]
};

const pirTriggersLedCorrectly = {
  components: [
    { id: 'led-1', type: 'led', anode: 'LED1_L1', cathode: 'LED1_L2' },
    { id: 'resistor-1', type: 'resistor', a: 'RES1_R1', b: 'RES1_R2', value: '220 ohm' },
    { id: 'pir-1', type: 'pir', vcc: 'PIR_VCC', signal: 'PIR_SIGNAL', gnd: 'PIR_GND' }
  ],
  wires: [
    // LED driven from D1 through resistor (correct series path)
    { from: 'D1', to: 'RES1_R1' },
    { from: 'RES1_R2', to: 'LED1_L1' },
    { from: 'LED1_L2', to: 'GND' },
    // PIR correctly wired: VCC→5V, GND→GND, SIGNAL→D4 (digital input)
    // Arduino code reads D4, writes D1 to control the LED — standard architecture.
    { from: '5V', to: 'PIR_VCC' },
    { from: 'GND', to: 'PIR_GND' },
    { from: 'PIR_SIGNAL', to: 'D4' }
  ]
};

const noIntentCorrectCircuit = {
  components: [
    { id: 'led-1', type: 'led', anode: 'LED1_L1', cathode: 'LED1_L2' },
    { id: 'resistor-1', type: 'resistor', a: 'RES1_R1', b: 'RES1_R2', value: '220 ohm' }
  ],
  wires: [
    { from: 'D1', to: 'RES1_R1' },
    { from: 'RES1_R2', to: 'LED1_L1' },
    { from: 'LED1_L2', to: 'GND' }
  ]
};

const cases = [
  {
    name: 'CASE 1: Intent set, circuit fine per-component but goal NOT achieved (PIR OUT not connected to LED)',
    circuit: pirAndLedsCorrectButDisconnected,
    intent: 'PIR sensor triggers the LED when someone walks by'
  },
  {
    name: 'CASE 2: Intent set, circuit correct AND matches intent (PIR signal drives LED)',
    circuit: pirTriggersLedCorrectly,
    intent: 'PIR sensor triggers the LED when someone walks by'
  },
  {
    name: 'CASE 3: No intent set — regression check (correct LED circuit)',
    circuit: noIntentCorrectCircuit,
    intent: ''
  }
];

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY in socket-server/.env before running this test.');
  for (const testCase of cases) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`=== ${testCase.name} ===`);
    console.log(`Intent: ${testCase.intent ? `"${testCase.intent}"` : '(none)'}`);
    console.log('='.repeat(80));
    const pipeline = await diagnoseAndVerify(testCase.circuit, {
      intent: testCase.intent,
      onStage(stage, details) {
        console.log(`[${stage}] ${JSON.stringify(details, null, 2)}`);
      }
    });
    console.log(`\n[final circuit:result] ${JSON.stringify(pipeline.result, null, 2)}`);
  }
}

main().catch((error) => {
  console.error('[test:intent] failed:', error.message);
  process.exitCode = 1;
});
