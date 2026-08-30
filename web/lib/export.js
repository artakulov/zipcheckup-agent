// Getting the work off the page. Collaboration that ends with the person
// reading a screen has not produced anything; they leave with nothing in hand.

import { getShortlist, getLetter } from './store.js';

function download(filename, text, type = 'text/markdown') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportLetter() {
  const letter = getLetter();
  if (!letter) return false;
  const r = letter.recipient ?? {};
  const recipientBlock =
    r.resolution === 'utility_contact'
      ? [
          `To: ${r.name}`,
          r.mailing_address ? `Address: ${r.mailing_address}` : null,
          r.email ? `Email: ${r.email}` : null,
          r.phone ? `Phone: ${r.phone}` : null,
          r.website ? `Website: ${r.website}` : null,
          r.fields_not_published?.length ? `Not published in the dataset: ${r.fields_not_published.join(', ')}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      : [
          'To: RECIPIENT NOT RESOLVED - verify before sending.',
          `Reason: ${r.unknown_reason ?? 'no contact published'}`,
          `This is not a claim that: ${r.not_a_claim_of ?? 'the utility has no contact details'}`,
          `How to resolve: ${r.how_to_resolve ?? ''}`,
          r.references?.explainer ? `EPA on state primacy: ${r.references.explainer}` : null,
        ]
          .filter(Boolean)
          .join('\n');

  const doc = [
    `# ${letter.subject}`,
    '',
    '## Recipient',
    '',
    recipientBlock,
    '',
    '## Letter',
    '',
    letter.body_markdown,
    '',
    '## Before you send this',
    '',
    letter.verification_checklist.map((c) => `- [ ] ${c}`).join('\n'),
    '',
    letter.facts_omitted.length
      ? `## Deliberately not asserted\n\nThese were left out of the letter because the data does not support them, and turned into questions instead:\n\n${letter.facts_omitted
          .map((f) => `- **${f.metric}** - ${f.unknown_reason}`)
          .join('\n')}`
      : '',
    '',
    `---\n\n${letter.disclaimer}`,
  ].join('\n');

  download(`zipcheckup-letter-${letter.zip}.md`, doc);
  return true;
}

export function mailtoLetter() {
  const letter = getLetter();
  if (!letter) return null;
  const to = letter.recipient?.email ?? '';
  return `mailto:${to}?subject=${encodeURIComponent(letter.subject)}&body=${encodeURIComponent(letter.body_plaintext)}`;
}

export function exportShortlist() {
  const list = getShortlist();
  if (!list.length) return false;
  const doc = [
    '# ZIP shortlist',
    '',
    `Exported ${new Date().toISOString().slice(0, 10)}. Data: ZipCheckup Open Data, CC BY 4.0, snapshot 2026-08-19.`,
    '',
    '| ZIP | Place | Data coverage | Added by | Note |',
    '|---|---|---|---|---|',
    ...list.map(
      (e) =>
        `| ${e.zip} | ${[e.city, e.state].filter(Boolean).join(', ') || 'not in dataset'} | ${e.data_coverage ?? 'not checked'} | ${e.added_by} | ${e.note ?? ''} |`,
    ),
    '',
    'Coverage counts how many metrics the source actually has a value for. A ZIP with low coverage has not been shown to be safe; it has not been measured.',
  ].join('\n');
  download('zipcheckup-shortlist.md', doc);
  return true;
}
