const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * File-backed commit history for CircuitDoctor sessions.
 *
 * One JSON file per session under `data/commits/<sessionId>.json`, holding an
 * array of commits newest-first. Unlike session state (in-memory, reset on
 * restart), this is the durable "version control" the Quest build gets
 * committed into from the web dashboard.
 */

const DATA_DIR = path.join(__dirname, 'data', 'commits');

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function sessionFile(sessionId) {
  const safe = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DATA_DIR, `${safe}.json`);
}

function readAll(sessionId) {
  try {
    const raw = fs.readFileSync(sessionFile(sessionId), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[commits] failed to read history for ${sessionId}: ${error.message}`);
    }
    return [];
  }
}

function writeAll(sessionId, commits) {
  ensureDataDir();
  fs.writeFileSync(sessionFile(sessionId), JSON.stringify(commits, null, 2));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((out, key) => {
        out[key] = canonicalize(value[key]);
        return out;
      }, {});
  }
  return value;
}

function hashCircuit(circuit) {
  const canonical = JSON.stringify(canonicalize(circuit));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function summarize(commit) {
  const components = Array.isArray(commit.circuit?.components) ? commit.circuit.components.length : 0;
  const wires = Array.isArray(commit.circuit?.wires) ? commit.circuit.wires.length : 0;
  return {
    id: commit.id,
    message: commit.message,
    author: commit.author,
    createdAt: commit.createdAt,
    parentId: commit.parentId,
    componentCount: components,
    wireCount: wires,
  };
}

/**
 * Create a commit for a session. `circuit` is the exact `{ components, wires }`
 * shape the Quest streams (now including each component's position/rotation
 * and the board transform) — stored as-is so a later restore can reproduce it.
 */
function createCommit(sessionId, { message, author, circuit }) {
  if (!circuit || typeof circuit !== 'object') {
    throw new Error('createCommit needs a circuit snapshot');
  }
  const history = readAll(sessionId);
  const parentId = history[0]?.id ?? null;
  const id = hashCircuit({ circuit, parentId, message, author, at: Date.now() }).slice(0, 12);
  const commit = {
    id,
    parentId,
    message: typeof message === 'string' && message.trim() ? message.trim() : '(no message)',
    author: typeof author === 'string' && author.trim() ? author.trim() : 'quest',
    createdAt: new Date().toISOString(),
    circuit,
  };
  history.unshift(commit);
  writeAll(sessionId, history);
  return commit;
}

function listCommits(sessionId) {
  return readAll(sessionId).map(summarize);
}

function getCommit(sessionId, commitId) {
  return readAll(sessionId).find((commit) => commit.id === commitId) ?? null;
}

module.exports = { createCommit, listCommits, getCommit, summarizeCommit: summarize };
