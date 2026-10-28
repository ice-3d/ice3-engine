import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
});

Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  HTMLCanvasElement: {
    configurable: true,
    value: dom.window.HTMLCanvasElement,
  },
  Element: { configurable: true, value: dom.window.Element },
  Event: { configurable: true, value: dom.window.Event },
  KeyboardEvent: {
    configurable: true,
    value: dom.window.KeyboardEvent,
  },
  MouseEvent: { configurable: true, value: dom.window.MouseEvent },
  getComputedStyle: {
    configurable: true,
    value: dom.window.getComputedStyle.bind(dom.window),
  },
  requestAnimationFrame: {
    configurable: true,
    value: dom.window.requestAnimationFrame.bind(dom.window),
  },
  cancelAnimationFrame: {
    configurable: true,
    value: dom.window.cancelAnimationFrame.bind(dom.window),
  },
});
