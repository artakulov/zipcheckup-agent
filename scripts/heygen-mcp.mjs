#!/usr/bin/env node
// Minimal MCP client for HeyGen's remote server, over streamable HTTP.
//
// Used instead of the host's MCP integration so a render can be driven from a
// script: authenticate once with scripts/heygen-auth.mjs, then call tools here.
// OAuth billing draws on the HeyGen subscription plan rather than the prepaid
// API wallet.
//
//   node scripts/heygen-mcp.mjs list
//   node scripts/heygen-mcp.mjs call <tool> '<json args>'

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT = 'https://mcp.heygen.com/mcp/v1/';

function token() {
  try {
    return JSON.parse(readFileSync(join(ROOT, '.cache', 'heygen-oauth.json'), 'utf8')).access_token;
  } catch {
    console.error('No token. Run: node scripts/heygen-auth.mjs');
    process.exit(1);
  }
}

let sessionId = null;
let id = 0;

async function rpc(method, params) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token()}`,
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: (id += 1), method, params }),
  });

  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;

  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);

  // Streamable HTTP may answer as a single JSON body or as an SSE stream.
  if (text.startsWith('event:') || text.includes('\ndata: ')) {
    const payloads = text
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => l.slice(6));
    for (const p of payloads.reverse()) {
      try {
        const msg = JSON.parse(p);
        if (msg.result || msg.error) return msg;
      } catch {
        /* keep looking */
      }
    }
    throw new Error(`no JSON-RPC result in stream: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

async function notify(method, params) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token()}`,
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method, params }) });
}

async function connect() {
  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'zipcheckup-agent', version: '0.1.0' },
  });
  if (init.error) throw new Error(JSON.stringify(init.error));
  await notify('notifications/initialized', {});
  return init.result;
}

const [, , cmd, toolName, argsJson] = process.argv;

const info = await connect();
process.stderr.write(`connected: ${info.serverInfo?.name} ${info.serverInfo?.version ?? ''}\n`);

if (cmd === 'list') {
  const r = await rpc('tools/list', {});
  if (r.error) throw new Error(JSON.stringify(r.error));
  for (const t of r.result.tools) {
    console.log(`\n## ${t.name}\n${t.description ?? ''}`);
    console.log(JSON.stringify(t.inputSchema, null, 2));
  }
} else if (cmd === 'call') {
  const r = await rpc('tools/call', { name: toolName, arguments: JSON.parse(argsJson ?? '{}') });
  console.log(JSON.stringify(r.result ?? r.error, null, 2));
} else {
  console.error('usage: heygen-mcp.mjs list | call <tool> \'<json>\'');
  process.exit(1);
}
