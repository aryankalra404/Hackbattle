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

## Part library v2 — pin functions, breadboard, Arduino (§5.1–5.1.3)

### D30 · Pin `functions` replace the old `role` field

`role` was read by nothing, so it is gone rather than kept alongside. Every pin
now lists what it electrically is (`power`, `ground`, `analog_io`, `digital_io`,
`pwm`, `analog_in`, the serial roles). A `power` pin with a `voltage` supplies
it; one without (a 555's VCC, an Arduino's VIN) is a power input. The DC
supply's `+` takes its voltage from its own param (`{ paramRef: voltage }`).

Part versions were **not** bumped: no pin id changed, so no snapshot or
`pinMigrations` entry is affected.

### D31 · Pin ids stay lowercase snake_case

The build prompt writes Arduino pins as `D0`, `5V`, `3V3`, `GND1` and breadboard
holes as `row-12-a`. Pin refs (`<uuid>.<pin>`) are validated as
`[a-z][a-z0-9_]*` everywhere, so the ids are `d0`, `v5`, `v3v3`, `gnd1` and
`row12_a`, `power_pos_top_7`. The display names still read `5V`, `D3 ~`, `Row 12 A`.

### D32 · Part files are compact; the schema expands them

`partDefinitionSchema` now transforms, then validates the result, so references
to generated pins are checked like any other:

- `internalGroups` templates (`row`, `rail`, and a `pins` type for declared pins
  that are one conductor, e.g. the Arduino's three GNDs) become concrete pins,
  a grid position per pin (`pinLayout`), and `pinGroups`.
- A `pinMap` param becomes one scalar param per pin and field, keyed
  `<map>/<pin>/<field>`. `/` keeps it a single segment in dotted diff paths, and
  keeps component params flat so hashing, diff and merge work per setting.
- A rating with `eachPin` becomes one `pin` rating per selected pin.

Row ranges are written `rows: { from: 1, to: 63 }` rather than the prompt's
`[1, '...', 30]`, which is not a validatable shape.

### D33 · The breadboard is a real 830-point board, and a pure interconnect

63 rows (a–e / f–j) and four continuous 50-hole rails, matching the common
full-size format (BusBoard BB830). The prompt's sketch showed 30 rows, which is
a half-size board; "full-size" won. Split-rail boards are a data change (two
groups per rail), not code.

It has no `spice` block: a part with no electrical element of its own is an
**interconnect**, and the schema requires every one of its pins to be in a group.
It therefore has no ratings, and the library test now requires ratings only of
parts with an electrical model. Each hole takes one lead (`maxConnections: 1`).

### D34 · Plugging a lead in is a wire to that hole

No new placement mechanism: pushing a resistor leg into row 12 is a wire from
`R1.a` to `BB1.row12_a`, so it syncs, diffs, merges and undoes like any wire.
`hole_occupancy` now also flags any pin with more wires than its
`maxConnections`, which is how two leads in one hole is caught.

### D35 · "Connected" means sharing a net with another real pin

A lead alone in an empty breadboard row is wired but connected to nothing. The
required-pin and floating-pin checks now use `connectedPins()` — the pin's net
must contain a pin of another non-interconnect component (or the same one), and
breadboard holes do not count. Interconnects never bridge the ground walk (a
board carries current along a row, not across rows) and are never reported as
ungrounded. Optional pins (empty holes, unused header pins) are exempt from
`floating_pin` — unless a pin mode gives the pin a job, which it cannot do unwired.

### D36 · `pin_function_mismatch` is one kind with four generic checks

1. A pin mode whose `requires` is not in the pin's `functions` (PWM on D2).
2. A driving mode (`drives: true`) on a net with a power-/ground-only pin.
3. Two driving pins on one net.
4. Convention: an interconnect strip marked `power` or `ground` holding the
   opposite return path or an output. The circuit works, so it uses
   `rules.conventionSeverity` (default `warning`) instead of the kind's severity,
   and is skipped for an output already reported by check 2.

A mode the pin cannot do stays **selectable** in the inspector, labelled "not on
this pin": hiding it would hide the rule the P2 acceptance test exercises.

### D37 · The Arduino is a configurable source/sink; its netlist waits for P2

No sketch runs (the prompt's scope note). `spice.generatedFrom: pinModes` is
where the P2 netlist generator will build the subcircuit from the pin modes;
until that generator exists, nothing renders it, and simulation-backed checks
stay `pending` exactly as for every other part.

The pin list is the full Uno R3 header set — D0–D13, A0–A5, 5V, 3.3V, VIN and
three GND — not the partial list in the prompt, and A0–A5 also list
`digital_io` because the board supports that. The per-I/O-pin rating is the
Arduino-published 20 mA, not the ATmega328P's 40 mA absolute maximum.

**Open risk, as D21:** these figures were written from the published specs
from memory, not re-read from the PDFs. Verify before P2 enforces them.

### D38 · Asset provenance is recorded; no third-party assets were fetched

Every existing symbol is `source: drawn in-repo, license: internal`, and every
3D model is a labelled placeholder box — what the AR view already draws. The
prompt's Fritzing SVGs and Sketchfab/Poly Pizza models were not downloaded:
that needs your go-ahead and a licence check per model. The licence field is an
enum, the schema refuses a CC-BY/CC-BY-SA/MIT asset without an attribution line,
and `ASSETS.md` is generated from the part files (`pnpm assets:report`). A test
regenerates it and fails if the committed copy is stale; CI prints it.

### D39 · The 2D canvas connects any pin to any pin

**Pre-existing bug found while testing this in the browser:** every pin is a
React Flow `source` handle, and React Flow's default strict mode only accepts
source → target, so dragging from one pin to another never made a wire. Verified
by switching the mode back and forth with the same drag. The canvas now uses
`ConnectionMode.Loose`; a wire has no direction anyway.

Boards render beneath the parts plugged into them (node `zIndex` 0 vs 1, and
`elevateNodesOnSelect` off so selecting a board does not cover its parts). A
negative z-index was tried first and put the board behind React Flow's pane,
where it could not be clicked.

### D40 · Two layout tunables

`ui.boardPitchPx` (one hole pitch on screen) and `ui.pinRowPx` (vertical room
per pin on edge-pinned nodes, so the 26-pin Arduino grows instead of overlapping).

### D41 · The Arduino is a board, not a card — by data, not by code

The Uno rendered as a card with 26 pins down its edges and a small schematic
glyph in the middle, which is what "there are no graphics for the Arduino" meant
in practice. Nothing in the canvas needed changing: `PartNode` already picks the
hole-grid layout for any part that declares `footprint.gridSize` and gives every
pin a `pinLayout` position, which until now only the breadboard did. The Uno now
declares both, so it draws at true scale (27 x 21 hole pitches, the real
2.7 x 2.1 in board) with a wirable hole at each header pin.

Positions follow the Uno R3 header arrangement, including the 0.05 in offset
between D7 and D8. **Header positions the part does not model electrically —
IOREF, RESET, AREF, SDA and SCL — are left out of both the layout and the
artwork.** Drawing them would put holes on screen that nothing can connect to;
the rule is that every hole drawn is a hole that can be wired. Adding them later
is a pin entry plus a `pinLayout` entry, no code.

The board artwork is drawn in-repo, in the same units as the grid, so the two
cannot drift: the SVG viewBox is `0 0 27 21` and one user unit is one hole pitch,
exactly as the breadboard's is. No Arduino logo is reproduced — the silkscreen is
text only.

### D42 · Breadboard view for every part, not schematic glyphs

The twelve discrete parts were thin single-colour schematic symbols squashed into
a fixed 56 x 30 px box, next to a full-colour breadboard. They are now drawn as
the physical component (colour bands, polarity stripes, TO-92 and DIP bodies,
silver leads), per the prompt's Tinkercad-style breadboard-view aesthetic, each
in its own viewBox at its real proportions. The CSS sizes artwork by height with
a width clamp instead of forcing one box, so nothing is stretched.

All fourteen symbols stay `drawn in-repo / internal`: no Fritzing or Sketchfab
asset was fetched, so D38 still stands and `ASSETS.md` is unchanged.

**Known gap:** artwork is static. A part's parameters do not reach its symbol, so
a blue LED still draws red and a 10 kΩ resistor carries the same colour bands as
a 330 Ω one. Making artwork parameter-aware needs code that passes component
params into the symbol — a real feature, not a drawing fix, and not attempted
here.

**Still open:** 3D. Every part's `visual.model3d` is still `placeholder: box`, so
AR continues to draw labelled boxes. This change was 2D only.
