#!/usr/bin/env node
// Derive the screen-recording cue points from the rendered voice track.
//
// Each middle-narration paragraph gets a share of the measured audio length
// proportional to its word count. Editing the script therefore re-times the
// picture automatically: no hand-tuned constants to forget to update.
//
//   node scripts/plan-cues.mjs
//
// Writes tmp/demo/cue-plan.json, read by scripts/record-demo.mjs.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIDDLE = join(ROOT, 'tmp', 'avatar', 'middle.mp4');
const OUT = join(ROOT, 'tmp', 'demo');

// One label per middle paragraph, in order. These are the names the recorder
// schedules against; a paragraph added to the script needs a label here.
const LABELS = [
  'assistantGuesses',
  'sixTools',
  'unknownIsNotZero',
  'sharedState',
  'threeNumbers',
  'letter',
  'provenance',
];

if (!existsSync(MIDDLE)) {
  console.error('tmp/avatar/middle.mp4 is missing - run scripts/render-narration.mjs first');
  process.exit(1);
}

const duration = Number(
  execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', MIDDLE])
    .toString()
    .trim(),
);

const md = readFileSync(join(ROOT, 'docs', 'DEMO.md'), 'utf8');
const quoted = md
  .slice(md.indexOf('> '), md.indexOf('## Screen recording beats'))
  .split('\n')
  .filter((l) => l.trim().startsWith('>'))
  .map((l) => l.replace(/^\s*>\s?/, '').trim())
  .filter(Boolean);

const middle = quoted.slice(1, -1);
if (middle.length !== LABELS.length) {
  console.error(
    `script has ${middle.length} middle paragraphs but ${LABELS.length} labels are defined.\n` +
      'Add or remove a label in scripts/plan-cues.mjs so the recorder knows what to show.',
  );
  process.exit(1);
}

const words = middle.map((p) => p.split(/\s+/).length);
const total = words.reduce((a, b) => a + b, 0);

const cues = {};
let t = 0;
middle.forEach((p, i) => {
  cues[LABELS[i]] = Number(t.toFixed(2));
  const d = (words[i] / total) * duration;
  process.stderr.write(`${t.toFixed(1).padStart(6)}s  ${LABELS[i].padEnd(18)} ${p.slice(0, 58)}\n`);
  t += d;
});
cues.end = Number(duration.toFixed(2));

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'cue-plan.json'), JSON.stringify({ audio_seconds: duration, words: total, cues }, null, 2));
process.stderr.write(`\nwrote tmp/demo/cue-plan.json (${duration.toFixed(1)}s of narration, ${total} words)\n`);
