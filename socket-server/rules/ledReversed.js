const { buildGraph, isGround, powerNodes, reachable, terminalNode } = require('./circuitGraph');

module.exports = function ledReversed(circuit) {
  // Do not traverse resistor bodies here. We only want to inspect which side of
  // the LED is attached to a rail, rather than letting a series resistor blur
  // the two sides together.
  const graph = buildGraph(circuit, { includeResistorBodies: false });
  const fromPower = reachable(graph, powerNodes(graph));
  const fromGround = reachable(graph, [...graph.keys()].filter(isGround));
  for (const led of (circuit.components || []).filter((component) => component.type === 'led')) {
    const anode = terminalNode(led, 'anode');
    const cathode = terminalNode(led, 'cathode');
    if (fromPower.has(cathode) && fromGround.has(anode) && !(fromPower.has(anode) && fromGround.has(cathode))) {
      return `LED ${led.id} appears reversed: connect its anode toward the power/resistor side and cathode toward GND.`;
    }
  }
  return null;
};
