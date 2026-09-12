require('dotenv').config();
const fs = require('fs/promises');
const OpenAI = require('openai');
const { EMBEDDING_MODEL, STORE_PATH } = require('../scripts/buildIndex');

function cosineSimilarity(left, right) {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

async function retrieve(query, topK = 2) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('A non-empty retrieval query is required.');
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for RAG retrieval.');

  let store;
  try {
    store = JSON.parse(await fs.readFile(STORE_PATH, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('RAG index is missing. Run `npm run rag:index` first.');
    throw error;
  }
  if (!Array.isArray(store.chunks) || store.chunks.length === 0) throw new Error('RAG index contains no chunks.');
  if (store.model !== EMBEDDING_MODEL) throw new Error(`RAG index uses ${store.model}; rebuild it with ${EMBEDDING_MODEL}.`);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.embeddings.create({ model: store.model, input: query.trim() });
  const queryEmbedding = response.data[0].embedding;
  return store.chunks
    .map((chunk) => ({ ...chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(topK, store.chunks.length)));
}

module.exports = { retrieve, cosineSimilarity };
