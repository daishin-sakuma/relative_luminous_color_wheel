// ─── Figma plugin UI shim ─────────────────────────────────────────────────────
// Injected as a plain <script> in <head>, BEFORE the app module, so everything here
// runs first. It:
//   1. Flags the app as plugin-hosted (window.__RLCW_PLUGIN__) so main.js exposes
//      window.__rlcw (its bridge).
//   2. Replaces localStorage with an in-memory store seeded from Figma clientStorage
//      (injected as window.__RLCW_INIT__ by the main thread) and mirrors writes back to
//      the main thread so preferences/palette persist across sessions.
//   3. Bridges to the main thread (parent postMessage): apply colours to the selection,
//      import the selection's colours, and write the generated scale/themes as Figma
//      variable collections.
//   4. Adds a compact action bar to the app once it's ready.
(function () {
  'use strict';
  window.__RLCW_PLUGIN__ = true;

  // ── localStorage → in-memory + clientStorage mirror ──────────────────────────
  var mem = Object.assign({}, window.__RLCW_INIT__ || {});
  function post(msg) { parent.postMessage({ pluginMessage: msg }, '*'); }
  var poly = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); post({ type: 'persist', key: k, value: String(v) }); },
    removeItem: function (k) { delete mem[k]; post({ type: 'persist', key: k, value: null }); },
    clear: function () { mem = {}; post({ type: 'persist-clear' }); },
    key: function (i) { return Object.keys(mem)[i] != null ? Object.keys(mem)[i] : null; },
    get length() { return Object.keys(mem).length; }
  };
  try {
    Object.defineProperty(window, 'localStorage', { value: poly, configurable: true });
  } catch (e) {
    try { window.localStorage = poly; } catch (e2) { /* fall back to native (in-session only) */ }
  }

  // ── Action-bar styling (reuses the app's theme vars; slim fixed bar at the bottom) ──
  var style = document.createElement('style');
  style.textContent =
    '#figma-actions{position:fixed;left:0;right:0;bottom:0;z-index:9999;display:flex;gap:0.4rem;' +
    'padding:0.4rem 0.6rem;background:var(--surface,#1b1b1f);border-top:1px solid var(--border,#333);' +
    'overflow-x:auto;scrollbar-width:none}' +
    '#figma-actions::-webkit-scrollbar{display:none}' +
    '#figma-actions button{flex:0 0 auto;font:inherit;font-size:0.72rem;letter-spacing:0.02em;white-space:nowrap;' +
    'padding:0.3rem 0.7rem;border-radius:5px;border:1px solid var(--border,#333);background:var(--surface2,#26262b);' +
    'color:var(--text,#eee);cursor:pointer;transition:border-color 0.12s,background 0.12s}' +
    '@media(hover:hover){#figma-actions button:hover{border-color:var(--muted,#888)}}' +
    '#figma-actions button:active{background:var(--border,#333)}' +
    '#figma-actions button[data-act="variables"]{border-color:var(--accent,#6cf);color:var(--accent,#6cf)}';
  (document.head || document.documentElement).appendChild(style);

  // ── Bridge to the main thread ────────────────────────────────────────────────
  var wired = false;
  function bridgeReady() {
    if (wired) return true;
    var api = window.__rlcw;
    if (!api) return false;
    wired = true;

    // Messages FROM the main thread.
    window.addEventListener('message', function (ev) {
      var m = ev.data && ev.data.pluginMessage;
      if (!m) return;
      if (m.type === 'imported') {
        // m.text / m.bg are hex strings read from the selection.
        if (m.text) api.setText(m.text);
        if (m.bg) api.setBg(m.bg);
      }
    });

    // ── Action bar ─────────────────────────────────────────────────────────────
    var bar = document.createElement('div');
    bar.id = 'figma-actions';
    bar.innerHTML =
      '<button data-act="apply-text" title="Fill the selected layers with the TEXT colour">Text → selection</button>' +
      '<button data-act="apply-bg" title="Fill the selected layers with the BG colour">BG → selection</button>' +
      '<button data-act="import" title="Read the selected layers’ colours into TEXT / BG">Import selection</button>' +
      '<button data-act="variables" title="Create Figma variable collections from the generated scale + light/dark themes">Create variables</button>';
    document.body.appendChild(bar);

    // Reserve the bar's exact height so the footer clears it — both when the app scrolls
    // (body padding) and when it fit-zooms on wider windows (--rlcw-fit-reserve, read by the
    // app's fit logic). Re-measure on resize (font/zoom changes) and nudge a refit.
    function reserveBar() {
      var h = bar.offsetHeight;
      document.body.style.paddingBottom = h + 'px';
      document.documentElement.style.setProperty('--rlcw-fit-reserve', h + 'px');
      window.dispatchEvent(new Event('resize'));
    }
    reserveBar();
    window.addEventListener('resize', function () { if (bar.offsetHeight + 'px' !== document.body.style.paddingBottom) reserveBar(); });

    bar.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('button');
      if (!b) return;
      var act = b.dataset.act;
      var cols = api.getMainColors();
      if (act === 'apply-text') post({ type: 'apply-fill', hex: cols.text });
      else if (act === 'apply-bg') post({ type: 'apply-fill', hex: cols.bg });
      else if (act === 'import') post({ type: 'import-selection' });
      else if (act === 'variables') post({ type: 'create-variables', data: api.getScaleData() });
    });
    return true;
  }
  // main.js sets window.__rlcw then fires 'rlcw-ready'; also poll as a fallback.
  window.addEventListener('rlcw-ready', bridgeReady);
  document.addEventListener('DOMContentLoaded', function () {
    if (!bridgeReady()) {
      var tries = 0, t = setInterval(function () { if (bridgeReady() || ++tries > 40) clearInterval(t); }, 50);
    }
  });
})();
