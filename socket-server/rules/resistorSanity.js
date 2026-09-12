module.exports = function resistorSanity(circuit) {
  for (const resistor of (circuit.components || []).filter((component) => component.type === 'resistor')) {
    if (resistor.value == null) continue; // Intentional stub until Unity supplies values.
    const ohms = Number(String(resistor.value).replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(ohms) || ohms <= 0) return `Resistor ${resistor.id} has an invalid value.`;
    if (ohms < 100) return `Resistor ${resistor.id} is ${ohms}Ω, which is too low for a typical LED demo circuit.`;
  }
  return null;
};
