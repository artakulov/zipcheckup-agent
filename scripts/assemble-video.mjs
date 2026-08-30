#!/usr/bin/env node
// Cut the submission video.
//
// Three sources, one output:
//   tmp/avatar/open.mp4    avatar on camera, its own audio
//   tmp/demo/*.webm        scripted screen recording, silent
//   tmp/avatar/middle.mp4  avatar render used for its AUDIO only
//   tmp/avatar/close.mp4   avatar on camera, its own audio
//
// The screen recording is trimmed to the exact length of the middle narration,
// so the picture follows the finished voice track rather than the other way
// round. Re-running this after a new take needs no re-recording of either side.
//
//   node scripts/assemble-video.mjs

import { execFileSync } from 'node:child_process';
import { readdirSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AV = join(ROOT, 'tmp', 'avatar');
const DEMO = join(ROOT, 'tmp', 'demo');
const OUT = join(ROOT, 'tmp', 'out');
mkdirSync(OUT, { recursive: true });

const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
const probe = (f) =>
  Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f])
      .toString()
      .trim(),
  );

const screen = join(DEMO, readdirSync(DEMO).find((f) => f.endsWith('.webm')));
// Capture starts before the first narration cue; skip that lead-in rather than
// trimming from frame zero, which would put the whole picture out of sync.
const cues = existsSync(join(DEMO, 'cues.json'))
  ? JSON.parse(readFileSync(join(DEMO, 'cues.json'), 'utf8'))
  : { offset_seconds: 0 };
const OFFSET = cues.offset_seconds ?? 0;
for (const f of ['open.mp4', 'middle.mp4', 'close.mp4']) {
  if (!existsSync(join(AV, f))) throw new Error(`missing ${f} - run scripts/render-narration.mjs`);
}

const dOpen = probe(join(AV, 'open.mp4'));
const dMiddle = probe(join(AV, 'middle.mp4'));
const dClose = probe(join(AV, 'close.mp4'));
const dScreen = probe(screen);

console.error(`open ${dOpen.toFixed(1)}s · middle ${dMiddle.toFixed(1)}s · close ${dClose.toFixed(1)}s · screen ${dScreen.toFixed(1)}s (lead-in ${OFFSET}s)`);
if (dScreen - OFFSET < dMiddle) {
  console.error(`WARNING: usable screen footage is ${(dMiddle - (dScreen - OFFSET)).toFixed(1)}s short; its last frame will hold.`);
}

const V = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', '30'];
const A = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'];
const norm = ['-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0f1216,fps=30'];

// 1. Bookends, normalised so the concat has one consistent stream format.
ff(['-i', join(AV, 'open.mp4'), ...norm, ...V, ...A, join(OUT, 's1.mp4')]);
ff(['-i', join(AV, 'close.mp4'), ...norm, ...V, ...A, join(OUT, 's3.mp4')]);

// 2. Middle: screen picture, narration audio, cut to the audio's length.
//    -shortest would cut to whichever ends first; the audio is the master here,
//    so the video is padded by holding its final frame if it runs out.
ff([
  '-ss', String(OFFSET),
  '-i', screen,
  '-i', join(AV, 'middle.mp4'),
  '-map', '0:v:0', '-map', '1:a:0',
  '-t', String(dMiddle),
  '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0f1216,fps=30,tpad=stop_mode=clone:stop_duration=30',
  ...V, ...A,
  join(OUT, 's2.mp4'),
]);

// 3. Concat.
const list = join(OUT, 'concat.txt');
execFileSync('sh', ['-c', `printf "file '%s'\\nfile '%s'\\nfile '%s'\\n" "${join(OUT, 's1.mp4')}" "${join(OUT, 's2.mp4')}" "${join(OUT, 's3.mp4')}" > "${list}"`]);
ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', join(OUT, 'zipcheckup-agent-demo.mp4')]);

const final = join(OUT, 'zipcheckup-agent-demo.mp4');
const dFinal = probe(final);
const mins = Math.floor(dFinal / 60);
const secs = Math.round(dFinal % 60);
console.error(`\nfinal: ${final}`);
console.error(`length: ${mins}:${String(secs).padStart(2, '0')} (limit 3:00)`);
if (dFinal >= 180) {
  console.error('OVER THE LIMIT - the rules cap the demo at three minutes.');
  process.exit(1);
}
