import { getZip } from '../lib/dataset.js';
import { addZip, removeZip, clearShortlist, getShortlist, SHORTLIST_LIMIT } from '../lib/store.js';
import { dataQuality, provenance } from '../lib/envelope.js';
import { buildMetricEnvelopes } from './lookup-zip.js';

export const updateShortlist = {
  name: 'zipcheckup_update_shortlist',
  title: 'Add or remove a ZIP on the shortlist the person is looking at',
  description:
    'Add, remove or clear ZIP codes on the shortlist panel rendered on this page. This writes to shared state the person sees update live, so call it only when they have actually expressed interest in a ZIP, not to store your own working notes. Returns the full resulting shortlist, so you always know what is on screen. Adding a ZIP asserts nothing about its safety: each entry carries how much of its data is actually known.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'remove', 'clear'],
        description: 'What to do with the shortlist.',
      },
      zip: {
        type: 'string',
        description: '5-digit US ZIP code. Required for add and remove, ignored for clear.',
      },
      note: {
        type: 'string',
        description: 'Optional short reason shown next to the entry, up to 140 characters, for example "closest to the new office".',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, untrustedContentHint: false },

  async execute({ action, zip, note }) {
    const respond = (extra) => ({
      ok: true,
      tool: 'zipcheckup_update_shortlist',
      ...extra,
      shortlist: getShortlist(),
      count: getShortlist().length,
      limit: SHORTLIST_LIMIT,
      ui: {
        updated: true,
        element: '#shortlist',
        visible_to_human: true,
        message: 'The shortlist panel on the page was updated and the changed row highlighted.',
      },
      provenance: provenance(),
    });

    if (action === 'clear') {
      const r = clearShortlist('agent');
      return respond({ action_applied: 'clear', changed: { removed_count: r.removed } });
    }

    if (!zip) {
      return {
        ok: false,
        error: { code: 'zip_required', message: `action "${action}" requires a zip.` },
      };
    }

    if (action === 'remove') {
      const r = removeZip(zip, 'agent');
      if (!r.changed) {
        return {
          ok: false,
          error: { code: r.reason, zip: String(zip), message: `ZIP ${zip} was not on the shortlist.` },
          shortlist: getShortlist(),
        };
      }
      return respond({ action_applied: 'remove', changed: { removed: String(zip) } });
    }

    if (action === 'add') {
      const { zip: key, record, invalid } = await getZip(zip);
      if (invalid) {
        return { ok: false, error: { code: 'invalid_zip', zip: String(zip), message: 'Expected a 5-digit US ZIP code.' } };
      }

      // A ZIP with no row can still be shortlisted - the person may be moving
      // there regardless - but the entry must say the data is absent, not fine.
      let coverage = 'not in dataset: no metrics known';
      if (record) {
        const metrics = await buildMetricEnvelopes(record);
        coverage = `${dataQuality(metrics).coverage} metrics known`;
      }

      const r = addZip({
        zip: key,
        city: record?.city ?? null,
        state: record?.state ?? null,
        note,
        coverage,
        addedBy: 'agent',
      });

      if (!r.changed && r.reason === 'shortlist_full') {
        return {
          ok: false,
          error: {
            code: 'shortlist_full',
            limit: SHORTLIST_LIMIT,
            message: `The shortlist already holds ${SHORTLIST_LIMIT} ZIP codes. Remove one before adding another.`,
          },
          shortlist: getShortlist(),
        };
      }

      return respond({
        action_applied: 'add',
        changed: r.changed ? { added: key } : { added: null, already_present: key },
        ...(record ? {} : { warning: `ZIP ${key} has no row in the dataset. It was added, but no metric is known for it, which is not a finding of safety.` }),
      });
    }

    return { ok: false, error: { code: 'unknown_action', message: `action must be add, remove or clear.` } };
  },
};
