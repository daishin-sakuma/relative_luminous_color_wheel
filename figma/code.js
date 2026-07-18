// ─── Relative Luminous Color Wheel — Figma plugin main thread ─────────────────
// Runs in Figma's sandbox (no DOM). Hosts the picker UI (the inlined web app), persists
// its state via clientStorage, and turns UI requests into Figma document edits: fill the
// selection, import the selection's colours, and write the generated tonal scale + light/
// dark themes as Figma variable collections (primitives + a themed collection aliasing them).

const STORE_KEY = 'rlcw-state';
const WIN_KEY = 'rlcw-window';       // persisted plugin-window size {w,h}
const WIN_MIN = { w: 320, h: 400 };  // below this the app switches to its narrow/scroll layout
const WIN_MAX = { w: 1600, h: 1600 };
function clampWin(w, h) {
  return {
    w: Math.max(WIN_MIN.w, Math.min(WIN_MAX.w, w | 0)),
    h: Math.max(WIN_MIN.h, Math.min(WIN_MAX.h, h | 0)),
  };
}

// ── hex ⇄ Figma colour ({r,g,b} / {r,g,b,a}, all 0–1) ─────────────────────────
function parseHex(hex) {
  const h = String(hex).replace('#', '');
  const n = h.length >= 8 ? 8 : 6;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const a = n === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}
function figColor(hex) { const c = parseHex(hex); return { r: c.r, g: c.g, b: c.b, a: c.a }; }
function toHex2(v) { return Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0'); }
function colorToHex(color, opacity) {
  const a = opacity == null ? 1 : opacity;
  const base = '#' + toHex2(color.r) + toHex2(color.g) + toHex2(color.b);
  return a < 0.999 ? base + toHex2(a) : base;
}

// ── Apply a colour to every fillable layer in the selection ───────────────────
function applyFill(hex) {
  const c = parseHex(hex);
  const sel = figma.currentPage.selection;
  let n = 0;
  for (const node of sel) {
    if ('fills' in node) {
      node.fills = [{ type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a }];
      n++;
    }
  }
  figma.notify(n ? `Applied to ${n} layer${n > 1 ? 's' : ''}` : 'Select a layer to fill first');
}

// ── Read up to two solid colours from the selection (→ TEXT, BG) ───────────────
function readSelection() {
  const hexes = [];
  for (const node of figma.currentPage.selection) {
    if ('fills' in node && Array.isArray(node.fills)) {
      const solid = node.fills.find(f => f.type === 'SOLID' && f.visible !== false);
      if (solid) hexes.push(colorToHex(solid.color, solid.opacity));
    }
    if (hexes.length >= 2) break;
  }
  return hexes;
}

// ── Write the scale + themes as variable collections ──────────────────────────
function alias(id) { return { type: 'VARIABLE_ALIAS', id }; }
function createVariables(data) {
  const name = 'Relative Luminous';

  // Primitive tokens: the tonal scale (50–950) plus the base white/black the themes alias.
  const prim = figma.variables.createVariableCollection(name + ' · Primitives');
  const pMode = prim.modes[0].modeId;
  const scaleVars = {};
  for (const c of data.scale) {
    const v = figma.variables.createVariable(String(c.step), prim, 'COLOR');
    v.setValueForMode(pMode, figColor(c.hex));
    scaleVars[c.step] = v;
  }
  const baseVars = {};
  function baseVar(hex) {
    if (baseVars[hex]) return baseVars[hex];
    const nm = hex === '#ffffff' ? 'base/white' : hex === '#000000' ? 'base/black' : 'base/' + hex.slice(1);
    const v = figma.variables.createVariable(nm, prim, 'COLOR');
    v.setValueForMode(pMode, figColor(hex));
    return (baseVars[hex] = v);
  }

  function setRole(v, modeId, entry) {
    if (entry.step != null && scaleVars[entry.step]) v.setValueForMode(modeId, alias(scaleVars[entry.step].id));
    else if (entry.hex === '#ffffff' || entry.hex === '#000000') v.setValueForMode(modeId, alias(baseVar(entry.hex).id));
    else v.setValueForMode(modeId, figColor(entry.hex)); // literal fallback for any synthesized colour
  }

  // Semantic tokens: one variable per role, aliasing the primitives. Prefer a single
  // collection with Light + Dark MODES; on plans limited to one mode per collection (Starter),
  // addMode() throws — fall back to separate "· Semantic (Light)" / "· Semantic (Dark)" collections
  // so both themes still ship with symmetric names. Aliases can cross collections, so Dark still
  // references the same Primitives.
  const light = figma.variables.createVariableCollection(name + ' · Semantic');
  const lightMode = light.modes[0].modeId;
  light.renameMode(lightMode, 'Light');
  let darkColl = null, darkMode;
  try {
    darkMode = light.addMode('Dark');
  } catch (e) {
    light.name = name + ' · Semantic (Light)'; // mirror the separate Dark collection
    darkColl = figma.variables.createVariableCollection(name + ' · Semantic (Dark)');
    darkMode = darkColl.modes[0].modeId;
    darkColl.renameMode(darkMode, 'Dark');
  }
  for (const role of data.roles) {
    const vL = figma.variables.createVariable(role, light, 'COLOR');
    setRole(vL, lightMode, data.light[role]);
    if (darkColl) { const vD = figma.variables.createVariable(role, darkColl, 'COLOR'); setRole(vD, darkMode, data.dark[role]); }
    else setRole(vL, darkMode, data.dark[role]);
  }
  figma.notify(darkColl
    ? `Created “${name} · Primitives” + “· Semantic (Light)” + “· Semantic (Dark)” variables`
    : `Created “${name} · Primitives” + “· Semantic” (Light / Dark) variables`);
}

// ── Persistence (batched clientStorage writes) ────────────────────────────────
let state = {};
let flushTimer = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; figma.clientStorage.setAsync(STORE_KEY, state); }, 400);
}

// Window size persistence (separate key so it survives palette/preference clears).
let winSize = null;
let winFlushTimer = null;
function scheduleWinFlush() {
  if (winFlushTimer) return;
  winFlushTimer = setTimeout(() => { winFlushTimer = null; figma.clientStorage.setAsync(WIN_KEY, winSize); }, 400);
}

// ── Boot: load persisted state, inject it into the UI, show it ────────────────
(async () => {
  try { state = (await figma.clientStorage.getAsync(STORE_KEY)) || {}; } catch (e) { state = {}; }
  try { winSize = (await figma.clientStorage.getAsync(WIN_KEY)) || null; } catch (e) { winSize = null; }
  const start = clampWin(winSize && winSize.w ? winSize.w : 540, winSize && winSize.h ? winSize.h : 820);
  const html = __html__.replace('<!--__RLCW_INIT__-->',
    '<script>window.__RLCW_INIT__=' + JSON.stringify(state) + '</' + 'script>');
  figma.showUI(html, { width: start.w, height: start.h, themeColors: false });

  figma.ui.onmessage = (msg) => {
    if (!msg) return;
    switch (msg.type) {
      case 'persist':
        if (msg.value == null) delete state[msg.key]; else state[msg.key] = msg.value;
        scheduleFlush();
        break;
      case 'persist-clear':
        state = {}; scheduleFlush();
        break;
      case 'apply-fill':
        applyFill(msg.hex);
        break;
      case 'import-selection': {
        const hexes = readSelection();
        if (!hexes.length) { figma.notify('Select a layer with a solid fill first'); break; }
        const target = msg.target === 'bg' ? 'bg' : 'text';
        figma.ui.postMessage({ type: 'imported', target, hex: hexes[0] });
        figma.notify('Imported ' + (target === 'bg' ? 'BG' : 'TEXT') + ' from selection');
        break;
      }
      case 'create-variables':
        try { createVariables(msg.data); }
        catch (e) { figma.notify('Could not create variables: ' + (e && e.message ? e.message : e)); }
        break;
      case 'resize': {
        winSize = clampWin(msg.width, msg.height);
        figma.ui.resize(winSize.w, winSize.h);
        scheduleWinFlush();
        break;
      }
    }
  };
})();
