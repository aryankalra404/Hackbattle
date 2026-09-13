const assert = require('node:assert/strict');
const { diagnoseCircuit } = require('../rules');
const { findWiringFaults } = require('../rules/genericPinRoles');

// This matches QuestCircuitBridge.BuildCircuit(): component terminal fields
// hold PinPoint.pinId values and actual physical links are { from, to } wires.
const directLedToGround = {
  components: [
    { id: 'led-1', type: 'led', anode: 'LED_ANODE_PIN', cathode: 'LED_CATHODE_PIN' }
  ],
  wires: [
    { from: 'D13', to: 'LED_ANODE_PIN' },
    { from: 'LED_CATHODE_PIN', to: 'GND' }
  ]
};

const direct = diagnoseCircuit(directLedToGround);
assert.equal(direct.ok, false);
assert.match(direct.message, /series current-limiting resistor/);

const protectedLed = {
  components: [
    { id: 'led-1', type: 'led', anode: 'LED_ANODE_PIN', cathode: 'LED_CATHODE_PIN' },
    { id: 'resistor-1', type: 'resistor', a: 'RESISTOR_A', b: 'RESISTOR_B', value: '220 ohm' }
  ],
  wires: [
    { from: 'D13', to: 'RESISTOR_A' },
    { from: 'RESISTOR_B', to: 'LED_ANODE_PIN' },
    { from: 'LED_CATHODE_PIN', to: 'GND' }
  ]
};

const valid = diagnoseCircuit(protectedLed);
assert.equal(valid.ok, true, valid.message);

const noGround = structuredClone(protectedLed);
noGround.wires.pop();
const invalid = diagnoseCircuit(noGround);
assert.equal(invalid.ok, false);
assert.match(invalid.message, /cathode to GND/);

const pirOnWrongPins = {
  components: [{ id: 'pir-1', type: 'pir', vcc: 'PIR_VCC', signal: 'PIR_SIGNAL', gnd: 'PIR_GND' }],
  wires: [
    { from: 'D5', to: 'PIR_VCC' },
    { from: 'D4', to: 'PIR_SIGNAL' },
    { from: 'GND', to: 'PIR_GND' }
  ]
};
const pirFaults = findWiringFaults(pirOnWrongPins, 'PIR should be connected to D13');
assert.equal(pirFaults.length, 1);
assert.match(pirFaults[0].issue, /5V/);
assert.match(pirFaults[0].issue, /D13/);
assert.equal(diagnoseCircuit(pirOnWrongPins).ok, false);

const validPir = {
  components: [{ id: 'pir-1', type: 'pir', vcc: 'PIR_VCC', signal: 'PIR_SIGNAL', gnd: 'PIR_GND' }],
  wires: [
    { from: '5V', to: 'PIR_VCC' },
    { from: 'D13', to: 'PIR_SIGNAL' },
    { from: 'GND', to: 'PIR_GND' }
  ]
};
assert.deepEqual(findWiringFaults(validPir, 'PIR should be connected to D13'), []);
assert.equal(diagnoseCircuit(validPir).ok, true);

console.log('Rule regression checks passed.');
