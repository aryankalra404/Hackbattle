const { COMPONENT_SPECS } = require('./componentSpecs');

function normalizePinId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function buildResistorTerminals(circuit) {
  const terminals = new Set();
  for (const component of circuit?.components || []) {
    if (component?.type !== 'resistor') continue;
    const a = normalizePinId(component.a);
    const b = normalizePinId(component.b);
    if (a) terminals.add(a);
    if (b) terminals.add(b);
  }
  return terminals;
}

function terminalTouchesResistor(circuit, pin, resistorTerminals) {
  if (!pin) return false;
  return (circuit?.wires || []).some((wire) => {
    const from = normalizePinId(wire?.from);
    const to = normalizePinId(wire?.to);
    return (from === pin && resistorTerminals.has(to)) || (to === pin && resistorTerminals.has(from));
  });
}

function mentionsTerminal(issueText, pinId, word) {
  const lower = typeof issueText === 'string' ? issueText.toLowerCase() : '';
  return Boolean((pinId && lower.includes(pinId)) || lower.includes(word));
}

/**
 * Drops a "missing series resistor" fault only when we can identify exactly
 * which terminal it accuses, that terminal belongs to a component type
 * whose spec (componentSpecs.js) actually requires one, and that specific
 * terminal is directly wired to a resistor terminal — deterministic proof
 * a resistor really is there. Applies to any `seriesResistorRequired` pin
 * (currently just the LED anode), not one hardcoded component type.
 *
 * Exists to catch a real, repeatable LLM failure mode: gpt-4o-mini
 * sometimes claims a terminal is "wired directly to 5V with no series
 * resistor" even when its own trace shows a resistor in between, apparently
 * confusing a nearby unrelated component's 5V/GND pin (e.g. a PIR's VCC)
 * with this component's own source.
 *
 * Deliberately conservative: if the accused terminal can't be identified,
 * the fault is left alone rather than risk silently discarding a real one
 * (e.g. a reversed component, where the OTHER terminal legitimately
 * touching a resistor must not excuse this one).
 */
function discardFalseMissingResistorClaims(circuit, diagnosis) {
  const components = Array.isArray(circuit?.components) ? circuit.components : [];
  const resistorTerminals = buildResistorTerminals(circuit);

  const survivingFaults = diagnosis.faults.filter((fault) => {
    if (resistorTerminals.size === 0 || !/no series resistor|without a series current-limiting resistor/i.test(fault.issue)) return true;
    const component = components.find((candidate) => candidate.id === fault.componentId);
    const spec = component && COMPONENT_SPECS[component.type];
    if (!spec) return true;

    const resistorPins = spec.pins.filter((pin) => pin.role === 'polarized' && pin.seriesResistorRequired);
    if (resistorPins.length === 0) return true;

    const mentioned = resistorPins.filter((pin) => mentionsTerminal(fault.issue, normalizePinId(component[pin.field]), pin.field));
    if (mentioned.length !== 1) return true; // ambiguous or unidentified accusation — leave it alone

    return !terminalTouchesResistor(circuit, normalizePinId(component[mentioned[0].field]), resistorTerminals);
  });

  if (survivingFaults.length === diagnosis.faults.length) return diagnosis;

  return {
    ...diagnosis,
    hasFault: survivingFaults.length > 0,
    faults: survivingFaults,
    suspectedComponents: survivingFaults.map((fault) => fault.componentId),
    suspectedComponent: survivingFaults[0]?.componentId ?? null,
    suspectedIssue: survivingFaults[0]?.issue ?? null,
    reasoning: `${diagnosis.reasoning} (A claimed missing-series-resistor fault was discarded: a resistor terminal is directly wired to the accused pin, so the claim did not hold up.)`
  };
}

module.exports = { terminalTouchesResistor, discardFalseMissingResistorClaims };
