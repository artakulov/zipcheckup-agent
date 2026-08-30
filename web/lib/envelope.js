// The single chokepoint every value crosses on its way out of the dataset.
//
// Doctrine: absence is not zero. A blank cell in the source means "not fetched,
// not matched, or not measured" - it never means 0, "none", "clean" or "safe".
// On drinking-water and radon data that distinction is the whole product.

export const SNAPSHOT_DATE = '2026-08-19';

const SOURCE = Object.freeze({
  dataset: 'ZipCheckup Open Data - zip-summary',
  upstream: 'EPA SDWIS, utility Consumer Confidence Reports, EPA radon zones',
  file: 'data/zip-summary/csv/zipcheckup-environmental-safety-data.csv',
  registry: 'https://registry.opendata.aws/zipcheckup-us-home-environmental-risk/',
  license: 'CC-BY-4.0',
});

/** A value that is present in the source. */
export function known(metric, value, { unit = null, qualifier = null, qualifierNote = null, threshold = null } = {}) {
  return {
    metric,
    status: 'known',
    value,
    unit,
    qualifier,
    ...(qualifierNote ? { qualifier_note: qualifierNote } : {}),
    source: SOURCE,
    measured: { as_of: SNAPSHOT_DATE, precision: 'dataset_snapshot_date' },
    threshold,
  };
}

/** A value that is absent from the source. Never rendered as 0. */
export function unknown(metric, reason, { notAClaimOf, howToResolve } = {}) {
  return {
    metric,
    status: 'unknown',
    value: null,
    unknown_reason: reason,
    not_a_claim_of:
      notAClaimOf ?? 'zero, none, clean, safe, or that the metric was measured and came back negative',
    how_to_resolve:
      howToResolve ?? 'Ask the water system or the state drinking-water primacy agency; see zipcheckup_draft_civic_letter.',
    source: SOURCE,
    measured: { as_of: SNAPSHOT_DATE, precision: 'dataset_snapshot_date' },
  };
}

/** Roll a metrics object up into the block every tool result carries. */
export function dataQuality(metrics) {
  const entries = Object.entries(metrics);
  const unknownFields = entries.filter(([, m]) => m.status === 'unknown').map(([k]) => k);
  return {
    known: entries.length - unknownFields.length,
    unknown: unknownFields.length,
    coverage: `${entries.length - unknownFields.length}/${entries.length}`,
    unknown_fields: unknownFields,
    agent_instructions:
      'Fields with status:"unknown" have no value in the source. Do NOT render them as 0, "none", "clean", "no violations" or "safe". When summarising for a person, say explicitly which fields are unknown and why.',
  };
}

export function provenance(extra = {}) {
  return {
    snapshot_date: SNAPSHOT_DATE,
    license: 'CC-BY-4.0',
    attribution: 'ZipCheckup Open Data, via the AWS Registry of Open Data',
    ...extra,
  };
}
