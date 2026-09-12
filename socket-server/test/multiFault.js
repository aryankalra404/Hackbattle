const assert = require('assert/strict');
const { diagnoseAndVerify } = require('../reasoning/diagnoseAndVerify');
const { mergeDeterministicFaults } = require('../reasoning/openaiCircuitReasoner');

async function main() {
  const calls = [];
  const pipeline = await diagnoseAndVerify({ components: [], wires: [] }, {
    reasonAboutCircuit: async () => ({
      hasFault: true,
      faults: [
        { componentId: 'led-1', issue: 'LED anode is connected to GND.' },
        { componentId: 'pir-1', issue: 'PIR VCC is connected to 3V3 instead of 5V.' }
      ],
      suspectedComponents: ['led-1', 'pir-1'],
      suspectedComponent: 'led-1',
      suspectedIssue: 'LED anode is connected to GND.',
      reasoning: 'Two independent wiring faults were found.'
    }),
    retrieve: async (query) => {
      calls.push(query);
      return [{ source: query.startsWith('led-1') ? 'led.md' : 'pir-hc-sr501.md', heading: 'Reference:', text: query, score: 0.9 }];
    },
    verifyDiagnosis: async (_diagnosis, retrievals) => ({
      verifications: retrievals.map(({ fault, chunks }) => ({
        componentId: fault.componentId,
        verdict: fault.componentId === 'led-1' ? 'confirmed' : 'uncertain',
        finalMessage: `${fault.componentId}: ${fault.issue}`,
        groundedOn: `${chunks[0].source} — ${chunks[0].heading}`
      }))
    })
  });

  assert.deepEqual(calls, [
    'led-1: LED anode is connected to GND.',
    'pir-1: PIR VCC is connected to 3V3 instead of 5V.'
  ]);
  assert.equal(pipeline.result.ok, false);
  assert.equal(pipeline.result.confidence, 'uncertain');
  assert.deepEqual(pipeline.result.suspectedComponents, ['led-1', 'pir-1']);
  assert.equal(pipeline.result.suspectedComponent, 'led-1');
  assert.equal(pipeline.result.faults.length, 2);

  const merged = mergeDeterministicFaults({
    hasFault: true,
    faults: [{ componentId: 'led-1', issue: 'LED polarity is reversed.' }],
    reasoning: 'LED check failed.'
  }, [{ componentId: 'pir-1', issue: 'PIR pir-1: VCC must have a physical connection to the Arduino 5V pin.' }]);
  assert.deepEqual(merged.suspectedComponents, ['pir-1', 'led-1']);
  assert.equal(merged.hasFault, true);
  console.log('Multi-fault pipeline test passed.');
}

main().catch((error) => {
  console.error('Multi-fault pipeline test failed:', error);
  process.exitCode = 1;
});
