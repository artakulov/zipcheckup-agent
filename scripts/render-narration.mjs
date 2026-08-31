#!/usr/bin/env node
// Render the video's audio and bookend footage through HeyGen's MCP server.
//
// All three segments are rendered as avatar video. The middle is used for its
// AUDIO only, laid over the screen recording, with the avatar on camera just
// for the opening and the close.
//
// The obvious saving - render the middle through create_speech - is not
// available: measured 2026-08-30, create_speech is billed to the prepaid API
// wallet, while avatar video is billed to the subscription plan. With an empty
// wallet the plan is the only route, so the middle costs full avatar rate
// (~40 plan credits per minute of output).
//
//   node scripts/render-narration.mjs
//
// Writes tmp/avatar/{open,close}.mp4 and tmp/avatar/middle.mp3.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tmp', 'avatar');
mkdirSync(OUT, { recursive: true });

const AVATAR_ID = '6f24ccb506e141b49e700536710cc811'; // Artem Akulov - office 1
const VOICE_ID = '2a7698d055ba488cb79bd391430e28c5'; // his cloned voice

const mcp = (tool, args) => {
  const out = execFileSync('node', [join(ROOT, 'scripts', 'heygen-mcp.mjs'), 'call', tool, JSON.stringify(args)], {
    cwd: ROOT,
    maxBuffer: 1e8,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).toString();
  const parsed = JSON.parse(out);
  if (parsed.isError) throw new Error(out.slice(0, 500));
  return JSON.parse(parsed.content[0].text);
};

// Narration lives in docs/DEMO.md as a blockquote so the script and the
// document can never drift apart.
const md = readFileSync(join(ROOT, 'docs', 'DEMO.md'), 'utf8');
const quoted = md
  .slice(md.indexOf('> '), md.indexOf('## Screen recording beats'))
  .split('\n')
  .filter((l) => l.trim().startsWith('>'))
  .map((l) => l.replace(/^\s*>\s?/, '').trim())
  .filter(Boolean);

const open = quoted[0];
const close = quoted[quoted.length - 1];
const middle = quoted.slice(1, -1).join('\n\n');

writeFileSync(join(OUT, 'narration-middle.txt'), middle);
process.stderr.write(
  `open: ${open.split(/\s+/).length}w · middle: ${middle.split(/\s+/).length}w · close: ${close.split(/\s+/).length}w\n\n`,
);

const jobs = [
  ['middle', () => mcp('create_video_from_avatar', {
    avatarId: AVATAR_ID, voiceId: VOICE_ID, script: middle,
    title: 'zipcheckup-agent demo - middle narration', aspectRatio: '16:9', resolution: '1080p',
  })],
  ['open', () => mcp('create_video_from_avatar', {
    avatarId: AVATAR_ID, voiceId: VOICE_ID, script: open,
    title: 'zipcheckup-agent demo - opening', aspectRatio: '16:9', resolution: '1080p',
  })],
  ['close', () => mcp('create_video_from_avatar', {
    avatarId: AVATAR_ID, voiceId: VOICE_ID, script: close,
    title: 'zipcheckup-agent demo - closing', aspectRatio: '16:9', resolution: '1080p',
  })],
];

const videos = {};
for (const [name, run] of jobs) {
  const r = run();
  videos[name] = r.video_id;
  process.stderr.write(`${name}: queued ${r.video_id}\n`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [name, id] of Object.entries(videos)) {
  process.stderr.write(`waiting for ${name} (${id})\n`);
  for (let i = 0; i < 80; i += 1) {
    await sleep(15000);
    const v = mcp('get_video', { videoId: id });
    process.stderr.write(`  ${(i + 1) * 15}s ${v.status}\n`);
    if (v.status === 'completed') {
      const res = await fetch(v.video_url);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(join(OUT, `${name}.mp4`), buf);
      process.stderr.write(`  saved ${name}.mp4 (${(buf.length / 1e6).toFixed(1)} MB, ${v.duration?.toFixed?.(1)}s)\n`);
      break;
    }
    if (v.status === 'failed') throw new Error(`${name} failed: ${v.failure_message}`);
  }
}

const user = mcp('get_current_user', {});
process.stderr.write(`\ncredits remaining: ${user.subscription.credits.premium_credits.remaining}\n`);
