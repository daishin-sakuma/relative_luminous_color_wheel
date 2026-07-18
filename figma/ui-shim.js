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
    'padding:0.4rem 1.5rem 0.4rem 0.6rem;background:var(--surface,#1b1b1f);border-top:1px solid var(--border,#333);' +
    'overflow-x:auto;scrollbar-width:none}' +
    '#figma-actions::-webkit-scrollbar{display:none}' +
    '#figma-actions button{flex:0 0 auto;font:inherit;font-size:0.72rem;letter-spacing:0.02em;white-space:nowrap;' +
    'padding:0.3rem 0.7rem;border-radius:5px;border:1px solid var(--border,#333);background:var(--surface2,#26262b);' +
    'color:var(--text,#eee);cursor:pointer;transition:border-color 0.12s,background 0.12s}' +
    '@media(hover:hover){#figma-actions button:hover{border-color:var(--muted,#888)}}' +
    '#figma-actions button:active{background:var(--border,#333)}' +
    '#figma-actions button[data-act="variables"]{border-color:var(--accent,#6cf);color:var(--accent,#6cf)}' +
    // Per-chip "apply to the Figma selection" button — matches the other chip icon-buttons.
    '.palette-chip-figma{display:flex;align-items:center;background:none;border:none;color:inherit;' +
    'cursor:pointer;line-height:1;opacity:0.55;padding:0.5rem 0.25rem;transition:opacity 0.15s}' +
    '.palette-chip-figma svg{display:block}' +
    '@media(hover:hover){.palette-chip-figma:hover{opacity:1;color:var(--accent,#6cf)}}' +
    // Bottom-right drag handle to resize the plugin window.
    '#figma-resize{position:fixed;right:0;bottom:0;z-index:10000;width:16px;height:16px;' +
    'cursor:nwse-resize;color:var(--muted,#888);opacity:0.55;touch-action:none}' +
    '#figma-resize svg{display:block;position:absolute;right:2px;bottom:2px;pointer-events:none}' +
    '@media(hover:hover){#figma-resize:hover{opacity:1;color:var(--accent,#6cf)}}';
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
        // m.hex is the selection's colour; m.target picks which picker it lands in.
        if (m.target === 'bg') api.setBg(m.hex);
        else api.setText(m.hex);
      }
    });

    // A palette chip's "apply to Figma" button dispatches this; forward its colour to the
    // main thread, which fills the current selection (same path as the action bar).
    window.addEventListener('rlcw-apply-fill', function (ev) {
      var hex = ev.detail && ev.detail.hex;
      if (hex) post({ type: 'apply-fill', hex: hex });
    });

    // ── Action bar ─────────────────────────────────────────────────────────────
    var bar = document.createElement('div');
    bar.id = 'figma-actions';
    bar.innerHTML =
      '<button data-act="apply-text" title="Fill the selected layers with the TEXT colour">Text → selection</button>' +
      '<button data-act="apply-bg" title="Fill the selected layers with the BG colour">BG → selection</button>' +
      '<button data-act="import-text" title="Read the selected layer’s colour into the TEXT picker">Import as Text</button>' +
      '<button data-act="import-bg" title="Read the selected layer’s colour into the BG picker">Import as BG</button>' +
      '<button data-act="variables" title="Create Figma variable collections from the generated scale + light/dark themes">Create variables</button>';
    document.body.appendChild(bar);

    // ── Resize handle ────────────────────────────────────────────────────────────
    // Bottom-right grip; dragging posts the new size to the main thread, which calls
    // figma.ui.resize and persists it. The pointer's viewport coords (origin top-left)
    // are the target width/height. Pointer capture keeps move events flowing off-handle.
    var resize = document.createElement('div');
    resize.id = 'figma-resize';
    resize.title = 'Drag to resize';
    resize.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" ' +
      'stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M11 4.5 4.5 11M11 8.5 8.5 11"/></svg>';
    document.body.appendChild(resize);
    var rzOn = false;
    resize.addEventListener('pointerdown', function (e) {
      rzOn = true;
      if (resize.setPointerCapture) { try { resize.setPointerCapture(e.pointerId); } catch (err) {} }
      e.preventDefault();
    });
    resize.addEventListener('pointermove', function (e) {
      if (!rzOn) return;
      post({ type: 'resize', width: Math.ceil(e.clientX + 6), height: Math.ceil(e.clientY + 6) });
    });
    function endResize(e) {
      if (!rzOn) return;
      rzOn = false;
      if (resize.releasePointerCapture) { try { resize.releasePointerCapture(e.pointerId); } catch (err) {} }
    }
    resize.addEventListener('pointerup', endResize);
    resize.addEventListener('pointercancel', endResize);

    // Keep the footer clear of the fixed bar without piling up empty space.
    //   • Fit-zoom mode (wide window): reserve the bar's full height via --rlcw-fit-reserve,
    //     which the app's fit logic subtracts from the available height.
    //   • Scroll mode (the plugin's default narrow window): the footer's container already
    //     carries bottom padding, so only add the shortfall needed to clear the bar plus a
    //     small comfortable gap — otherwise the two stack into an oversized void.
    var GAP = 14; // px of breathing room we want between the footer and the bar
    var reserving = false;
    function reserveBar() {
      if (reserving) return;
      reserving = true;
      var h = bar.offsetHeight;
      document.documentElement.style.setProperty('--rlcw-fit-reserve', h + 'px');
      var f = document.querySelector('.copyright');
      var pad = h;
      if (f) {
        // Natural space already below the footer (its container's padding), independent of
        // our reserve — subtract the reserve currently in place to isolate it.
        var trailing = document.documentElement.scrollHeight
          - (f.getBoundingClientRect().bottom + window.scrollY)
          - (parseFloat(document.body.style.paddingBottom) || 0);
        pad = Math.max(0, Math.round(GAP + h - trailing));
      }
      document.body.style.paddingBottom = pad + 'px';
      window.dispatchEvent(new Event('resize')); // nudge the fit logic; re-entry guarded above
      reserving = false;
    }
    reserveBar();
    window.addEventListener('resize', reserveBar);

    bar.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('button');
      if (!b) return;
      var act = b.dataset.act;
      var cols = api.getMainColors();
      if (act === 'apply-text') post({ type: 'apply-fill', hex: cols.text });
      else if (act === 'apply-bg') post({ type: 'apply-fill', hex: cols.bg });
      else if (act === 'import-text') post({ type: 'import-selection', target: 'text' });
      else if (act === 'import-bg') post({ type: 'import-selection', target: 'bg' });
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
