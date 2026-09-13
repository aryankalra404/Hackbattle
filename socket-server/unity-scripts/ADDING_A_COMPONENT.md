# Adding a new spawnable circuit component (e.g. motor, ultrasonic)

Short reference from wiring up Motor and Ultrasonic. Follow this order.

## 1. Code (3 files, always all three)

- `CircuitComponent.cs`: add to the `ComponentType` enum, add `[SerializeField] PinPoint` fields
  for each terminal, add cases in `ConfigureIdentity` (sets `{id}-<pinname>`) and `GetPins`.
- `CircuitComponentSpawner.cs`: add a prefab field, a `public void SpawnX() => Spawn(xPrefab);`,
  and add the type to `PrefabForType`, `TryParseType`, `TypePrefix`.
- `QuestCircuitBridge.cs`: add a case in `BuildCircuit()`'s switch. **This one is easy to forget
  and fails silently** — the switch has a `default: continue;`, so a component with no case just
  never gets sent to the backend/web mirror at all, even though it spawns fine in AR and looks
  totally normal in the Editor.
- Web mirror: add a Node component in `apps/web/src/quest/QuestPartNode.tsx` (copy `PirNode`'s
  plain-box style, no need for real SVG art) plus a one-line CSS rule in `app.css`.

Copy the 3 `.cs` files into the live Unity project's `Assets/Scripts/` and run
`recompile_scripts` before touching the scene.

## 2. Unity scene setup

If the part already exists in the scene as a plain grabbable object with `PinPoint` children
(check first — it might already be there, just without the script), add `CircuitComponent` to
it and set `componentType`. The MCP `update_component` tool CAN do this part.

What it **cannot** do, confirmed by testing, not worth retrying:
- Assign a `PinPoint` reference to a `CircuitComponent` terminal field (e.g. `motorPositive`).
  Error: "Object references must be null, an asset path, an asset name, or an object with
  guid/path" — it only accepts asset references, not scene-object-to-scene-object refs.
- Set a `Button`'s `OnClick()` (tried both `onClick` and `m_OnClick`) — clean "field not found"
  errors, no side effect. **Do not repeat this** even though it fails cleanly here — see the
  Button gotcha below for what happens if you push a different `componentName` instead.

So: assign the PinPoint fields and both OnClick bindings by hand in the Inspector. Everything
else (renaming, relabeling text, positioning, prefab assignment once saved) can go through MCP.

## 3. Gotchas that actually bit

- **`duplicate_gameobject` AND `reparent_gameobject` corrupt RectTransform Z** on this panel's
  hierarchy (the panel cube has non-uniform scale `(0.01, 0.2, 0.001)`). Symptom: the button
  looks structurally fine (right rect, right size, right 2D anchored x/y) but is invisible and
  clicks land elsewhere, because its `anchoredPosition3D.z` ends up as a huge number like
  `-623.75` that exactly cancels the panel's world Z depth. **Always check `position.z` after
  any duplicate/reparent** — it should match a working sibling's (e.g. `0.499` on this panel),
  not `~0`. Fix: `update_component` on `RectTransform` with `anchoredPosition3D: {x, y, z: 0}`
  (keep the existing x/y). Do NOT fix it via `localPosition` — that conflicts with the active
  `HorizontalLayoutGroup` and scrambles the driven x too (saw x jump from 91.5 to 183).
- **Duplicating within the same parent is safer than reparenting.** If the target row already
  has room (rows here are 2-per-row `HorizontalLayoutGroup`s), duplicate a button already living
  in that row instead of duplicating elsewhere and reparenting. Still corrupts Z (both ops do),
  but skips the reparent-specific failure mode and is one less step.
- **Every button has two independent `Button` components**: the row button itself, and its child
  `Icon` object, each with its own `OnClick()`. Retargeting only one still leaves the other
  firing the old spawn method if it's the one catching the raycast. Fix both.
- **`update_component` adds a component if the name doesn't resolve**, per its own docs. If the
  project has an ambiguous/similarly-named class from some package (saw this with "Button" once
  resolving to a non-`UnityEngine.UI.Button` type), a failed field-set attempt can silently bolt
  a garbage component onto the object instead of just failing. If a button goes invisible right
  after an edit for no visible reason, check its component list for anything unexpected before
  assuming it's a position bug — delete and rebuild the object if so, cleaning up isn't possible
  (no remove-component tool available).
- Panel is a `ScrollRect` (`Scroll View` GameObject), not a static list. If a whole row is
  invisible, check `ScrollRect.verticalNormalizedPosition` before assuming the button itself is
  broken (`1` = top, `0` = bottom).
- After every edit: `get_console_logs` (logType error) to confirm nothing threw, then
  `save_scene`. Editor changes need a fresh Build & Run to reach an installed Quest APK — Play
  Mode/Link reflects them live, a build does not until redeployed.
