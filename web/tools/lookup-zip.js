import { getZip } from '../lib/dataset.js';
import { known, unknown, dataQuality, provenance } from '../lib/envelope.js';
import { allMetrics, coerce, METRIC_ORDER } from '../lib/metrics.js';

export async function buildMetricEnvelopes(record) {
  const dict = await allMetrics();
  const out = {};
  for (const field of METRIC_ORDER) {
    const spec = dict[field] ?? {};
    const raw = record?.[field];

    if (raw === undefined || raw === '') {
      out[field] = unknown(field, spec.what_missing_means ?? 'no value for this ZIP in the source snapshot');
      continue;
    }

    const value = coerce(field, raw);
    const opts = {
      unit: spec.unit ?? null,
      threshold: spec.threshold?.status === 'not_applicable' ? spec.threshold : (spec.threshold ?? null),
    };

    // A laboratory cannot report a true zero. Flag it rather than let a model
    // read 0 mg/L as "no lead".
    if (field === 'lead_level_mg_l' && value === 0) {
      opts.qualifier = 'reported_as_zero_non_detect';
      opts.qualifierNote =
        'A reported 0 means the result was below the laboratory detection limit. It is not a measurement of "no lead".';
    }
    if (spec.threshold?.value !== undefined && typeof value === 'number') {
      opts.threshold = { ...spec.threshold, comparison: value > spec.threshold.value ? 'above' : 'at_or_below' };
    }

    out[field] = known(field, value, opts);
  }
  return out;
}

export const lookupZip = {
  name: 'zipcheckup_lookup_zip',
  title: 'Look up environmental risk for a US ZIP code',
  description:
    'Return every environmental-safety metric ZipCheckup holds for one US ZIP code - drinking-water violations, lead level, EPA radon zone, enforcement actions and composite safety score - each with its source, snapshot date and the legal threshold it is judged against. Metrics missing from the source come back as status:"unknown" with a machine-readable reason. Unknown is NEVER zero and never means safe: do not describe an unknown metric as "no violations", "clean", "none" or "0". A ZIP absent from the dataset is likewise not a claim of safety. Covers 42,679 US ZIP codes.',
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
    const { zip: key, record, invalid } = await getZip(zip);

    if (invalid) {
      return {
        ok: false,
        error: {
          code: 'invalid_zip',
          zip: String(zip),
          message: 'Expected a 5-digit US ZIP code, including any leading zeros.',
        },
      };
    }

    if (!record) {
      return {
        ok: false,
        error: {
          code: 'zip_not_in_dataset',
          zip: key,
          message: `ZIP ${key} has no row in the ZipCheckup snapshot dated 2026-08-19.`,
          not_a_claim_of: 'that this ZIP is safe, unmonitored, or free of violations',
          suggestion: 'Try a neighbouring ZIP code, or ask the state drinking-water primacy agency directly.',
        },
        provenance: provenance(),
      };
    }

    const metrics = await buildMetricEnvelopes(record);

    // 1,335 of the 42,679 rows exist with every field empty. That is a third
    // state, distinct from both "not in the dataset" and "measured": the ZIP was
    // enumerated but nothing was ever matched to it. An agent must not collapse
    // it into either neighbour.
    const emptyRow = Object.keys(record).length === 0;

    return {
      ok: true,
      tool: 'zipcheckup_lookup_zip',
      query: { zip: key },
      ...(emptyRow
        ? {
            row_state: {
              state: 'present_but_entirely_empty',
              note: `ZIP ${key} is enumerated in the dataset but every field is empty. This is not the same as being absent from the dataset, and it is not a finding that anything was measured and came back clean.`,
              rows_like_this: 1335,
              rows_total: 42679,
            },
          }
        : {}),
      place: {
        zip: key,
        city: record.city ?? null,
        state: record.state ?? null,
        latitude: record.latitude ? Number(record.latitude) : null,
        longitude: record.longitude ? Number(record.longitude) : null,
      },
      water_system: {
        pwsid: record.pwsid ?? null,
        system_name: record.system_name ?? null,
        population_served: record.population ? Number(record.population) : null,
        water_source: record.water_source ?? null,
      },
      metrics,
      data_quality: dataQuality(metrics),
      provenance: provenance(),
    };
  },
};
