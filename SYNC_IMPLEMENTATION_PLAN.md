# Implementation Plan: Real-Time 2D ⇄ VR Sync

**Stack assumption (per your setup):** 2D editor = web app (React). VR = Unity project running on Quest 3, native APK, not WebXR. This means **no shared runtime code** between the two clients — the sync layer has to be a network contract, not a shared library. That constraint drives most of the decisions below.

---

## 0. What "real-time sync" actually means here

Two different things get called "sync" and they need different mechanisms — don't build one system for both:

| | **Live sync** | **Version control sync** |
|---|---|---|
| What | Every keystroke/placement while editing | Commits, branches, merges |
| Latency target | < 500ms | N/A (deliberate action) |
| Conflict handling | Last-write-wins on a field, or "someone else is editing this" lock | Full 3-way merge (already designed) |
| This plan covers | ✅ this | Already specified in `BUILD_PROMPT.md` §6 |

This plan is scoped to **live sync only**: add a wire in the web app, see it appear in the headset in under a second, and vice versa. It plugs into the existing "working copy" concept from the version-control design — live sync edits the working copy; committing is still a separate, deliberate action.

---

## 1. Shared contract (build this first, before any networking code)

Since Unity (C#) and the web app (TypeScript) can't share code, they must share a **schema**, kept in one place and mirrored, with a test that catches drift.

**1.1 Define once, generate/mirror twice**
- Author the circuit schema and the sync-message schema as **JSON Schema** (or a small custom DSL) in `packages/schema`.
- Generate TypeScript types from it (already planned via Zod).
- For C#: either (a) hand-write matching C# DTOs + a golden-file test that round-trips real JSON fixtures through both the TS and C# (de)serializers and diffs the result, or (b) generate C# classes from the JSON Schema with a tool (e.g. `QuickType`) to avoid hand-drift. **Pick (b) if the schema will change often during the hackathon** — hand-mirroring breaks silently.
- CI step: every sample circuit in `library/circuits` must parse identically in both languages.

**1.2 Sync message contract**
Define a small, fixed set of message types — this is the entire vocabulary both clients speak:

```
JOIN_SESSION   { projectId, branch, clientId, clientKind: "web"|"quest" }
PRESENCE       { clientId, clientKind, connectedAt }        // who else is here
OP             { opId, clientId, seq, op }                   // one edit
SNAPSHOT_SYNC  { seq, snapshot }                              // full state (on join / recovery)
ACK            { opId }
ERROR          { opId?, code, message }
```

**1.3 Op vocabulary** (the actual edits — keep this list small and generic, not part-specific)

```
add_component    { id, part, params, layout2d?, layoutAr? }
remove_component { id }
update_params    { id, params: {...partial} }
add_wire         { id, from: "compId.pinId", to: "compId.pinId" }
remove_wire      { id }
move_2d          { id, x, y, rot? }
move_ar          { id, x, y, z, qx, qy, qz, qw }   // quaternion, not euler — avoids gimbal ambiguity
```

Each op carries only what changed. Never send a full snapshot for a single edit — full snapshots are only for initial join or recovery after a dropped connection.

**Acceptance criteria for this phase:** a fixture circuit JSON parses to equal in-memory structures in both a TS test and a C# test; the op schema has a written spec doc both teams (or your future self) can implement against without guessing.

---

## 2. Transport

**2.1 Pick one real-time channel.** Supabase Realtime (Postgres logical replication + WebSocket) is already in the stack for the web app and version-control backend, so reuse it rather than standing up a second system:

- Web client: `@supabase/supabase-js` Realtime channel, already idiomatic.
- Unity client: Supabase doesn't have an official Unity/C# SDK with full Realtime support as of early 2026 — **verify current status before committing**. If it's unavailable or unstable, fall back to a **plain WebSocket** talking to a small relay you control (a Hono/Node endpoint that both re-broadcasts ops to a Postgres-backed Realtime channel *and* accepts raw WebSocket connections from Unity). This keeps one source of truth (Postgres) with two transport front doors.
- Unity WebSocket client: `System.Net.WebSockets.ClientWebSocket` (built into .NET, no extra package) or `NativeWebSocket` (a well-maintained Unity package) if you need it to work reliably with Quest's IL2CPP build.

**2.2 Session/room model**
- A "room" = `(projectId, branchName)`. Joining a room means: authenticate, send `JOIN_SESSION`, receive a `SNAPSHOT_SYNC` with the current working-copy state and the current op sequence number, then start receiving/sending `OP` messages from that sequence forward.
- `PRESENCE` messages let each client show "2 people editing" and, later, avatar cursors — nice for the demo, not required for correctness.

**Acceptance criteria:** a web client and a mock Unity client (a small console test harness, not the real headset yet) can both join the same room and see each other's `PRESENCE`.

---

## 3. Applying ops: local-first with reconciliation

**3.1 Optimistic local apply.** When a user does something (draws a wire, moves a part), the client:
1. Applies the change to its own local state immediately (no waiting for the network — critical in VR, where any input lag breaks presence/immersion).
2. Sends the `OP` to the server.
3. Server assigns it the next `seq` number, persists it to the working copy, and rebroadcasts it to all clients in the room (including the sender, which uses it just to confirm `seq`).
4. Other clients apply it to their local state on receipt.

**3.2 Ordering.** Server-assigned `seq` is the single source of truth for op order. Each client keeps a local `lastAppliedSeq`; if a `seq` arrives out of order (gap), the client requests a `SNAPSHOT_SYNC` rather than trying to reorder — simplicity over cleverness here, since circuit edits are infrequent enough (not per-frame) that this won't be a bottleneck.

**3.3 Field-level conflict resolution for live editing** (distinct from the full merge algorithm, which is for commits):
- Two ops touching **different fields of different entities** → both apply, no conflict.
- Two ops touching **the same field of the same entity** within a short window → **last-write-wins by server-assigned seq**. Simple, predictable, good enough for live co-editing; anything more sophisticated (operational transforms, CRDTs) is overkill for this data size and editing cadence.
- `move_2d` and `move_ar` are **per-surface** — moving a part in AR never overwrites its 2D position and vice versa (this was the layout-separation decision from the circuit schema). Only `move_2d` conflicts with `move_2d`, never with `move_ar`.

**Acceptance criteria:** with two clients connected, editing different components never drops an edit; editing the same component's same field converges to the same final state on both clients within one round trip.

---

## 4. The 2D → 3D projection layer (Unity-side)

This is where last session's projection math actually gets implemented, as the handler for `add_component` / `move_2d` arriving from the web client.

**4.1 `CircuitSyncManager` (Unity, singleton per room)**
- Maintains a `Dictionary<string, GameObject>` from component ID → instantiated prefab.
- On `add_component` with only `layout2d` set (came from the web app, has no AR position yet):
  - Compute `worldPosition` via the table-projection formula (§ from prior answer): `tableOrigin + tableRight*(x*scale) + tableForward*(y*scale) + tableUp*heightOffset`.
  - Instantiate the prefab there, default rotation from `layout2d.rot` mapped to yaw around `tableUp`.
  - **Do not** immediately send a `move_ar` back — that would fight the user if they're about to grab and reposition it. Only send `move_ar` once the user actually moves it in VR.
- On `add_wire`: look up both endpoint prefabs' **pin anchor child transforms** (not the projected 2D point) and instantiate a wire prefab/LineRenderer between them.
- On `move_ar` from another client (someone repositioned this part in VR from a different headset, or a merge restored an old AR layout): smoothly interpolate the GameObject to the new transform over ~150ms rather than snapping, so it doesn't feel jarring mid-session.

**4.2 The 3D → 2D direction is simpler.** The web app never needs to project AR coordinates back into 2D — it just ignores `layoutAr` entirely and renders from `layout2d`. If a component was created *in* AR and has no 2D position yet, the web app needs a fallback layout: run the same auto-layout (elkjs) already planned for imports, treating "no 2D position yet" the same as "just imported."

**Acceptance criteria:** adding a resistor in the web app makes it appear on the virtual table in the headset within ~1 second, right-side up, at a sensible position; wiring two parts together in the web app draws a correctly-anchored wire in VR, not a floating line.

---

## 5. Presence, awareness, and demo polish

- Show a small floating label or avatar in VR for "someone is editing on web" and a live cursor/highlight in the web app for "being edited in VR" — cheap to build (just presence + which entity a client last touched) and it's the thing that makes the demo read as "real-time" rather than just "eventually consistent."
- Debounce `move_2d`/`move_ar` broadcasts while dragging (send at most ~10/sec, not on every frame) to avoid flooding the channel — send a final authoritative op on drag-release.

---

## 6. Reliability

- **Reconnect logic (both clients):** on disconnect, retry with backoff; on reconnect, request `SNAPSHOT_SYNC` rather than trying to replay a potentially-huge op backlog.
- **Quest-specific:** Wi-Fi drops are common when a user walks around; the local-first apply (§3.1) means the user's own edits never block on the network, so a brief disconnect is invisible to them — only *other* clients' updates pause until reconnect.
- **Working-copy persistence:** the server should persist every op immediately (not batch), so a browser refresh or headset app restart mid-session loses nothing — this is just "autosave," already in the version-control design.

---

## 7. Testing strategy (no headset required for most of it)

1. **Unit:** op application is pure and deterministic — given a snapshot + an op, the result is exactly reproducible. Test this in both TS and C# against the same fixtures.
2. **Two-browser-tabs test:** before touching Unity at all, get live sync fully working between two web app instances (2D↔2D). This validates the transport, ops, and conflict resolution with zero Unity risk.
3. **Console harness for Unity's networking:** a small C# console app (not the full Quest build) that joins a room and logs incoming ops — validates the C# transport/schema without needing the Editor or a headset build cycle.
4. **Unity Editor, no headset:** run the Unity project in the Editor (mouse-look instead of headset tracking) connected to the same room as a web tab — validates the projection/instantiation logic fast, without APK build times.
5. **Real Quest 3, last:** only once 1–4 pass, deploy to the headset and test the actual demo loop with real hand tracking.

---

## 8. Phased build order

| Phase | Deliverable | Depends on |
|---|---|---|
| **S1** | Schema + op contract written and validated in both TS and C# against shared fixtures | Circuit schema from `BUILD_PROMPT.md` §5 |
| **S2** | Transport working web↔web (two browser tabs), ops applied optimistically, last-write-wins conflict resolution, reconnect/snapshot-resync | S1 |
| **S3** | C# console harness joins the same room as a web tab and correctly applies ops to an in-memory state | S1, S2 |
| **S4** | Unity Editor scene: `CircuitSyncManager`, prefab instantiation, 2D→3D projection, pin-anchor wire drawing — tested in Editor against a live web tab | S3 |
| **S5** | `move_ar` sent from Unity back to the room, web app ignores it gracefully (or shows a "positioned in AR" badge) | S4 |
| **S6** | Presence indicators, drag debouncing, smoothing on remote moves | S4 |
| **S7** | Deploy to Quest 3, real end-to-end test: add a part on laptop → appears on headset; wire two parts on headset → appears on laptop diagram | S4–S6 |

Each phase should be independently demoable — S2 alone is already an impressive "look, two browsers stay in sync live" moment if you need a fallback demo before Unity integration is finished.

---

## 9. Key risks to de-risk early, in order

1. **Supabase Realtime from Unity/IL2CPP** — confirm this works on an actual Quest 3 build (not just the Editor) in the first day, since IL2CPP + WebSocket libraries occasionally have platform-specific gotchas. If it's shaky, fall back to the plain WebSocket relay in §2.1 immediately rather than losing days debugging it.
2. **Schema drift between TS and C#** — set up the golden-fixture round-trip test in S1 before writing any feature code; this is the failure mode that silently corrupts circuits later.
3. **Table anchor drift** — if the user's Quest re-detects the room plane differently between sessions, the projection origin (`tableOrigin/Right/Forward`) shifts and previously-placed parts look wrong on reload. Persist the anchor (Quest's spatial anchors API) per project, not per session.
