const assert = require('assert/strict');
const { prepareCircuitForReasoning } = require('../reasoning/openaiCircuitReasoner');
const { createCircuitUpdateDebouncer } = require('../server');

const allComponents = [
  { id: 'led-1', type: 'led', anode: 'LED1_L1', cathode: 'LED1_L2' },
  { id: 'led-2', type: 'led', anode: 'LED2_L1', cathode: 'LED2_L2' },
  { id: 'led-3', type: 'led', anode: 'LED3_L1', cathode: 'LED3_L2' },
  { id: 'resistor-1', type: 'resistor', a: 'RES1_R1', b: 'RES1_R2' },
  { id: 'resistor-2', type: 'resistor', a: 'RES2_R1', b: 'RES2_R2' },
  { id: 'resistor-3', type: 'resistor', a: 'RES3_R1', b: 'RES3_R2' },
  { id: 'pir-1', type: 'pir', vcc: 'PIR_VCC', signal: 'PIR_SIGNAL', gnd: 'PIR_GND' }
];

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  const fresh = prepareCircuitForReasoning({ components: allComponents, wires: [] });
  assert.equal(fresh.diagnosis.hasFault, false);
  assert.equal(fresh.diagnosis.reasoning, 'Nothing wired yet.');

  const partialLed = prepareCircuitForReasoning({
    components: allComponents,
    wires: [{ from: 'D1', to: 'LED1_L1' }]
  });
  assert.equal(partialLed.diagnosis, null);
  assert.deepEqual(partialLed.circuit.components.map(({ id }) => id), ['led-1']);

  const calls = [];
  const debouncer = createCircuitUpdateDebouncer({
    delayMs: 25,
    log: () => {},
    onFire: async (sessionId, revision) => calls.push({ sessionId, revision })
  });
  debouncer.schedule('test-session', 1);
  await wait(5);
  debouncer.schedule('test-session', 2);
  await wait(5);
  debouncer.schedule('test-session', 3);
  await wait(40);
  assert.deepEqual(calls, [{ sessionId: 'test-session', revision: 3 }]);

  console.log('Live behavior tests passed.');
}

main().catch((error) => {
  console.error('Live behavior tests failed:', error);
  process.exitCode = 1;
});
