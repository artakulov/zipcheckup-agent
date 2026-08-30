import { getZip } from '../lib/dataset.js';
import { provenance } from '../lib/envelope.js';
import { describe, allMetrics, METRIC_ORDER } from '../lib/metrics.js';
import { buildMetricEnvelopes } from './lookup-zip.js';

export const explainMetric = {
  name: 'zipcheckup_explain_metric',
  title: 'Explain a metric: its source, snapshot date, legal threshold and coverage',
  description:
    'Explain what one ZipCheckup metric actually measures: which agency or document it comes from, how current it is, the legal threshold it is judged against with the regulatory citation, how much of the 42,679-ZIP dataset actually has a value for it, what a blank means, and the known caveats in the raw data. Call this before telling anyone a number is good or bad - several metrics look like measurements but are not, and one is empty for every row in the dataset. Optionally pass a zip to get that ZIP value alongside the explanation.',
  inputSchema: {
    type: 'object',
    properties: {
      metric: {
        type: 'string',
        description:
          'Metric id. One of: lead_level_mg_l, copper_action_level_exceedance, radon_zone, total_violations, health_violations, unresolved_violations, enforcement_action_count, enforcement_health_violations, has_active_issues, contaminant_count, health_contaminant_names, home_safety_score, home_safety_grade, boil_water_advisories.',
      },
      zip: {
        type: 'string',
        description: 'Optional 5-digit US ZIP code, to include this metric value for that ZIP.',
      },
    },
    required: ['metric'],
    additionalProperties: false,
  },
  // This payload is our own authored dictionary, not third-party text, so unlike
  // the data tools it carries no untrusted content.
  annotations: { readOnlyHint: true, untrustedContentHint: false },

  async execute({ metric, zip }) {
    const field = String(metric ?? '').trim();
    const spec = await describe(field);

    if (!spec) {
      const known = Object.keys(await allMetrics());
      return {
        ok: false,
        error: {
          code: 'unknown_metric',
          metric: field,
          message: `No metric named "${field}".`,
          available: known.length ? known : METRIC_ORDER,
        },
      };
    }

    let valueForZip = null;
    if (zip) {
      const { zip: key, record, invalid } = await getZip(zip);
      if (invalid) {
        valueForZip = { error: 'invalid_zip', zip: String(zip) };
      } else if (!record) {
        valueForZip = {
          zip: key,
          status: 'zip_not_in_dataset',
          not_a_claim_of: 'that this ZIP is safe or that the metric was measured and came back negative',
        };
      } else {
        const env = await buildMetricEnvelopes(record);
        valueForZip = env[field] ?? null;
      }
    }

    return {
      ok: true,
      tool: 'zipcheckup_explain_metric',
      metric: field,
      label: spec.label,
      definition: spec.definition,
      unit: spec.unit,
      source: {
        dataset: 'ZipCheckup Open Data - zip-summary',
        upstream: spec.upstream,
        registry: 'https://registry.opendata.aws/zipcheckup-us-home-environmental-risk/',
        license: 'CC-BY-4.0',
      },
      measured: {
        as_of: '2026-08-19',
        precision: 'dataset_snapshot_date',
        note: 'The snapshot date is when the file was published, not when any sample was taken.',
      },
      threshold: spec.threshold ?? {
        status: 'none',
        reason: 'No statutory threshold applies to this field; it is a count or a descriptor.',
      },
      // Generated from BUILD.json, never hand-typed, so it cannot drift from the
      // data that actually shipped.
      coverage_in_dataset: spec.coverage_in_dataset,
      what_missing_means: spec.what_missing_means,
      known_caveats: spec.caveats ?? [],
      value_for_zip: valueForZip,
      provenance: provenance(),
    };
  },
};
