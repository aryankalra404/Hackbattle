# Build Prompt: CircuitGit AR

> Paste everything below into your coding agent (Claude Code, Cursor, etc.). "CircuitGit" is a working name; it is set in config, not in code.

---

## 0. Your role and how to work

You are building **CircuitGit AR** end to end: version control for electronic circuits, with a Meta Quest AR app, a 2D web app, a simulation-backed fault detector, and an LLM layer that explains faults and cross-checks the simulator.

How to work:

- Build in the **phases in section 10**, in order. After each phase:
  - run lint, typecheck and all tests;
  - report what you built, the actual test output, and known gaps;
  - **wait for approval** before starting the next phase.
- If something isn't specified:
  - pick the simplest option that follows the rules in section 2;
  - record it in `DECISIONS.md` and flag it in your phase report;
  - if the choice changes how the product behaves for users, **ask instead**.
- Never say something works unless you ran it. If a test fails, report the failure.

---

## 1. Product summary

Users build and wire circuits in AR on a Meta Quest (and in a 2D web editor). Every circuit lives in a version-controlled project with **commits, branches, merges, restore, undo, and cherry-pick**. Every version goes through checks:

1. a **rule engine** (instant, deterministic),
2. a **circuit simulator** (the source of truth for all numbers),
3. an **LLM** that explains faults, predicts circuit behavior _without seeing the simulation_ to cross-check it, diagnoses mismatches, checks intent, suggests merge resolutions, and summarizes changes.

Users can also import prebuilt, complex circuits into both AR and 2D.

Core loop: **Build → Detect → Commit → Test → Branch/Merge → Restore**.

---

## 2. Non-negotiable rules: nothing hard-coded

1. **No part-specific logic in code.**
   - Pins, polarity, ratings, simulation models, state rules, visuals, footprints and pin migrations all live in **part definition files** (section 5.1).
   - Engines (rules, sim, merge, UI) must work for any part defined in the library.
   - Add a CI test that fails if any part ID (e.g. `led`, `resistor`) appears as a string literal inside `packages/core`, `packages/rules`, `packages/sim`, or `packages/llm` source (test files excluded).
2. **No canned LLM output.**
   - Every piece of LLM text shown to users comes from a real model call.
   - Mocks and fixtures are allowed **only inside test files** and must be clearly named.
3. **No demo-specific code paths.**
   - Nothing like `if (circuit.name === "blinker")`.
   - Demo and example circuits are data files that go through the same pipeline as user circuits.
4. **All tunables live in config.** This includes:
   - model IDs per LLM job, temperature, sample count, timeouts, retries;
   - comparison tolerances, cache settings;
   - default conflict policies, branch protection;
   - simulation settings, AR snapping radius, animation scales;
   - evaluation thresholds.

   Validate config against a schema at startup and fail fast if it's invalid.

5. **Every LLM output is schema-validated.**
   - Reject any response that references a component, pin or net ID that doesn't exist.
   - Every failure is shown to users as `status: unavailable | invalid`, never silently replaced.
6. **The LLM is never the source of truth for numbers.**
   - The simulator's values always win.
   - The LLM never changes a circuit unless the change passes the full check pipeline.
7. **Physics is deterministic code** (simulator + generic rule checks). The LLM explains and cross-checks; it does not calculate the official values.
8. **Secrets are server-side only**, loaded from environment variables. Ship a `.env.example`; never commit keys.

---

## 3. Tech stack

| Area            | Choice                                                                                                                                                                                                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language        | TypeScript (strict), pnpm workspaces monorepo                                                                                                                                                                                                                                                                                    |
| 2D web app      | Vite + React + React Flow; elkjs for auto-layout                                                                                                                                                                                                                                                                                 |
| AR app          | React Three Fiber + `@react-three/xr` (WebXR `immersive-ar`, passthrough, hand tracking + controllers), served from the same web app at `/xr`                                                                                                                                                                                    |
| Backend         | Supabase (Postgres, Realtime, Auth, row-level security) + a Node/Hono API service for LLM calls, simulation and merge sessions                                                                                                                                                                                                   |
| Simulation      | `SimulationEngine` interface with two backends: a built-in DC solver (fast, runs in the browser) and ngspice (full/transient). If a reliable ngspice WebAssembly build exists, use it in the browser; otherwise run ngspice as a native binary in the API service behind the same interface. Backend selection is config-driven. |
| LLM             | `LLMProvider` interface. Default provider is Anthropic; model per job comes from config (defaults in section 12). Use the provider's JSON-schema structured output, and validate with Zod anyway.                                                                                                                                |
| Validation      | Zod schemas for every file format, API payload and LLM output                                                                                                                                                                                                                                                                    |
| Tests           | Vitest + fast-check (property-based testing)                                                                                                                                                                                                                                                                                     |
| Local Quest dev | HTTPS via `@vitejs/plugin-basic-ssl`; Meta Immersive Web Emulator in desktop Chrome; LAN access from the Quest Browser                                                                                                                                                                                                           |

---

## 4. Repo layout

```
apps/
  web/            2D editor, history, merge UI, eval dashboard; /xr route = AR app
  api/            Hono service: LLM gateway, simulation, merge sessions, checks
packages/
  schema/         Zod schemas: parts, circuits, commits, config, LLM I/O
  core/           canonical hashing, diff, commit graph, branches, 3-way merge, nets, restore/undo/cherry-pick/rebase
  parts/          part library loader + definition files (data)
  rules/          generic rule engine + rule definition files (data)
  sim/            SimulationEngine interface, built-in DC solver, ngspice backend, netlist generator
  llm/            provider interface, gateway, prompt templates (versioned files), jobs, comparator
  import/         native JSON + SPICE netlist importers, auto-layout
  eval/           mutation generator, eval runner, metrics, reports
library/
  circuits/       curated prebuilt circuits (data files, each with expected-behavior tests)
config/
  default.yaml    all tunables (section 2, rule 4)
supabase/         migrations, row-level security policies
```

---

## 5. Data model

### 5.1 Part definition (one file per part, versioned)

```yaml
id: led-5mm
version: 2
labelPrefix: D
source: '<datasheet or standard-model citation for the simulation model and ratings>'
pins:
  - { id: anode, name: Anode }
  - { id: cathode, name: Cathode }
requiredPins: [anode, cathode]
polarized: { positive: anode, negative: cathode }
params:
  color: { type: enum, values: [red, green, blue, yellow], default: red }
spice:
  element: D
  template: 'D{label} {pin.anode} {pin.cathode} {model}'
  models: { red: '<.model line from cited source>', ... }
ratings: # read by the generic rating check
  - { quantity: current, through: [anode, cathode], max: <from datasheet>, unit: A }
  - { quantity: reverse_voltage, across: [cathode, anode], max: <from datasheet>, unit: V }
states: # how simulation results become UI states (data, not code)
  - { state: on, when: { quantity: current, through: [anode, cathode], gt: <config ref or value> } }
  - { state: off, otherwise: true }
visual: { symbol2d: symbols/led.svg, model3d: models/led.glb, glowOnState: on }
footprint: { breadboard: { pins: { anode: [0, 0], cathode: [1, 0] } } }
pinMigrations: { '1': { '+': anode, '-': cathode } }
```

The initial library needs at least these parts:

- battery / DC supply
- resistor, potentiometer
- LED, diode
- ceramic capacitor, electrolytic capacitor (polarized)
- switch, pushbutton
- NPN transistor
- 555 timer (subcircuit model)
- buzzer

Every simulation model and rating must cite its source in `source`. Never invent numbers.

### 5.2 Circuit snapshot

Collections are maps keyed by random UUIDs so diffs work per entity. Labels like "R1" are display-only.

```json
{
  "schemaVersion": 1,
  "meta": { "name": "", "description": "", "intent": "" },
  "settings": {
    "ground": "<compId>.<pinId>",
    "simulation": { "analysis": "op|transient", "...": "..." }
  },
  "components": { "<uuid>": { "part": "led-5mm@2", "label": "D1", "params": { "color": "red" } } },
  "wires": {
    "<uuid>": { "a": "<compId>.<pinId>", "b": "<compId>.<pinId>", "style": { "color": "red" } }
  },
  "blocks": {
    "<uuid>": {
      "source": "library/circuits/555-astable@1",
      "snapshot": { "...nested circuit...": "" },
      "ports": {}
    }
  },
  "tests": {
    "<uuid>": {
      "kind": "state|value|frequency",
      "target": "...",
      "expect": "...",
      "tolerance": "config-ref-or-value"
    }
  },
  "annotations": { "<uuid>": { "attachedTo": "<entityId>|circuit", "text": "" } },
  "layout": { "2d": {}, "ar": {}, "breadboard": {} }
}
```

### 5.3 Canonical form and hashing

- Canonical JSON: sorted keys, normalized numbers, wire endpoints sorted (a wire has no direction), then SHA-256.
- **`snapshotHash`** covers everything.
- **`electricalHash`** leaves out `layout`, wire `style`, `meta` and `annotations`. Check results and LLM calls are cached by `electricalHash`, so moving a part never re-runs the simulator or the LLM.

### 5.4 Commits, branches, working copies

- **Commit:** `{ id, parents: [], snapshotHash, electricalHash, message, author, source: "quest"|"web"|"import"|"merge", createdAt, checks: { rules, sim, llm } }`
  - `id` is the hash of the parents, snapshotHash, message, author and createdAt.
  - 0 parents = first commit, 1 = normal, 2 = merge.
- **Branch:** `{ project, name, head, protected }`
  - Moving `head` is always a compare-and-swap: it only succeeds if the head is still where the client thinks it is.
- **Working copy:** `{ user, device, project, branch, baseCommit, draftSnapshot, updatedAt }`, autosaved.

### 5.5 Database tables

| Table                                   | Holds                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `projects`                              | Projects                                                                                                                        |
| `snapshots`                             | Circuit snapshots, stored once per hash (`hash` is the primary key, body is jsonb)                                              |
| `commits`, `branches`, `working_copies` | As in 5.4                                                                                                                       |
| `merge_sessions`                        | base, ours, theirs, conflicts, resolutions, status                                                                              |
| `check_results`                         | Keyed by electricalHash, check type, config version, prompt version, model                                                      |
| `llm_calls`                             | Audit log: job, prompt version, model, rendered input, raw output, validation result, latency, tokens, snapshot/electrical hash |
| `imports`                               | Import records                                                                                                                  |

Row-level security on every table.

---

## 6. Version control engine (`packages/core`)

**Operations:** commit, branch (create / switch / rename / delete), log, diff (any two commits; can filter to electrical-only), merge, restore-to-version, undo-commit, cherry-pick, rebase (for concurrent commits).

**Three-way merge algorithm**

1. Find the merge base. If there are several common ancestors, merge them recursively into a temporary base (conflict C37).
2. If the two sides use different part-library versions, apply the part's `pinMigrations` first.
3. Compare each collection field by field: components, wires, blocks (recursively), tests, annotations, settings, meta, layout.
4. Classify every change using the conflict catalogue below. Resolve what the configured policy allows automatically; collect the rest.
5. **Connectivity analysis:** calculate the nets for base, ours, theirs and merged. Flag nets that were joined, parts that were split off, and lost ground/power (C21–C23).
6. Once every Ask/Block from steps 4–5 is resolved, run the full check pipeline (section 7) on the merged snapshot. This finds electrical conflicts (C24–C31).
7. Create the merge commit only when no Block remains and branch protection is satisfied.

**Restore vs undo**

- **Restore:** makes a new commit whose snapshot equals the target's. It never conflicts.
- **Undo:** applies the reverse of one commit's change on top of the current head, using the same merge machinery, so it can conflict.
- **Cherry-pick:** uses the same machinery.

### Conflict catalogue

Every row needs at least one test. Policies can be overridden in config (`merge.policies.C18: auto:ours`).

**Policies:** `auto` = resolved silently and listed in the merge report · `ask` = user must choose · `block` = the merge can't be committed until fixed.

| ID  | Layer        | Conflict                                                                      | Default                                                                    |
| --- | ------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| C1  | Structural   | Same property changed differently on both sides                               | ask                                                                        |
| C2  | Structural   | Different properties of the same part changed                                 | auto (keep both)                                                           |
| C3  | Structural   | Part type changed on one side, edited on the other                            | ask                                                                        |
| C4  | Structural   | Deleted on one side, edited on the other                                      | ask                                                                        |
| C5  | Structural   | Deleted on one side, wired to on the other (the wire would point at nothing)  | block until resolved                                                       |
| C6  | Structural   | Deleted on one side, moved on the other                                       | auto (delete wins)                                                         |
| C7  | Structural   | Same wire moved to different pins                                             | ask                                                                        |
| C8  | Structural   | Wire deleted on one side, moved on the other                                  | ask                                                                        |
| C9  | Structural   | Same connection added on both sides                                           | auto (remove duplicate)                                                    |
| C10 | Structural   | Same label added on both sides                                                | auto (renumber)                                                            |
| C11 | Structural   | Same breadboard hole used twice                                               | ask                                                                        |
| C12 | Structural   | Part-library version mismatch                                                 | auto if the part defines a pin migration, else ask                         |
| C13 | Structural   | Imported block edited on both sides                                           | merge inside the block; replaced on one side and edited on the other → ask |
| C14 | Structural   | Circuit-wide settings changed (simulation, ground)                            | ask                                                                        |
| C15 | Structural   | User-defined test edited differently                                          | ask                                                                        |
| C16 | Structural   | Name / description / notes                                                    | auto if edits don't overlap, else ask                                      |
| C17 | Structural   | Comment attached to a deleted part                                            | auto (move to circuit level + notice)                                      |
| C18 | Structural   | Position moved differently (2D / AR)                                          | auto:ours                                                                  |
| C19 | Structural   | Parts overlap after merging                                                   | auto (layout engine nudges them apart)                                     |
| C20 | Structural   | Wire color or route changed                                                   | auto:ours                                                                  |
| C21 | Connectivity | Two nets joined that neither side intended                                    | ask                                                                        |
| C22 | Connectivity | Net split, leaving a part floating                                            | ask                                                                        |
| C23 | Connectivity | Lost ground or power connection                                               | block                                                                      |
| C24 | Electrical   | A part's rating exceeded (any rating in the part definition)                  | block                                                                      |
| C25 | Electrical   | Short circuit                                                                 | block                                                                      |
| C26 | Electrical   | Power budget exceeded                                                         | block                                                                      |
| C27 | Electrical   | Reversed polarity                                                             | block                                                                      |
| C28 | Electrical   | Floating input / missing ground                                               | ask                                                                        |
| C29 | Electrical   | Behavior regression (user tests fail on the merge but passed on both parents) | block on protected branches, else ask                                      |
| C30 | Electrical   | Simulation fails to solve the merged circuit                                  | ask (mismatch analyst helps diagnose)                                      |
| C31 | Electrical   | LLM and simulator disagree on the merged circuit                              | block on protected branches, else ask                                      |
| C32 | Sync         | Two devices commit to the same branch (compare-and-swap fails)                | auto-rebase if changes don't overlap, else open a merge session            |
| C33 | Sync         | Uncommitted changes when the followed branch moves                            | ask (stash / commit / discard)                                             |
| C34 | Sync         | Restore vs undo                                                               | UI offers both; undo goes through this catalogue                           |
| C35 | Sync         | Cherry-pick conflicts                                                         | same as merge                                                              |
| C36 | Sync         | Branch deleted or renamed while checked out on another device                 | notify; keep work on a recovery branch                                     |
| C37 | Sync         | More than one common ancestor                                                 | merge ancestors into a temporary base first                                |

**Required property-based tests**

- `merge(base, X, X) == X`
- `merge(base, base, X) == X`
- Swapping sides gives the same result, apart from ours/theirs policies.
- No committed snapshot ever contains a reference to something that doesn't exist.
- Diff between a restored commit and its target is empty.
- Undoing an undo gives back the original state.
- Hashing is stable under key reordering.

---

## 7. Check pipeline

### 7.1 Rule engine (`packages/rules`)

The check kinds are generic code; the part definitions drive where they apply.

| Check kind                 | What it does                             |
| -------------------------- | ---------------------------------------- |
| `rating_exceeded`          | Any `ratings` entry vs simulated values  |
| `polarity_reversed`        | Any part with `polarized`                |
| `short_circuit`            | Graph + simulation                       |
| `floating_pin`             | Pins with no connection                  |
| `unconnected_required_pin` | `requiredPins` left open                 |
| `no_ground_path`           | Parts with no path to ground             |
| `power_budget`             | Total load vs what the source can supply |
| `hole_occupancy`           | Two things in one breadboard hole        |
| `user_test_failed`         | A user-defined test in the circuit fails |

- Rule files (data) set severity, which kinds are enabled, and parameters.
- Findings are structured: `{ kind, severity, componentIds, pinIds, measured, limit, unit }`.
- Topology-only checks run on every edit; simulation-backed checks run on Test, Commit and Merge.

### 7.2 Simulation (`packages/sim`)

- Interface: `simulate(snapshot, { analysis }) → { netVoltages, branchCurrents, componentStates, waveforms?, diagnostics }`.
- The netlist is generated only from the part definitions' `spice.template` and `models`.
- Component states (e.g. LED on) come from each part's `states` rules.
- Backends: `builtin-dc` and `ngspice`. Which one runs for each analysis type is set in config.

### 7.3 LLM layer (`packages/llm` + API gateway)

**Gateway**

- `LLMProvider` interface; model per job, temperature, timeout, retries and sample count all come from config.
- Uses JSON-schema structured output and Zod validation.
- Retries once when output is invalid.
- Returns `{ status: ok|invalid|timeout|error|unavailable, data?, callId }`.
- Every call is written to `llm_calls`.
- Cache key: `(job, electricalHash, promptVersion, model, configVersion)`.

**Prompts**

- Stored as versioned template files: `packages/llm/prompts/<job>/v<N>.md`.
- Inputs are rendered from real data:
  - a canonical text netlist (UUIDs plus labels),
  - the relevant part-definition fields (pins, ratings, polarity),
  - and, when the job allows it, rule findings and simulation results.

**Jobs**

| Job                 | Input                                             | Output schema                                                                                                   | Validation                                                                                                                                     |
| ------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `fault_explainer`   | circuit + findings + sim results                  | `{ faults: [{ componentIds, pinIds, severity, title, explanation, fix: { description, proposedChanges? } }] }`  | IDs exist; numbers match the simulator within tolerance; `proposedChanges` are applied to a copy and must pass the pipeline before being shown |
| `blind_verifier`    | circuit + part definitions **only**               | `{ predictions: [{ target, quantity, value?, unit?, state?, confidence }] }`                                    | Comparator (below)                                                                                                                             |
| `mismatch_analyst`  | predictions + sim results + netlist + diagnostics | `{ likelyCause: netlist_translation\|part_model\|solver_failure\|llm_error\|ambiguous, explanation, evidence }` | IDs exist; shown as "Needs review", never overrides the simulator                                                                              |
| `intent_checker`    | meta.intent, labels, description + circuit        | `{ mismatches: [{ componentIds, expected, actual, explanation }] }`                                             | IDs exist                                                                                                                                      |
| `merge_advisor`     | conflict + base/ours/theirs slices                | `{ resolution, rationale }`                                                                                     | Applied to a copy; shown only if the result passes the pipeline                                                                                |
| `change_summarizer` | diff between commits                              | `{ summary, electricalChanges: [], cosmeticChanges: [] }`                                                       | IDs exist; used to pre-fill commit messages (user can edit)                                                                                    |

**Keeping the verifier blind**

- The `blind_verifier` prompt builder's function signature only accepts `(snapshot, partDefs)`.
- A test renders the prompt and asserts that no simulation values appear in it.

**Comparator**

- Plain code (not an LLM) matches each prediction to a simulated quantity.
- Tolerances come from config: relative tolerance for numbers, exact match for states.
- Runs `N` samples (config, default 3) and takes the majority.
- Verdict:
  - `verified`: the majority agrees with the simulator;
  - `mismatch`: they disagree, which triggers `mismatch_analyst`;
  - `unstable`: samples disagree with each other, shown as "Needs review".

### 7.4 When each check runs

| Trigger    | Runs                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Every edit | topology rules                                                                                                                            |
| Test       | simulation + simulation-backed rules + blind verifier + comparator (+ mismatch analyst if needed) + fault explainer if anything was found |
| Detect     | all of the above + intent checker                                                                                                         |
| Commit     | same as Detect; results attached as badges                                                                                                |
| Merge      | section 6, step 6                                                                                                                         |

### 7.5 Badges and branch protection

- Each commit shows `rules`, `sim`, `llm` badges: pass / warn / fail / unavailable.
- Protected branches (config, default `[main]`) only accept commits and merges with no failing badge. Admins can override the "unavailable" state, and the override is recorded in the log.

---

## 8. LLM evaluation harness (`packages/eval`)

**Seed data**

- Every circuit in `library/circuits` (each must pass every check).

**Mutation operators** (defined as data, applied automatically)

- reverse a polarized part
- remove a series part
- short two nets
- cut a wire
- scale a parameter ×10 or ×0.1
- swap two pins
- change the supply voltage
- give a part a misleading label (adversarial)

**Ground truth**

- The known mutation location + the rule/simulation findings on the mutated circuit.
- Unmutated circuits are the controls for measuring false positives.

**Metrics**

- Explainer: precision and recall at pointing to the right part.
- False-positive rate on working circuits.
- Verifier agreement rate with the simulator, and verdict stability.
- Invalid-output rate.
- Rate of references to nonexistent IDs _before_ rejection.
- Latency p50/p95 and cost per check.

**Running it**

- `pnpm eval` writes a JSON report plus a markdown/HTML report, shown on the `/eval` page.
- Thresholds live in config.
- Run it on demand and **before merging any change to prompts, models, part definitions or rules**. The CI job for those paths fails if results drop below thresholds.
- Dataset size is set in config.

---

## 9. Apps

### 9.1 2D web app (`apps/web`)

**Projects and editing**

- Auth and project list.
- React Flow editor. The parts palette comes from the part library.
- Parameter panels are **generated from each part's `params` schema**; no UI code for individual parts.
- Rule findings shown live.

**Test and Detect**

- **Test:** simulation results overlaid on the circuit (voltages on nets, current through parts, component states such as a glowing LED), plus waveform plots for time-based simulations.
- **Detect:** the explainer's cards, with the relevant parts highlighted.

**History and branches**

- Commit dialog with a message pre-filled by `change_summarizer` (user can edit).
- Branch graph showing the full commit history. Branches can be created, switched, renamed and deleted; protected branches are marked.
- Commit detail page: badges, check reports, links to the LLM calls in the audit log.
- Diff between any two commits, with an electrical/cosmetic filter. Colors: green = added, red = removed, amber = changed.

**Merge**

- Merge screen: base / ours / theirs plus a preview of the merged circuit.
- Conflicts grouped by layer. For each one: ours / theirs / both (where valid) / edit by hand.
- Validated LLM suggestions shown next to each conflict.
- Check results for the merged circuit; commit the merge once allowed.

**Other**

- Restore vs Undo actions; cherry-pick.
- Import.
- `/eval` dashboard.

### 9.2 AR app (`/xr`)

**Setup and building**

- WebXR `immersive-ar` with passthrough; supports hands and controllers.
- Place a virtual workbench/breadboard using hit-test / plane detection and anchors.
- Parts palette panel built from the same part library.
- Grab and place parts; they snap to breadboard holes.

**Wiring and editing**

- Wire by pinching a pin, dragging, and pinching another pin. Snapping radius comes from config.
- Parameter panels generated from part schemas.

**Checks and testing**

- Live findings: parts with faults glow red; tap one to open the explainer card.
- **Test mode:** LEDs glow based on the simulated component states; particles move along wires at speed proportional to current (scale from config).

**Version control in AR**

- Wrist/floating menu: commit, switch branch, history, restore, "follow branch" mode.
- Ghost overlays show what changed compared with a selected commit.
- Merge result viewer with a conflict list. Conflicts are resolved in 2D (stretch goal: pinch to choose between ghost options in AR).

**Import**

- Import library circuits onto the table: the elkjs 2D layout is projected onto the detected table surface.

**Optional, phase 8**

- Line up the virtual breadboard with a real one by hand. Highlight whole rows rather than single holes, because alignment probably isn't hole-accurate.

### 9.3 Import (`packages/import`)

**Native JSON**

- Validated against the schema.

**SPICE netlist (`.cir`/`.net`)**

- Elements are mapped to parts using each part definition's `spice.element` and model mapping (data-driven).
- Unknown elements are **reported, not guessed**. The LLM may suggest a mapping, but the user must confirm it.

**Layout and destination**

- Auto-layout with elkjs; AR projects that layout onto the table.
- Import either as a new project (first commit, `source: import`) or as a `block` inside the current circuit.

**Curated library**

- Examples: 555 astable blinker, op-amp amplifier, bridge rectifier, H-bridge.
- Stored as data files with tests; CI checks that every one passes.

### 9.4 Sync

- Commits are the unit of sync. Clients subscribe to live updates of branch heads.
- **Follow mode:** when the followed branch's head moves:
  - no uncommitted changes → the device updates automatically;
  - uncommitted changes → conflict C33 (ask).
- Moving a branch head uses compare-and-swap. If the head already moved, this is conflict C32.
- Working copies autosave.

---

## 10. Phases and acceptance criteria

| Phase                         | Build                                                                                                                                                             | Done when                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0 Foundation**             | Monorepo, strict TypeScript, lint, Vitest, config loader with schema, `.env.example`, CI                                                                          | `pnpm check` (lint + typecheck + test) passes                                                                                                           |
| **P1 Core + version control** | Schemas, part library loader + initial parts, hashing, diff, commit graph, branches, merge (structural + connectivity layers), restore/undo/cherry-pick/rebase    | Every catalogue row C1–C23 and C32–C37 has at least one test; property tests pass; the no-part-IDs-in-engine-code test passes                           |
| **P2 Checks**                 | Rule engine, SimulationEngine + built-in DC solver + ngspice, component states, electrical conflicts C24–C31 wired into merge                                     | The C24 case is blocked by the **generic** rating check with no LED-specific code: ancestor 330Ω / 5V; A changes R1 to 150Ω; B changes the supply to 9V |
| **P3 Backend**                | Database migrations + row-level security, API (commit, compare-and-swap branch updates, merge sessions, checks), live updates, LLM gateway with audit log + cache | API integration tests pass; a gateway failure shows as `unavailable` in the response, never as a fallback message                                       |
| **P4 LLM jobs + eval**        | All 6 jobs, comparator, prompt templates, eval harness + report                                                                                                   | Eval report generated and meeting config thresholds; blind test passes; no nonexistent IDs reach the UI                                                 |
| **P5 2D app**                 | Section 9.1                                                                                                                                                       | In a browser, the full loop works: build → detect → test → commit → branch → merge with real conflicts → restore / undo / cherry-pick                   |
| **P6 AR app**                 | Section 9.2                                                                                                                                                       | The same loop works on a Quest (or the Immersive Web Emulator) and stays in sync with the 2D app in real time                                           |
| **P7 Import**                 | Section 9.3                                                                                                                                                       | Curated circuits import and pass their tests in both 2D and AR; SPICE import round-trips; unknown elements are reported                                 |
| **P8 Sync + polish**          | C32–C37 working end-to-end across devices, optional physical-breadboard alignment, demo run-through                                                               | The demo script (section 11) runs start to finish with no scripted shortcuts                                                                            |

With a team, P5 and P6 can start once P1's schemas are frozen, working against the P1 core and a local check pipeline, and connect to P3/P4 as those land.

---

## 11. Demo script (must work with real data and real LLM calls)

1. **Quest:** wire battery → LED with no resistor. The live rating check flags it; the explainer says why and what current to expect.
2. Add a resistor → Test → the LED glows, the blind verifier shows **Verified** → commit "v1 working" to `main`.
3. Create branch `feature/brighter` and lower the resistor value. From the laptop, create `feature/9v` and raise the supply voltage. Each branch passes its checks on its own.
4. Merge both into `main` in the 2D app. It **applies cleanly but is blocked by C24**: the merged current exceeds the LED's rating. The explainer and merge advisor propose a fix, which was validated before being shown. Apply it and commit the merge.
5. Break the circuit on the Quest (reverse the LED) and commit it on a branch. On the laptop, use **Undo** on that commit; the Quest, in follow mode, updates live.
6. Import the 555 blinker in AR; Test shows it blinking at the frequency the simulator predicts, and the verifier agrees.
7. Open `/eval` to show real accuracy numbers.

---

## 12. Defaults for open decisions (all in config)

- **Protected branches:** `[main]`. C29 and C31 block merges into them.
- **Position/style conflicts (C18, C20):** `auto:ours`.
- **Breadboard:** virtual by default; aligning to a physical breadboard is optional in phase P8.
- **LLM models:**
  - `claude-sonnet-5` for `fault_explainer`, `blind_verifier`, `intent_checker` and `change_summarizer`;
  - `claude-opus-5` for `mismatch_analyst` and `merge_advisor`.

  Verifier temperature is low and the sample count is 3.

- **Comparator tolerances and eval thresholds:** start with reasonable values, record them in `DECISIONS.md`, and tune them using the P4 eval report.

---

## 13. Deliverables

- Source code following section 4.
- `README.md`: setup, environment variables, running locally, testing on a Quest over HTTPS/LAN and with the Immersive Web Emulator, deployment.
- `DESIGN.md`: architecture, data model, conflict catalogue, LLM pipeline.
- `DECISIONS.md`: every choice you made that this prompt didn't specify.
- `.env.example`, `config/default.yaml`.
- The latest eval report.
- A seed script that loads the curated library circuits into a demo project.
