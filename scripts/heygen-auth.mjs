#!/usr/bin/env node
// One-time OAuth for the HeyGen MCP server.
//
// HeyGen's MCP endpoint authenticates only by OAuth, and OAuth usage bills to
// the account's subscription credits rather than the separate prepaid API
// wallet - which is the whole reason to go through MCP instead of the REST API.
//
// The device-code grant is not permitted for this client, so this runs the
// authorization-code + PKCE flow against the registered localhost redirect:
// the script listens, the person clicks Approve once in a browser where they
// are already signed in, and the token lands here.
//
//   node scripts/heygen-auth.mjs
//
// Token is written to .cache/heygen-oauth.json, which is gitignored.

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.cache', 'heygen-oauth.json');

const AS = 'https://api2.heygen.com';
const CLIENT_ID = process.env.HEYGEN_CLIENT_ID || 'an1xhCM552m7m1AuY7hLlwzM';
const REDIRECT = 'http://localhost:6274/oauth/callback';
const RESOURCE = 'https://mcp.heygen.com/mcp/v1';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash('sha256').update(verifier).digest());
const state = b64url(randomBytes(16));

const authUrl =
  `${AS}/v1/oauth/authorize?response_type=code&client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=${encodeURIComponent('openid profile email')}` +
  `&state=${state}&code_challenge=${challenge}&code_challenge_method=S256` +
  `&resource=${encodeURIComponent(RESOURCE)}`;

console.log('\nOpen this URL and approve:\n');
console.log(authUrl);
console.log('\nWaiting for the redirect on localhost:6274 …\n');

const code = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timed out after 10 minutes')), 600000);
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost:6274');
    if (!url.pathname.startsWith('/oauth/callback')) {
      res.writeHead(404).end('not here');
      return;
    }
    const got = url.searchParams.get('code');
    const err = url.searchParams.get('error');
    const gotState = url.searchParams.get('state');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><meta charset=utf-8><style>body{font:16px system-ui;padding:48px;max-width:34em}</style>` +
        (got ? '<h2>Authorized.</h2><p>You can close this tab.</p>' : `<h2>Authorization failed</h2><pre>${err ?? 'no code'}</pre>`),
    );
    clearTimeout(timer);
    server.close();
    if (err) reject(new Error(err));
    else if (gotState !== state) reject(new Error('state mismatch - possible interception, refusing the code'));
    else resolve(got);
  });
  server.listen(6274, '127.0.0.1');
});

const body = new URLSearchParams({
  grant_type: 'authorization_code',
  code,
  redirect_uri: REDIRECT,
  client_id: CLIENT_ID,
  code_verifier: verifier,
  resource: RESOURCE,
});

const res = await fetch(`${AS}/v1/oauth/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body,
});
const token = await res.json();
if (!res.ok || !token.access_token) {
  console.error('token exchange failed:', res.status, JSON.stringify(token));
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({ ...token, obtained_at: new Date().toISOString(), client_id: CLIENT_ID, resource: RESOURCE }, null, 2),
);
console.log(`token stored in .cache/heygen-oauth.json (expires_in ${token.expires_in ?? 'n/a'}s, scope "${token.scope ?? ''}")`);
