import { searchIndex, getZip, haversineMiles } from '../lib/dataset.js';
import { provenance } from '../lib/envelope.js';
import { buildMetricEnvelopes } from './lookup-zip.js';

const F = {
  zip: 0, state: 1, home_safety_score: 2, health_violations: 3,
  unresolved_violations: 4, lead_level_mg_l: 5, radon_zone: 6,
  has_active_issues: 7, latitude: 8, longitude: 9,
};

const numOrNull = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const boolOrNull = (v) => (v === undefined || v === null || v === '' ? null : v === true || v === 'true');

export const findSaferZips = {
  name: 'zipcheckup_find_safer_zips',
  title: 'Find ZIP codes whose measured values meet environmental-safety criteria',
  description:
    'Search all 42,679 US ZIP codes for ones whose MEASURED values meet your criteria: by state, within a radius of another ZIP, and by lead level, health-based violations, active issues and composite safety score. Only ZIPs with a known value on every filtered metric can match; ZIPs whose value is unknown are returned separately in candidates_with_unknown_data and are never mixed into matches. The result reports exactly how many ZIPs were dropped for missing data rather than for failing the filter - that number is usually large. Never present an excluded ZIP as unsafe, and never present a matching ZIP as tested-and-clean beyond the specific fields filtered on.',
  inputSchema: {
    type: 'object',
    properties: {
      state: { type: 'string', description: 'Two-letter US state code, for example "MI".' },
      near_zip: { type: 'string', description: '5-digit ZIP code to search around.' },
      radius_miles: { type: 'number', description: 'Radius in miles around near_zip. Default 25, maximum 250.' },
      max_lead_mg_l: { type: 'number', description: 'Maximum lead level in mg/L. The EPA action level is 0.015.' },
      max_health_violations: { type: 'number', description: 'Maximum health-based drinking-water violations.' },
      min_safety_score: { type: 'number', description: 'Minimum ZipCheckup composite score, 0-100. Only 26.1% of ZIPs have one, so this filter alone excludes most of the country for missing data.' },
      exclude_active_issues: { type: 'boolean', description: 'When true, only ZIPs explicitly flagged as having no active issues can match.' },
      limit: { type: 'number', description: 'Maximum results to return, 1-50. Default 10.' },
    },
    required: [],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, untrustedContentHint: true },

  async execute(input = {}) {
    const state = input.state ? String(input.state).trim().toUpperCase() : null;
    const nearZip = input.near_zip ? String(input.near_zip).trim() : null;
    const radius = Math.min(Number(input.radius_miles) || 25, 250);
    const limit = Math.max(1, Math.min(Number(input.limit) || 10, 50));

    const filters = {
      max_lead_mg_l: numOrNull(input.max_lead_mg_l),
      max_health_violations: numOrNull(input.max_health_violations),
      min_safety_score: numOrNull(input.min_safety_score),
      exclude_active_issues: boolOrNull(input.exclude_active_issues),
    };
    const activeFilters = Object.entries(filters).filter(([, v]) => v !== null);

    if (!state && !nearZip && !activeFilters.length) {
      return {
        ok: false,
        error: {
          code: 'no_criteria',
          message: 'Give at least one of: state, near_zip, or a threshold filter. An unfiltered search of 42,679 ZIP codes is not a useful answer.',
        },
      };
    }

    const idx = await searchIndex();
    const stateCode = state ? idx.states.indexOf(state) : -1;
    if (state && stateCode === -1) {
      return { ok: false, error: { code: 'unknown_state', state, message: `No ZIP in the dataset carries state "${state}".` } };
    }

    let origin = null;
    if (nearZip) {
      const { record, invalid } = await getZip(nearZip);
      if (invalid || !record?.latitude) {
        return {
          ok: false,
          error: {
            code: 'near_zip_has_no_coordinates',
            zip: nearZip,
            message: `ZIP ${nearZip} has no latitude/longitude in the dataset, so a radius search around it is not possible.`,
            not_a_claim_of: 'anything about the safety of that ZIP',
          },
        };
      }
      origin = { lat: Number(record.latitude), lon: Number(record.longitude) };
    }

    // Which metrics a candidate must have a KNOWN value for to be eligible.
    const requiredKnown = [];
    if (filters.max_lead_mg_l !== null) requiredKnown.push('lead_level_mg_l');
    if (filters.max_health_violations !== null) requiredKnown.push('health_violations');
    if (filters.min_safety_score !== null) requiredKnown.push('home_safety_score');
    if (filters.exclude_active_issues !== null) requiredKnown.push('has_active_issues');

    const matches = [];
    const unknownCandidates = [];
    let scanned = 0;
    let failedFilter = 0;
    let outOfScope = 0;

    for (const row of idx.rows) {
      if (stateCode !== -1 && row[F.state] !== stateCode) { outOfScope += 1; continue; }

      let distance = null;
      if (origin) {
        const lat = row[F.latitude];
        const lon = row[F.longitude];
        if (lat === null || lon === null) { outOfScope += 1; continue; }
        distance = haversineMiles(origin.lat, origin.lon, lat, lon);
        if (distance > radius) { outOfScope += 1; continue; }
      }

      scanned += 1;

      const unknownOn = requiredKnown.filter((m) => row[F[m]] === null);
      if (unknownOn.length) {
        if (unknownCandidates.length < limit) {
          unknownCandidates.push({
            zip: row[F.zip],
            state: row[F.state] === null ? null : idx.states[row[F.state]],
            unknown_on: unknownOn,
            note: 'Not ranked and not excluded on merit. Absence of a value is not a low value.',
            ...(distance === null ? {} : { distance_miles: Number(distance.toFixed(1)) }),
          });
        }
        continue;
      }

      const passes =
        (filters.max_lead_mg_l === null || row[F.lead_level_mg_l] <= filters.max_lead_mg_l) &&
        (filters.max_health_violations === null || row[F.health_violations] <= filters.max_health_violations) &&
        (filters.min_safety_score === null || row[F.home_safety_score] >= filters.min_safety_score) &&
        (filters.exclude_active_issues !== true || row[F.has_active_issues] === false);

      if (!passes) { failedFilter += 1; continue; }

      matches.push({
        zip: row[F.zip],
        state: row[F.state] === null ? null : idx.states[row[F.state]],
        score: row[F.home_safety_score],
        health_violations: row[F.health_violations],
        lead_level_mg_l: row[F.lead_level_mg_l],
        radon_zone: row[F.radon_zone],
        has_active_issues: row[F.has_active_issues],
        ...(distance === null ? {} : { distance_miles: Number(distance.toFixed(1)) }),
      });
    }

    matches.sort((a, b) => {
      if (a.distance_miles !== undefined && b.distance_miles !== undefined) return a.distance_miles - b.distance_miles;
      return (b.score ?? -1) - (a.score ?? -1);
    });
    const top = matches.slice(0, limit);

    // Full envelopes for what we actually return, so the caller never sees a
    // bare number without its source and threshold.
    const detailed = [];
    for (const m of top) {
      const { record } = await getZip(m.zip);
      const env = record ? await buildMetricEnvelopes(record) : {};
      detailed.push({
        zip: m.zip,
        place: { city: record?.city ?? null, state: m.state },
        ...(m.distance_miles === undefined ? {} : { distance_miles: m.distance_miles }),
        metrics: Object.fromEntries(requiredKnown.concat(['radon_zone', 'home_safety_score']).map((f) => [f, env[f]]).filter(([, v]) => v)),
      });
    }

    const unknownTotal = scanned - matches.length - failedFilter;
    return {
      ok: true,
      tool: 'zipcheckup_find_safer_zips',
      criteria: {
        state, near_zip: nearZip, radius_miles: origin ? radius : null,
        ...Object.fromEntries(activeFilters), limit,
      },
      matches: detailed,
      match_count_total: matches.length,
      candidates_with_unknown_data: unknownCandidates,
      excluded: {
        failed_filter: failedFilter,
        unknown_on_a_filtered_metric: unknownTotal,
        outside_state_or_radius: outOfScope,
        scanned_in_scope: scanned,
        dataset_total: idx.rows.length,
      },
      warning: requiredKnown.length
        ? `${unknownTotal.toLocaleString('en-US')} of the ${scanned.toLocaleString('en-US')} ZIP codes in scope were excluded because at least one filtered metric is unknown for them. That is a data gap, not a safety finding. A matching ZIP is one that was measured AND passed; a non-matching ZIP has not been shown to be worse.`
        : 'No threshold filter was applied, so nothing was excluded for missing data.',
      provenance: provenance(),
    };
  },
};
