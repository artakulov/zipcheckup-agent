import { registerAll, revokeAll, refreshStatus, onStatus } from './lib/webmcp.js';
import { ALL_TOOLS } from './tools/index.js';
import { logActivity } from './lib/store.js';
import { renderShortlist, renderActivity, wireHumanControls, escapeHtml, renderResult } from './lib/ui.js';

const $ = (id) => document.getElementById(id);
const byName = new Map(ALL_TOOLS.map((t) => [t.name, t]));

const EXAMPLES = {
  zipcheckup_lookup_zip: [
    ['90210', 'Beverly Hills: 2 violations, active issues'],
    ['48201', 'Detroit: no violations recorded'],
    ['01004', 'partial data'],
    ['00601', 'ZIP only, nothing else known'],
    ['99999', 'in the dataset, every field empty'],
    ['00000', 'absent from the dataset'],
  ],
  zipcheckup_update_shortlist: [],
};

onStatus(renderStatus);

function renderStatus(status) {
  const badge = $('badge');
  badge.className = `badge badge-${status.mode}`;
  const label = { native: 'WebMCP native', polyfill: 'WebMCP polyfill', unavailable: 'WebMCP unavailable' }[status.mode];
  badge.textContent = `${label} · ${status.count} tool${status.count === 1 ? '' : 's'}`;

  $('toolcount').textContent = status.count ? `(${status.count})` : '';
  $('toollist').innerHTML = status.tools.length
    ? status.tools
        .map(
          (t) => `<li><code>${escapeHtml(t.name)}</code>
            ${t.annotations?.readOnlyHint ? '<span class="tag">read-only</span>' : '<span class="tag tag-write">writes</span>'}
            <div class="muted small">${escapeHtml(t.title)}</div></li>`,
        )
        .join('')
    : '<li class="muted">none registered</li>';

  const pick = $('toolpick');
  const previous = pick.value;
  // getTools() returns tools alphabetically, which would land the console on
  // compare_zips. Put the primary lookup first instead.
  const ordered = [...status.tools].sort(
    (a, b) => Number(b.name === 'zipcheckup_lookup_zip') - Number(a.name === 'zipcheckup_lookup_zip'),
  );
  pick.innerHTML = ordered.map((t) => `<option value="${t.name}">${t.name}</option>`).join('');
  if (previous && status.tools.some((t) => t.name === previous)) pick.value = previous;
  renderArgs();

  const bits = [];
  if (status.mode === 'native') bits.push('Your browser exposes WebMCP natively, so an attached agent can see these tools right now.');
  if (status.mode === 'polyfill')
    bits.push(
      'Your browser has no native WebMCP, so the page loaded a 24 KB polyfill. Everything here still works; ChatGPT’s browser, or Chrome 149+ with the flag, gets the native path.',
    );
  if (status.inIframe) bits.push('This page is in an iframe, and WebMCP is not exposed inside iframes.');
  $('howto').textContent = bits.join(' ');
}

// Build the console form from the tool's own inputSchema rather than hardcoding
// fields, so a new tool is callable the moment it is registered.
function renderArgs() {
  const tool = byName.get($('toolpick').value);
  const box = $('argfields');
  const ex = $('examples');
  if (!tool) {
    box.innerHTML = '';
    ex.innerHTML = '';
    return;
  }
  const props = tool.inputSchema?.properties ?? {};
  box.innerHTML = Object.entries(props)
    .map(([name, spec]) => {
      const required = (tool.inputSchema.required ?? []).includes(name);
      if (spec.enum) {
        return `<label class="field"><span>${name}${required ? '*' : ''}</span>
          <select data-arg="${name}">${spec.enum.map((v) => `<option>${v}</option>`).join('')}</select></label>`;
      }
      return `<label class="field"><span>${name}${required ? '*' : ''}</span>
        <input data-arg="${name}" type="text" placeholder="${escapeHtml((spec.description ?? '').slice(0, 40))}"></label>`;
    })
    .join('');

  const zipInput = box.querySelector('[data-arg="zip"]');
  if (zipInput) zipInput.value = '90210';

  ex.innerHTML = (EXAMPLES[tool.name] ?? [])
    .map(([zip, why]) => `<button class="chip" data-zip="${zip}" title="${escapeHtml(why)}">${zip}</button>`)
    .join(' ');
  for (const chip of ex.querySelectorAll('.chip')) {
    chip.addEventListener('click', () => {
      const inp = box.querySelector('[data-arg="zip"]');
      if (inp) inp.value = chip.dataset.zip;
      run();
    });
  }
}

function collectArgs() {
  const args = {};
  for (const el of $('argfields').querySelectorAll('[data-arg]')) {
    const v = el.value.trim();
    if (v !== '') args[el.dataset.arg] = v;
  }
  return args;
}

async function run() {
  const tool = byName.get($('toolpick').value);
  if (!tool) return;
  const args = collectArgs();
  const t0 = performance.now();
  try {
    const result = await tool.execute(args);
    const ms = Math.round(performance.now() - t0);
    $('out').textContent = JSON.stringify(result, null, 2);
    renderResult(result);
    const summary = result.data_quality
      ? `${result.data_quality.known} known / ${result.data_quality.unknown} unknown`
      : result.error?.code ?? (result.action_applied ? `${result.action_applied} → ${result.count} on shortlist` : 'ok');
    const entry = { tool: tool.name, args, ms, summary, by: 'human' };
    logActivity(entry);
    renderActivity(entry);
  } catch (e) {
    const entry = { tool: tool.name, args, ms: Math.round(performance.now() - t0), summary: String(e), by: 'human', error: true };
    $('out').textContent = String(e);
    logActivity(entry);
    renderActivity(entry);
  }
}

// Wrap every tool so an agent's call shows up in the activity log too. The agent
// invokes execute() through the browser, so this is the only place we see it.
for (const tool of ALL_TOOLS) {
  const original = tool.execute.bind(tool);
  tool.execute = async (args) => {
    const t0 = performance.now();
    const result = await original(args);
    const ms = Math.round(performance.now() - t0);
    if (!window.__zc_local_call) {
      const summary = result.data_quality
        ? `${result.data_quality.known} known / ${result.data_quality.unknown} unknown`
        : result.error?.code ?? (result.action_applied ? `${result.action_applied} → ${result.count} on shortlist` : 'ok');
      const entry = { tool: tool.name, args, ms, summary, by: 'agent' };
      logActivity(entry);
      renderActivity(entry);
    }
    return result;
  };
}

// Console calls go through the same wrapper; mark them so they log as human.
const rawRun = run;
run = async function markedRun() {
  window.__zc_local_call = true;
  try {
    await rawRun();
  } finally {
    window.__zc_local_call = false;
  }
};

$('run').addEventListener('click', () => run());
$('toolpick').addEventListener('change', renderArgs);
$('argfields').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    run();
  }
});
$('revoke').addEventListener('click', async () => {
  const s = await revokeAll();
  renderActivity({ tool: 'revokeAll()', args: null, ms: 0, summary: `AbortSignal fired, ${s.count} tools registered`, by: 'human' });
});
$('reregister').addEventListener('click', async () => {
  const s = await registerAll(ALL_TOOLS);
  renderActivity({ tool: 'registerAll()', args: null, ms: 0, summary: `${s.count} tools registered`, by: 'human' });
});

wireHumanControls();
renderShortlist();

registerAll(ALL_TOOLS).catch(async (e) => {
  await refreshStatus();
  renderActivity({ tool: 'registerAll()', args: null, ms: 0, summary: String(e), by: 'human', error: true });
});
