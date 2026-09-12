/**
 * jsdom polyfills for the component tests.
 *
 * React Flow measures its container, and jsdom implements neither
 * ResizeObserver nor DOMMatrix. These are test-environment shims only; the real
 * browser supplies both.
 */

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!('ResizeObserver' in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

if (!('DOMMatrixReadOnly' in globalThis)) {
  class DOMMatrixReadOnlyStub {
    readonly m22 = 1;
    constructor(readonly transform?: string) {}
  }
  (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly = DOMMatrixReadOnlyStub;
}

if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

if (!globalThis.matchMedia) {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof globalThis.matchMedia;
}
