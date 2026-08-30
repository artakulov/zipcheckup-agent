// The only subscriber to store changes. Renders the shortlist wholesale (12 rows
// max, so diffing would be ceremony) and highlights whatever just changed, so a
// person can see the exact moment the agent wrote to the page.

import { getShortlist, addZip, removeZip, SHORTLIST_LIMIT } from './store.js';

const $ = (id) => document.getElementById(id);

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

export function renderShortlist(changedZip = null) {
  const list = getShortlist();
  const el = $('shortlist');
  const count = $('shortlist-count');
  if (count) count.textContent = `${list.length}/${SHORTLIST_LIMIT}`;
  if (!el) return;

  if (!list.length) {
    el.innerHTML =
      '<li class="empty muted">Nothing shortlisted yet. Add a ZIP yourself, or ask an agent to put one here.</li>';
    return;
  }

  el.innerHTML = list
    .map(
      (e) => `<li data-zip="${e.zip}" class="${e.zip === changedZip ? 'flash' : ''}">
        <div class="sl-main">
          <strong>${e.zip}</strong>
          <span class="muted">${escapeHtml([e.city, e.state].filter(Boolean).join(', ') || 'not in dataset')}</span>
          ${e.added_by === 'agent' ? '<span class="tag tag-agent">added by agent</span>' : ''}
        </div>
        <div class="sl-meta muted small">
          ${escapeHtml(e.data_coverage ?? '')}${e.note ? ` · ${escapeHtml(e.note)}` : ''}
        </div>
        <button class="x" data-remove="${e.zip}" title="Remove ${e.zip}" aria-label="Remove ${e.zip}">×</button>
      </li>`,
    )
    .join('');

  for (const btn of el.querySelectorAll('[data-remove]')) {
    btn.addEventListener('click', () => removeZip(btn.dataset.remove, 'human'));
  }
}

export function renderActivity(entry) {
  const el = $('log');
  if (!el) return;
  const empty = el.querySelector('.empty');
  if (empty) empty.remove();
  const li = document.createElement('li');
  li.className = entry.error ? 'err' : '';
  const args = entry.args ? JSON.stringify(entry.args) : '';
  li.innerHTML = `<span class="who ${entry.by}">${entry.by}</span> <code>${escapeHtml(entry.tool)}</code>
    <span class="muted">${escapeHtml(args)}</span>
    <span class="muted"> · ${entry.ms}ms${entry.summary ? ` · ${escapeHtml(entry.summary)}` : ''}</span>`;
  el.prepend(li);
  while (el.children.length > 40) el.lastChild.remove();
}

export function wireHumanControls() {
  const form = $('add-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('add-zip');
    const zip = input.value.trim();
    if (!/^\d{5}$/.test(zip)) return;
    addZip({ zip, addedBy: 'human', coverage: null });
    input.value = '';
  });
}

window.addEventListener('zipcheckup:statechange', (e) => {
  renderShortlist(e.detail?.action?.zip ?? null);
});

// --- rendered result view -------------------------------------------------
// The JSON is the contract, but a person needs to SEE that unknown and zero are
// different things. This renders known values plainly and unknown ones as an
// explicit, differently-coloured statement of what is not known and why.

const LABELS = {
  total_violations: 'Violations',
  health_violations: 'Health-based violations',
  unresolved_violations: 'Unresolved',
  lead_level_mg_l: 'Lead',
  copper_action_level_exceedance: 'Copper exceedance',
  radon_zone: 'Radon zone',
  home_safety_score: 'Safety score',
  home_safety_grade: 'Grade',
  contaminant_count: 'Contaminants',
  health_contaminant_names: 'Named contaminants',
  enforcement_action_count: 'Enforcement actions',
  enforcement_health_violations: 'Enforcement on health',
  has_active_issues: 'Active issues',
  boil_water_advisories: 'Boil-water advisories',
};

function fmt(m) {
  if (Array.isArray(m.value)) return m.value.join(', ');
  if (typeof m.value === 'boolean') return m.value ? 'yes' : 'no';
  if (m.unit && /mg\/L/.test(m.unit)) return `${m.value} ${m.unit}`;
  return String(m.value);
}

function metricCell(field, m) {
  if (!m) return '';
  const label = LABELS[field] ?? field;
  if (m.status === 'unknown') {
    return `<div class="cell cell-unknown" title="${escapeHtml(m.unknown_reason ?? '')}">
      <div class="cell-label">${escapeHtml(label)}</div>
      <div class="cell-value">unknown</div>
      <div class="cell-note">${escapeHtml(m.unknown_reason ?? '')}</div>
    </div>`;
  }
  const over = m.threshold?.comparison === 'above';
  return `<div class="cell ${over ? 'cell-over' : ''}">
    <div class="cell-label">${escapeHtml(label)}</div>
    <div class="cell-value">${escapeHtml(fmt(m))}${m.qualifier ? ' <span class="qual">?</span>' : ''}</div>
    <div class="cell-note">${escapeHtml(
      m.qualifier
        ? m.qualifier.replace(/_/g, ' ')
        : m.threshold?.value !== undefined
          ? `${over ? 'above' : 'at or below'} ${m.threshold.name} (${m.threshold.value} ${m.threshold.unit})`
          : '',
    )}</div>
  </div>`;
}

export function renderResult(result) {
  const el = document.getElementById('result');
  if (!el) return;

  if (!result?.ok) {
    el.innerHTML = `<div class="result-head"><strong>${escapeHtml(result?.error?.code ?? 'error')}</strong></div>
      <p class="muted small">${escapeHtml(result?.error?.message ?? '')}</p>
      ${result?.error?.not_a_claim_of ? `<p class="not-claim">This is <em>not</em> a claim of: ${escapeHtml(result.error.not_a_claim_of)}</p>` : ''}`;
    return;
  }

  if (result.tool === 'zipcheckup_find_safer_zips') {
    const ex = result.excluded;
    el.innerHTML = `
      <div class="result-head">
        <strong>${result.match_count_total}</strong>
        <span class="muted">ZIP codes measured and passing, of ${ex.scanned_in_scope.toLocaleString('en-US')} in scope</span>
      </div>
      <div class="tally">
        <div class="tally-item"><span class="t-n">${result.match_count_total.toLocaleString('en-US')}</span><span class="t-l">measured and passed</span></div>
        <div class="tally-item"><span class="t-n">${ex.failed_filter.toLocaleString('en-US')}</span><span class="t-l">measured and failed</span></div>
        <div class="tally-item tally-unknown"><span class="t-n">${ex.unknown_on_a_filtered_metric.toLocaleString('en-US')}</span><span class="t-l">excluded: not measured</span></div>
      </div>
      <p class="not-claim">${escapeHtml(result.warning ?? '')}</p>
      <ul class="matchlist">${result.matches
        .map(
          (m) => `<li><strong>${m.zip}</strong> <span class="muted">${escapeHtml([m.place?.city, m.place?.state].filter(Boolean).join(', '))}</span>
            ${Object.entries(m.metrics ?? {})
              .filter(([, v]) => v?.status === 'known')
              .map(
                ([k, v]) =>
                  `<span class="mini${v.qualifier ? ' mini-qual' : ''}"${v.qualifier_note ? ` title="${escapeHtml(v.qualifier_note)}"` : ''}>${escapeHtml(
                    k.replace(/_/g, ' '),
                  )}: ${escapeHtml(String(v.value))}${v.qualifier === 'reported_as_zero_non_detect' ? ' (non-detect)' : ''}</span>`,
              )
              .join('')}</li>`,
        )
        .join('')}</ul>`;
    return;
  }

  if (!result.metrics) {
    el.innerHTML = `<div class="result-head"><strong>${escapeHtml(result.tool ?? 'result')}</strong>
      <span class="muted small">see the JSON below for the full payload</span></div>`;
    return;
  }

  const dq = result.data_quality;
  el.innerHTML = `
    <div class="result-head">
      <strong>${escapeHtml(result.place?.zip ?? '')}</strong>
      <span class="muted">${escapeHtml([result.place?.city, result.place?.state].filter(Boolean).join(', ') || 'no place name in the dataset')}</span>
      <span class="coverage">${dq.known} of ${dq.known + dq.unknown} metrics known</span>
    </div>
    ${result.water_system?.system_name ? `<p class="muted small">Water system: ${escapeHtml(result.water_system.system_name)} (${escapeHtml(result.water_system.pwsid ?? '')}). A ZIP is not a service area - verify the provider for a specific address.</p>` : ''}
    ${result.row_state ? `<p class="not-claim">${escapeHtml(result.row_state.note)}</p>` : ''}
    <div class="grid">${Object.entries(result.metrics).map(([f, m]) => metricCell(f, m)).join('')}</div>`;
}

// --- letter panel ---------------------------------------------------------

export function renderLetter(letter) {
  const el = document.getElementById('letter');
  if (!el) return;
  if (!letter) {
    el.innerHTML = '<p class="empty muted small">No draft yet. Ask an agent to write to the water system about a ZIP, or run the tool from the console.</p>';
    return;
  }
  const r = letter.recipient ?? {};
  const resolved = r.resolution === 'utility_contact';
  el.innerHTML = `
    <div class="letter-to ${resolved ? '' : 'letter-to-unresolved'}">
      <div class="cell-label">${resolved ? 'Recipient, from the dataset' : 'Recipient not resolved'}</div>
      ${
        resolved
          ? `<div class="cell-value">${escapeHtml(r.name ?? '')}</div>
             <div class="cell-note">${escapeHtml([r.email, r.phone, r.website, r.mailing_address].filter(Boolean).join(' · '))}
             ${r.fields_not_published?.length ? `<br>Not published: ${escapeHtml(r.fields_not_published.join(', '))}` : ''}</div>`
          : `<div class="cell-value">verify before sending</div>
             <div class="cell-note">${escapeHtml(r.unknown_reason ?? '')}. This is not a claim that ${escapeHtml(r.not_a_claim_of ?? '')}.</div>`
      }
    </div>
    <div class="letter-subject">${escapeHtml(letter.subject)}</div>
    <pre class="letter-body">${escapeHtml(letter.body_markdown)}</pre>
    <div class="letter-counts muted small">
      ${letter.facts_cited.length} fact${letter.facts_cited.length === 1 ? '' : 's'} asserted, all from known values ·
      ${letter.facts_omitted.length} unknown${letter.facts_omitted.length === 1 ? '' : 's'} turned into questions instead of claims
    </div>
    <div class="row">
      <button class="btn btn-quiet" id="dl-letter" type="button">Download letter</button>
      <a class="btn btn-quiet" id="mail-letter" href="#">Open in mail</a>
    </div>`;
}

window.addEventListener('zipcheckup:statechange', (e) => {
  if (e.detail?.action?.type === 'letter') renderLetter(e.detail.state.letter);
});
