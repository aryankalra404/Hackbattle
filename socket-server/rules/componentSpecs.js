/**
 * Declarative pin-role spec per component type — the single source of truth
 * for wiring-topology reasoning. Both the deterministic rule engine
 * (genericPinRoles.js, circuitGraph.js) and the LLM prompt
 * (reasoning/openaiCircuitReasoner.js, via describeSpecsForPrompt below)
 * read from this table instead of having per-type logic or prose written
 * out by hand. Adding a new spawnable component (see CircuitComponent.cs)
 * means adding one entry here — no new rule file, no new prompt paragraph.
 *
 * Pin roles:
 *  - 'power': must trace, via wires only, to a supply pin. `voltage: '5V'`
 *    requires that exact rail; `voltage: 'any'` accepts any valid source
 *    (a D-number pin, VIN, 5V, or 3V3).
 *  - 'ground': must trace to GND.
 *  - 'signal': must trace to a non-supply, non-ground pin (a digital I/O
 *    pin) — tying it to a supply or GND is a fault.
 *  - 'polarized': a two-state leg like an LED's anode/cathode or a motor's
 *    +/-. `polarity: 'positive'` must reach a valid source; `'negative'`
 *    must reach GND. `seriesResistorRequired: true` means the positive
 *    leg's path to source must cross a Resistor's body, not connect
 *    directly (a real electrical requirement for an LED, not for a motor).
 *  - 'passthrough': a two-leg component that bridges whatever it's wired
 *    to (e.g. a resistor) rather than requiring anything of its own pins.
 *    Its own component-specific checks (like a sane ohm value) live
 *    outside this table, in resistorSanity.js — that's a value check, not
 *    a wiring-topology one, so it stays scoped to the type that has it.
 */
const COMPONENT_SPECS = {
  led: {
    pins: [
      { field: 'anode', role: 'polarized', polarity: 'positive', seriesResistorRequired: true },
      { field: 'cathode', role: 'polarized', polarity: 'negative' }
    ]
  },
  motor: {
    pins: [
      { field: 'positive', role: 'polarized', polarity: 'positive' },
      { field: 'negative', role: 'polarized', polarity: 'negative' }
    ]
  },
  resistor: {
    pins: [
      { field: 'a', role: 'passthrough' },
      { field: 'b', role: 'passthrough' }
    ]
  },
  pir: {
    pins: [
      { field: 'vcc', role: 'power', voltage: '5V' },
      { field: 'gnd', role: 'ground' },
      { field: 'signal', role: 'signal' }
    ]
  },
  ultrasonic: {
    pins: [
      { field: 'vcc', role: 'power', voltage: '5V' },
      { field: 'gnd', role: 'ground' },
      { field: 'trig', role: 'signal' },
      { field: 'echo', role: 'signal' }
    ]
  }
};

function describePin(pin) {
  switch (pin.role) {
    case 'power':
      return `${pin.field} = power (must reach ${pin.voltage === '5V' ? 'exactly 5V' : 'a valid source: a D-number pin, VIN, 5V, or 3V3'})`;
    case 'ground':
      return `${pin.field} = ground (must reach GND)`;
    case 'signal':
      return `${pin.field} = signal (must reach a non-supply, non-ground digital pin)`;
    case 'polarized':
      return pin.polarity === 'positive'
        ? `${pin.field} = positive terminal (must reach a valid source${pin.seriesResistorRequired ? ', through a resistor — never directly' : ''})`
        : `${pin.field} = negative terminal (must reach GND)`;
    case 'passthrough':
      return `${pin.field} = passthrough terminal (bridges whatever it's wired to)`;
    default:
      return `${pin.field} = ${pin.role}`;
  }
}

/** Renders the spec table as prompt text — regenerated from this file, never hand-written. */
function describeSpecsForPrompt() {
  return Object.entries(COMPONENT_SPECS)
    .map(([type, spec]) => `- ${type}: ${spec.pins.map(describePin).join('; ')}.`)
    .join('\n');
}

module.exports = { COMPONENT_SPECS, describeSpecsForPrompt };
