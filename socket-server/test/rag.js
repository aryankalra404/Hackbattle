const { retrieve } = require('../rag/retrieve');

const queries = [
  'LED reversed polarity',
  'PIR wrong voltage on VCC',
  'missing resistor in an LED circuit'
];

async function main() {
  for (const query of queries) {
    console.log(`\n=== ${query} ===`);
    const matches = await retrieve(query);
    for (const match of matches) {
      console.log(`[${match.source} — ${match.heading}; score ${match.score.toFixed(4)}]`);
      console.log(`${match.text}\n`);
    }
  }
}

main().catch((error) => {
  console.error(`[rag] test failed: ${error.message}`);
  process.exitCode = 1;
});
