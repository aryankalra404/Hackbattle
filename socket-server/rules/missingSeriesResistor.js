const { isPowerNode, terminalNode } = require('./circuitGraph');

function addEdge(graph, from, to, crossesResistor = false) {
  if (typeof from !== 'string' || typeof to !== 'string' || !from || !to) return;
  if (!graph.has(from)) graph.set(from, []);
  if (!graph.has(to)) graph.set(to, []);
  graph.get(from).push({ node: to, crossesResistor });
  graph.get(to).push({ node: from, crossesResistor });
}

function buildPathGraph(circuit) {
  const graph = new Map();
  for (const wire of Array.isArray(circuit.wires) ? circuit.wires : []) addEdge(graph, wire?.from, wire?.to);
  for (const component of Array.isArray(circuit.components) ? circuit.components : []) {
    if (!component || typeof component.id !== 'string') continue;
    if (component.type === 'led') {
      if (typeof component.anode === 'string') addEdge(graph, terminalNode(component, 'anode'), component.anode);
      if (typeof component.cathode === 'string') addEdge(graph, terminalNode(component, 'cathode'), component.cathode);
    }
    if (component.type === 'resistor') {
      if (typeof component.a === 'string') addEdge(graph, terminalNode(component, 'a'), component.a);
      if (typeof component.b === 'string') addEdge(graph, terminalNode(component, 'b'), component.b);
      addEdge(graph, terminalNode(component, 'a'), terminalNode(component, 'b'), true);
    }
  }
  return graph;
}

function powerPathState(graph, start) {
  const queue = [{ node: start, crossesResistor: false }];
  const visited = new Set([`${start}:false`]);
  let hasPowerPath = false;
  let hasUnprotectedPowerPath = false;

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (isPowerNode(current.node)) {
      hasPowerPath = true;
      if (!current.crossesResistor) hasUnprotectedPowerPath = true;
    }
    for (const edge of graph.get(current.node) || []) {
      const crossesResistor = current.crossesResistor || edge.crossesResistor;
      const key = `${edge.node}:${crossesResistor}`;
      if (!visited.has(key)) {
        visited.add(key);
        queue.push({ node: edge.node, crossesResistor });
      }
    }
  }
  return { hasPowerPath, hasUnprotectedPowerPath };
}

module.exports = function missingSeriesResistor(circuit) {
  const graph = buildPathGraph(circuit);
  for (const led of (circuit.components || []).filter((component) => component.type === 'led')) {
    const { hasPowerPath, hasUnprotectedPowerPath } = powerPathState(graph, terminalNode(led, 'anode'));
    if (hasPowerPath && hasUnprotectedPowerPath) {
      return `LED ${led.id} is connected to a power pin without a series current-limiting resistor. Add a 220 ohm resistor in series with its anode.`;
    }
  }
  return null;
};
