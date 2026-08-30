// WebMCP wiring: detect -> polyfill -> register -> read back -> badge.
//
// Spec notes that this file exists to respect (all verified 2026-08-30):
//   * The entry point is document.modelContext. navigator.modelContext is a
//     deprecated alias kept for migration; do not target it.
//   * getTools() is ASYNC. Await it.
//   * getTools() returns inputSchema as a JSON STRING on Chrome 149-153 and as
//     an object from 154+. Branch on typeof.
//   * RegisteredTool.title defaults to "" (not undefined), so use `||`, not `??`.
//   * unregisterTool() was REMOVED from the spec on 2026-04-23. Cancellation is
//     via the AbortSignal passed to registerTool.
//   * executeTool() is a non-standard Chromium extension taking a RegisteredTool
//     object and a JSON *string*. Never build required behaviour on it.

const POLYFILL_SRC = './vendor/webmcp-polyfill.iife.js';

let controller = null;
let listeners = [];

export function onStatus(fn) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

function emit(status) {
  for (const fn of listeners) fn(status);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(el);
  });
}

/** True when document.modelContext came from the vendored polyfill, not the browser. */
function isPolyfilled() {
  const mc = document.modelContext;
  return Boolean(mc && (mc.__isWebMCPPolyfill || mc.constructor?.name === 'PolyfillModelContext'));
}

export async function ensureModelContext() {
  const force = new URLSearchParams(location.search).has('polyfill');
  if (!('modelContext' in document) || force) {
    window.__webMCPPolyfillOptions = { installTestingShim: true };
    await loadScript(POLYFILL_SRC);
  }
  if (!document.modelContext) throw new Error('no document.modelContext after polyfill load');
  return { polyfilled: isPolyfilled() };
}

/**
 * Register every descriptor under one page-level AbortController.
 * Returns the tools as READ BACK from getTools(), which is proof of registration
 * rather than our own claim of it.
 */
export async function registerAll(descriptors) {
  const { polyfilled } = await ensureModelContext();

  controller?.abort();
  controller = new AbortController();

  for (const d of descriptors) {
    await document.modelContext.registerTool(d, { signal: controller.signal });
  }

  document.modelContext.addEventListener?.('toolchange', refreshStatus);

  const status = await refreshStatus(polyfilled);
  return status;
}

/** Revoke every registered tool. The correct demonstration now that unregisterTool is gone. */
export function revokeAll() {
  controller?.abort();
  controller = null;
  return refreshStatus();
}

export async function readTools() {
  if (!document.modelContext?.getTools) return [];
  const tools = await document.modelContext.getTools();
  return tools.map((t) => ({
    name: t.name,
    // title defaults to "" - `??` would not fall through here.
    title: t.title || t.name,
    description: t.description,
    // string on Chrome 149-153, object from 154+
    inputSchema: typeof t.inputSchema === 'string' ? safeParse(t.inputSchema) : t.inputSchema,
    annotations: t.annotations ?? null,
  }));
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return { _unparsed: s };
  }
}

export async function refreshStatus(polyfilledHint) {
  const polyfilled = polyfilledHint ?? isPolyfilled();
  let tools = [];
  let error = null;
  try {
    tools = await readTools();
  } catch (e) {
    error = String(e);
  }
  const status = {
    available: Boolean(document.modelContext),
    polyfilled,
    mode: !document.modelContext ? 'unavailable' : polyfilled ? 'polyfill' : 'native',
    count: tools.length,
    tools,
    error,
    inIframe: window.top !== window.self,
    executeToolAvailable: typeof document.modelContext?.executeTool === 'function',
  };
  emit(status);
  return status;
}
