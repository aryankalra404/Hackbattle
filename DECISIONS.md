# Decisions

Choices the build prompt did not specify. Each entry says what was decided, why,
and what would make us revisit it.

Format: `D<n>` · phase · decision · rationale.

## P0 — Foundation

### D1 · Existing CircuitDoctor code archived under `legacy/`

The repo already contained _CircuitDoctor_: a Next.js dashboard and a Socket.IO
server with a Unity/C# Quest client. Its architecture conflicts with the
CircuitGit non-negotiables at almost every point — plain JS, OpenAI, Unity
instead of WebXR, and part-specific hard-coded rules (`rules/ledReversed.js`,
`rules/pirWiring.js`, a literal `220 ohm` recommendation, `component.type === 'led'`
branching).

Moved to `legacy/circuitdoctor/` rather than deleted, and excluded from the pnpm
workspace, ESLint, TypeScript and Vitest. The old demo still runs from its own
directory, and its `datasheets/` prose is a useful starting point for the
`source:` citations that part definitions require in P1.

**Revisit if:** the Unity client needs to ship alongside the WebXR one.

### D2 · `quiz_cyber/` and `yolo/` left untouched

Neither relates to CircuitGit (a static quiz page and a YOLO image dataset).
They are excluded from the workspace and all tooling but otherwise left where
they are. `yolo/raw/` is gitignored because it is a large binary dataset.

### D3 · pnpm installed via `npm i -g pnpm@9`, not corepack

`corepack enable` fails with `EPERM` on this machine because it writes into
`C:\Program Files\nodejs`. The global npm install puts pnpm 9.15.9 in
`%APPDATA%\npm`, which is on PATH. CI uses `pnpm/action-setup` and is unaffected.

### D4 · Config loader lives in `packages/schema`

The build prompt lists `config/default.yaml` and says schemas live in
`packages/schema`, but does not say which package owns the loader. Putting
`loadConfig()` next to `configSchema` avoids a package that would contain one
function, and means every consumer gets the validated type from one import.

### D5 · Repo root resolved from the module URL, not `process.cwd()`

`repoRoot()` derives the root from `import.meta.url` so the loader behaves
identically whether it is called from a test, an app, a script, or the API
service started from another directory.

### D6 · Config validation is strict and exhaustive

Every config object uses Zod `.strict()`, and `superRefine` asserts that each
LLM job, rule kind, analysis kind and conflict ID (`C1`–`C37`) has an entry. A
mistyped key fails startup rather than silently falling back to a default,
because a wrong tolerance or model ID would quietly corrupt every downstream
check. `ConfigValidationError` reports _all_ issues, not just the first.

### D7 · Initial tolerance and threshold values

Placeholders chosen to be permissive enough not to block P1–P3 development, to
be tuned against the real P4 eval report as the build prompt instructs:

| Setting                               | Value    | Reasoning                                                                                                                                    |
| ------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `comparator.relativeTolerance`        | `0.25`   | An LLM predicting from part values alone should land within ~25% of the simulator; tighter would flag correct reasoning as a mismatch.       |
| `comparator.absoluteFloor.current`    | `0.5 mA` | Below this a relative band is meaningless — near-zero currents differ by large percentages while agreeing physically.                        |
| `comparator.majorityThreshold`        | `0.5`    | Simple majority of 3 samples.                                                                                                                |
| `rules.thresholds.componentOnCurrent` | `1 mA`   | Generic "is this part conducting" threshold that part `states` rules reference by config ref, so the number is not baked into any part file. |
| `rules.ratingHeadroom`                | `1.0`    | Flag at the datasheet maximum, no safety margin, so a finding always maps to a real published limit.                                         |
| `eval.thresholds.explainerPrecision`  | `0.7`    | Starting bar; the P4 report sets the real one.                                                                                               |

**Revisit at:** P4, using the first eval report.

### D8 · Conflict-policy escalation is data, not code

`versionControl.merge.escalateOnProtected` lists the conflict IDs whose policy
becomes `block` on a protected branch (`C29`, `C31` per the build prompt),
instead of the merge engine special-casing those IDs.

### D9 · The part-ID guard scans string literals only, with a reserved word list

`scripts/noHardcodedParts.test.ts` extracts string and template literals from
`packages/{core,rules,sim,llm}` and matches them, on word boundaries, against the
union of a reserved part-word list and every `id:` declared in the part library.

Literals only, because matching raw source would flag ordinary code such as
`switch (kind)`. Word boundaries, so `"Enabled"` does not match `led`. The
reserved list is seeded rather than derived purely from the library so the guard
is not vacuous before `packages/parts` exists; it lives in a test file, where
naming parts is explicitly allowed.

Verified by probe: a file containing `"led-5mm"` in `packages/core/src` fails the
test with the file, line and offending literal.

### D10 · `format:check` runs in CI as a separate step

Prettier is configured with `eslint-config-prettier` so formatting never
double-reports as a lint error, and is enforced as its own CI step instead.

### D11 · Product name is config, not code

`product.name` in `config/default.yaml`. The build prompt states CircuitGit is a
working name set in config; nothing in `packages/` reads a hard-coded product
name.

## P1 / P5 — Data layer and the 2D editor

Built out of order, at your request, to get a usable UI on screen. The editor
runs on real schemas, a real part library and the real commit graph rather than
on mock data, so none of it is throwaway.

### D12 · `category` and `description` added to the part definition schema

The build prompt's part schema has no field for palette grouping or a
human-readable blurb, but a palette needs both and the alternative is a hard-coded
category map in the UI — exactly what rule 1 forbids. Both are data, so a new
category appears in the palette the moment a part file declares it.

### D13 · `visual.accent` and `visual.size` added

Same reasoning. The canvas needs a colour and a footprint for every node; taking
them from the definition keeps `PartNode.tsx` generic. No component in the app
branches on a part id.

### D14 · `paramRef` alongside `configRef` in ratings

A supply's current limit is a property of the instance, not of a datasheet. Rather
than special-casing supplies in the `power_budget` check, a rating's `max` may now
point at one of the part's own params. Resolved generically by `resolveNumber()`.

### D15 · Dimensionless params allowed (`unit: ''`)

A potentiometer's wiper position has no unit. Inventing one ("ratio") would have
been worse than allowing the empty string.

### D16 · Node-only entry points are separate subpath exports

`@circuitgit/schema/node` and `@circuitgit/parts/node` hold everything that
touches `node:fs`. The package barrels stay browser-safe, so Vite bundles the
schemas and the library loader without pulling the filesystem in. The browser
loads the same YAML through `import.meta.glob` and validates it with the same
Zod schemas the server uses — one definition of valid, two transports.

### D17 · Pin layout is derived from pin count, not from a per-part table

Two-pin parts get one pin per side; parts with more split evenly down the two
edges in declaration order. Generic, and good enough for every part in the
library. A part that needs a specific arrangement can grow a `visual` field for
it later.

### D18 · Topology checks implemented now; simulation-backed checks deferred honestly

`unconnected_required_pin`, `floating_pin`, `no_ground_path` and `hole_occupancy`
need only the graph, so they run on every edit and give the editor real findings
today. `rating_exceeded`, `polarity_reversed`, `short_circuit`, `power_budget` and
`user_test_failed` need measured values; they are reported as **pending** in the
UI with the reason, never as passing. Commit badges follow the same rule: `sim`
is `pending` and `llm` is `unavailable` until those layers exist.

### D19 · State lives in Zustand

The editor needs one store shared by the canvas, palette, inspector, findings
panel and history. Context plus `useReducer` would have re-rendered the canvas on
every keystroke in the inspector. Zustand's selector subscriptions keep that
local, and the store stays plain TypeScript that the API layer can reuse.

**Bug this surfaced:** a selector that builds a fresh array returns a new
reference every render, which the store reads as a change — `useInspectedDiff`
looped until React bailed out with "Maximum update depth exceeded". The diff is
now computed in a `useMemo` outside the selector. Caught by the render tests.

### D20 · The UI design blends a workbench and a version-control client

Light theme only, as asked. Roomy rounded surfaces, coloured part chips and a
dotted canvas on the build side; dense neutral rows, monospaced short hashes,
branch pills, check badges and green/red/amber diffs on the history side. Tokens
are in `apps/web/src/styles/theme.css` — a dark theme would be a second token
block, no component changes.

### D21 · Part values come from standard datasheets, and need verifying

**Open risk.** Every part file cites its source, and the numbers are the standard
published figures for those parts (Kingbright WP7113, Vishay 1N4148, onsemi
2N3904, TI NE555, and so on). They were written from knowledge rather than
fetched from the PDFs, so they should be checked against the real datasheets
before P2 lets the rating check enforce them.

Two files say in their own `source` field that the model is a fit rather than a
published one: the LED `.model` cards are junction-diode fits to the datasheet
forward-voltage points, and the NE555 subcircuit is a behavioural model of the
architecture the datasheet describes. The 1N4148 and 2N3904 `.model` cards are
the vendor-published ones.

**Revisit at:** the start of P2, before any rating check is trusted.

## Simulation lock and device sync

### D22 · A session locks the circuit, enforced in three places

Starting a session sets `mode: 'simulate'` and pins the circuit's electrical
hash. While it runs, nothing may change the circuit. This is enforced at three
levels rather than one, because a lock that only disables buttons is not a lock:

1. **UI** — palette chips disabled, canvas not draggable or connectable, delete
   key unbound, inspector inputs disabled.
2. **Store** — every mutating action returns early. Covers keyboard shortcuts,
   drag-and-drop and anything the UI forgot.
3. **Hub** — the server refuses a push that changes the snapshot while the room
   is in a session, whichever device sent it.

Starting is refused if the circuit is empty, has no ground reference, or has a
failing check — there is nothing meaningful to measure in any of those cases.

### D23 · The session pins an electrical hash

`simulatingHash` is the `electricalHash` at the moment the session started. A
mirroring device can compare it against what it is displaying and know whether
it is showing the same circuit the measurements came from. It also makes the
lock auditable rather than a matter of trust.

### D24 · Sync is whole-snapshot, versioned, last-writer-wins with a CAS

Snapshots are small, so the room ships the entire state on every change. That
makes divergence impossible to accumulate: a client is on the room's version or
it is not.

Each accepted push increments a room version, and a push carries the version it
was based on. A push from a stale base is refused and the current state is
returned to rebase on. This is conflict **C32** at the wire level, with the same
compare-and-swap semantics `Repository.commit` already uses for branch heads.

**Not chosen:** operational transform or CRDTs. Both solve concurrent editing of
the same field, which is not the problem here — one editor and one mirror, and a
lock that stops changes entirely during the part that matters.

### D25 · The headset view is a read-only mirror for now

`/xr` shows the circuit and the session state but does not edit. The laptop is
the authority. Building in AR is P6 proper; mirroring is what makes the lock
meaningful across devices, and it is what the demo needs first.

### D26 · WSS is proxied through the Vite dev server

The Quest requires HTTPS for WebXR. An HTTPS page cannot open a plain `ws://`
socket — mixed content — and a separate TLS certificate on the hub would mean a
second trust prompt on the headset.

So the dev server runs with `@vitejs/plugin-basic-ssl` on `0.0.0.0` and proxies
`/sync` (and `/health`) to the hub on port 8787. The headset opens one origin,
accepts one certificate, and gets both page and socket.

### D27 · The hub is plain `ws` on Node, not Supabase

Chosen over Supabase Realtime for this stage: it needs no project, no keys and
no internet, which matters for a live demo on venue WiFi. It is transport for a
room, and the room logic is transport-free and unit tested, so moving to
Supabase later replaces the socket layer and nothing else.

**Not yet:** persistence. A room lives in memory and is dropped when the last
device leaves. Commits are still local to each browser — cross-device commit
history is P3.

### D28 · The API runs under `tsx`, not Node's type stripping

`node --experimental-strip-types` cannot resolve the `.js`-suffixed imports that
workspace TypeScript packages use, so it fails on `@circuitgit/schema`. `tsx`
handles that resolution. A build step would too, and is what production will use.

### D29 · The sidebar toggle is a per-viewer preference in `localStorage`

Panel layout is not part of the circuit, so it never touches the snapshot and
never syncs. Reads and writes are wrapped in try/catch and default to expanded,
because storage can be unavailable in a private window.
