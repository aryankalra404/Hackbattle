const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Compiles an Arduino sketch with the real Arduino CLI (avr-gcc under the
 * hood) — no third-party API, no key required. Requires `arduino-cli` on
 * PATH with the `arduino:avr` core installed (`arduino-cli core install
 * arduino:avr`), same as any local Arduino IDE setup.
 */

const FQBN = process.env.ARDUINO_FQBN || 'arduino:avr:uno';
const ARDUINO_CLI = process.env.ARDUINO_CLI_PATH || 'arduino-cli';
const COMPILE_TIMEOUT_MS = Number(process.env.ARDUINO_COMPILE_TIMEOUT_MS || 20000);

function extractErrors(compilerErr) {
  const lines = typeof compilerErr === 'string' ? compilerErr.split('\n') : [];
  const pattern = /:(\d+):(\d+):\s*(?:fatal error|error):\s*(.+)$/;
  const errors = [];
  for (const line of lines) {
    const match = line.match(pattern);
    if (match) errors.push({ line: Number(match[1]), column: Number(match[2]), message: match[3].trim() });
  }
  return errors;
}

function runArduinoCli(sketchDir) {
  return new Promise((resolve) => {
    execFile(
      ARDUINO_CLI,
      ['compile', '--fqbn', FQBN, sketchDir, '--format', 'json'],
      { timeout: COMPILE_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error && error.code === 'ENOENT') {
          resolve({ toolMissing: true });
          return;
        }
        let compilerErr = '';
        try {
          compilerErr = JSON.parse(stdout).compiler_err || '';
        } catch {
          compilerErr = stdout || (error ? error.message : '');
        }
        resolve({ ok: !error, compilerErr });
      },
    );
  });
}

/** Returns { ok: true } or { ok: false, errors: [{line, column, message}] }. */
async function compileSketch(code) {
  const trimmed = typeof code === 'string' ? code.trim() : '';
  if (!trimmed) {
    return { ok: false, errors: [{ line: null, column: null, message: 'Nothing to compile — write some code first.' }] };
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'circuitdoctor-sketch-'));
  const sketchDir = path.join(workDir, 'sketch');
  fs.mkdirSync(sketchDir);
  fs.writeFileSync(path.join(sketchDir, 'sketch.ino'), code);

  try {
    const result = await runArduinoCli(sketchDir);
    if (result.toolMissing) {
      return {
        ok: false,
        errors: [{
          line: null,
          column: null,
          message: 'Arduino CLI is not installed on the server. Run: brew install arduino-cli && arduino-cli core install arduino:avr'
        }]
      };
    }
    if (result.ok) return { ok: true, errors: [] };
    const errors = extractErrors(result.compilerErr);
    return {
      ok: false,
      errors: errors.length ? errors : [{ line: null, column: null, message: result.compilerErr.slice(0, 500) || 'Compilation failed.' }]
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

module.exports = { compileSketch, extractErrors };
