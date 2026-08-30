import { getZip } from '../lib/dataset.js';
import { provenance } from '../lib/envelope.js';
import { buildMetricEnvelopes } from './lookup-zip.js';
import { resolveRecipient, compose } from '../lib/letter.js';
import { setLetter } from '../lib/store.js';

export const draftCivicLetter = {
  name: 'zipcheckup_draft_civic_letter',
  title: 'Draft a letter to the water system about a specific ZIP code',
  description:
    'Draft a ready-to-send letter about the drinking water in one US ZIP code, addressed to that ZIP\'s water system when the open dataset publishes a contact for it. The letter asserts ONLY metrics whose value is known; every unknown metric is moved into facts_omitted and turned into a question rather than an accusation, so the draft can never allege something the data does not support. When no contact is published, the tool returns resolution:"unresolved" and refuses to name a recipient rather than guessing one - verify the recipient yourself before sending. The draft appears in the letter panel on the page, where the person can read and export it.',
  inputSchema: {
    type: 'object',
    properties: {
      zip: { type: 'string', description: '5-digit US ZIP code the letter is about.' },
      concern: {
        type: 'string',
        description: 'What the person is worried about, in their own words, for example "lead in the water at a house we are buying".',
      },
      tone: { type: 'string', enum: ['formal', 'neighborly'], description: 'Register of the letter. Default formal.' },
      sender_name: { type: 'string', description: 'Name to sign with. Omit to leave a placeholder.' },
      sender_address: { type: 'string', description: 'Sender address for the letterhead. Omit to leave a placeholder.' },
    },
    required: ['zip'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, untrustedContentHint: true },

  async execute({ zip, concern, tone, sender_name: senderName, sender_address: senderAddress }) {
    const { zip: key, record, invalid } = await getZip(zip);

    if (invalid) {
      return { ok: false, error: { code: 'invalid_zip', zip: String(zip), message: 'Expected a 5-digit US ZIP code.' } };
    }
    if (!record) {
      return {
        ok: false,
        error: {
          code: 'zip_not_in_dataset',
          zip: key,
          message: `ZIP ${key} has no row in the snapshot, so there is nothing to cite in a letter.`,
          not_a_claim_of: 'that this ZIP is safe or that no water system serves it',
          suggestion: 'Ask the state drinking-water primacy agency which system serves the address.',
        },
      };
    }

    const metrics = await buildMetricEnvelopes(record);
    const place = { zip: key, city: record.city ?? null, state: record.state ?? null };
    const waterSystem = { pwsid: record.pwsid ?? null, system_name: record.system_name ?? null };

    const recipient = await resolveRecipient({
      pwsid: waterSystem.pwsid,
      systemName: waterSystem.system_name,
      state: place.state,
    });

    const letter = compose({ zip: key, place, waterSystem, metrics, concern, tone, senderName, senderAddress, recipient });

    setLetter({ zip: key, recipient, ...letter });

    return {
      ok: true,
      tool: 'zipcheckup_draft_civic_letter',
      zip: key,
      recipient,
      ...letter,
      counts: { facts_cited: letter.facts_cited.length, facts_omitted: letter.facts_omitted.length },
      ui: {
        updated: true,
        element: '#letter',
        visible_to_human: true,
        message: 'The draft is rendered in the letter panel on the page and can be exported from there.',
      },
      provenance: provenance(),
    };
  },
};
