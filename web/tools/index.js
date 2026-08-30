// Day 0: one tool, to prove the registration and invocation path end to end.
// Tools 2-6 land on Days 1-3 per the plan.

import { known, unknown, dataQuality, provenance } from '../lib/envelope.js';

let fixture = null;

async function loadFixture() {
  if (!fixture) {
    const res = await fetch('./data/day0-fixture.json');
    fixture = await res.json();
  }
  return fixture;
}

// Metric-by-metric semantics. Anything not listed here does not ship.
const METRICS = [
  ['total_violations', { unit: 'count', parse: Number }],
  ['health_violations', { unit: 'count', parse: Number }],
  ['unresolved_violations', { unit: 'count', parse: Number }],
  [
    'lead_level_mg_l',
    {
      unit: 'mg/L',
      parse: Number,
      threshold: {
        name: 'EPA lead action level',
        value: 0.015,
        unit: 'mg/L',
        citation: '40 CFR 141.80(c)(1)',
      },
      // A laboratory cannot report a true zero; 0 means "below the detection limit".
      qualifyZero: {
        qualifier: 'reported_as_zero_non_detect',
        note: 'A reported 0 means the result was below the laboratory detection limit. It is not a measurement of "no lead".',
      },
    },
  ],
  ['radon_zone', { unit: 'EPA radon zone (1 highest, 3 lowest)', parse: Number }],
  ['home_safety_score', { unit: 'index 0-100', parse: Number }],
  ['home_safety_grade', { unit: 'letter grade A-F' }],
  ['contaminant_count', { unit: 'count', parse: Number }],
  ['enforcement_action_count', { unit: 'count', parse: Number }],
  ['enforcement_health_violations', { unit: 'count', parse: Number }],
  ['has_active_issues', { unit: 'boolean', parse: (v) => v === 'true' }],
  [
    'boil_water_advisories',
    {
      unit: 'count',
      parse: Number,
      absentReason:
        'this column is present in the source schema but empty for all 42,679 rows of the 2026-08-19 snapshot',
    },
  ],
  [
    'copper_action_level_exceedance',
    {
      unit: 'boolean',
      parse: (v) => v === 'true',
      absentReason:
        'the source records only positive exceedances (3.1% of rows); a blank distinguishes neither "no exceedance" nor "not tested"',
    },
  ],
];

function buildMetrics(row) {
  const out = {};
  for (const [key, spec] of METRICS) {
    const raw = row?.[key];
    if (raw === undefined || raw === '') {
      out[key] = unknown(key, spec.absentReason ?? 'no value for this ZIP in the source snapshot');
      continue;
    }
    const value = spec.parse ? spec.parse(raw) : raw;
    const opts = { unit: spec.unit, threshold: spec.threshold ?? null };
    if (spec.qualifyZero && value === 0) {
      opts.qualifier = spec.qualifyZero.qualifier;
      opts.qualifierNote = spec.qualifyZero.note;
    }
    out[key] = known(key, value, opts);
  }
  return out;
}

export const lookupZip = {
  name: 'zipcheckup_lookup_zip',
  title: 'Look up environmental risk for a US ZIP code',
  description:
    'Return every environmental-safety metric ZipCheckup holds for one US ZIP code - drinking-water violations, lead level, EPA radon zone, enforcement actions and safety score - each with its source, measurement date and legal threshold. Metrics missing from the source are returned as status:"unknown" with a machine-readable reason. Unknown is NEVER zero and never means safe: do not describe an unknown metric as "no violations", "clean", "none" or "0". A ZIP absent from the dataset is likewise not a claim of safety.',
  inputSchema: {
    type: 'object',
    properties: {
      zip: {
        type: 'string',
        description: '5-digit US ZIP code including leading zeros, for example "01004" or "48201".',
      },
    },
    required: ['zip'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  async execute({ zip }) {
    const data = await loadFixture();
    const row = data.zips[String(zip).trim()];

    if (!row) {
      return {
        ok: false,
        error: {
          code: 'zip_not_in_dataset',
          zip,
          message: `ZIP ${zip} has no row in this snapshot.`,
          not_a_claim_of: 'that this ZIP is safe, unmonitored, or free of violations',
          suggestion: 'Try a neighbouring ZIP.',
        },
        provenance: provenance(),
      };
    }

    const metrics = buildMetrics(row);
    return {
      ok: true,
      tool: 'zipcheckup_lookup_zip',
      query: { zip },
      place: {
        zip: row.zip,
        city: row.city ?? null,
        state: row.state ?? null,
        latitude: row.latitude ? Number(row.latitude) : null,
        longitude: row.longitude ? Number(row.longitude) : null,
      },
      water_system: {
        pwsid: row.pwsid ?? null,
        system_name: row.system_name ?? null,
        population_served: row.population ? Number(row.population) : null,
        water_source: row.water_source ?? null,
      },
      metrics,
      data_quality: dataQuality(metrics),
      provenance: provenance(),
    };
  },
};

export const ALL_TOOLS = [lookupZip];
