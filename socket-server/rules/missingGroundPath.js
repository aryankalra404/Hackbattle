const { buildGraph, powerNodes, reachable, terminalNode } = require('./circuitGraph');

function normalizePinId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

// This graph intentionally uses only physical jumper wires. Component terminal
// fields are identifiers (for example "LED_CATHODE"), not proof that a wire is
// currently plugged in.
function buildWireGraph(wires) {
  const graph = new Map();
  for (const wire of wires) {
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

function reachesGround(graph, start) {
  if (!start || !graph.has(start)) return false;
  const seen = new Set([start]);
  const queue = [start];
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index];
    if (node === 'gnd') return true;
    for (const neighbor of graph.get(node) || []) {
      if (!seen.has(neighbor)) {
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return false;
}

module.exports = function missingGroundPath(circuit) {
  const components = Array.isArray(circuit.components) ? circuit.components : [];
  const leds = components.filter((component) => component.type === 'led');
  // This rule is LED-specific. A PIR-only circuit is valid to evaluate and
  // must not be reported as faulty merely because it contains no LED.
  if (!leds.length) return null;

  const graph = buildGraph(circuit);
  const fromPower = reachable(graph, powerNodes(graph));
  const wires = Array.isArray(circuit.wires) ? circuit.wires : [];
  const wireGraph = buildWireGraph(wires);

  for (const led of leds) {
    const anode = terminalNode(led, 'anode');
    const cathodePinId = normalizePinId(led.cathode);

    // Unity serializes a connection as { from: pinA.pinId, to: pinB.pinId }.
    // Therefore the traversal must start at led.cathode, not at the server's
    // internal label "led-1-cathode".
    if (!reachesGround(wireGraph, cathodePinId)) {
      return `LED ${led.id} has no continuous path from its cathode to GND. Check the ground wire.`;
    }
    if (!fromPower.has(anode)) {
      return `LED ${led.id} has no power-side path to its anode. Check the resistor and power-pin wiring.`;
    }
  }
  return null;
};
