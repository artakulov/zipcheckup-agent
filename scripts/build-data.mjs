#!/usr/bin/env node
// Turn the ZipCheckup Open Data zip-summary CSV into static artifacts a page can
// query without a backend, a key or a rate limit.
//
// Two rules govern this file:
//   1. Parse by RFC4180, never split(','). 2,158 rows carry quoted fields with
//      embedded commas; a naive split shifts every later column and silently
//      produces wrong health data.
//   2. An empty cell is dropped, never written as 0/false/"". Absence must stay
//      distinguishable from a measured zero all the way to the agent.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, rowToObject } from './lib/csv.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'zip-summary.csv');
const OUT = join(ROOT, 'web', 'data');
const SOURCE_URL =
  'https://zipcheckup-open-data.s3.us-west-2.amazonaws.com/data/zip-summary/csv/zipcheckup-environmental-safety-data.csv';

const EXPECTED_COLUMNS = 25;

// Columns we are willing to ship. A column not listed here never reaches the
// product, however tempting: we only expose fields whose coverage we measured
// and whose semantics we can state. See docs/DATA.md.
const SHIPPED = [
  'zip', 'city', 'state', 'system_name', 'pwsid', 'population', 'water_source',
  'total_violations', 'health_violations', 'unresolved_violations',
  'lead_level_mg_l', 'copper_action_level_exceedance', 'radon_zone',
  'home_safety_score', 'home_safety_grade', 'latitude', 'longitude',
  'contaminant_count', 'health_contaminant_names',
  'enforcement_action_count', 'enforcement_health_violations',
  'has_active_issues', 'boil_water_advisories',
];

async function fetchSource() {
  process.stderr.write(`fetching ${SOURCE_URL}\n`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`source fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, text);
  return {
    text,
    etag: (res.headers.get('etag') ?? '').replace(/"/g, ''),
    lastModified: res.headers.get('last-modified') ?? null,
    bytes: Buffer.byteLength(text),
  };
}

async function loadSource({ offline }) {
  if (offline && existsSync(CACHE)) {
    const text = readFileSync(CACHE, 'utf8');
    process.stderr.write('using cached CSV (--offline)\n');
    return { text, etag: null, lastModified: null, bytes: Buffer.byteLength(text) };
  }
  return fetchSource();
}

/** Fail the build on exactly the corruptions a column shift produces. */
function assertShape(header, rows) {
  const problems = [];
  if (header.length !== EXPECTED_COLUMNS) {
    problems.push(`header has ${header.length} columns, expected ${EXPECTED_COLUMNS}`);
  }
  const col = (name) => header.indexOf(name);
  const checks = [
    ['state', col('state'), /^[A-Z]{2}$/],
    ['home_safety_grade', col('home_safety_grade'), /^[A-F]$/],
    ['radon_zone', col('radon_zone'), /^[123]$/],
    ['has_active_issues', col('has_active_issues'), /^(true|false)$/],
    ['zip', col('zip'), /^[0-9]{5}$/],
  ];

  let wrongWidth = 0;
  const badValues = [];
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    if (row.length !== EXPECTED_COLUMNS) {
      wrongWidth += 1;
      if (badValues.length < 5) badValues.push(`row ${r + 2}: ${row.length} fields`);
      continue;
    }
    for (const [name, idx, re] of checks) {
      const v = (row[idx] ?? '').trim();
      if (v !== '' && !re.test(v)) {
        if (badValues.length < 5) badValues.push(`row ${r + 2}: ${name}="${v}"`);
      }
    }
  }
  if (wrongWidth) problems.push(`${wrongWidth} rows do not have ${EXPECTED_COLUMNS} fields`);
  if (badValues.length) problems.push(`malformed values (first 5): ${badValues.join(' | ')}`);

  if (problems.length) {
    throw new Error(
      `SOURCE SHAPE ASSERTION FAILED - refusing to ship health data of unknown correctness:\n  - ${problems.join('\n  - ')}`,
    );
  }
}

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const text = JSON.stringify(value);
  writeFileSync(path, text);
  return { bytes: Buffer.byteLength(text), sha256: sha256(text) };
}

const num = (v) => (v === undefined || v === '' ? null : Number(v));

async function main() {
  const offline = process.argv.includes('--offline');
  const src = await loadSource({ offline });
  const { header, rows } = parseCsv(src.text);

  assertShape(header, rows);

  // Per-column fill counts. These are read by explain_metric at runtime, so the
  // coverage a user sees is generated from the data, never hand-typed.
  const fill = Object.fromEntries(header.map((h) => [h, 0]));
  const objects = [];
  for (const row of rows) {
    const obj = rowToObject(header, row);
    for (const k of Object.keys(obj)) fill[k] += 1;
    objects.push(obj);
  }

  const unshipped = header.filter((h) => !SHIPPED.includes(h));
  if (unshipped.length) process.stderr.write(`not shipped (not in allowlist): ${unshipped.join(', ')}\n`);

  // --- shards by ZIP3 -----------------------------------------------------
  rmSync(join(OUT, 'zips'), { recursive: true, force: true });
  const shards = new Map();
  for (const obj of objects) {
    const zip = obj.zip;
    if (!zip) continue;
    const key = zip.slice(0, 3);
    if (!shards.has(key)) shards.set(key, {});
    const record = {};
    for (const field of SHIPPED) {
      if (field === 'zip') continue;
      if (obj[field] !== undefined) record[field] = obj[field]; // empty cells stay absent
    }
    shards.get(key)[zip] = record;
  }

  let shardBytes = 0;
  for (const [key, value] of shards) {
    shardBytes += writeJson(join(OUT, 'zips', `${key}.json`), value).bytes;
  }

  // --- slim search index --------------------------------------------------
  const states = [...new Set(objects.map((o) => o.state).filter(Boolean))].sort();
  const stateIdx = new Map(states.map((s, i) => [s, i]));
  const index = objects
    .filter((o) => o.zip)
    .map((o) => [
      o.zip,
      o.state ? stateIdx.get(o.state) : null,
      num(o.home_safety_score),
      num(o.health_violations),
      num(o.unresolved_violations),
      num(o.lead_level_mg_l),
      num(o.radon_zone),
      o.has_active_issues === undefined ? null : o.has_active_issues === 'true',
      num(o.latitude),
      num(o.longitude),
    ]);
  const indexMeta = writeJson(join(OUT, 'index', 'search-index.json'), {
    fields: ['zip', 'state', 'home_safety_score', 'health_violations', 'unresolved_violations', 'lead_level_mg_l', 'radon_zone', 'has_active_issues', 'latitude', 'longitude'],
    states,
    note: 'null means the source has no value for this ZIP. It does not mean zero.',
    rows: index,
  });

  // --- provenance manifest ------------------------------------------------
  const build = {
    built_at: new Date().toISOString(),
    source: {
      url: SOURCE_URL,
      registry: 'https://registry.opendata.aws/zipcheckup-us-home-environmental-risk/',
      license: 'CC-BY-4.0',
      attribution: 'ZipCheckup Open Data',
      etag: src.etag,
      last_modified: src.lastModified,
      bytes: src.bytes,
      snapshot_date: '2026-08-19',
    },
    rows_total: objects.length,
    columns: header,
    shipped_columns: SHIPPED,
    withheld_columns: unshipped,
    coverage: Object.fromEntries(
      header.map((h) => [h, { rows_with_value: fill[h], pct: Number(((fill[h] / objects.length) * 100).toFixed(1)) }]),
    ),
    artifacts: {
      shards: { count: shards.size, bytes: shardBytes },
      search_index: indexMeta,
    },
    semantics:
      'A field absent from a ZIP record has no value in the source. It is not 0, not false, not "none" and not a finding of safety.',
  };
  writeJson(join(OUT, 'BUILD.json'), build);

  const zeroCoverage = header.filter((h) => fill[h] === 0);
  process.stderr.write(
    [
      `rows: ${objects.length}`,
      `shards: ${shards.size} (${(shardBytes / 1e6).toFixed(1)} MB)`,
      `search index: ${(indexMeta.bytes / 1e6).toFixed(1)} MB`,
      `columns empty for every row: ${zeroCoverage.length ? zeroCoverage.join(', ') : 'none'}`,
      '',
    ].join('\n'),
  );
}

main().catch((e) => {
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
});
