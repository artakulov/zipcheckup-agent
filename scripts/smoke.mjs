// Smoke test: load a URL in real Chromium, assert WebMCP registration actually
// happened, then call every registered tool through the page and check the
// absence-is-not-zero invariants on the real payload.
//
//   node scripts/smoke.mjs                       -> against a local server
//   node scripts/smoke.mjs https://example.pages.dev  -> against production

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const target = process.argv[2];
const BANNED = ['no violations', 'none found', 'all clear'];

let server = null;
let base = target;

if (!base) {
  server = spawn('npx', ['--yes', 'serve', 'web', '-l', '4173', '--no-clipboard'], { stdio: 'ignore' });
  base = 'http://localhost:4173';
  await new Promise((r) => setTimeout(r, 2500));
}

const fails = [];
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) fails.push(msg);
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e.message}`));

try {
  const res = await page.goto(base, { waitUntil: 'networkidle' });
  ok(res?.status() === 200, `GET ${base} -> ${res?.status()}`);

  await page.waitForFunction(() => Boolean(document.modelContext), null, { timeout: 10000 });
  ok(true, 'document.modelContext exists (polyfill or native)');

  // getTools() is async, and inputSchema is a JSON string on Chrome 149-153.
  const tools = await page.evaluate(async () => {
    const list = await document.modelContext.getTools();
    return list.map((t) => ({
      name: t.name,
      title: t.title,
      hasDescription: Boolean(t.description),
      schemaType: typeof t.inputSchema,
      schema: typeof t.inputSchema === 'string' ? t.inputSchema : JSON.stringify(t.inputSchema),
    }));
  });

  ok(tools.length > 0, `getTools() returned ${tools.length} tool(s): ${tools.map((t) => t.name).join(', ')}`);
  for (const t of tools) {
    ok(t.hasDescription, `${t.name} has a description`);
    ok(Boolean(t.schema && JSON.parse(t.schema).type === 'object'), `${t.name} inputSchema is an object schema`);
  }

  // Badge must reflect reality, not a hardcoded string.
  const badge = await page.textContent('#badge');
  ok(/\d+ tool/.test(badge ?? ''), `badge reports a tool count: "${badge?.trim()}"`);

  // Invariants on real payloads.
  const cases = [
    ['48201', 'fully populated row'],
    ['01004', 'partial row'],
    ['00601', 'ZIP-only row'],
    ['99999', 'present but entirely empty row'],
    ['00000', 'absent from dataset'],
  ];
  for (const [zip, label] of cases) {
    const payload = await page.evaluate(async (z) => {
      const mod = await import('./tools/index.js');
      return mod.lookupZip.execute({ zip: z });
    }, zip);

    // Scan the DATA, not the meta fields whose whole job is to name the banned
    // phrases (agent_instructions, not_a_claim_of, unknown_reason, how_to_resolve).
    const META = new Set(['agent_instructions', 'not_a_claim_of', 'how_to_resolve', 'unknown_reason', 'qualifier_note']);
    const text = JSON.stringify(payload, (k, v) => (META.has(k) ? undefined : v)).toLowerCase();
    ok(!BANNED.some((b) => text.includes(b)), `${zip} (${label}): data carries no reassuring filler`);

    if (payload.ok) {
      const unknowns = Object.values(payload.metrics).filter((m) => m.status === 'unknown');
      ok(
        unknowns.every((m) => m.value === null && m.unknown_reason && m.not_a_claim_of),
        `${zip}: every unknown has value null + unknown_reason + not_a_claim_of (${unknowns.length} unknown)`,
      );
      ok(
        Object.values(payload.metrics).every((m) => m.status !== 'unknown' || m.value !== 0),
        `${zip}: no unknown metric was coerced to 0`,
      );
      ok(Boolean(payload.data_quality?.agent_instructions), `${zip}: data_quality carries agent_instructions`);
    } else {
      ok(Boolean(payload.error?.not_a_claim_of), `${zip}: absence carries not_a_claim_of`);
    }
  }

  // compare_zips: a ZIP with an unknown value must never be ranked.
  const cmp = await page.evaluate(async () => {
    const mod = await import('./tools/index.js');
    return mod.compareZips.execute({ zips: ['90210', '48201', '01004'] });
  });
  ok(cmp.ok === true, 'compare_zips returned ok');
  const lead = cmp.comparison.lead_level_mg_l;
  ok(!lead.comparable.includes('01004'), '01004 (lead unknown) is not in the ranked set');
  ok(lead.excluded_unknown.includes('01004'), '01004 is listed in excluded_unknown');
  ok(lead.best !== '01004' && lead.worst !== '01004', 'an unknown ZIP is never named best or worst');
  ok(Boolean(lead.caveat), 'a partial ranking carries a caveat naming the exclusion');
  const bwa = cmp.comparison.boil_water_advisories;
  ok(bwa.ranking === null && bwa.comparable.length === 0, 'the all-empty column produces no ranking at all');
  ok(cmp.comparison.radon_zone?.direction === 'higher_is_better', 'radon_zone ranks higher-is-better (zone 1 is worst)');

  // explain_metric: coverage must be generated, not hand-typed.
  const [expl, buildJson] = await Promise.all([
    page.evaluate(async () => {
      const mod = await import('./tools/index.js');
      return mod.explainMetric.execute({ metric: 'home_safety_score', zip: '01004' });
    }),
    page.evaluate(async () => (await fetch('./data/BUILD.json')).json()),
  ]);
  ok(
    expl.coverage_in_dataset.rows_with_value === buildJson.coverage.home_safety_score.rows_with_value,
    `explain_metric coverage comes from BUILD.json (${expl.coverage_in_dataset.rows_with_value} rows)`,
  );
  ok(expl.threshold?.status === 'not_applicable', 'the vendor composite ships with no statutory threshold');
  ok(expl.value_for_zip?.status === 'unknown', '01004 has no score, returned as unknown rather than 0');

  const leadExpl = await page.evaluate(async () => {
    const mod = await import('./tools/index.js');
    return mod.explainMetric.execute({ metric: 'lead_level_mg_l' });
  });
  ok(leadExpl.threshold?.value === 0.015 && Boolean(leadExpl.threshold.verified_by), 'the lead threshold carries a value and a source');

  // find_safer_zips: the exclusion count is the honest headline.
  const search = await page.evaluate(async () => {
    const mod = await import('./tools/index.js');
    return mod.findSaferZips.execute({ state: 'MI', min_safety_score: 80, limit: 5 });
  });
  ok(search.ok === true, 'find_safer_zips returned ok');
  ok(search.excluded.unknown_on_a_filtered_metric > 0, `${search.excluded.unknown_on_a_filtered_metric} ZIPs excluded for missing data, reported explicitly`);
  ok(
    search.matches.every((m) => m.metrics.home_safety_score?.status === 'known'),
    'every match has a KNOWN value on the filtered metric',
  );
  ok(Boolean(search.warning), 'the result warns that exclusion is a data gap, not a safety finding');

  // The shared-state claim: a tool call must change what the person sees.
  await page.evaluate(async () => {
    const mod = await import('./tools/index.js');
    await mod.updateShortlist.execute({ action: 'clear' });
  });
  const before = await page.locator('#shortlist li').count();
  const addResult = await page.evaluate(async () => {
    const mod = await import('./tools/index.js');
    return mod.updateShortlist.execute({ action: 'add', zip: '90210', note: 'from smoke test' });
  });
  await page.waitForTimeout(200);
  const row = page.locator('#shortlist li[data-zip="90210"]');
  ok(addResult.ok === true, 'update_shortlist add returned ok');
  ok((await row.count()) === 1, `agent write rendered a shortlist row the human can see (was ${before} rows)`);
  ok(
    (await row.textContent())?.includes('added by agent'),
    'the row is attributed to the agent, not the human',
  );
  ok(
    /\d+\/\d+ metrics known/.test((await row.textContent()) ?? ''),
    'the row states how much of its data is actually known',
  );
  ok(
    addResult.shortlist?.some((e) => e.zip === '90210'),
    'the tool returned the resulting shortlist so the agent knows the visible state',
  );

  // Revocation via AbortSignal, since unregisterTool was removed from the spec.
  await page.click('#revoke');
  await page.waitForTimeout(300);
  const after = await page.evaluate(async () => (await document.modelContext.getTools()).length);
  ok(after === 0, `revoke via AbortSignal drops registration to 0 (got ${after})`);
} finally {
  await browser.close();
  server?.kill();
}

console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
