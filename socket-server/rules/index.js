const ledReversed = require('./ledReversed');
const missingGroundPath = require('./missingGroundPath');
const missingSeriesResistor = require('./missingSeriesResistor');
const resistorSanity = require('./resistorSanity');
const pirWiring = require('./pirWiring');

const rules = [ledReversed, missingGroundPath, missingSeriesResistor, resistorSanity, pirWiring];

function diagnoseCircuit(circuit) {
  if (!circuit || typeof circuit !== 'object') return { ok: false, message: 'Circuit data is missing or invalid.' };
  for (const rule of rules) {
    const message = rule(circuit);
    if (message) return { ok: false, message };
  }
  return { ok: true, message: 'Circuit looks good: all connected component paths passed validation.' };
}

module.exports = { diagnoseCircuit };
