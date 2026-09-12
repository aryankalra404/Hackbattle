require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const OpenAI = require('openai');

const DATASHEETS_DIR = path.join(__dirname, '..', 'datasheets');
const STORE_PATH = path.join(__dirname, '..', 'rag', 'vectorStore.json');
const EMBEDDING_MODEL = 'text-embedding-3-small';

function chunkDatasheet(filename, content) {
  const lines = content.trim().split('\n');
  const title = lines.shift().trim();
  const chunks = [];
  let heading = null;
  let body = [];

  function addChunk() {
    if (!heading || body.length === 0) return;
    chunks.push({
      id: `${path.basename(filename, path.extname(filename))}-${chunks.length + 1}`,
      source: filename,
      heading,
      text: [title, '', heading, ...body].join('\n').trim()
    });
  }

  for (const line of lines) {
    if (line.trim().endsWith(':') && !line.trimStart().startsWith('-')) {
      addChunk();
      heading = line.trim();
      body = [];
    } else if (heading) {
      body.push(line);
    }
  }
  addChunk();
  return chunks;
}

async function buildIndex() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required to build the RAG index.');
  const filenames = (await fs.readdir(DATASHEETS_DIR)).filter((filename) => filename.endsWith('.md')).sort();
  const chunks = [];
  for (const filename of filenames) {
    chunks.push(...chunkDatasheet(filename, await fs.readFile(path.join(DATASHEETS_DIR, filename), 'utf8')));
  }
  if (chunks.length === 0) throw new Error('No datasheet chunks were found.');

  console.log(`[rag] embedding ${chunks.length} chunks with ${EMBEDDING_MODEL}`);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.embeddings.create({ model: EMBEDDING_MODEL, input: chunks.map((chunk) => chunk.text) });
  const store = {
    version: 1,
    model: EMBEDDING_MODEL,
    createdAt: new Date().toISOString(),
    chunks: chunks.map((chunk, index) => ({ ...chunk, embedding: response.data[index].embedding }))
  };
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`);
  console.log(`[rag] wrote ${store.chunks.length} chunks to ${STORE_PATH}`);
  return store;
}

if (require.main === module) {
  buildIndex().catch((error) => {
    console.error(`[rag] index build failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { buildIndex, chunkDatasheet, EMBEDDING_MODEL, STORE_PATH };
