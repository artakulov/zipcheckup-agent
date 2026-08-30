// The metric dictionary: authored semantics joined to generated coverage.
//
// Coverage is never hand-typed here. It comes from BUILD.json, which the build
// script derives from the source file, so the percentage a person is shown can
// never drift away from the data that was actually shipped.

import { build } from './dataset.js';

let dictPromise = null;

function dict() {
  dictPromise ??= fetch('./data/metrics.json').then((r) => r.json());
  return dictPromise;
}

// How each shipped field is read out of the raw string the source stores.
export const FIELD_TYPES = {
  total_violations: 'int',
  health_violations: 'int',
  unresolved_violations: 'int',
  lead_level_mg_l: 'float',
  copper_action_level_exceedance: 'bool',
  radon_zone: 'int',
  home_safety_score: 'int',
  home_safety_grade: 'string',
  contaminant_count: 'int',
  health_contaminant_names: 'list',
  enforcement_action_count: 'int',
  enforcement_health_violations: 'int',
  has_active_issues: 'bool',
  boil_water_advisories: 'int',
};

export const METRIC_ORDER = Object.keys(FIELD_TYPES);

export function coerce(field, raw) {
  switch (FIELD_TYPES[field]) {
    case 'int':
    case 'float':
      return Number(raw);
    case 'bool':
      return raw === 'true';
    case 'list':
      return String(raw)
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);
    default:
      return raw;
  }
}

export async function describe(field) {
  const [d, b] = await Promise.all([dict(), build()]);
  const entry = d.metrics[field];
  if (!entry) return null;
  const cov = b.coverage[field];
  return {
    ...entry,
    field,
    coverage_in_dataset: cov
      ? {
          rows_with_value: cov.rows_with_value,
          rows_total: b.rows_total,
          pct: cov.pct,
          statement: `${(100 - cov.pct).toFixed(1)}% of the ${b.rows_total.toLocaleString('en-US')} ZIP codes in this dataset have no value for ${field}.`,
        }
      : null,
  };
}

export async function allMetrics() {
  const d = await dict();
  return d.metrics;
}
