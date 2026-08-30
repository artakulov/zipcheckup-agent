#!/usr/bin/env node
// Record the demo screen capture, cut to the narration.
//
// The beats are absolute timestamps taken from the finished voice track, not
// arbitrary pauses: each paragraph of the middle narration gets a share of the
// 130.4s audio proportional to its word count, and the picture is scheduled to
// match. Driven by a script so a re-take reproduces exactly, and so a change to
// the narration can be re-synced without re-shooting anything by hand.
//
//   node scripts/record-demo.mjs [url]
//
// Output: tmp/demo/*.webm, consumed by scripts/assemble-video.mjs.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tmp', 'demo');
const URL_ARG = process.argv[2] || 'https://artakulov.github.io/zipcheckup-agent/';

mkdirSync(OUT, { recursive: true });

// Absolute cue points in the middle narration, in seconds, derived from word
// counts per paragraph against the measured 130.36s render.
const CUES = {
  problem: 0,
  emptyCell: 23.4,
  sixTools: 39.2,
  missingData: 54.6,
  sharedState: 75.8,
  letter: 97.0,
  oneMoreThing: 116.1,
  end: 130.4,
};

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-features=WebMCP', '--hide-scrollbars'] });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
  colorScheme: 'dark',
});
// Video capture begins when the context is created, so everything before the
// first cue - navigation, reload, style injection - is footage the assembler
// must skip. Record the offset rather than guessing it.
const recordStart = Date.now();
const page = await context.newPage();

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

// Applied AFTER the reload: a reload drops injected styles, which silently cost
// one take. The content column is 860px and would otherwise sit inside empty
// bands in a 1920 frame.
await page.addStyleTag({ content: 'html { zoom: 1.42; }' });
await page.waitForTimeout(1500);

const t0 = Date.now();
const at = async (cue) => {
  const wait = CUES[cue] * 1000 - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  process.stderr.write(`  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${cue}\n`);
};

process.stderr.write('recording, cued to the narration:\n');

// "Here's the problem... over a thousand ZIP codes listed with every field blank."
await at('problem');

// "An assistant reading a web page sees an empty table cell."
await at('emptyCell');
await page.locator('#toolpick').scrollIntoViewIfNeeded();
await page.fill('[data-arg="zip"]', '90210');
await page.click('#run');

// "WebMCP changes what gets exchanged. The page registers six tools."
await at('sixTools');
await page.locator('#toollist').scrollIntoViewIfNeeded();

// "Watch what happens when data is missing. This ZIP has one known metric out of fourteen."
await at('missingData');
await page.locator('#toolpick').scrollIntoViewIfNeeded();
await page.fill('[data-arg="zip"]', '01004');
await page.click('#run');

// "The shortlist is shared state... the row appears while I watch."
await at('sharedState');
await page.locator('#shortlist').scrollIntoViewIfNeeded();
await page.waitForTimeout(3000);
await agent('updateShortlist', { action: 'add', zip: '48201', note: 'closest to the new office' });
await page.waitForTimeout(6000);
await agent('updateShortlist', { action: 'add', zip: '01002', note: 'second option' });
await page.waitForTimeout(5000);
await page.locator('#log').scrollIntoViewIfNeeded();

// "Finally, the agent drafts a letter to the water system."
await at('letter');
await agent('draftCivicLetter', { zip: '48201', concern: 'lead in the water at a house we are buying' });
await page.waitForTimeout(1200);
await page.locator('#letter').scrollIntoViewIfNeeded();

// "An agent found a mistake we hadn't: our lead figure is not the ninety
//  percentile sample it looks like."
await at('oneMoreThing');
await page.locator('#toolpick').scrollIntoViewIfNeeded();
await page.selectOption('#toolpick', 'zipcheckup_explain_metric');
await page.waitForTimeout(600);
await page.fill('[data-arg="metric"]', 'lead_level_mg_l');
await page.click('#run');
await page.waitForTimeout(2000);
await page.locator('.jsonwrap summary').click();

// Tail, so the assembler always has picture to spare.
await at('end');
await page.waitForTimeout(8000);

writeFileSync(join(OUT, 'cues.json'), JSON.stringify({
  offset_seconds: Number(((t0 - recordStart) / 1000).toFixed(2)),
  cues: CUES,
  recorded_at: new Date().toISOString(),
  url: URL_ARG,
}, null, 2));

await context.close();
await browser.close();
process.stderr.write(`\nvideo written to ${OUT}\n`);
