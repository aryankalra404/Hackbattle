# CircuitDoctor Socket.IO bridge

Minimal in-memory bridge for the Quest/Unity `QuestCircuitBridge.cs` event interface.

## Run

Requires Node.js 18+.

```bash
cd socket-server
npm install
cp .env.example .env
npm start
```

Set `OPENAI_API_KEY` in `socket-server/.env` before starting. The server uses
`gpt-4o-mini` by default: it is a fast, lower-cost choice for small structured
circuit payloads in a live demo. Set `OPENAI_MODEL` or `OPENAI_TIMEOUT_MS` in
`.env` to override the model or the default 8-second timeout. Never commit
your `.env` file.

The server listens on `http://0.0.0.0:3001`. Override this with `PORT=3002 npm start`.
For a Quest on the same Wi-Fi, set its configurable URL to your laptop's LAN address, such as `http://192.168.1.5:3001` (not `localhost`). Allow incoming connections through the laptop firewall if prompted.

## Standalone test

With the server running in one terminal:

```bash
npm run test:client
```

For the GND-path regression test (using the same `PinPoint.pinId` shape sent
by `QuestCircuitBridge.cs`), run `npm run test:rules`.

To send three representative payloads directly through the LLM reasoning step
(correct LED circuit, reversed LED, and swapped PIR roles), run:

```bash
npm run test:reasoning
```

## Datasheet RAG store

The standalone RAG store grounds a later diagnosis/verification step with the
local reference facts in `datasheets/`. It uses the same `OPENAI_API_KEY` as
the reasoning service and the `text-embedding-3-small` embeddings model; no
additional key or database is needed. It is intentionally not connected to
`server.js` yet.

Build the local JSON vector index after changing a datasheet:

```bash
npm run rag:index
```

This writes `rag/vectorStore.json` locally (it is ignored by Git because it is
generated from the source datasheets). Then inspect retrieval results for the
sample LED, PIR, and resistor queries:

```bash
npm run test:rag
```

For later pipeline code, import `retrieve` from `rag/retrieve.js` and call it
with a diagnosis query such as `"LED reversed polarity"`. It returns the top
one or two chunks, with their source filename, section heading, text, and
cosine-similarity score.

## Grounded diagnosis pipeline

After the per-session debounce, `server.js` now runs the following sequence:
reasoning → RAG retrieval (faults only) → datasheet verification. A verified
fault emits this backwards-compatible extended payload:

```json
{
  "ok": false,
  "message": "The LED polarity is reversed; the anode must be on the positive side.",
  "confidence": "confirmed",
  "groundedOn": "led.md — Pin identification and polarity:",
  "suspectedComponent": "led-1",
  "suspectedComponents": ["led-1", "pir-1"],
  "faults": [
    {
      "componentId": "led-1",
      "issue": "LED anode is connected to GND.",
      "verdict": "confirmed",
      "finalMessage": "The LED anode must be on the positive side.",
      "groundedOn": "led.md — Pin identification and polarity:"
    }
  ]
}
```

`confidence`, `groundedOn`, and `suspectedComponent` are `null` when no fault
is found or the rules fallback is used. `suspectedComponents` and `faults` are
empty arrays in that case. The legacy `suspectedComponent` remains the first
fault for older clients; new clients should use `suspectedComponents` and
`faults`. `uncertain` also maps to `ok: false`, because it warrants
student attention, but its message explicitly states that the spec could not
confirm it. If reasoning, retrieval, or verification fails, the existing rules
fallback is used.

With `rag/vectorStore.json` built, run the standalone full pipeline test:

```bash
npm run test:pipeline
```

It prints every stage and tests a valid LED path, reversed LED, and PIR VCC on
3.3V. This is a standalone Node test; it does not need the headset or server.

Expected output includes:

```text
circuit:result { ok: true, message: 'Circuit looks good: LED path is complete and polarity is correct.' }
simulation:led { componentId: 'led-1', on: true }
```

To point the test at another machine: `SOCKET_URL=http://192.168.1.5:3001 npm run test:client`.

## Events

Client → server:

- `session:join` — `{ sessionId }`
- `circuit:update` — `{ sessionId, circuit: { components, wires } }`
- `circuit:intent` — `{ sessionId, intent }`
- `chat:message` — `{ sessionId, message }`

Server → all clients in that session:

- `circuit:result` — `{ ok, message, confidence, groundedOn, suspectedComponent, suspectedComponents, faults }`
- `simulation:led` — `{ componentId, on }`
- `chat:response` — `{ ok, message }` (returned only to the requesting dashboard socket)

## CircuitDoctor chat

The dashboard's **Ask CircuitDoctor** panel is grounded in the live session on
every message. The server supplies the current component/wire graph, the most
recent completed diagnosis (including affected component IDs and confidence),
and the two most relevant local datasheet snippets retrieved for the question
plus component names. It keeps only the last 10 user/assistant turns per
in-memory session; nothing is persisted to disk. If retrieval has no evidence
and there is no active fault, it responds conservatively rather than inventing
electrical facts. Run `npm run test:chat` to verify that a chat response for an
active fault is grounded on and references the affected component ID.

## LLM reasoning and fallback

Every `circuit:update` is analyzed by `reasoning/openaiCircuitReasoner.js`.
It requests strict JSON from OpenAI with this shape:

```json
{
  "hasFault": true,
  "suspectedComponent": "led-1",
  "suspectedIssue": "LED polarity is reversed.",
  "reasoning": "The anode is connected toward GND while the cathode is on the source side."
}
```

That output is mapped back to the extended backward-compatible `circuit:result`
contract. If the API key is missing, OpenAI errors, or
the request exceeds the timeout, the server logs `[llm] failed ... using rule
fallback` and runs the old deterministic logic instead.

## Rules (fallback)

Rules are one file each in `rules/` and return a fault message or `null`.
`rules/index.js` is no longer the primary diagnosis path; it is deliberately
kept intact as the offline fallback.

### Unity pin-ID note

The included Unity scripts serialize the `PinPoint.pinId` strings set in the
Inspector; they do not define a fixed catalog of IDs. The supplied reasoning
test uses the intended demo labels (`L1`/`L2`, `R1`/`R2`, `PIR_VCC`,
`PIR_GND`, `PIR_SIGNAL`, `D1`, `GND`, and `5V`). If multiple physical LEDs or
resistors are added, their Inspector `pinId` values must be globally unique
(for example `LED1_L1`, `LED2_L1`, `RES1_R1`) because the current Unity bridge
serializes only raw pin-ID strings.

Current checks cover reversed LED polarity, a missing LED-to-GND path, a missing power path, an LED power path that bypasses its series current-limiting resistor, and basic resistor values when a `value` field is supplied. Session state stays in memory and is intentionally reset whenever the server restarts.
