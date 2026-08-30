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
