# CircuitGit AR

Version control for electronic circuits, with a Meta Quest AR app, a 2D web
editor, a simulation-backed fault detector, and an LLM layer that explains
faults and cross-checks the simulator.

Build → Detect → Commit → Test → Branch/Merge → Restore.

> **Status: foundation, data layer and the 2D editor are running.**
> `pnpm dev` opens a working editor: drag parts from a library of 12 definitions,
> wire them, see live topology findings, then commit, branch, diff and restore.
> Simulation (P2), the backend (P3) and the LLM layer (P4) are not connected yet,
> and the UI says so rather than showing invented values.
> See [DESIGN.md](DESIGN.md) for the full plan.

## Requirements

- Node.js ≥ 20.11 (developed on 24.13)
- pnpm 9 — `npm install -g pnpm@9`
  (`corepack enable` needs an elevated shell on Windows; see [DECISIONS.md](DECISIONS.md) D3)
- ngspice on `PATH` for transient simulation (P2 onward)

## Setup

```bash
pnpm install
cp .env.example .env   # then fill in the keys you need
```

All keys are server-side only. `apps/api` reads them; they are never bundled
into the web or AR client and never committed.

| Variable                                      | Needed for                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY`                           | Any LLM-backed check. Without it the gateway reports `unavailable` — it never substitutes canned text. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`   | API service. Service role bypasses row-level security: server only.                                    |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Browser client. Public by design, protected by row-level security.                                     |
| `NGSPICE_BINARY`                              | Native ngspice backend.                                                                                |

## Commands

```bash
pnpm dev           # editor + headset mirror over HTTPS (start `pnpm sync` too)
pnpm sync          # the LAN sync hub on :8787
pnpm check         # lint + typecheck + test — what CI runs
pnpm lint
pnpm typecheck
pnpm test
pnpm test:watch
pnpm format        # write
pnpm format:check  # verify, as CI does
```

## Running it

Two processes. Start both:

```bash
pnpm sync   # terminal 1 — the sync hub on :8787
pnpm dev    # terminal 2 — the web app on :5173 over HTTPS
```

Then open **https://127.0.0.1:5173** and accept the self-signed certificate.

| Route     | What                                                          |
| --------- | ------------------------------------------------------------- |
| `/`       | The 2D editor                                                 |
| `/xr`     | The headset mirror (add `?room=demo` to join a room directly) |
| `/health` | Hub status, proxied through the dev server                    |

### Syncing a Quest

The Quest needs HTTPS for WebXR, so the dev server runs TLS and binds to every
interface. `/sync` is proxied to the hub, so the headset opens **one** origin and
trusts **one** certificate.

1. Put the Quest and this machine on the same WiFi.
2. `pnpm dev` prints a `Network:` URL, e.g. `https://192.168.1.20:5173/`.
3. In the Quest browser open that address with `/xr` on the end, and accept the
   certificate warning ("Advanced" then "Proceed").
4. On the laptop, click **Sync off** in the top bar and join a room (`demo`).
   Join the same room on the headset.
5. Edits on the laptop appear in the headset live.

The headset is a read-only mirror; the laptop is the authority.

### Simulation sessions

**Simulate** in the top bar starts a session. While one runs the circuit is
locked — no parts added, removed, moved, re-valued or rewired, on either device.
The lock is enforced in the UI, again in the store, and again in the hub, so a
remote device cannot sidestep it. **Stop session** unlocks.

A session refuses to start on an empty circuit, one with no ground reference, or
one with a failing check.

> The solver is not connected yet (P2), so a session shows **no values**. It
> locks the circuit and mirrors the state; it does not invent numbers.

## Configuration

Every tunable lives in [`config/default.yaml`](config/default.yaml): model IDs
per LLM job, temperatures, sample counts, timeouts, retries, comparator
tolerances, cache settings, merge conflict policies, branch protection,
simulation settings, AR snapping radius and animation scales, and evaluation
thresholds.

It is validated against `configSchema` at startup and **fails fast** — an
unknown key, a missing LLM job, or a missing merge policy throws
`ConfigValidationError` listing every problem, rather than falling back to a
default. Nothing part-specific and nothing tunable belongs in code.

```ts
import { getConfig } from '@circuitgit/schema';

const config = getConfig(); // typed, validated, loaded once
```

Bump `configVersion` when a change should invalidate cached check results — the
cache key includes it.

## Layout

```
apps/web           2D editor, history, merge UI, eval dashboard; /xr = AR app
apps/api           Hono service: LLM gateway, simulation, merge sessions, checks
packages/schema    Zod schemas (parts, circuits, commits, config, LLM I/O) + config loader
packages/core      canonical hashing, diff, commit graph, branches, 3-way merge, nets
packages/parts     part library loader + part definition files (data)
packages/rules     generic rule engine + rule definition files (data)
packages/sim       SimulationEngine, built-in DC solver, ngspice backend, netlist generator
packages/llm       provider interface, gateway, versioned prompts, jobs, comparator
packages/import    native JSON + SPICE importers, auto-layout
packages/eval      mutation generator, eval runner, metrics, reports
library/circuits   curated prebuilt circuits (data, each with expected-behaviour tests)
config/            all tunables
supabase/          migrations and row-level security policies
scripts/           repo-wide guards (e.g. the no-hard-coded-parts CI test)

socket-server/     the earlier CircuitDoctor prototype (Socket.IO + Unity)
web/               the earlier CircuitDoctor web client
```

`socket-server/` and `web/` are the previous prototype, left exactly as they
were. They are excluded from the pnpm workspace, ESLint, TypeScript and Vitest,
so they keep running on their own and `pnpm check` only covers the new code.

## Testing on a Quest

_(Wired up in P6; recorded here so the setup is not a surprise.)_

WebXR requires HTTPS even on a LAN, so the dev server runs with
`@vitejs/plugin-basic-ssl`.

**On the headset:**

1. Put the Quest and the dev machine on the same network.
2. `pnpm --filter @circuitgit/web dev --host` and note the LAN HTTPS URL
   (e.g. `https://192.168.1.20:5173`).
3. Open that URL in the Quest Browser, accept the self-signed certificate
   warning, and go to `/xr`.
4. Add that origin to `API_ALLOWED_ORIGINS` in `.env` or API calls will be
   blocked by CORS.

**On the desktop:** install the
[Meta Immersive Web Emulator](https://chromewebstore.google.com/detail/immersive-web-emulator/cgffilbpcibhmcfbgggfhfolhkfbhmik)
extension for Chrome, open `/xr`, and drive the headset and hands from the
emulator's device panel. Hand tracking and controllers are both supported.

## Non-negotiables

These are enforced, not aspirational:

1. **Nothing part-specific in engine code.** Pins, polarity, ratings, SPICE
   models, state rules, visuals and footprints live in part definition files.
   `scripts/noHardcodedParts.test.ts` fails CI if a part name appears as a string
   literal in `packages/{core,rules,sim,llm}`.
2. **No canned LLM output.** Every user-visible LLM string comes from a real
   model call. Mocks are confined to test files and named as such.
3. **No demo-specific code paths.** Demo and example circuits are data files that
   go through the same pipeline as user circuits.
4. **All tunables in config,** schema-validated at startup.
5. **Every LLM output schema-validated.** A response referencing a component,
   pin or net that does not exist is rejected and surfaced as
   `unavailable | invalid` — never silently replaced.
6. **The simulator owns the numbers.** The LLM explains and cross-checks; it
   never calculates the official values and never changes a circuit unless the
   change passes the full check pipeline.

## Documents

- [DESIGN.md](DESIGN.md) — architecture, data model, conflict catalogue, LLM pipeline
- [DECISIONS.md](DECISIONS.md) — every choice the build prompt left open
- [BUILD_PROMPT.md](BUILD_PROMPT.md) — the original specification
