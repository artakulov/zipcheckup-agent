import { registerAll, revokeAll, refreshStatus, onStatus } from './lib/webmcp.js';
import { ALL_TOOLS } from './tools/index.js';

const $ = (id) => document.getElementById(id);
const byName = new Map(ALL_TOOLS.map((t) => [t.name, t]));

onStatus(render);

function render(status) {
  const badge = $('badge');
  badge.className = `badge badge-${status.mode}`;
  const label = {
    native: 'WebMCP native',
    polyfill: 'WebMCP polyfill',
    unavailable: 'WebMCP unavailable',
  }[status.mode];
  badge.textContent = `${label} · ${status.count} tool${status.count === 1 ? '' : 's'} registered`;

  $('toolcount').textContent = status.count ? `(${status.count})` : '';
  $('toollist').innerHTML = status.tools.length
    ? status.tools
        .map(
          (t) => `<li><code>${t.name}</code><span class="muted"> - ${escapeHtml(t.title)}</span>
            ${t.annotations?.readOnlyHint ? '<span class="tag">read-only</span>' : '<span class="tag tag-write">writes</span>'}</li>`,
        )
        .join('')
    : '<li class="muted">none registered</li>';

  const pick = $('toolpick');
  pick.innerHTML = status.tools.map((t) => `<option value="${t.name}">${t.name}</option>`).join('');

  const bits = [];
  if (status.mode === 'native') {
    bits.push('Your browser exposes WebMCP natively, so an attached agent can see these tools right now.');
  } else if (status.mode === 'polyfill') {
    bits.push(
      'Your browser has no native WebMCP, so the page loaded a 24 KB polyfill. Everything below still works; an agent in ChatGPT’s browser, or Chrome 149+ with the flag enabled, gets the native path.',
    );
  }
  if (status.inIframe) bits.push('Heads up: this page is in an iframe, and WebMCP is not exposed inside iframes.');
  if (status.executeToolAvailable) bits.push('This browser also exposes the non-standard executeTool() extension.');
  $('howto').textContent = bits.join(' ');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function log(line, cls = '') {
  const el = $('log');
  if (el.querySelector('.muted')) el.innerHTML = '';
  const li = document.createElement('li');
  li.className = cls;
  li.textContent = line;
  el.prepend(li);
}

async function run() {
  const name = $('toolpick').value;
  const tool = byName.get(name);
  if (!tool) return;
  const zip = $('arg').value.trim();
  const t0 = performance.now();
  try {
    const result = await tool.execute({ zip });
    const ms = Math.round(performance.now() - t0);
    $('out').textContent = JSON.stringify(result, null, 2);
    const dq = result.data_quality;
    log(`${name}({zip:"${zip}"}) · ${ms}ms · ${dq ? `${dq.known} known / ${dq.unknown} unknown` : result.error?.code ?? 'ok'}`);
  } catch (e) {
    $('out').textContent = String(e);
    log(`${name}({zip:"${zip}"}) FAILED: ${e}`, 'err');
  }
}

$('run').addEventListener('click', run);
$('arg').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') run();
});
for (const chip of document.querySelectorAll('.chip')) {
  chip.addEventListener('click', () => {
    $('arg').value = chip.dataset.zip;
    run();
  });
}
$('revoke').addEventListener('click', async () => {
  await revokeAll();
  log('revokeAll() - AbortSignal fired, every tool unregistered');
});
$('reregister').addEventListener('click', async () => {
  await registerAll(ALL_TOOLS);
  log('registerAll() - tools registered again');
});

registerAll(ALL_TOOLS)
  .then((s) => log(`registered ${s.count} tool(s), mode: ${s.mode}`))
  .catch(async (e) => {
    await refreshStatus();
    log(`registration failed: ${e}`, 'err');
  });
