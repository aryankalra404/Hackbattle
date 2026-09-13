const { isPowerNode, isGround } = require('./circuitGraph');
const { COMPONENT_SPECS } = require('./componentSpecs');

function normalizePinId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Wire-only graph, edges tagged with whether they cross a passthrough
 * component's body (a resistor) — generalizes the same trick the old
 * LED-only missingSeriesResistor.js used, now available to any component
 * type whose spec marks a pin `seriesResistorRequired`.
 */
function buildPathGraph(circuit) {
  const graph = new Map();
  const addEdge = (from, to, crossesResistor = false) => {
    if (!from || !to) return;
    if (!graph.has(from)) graph.set(from, []);
    if (!graph.has(to)) graph.set(to, []);
    graph.get(from).push({ node: to, crossesResistor });
    graph.get(to).push({ node: from, crossesResistor });
  };

  for (const wire of Array.isArray(circuit?.wires) ? circuit.wires : []) {
    addEdge(normalizePinId(wire?.from), normalizePinId(wire?.to));
  }

  for (const component of Array.isArray(circuit?.components) ? circuit.components : []) {
    const spec = COMPONENT_SPECS[component?.type];
    if (!spec) continue;
    const passthroughFields = spec.pins.filter((pin) => pin.role === 'passthrough').map((pin) => pin.field);
    if (passthroughFields.length === 2) {
      addEdge(normalizePinId(component[passthroughFields[0]]), normalizePinId(component[passthroughFields[1]]), true);
    }
  }
  return graph;
}

/** BFS tracking whether power/ground was reached, and whether power was reached without crossing a resistor. */
function traceState(graph, start) {
  const startId = normalizePinId(start);
  const state = { reachesPower: false, reachesPowerDirectly: false, reachesGround: false };
  if (!startId || !graph.has(startId)) return state;

  const queue = [{ node: startId, crossesResistor: false }];
  const visited = new Set([`${startId}:false`]);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (isPowerNode(current.node)) {
      state.reachesPower = true;
      if (!current.crossesResistor) state.reachesPowerDirectly = true;
    }
    if (isGround(current.node)) state.reachesGround = true;
    for (const edge of graph.get(current.node) || []) {
      const crossesResistor = current.crossesResistor || edge.crossesResistor;
      const key = `${edge.node}:${crossesResistor}`;
      if (!visited.has(key)) {
        visited.add(key);
        queue.push({ node: edge.node, crossesResistor });
      }
    }
  }
  return state;
}

/** Plain wire-only reachability, ignoring resistor-crossing — for power/ground/signal role checks. */
function reachesAny(graph, start, matches) {
  const startId = normalizePinId(start);
  if (!startId || !graph.has(startId)) return false;
  const seen = new Set([startId]);
  const queue = [startId];
  for (let index = 0; index < queue.length; index += 1) {
    if (matches(queue[index])) return true;
    for (const edge of graph.get(queue[index]) || []) {
      if (!seen.has(edge.node)) {
        seen.add(edge.node);
        queue.push(edge.node);
      }
    }
  }
  return false;
}

function intendedSignalPin(intent, forType) {
  if (typeof intent !== 'string' || !new RegExp(`\\b${forType}\\b`, 'i').test(intent)) return null;
  const match = intent.match(/\bd\s*(\d+)\b/i);
  return match ? `d${match[1]}` : null;
}

const VOLTAGE_ALIASES = { '5v': ['5v', '5.0v'] };

/**
 * Deterministic, spec-driven wiring check for every spawned component —
 * the fallback used when the LLM call fails, and cross-checked against the
 * LLM's own findings (see mergeDeterministicFaults in openaiCircuitReasoner.js).
 * Add a new component type by adding an entry to componentSpecs.js; this
 * function needs no changes for it.
 */
function findWiringFaults(circuit, intent = '') {
  const graph = buildPathGraph(circuit);
  const faults = [];

  for (const component of Array.isArray(circuit?.components) ? circuit.components : []) {
    const spec = COMPONENT_SPECS[component?.type];
    if (!spec) continue;
    const issues = [];

    for (const pin of spec.pins) {
      const pinId = component[pin.field];
      if (typeof pinId !== 'string' || !pinId.trim()) continue; // unwired terminal — not this function's job

      if (pin.role === 'power') {
        if (pin.voltage && pin.voltage !== 'any') {
          const aliases = VOLTAGE_ALIASES[pin.voltage.toLowerCase()] || [pin.voltage.toLowerCase()];
          if (!reachesAny(graph, pinId, (node) => aliases.includes(node))) {
            issues.push(`${pin.field.toUpperCase()} must have a physical connection to ${pin.voltage}`);
          }
        } else if (!traceState(graph, pinId).reachesPower) {
          issues.push(`${pin.field.toUpperCase()} must have a physical connection to a valid power source`);
        }
      }

      if (pin.role === 'ground' && !reachesAny(graph, pinId, isGround)) {
        issues.push(`${pin.field.toUpperCase()} must have a physical connection to common GND`);
      }

      if (pin.role === 'signal') {
        if (!reachesAny(graph, pinId, (node) => /^[ad]\d+$/.test(node))) {
          issues.push(`${pin.field.toUpperCase()} must connect to an Arduino digital pin`);
        } else {
          const expected = intendedSignalPin(intent, component.type);
          if (expected && !reachesAny(graph, pinId, (node) => node === expected)) {
            issues.push(`${pin.field.toUpperCase()} must connect to ${expected.toUpperCase()} to match the stated intent`);
          }
        }
      }

      if (pin.role === 'polarized') {
        const state = traceState(graph, pinId);
        if (pin.polarity === 'positive') {
          if (state.reachesGround) {
            issues.push(`appears reversed: its ${pin.field} is wired toward GND instead of a power source`);
          } else if (pin.seriesResistorRequired && state.reachesPowerDirectly) {
            issues.push(`is connected to a power pin without a series current-limiting resistor. Add a resistor in series with its ${pin.field}`);
          } else if (!state.reachesPower) {
            issues.push(`has no continuous path from its ${pin.field} to a power source`);
          }
        } else if (pin.polarity === 'negative') {
          if (state.reachesPower && !state.reachesGround) {
            issues.push(`appears reversed: its ${pin.field} is wired toward power instead of GND`);
          } else if (!state.reachesGround) {
            issues.push(`has no continuous path from its ${pin.field} to GND. Check the ground wire`);
          }
        }
      }
    }

    if (issues.length) {
      faults.push({ componentId: component.id, issue: `${component.id} ${issues.join('; ')}.` });
    }
  }

  return faults;
}

module.exports = { findWiringFaults };
