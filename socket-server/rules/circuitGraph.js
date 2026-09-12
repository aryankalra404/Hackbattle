// Converts the flexible Unity circuit JSON into an undirected connectivity graph.
// A component terminal is available as both "componentId-terminal" and its field value.
function addEdge(graph, a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return;
  if (!graph.has(a)) graph.set(a, new Set());
  if (!graph.has(b)) graph.set(b, new Set());
  graph.get(a).add(b);
  graph.get(b).add(a);
}

function terminalNode(component, terminal) {
  return `${component.id}-${terminal}`;
}

function buildGraph(circuit, { includeResistorBodies = true } = {}) {
  const graph = new Map();
  const components = Array.isArray(circuit.components) ? circuit.components : [];
  const wires = Array.isArray(circuit.wires) ? circuit.wires : [];

  for (const wire of wires) addEdge(graph, wire.from, wire.to);
  for (const component of components) {
    if (!component || typeof component.id !== 'string') continue;
    const terminals = component.type === 'led' ? ['anode', 'cathode'] : component.type === 'resistor' ? ['a', 'b'] : [];
    for (const terminal of terminals) {
      const port = terminalNode(component, terminal);
      if (!graph.has(port)) graph.set(port, new Set());
      if (typeof component[terminal] === 'string') addEdge(graph, port, component[terminal]);
    }
    // Resistors conduct in either direction. LEDs are intentionally not bridged here:
    // rules need to inspect their anode and cathode independently for polarity.
    if (includeResistorBodies && component.type === 'resistor') addEdge(graph, terminalNode(component, 'a'), terminalNode(component, 'b'));
  }
  return graph;
}

function reachable(graph, starts) {
  const seen = new Set();
  const queue = starts.filter((node) => graph.has(node));
  for (const node of queue) seen.add(node);
  for (let index = 0; index < queue.length; index += 1) {
    for (const neighbor of graph.get(queue[index]) || []) {
      if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); }
    }
  }
  return seen;
}

function isGround(node) {
  return typeof node === 'string' && /^(gnd|ground|0v)$/i.test(node.trim());
}

function isPowerNode(node) {
  // Covers Arduino-style pins (D13), supply labels (5V/VCC), and common positive rails.
  return typeof node === 'string' && /^(?:[ad]\d+|\d+(?:\.\d+)?v|vcc|vin|\+\d+(?:\.\d+)?v)$/i.test(node.trim());
}

function powerNodes(graph) {
  return [...graph.keys()].filter(isPowerNode);
}

module.exports = { buildGraph, isGround, isPowerNode, powerNodes, reachable, terminalNode };
