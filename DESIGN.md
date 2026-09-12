# CircuitGit AR — Design

Architecture, data model, conflict catalogue and LLM pipeline.

> Sections marked **(P<n>)** describe work scheduled for that phase. Everything
> unmarked is implemented. Currently implemented: P0.

## 1. Shape of the system

```
        Quest (WebXR)            Browser (2D editor)
              │                          │
              └────────── apps/web ──────┘
                             │
                        apps/api (Hono)
                   ┌─────────┼─────────────┐
              packages/llm  packages/sim  packages/rules
                   └─────────┼─────────────┘
                        packages/core   ← hashing, diff, commit graph, merge
                        packages/parts  ← part definitions (data)
                             │
                         Supabase (Postgres + Realtime + RLS)
```

Three ideas carry the design:

1. **Parts are data.** Every engine is generic; a part definition file supplies
   pins, polarity, ratings, SPICE model, state rules, visuals and footprint.
   Adding a part means adding a file, never editing an engine.
2. **The simulator owns the numbers.** Rules and simulation are deterministic
   code. The LLM explains findings and independently cross-checks the simulator,
   but never produces the authoritative value.
3. **Everything is content-addressed.** Snapshots are stored once per hash;
   check results and LLM calls are cached by `electricalHash`, so moving a part
   in the layout never re-runs the simulator or the model.

## 2. Configuration

`config/default.yaml`, validated by `configSchema` in `packages/schema` at
startup. Strict: unknown keys and missing entries fail immediately rather than
defaulting. Covers LLM models and sampling per job, comparator tolerances,
simulation backends and solver settings, rule severities, merge policies and
branch protection, AR snapping and animation scales, eval thresholds, and which
check stages run on each trigger.

`configVersion` participates in every cache key, so changing a tolerance
invalidates stale results.

## 3. Data model (P1)

### Part definition

One versioned file per part. Every simulation model and rating cites its source;
no invented numbers.

```yaml
id: led-5mm
version: 2
labelPrefix: D
source: '<datasheet or standard-model citation>'
pins: [{ id: anode, name: Anode }, { id: cathode, name: Cathode }]
requiredPins: [anode, cathode]
polarized: { positive: anode, negative: cathode }
params: { color: { type: enum, values: [red, green, blue, yellow], default: red } }
spice: { element: D, template: 'D{label} {pin.anode} {pin.cathode} {model}', models: { ... } }
ratings:
  - { quantity: current, through: [anode, cathode], max: <from datasheet>, unit: A }
  - { quantity: reverse_voltage, across: [cathode, anode], max: <from datasheet>, unit: V }
states:
  - { state: on, when: { quantity: current, through: [anode, cathode], gt: <config ref> } }
  - { state: off, otherwise: true }
visual: { symbol2d: ..., model3d: ..., glowOnState: on }
footprint: { breadboard: { pins: { anode: [0, 0], cathode: [1, 0] } } }
pinMigrations: { '1': { '+': anode, '-': cathode } }
```

`ratings` drives the generic `rating_exceeded` check, `polarized` drives
`polarity_reversed`, `states` turns simulation output into UI state, and
`pinMigrations` resolves conflict `C12` automatically.

### Circuit snapshot

Collections are maps keyed by random UUIDs so diffs resolve per entity; labels
such as `R1` are display-only. Top-level keys: `schemaVersion`, `meta`
(name, description, intent), `settings` (ground, simulation), `components`,
`wires`, `blocks` (nested circuits), `tests`, `annotations`, `layout`
(`2d`, `ar`, `breadboard`).

### Hashing

Canonical JSON — sorted keys, normalised numbers, wire endpoints sorted because
a wire has no direction — then SHA-256.

- `snapshotHash` covers everything.
- `electricalHash` excludes `layout`, wire style, `meta` and `annotations`.

Check results and LLM calls key on `electricalHash`.

### Commits and branches

A commit is `{ id, parents[], snapshotHash, electricalHash, message, author,
source, createdAt, checks }`, where `id` hashes the parents, snapshot hash,
message, author and timestamp. Zero parents = initial, one = normal, two = merge.

Branch head moves are always compare-and-swap: the update succeeds only if the
head is still where the client believed it was. A failed swap is conflict `C32`.

## 4. Version control (P1)

`commit`, `branch` (create/switch/rename/delete), `log`, `diff` (any two
commits, filterable to electrical-only), `merge`, `restore`, `undo`,
`cherry-pick`, `rebase`.

### Three-way merge

1. Find the merge base; several common ancestors are merged recursively into a
   temporary base (`C37`).
2. Apply `pinMigrations` when the two sides use different part-library versions.
3. Compare each collection field by field.
4. Classify every change against the catalogue; auto-resolve what policy allows.
5. Connectivity analysis over base/ours/theirs/merged nets — joined nets, split
   parts, lost ground or power (`C21`–`C23`).
6. Run the full check pipeline on the merged snapshot (`C24`–`C31`).
7. Commit only when no `block` remains and branch protection is satisfied.

**Restore** creates a new commit whose snapshot equals the target's, so it never
conflicts. **Undo** applies the inverse of one commit on top of the current head
through the same merge machinery, so it can. **Cherry-pick** likewise.

### Conflict catalogue

Policies: `auto` (resolved silently, listed in the merge report) · `ask` (user
chooses) · `block` (cannot commit until fixed). Every row is config-overridable
under `versionControl.merge.policies` and needs at least one test.

| ID  | Layer        | Conflict                                                         | Default                                          |
| --- | ------------ | ---------------------------------------------------------------- | ------------------------------------------------ |
| C1  | Structural   | Same property changed differently on both sides                  | ask                                              |
| C2  | Structural   | Different properties of the same part changed                    | auto (keep both)                                 |
| C3  | Structural   | Part type changed on one side, edited on the other               | ask                                              |
| C4  | Structural   | Deleted on one side, edited on the other                         | ask                                              |
| C5  | Structural   | Deleted on one side, wired to on the other                       | block                                            |
| C6  | Structural   | Deleted on one side, moved on the other                          | auto (delete wins)                               |
| C7  | Structural   | Same wire moved to different pins                                | ask                                              |
| C8  | Structural   | Wire deleted on one side, moved on the other                     | ask                                              |
| C9  | Structural   | Same connection added on both sides                              | auto (dedupe)                                    |
| C10 | Structural   | Same label added on both sides                                   | auto (renumber)                                  |
| C11 | Structural   | Same breadboard hole used twice                                  | ask                                              |
| C12 | Structural   | Part-library version mismatch                                    | auto if a pin migration exists, else ask         |
| C13 | Structural   | Imported block edited on both sides                              | merge inside the block; replaced vs edited → ask |
| C14 | Structural   | Circuit-wide settings changed                                    | ask                                              |
| C15 | Structural   | User-defined test edited differently                             | ask                                              |
| C16 | Structural   | Name / description / notes                                       | auto if edits do not overlap, else ask           |
| C17 | Structural   | Comment attached to a deleted part                               | auto (move to circuit level + notice)            |
| C18 | Structural   | Position moved differently (2D / AR)                             | auto:ours                                        |
| C19 | Structural   | Parts overlap after merging                                      | auto (layout nudge)                              |
| C20 | Structural   | Wire colour or route changed                                     | auto:ours                                        |
| C21 | Connectivity | Two nets joined that neither side intended                       | ask                                              |
| C22 | Connectivity | Net split, leaving a part floating                               | ask                                              |
| C23 | Connectivity | Lost ground or power connection                                  | block                                            |
| C24 | Electrical   | A part's rating exceeded                                         | block                                            |
| C25 | Electrical   | Short circuit                                                    | block                                            |
| C26 | Electrical   | Power budget exceeded                                            | block                                            |
| C27 | Electrical   | Reversed polarity                                                | block                                            |
| C28 | Electrical   | Floating input / missing ground                                  | ask                                              |
| C29 | Electrical   | Behaviour regression (tests pass on both parents, fail on merge) | block on protected, else ask                     |
| C30 | Electrical   | Simulation fails to solve the merged circuit                     | ask                                              |
| C31 | Electrical   | LLM and simulator disagree                                       | block on protected, else ask                     |
| C32 | Sync         | Two devices commit to the same branch                            | auto-rebase if disjoint, else merge session      |
| C33 | Sync         | Uncommitted changes when the followed branch moves               | ask                                              |
| C34 | Sync         | Restore vs undo                                                  | UI offers both; undo runs the catalogue          |
| C35 | Sync         | Cherry-pick conflicts                                            | same as merge                                    |
| C36 | Sync         | Branch deleted/renamed while checked out elsewhere               | notify; work kept on a recovery branch           |
| C37 | Sync         | More than one common ancestor                                    | merge ancestors into a temporary base            |

`C29` and `C31` escalate to `block` on protected branches via
`versionControl.merge.escalateOnProtected` — data, not a special case in code.

### Invariants (property-based tests, P1)

- `merge(base, X, X) === X`
- `merge(base, base, X) === X`
- Swapping sides is symmetric apart from `ours`/`theirs` policies
- No committed snapshot references a nonexistent entity
- `diff(restore(c), c)` is empty
- Undoing an undo restores the original
- Hashing is stable under key reordering

## 5. Check pipeline (P2)

### Rule engine

Check kinds are generic code; part definitions decide where they apply:
`rating_exceeded`, `polarity_reversed`, `short_circuit`, `floating_pin`,
`unconnected_required_pin`, `no_ground_path`, `power_budget`, `hole_occupancy`,
`user_test_failed`.

Findings are structured: `{ kind, severity, componentIds, pinIds, measured,
limit, unit }`. Topology-only checks run on every edit; simulation-backed checks
run on Test, Commit and Merge.

The acceptance case for P2 — ancestor 330 Ω on 5 V, one branch drops R1 to 150 Ω,
the other raises the supply to 9 V, and the merge is blocked by `C24` — must be
caught by the generic rating check reading the part's `ratings`, with no
part-specific code anywhere in the path.

### Simulation

`simulate(snapshot, { analysis }) → { netVoltages, branchCurrents,
componentStates, waveforms?, diagnostics }`.

Netlists are generated purely from each part's `spice.template` and `models`.
Component states come from each part's `states` rules. Two backends —
`builtin-dc` (fast, in-browser) and `ngspice` (full/transient) — selected per
analysis type by config.

### LLM layer

The gateway takes model, temperature, timeout, retries and sample count from
config per job, uses the provider's JSON-schema structured output, validates
with Zod regardless, retries once on invalid output, and returns
`{ status: ok | invalid | timeout | error | unavailable, data?, callId }`. Every
call is written to `llm_calls`. Cache key: `(job, electricalHash, promptVersion,
model, configVersion)`.

Prompts are versioned files at `packages/llm/prompts/<job>/v<N>.md`, rendered
from real data: a canonical text netlist, the relevant part-definition fields,
and — only where the job allows — rule findings and simulation results.

| Job                 | Output                                  | Validation                                                                                                                         |
| ------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `fault_explainer`   | faults with explanation and fix         | IDs exist; numbers match the simulator within tolerance; proposed changes must pass the full pipeline on a copy before being shown |
| `blind_verifier`    | predictions                             | comparator                                                                                                                         |
| `mismatch_analyst`  | likely cause + evidence                 | IDs exist; shown as "Needs review", never overrides the simulator                                                                  |
| `intent_checker`    | mismatches vs stated intent             | IDs exist                                                                                                                          |
| `merge_advisor`     | resolution + rationale                  | applied to a copy; shown only if the result passes                                                                                 |
| `change_summarizer` | summary, electrical vs cosmetic changes | IDs exist; pre-fills an editable commit message                                                                                    |

**Keeping the verifier blind** is structural: the prompt builder's signature
accepts only `(snapshot, partDefs)`, and a test renders the prompt and asserts
no simulation value appears in it.

**The comparator is plain code**, not a model. It matches each prediction to a
simulated quantity using config tolerances (relative for numbers, exact for
states), runs N samples and takes the majority: `verified`, `mismatch` (triggers
`mismatch_analyst`), or `unstable` (shown as "Needs review").

### Triggers and badges

| Trigger    | Runs                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------- |
| Every edit | topology rules                                                                                      |
| Test       | simulation + simulation-backed rules + blind verifier + comparator (+ mismatch analyst) + explainer |
| Detect     | the above + intent checker                                                                          |
| Commit     | as Detect; results attached as badges                                                               |
| Merge      | §4 step 6                                                                                           |

Commits carry `rules`, `sim` and `llm` badges: pass / warn / fail / unavailable.
Protected branches accept only commits with no failing badge. An admin can
override `unavailable`, and the override is recorded.

## 6. Storage (P3)

| Table                                   | Holds                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `projects`                              | Projects                                                                                                      |
| `snapshots`                             | Snapshot bodies, once per hash (hash is the primary key)                                                      |
| `commits`, `branches`, `working_copies` | §3                                                                                                            |
| `merge_sessions`                        | base, ours, theirs, conflicts, resolutions, status                                                            |
| `check_results`                         | keyed by electrical hash, check type, config version, prompt version, model                                   |
| `llm_calls`                             | audit log: job, prompt version, model, rendered input, raw output, validation result, latency, tokens, hashes |
| `imports`                               | Import records                                                                                                |

Row-level security on every table.

## 7. Evaluation (P4)

Seeded from `library/circuits`, every one of which must pass every check.
Mutation operators are data: reverse a polarized part, remove a series part,
short two nets, cut a wire, scale a parameter ×10 or ×0.1, swap two pins, change
the supply voltage, apply a misleading label (adversarial).

Ground truth is the known mutation site plus the rule and simulation findings on
the mutated circuit; unmutated circuits are controls for false positives.

Metrics: explainer precision and recall at locating the right part, false
positives on working circuits, verifier agreement with the simulator, verdict
stability, invalid-output rate, nonexistent-ID rate before rejection, latency
p50/p95, cost per check. Thresholds live in config; `pnpm eval` writes JSON and
HTML reports, shown at `/eval`. CI fails changes to prompts, models, part
definitions or rules if the metrics drop below threshold.

## 8. Applications (P5–P7)

**2D editor** — React Flow; palette and parameter panels generated from part
definitions, with no per-part UI code. Live rule findings, simulation overlays
and waveforms on Test, explainer cards on Detect, commit dialog pre-filled by
`change_summarizer`, branch graph, commit detail with badges and links into the
LLM audit log, two-commit diff with an electrical/cosmetic filter, merge screen
with conflicts grouped by layer and validated LLM suggestions.

**AR app** (`/xr`) — WebXR `immersive-ar` with passthrough, hands and
controllers. Hit-test and anchors place a workbench; parts snap to breadboard
holes; wiring is pinch-drag-pinch within the configured snap radius. Faulty
parts glow red; Test mode drives LED glow from simulated component states and
moves particles along wires at a rate proportional to current. A wrist menu
carries commit, branch switching, history, restore and follow mode; ghost
overlays show what changed against a chosen commit. Conflicts are resolved in
2D.

**Import** — native JSON validated against the schema; SPICE netlists mapped to
parts through each definition's `spice.element`, with unknown elements reported
rather than guessed (the LLM may suggest a mapping, but the user confirms it).
elkjs lays circuits out, and AR projects that layout onto the detected table.
Import as a new project or as a block inside the current circuit.

## 9. Sync (P8)

Commits are the unit of sync; clients subscribe to branch-head updates. In
follow mode a moved head updates a clean device automatically and raises `C33`
when there are uncommitted changes. Working copies autosave on the interval in
`ui.autosaveIntervalMs`.

## 10. Repository

See [README.md](README.md#layout). `legacy/` holds the archived CircuitDoctor
prototype and is excluded from the workspace and all tooling; `quiz_cyber/` and
`yolo/` are unrelated and likewise excluded.
