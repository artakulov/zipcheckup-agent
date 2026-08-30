import { getZip } from '../lib/dataset.js';
import { dataQuality, provenance } from '../lib/envelope.js';
import { buildMetricEnvelopes } from './lookup-zip.js';
import { METRIC_ORDER } from '../lib/metrics.js';

// Which way is "better" for each numeric metric. A field absent from this map is
// not ranked at all rather than ranked on a guess: inventing an order for a
// categorical or boolean field would fabricate a scale the data does not have.
//
// radon_zone deserves its own note: EPA zone 1 is the HIGHEST predicted radon,
// so a larger zone number is the better outcome. Ranking it like a score would
// invert the health meaning.
const DIRECTION = {
  total_violations: 'lower_is_better',
  health_violations: 'lower_is_better',
  unresolved_violations: 'lower_is_better',
  lead_level_mg_l: 'lower_is_better',
  contaminant_count: 'lower_is_better',
  enforcement_action_count: 'lower_is_better',
  enforcement_health_violations: 'lower_is_better',
  boil_water_advisories: 'lower_is_better',
  home_safety_score: 'higher_is_better',
  radon_zone: 'higher_is_better',
};

function coerceZipList(zips) {
  if (Array.isArray(zips)) return zips.map((z) => String(z).trim());
  if (typeof zips === 'string') {
    return zips
      .split(/[,\s]+/)
      .map((z) => z.trim())
      .filter(Boolean);
  }
  return [];
}

export const compareZips = {
  name: 'zipcheckup_compare_zips',
  title: 'Compare environmental risk across several ZIP codes',
  description:
    'Compare 2 to 8 US ZIP codes side by side on the same environmental-safety metrics, with source and snapshot date on every value. Rankings are computed ONLY across ZIPs whose value is known; a ZIP whose value is unknown is listed separately in excluded_unknown and is never ranked, never called best or worst, and never treated as zero. A ZIP missing from a ranking is missing data, not a good score. Do not fill a gap by inference from its neighbours.',
  inputSchema: {
    type: 'object',
    properties: {
      zips: {
        type: 'array',
        items: { type: 'string' },
        description: '2 to 8 five-digit US ZIP codes, for example ["48201","90210","01002"].',
      },
      metrics: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional metric ids to limit the comparison, for example ["lead_level_mg_l","health_violations"]. Omit to compare everything.',
      },
    },
    required: ['zips'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, untrustedContentHint: true },

  async execute({ zips, metrics: wanted }) {
    const list = [...new Set(coerceZipList(zips))];
    if (list.length < 2 || list.length > 8) {
      return {
        ok: false,
        error: {
          code: 'bad_zip_count',
          message: `Compare between 2 and 8 ZIP codes; received ${list.length}.`,
        },
      };
    }

    const fields = (Array.isArray(wanted) && wanted.length ? wanted : METRIC_ORDER).filter((f) =>
      METRIC_ORDER.includes(f),
    );
    if (!fields.length) {
      return { ok: false, error: { code: 'no_known_metrics', message: 'None of the requested metric ids exist.' } };
    }

    const rows = {};
    const missing = [];
    for (const zip of list) {
      const { record, invalid } = await getZip(zip);
      if (invalid || !record) {
        missing.push(zip);
        rows[zip] = {
          in_dataset: false,
          note: invalid
            ? 'Not a 5-digit ZIP code.'
            : `No row in the snapshot. That is absence of data, not a finding about this ZIP.`,
        };
        continue;
      }
      const env = await buildMetricEnvelopes(record);
      rows[zip] = {
        in_dataset: true,
        place: { zip, city: record.city ?? null, state: record.state ?? null },
        water_system: { pwsid: record.pwsid ?? null, system_name: record.system_name ?? null },
        metrics: Object.fromEntries(fields.map((f) => [f, env[f]])),
      };
    }

    const comparison = {};
    for (const field of fields) {
      const comparable = [];
      const excluded = [];
      for (const zip of list) {
        const m = rows[zip]?.metrics?.[field];
        if (m && m.status === 'known' && typeof m.value === 'number') comparable.push({ zip, value: m.value });
        else excluded.push(zip);
      }

      const direction = DIRECTION[field];
      if (!direction || comparable.length < 2) {
        comparison[field] = {
          comparable: comparable.map((c) => c.zip),
          excluded_unknown: excluded,
          ranking: null,
          caveat: !direction
            ? 'Not ranked: this field is categorical or boolean, so ordering it would invent a scale the data does not have.'
            : `Not ranked: only ${comparable.length} of ${list.length} ZIP codes have a known value. Exclusion is missing data, not a result.`,
        };
        continue;
      }

      const higherIsBetter = direction === 'higher_is_better';
      const ranking = [...comparable].sort((a, b) => (higherIsBetter ? b.value - a.value : a.value - b.value));

      comparison[field] = {
        comparable: ranking.map((r) => r.zip),
        excluded_unknown: excluded,
        ranking,
        direction,
        ...(field === 'radon_zone'
          ? { direction_note: 'EPA zone 1 is the highest predicted radon, so a higher zone number is the better outcome.' }
          : {}),
        best: ranking[0].zip,
        worst: ranking[ranking.length - 1].zip,
        caveat: excluded.length
          ? `Ranked over ${ranking.length} of ${list.length} ZIP codes. ${excluded.join(', ')} excluded because the value is unknown - that is missing data, not a low or high result.`
          : null,
      };
    }

    const allMetrics = Object.values(rows).flatMap((r) => (r.metrics ? Object.values(r.metrics) : []));
    return {
      ok: true,
      tool: 'zipcheckup_compare_zips',
      zips: list,
      ...(missing.length
        ? {
            not_in_dataset: {
              zips: missing,
              not_a_claim_of: 'that these ZIP codes are safe or unmonitored; they simply have no row',
            },
          }
        : {}),
      rows,
      comparison,
      data_quality: allMetrics.length
        ? dataQuality(Object.fromEntries(allMetrics.map((m, i) => [`${m.metric}_${i}`, m])))
        : { known: 0, unknown: 0, coverage: '0/0', unknown_fields: [], agent_instructions: 'No comparable rows.' },
      provenance: provenance(),
    };
  },
};
