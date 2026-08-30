#!/usr/bin/env node
// WebMCP -> MCP bridge.
//
// WebMCP tools live inside a browser tab. Agents that are not in a browser
// (Codex CLI, Claude Code, any stdio MCP client) cannot see them. This bridge
// opens the page in Chrome with native WebMCP enabled and re-exposes whatever
// document.modelContext.getTools() reports as a normal stdio MCP server, routing
// every call through document.modelContext.executeTool().
//
// It is deliberately a dumb proxy: it does not know any tool names. Whatever the
// page registers is what the agent sees, so this doubles as proof that the page's
// registration is real and agent-consumable.
//
//   node scripts/mcp-bridge.mjs [url]
//
// Notes measured on Chrome 152 (2026-08-30):
//   * getTools() is async and returns inputSchema as a JSON STRING (149-153).
//   * executeTool(tool, argsJsonString) returns a STRING.
//   * There is no unregisterTool(); it was removed from the spec.

import { chromium } from 'playwright';

const URL_ARG = process.argv[2] || process.env.WEBMCP_URL || 'https://artakulov.github.io/zipcheckup-agent/';
const log = (...a) => console.error('[bridge]', ...a);

let page = null;
let browser = null;

async function ensurePage() {
  if (page) return page;
  browser = await chromium.launch({ channel: 'chrome', args: ['--enable-features=WebMCP'] });
  page = await browser.newPage();
  await page.goto(URL_ARG, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(document.modelContext), null, { timeout: 15000 });
  // Give the page's own registerAll() a moment to finish.
  await page.waitForFunction(async () => (await document.modelContext.getTools()).length > 0, null, { timeout: 15000 });
  const native = await page.evaluate(() => !document.modelContext.__isWebMCPPolyfill);
  log(`page ready: ${URL_ARG} (${native ? 'native WebMCP' : 'polyfill'})`);
  return page;
}

async function listTools() {
  const p = await ensurePage();
  const raw = await p.evaluate(async () => {
    const tools = await document.modelContext.getTools();
    return tools.map((t) => ({
      name: t.name,
      title: t.title || t.name,
      description: t.description,
      // string on Chrome 149-153, object from 154+
      inputSchema: typeof t.inputSchema === 'string' ? t.inputSchema : JSON.stringify(t.inputSchema ?? {}),
      annotations: t.annotations ?? null,
    }));
  });
  return raw.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: safeParse(t.inputSchema) ?? { type: 'object', properties: {} },
    annotations: t.annotations ?? undefined,
  }));
}

async function callTool(name, args) {
  const p = await ensurePage();
  return p.evaluate(
    async ({ name, args }) => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find((t) => t.name === name);
      if (!tool) return { __bridge_error: `no registered tool named ${name}` };
      const out = await document.modelContext.executeTool(tool, JSON.stringify(args ?? {}));
      // executeTool returns a string; hand the raw text back and let the caller parse.
      return { __bridge_raw: typeof out === 'string' ? out : JSON.stringify(out) };
    },
    { name, args },
  );
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// --- minimal stdio JSON-RPC (MCP) ---------------------------------------

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'webmcp-bridge', version: '0.1.0' },
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return;
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: await listTools() });
    case 'tools/call': {
      const out = await callTool(params?.name, params?.arguments);
      if (out?.__bridge_error) return fail(id, -32602, out.__bridge_error);
      return reply(id, { content: [{ type: 'text', text: out.__bridge_raw }] });
    }
    case 'resources/list':
      return reply(id, { resources: [] });
    case 'prompts/list':
      return reply(id, { prompts: [] });
    default:
      if (id !== undefined) fail(id, -32601, `method not found: ${method}`);
  }
}

let buf = '';
let inFlight = 0;
let stdinEnded = false;

process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    inFlight += 1;
    try {
      await handle(msg);
    } catch (e) {
      log('handler error', e);
      if (msg.id !== undefined) fail(msg.id, -32603, String(e));
    } finally {
      inFlight -= 1;
      // stdin can close while a browser launch is still in flight; never exit
      // mid-request or the client sees a silent truncation instead of a result.
      if (stdinEnded && inFlight === 0) await shutdown();
    }
  }
});

const shutdown = async () => {
  await browser?.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('end', async () => {
  stdinEnded = true;
  if (inFlight === 0) await shutdown();
});
