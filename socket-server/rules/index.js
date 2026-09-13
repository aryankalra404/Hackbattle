const resistorSanity = require('./resistorSanity');
const { findWiringFaults } = require('./genericPinRoles');

/**
 * Deterministic fallback used when the LLM call fails or is unavailable.
 * Wiring-topology checks (power/ground/signal/polarity/series-resistor) are
 * spec-driven via genericPinRoles.js + componentSpecs.js, so this covers
 * every component type declared there without per-type code. resistorSanity
 * stays separate because it checks a resistor's declared numeric value, not
 * wiring topology — that's legitimately scoped to the one type that has it.
 */
function diagnoseCircuit(circuit, intent = '') {
  if (!circuit || typeof circuit !== 'object') return { ok: false, message: 'Circuit data is missing or invalid.' };

  const sanityIssue = resistorSanity(circuit);
  if (sanityIssue) return { ok: false, message: sanityIssue };

  const faults = findWiringFaults(circuit, intent);
  if (faults.length) return { ok: false, message: faults.map((fault) => fault.issue).join(' ') };

  return { ok: true, message: 'Circuit looks good: all connected component paths passed validation.' };
}

module.exports = { diagnoseCircuit };
