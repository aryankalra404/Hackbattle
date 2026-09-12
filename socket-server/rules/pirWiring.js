function normalizePinId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function buildWireGraph(wires) {
  const graph = new Map();
  for (const wire of Array.isArray(wires) ? wires : []) {
    const from = normalizePinId(wire?.from);
    const to = normalizePinId(wire?.to);
    if (!from || !to) continue;
    if (!graph.has(from)) graph.set(from, new Set());
    if (!graph.has(to)) graph.set(to, new Set());
    graph.get(from).add(to);
    graph.get(to).add(from);
  }
  return graph;
}

function reaches(graph, start, matches) {
  if (!start || !graph.has(start)) return false;
  const seen = new Set([start]);
  const queue = [start];
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index];
    if (matches(node)) return true;
    for (const next of graph.get(node) || []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

function intendedPirSignalPin(intent) {
  if (typeof intent !== 'string' || !/\bpir\b/i.test(intent)) return null;
  const match = intent.match(/\bd\s*(\d+)\b/i);
  return match ? `d${match[1]}` : null;
}

/**
 * Returns one combined, checkable fault per PIR. This is deliberately
 * deterministic so incorrect sensor wiring cannot be passed through as a
 * healthy LED circuit when the LLM is unavailable or overly permissive.
 */
function findPirFaults(circuit, intent = '') {
  const graph = buildWireGraph(circuit?.wires);
  const expectedSignalPin = intendedPirSignalPin(intent);
  const pirs = Array.isArray(circuit?.components)
    ? circuit.components.filter((component) => component?.type === 'pir')
    : [];

  return pirs.flatMap((pir) => {
    const issues = [];
    const vcc = normalizePinId(pir.vcc);
    const gnd = normalizePinId(pir.gnd);
    const signal = normalizePinId(pir.signal);

    if (!reaches(graph, vcc, (node) => node === '5v' || node === '5.0v')) {
      issues.push('VCC must have a physical connection to the Arduino 5V pin');
    }
    if (!reaches(graph, gnd, (node) => node === 'gnd' || node === 'ground' || node === '0v')) {
      issues.push('GND must have a physical connection to common GND');
    }
    if (!reaches(graph, signal, (node) => /^d\d+$/.test(node))) {
      issues.push('SIGNAL must connect to an Arduino digital pin');
    } else if (expectedSignalPin && !reaches(graph, signal, (node) => node === expectedSignalPin)) {
      issues.push(`SIGNAL must connect to ${expectedSignalPin.toUpperCase()} to match the stated intent`);
    }

    return issues.length ? [{ componentId: pir.id, issue: `PIR ${pir.id}: ${issues.join('; ')}.` }] : [];
  });
}

function pirWiring(circuit) {
  return findPirFaults(circuit)[0]?.issue || null;
}

module.exports = pirWiring;
module.exports.findPirFaults = findPirFaults;
