// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { emptySnapshot, pinRef } from '@circuitgit/schema';
import { electricalHash } from '@circuitgit/core';
import { App } from './App.js';
import { partLibrary, config } from './state/library.js';
import { PART_DEFS } from './parts/catalog.js';
import { PART_DRAG_TYPE } from './quest/QuestPartsPanel.js';
import { LOCKED_MESSAGE, useStore } from './state/store.js';

/**
 * End-to-end smoke test for the editor.
 *
 * This runs through Vite, so it exercises the real browser path: the part YAML
 * and config are bundled by `import.meta.glob`, validated by the same schemas
 * the server uses, and rendered by the real components.
 */

afterEach(() => {
  cleanup();
  // The store is a module singleton, so each test starts from a clean circuit.
  useStore.setState({
    selection: undefined,
    view: 'editor',
    mode: 'edit',
    simulatingHash: undefined,
    snapshot: emptySnapshot('Untitled circuit'),
    findings: [],
    toasts: [],
  });
});

describe('browser part library', () => {
  it('parses and validates every part definition through Vite', () => {
    expect(partLibrary.all().length).toBeGreaterThanOrEqual(12);
  });

  it('validates the bundled config with the shared schema', () => {
    expect(config.product.name).toBe('CircuitGit');
    expect(config.versionControl.protectedBranches).toContain('main');
  });

  it('has a symbol for every part', () => {
    for (const part of partLibrary.all()) {
      expect(part.visual.symbol2d, `${part.id}`).toMatch(/^symbols\//);
    }
  });
});

describe('editor shell', () => {
  it('shows the branch, the product name and the Quest mirror hint', () => {
    render(<App />);
    expect(screen.getByText(config.product.name)).toBeDefined();
    // The branch name appears in the switcher and the status bar.
    expect(screen.getAllByText(config.versionControl.defaultBranch).length).toBeGreaterThan(0);
    // The centre canvas mirrors the Quest bridge, not the local snapshot — it
    // starts disconnected in a test environment with no bridge server. The
    // Checks tab (rendered but hidden behind Chat, the default tab) shows
    // its own copy of the same message.
    expect(screen.getAllByText(/Not connected to the Quest bridge/).length).toBeGreaterThan(0);
  });

  it('adds a part and runs checks on it', () => {
    // The palette that drove this isn't in the UI right now (Chat took its
    // spot in the right rail — see RightRail.tsx), but the store action and
    // the checks it triggers are unchanged, so this exercises them directly.
    render(<App />);
    const before = Object.keys(useStore.getState().snapshot.components).length;

    useStore.getState().addComponent(partLibrary.get('resistor'), { x: 0, y: 0 });

    const state = useStore.getState();
    expect(Object.keys(state.snapshot.components)).toHaveLength(before + 1);

    // A lone part with nothing wired to it must produce findings, not silence.
    expect(state.findings.length).toBeGreaterThan(0);
    expect(state.findings.some((f) => f.kind === 'unconnected_required_pin')).toBe(true);
  });

  it('switches the right rail between Chat, Context and Checks', () => {
    render(<App />);

    // Chat is the default tab: the message box is present.
    expect(screen.getByPlaceholderText(/Ask CircuitDoctor/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /^Context/ }));
    expect(screen.getByText(/What are you building\?/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /^Checks/ }));
    // The Quest bridge auto-connects to a bridge server that isn't running in
    // this test environment, so both the canvas and the Checks panel show
    // their own "not connected" empty state.
    expect(screen.getAllByText(/Not connected to the Quest bridge/).length).toBeGreaterThan(0);
  });
});

describe('building a circuit from the Parts tab', () => {
  /** The card for one part. Its accessible name is the label plus its terminal count. */
  function partCard(def: (typeof PART_DEFS)[number]) {
    const palette = screen.getByRole('toolbar', { name: 'Parts' });
    return within(palette).getByRole('button', { name: new RegExp(`^${def.label}, `) });
  }

  it('opens on Parts and offers every drawn component', () => {
    render(<App />);
    for (const def of PART_DEFS) expect(partCard(def), def.type).toBeDefined();
  });

  it('adds a part with a connectable dot on every terminal the drawing has', () => {
    render(<App />);
    const led = PART_DEFS.find((def) => def.type === 'led');
    if (!led) throw new Error('fixture: no led in the catalog');

    fireEvent.click(partCard(led));

    // The node is labelled the way the headset names a spawned part, and
    // carries one React Flow handle per drawn lead.
    const node = screen.getByTitle(`led-1 — ${led.label}`);
    expect(node.querySelectorAll('.react-flow__handle')).toHaveLength(led.holes.length);
    expect(within(node).getByText('led-1')).toBeDefined();
  });

  it('drops the board in its own slot, and only once', () => {
    render(<App />);
    const board = PART_DEFS.find((def) => def.board);
    if (!board) throw new Error('fixture: no board in the catalog');

    fireEvent.click(partCard(board));

    expect(screen.getByTitle(`${board.label} — ${board.label}`)).toBeDefined();
    // The protocol carries one board per circuit, so the card stops offering it.
    expect(partCard(board)).toHaveProperty('disabled', true);
  });

  it('carries a part onto the canvas by drag and drop, landing where it was dropped', () => {
    render(<App />);
    const resistor = PART_DEFS.find((def) => def.type === 'resistor');
    if (!resistor) throw new Error('fixture: no resistor in the catalog');

    // A minimal DataTransfer: jsdom does not implement one.
    const store = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => void store.set(type, value),
      getData: (type: string) => store.get(type) ?? '',
      get types() {
        return [...store.keys()];
      },
      effectAllowed: 'none',
      dropEffect: 'none',
    };

    fireEvent.dragStart(partCard(resistor), { dataTransfer });
    expect(store.get(PART_DRAG_TYPE)).toBe('resistor');

    const canvas = document.querySelector('.quest-canvas');
    if (!canvas) throw new Error('fixture: no canvas');
    fireEvent.dragOver(canvas, { dataTransfer });
    fireEvent.drop(canvas, { dataTransfer, clientX: 420, clientY: 300 });

    expect(screen.getByTitle(`resistor-1 — ${resistor.label}`)).toBeDefined();
  });
});

describe('simulation session locks the workspace', () => {
  /** A supply and a resistor, wired in a loop with a ground reference set. */
  function buildValidCircuit(): void {
    const store = useStore.getState();
    store.addComponent(partLibrary.get('dc-supply'), { x: 0, y: 0 });
    store.addComponent(partLibrary.get('resistor'), { x: 200, y: 0 });

    const [supplyId, resistorId] = Object.keys(useStore.getState().snapshot.components);
    if (!supplyId || !resistorId) throw new Error('fixture: components missing');

    store.addWire(pinRef(supplyId, 'pos'), pinRef(resistorId, 'a'));
    store.addWire(pinRef(resistorId, 'b'), pinRef(supplyId, 'neg'));
    store.setGround(pinRef(supplyId, 'neg'));
  }

  it('refuses to start without a ground reference', async () => {
    useStore.getState().addComponent(partLibrary.get('resistor'), { x: 0, y: 0 });
    await useStore.getState().startSimulation();

    expect(useStore.getState().mode).toBe('edit');
    expect(useStore.getState().toasts.some((t) => /ground|failing/i.test(t.text))).toBe(true);
  });

  it('refuses to start on an empty canvas', async () => {
    await useStore.getState().startSimulation();
    expect(useStore.getState().mode).toBe('edit');
  });

  it('starts on a valid circuit and pins the electrical hash', async () => {
    buildValidCircuit();
    await useStore.getState().startSimulation();

    const state = useStore.getState();
    expect(state.mode).toBe('simulate');
    expect(state.simulatingHash).toMatch(/^[0-9a-f]{64}$/);
    expect(state.simulatingHash).toBe(await electricalHash(state.snapshot));
  });

  it('blocks every circuit change while the session runs', async () => {
    buildValidCircuit();
    await useStore.getState().startSimulation();

    const before = structuredClone(useStore.getState().snapshot);
    const [supplyId, resistorId] = Object.keys(before.components);
    if (!supplyId || !resistorId) throw new Error('fixture: components missing');
    const wireId = Object.keys(before.wires)[0];
    if (!wireId) throw new Error('fixture: wire missing');

    const store = useStore.getState();
    store.addComponent(partLibrary.get('led-5mm'), { x: 400, y: 0 });
    store.removeComponent(resistorId);
    store.moveComponent(resistorId, { x: 999, y: 999 });
    store.setParam(resistorId, 'resistance', 1000);
    store.setLabel(resistorId, 'RENAMED');
    store.addWire(pinRef(supplyId, 'pos'), pinRef(resistorId, 'b'));
    store.removeWire(wireId);
    store.setGround(pinRef(resistorId, 'a'));
    store.setMeta({ name: 'changed' });
    store.loadSnapshot(emptySnapshot('replaced'));

    // Not one of those got through.
    expect(useStore.getState().snapshot).toEqual(before);
    expect(useStore.getState().mode).toBe('simulate');
  });

  it('unlocks again on stop', async () => {
    buildValidCircuit();
    await useStore.getState().startSimulation();
    useStore.getState().stopSimulation();

    expect(useStore.getState().mode).toBe('edit');
    expect(useStore.getState().simulatingHash).toBeUndefined();

    const count = Object.keys(useStore.getState().snapshot.components).length;
    useStore.getState().addComponent(partLibrary.get('led-5mm'), { x: 0, y: 0 });
    expect(Object.keys(useStore.getState().snapshot.components)).toHaveLength(count + 1);
  });

  it('shows the banner while a session runs', async () => {
    buildValidCircuit();
    await useStore.getState().startSimulation();
    render(<App />);

    expect(screen.getByText(/circuit locked/i)).toBeDefined();
    // The top bar's own simulate/stop controls are gone; the banner is the
    // only way out now.
    expect(screen.getAllByRole('button', { name: /Stop session/ })).toHaveLength(1);
  });

  it('collapses repeated refusals into one message', async () => {
    buildValidCircuit();
    await useStore.getState().startSimulation();
    useStore.setState({ toasts: [] });

    const store = useStore.getState();
    store.setMeta({ name: 'a' });
    store.setMeta({ name: 'b' });
    store.setMeta({ name: 'c' });

    const refusals = useStore.getState().toasts.filter((t) => t.text === LOCKED_MESSAGE);
    expect(refusals).toHaveLength(1);
  });
});
