#!/usr/bin/env node
// Record the demo screen capture.
//
// Driven by a script rather than a human hand so any take can be reproduced
// exactly, and so the footage can be re-cut to fit a finished voice track
// without re-shooting. Runs against native WebMCP in Chrome, so the badge in
// frame says "native" rather than "polyfill".
//
//   node scripts/record-demo.mjs [url]
//
// Output: tmp/demo/*.webm  ->  convert and trim with ffmpeg.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tmp', 'demo');
const URL_ARG = process.argv[2] || 'https://artakulov.github.io/zipcheckup-agent/';

mkdirSync(OUT, { recursive: true });

// Record generously: the footage is cut to fit a finished voice track, so it is
// far cheaper to have too much than to re-shoot short.
const BEAT_SCALE = Number(process.env.BEAT_SCALE ?? 3);

const beat = async (page, label, ms) => {
  process.stderr.write(`  ${label}\n`);
  await page.waitForTimeout(Math.round(ms * BEAT_SCALE));
};

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-features=WebMCP', '--hide-scrollbars'] });
const context = await browser.newContext({
  viewport: { width: 1120, height: 820 },
  deviceScaleFactor: 2,
  recordVideo: { dir: OUT, size: { width: 1120, height: 820 } },
  colorScheme: 'dark',
});
const page = await context.newPage();

// Agent calls go through the tool objects directly, which is exactly what the
// browser does when an agent invokes them, so the activity log attributes them
// to the agent and the UI reacts the same way.
const agent = (fn, args) =>
  page.evaluate(
    async ({ fn, args }) => {
      const mod = await import('./tools/index.js');
      return mod[fn].execute(args);
    },
    { fn, args },
  );

await page.goto(URL_ARG, { waitUntil: 'networkidle' });
await page.waitForFunction(async () => (await document.modelContext?.getTools?.())?.length === 6, null, { timeout: 20000 });
await agent('updateShortlist', { action: 'clear' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

process.stderr.write('recording beats:\n');

await beat(page, 'hero and badge', 3500);

await page.getByRole('button', { name: /WebMCP/ }).scrollIntoViewIfNeeded();
await beat(page, 'registered tools', 3000);
await page.locator('#toollist').scrollIntoViewIfNeeded();
await beat(page, 'tool list read back from getTools()', 3500);

// A well-covered ZIP first, so the contrast lands.
await page.locator('#toolpick').scrollIntoViewIfNeeded();
await page.fill('[data-arg="zip"]', '90210');
await page.click('#run');
await beat(page, '90210: 11 of 14 known', 4500);

// Then the one that makes the point.
await page.fill('[data-arg="zip"]', '01004');
await page.click('#run');
await beat(page, '01004: 1 of 14 known, thirteen explicit unknowns', 6000);

// Shared state: the agent writes, the human watches.
await page.locator('#shortlist').scrollIntoViewIfNeeded();
await beat(page, 'shortlist empty', 1500);
await agent('updateShortlist', { action: 'add', zip: '48201', note: 'closest to the new office' });
await beat(page, 'agent adds 48201', 3000);
await agent('updateShortlist', { action: 'add', zip: '01002', note: 'second option' });
await beat(page, 'agent adds 01002', 3000);

// Search: the exclusion count is the honest headline.
await page.selectOption('#toolpick', 'zipcheckup_find_safer_zips');
await page.waitForTimeout(400);
await page.fill('[data-arg="state"]', 'MI');
await page.fill('[data-arg="max_lead_mg_l"]', '0.005');
await page.click('#run');
await beat(page, 'find_safer_zips over Michigan', 5000);

// The letter.
await agent('draftCivicLetter', { zip: '48201', concern: 'lead in the water at a house we are buying' });
await page.locator('#letter').scrollIntoViewIfNeeded();
await beat(page, 'letter: facts asserted vs questions asked', 6500);

await page.locator('#log').scrollIntoViewIfNeeded();
await beat(page, 'activity log, every call attributed', 4000);

await context.close();
await browser.close();
process.stderr.write(`\nvideo written to ${OUT}\n`);
