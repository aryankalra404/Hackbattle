/**
 * A deterministic, code-only simulator for the LED patterns this demo
 * supports: turning an LED on, or blinking it. This is not a general
 * Arduino interpreter — it understands exactly `pinMode(_, OUTPUT)`,
 * `digitalWrite(_, HIGH|LOW)` and `delay(_)` inside `loop()`. That is
 * deliberate: a real circuit/instruction-level simulator is out of scope,
 * and this covers every pattern someone can actually build with the parts
 * this app has (LED + resistor + Arduino).
 *
 * No LLM involved — this is pure, fast, free graph/text analysis, run right
 * after a successful compile.
 */

function normalizePinToken(token) {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  if (/^\d+$/.test(trimmed)) return `d${trimmed}`;
  if (/^LED_BUILTIN$/i.test(trimmed)) return 'd13';
  return trimmed.toLowerCase();
}

function normalizeWireEndpoint(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function extractLoopBody(code) {
  const match = /void\s+loop\s*\([^)]*\)\s*\{/.exec(code);
  if (!match) return null;
  let depth = 1;
  let i = match.index + match[0].length;
  const start = i;
  while (i < code.length && depth > 0) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') depth -= 1;
    i += 1;
  }
  return depth === 0 ? code.slice(start, i - 1) : null;
}

const STATEMENT_PATTERN = /digitalWrite\s*\(\s*([A-Za-z0-9_]+)\s*,\s*(HIGH|LOW)\s*\)\s*;|delay\s*\(\s*(\d+)\s*\)\s*;/g;

/** Walks loop() top to bottom, building a {pin, state, atMs} write list and total loop duration. */
function parseLoopEvents(loopBody) {
  const writes = [];
  let clock = 0;
  let match;
  let consumedLength = 0;
  STATEMENT_PATTERN.lastIndex = 0;
  while ((match = STATEMENT_PATTERN.exec(loopBody))) {
    consumedLength += match[0].length;
    if (match[1]) writes.push({ pin: normalizePinToken(match[1]), state: match[2], atMs: clock });
    else if (match[3]) clock += Number(match[3]);
  }
  // Whatever isn't whitespace and isn't one of our two recognized statements
  // is a construct we don't simulate (if/for/while/custom functions/etc).
  const nonStatementText = loopBody.replace(STATEMENT_PATTERN, '').replace(/[\s;{}]/g, '');
  return { writes, totalMs: clock, fullyUnderstood: nonStatementText.length === 0 };
}

/** Steady-state segments for one pin: [{state, durationMs}], covering one full loop cycle. */
function pinSegments(writes, totalMs, pin) {
  const pinWrites = writes.filter((w) => w.pin === pin);
  if (pinWrites.length === 0) return [];
  return pinWrites.map((write, index) => {
    const next = pinWrites[index + 1];
    const end = next ? next.atMs : totalMs + pinWrites[0].atMs;
    return { state: write.state, durationMs: Math.max(0, end - write.atMs) };
  });
}

function classifyPattern(segments) {
  if (segments.length === 0) return { kind: 'off' };
  if (segments.every((s) => s.state === 'LOW')) return { kind: 'off' };
  if (segments.every((s) => s.state === 'HIGH')) return { kind: 'on' };
  if (segments.length === 2 && segments[0].state !== segments[1].state) {
    const on = segments.find((s) => s.state === 'HIGH');
    const off = segments.find((s) => s.state === 'LOW');
    return { kind: 'blink', onMs: on.durationMs || 500, offMs: off.durationMs || 500 };
  }
  return { kind: 'pattern', segments };
}

function addEdge(graph, from, to) {
  if (!from || !to) return;
  if (!graph.has(from)) graph.set(from, new Set());
  if (!graph.has(to)) graph.set(to, new Set());
  graph.get(from).add(to);
  graph.get(to).add(from);
}

/**
 * Builds the connectivity graph from actual wires, plus one internal edge per
 * resistor between its own two terminals — a resistor passes current through
 * itself, so its two pins are reachable from one another even though no wire
 * entry directly names them both (the wires instead land on each terminal
 * separately, e.g. D9->resistor-1-a and resistor-1-b->led-1-anode).
 */
function buildWireGraph(circuit) {
  const graph = new Map();
  for (const wire of Array.isArray(circuit?.wires) ? circuit.wires : []) {
    addEdge(graph, normalizeWireEndpoint(wire?.from), normalizeWireEndpoint(wire?.to));
  }
  for (const component of circuit?.components || []) {
    if (component?.type !== 'resistor') continue;
    addEdge(graph, normalizeWireEndpoint(component.a), normalizeWireEndpoint(component.b));
  }
  return graph;
}

function reaches(graph, start, target) {
  if (!graph.has(start)) return false;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const node = queue.shift();
    if (node === target) return true;
    for (const next of graph.get(node) || []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/** Every LED (by id) whose anode is reachable from `pin` through the wire graph, resistor hops included. */
function findLedsForPin(circuit, pin, graph) {
  const matches = [];
  for (const component of circuit?.components || []) {
    if (component?.type !== 'led') continue;
    const anode = normalizeWireEndpoint(component.anode);
    if (anode && reaches(graph, pin, anode)) matches.push(component.id);
  }
  return matches;
}

/**
 * Simulates the compiled sketch's effect on whatever LEDs are wired in
 * `circuit`. Returns { ok, leds: [{ledId, pin, pattern, onMs?, offMs?}], warnings }.
 */
function simulateSketch(circuit, code) {
  const loopBody = extractLoopBody(typeof code === 'string' ? code : '');
  if (loopBody === null) {
    return { ok: false, leds: [], warnings: ['Could not find a loop() function to simulate.'] };
  }

  const { writes, totalMs, fullyUnderstood } = parseLoopEvents(loopBody);
  const warnings = [];
  if (!fullyUnderstood) {
    warnings.push(
      'loop() has more than plain digitalWrite/delay calls (if/for/while/functions) — simulating just that sequence and ignoring the rest for now.',
    );
  }

  const graph = buildWireGraph(circuit);
  const pins = [...new Set(writes.map((w) => w.pin))];
  const leds = [];
  const controlledLedIds = new Set();

  for (const pin of pins) {
    const ledIds = findLedsForPin(circuit, pin, graph);
    if (ledIds.length === 0) {
      warnings.push(`Code writes to ${pin.toUpperCase()} but no LED is wired to it.`);
      continue;
    }
    const segments = pinSegments(writes, totalMs, pin);
    const pattern = classifyPattern(segments);
    for (const ledId of ledIds) {
      controlledLedIds.add(ledId);
      leds.push({ ledId, pin: pin.toUpperCase(), pattern: pattern.kind, onMs: pattern.onMs, offMs: pattern.offMs });
    }
  }

  for (const component of circuit?.components || []) {
    if (component?.type === 'led' && !controlledLedIds.has(component.id)) {
      warnings.push(`${component.id} is wired but the code never writes to its pin, so it stays off.`);
    }
  }

  return { ok: true, leds, warnings };
}

module.exports = { simulateSketch, extractLoopBody, parseLoopEvents, classifyPattern };
