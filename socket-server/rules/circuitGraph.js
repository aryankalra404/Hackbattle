// Shared node-classification helpers used by the generic wiring checker
// (genericPinRoles.js). Deliberately just pin-label pattern matching, not
// tied to any component type — every type-specific graph-building this
// file used to do now lives in genericPinRoles.js, spec-driven instead of
// hardcoded per type.

function isGround(node) {
  return typeof node === 'string' && /^(gnd|ground|0v)$/i.test(node.trim());
}

function isPowerNode(node) {
  // Covers Arduino-style pins (D13), supply labels (5V/VCC), and common positive rails.
  return typeof node === 'string' && /^(?:[ad]\d+|\d+(?:\.\d+)?v|vcc|vin|\+\d+(?:\.\d+)?v)$/i.test(node.trim());
}

module.exports = { isGround, isPowerNode };
