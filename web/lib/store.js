// Shared state between the agent and the person looking at the page.
//
// One store, one write path: the agent's tool and the human's button both call
// the same functions here. Every entry records who added it, so the page can
// show the moment the model wrote to it.

const KEY = 'zipcheckup.state.v1';
export const SHORTLIST_LIMIT = 12;

const state = {
  shortlist: [],
  activity: [],
};

load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.shortlist)) state.shortlist = parsed.shortlist.slice(0, SHORTLIST_LIMIT);
  } catch {
    // A private window or blocked site data must not break the page.
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ shortlist: state.shortlist }));
  } catch {
    /* storage unavailable is fine; the session still works in memory */
  }
}

function commit(action) {
  persist();
  window.dispatchEvent(new CustomEvent('zipcheckup:statechange', { detail: { action, state: snapshot() } }));
}

export function snapshot() {
  return { shortlist: state.shortlist.map((e) => ({ ...e })), activity: state.activity.slice(0, 50) };
}

export function getShortlist() {
  return state.shortlist.map((e) => ({ ...e }));
}

export function addZip({ zip, city, state: st, note, coverage, addedBy }) {
  const key = String(zip).trim();
  const existing = state.shortlist.find((e) => e.zip === key);
  if (existing) {
    if (note) existing.note = String(note).slice(0, 140);
    commit({ type: 'add', zip: key, duplicate: true, added_by: addedBy });
    return { changed: false, reason: 'already_on_shortlist', entry: { ...existing } };
  }
  if (state.shortlist.length >= SHORTLIST_LIMIT) {
    return { changed: false, reason: 'shortlist_full' };
  }
  const entry = {
    zip: key,
    city: city ?? null,
    state: st ?? null,
    note: note ? String(note).slice(0, 140) : null,
    data_coverage: coverage ?? null,
    added_by: addedBy === 'agent' ? 'agent' : 'human',
    added_at: new Date().toISOString(),
  };
  state.shortlist.push(entry);
  commit({ type: 'add', zip: key, added_by: entry.added_by });
  return { changed: true, entry: { ...entry } };
}

export function removeZip(zip, addedBy) {
  const key = String(zip).trim();
  const before = state.shortlist.length;
  state.shortlist = state.shortlist.filter((e) => e.zip !== key);
  const changed = state.shortlist.length !== before;
  commit({ type: 'remove', zip: key, added_by: addedBy });
  return { changed, reason: changed ? null : 'not_on_shortlist' };
}

export function clearShortlist(addedBy) {
  const removed = state.shortlist.length;
  state.shortlist = [];
  commit({ type: 'clear', added_by: addedBy });
  return { changed: removed > 0, removed };
}

export function logActivity(entry) {
  state.activity.unshift({ ...entry, at: new Date().toISOString() });
  state.activity = state.activity.slice(0, 50);
  window.dispatchEvent(new CustomEvent('zipcheckup:activity', { detail: entry }));
}

// A second tab is still the same person working; keep it in sync.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  load();
  commit({ type: 'external_sync' });
});
