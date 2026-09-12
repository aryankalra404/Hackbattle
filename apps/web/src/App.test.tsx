// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { emptySnapshot, pinRef } from '@circuitgit/schema';
import { electricalHash } from '@circuitgit/core';
import { App } from './App.js';
import { partLibrary, config } from './state/library.js';
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
    paletteOpen: true,
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
  it('renders the palette from the part library', () => {
    render(<App />);
    // Every part in the library is offered in the palette.
    for (const part of partLibrary.all()) {
      expect(screen.getAllByText(part.name).length, `${part.id} missing`).toBeGreaterThan(0);
    }
  });

  it('groups the palette by the category declared in each part file', () => {
    render(<App />);
    for (const group of partLibrary.categories()) {
      expect(screen.getAllByText(group.category).length).toBeGreaterThan(0);
    }
  });

  it('shows the branch, the product name and the empty-canvas hint', () => {
    render(<App />);
    expect(screen.getByText(config.product.name)).toBeDefined();
    // The branch name appears in the switcher and the status bar.
    expect(screen.getAllByText(config.versionControl.defaultBranch).length).toBeGreaterThan(0);
    expect(screen.getByText(/Drag a part from the left/)).toBeDefined();
  });

  it('adds a part when its palette chip is clicked, and runs checks on it', () => {
    render(<App />);
    const before = Object.keys(useStore.getState().snapshot.components).length;

    const chip = screen.getByTitle(new RegExp(partLibrary.get('resistor').description, 'i'));
    fireEvent.click(chip);

    const state = useStore.getState();
    expect(Object.keys(state.snapshot.components)).toHaveLength(before + 1);

    // A lone part with nothing wired to it must produce findings, not silence.
    expect(state.findings.length).toBeGreaterThan(0);
    expect(state.findings.some((f) => f.kind === 'unconnected_required_pin')).toBe(true);
  });

  it('generates inspector controls from the part params schema', () => {
    render(<App />);
    fireEvent.click(screen.getByTitle(new RegExp(partLibrary.get('resistor').description, 'i')));

    // The resistor declares one number param; the label comes from the data file.
    const resistor = partLibrary.get('resistor');
    const param = resistor.params['resistance'];
    if (!param) throw new Error('fixture: resistor has no resistance param');
    expect(screen.getByText(param.label)).toBeDefined();
  });

  it('never claims simulation or LLM checks passed', () => {
    render(<App />);
    fireEvent.click(screen.getByTitle(new RegExp(partLibrary.get('resistor').description, 'i')));
    fireEvent.click(screen.getByRole('button', { name: /Commit/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/sim pending/)).toBeDefined();
    expect(within(dialog).getByText(/llm unavailable/)).toBeDefined();
  });

  it('collapses and reopens the parts panel', () => {
    render(<App />);
    const resistor = partLibrary.get('resistor');

    // Expanded: the search box and the part chips are present.
    expect(screen.getByPlaceholderText(/Search parts/)).toBeDefined();
    expect(screen.getAllByText(resistor.name).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTitle('Hide the parts panel'));
    expect(useStore.getState().paletteOpen).toBe(false);
    expect(screen.queryByPlaceholderText(/Search parts/)).toBeNull();
    expect(screen.queryByText(resistor.name)).toBeNull();

    // Collapsed: a rail is left behind to bring it back.
    fireEvent.click(screen.getByTitle('Show the parts panel'));
    expect(useStore.getState().paletteOpen).toBe(true);
    expect(screen.getByPlaceholderText(/Search parts/)).toBeDefined();
  });

  it('switches to the history view', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /History/ }));
    expect(screen.getByText(/No commits yet/)).toBeDefined();
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

  it('shows the banner and disables the palette in the UI', async () => {
    buildValidCircuit();
    await useStore.getState().startSimulation();
    render(<App />);

    expect(screen.getByText(/circuit locked/i)).toBeDefined();
    // Two ways out: the top bar and the banner.
    expect(screen.getAllByRole('button', { name: /Stop session/ })).toHaveLength(2);

    // Palette chips are disabled rather than merely dimmed.
    const chip = screen.getByTitle(new RegExp(partLibrary.get('resistor').description, 'i'));
    expect(chip).toHaveProperty('disabled', true);
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
