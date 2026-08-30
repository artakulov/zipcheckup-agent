// Composing a letter that names a real organisation and alleges a real problem.
//
// Two rules, both load-bearing:
//   1. The prose is assembled ONLY from facts whose status is "known". An
//      unknown value cannot reach the body, because the composer never reads
//      from anywhere else. What is unknown becomes a question instead.
//   2. A recipient is never invented. If the dataset publishes no contact for
//      the water system, the tool says so and points at how to find the right
//      state agency, rather than addressing a plausible-looking guess.

const CCR_BASE = 'https://zipcheckup-open-data.s3.us-west-2.amazonaws.com/data/ccr/parsed-json';

const EPA_PRIMACY = {
  explainer: 'https://www.epa.gov/dwreginfo/primacy-enforcement-responsibility-public-water-systems',
  contact_form: 'https://www.epa.gov/dwreginfo/forms/contact-us-about-drinking-water-requirements-states-and-public-water-systems',
};

/** Fetch the utility contact the open dataset publishes, if any. */
export async function resolveRecipient({ pwsid, systemName, state }) {
  if (!pwsid) {
    return {
      resolution: 'unresolved',
      status: 'unknown',
      unknown_reason: 'no PWSID is recorded for this ZIP, so no water system can be looked up',
      not_a_claim_of: 'that no water system serves this ZIP',
      how_to_resolve: `Ask the drinking-water primacy agency for ${state ?? 'your state'} which system serves the address.`,
      references: EPA_PRIMACY,
    };
  }

  let ccr = null;
  try {
    const res = await fetch(`${CCR_BASE}/${pwsid}.json`);
    if (res.ok) ccr = await res.json();
  } catch {
    // Network failure is not evidence about the utility.
  }

  const contact = ccr?.utility_contact ?? null;
  const hasAny = contact && (contact.website || contact.phone || contact.email || contact.address);

  if (hasAny) {
    return {
      resolution: 'utility_contact',
      status: 'known',
      name: ccr.system_name ?? systemName ?? pwsid,
      pwsid,
      website: contact.website ?? null,
      phone: contact.phone ?? null,
      email: contact.email ?? null,
      mailing_address: contact.address ?? null,
      source: { file: `data/ccr/parsed-json/${pwsid}.json`, dataset: 'ZipCheckup Open Data', license: 'CC-BY-4.0' },
      fields_not_published: ['website', 'phone', 'email', 'address'].filter((f) => !contact[f]),
      caution:
        'These details come from a parsed Consumer Confidence Report snapshot. Confirm they are current before sending.',
    };
  }

  return {
    resolution: 'unresolved',
    status: 'unknown',
    pwsid,
    name_from_dataset: ccr?.system_name ?? systemName ?? null,
    unknown_reason: ccr
      ? `the published record for ${pwsid} carries no website, phone, email or address`
      : `no consumer-confidence record is published at data/ccr/parsed-json/${pwsid}.json`,
    not_a_claim_of: 'that this utility has no contact details, only that this dataset publishes none',
    how_to_resolve: `Search for the drinking-water primacy agency for ${state ?? 'the relevant state'}, or use the EPA contact route below. Do not send this letter to an address that has not been verified.`,
    references: EPA_PRIMACY,
  };
}

const sentence = {
  lead_level_mg_l: (m) =>
    `the most recent lead figure published for this system is ${m.value} ${m.unit}${
      m.threshold?.value !== undefined
        ? ` against an EPA action level of ${m.threshold.value} ${m.threshold.unit} (${m.threshold.citation})`
        : ''
    }${m.qualifier === 'reported_as_zero_non_detect' ? ', reported as zero, which indicates a result below the laboratory detection limit rather than an absence of lead' : ''}`,
  health_violations: (m) => `${m.value} health-based drinking-water violation${m.value === 1 ? ' is' : 's are'} recorded for this system`,
  total_violations: (m) => `${m.value} drinking-water violation${m.value === 1 ? ' is' : 's are'} recorded for this system`,
  unresolved_violations: (m) => `${m.value} violation${m.value === 1 ? ' remains' : 's remain'} recorded as unresolved`,
  enforcement_action_count: (m) => `${m.value} enforcement action${m.value === 1 ? ' has' : 's have'} been recorded against this system`,
  enforcement_health_violations: (m) => `${m.value} enforcement action${m.value === 1 ? '' : 's'} relate${m.value === 1 ? 's' : ''} to health-based violations`,
  contaminant_count: (m) => `${m.value} contaminant${m.value === 1 ? ' appears' : 's appear'} in violation records for this system`,
  health_contaminant_names: (m) => `the contaminants named in health-based violation records are ${m.value.join(', ')}`,
  has_active_issues: (m) => (m.value ? 'the dataset flags this system as having active issues' : 'the dataset does not flag active issues for this system'),
  radon_zone: (m) => `this area falls in EPA radon zone ${m.value}`,
  home_safety_score: (m) => `the composite score published for this ZIP is ${m.value} out of 100, a vendor index with no statutory threshold`,
};

const question = {
  lead_level_mg_l: 'What is the most recent 90th-percentile lead result for this system, and over what monitoring period was it collected?',
  health_violations: 'Have any health-based violations been recorded for this system, and if so which?',
  total_violations: 'How many drinking-water violations are currently on record for this system?',
  unresolved_violations: 'Are any violations still open rather than returned to compliance?',
  enforcement_action_count: 'Has any enforcement action been taken against this system?',
  enforcement_health_violations: 'Did any enforcement action relate to a health-based violation?',
  contaminant_count: 'Which contaminants have appeared in violation records for this system?',
  health_contaminant_names: 'Which contaminants, if any, were named in health-based violations?',
  has_active_issues: 'Are there any active water-quality issues affecting this system today?',
  boil_water_advisories: 'Has any boil-water advisory been issued for this system, and when?',
  copper_action_level_exceedance: 'Has this system ever exceeded the EPA copper action level?',
  radon_zone: 'Is radon screening data available for this area?',
  home_safety_score: 'Is any overall water-quality assessment published for this system?',
};

/**
 * Build the letter. `metrics` is the envelope map; only status:"known" entries
 * can contribute prose, and only fields the caller marked relevant are used.
 */
export function compose({ zip, place, waterSystem, metrics, concern, tone = 'formal', senderName, senderAddress, recipient }) {
  const relevant = Object.entries(metrics).filter(([field]) => sentence[field] || question[field]);

  const cited = relevant.filter(([, m]) => m.status === 'known');
  const omitted = relevant.filter(([, m]) => m.status === 'unknown');

  const where = [place?.city, place?.state].filter(Boolean).join(', ') || `ZIP ${zip}`;
  const systemLine = waterSystem?.system_name
    ? `${waterSystem.system_name}${waterSystem.pwsid ? ` (PWSID ${waterSystem.pwsid})` : ''}`
    : 'the public water system serving this ZIP code';

  const facts = cited.map(([field, m]) => sentence[field](m)).filter(Boolean);
  const questions = omitted.map(([field]) => question[field]).filter(Boolean);

  const opener =
    tone === 'neighborly'
      ? `I live in ${where} and I am trying to understand the drinking water here.`
      : `I am writing regarding the drinking water supplied to ${where} by ${systemLine}.`;

  const concernLine = concern ? `My specific concern is ${concern}.` : '';

  const factsPara = facts.length
    ? `According to the ZipCheckup open dataset published in the AWS Registry of Open Data (snapshot 2026-08-19, derived from EPA SDWIS and published Consumer Confidence Reports), ${facts.join('; ')}.`
    : `The public dataset I consulted (ZipCheckup Open Data, snapshot 2026-08-19) publishes no measured values for this system, which is why I am writing to ask rather than to assert.`;

  const questionsPara = questions.length
    ? `The public record does not answer the following, so I would be grateful if you could:\n\n${questions.map((q) => `- ${q}`).join('\n')}`
    : '';

  const closer =
    'I would also appreciate a copy of the most recent Consumer Confidence Report for this system, and confirmation of the service-line material recorded for my address.';

  const signature = `\n\n${tone === 'neighborly' ? 'Thanks,' : 'Yours sincerely,'}\n${senderName ?? '[your name]'}\n${senderAddress ?? '[your address]'}`;

  const body = [opener, concernLine, factsPara, questionsPara, closer]
    .filter(Boolean)
    .join('\n\n')
    .concat(signature);

  const subject = `Drinking water enquiry for ZIP ${zip}${waterSystem?.pwsid ? ` (PWSID ${waterSystem.pwsid})` : ''}`;

  return {
    subject,
    body_markdown: body,
    body_plaintext: body.replace(/^- /gm, '  * '),
    facts_cited: cited.map(([, m]) => m),
    facts_omitted: omitted.map(([field, m]) => ({
      metric: field,
      unknown_reason: m.unknown_reason,
      why_omitted: 'not asserted in the letter because the value is unknown',
      converted_to_question: question[field] ?? null,
    })),
    verification_checklist: [
      recipient?.resolution === 'utility_contact'
        ? 'Confirm the recipient details below are current - they come from a parsed report snapshot dated 2026-08-19.'
        : 'Find and verify the correct recipient before sending. This draft does not name one, because the dataset publishes none.',
      'Check the cited figures against the water system\'s most recent Consumer Confidence Report.',
      'Replace the placeholder name and address.',
      'A ZIP code is not a service area. Confirm this system actually serves your address.',
    ],
    disclaimer:
      'Generated from a CC BY 4.0 open dataset. Not legal advice. Every figure quoted is a published record, not an independent measurement of your home.',
  };
}
