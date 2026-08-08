// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Set a numeric value with a unit suffix, wrapping the unit in a fixed-width span so
 *  digits stay visually aligned across rows regardless of unit character width (° vs %). */
function setUnitVal(el, num, unit) {
  if (/** @type {any} */ (el).tagName === 'INPUT') {
    if (document.activeElement !== el) /** @type {HTMLInputElement} */ (el).value = num + unit;
    return;
  }
  if (unit === '°') {
    el.innerHTML = `${num}<span class="fv-u fv-u--deg">°</span>`;
  } else {
    el.innerHTML = `${num}<span class="fv-u">${unit}</span>`;
  }
}

/** Update an editable input's value, skipping if it has focus (user is typing). */
function setValIfBlurred(id, str) {
  const el = document.getElementById(id);
  if (el && document.activeElement !== el) /** @type {HTMLInputElement} */ (el).value = str;
}

/**
 * Wire a text <input> as an editable numeric value.
 * Focus → select all; ↑/↓ → step; Enter → commit + blur; blur → commit.
 */
function wireValInput(input, min, max, step, parse, format, applyState, cyclic = false) {
  const constrain = cyclic
    ? v => ((Math.round(v) % (max + 1)) + (max + 1)) % (max + 1)
    : v => Math.max(min, Math.min(max, v));
  // Canonicalize a TYPED / stepped value to the field's displayed resolution before it becomes
  // state: store exactly what's shown (parse∘format), so the number you see is the number the app
  // uses — no hidden sub-display precision that would make the slider snap on the next touch.
  // Integer fields round-trip losslessly (unchanged); only fractional fields (e.g. luminance,
  // toFixed(3)) are affected. This is the field-as-INPUT path only; the readout path (updateUI
  // writing input.value from state set by the wheel/hex) keeps the state's full precision.
  const apply = v => { const c = constrain(v); const shown = format(c); input.value = shown; applyState(parse(shown)); };
  const commit = () => { const v = parse(input.value); apply(isFinite(v) ? v : min); };
  input.addEventListener('focus', () => input.select());
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = parse(input.value);
      const delta = (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1); // Shift = 10× the min unit
      apply((isFinite(cur) ? cur : 0) + delta);
    } else if (e.key === 'Enter') { commit(); input.blur(); }
  });
}

// ─── Keyboard: Shift+Arrow = 10× step on any range slider ─────────────────────
// Native <input type=range> already scrubs on pointer drag and moves by `step` on a bare Arrow.
// This adds the coarse increment: Shift+Arrow moves by 10× the minimum unit. Delegated at the
// document (capture) so it also covers sliders created on demand — the chip editor — and so the
// preventDefault beats the browser's native single-step. Arrow-without-Shift is left to the
// browser (its native `step`), and pointer scrubbing is native, so all three interactions work
// on every slider in the app: the wheel's Lum/Hue/Sat/Opacity, the custom-bg and chip-editor
// RGB/HSL/Lum/Gray/alpha channels, and the Preferences appearance sliders.
document.addEventListener('keydown', e => {
  const el = /** @type {HTMLInputElement} */ (e.target);
  if (!e.shiftKey || !(el instanceof HTMLInputElement) || el.type !== 'range') return;
  const dir = (e.key === 'ArrowUp' || e.key === 'ArrowRight') ? 1
            : (e.key === 'ArrowDown' || e.key === 'ArrowLeft') ? -1 : 0;
  if (!dir) return;
  e.preventDefault();
  const step = parseFloat(el.step) || 1;
  const lo = el.min === '' ? 0 : parseFloat(el.min);
  const hi = el.max === '' ? 100 : parseFloat(el.max);
  const cur = parseFloat(el.value) || 0;
  const next = Math.max(lo, Math.min(hi, cur + dir * step * 10));
  if (next !== cur) {
    el.value = String(next);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}, true);

// ─── Screen-reader labels for sliders (aria-label + live aria-valuetext) ──────
// A range input announces only a bare number by default. Give every slider a NAME and a
// HUMAN value (luminance 0–1, degrees, %, 0–255, % opacity) that updates on each input, so a
// screen reader speaks e.g. "Target relative luminance, 0.558" instead of "slider, 558". The
// context (main colour / background / page underlay / chip-editor colour) comes from the id,
// data-uch / data-ch attribute, or class; keyed off those so it also covers the sliders the
// chip editor builds on demand (handled by the delegated input/focusin listeners below).
function _sliderAria(el) {
  const id = el.id || '', uch = el.dataset.uch, ch = el.dataset.ch, cls = el.className || '';
  const v = +el.value;
  const deg = v + '°', pct = v + '%', byte = String(v), lum = (v / 1000).toFixed(3), op = v + '% opacity';
  if (/custom-alpha-slider/.test(cls)) return { label: 'Background opacity', vt: op };
  if (/ce-alpha-range/.test(cls))      return { label: 'Color opacity', vt: op };
  if (id === 'lum-slider')          return { label: 'Target relative luminance', vt: lum };
  if (id === 'hue-slider')          return { label: 'Hue', vt: deg };
  if (id === 'sat-slider')          return { label: 'Saturation', vt: pct };
  if (id === 'alpha-slider')        return { label: 'Opacity', vt: op };
  if (id === 'ui-hue-slider')        return { label: 'Interface hue', vt: null };
  if (id === 'ui-sat-slider')        return { label: 'Interface saturation', vt: null };
  if (id === 'ui-brightness-slider') return { label: 'Interface brightness', vt: null };
  // Channel sliders: resolve a context prefix + the channel's name and formatter.
  let ctx = '', key = '';
  if (uch != null)      { ctx = 'Page underlay '; key = uch; }
  else if (ch != null)  { ctx = 'Color ';         key = ch;  }
  else if (/^cu?-/.test(id)) { ctx = 'Background '; key = id.replace(/^cu?-/, '').replace('-slider', ''); }
  else return { label: el.getAttribute('aria-label') || 'Slider', vt: null };
  const M = {
    r: ['red', byte], g: ['green', byte], b: ['blue', byte], gray: ['gray', byte],
    h: ['hue', deg], hue: ['hue', deg], uhue: ['hue', deg], chue: ['hue', deg],
    s: ['saturation', pct], sat: ['saturation', pct], usat: ['saturation', pct], csat: ['saturation', pct],
    l: ['lightness', pct],
    lum: ['luminance', lum], ulum: ['luminance', lum], clum: ['luminance', lum],
  };
  const m = M[key];
  return m ? { label: ctx + m[0], vt: m[1] } : { label: (ctx + 'value').trim(), vt: null };
}
function _labelSlider(el) {
  const { label, vt } = _sliderAria(el);
  if (label && el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
  if (vt != null && el.getAttribute('aria-valuetext') !== vt) el.setAttribute('aria-valuetext', vt);
}
// Live-update valuetext on input; ensure label+valuetext on focus (covers on-demand sliders).
document.addEventListener('input',   e => { const el = e.target; if (el instanceof HTMLInputElement && el.type === 'range') _labelSlider(el); }, true);
document.addEventListener('focusin', e => { const el = e.target; if (el instanceof HTMLInputElement && el.type === 'range') _labelSlider(el); });
document.querySelectorAll('input[type="range"]').forEach(_labelSlider); // initial pass (static sliders)

// ─── Live region: announce the main pair's contrast to screen readers ─────────
// A visually-hidden aria-live="polite" region speaks the primary result — selected TEXT on the
// custom BACKGROUND — so a non-sighted user hears the ratio/verdict change as they adjust. It's
// debounced (announce only the settled value) and de-duplicated so a drag doesn't flood output;
// this reads the SAME rendered numbers the sighted tile shows, so they can never disagree.
let _announceTimer = null, _lastAnnounce = '';
function announceContrast(text) {
  if (!text || text === _lastAnnounce) return;
  clearTimeout(_announceTimer);
  _announceTimer = setTimeout(() => {
    const el = document.getElementById('a11y-live');
    if (!el) return;
    _lastAnnounce = text;
    el.textContent = text;
  }, 400);
}

// ─── Debounced localStorage writes ────────────────────────────────────────────
// Slider drags fire input events at up to display refresh rate, and
// localStorage.setItem is synchronous I/O. Batch writes and flush shortly
// after the last change; pagehide flush keeps state safe on tab close.
const _lsPending = new Map();
let _lsTimer = null;

function flushStorage() {
  if (_lsTimer !== null) { clearTimeout(_lsTimer); _lsTimer = null; }
  for (const [k, v] of _lsPending) {
    try { localStorage.setItem(k, v); } catch (e) {}
  }
  _lsPending.clear();
}

function saveToStorage(key, value) {
  _lsPending.set(key, value);
  if (_lsTimer === null) _lsTimer = setTimeout(flushStorage, 300);
}

window.addEventListener('pagehide', flushStorage);

// ─── Constants ────────────────────────────────────────────────────────────────

const CSS_SZ   = 420;
const IS_COARSE = window.matchMedia('(pointer: coarse)').matches;
const DPR       = Math.min(window.devicePixelRatio || 1, IS_COARSE ? 1.5 : 2);
// Buffer sizes must be integers: fractional DPR (browser zoom / scaled displays)
// would make the ImageData pixel index (py * width + px) * 4 non-integer, and
// TypedArray writes to non-integer indices are silently dropped.
const BUF_SZ    = Math.round(CSS_SZ * DPR);
const R_CSS  = 200;
const R_BUF  = R_CSS * DPR;

// ─── Canvas setup ─────────────────────────────────────────────────────────────

const wheelCanvas   = /** @type {HTMLCanvasElement} */ (document.getElementById('wheel'));
const overlayCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById('overlay'));
wheelCanvas.width   = overlayCanvas.width  = BUF_SZ;
wheelCanvas.height  = overlayCanvas.height = BUF_SZ;

const oCtx = /** @type {CanvasRenderingContext2D} */ (overlayCanvas.getContext('2d'));
oCtx.scale(DPR, DPR);

// ─── CPU color math ────────────────────────────────────────────────────────────

const LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const n = i / 255;
  LINEAR[i] = n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
}

/** @param {number} h 0–360  @param {number} s 0–1  @param {number} l 0–1 */
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const h6 = h / 60, x = c * (1 - Math.abs(h6 % 2 - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if      (h6 < 1) { r = c; g = x; }
  else if (h6 < 2) { r = x; g = c; }
  else if (h6 < 3) { g = c; b = x; }
  else if (h6 < 4) { g = x; b = c; }
  else if (h6 < 5) { r = x; b = c; }
  else             { r = c; b = x; }
  return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
}

function relativeLuminance(r, g, b) {
  return 0.2126 * LINEAR[r] + 0.7152 * LINEAR[g] + 0.0722 * LINEAR[b];
}

/** The luminance definition the wheels (and their lightness solvers) equalize
    on: WCAG 2.2 relative luminance normally, APCA screen luminance Ys while the
    APCA contrast mode is active — so in APCA mode every colour on a wheel
    shares the same APCA Ys instead. (apcaY is hoisted; contrastLockMode is
    'off' until the user touches the mode switch, long after module init.) */
function wheelLum(r, g, b) {
  return contrastLockMode === 'apca' ? apcaY(r, g, b) : relativeLuminance(r, g, b);
}

function contrastRatio(l1, l2) {
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Binary search: find HSL lightness so wheelLum(hsl(H,S,L)) ≈ target
 * (WCAG relative luminance, or APCA Ys in APCA mode).
 * L=0→black(0), L=1→white(1) for any H,S — every target is reachable.
 */
function findLightness(h, s, target) {
  // Endpoints are hue/sat-independent and exact: hsl(h,s,1) is white (lum 1) and
  // hsl(h,s,0) is black (lum 0) for any h,s. Return them directly — otherwise the
  // bisection's `<` comparison settles a rounding step BELOW the target at the top,
  // so a max-luminance pick (e.g. the underlay Lum slider fully right) landed on
  // #FEFEFE instead of #FFFFFF.
  if (target >= 1) return 1;
  if (target <= 0) return 0;
  let lo = 0, hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) * 0.5;
    const [r, g, b] = hslToRgb(h, s, mid);
    if (wheelLum(r, g, b) < target) lo = mid; else hi = mid;
  }
  // Return hi, not the (lo,hi] midpoint: the loop keeps lumAt(lo) < target ≤ lumAt(hi), so hi is
  // the smallest lightness whose QUANTIZED colour reaches the target — for a colour fed back as
  // (H, S, its own luminance) that lands exactly on its own step. The midpoint straddles the step
  // boundary and quantizes to either side unpredictably, shifting ~50% of inputs by one 8-bit step.
  return hi;
}

/**
 * findLightness, then nudge so the *quantized* integer-RGB color's luminance
 * lands on the `dir` side of target (+1 → ≥ target, −1 → ≤ target, 0 → as is).
 * Rounding to 8-bit RGB scatters the achieved luminance ±~0.002 around the
 * target with a hue-dependent sign; judged against a background sitting
 * exactly on a contrast boundary, that sign flip makes pass/fail flicker
 * while sweeping hue/sat. Biasing the rounding away from the compared side
 * keeps the achieved contrast at-or-above the continuous target instead.
 */
function findLightnessBiased(h, s, target, dir, alpha, overRgb) {
  const translucent = alpha != null && alpha < 0.9995 && overRgb;
  // lumAt(l): the mode-aware luminance (WCAG relLum / APCA Ys) of the rendered — and, when
  // translucent, sRGB-composited over overRgb — 8-bit color, i.e. the actual on-screen pixel.
  // tgt: the target in that same (composited) space. The RGB composite drifts with hue (unlike
  // the hue-invariant gray-space anchor the lock holds), so biasing the OPAQUE luminance alone
  // let the composited contrast dip below the floor on a hue/sat sweep — biasing on the
  // composite closes that gap. Opaque colors take the plain luminance path.
  const lumAt = translucent
    ? l => wheelLum(...compositeRgb(hslToRgb(h, s, l), alpha, overRgb))
    : l => wheelLum(...hslToRgb(h, s, l));
  const tgt = translucent
    ? (contrastLockMode === 'apca' ? compositeYs : compositeRelLum)(target, alpha, wheelLum(...overRgb))
    : target;
  // Bisect the lightness whose (composited) luminance ≈ tgt; endpoints (black/white) are exact.
  let l;
  if (tgt >= lumAt(1)) l = 1;
  else if (tgt <= lumAt(0)) l = 0;
  else { let lo = 0, hi = 1; for (let i = 0; i < 22; i++) { const m = (lo + hi) * 0.5; if (lumAt(m) < tgt) lo = m; else hi = m; } l = hi; } // hi is the ≥tgt side (not the step-straddling midpoint) — see findLightness
  if (!dir) return l;
  // Nudge so the QUANTIZED (composited) luminance is on the dir side of the target — 8-bit
  // rounding otherwise scatters it with a hue-dependent sign, dipping the contrast.
  const STEP = 1 / 512;
  for (let i = 0; i < 12; i++) {
    if (dir > 0 ? lumAt(l) >= tgt : lumAt(l) <= tgt) break;
    const next = Math.max(0, Math.min(1, l + dir * STEP));
    if (next === l) break; // hit black/white — can't go further
    l = next;
  }
  return l;
}

/** The rendered selected (wheel) color: quantization biased away from the custom background's
    luminance so the fg:bg contrast never dips below what the continuous target promises, for
    any hue/sat. When the wheel color is translucent it's biased on its sRGB composite over the
    effective background (bg over the page underlay), so the COMPOSITED contrast holds too. */
function selectedRgbBiased() {
  const effBg = effBgRgb([cR, cG, cB], cAlpha);        // what the text actually composites over
  const dir = Math.sign(targetLum - wheelLum(...effBg));
  const over = selAlpha < 0.9995 ? effBg : null;
  return hslToRgb(selHue, selSat, findLightnessBiased(selHue, selSat, targetLum, dir, selAlpha, over));
}

function toHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ─── Alpha / hex8 / compositing ───────────────────────────────────────────────
// Colours carry an optional alpha (0–1). It's encoded as an 8-digit hex only when
// translucent (#rrggbbAA); fully opaque stays 6-digit (backward compatible — old
// saves / links parse as opaque). Contrast composites a translucent colour over
// its background in sRGB (matching how CSS paints rgba over an opaque layer).
// Page underlay a translucent BG composites over for contrast (and swatch
// display). Elements are mutated in place by the Preferences underlay picker.
const underlayRgb = [255, 255, 255];

/** 8-digit hex when a<1, else 6-digit. r,g,b are 0–255 ints; a is 0–1. */
function toHexA(r, g, b, a) {
  if (a == null || a >= 0.9995) return toHex(r, g, b);
  const aa = Math.round(a * 255).toString(16).padStart(2, '0');
  return (toHex(r, g, b) + aa).toUpperCase();
}
/** Normalize a typed hex to full form. Accepts 3/4/6/8 hex digits with an optional
    leading #; 3→#rrggbb and 4→#rrggbbaa expand each digit (e.g. fc0 → #ffcc00,
    #f00a → #ff0000aa). Returns null if not a valid hex length/charset. */
function normalizeHexInput(str) {
  let h = String(str).trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(h)) return null;
  if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
  return (h.length === 6 || h.length === 8) ? '#' + h : null;
}
/** Live-display sanitize for a hex INPUT field while the user types: keep only hex digits
    (dropping any typed '#'/junk), cap to `maxDigits`, and re-add the leading '#' ONLY when the
    "Include # in hex" preference is on — so the field never shows a '#' mid-typing while the
    option is off. Feed the result to normalizeHexInput (which ignores a leading '#') to validate. */
function sanitizeHexField(raw, maxDigits) {
  let d = raw.replace(/[^0-9a-fA-F]/g, '');
  if (d.length > maxDigits) d = d.slice(0, maxDigits);
  return (stripHash ? '' : '#') + d.toUpperCase();
}
/** Parse #rgb6 or #rgb8 → [r,g,b,a] (a is 0–1; 1 when no alpha given). */
function hexToRgba(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = hexToRgb('#' + h.slice(0, 6));
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return [r, g, b, a];
}
/** Composite a colour (fgRgb at alpha a) over an opaque bgRgb, in sRGB. */
function compositeRgb(fgRgb, a, bgRgb) {
  if (a >= 0.9995) return [fgRgb[0], fgRgb[1], fgRgb[2]];
  return [0, 1, 2].map(i => Math.round(fgRgb[i] * a + bgRgb[i] * (1 - a)));
}
/** A background's effective opaque colour: itself if opaque, else over the white page. */
function effBgRgb(bgRgb, bgA) { return compositeRgb(bgRgb, bgA, underlayRgb); }

// ── Hue-invariant (luminance-space) compositing for the contrast ANCHORS ─────
// A luminance-locked colour has the same luminance at every hue, but compositing
// it (translucent) over a background mixes RGB channels, so the composited
// luminance would still drift with hue. For the anchor-based status we therefore
// composite the GRAY equivalents of the held luminances — hue-invariant by
// construction, so a Lum-picker hue/sat sweep can't shift the verdict.
function grayForRelLum(L) { // sRGB gray channel (0–255) with WCAG relative luminance L
  L = Math.max(0, Math.min(1, L));
  const c = L <= 0.0031308 ? L * 12.92 : 1.055 * Math.pow(L, 1 / 2.4) - 0.055;
  return c * 255;
}
function compositeRelLum(fgL, a, bgL) { // composited relative luminance (gray-space)
  if (a >= 0.9995) return fgL;
  const g = grayForRelLum(fgL) * a + grayForRelLum(bgL) * (1 - a); // 0–255 gray, non-integer
  // The gray channel is fractional, so linearize it directly — relativeLuminance()
  // indexes the integer LINEAR LUT (LINEAR[160.6] → undefined → NaN). For a gray the
  // three luminance weights sum to 1, so its luminance IS the linearized channel.
  const n = g / 255;
  return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
}
function grayForYs(ys) { return Math.pow(Math.max(0, Math.min(1, ys)), 1 / 2.4) * 255; } // APCA Ys is a plain 2.4 power
// Convert a continuous target luminance between the WCAG-relLum and APCA-Ys metrics via its
// gray equivalent — invertible, so a WCAG↔APCA round-trip maps a level back to itself. Used as
// the search start when re-solving the target on a mode switch so the contrast floor stays put.
function relLumToYs(L) { const g = grayForRelLum(L) / 255; return Math.pow(Math.max(0, Math.min(1, g)), 2.4); }
function ysToRelLum(ys) { const n = grayForYs(ys) / 255; return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); }
// A held anchor (targetLum / cuLum) is stored in the ACTIVE metric — APCA Ys in APCA mode, else
// relative luminance. Persistence and share URLs carry no metric tag and always restore in WCAG
// mode, so normalise to relative luminance on write; otherwise a value saved in APCA mode is
// mis-read as relative luminance on reload and the restored colour drifts darker.
function relLumOf(anchor) { return contrastLockMode === 'apca' ? ysToRelLum(anchor) : anchor; }
function compositeYs(fgYs, a, bgYs) { // composited APCA screen luminance (gray-space)
  if (a >= 0.9995) return fgYs;
  const g = grayForYs(fgYs) * a + grayForYs(bgYs) * (1 - a);
  return apcaY(g, g, g);
}

let currentCvd = '';

const CVD_MATRICES = {
  protan: [
    0.152286, 1.052583, -0.204868,
    0.114503, 0.786281, 0.099216,
    -0.003882, -0.048116, 1.051998
  ],
  deutan: [
    0.367322, 0.860646, -0.227968,
    0.280085, 0.672501, 0.047413,
    -0.011820, 0.042940, 0.968881
  ],
  tritan: [
    1.255528, -0.076749, -0.178779,
    -0.078411, 0.930809, 0.147602,
    0.004733, 0.691367, 0.303900
  ]
};

// The simulation is applied HERE, in the app's own rendering (every canvas
// pixel loop, inline style, and theme variable goes through these), NOT via a
// CSS/SVG reference filter on a wrapper. A `filter: url(#...)` ancestor filter
// silently skips hardware-composited descendant layers on iOS WebKit (the WebGL
// wheel, scrollable poppers, transitioned thumbs all escaped it), so self-
// rendered transforms are the only approach that behaves identically on every
// engine. Machado et al. 2009 matrices, applied in linear-light space.
function cvdTransformRgb(r, g, b) {
  if (!currentCvd) return [r, g, b];
  const m = CVD_MATRICES[currentCvd];
  if (!m) return [r, g, b];

  const lr = LINEAR[r];
  const lg = LINEAR[g];
  const lb = LINEAR[b];

  const nr = m[0] * lr + m[1] * lg + m[2] * lb;
  const ng = m[3] * lr + m[4] * lg + m[5] * lb;
  const nb = m[6] * lr + m[7] * lg + m[8] * lb;

  const toSRGB = n => {
    const c = n <= 0.0031308 ? n * 12.92 : 1.055 * Math.pow(n, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
  };

  return [toSRGB(nr), toSRGB(ng), toSRGB(nb)];
}

function cvdTransformHex(hex) {
  if (!currentCvd) return hex;
  const [r, g, b] = hexToRgb(hex);
  const [tr, tg, tb] = cvdTransformRgb(r, g, b);
  return toHex(tr, tg, tb);
}

function cvdTransformRgba(rgbaStr) {
  if (!currentCvd) return rgbaStr;
  const m = rgbaStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return rgbaStr;
  const r = parseInt(m[1], 10);
  const g = parseInt(m[2], 10);
  const b = parseInt(m[3], 10);
  const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
  const [tr, tg, tb] = cvdTransformRgb(r, g, b);
  return `rgba(${tr}, ${tg}, ${tb}, ${a})`;
}



function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0)
          : max === g ? (b - r) / d + 2
          :             (r - g) / d + 4;
  return [h * 60, s, l];
}

/** Parse a '#RRGGBB' hex string to [r, g, b] 0–255. */
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * 8-bit sRGB → OKLCH, returning [L 0–1, C ≥ 0, H° 0–360].
 * Linearizes via the shared LINEAR LUT, then applies Björn Ottosson's OKLab
 * transform (linear-sRGB → LMS → OKLab) and converts OKLab a/b to chroma/hue.
 * Used only for exports; the wheel/contrast math stays in sRGB.
 */
function rgbToOklch(r, g, b) {
  const lr = LINEAR[r], lg = LINEAR[g], lb = LINEAR[b];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  const C = Math.hypot(a, bb);
  let H = Math.atan2(bb, a) * 180 / Math.PI;
  if (H < 0) H += 360;
  return [L, C, C < 1e-4 ? 0 : H]; // achromatic → hue undefined, normalize to 0
}

// Verdict-badge colours — FIXED (independent of the app theme) because they render on the preview
// TILES (white / black / the user's colour), not the UI surface. Each has a bright and a dark
// variant; the badge renderer picks whichever reads on that tile. These mirror the CSS
// --pass / --error theme values — one source in JS so the (previously triplicated) literals and
// their luminance derivations can't drift apart again.
const PASS_GREEN = '#5dde8a', PASS_GREEN_DK = '#1a7a42';
const FAIL_RED   = '#ff7076', FAIL_RED_DK   = '#b3261e';

/**
 * OKLCH [L 0–1, C ≥ 0, H° 0–360] → 8-bit sRGB [r,g,b], the inverse of rgbToOklch
 * (Ottosson OKLab → linear-sRGB → gamma). Out-of-gamut results are clamped per
 * channel; callers that must hit a target luminance search L against the clamped
 * relativeLuminance, so the pin still holds. Used by the scale/tone generator.
 */
function oklchToRgb(L, C, H) {
  const hr = H * Math.PI / 180;
  const a = C * Math.cos(hr), bb = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * bb;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  const lr =  4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const g = v => {
    v = Math.max(0, Math.min(1, v));
    return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
  };
  return [g(lr), g(lg), g(lb)];
}

/** OKLCH as a CSS oklch() string, e.g. 'oklch(62.79% 0.2577 29.23)'. An 8-digit
    hex adds an alpha: 'oklch(… / 0.5)'. */
function oklchCss(hex) {
  const [L, C, H] = rgbToOklch(...hexToRgb(hex));
  const a = hexToRgba(hex)[3];
  const base = `oklch(${(L * 100).toFixed(2)}% ${C.toFixed(4)} ${H.toFixed(2)}`;
  return a < 0.9995 ? `${base} / ${+a.toFixed(3)})` : `${base})`;
}

/** OKLCH as a DTCG color-object `components` array [L, C, H] with tidy precision. */
function oklchComponents(hex) {
  const [L, C, H] = rgbToOklch(...hexToRgb(hex));
  return [+L.toFixed(4), +C.toFixed(4), +H.toFixed(2)];
}
// Same, but for the DTCG export: an achromatic colour's hue is POWERLESS, so emit "none" (per
// CSS Color 4 / DTCG 2025.10) — safer than 0, which some tools interpolate as red.
function oklchComponentsDTCG(hex) {
  const c = oklchComponents(hex);
  if (c[1] < 0.0005) c[2] = 'none';
  return c;
}


/**
 * Return a foreground color (near-black or near-white) that contrasts with bgLum.
 * Threshold ≈ 0.179 is where black and white have equal contrast ratio.
 */
function getForeground(bgLum) {
  return bgLum > 0.179 ? '#111111' : '#eeeeee';
}

// ─── APCA (experimental) ──────────────────────────────────────────────────────
// APCA-W3 0.0.98G-4g. Lc is signed: positive for dark-on-light, negative for
// light-on-dark. Drives the per-tile Lc readouts and the APCA contrast
// lock; evaluation always uses |Lc|. WCAG 2.2 remains the normative standard
// (APCA is a WCAG 3 working-draft candidate, not yet finalized).

function apcaY(r, g, b) {
  const c = v => Math.pow(v / 255, 2.4);
  return 0.2126729 * c(r) + 0.7151522 * c(g) + 0.0721750 * c(b);
}

/** APCA-W3 Lc from raw screen luminances (Ys). Shared by the RGB path (apcaLc) and the
    contrast lock's gray-space solve/metric. */
function apcaLcYs(YtRaw, YbRaw) {
  const soft = Y => (Y <= 0.022 ? Y + Math.pow(0.022 - Y, 1.414) : Y);
  const Yt = soft(YtRaw);
  const Yb = soft(YbRaw);
  if (Math.abs(Yb - Yt) < 0.0005) return 0;
  if (Yb > Yt) {
    const S = (Math.pow(Yb, 0.56) - Math.pow(Yt, 0.57)) * 1.14;
    return S < 0.1 ? 0 : (S - 0.027) * 100;
  }
  const S = (Math.pow(Yb, 0.65) - Math.pow(Yt, 0.62)) * 1.14;
  return S > -0.1 ? 0 : (S + 0.027) * 100;
}

function apcaLc(txtRgb, bgRgb) {
  return apcaLcYs(apcaY(...txtRgb), apcaY(...bgRgb));
}

/** The custom BG's continuous (pre-quantization) wheel-luminance anchor: the
    Lum-mode value, the hue/sat hold anchor while it matches the current colour,
    or the live colour's luminance otherwise. In APCA mode wheelLum ≡ apcaY, so
    this is an APCA Ys. */
function bgLumAnchor() {
  if (customMode === 'lum') return cuLum;
  if (_bgHeldRgb === cR + ',' + cG + ',' + cB) return _bgHeldLum;
  return wheelLum(cR, cG, cB);
}

/** Anchor-based Lc for a tile in APCA mode. The 8-bit RGB quantization makes
    the per-hex Lc wobble ~±0.7 as hue/sat sweep even though the CONTINUOUS
    luminances are held exactly — enough to flick the usage tier and required
    text size near their thresholds. The APCA readouts therefore judge the
    continuous anchor pair (targetLum is the wheel's Ys anchor in APCA mode;
    white/black are exact), which is hue/sat-invariant by construction and
    moves only when a luminance actually changes (Lum/RGB edits, lock repins). */
function apcaAnchorLc(tile) {
  if (contrastLockMode !== 'apca') return undefined;
  const uY = apcaY(...underlayRgb);
  // Composite the held Ys anchors (gray-space) so alpha lowers |Lc| without the
  // hue-dependence of RGB compositing. Opaque → compositeYs is a no-op.
  if (tile === 'pvw') return apcaLcYs(compositeYs(targetLum, selAlpha, 1), 1);
  if (tile === 'pvb') return apcaLcYs(compositeYs(targetLum, selAlpha, 0), 0);
  if (tile === 'pa') { // text = wheel on bg = custom
    const bY = compositeYs(bgLumAnchor(), cAlpha, uY);
    return apcaLcYs(compositeYs(targetLum, selAlpha, bY), bY);
  }
  // 'pb' — text = custom on bg = wheel
  const bY = compositeYs(targetLum, selAlpha, uY);
  return apcaLcYs(compositeYs(bgLumAnchor(), cAlpha, bY), bY);
}


// ─── APCA font-size/weight lookup (v2 beta) ──────────────────────────────────
// fontMatrixAscend from the official apca-w3 package: for each |Lc| row, the
// minimum font px per weight 100–900. 999 = text prohibited at this contrast,
// 777 = spot/non-text only. Between rows the minimum size is interpolated
// linearly; a sentinel in the lower bracketing row wins (conservative).
const APCA_FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const APCA_FONT_MATRIX = [
  [0,   [999,999,999,999,999,999,999,999,999]],
  [10,  [999,999,999,999,999,999,999,999,999]],
  [15,  [777,777,777,777,777,777,777,777,777]],
  [20,  [777,777,777,777,777,777,777,777,777]],
  [25,  [777,777,777,120,120,108,96,96,96]],
  [30,  [777,777,120,108,108,96,72,72,72]],
  [35,  [777,120,108,96,72,60,48,48,48]],
  [40,  [120,108,96,60,48,42,32,32,32]],
  [45,  [108,96,72,42,32,28,24,24,24]],
  [50,  [96,72,60,32,28,24,21,21,21]],
  [55,  [80,60,48,28,24,21,18,18,18]],
  [60,  [72,48,42,24,21,18,16,16,18]],
  [65,  [68,46,32,21.75,19,17,15,16,18]],
  [70,  [64,44,28,19.5,18,16,14.5,16,18]],
  [75,  [60,42,24,18,16,15,14,16,18]],
  [80,  [56,38.25,23,17.25,15.81,14.81,14,16,18]],
  [85,  [52,34.5,22,16.5,15.625,14.625,14,16,18]],
  [90,  [48,32,21,16,15.5,14.5,14,16,18]],
  [95,  [45,28,19.5,15.5,15,14,13.5,16,18]],
  [100, [42,26.5,18.5,15,14.5,13.5,13,16,18]],
  [105, [39,25,18,14.5,14,13,12,16,18]],
  [110, [36,24,18,14,13,12,11,16,18]],
  [115, [34.5,22.5,17.25,12.5,11.875,11.25,10.625,14.5,16.5]],
  [120, [33,21,16.5,11,10.75,10.5,10.25,13,15]],
  [125, [32,20,16,10,10,10,10,12,14]],
];

/** Minimum font px for |Lc| at `weight`; 999 = prohibited, 777 = non-text only. */
function apcaMinFontSize(lcAbs, weight) {
  const wi = APCA_FONT_WEIGHTS.indexOf(weight);
  if (wi < 0) return 999;
  const rows = APCA_FONT_MATRIX;
  // Apply the usage ladder's 0.3-tolerance to the lookup: the matrix rows sit
  // on the named Lc levels (90/75/60/45/30/15) while the usage tier switches
  // into each level 0.3 early (89.7/74.7/…, see apcaUsageTier). Reading the
  // matrix at |Lc|+0.3 makes a level's minimum sizes become valid at exactly
  // the |Lc| where the tier enters that level, so the usage label and the
  // font-size verdict flip together instead of ~0.3 Lc apart. The low
  // 14.7/29.7 gates in apcaFontVerdict were already aligned this way; this
  // extends the same alignment across the whole table.
  const lc = lcAbs + 0.3;
  if (lc <= rows[0][0]) return rows[0][1][wi];
  if (lc >= rows[rows.length - 1][0]) return rows[rows.length - 1][1][wi];
  let i = 0;
  while (rows[i + 1][0] <= lc) i++;
  const [la, va] = rows[i], [lb, vb] = rows[i + 1];
  const a = va[wi], b = vb[wi];
  if (a >= 777 || b >= 777) return a; // sentinel holds until the numeric row is reached
  return a + (b - a) * (lc - la) / (lb - la);
}

/** Reverse of the font matrix — the smallest |Lc| at which `size` px is allowed
    for `weight` (apcaMinFontSize(lc) ≤ size). Since the minimum size decreases
    monotonically with |Lc|, binary-search the boundary. Returns null when no |Lc|
    up to the table max renders it (e.g. very small sizes at thin weights). Drives
    the "Type" contrast lock: pick a font, lock to the Lc it needs. */
function apcaLcForFont(size, weight) {
  const HI = APCA_FONT_MATRIX[APCA_FONT_MATRIX.length - 1][0]; // 125
  if (apcaMinFontSize(HI, weight) > size) return null;
  let lo = 0, hi = HI;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    if (apcaMinFontSize(mid, weight) <= size) hi = mid; else lo = mid;
  }
  return hi;
}

// v2 beta: the font the APCA verdicts judge against (persisted). The
// selectors live inside each tile (in the WCAG chips' slot), synchronized.
const APCA_FONT_SIZES = [10, 12, 14, 15, 16, 18, 21, 24, 28, 32, 36, 42, 48, 60, 72, 96];
let apcaFontSize = (() => { const v = parseFloat(localStorage.getItem('apca-font-px') ?? '16'); return APCA_FONT_SIZES.includes(v) ? v : 16; })();
let apcaFontWeight = (() => { const v = parseInt(localStorage.getItem('apca-font-wght') ?? '400', 10); return APCA_FONT_WEIGHTS.includes(v) ? v : 400; })();
// Bridge so the per-tile font selectors can refresh the "Type" APCA lock (its
// wiring lives in the contrast-lock IIFE below). No-op until that IIFE assigns it.
let syncApcaTypeControls = () => {};

/** Official APCA usage-level ladder (verbatim from the reference tool at
    apcacontrast.com, including its 0.3-tolerance thresholds). */
function apcaUsageTier(lcAbs) {
  if (lcAbs > 89.7) return 'SMALL BODY TEXT ONLY';
  if (lcAbs > 74.7) return 'BODY TEXT OKAY';
  if (lcAbs > 59.7) return 'FLUENT TEXT OKAY';
  if (lcAbs > 44.7) return 'LARGE & SUB-FLUENT TEXT';
  if (lcAbs > 29.7) return 'SPOT & NON TEXT ONLY';
  if (lcAbs > 14.7) return '\u{1F6AB} NO TEXT USAGE';
  return 'INVISIBLE';
}

/** Verdict for the chosen font size/weight at |Lc| — shared by the main
    contrast tiles and the palette chip editor so both always agree.
    The reference tool gates the whole font table before the lookup
    matrix: below the hard minimum nothing is usable, and below the
    any-text floor every weight renders as non-text — matrix sentinels
    (999/777) only matter past those gates. The gate values use the
    usage ladder's 0.3-tolerance thresholds (14.7 / 29.7) rather than
    the tool's internal 15 / 29.8, so this verdict and the tier row
    always switch on exactly the same |Lc|.
    No `min >= 999` branch here: the 999 rows live entirely below the Lc-15
    hard minimum, but the sentinel-holding lookup can still return 999
    in the 14.7–15 band — which must read as the NO-TEXT zone (spot &
    non-text) to stay in lockstep with the tier row. */
function apcaFontVerdict(lcAbs) {
  const min = apcaMinFontSize(lcAbs, apcaFontWeight);
  const label = apcaFontSize + 'px/' + apcaFontWeight;
  let pass = false, text, title;
  if (lcAbs <= 14.7) {
    text = '✗ ' + label + ' — contrast too low: not usable for anything';
    title = 'APCA: |Lc| ' + lcAbs.toFixed(0) + ' is below the Lc 15 hard minimum — invisible; too low for any use, text or non-text';
  } else if (lcAbs <= 29.7) {
    // The NO-TEXT band: NOT even spot text — only non-text elements
    // (icons, dividers, large UI shapes) are sanctioned here.
    text = '✗ ' + label + ' — no text at any size: non-text elements only';
    title = 'APCA: |Lc| ' + lcAbs.toFixed(0) + ' is below the any-text floor (Lc ~30) — no text of any size or weight, including spot text; usable for non-text elements only';
  } else if (min >= 777) {
    text = '✗ ' + label + ' — this weight: spot text & non-text only';
    title = 'APCA: at |Lc| ' + lcAbs.toFixed(0) + ', weight ' + apcaFontWeight + ' has no fluent-text size — usable for spot text and non-text elements only';
  } else if (apcaFontSize >= min - 1e-9) {
    pass = true;
    text = '✓ ' + label;
    title = 'APCA: ' + label + ' meets the minimum size (' + (Math.ceil(min * 2) / 2) + 'px) for |Lc| ' + lcAbs.toFixed(0);
  } else {
    text = '✗ ' + label + ' (needs ≥' + (Math.ceil(min * 2) / 2) + 'px)';
    title = 'APCA: at |Lc| ' + lcAbs.toFixed(0) + ', weight ' + apcaFontWeight + ' needs at least ' + (Math.ceil(min * 2) / 2) + 'px';
  }
  return { text, title, pass };
}

// ─── WebGL wheel renderer ──────────────────────────────────────────────────────

const VS_SRC = /* glsl */`
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FS_SRC = /* glsl */`
precision highp float;
uniform float uLum;
uniform float uRadius;
uniform vec2  uCenter;
uniform mat3  uCvdMatrix;
uniform float uCvdActive;
uniform float uApcaLum; // 1.0 → equalize APCA Ys instead of WCAG luminance

float sL(float c) {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}
float lum(vec3 c) {
  if (uApcaLum > 0.5) {
    // APCA screen luminance: simple 2.4 power, APCA coefficients
    return 0.2126729 * pow(c.r, 2.4) + 0.7151522 * pow(c.g, 2.4) + 0.0721750 * pow(c.b, 2.4);
  }
  return 0.2126 * sL(c.r) + 0.7152 * sL(c.g) + 0.0722 * sL(c.b);
}
vec3 hsl(float h, float s, float l) {
  float c  = (1.0 - abs(2.0 * l - 1.0)) * s;
  float h6 = h / 60.0;
  float x  = c * (1.0 - abs(mod(h6, 2.0) - 1.0));
  float m  = l - c * 0.5;
  if      (h6 < 1.0) return clamp(vec3(c+m, x+m,   m), 0., 1.);
  else if (h6 < 2.0) return clamp(vec3(x+m, c+m,   m), 0., 1.);
  else if (h6 < 3.0) return clamp(vec3(  m, c+m, x+m), 0., 1.);
  else if (h6 < 4.0) return clamp(vec3(  m, x+m, c+m), 0., 1.);
  else if (h6 < 5.0) return clamp(vec3(x+m,   m, c+m), 0., 1.);
  else               return clamp(vec3(c+m,   m, x+m), 0., 1.);
}

void main() {
  vec2  d    = vec2(gl_FragCoord.x - uCenter.x, -(gl_FragCoord.y - uCenter.y));
  float dist = length(d);
  if (dist > uRadius + 1.0) { gl_FragColor = vec4(0.0); return; }

  float sat = clamp(dist / uRadius, 0.0, 1.0);
  float h   = degrees(atan(d.y, d.x));
  if (h < 0.0) h += 360.0;

  float lo = 0.0, hi = 1.0;
  for (int i = 0; i < 22; i++) {
    float mid = (lo + hi) * 0.5;
    if (lum(hsl(h, sat, mid)) < uLum) lo = mid; else hi = mid;
  }

  vec3  color = hsl(h, sat, hi); // hi = ≥uLum side; matches findLightness so the wheel pixel and the JS swatch agree (no 1-step split)
  
  // Apply CVD Simulation in linear space if active
  if (uCvdActive > 0.5) {
    vec3 lin = vec3(sL(color.r), sL(color.g), sL(color.b));
    vec3 cvdLin = uCvdMatrix * lin;
    // convert back to sRGB
    color = vec3(
      cvdLin.r <= 0.0031308 ? cvdLin.r * 12.92 : 1.055 * pow(cvdLin.r, 1.0 / 2.4) - 0.055,
      cvdLin.g <= 0.0031308 ? cvdLin.g * 12.92 : 1.055 * pow(cvdLin.g, 1.0 / 2.4) - 0.055,
      cvdLin.b <= 0.0031308 ? cvdLin.b * 12.92 : 1.055 * pow(cvdLin.b, 1.0 / 2.4) - 0.055
    );
  }
  
  float a     = smoothstep(uRadius + 1.0, uRadius - 1.0, dist);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0) * a, a);
}
`;

/** @type {{ gl: WebGLRenderingContext, uLum: WebGLUniformLocation, uCvdMatrix: WebGLUniformLocation, uCvdActive: WebGLUniformLocation } | null} */
let glState = null;

function initGL() {
  const gl = wheelCanvas.getContext('webgl', {
    alpha: true, premultipliedAlpha: true, antialias: false,
  });
  if (!gl) return null;

  function compile(type, src) {
    const s = /** @type {WebGLShader} */ (gl.createShader(type));
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(/** @type {string} */ (gl.getShaderInfoLog(s)));
    return s;
  }

  const prog = /** @type {WebGLProgram} */ (gl.createProgram());
  gl.attachShader(prog, compile(gl.VERTEX_SHADER,   VS_SRC));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS_SRC));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error(/** @type {string} */ (gl.getProgramInfoLog(prog)));
  gl.useProgram(prog);

  const buf = /** @type {WebGLBuffer} */ (gl.createBuffer());
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uLum       = /** @type {WebGLUniformLocation} */ (gl.getUniformLocation(prog, 'uLum'));
  const uCenter    = /** @type {WebGLUniformLocation} */ (gl.getUniformLocation(prog, 'uCenter'));
  const uRadius    = /** @type {WebGLUniformLocation} */ (gl.getUniformLocation(prog, 'uRadius'));
  const uCvdMatrix = /** @type {WebGLUniformLocation} */ (gl.getUniformLocation(prog, 'uCvdMatrix'));
  const uCvdActive = /** @type {WebGLUniformLocation} */ (gl.getUniformLocation(prog, 'uCvdActive'));
  const uApcaLum   = /** @type {WebGLUniformLocation} */ (gl.getUniformLocation(prog, 'uApcaLum'));
  
  gl.uniform2f(uCenter, BUF_SZ / 2, BUF_SZ / 2);
  gl.uniform1f(uRadius, R_BUF);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  return { gl, uLum, uCvdMatrix, uCvdActive, uApcaLum };
}

function drawWheel(lum) {
  if (!glState) return;
  const { gl, uLum, uCvdMatrix, uCvdActive, uApcaLum } = glState;
  gl.uniform1f(uLum, lum);
  gl.uniform1f(uApcaLum, contrastLockMode === 'apca' ? 1.0 : 0.0);
  
  // CVD simulation runs in the shader (linear space) — an ancestor CSS filter
  // can't reach this composited WebGL layer on iOS WebKit.
  if (currentCvd) {
    gl.uniform1f(uCvdActive, 1.0);
    // transpose must be false in WebGL 1.0; supply the data column-major
    const m = CVD_MATRICES[currentCvd];
    gl.uniformMatrix3fv(uCvdMatrix, false, new Float32Array([
      m[0], m[3], m[6],
      m[1], m[4], m[7],
      m[2], m[5], m[8]
    ]));
  } else {
    gl.uniform1f(uCvdActive, 0.0);
  }

  gl.viewport(0, 0, BUF_SZ, BUF_SZ);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// ─── 2D fallback ──────────────────────────────────────────────────────────────

function renderWheel2D(lum) {
  const ctx2 = /** @type {CanvasRenderingContext2D} */ (wheelCanvas.getContext('2d'));
  const img  = ctx2.createImageData(BUF_SZ, BUF_SZ);
  const data = img.data;
  const cx = BUF_SZ / 2, cy = BUF_SZ / 2;
  const ROWS = 30;
  let row = 0;

  function chunk() {
    const end = Math.min(row + ROWS, BUF_SZ);
    for (let py = row; py < end; py++) {
      for (let px = 0; px < BUF_SZ; px++) {
        const dx = px - cx, dy = py - cy, dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > R_BUF + 1) continue;
        const sat = Math.min(dist / R_BUF, 1);
        const hue = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
        const l   = findLightness(hue, sat, lum);
        const [r, g, b] = hslToRgb(hue, sat, l);
        const [tr, tg, tb] = cvdTransformRgb(r, g, b);
        const alpha = dist > R_BUF - 0.5 ? Math.max(0, Math.round((R_BUF + 1 - dist) * 255)) : 255;
        const idx = (py * BUF_SZ + px) * 4;
        data[idx] = tr; data[idx+1] = tg; data[idx+2] = tb; data[idx+3] = alpha;
      }
    }
    row = end;
    ctx2.putImageData(img, 0, 0);
    drawHueLabels();
    if (row < BUF_SZ) requestAnimationFrame(chunk);
    else drawMarker(selX, selY);
  }
  requestAnimationFrame(chunk);
}

// ─── Overlay ──────────────────────────────────────────────────────────────────

function drawHueLabels() {
  oCtx.clearRect(0, 0, CSS_SZ, CSS_SZ);
  const cx = CSS_SZ / 2, cy = CSS_SZ / 2, lr = R_CSS + 15;
  oCtx.font = '500 11px ui-monospace, monospace';
  oCtx.textAlign = 'center';
  oCtx.textBaseline = 'middle';
  oCtx.fillStyle = 'rgba(80,80,120,0.7)';
  for (const [angle, label] of [[0,'R'],[60,'Y'],[120,'G'],[180,'C'],[240,'B'],[300,'M']]) {
    const rad = angle * Math.PI / 180;
    oCtx.fillText(label, cx + Math.cos(rad) * lr, cy + Math.sin(rad) * lr);
  }
}

function drawMarker(x, y) {
  drawHueLabels();
  const l = findLightness(selHue, selSat, targetLum);
  const [r, g, b] = hslToRgb(selHue, selSat, l);
  const isLight = relativeLuminance(r, g, b) > 0.4;
  const mc  = isLight ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)';
  const arm = 13, gap = 6;

  oCtx.save();
  oCtx.strokeStyle = mc;
  oCtx.lineWidth   = 1;
  oCtx.setLineDash([]);
  oCtx.beginPath();
  oCtx.moveTo(x - arm, y); oCtx.lineTo(x - gap, y);
  oCtx.moveTo(x + gap, y); oCtx.lineTo(x + arm, y);
  oCtx.moveTo(x, y - arm); oCtx.lineTo(x, y - gap);
  oCtx.moveTo(x, y + gap); oCtx.lineTo(x, y + arm);
  oCtx.stroke();
  oCtx.beginPath();
  oCtx.arc(x, y, gap - 0.5, 0, Math.PI * 2);
  oCtx.lineWidth = 1.5;
  oCtx.stroke();
  oCtx.restore();
}

// ─── Slider track gradients ───────────────────────────────────────────────────
// updateUI() runs every animation frame during drags, but each track only
// depends on a subset of the selection — skip regeneration when its inputs
// haven't changed (e.g. a hue drag leaves the hue track untouched).

let _lumTrackKey = '';
function updateLumSliderTrack() {
  const key = selHue + '/' + selSat;
  if (key === _lumTrackKey) return;
  _lumTrackKey = key;
  const s = Math.max(selSat, 0.65);
  const stops = [0, 0.15, 0.35, 0.55, 0.75, 0.90, 1].map(t => {
    const l = findLightness(selHue, s, t);
    return `${cvdTransformHex(toHex(...hslToRgb(selHue, s, l)))} ${(t * 100).toFixed(0)}%`;
  });
  lumSlider.style.backgroundImage = `linear-gradient(to right, ${stops.join(', ')})`;
}

let _hueTrackKey = -1;
function updateHueSliderTrack() {
  if (targetLum === _hueTrackKey) return;
  _hueTrackKey = targetLum;
  const stops = Array.from({ length: 13 }, (_, i) => {
    const h = i * 30;
    const l = findLightness(h, 1, targetLum);
    return `${cvdTransformHex(toHex(...hslToRgb(h, 1, l)))} ${Math.round(i / 12 * 100)}%`;
  });
  hueSlider.style.backgroundImage = `linear-gradient(to right, ${stops.join(', ')})`;
}

let _satTrackKey = '';
function updateSatSliderTrack() {
  const key = selHue + '/' + targetLum;
  if (key === _satTrackKey) return;
  _satTrackKey = key;
  const stops = [0, 0.25, 0.5, 0.75, 1].map(s => {
    const l = findLightness(selHue, s, targetLum);
    return `${cvdTransformHex(toHex(...hslToRgb(selHue, s, l)))} ${Math.round(s * 100)}%`;
  });
  satSlider.style.backgroundImage = `linear-gradient(to right, ${stops.join(', ')})`;
}

// ─── Contrast preview ─────────────────────────────────────────────────────────

// Badge DOM is built once per container and updated in place afterwards —
// updateUI() runs every animation frame during drags, and rebuilding ~10
// elements × 4 tiles per frame causes measurable GC/style-recalc churn on mobile.
/** @type {WeakMap<HTMLElement, { ratioEl: HTMLElement | null, cats: HTMLElement[], badges: { el: HTMLElement, threshold: number }[] }>} */
const _wcagDom = new WeakMap();

function buildPreviewWcag(el) {
  const rowsEl = document.createElement('div');
  rowsEl.className = 'preview-wcag-rows';
  // The APCA verdict rows and the WCAG chip rows are stacked in the SAME grid
  // cell (see .preview-wcag-rows in CSS). Both groups are always laid out, so
  // the block reserves the height of the taller one (APCA) in every mode —
  // switching contrast mode flips only their visibility, never the tile height,
  // which on desktop would otherwise re-fit the whole app's zoom.
  const apcaGroup = document.createElement('div');
  apcaGroup.className = 'preview-verdict-group preview-verdict-apca';
  const wcagGroup = document.createElement('div');
  wcagGroup.className = 'preview-verdict-group preview-verdict-wcag';

  // v2 beta: APCA usage tier + font verdict live on their own right-aligned
  // rows above the font selectors, inside the APCA group.
  const apcaTierEl = document.createElement('div');
  apcaTierEl.className = 'preview-apca-tier';
  apcaGroup.appendChild(apcaTierEl);
  const apcaFontEl = document.createElement('div');
  apcaFontEl.className = 'preview-apca-font';
  apcaGroup.appendChild(apcaFontEl);

  // v2 beta: the font size/weight selectors sit in the WCAG chips' slot
  // (which is hidden in APCA mode) — one pair per tile, all synchronized.
  const fontCtrl = document.createElement('div');
  fontCtrl.className = 'preview-apca-fontctrl';
  const fontCtrlLabel = document.createElement('span');
  fontCtrlLabel.className = 'preview-wcag-cat';
  fontCtrlLabel.textContent = 'Font';
  fontCtrlLabel.title = 'Font size and weight the APCA verdicts judge against';
  // Each select is wrapped so a custom, theme-coloured caret (the wrapper's
  // ::after) can replace the native one — the native arrow is a fixed system
  // colour that vanishes on the dark select fill; ours uses var(--text), which
  // always contrasts with the select's var(--surface) background.
  const sizeSel = document.createElement('select');
  sizeSel.className = 'apca-font-select';
  sizeSel.title = 'Font size (px) the APCA verdicts judge against';
  for (const v of APCA_FONT_SIZES) { const o = document.createElement('option'); o.value = String(v); o.textContent = String(v); sizeSel.appendChild(o); }
  const sizeWrap = document.createElement('span');
  sizeWrap.className = 'apca-font-select-wrap';
  sizeWrap.appendChild(sizeSel);
  const wghtSel = document.createElement('select');
  wghtSel.className = 'apca-font-select';
  wghtSel.title = 'Font weight the APCA verdicts judge against';
  for (const v of APCA_FONT_WEIGHTS) { const o = document.createElement('option'); o.value = String(v); o.textContent = String(v); wghtSel.appendChild(o); }
  const wghtWrap = document.createElement('span');
  wghtWrap.className = 'apca-font-select-wrap';
  wghtWrap.appendChild(wghtSel);
  sizeSel.addEventListener('change', () => {
    apcaFontSize = +sizeSel.value;
    saveToStorage('apca-font-px', String(apcaFontSize));
    updateUI(); // re-renders every tile: verdicts + the sibling selectors sync
    if (_ce) chipEditorRenderPreview(); // the chip editor judges the same font
    syncApcaTypeControls(); // re-target the "Type" lock if it's active
  });
  wghtSel.addEventListener('change', () => {
    apcaFontWeight = +wghtSel.value;
    saveToStorage('apca-font-wght', String(apcaFontWeight));
    updateUI();
    if (_ce) chipEditorRenderPreview();
    syncApcaTypeControls();
  });
  fontCtrl.append(fontCtrlLabel, sizeWrap, wghtWrap);
  apcaGroup.appendChild(fontCtrl);

  // Note: WCAG 1.4.11 (non-text contrast, 3:1) is Level AA only — UI
  // components have no AAA criterion, so the AAA badge in the Large row
  // applies to large text (1.4.6) exclusively.
  const CATEGORIES = [
    {
      label: 'Normal',
      title: 'Normal text — WCAG 1.4.3 (AA 4.5:1) / 1.4.6 (AAA 7:1)',
      thresholds: [
        ['AA',  4.5, 'Normal text AA — 4.5:1 (WCAG 1.4.3)'],
        ['AAA', 7,   'Normal text AAA — 7:1 (WCAG 1.4.6)'],
      ],
    },
    {
      label: 'Large',
      title: 'Large text — at least 24px, or bold and at least 18.66px (14pt)',
      thresholds: [
        ['AA',  3,   'Large text AA — 3:1 (WCAG 1.4.3). Same threshold as UI components & graphics (1.4.11, Level AA)'],
        ['AAA', 4.5, 'Large text AAA — 4.5:1 (WCAG 1.4.6). Large text only: no AAA criterion exists for UI components'],
      ],
    },
  ];

  const cats = [], badges = [], badgeRows = [];
  for (const { label, title, thresholds } of CATEGORIES) {
    const row = document.createElement('div');
    row.className = 'preview-wcag-row';
    badgeRows.push(row);

    const catEl = document.createElement('span');
    catEl.className   = 'preview-wcag-cat';
    catEl.textContent = label;
    catEl.title = title;
    row.appendChild(catEl);
    cats.push(catEl);

    for (const [badge, threshold, badgeTitle] of thresholds) {
      const b = document.createElement('span');
      b.className = 'preview-badge';
      b.textContent = badge;
      b.title = badgeTitle;
      row.appendChild(b);
      badges.push({ el: b, threshold });
    }

    wcagGroup.appendChild(row);
  }

  rowsEl.append(apcaGroup, wcagGroup);
  el.appendChild(rowsEl);
  const ratioEl = document.getElementById(el.id.replace('-wcag', '-ratio'));
  let apcaEl = null;
  if (ratioEl) {
    apcaEl = document.createElement('span');
    apcaEl.className = 'preview-apca';
    apcaEl.title = 'APCA Lc (experimental — WCAG 2.2 ratio remains normative)';
    ratioEl.insertAdjacentElement('afterend', apcaEl);
  }
  const dom = { rowsEl, ratioEl, apcaEl, apcaTierEl, apcaFontEl, fontCtrl, sizeSel, wghtSel, cats, badges, badgeRows };
  _wcagDom.set(el, dom);
  return dom;
}

/**
 * Render WCAG badges into a `.preview-wcag` container.
 * Colors adapt to the tile's background luminance so they're always legible.
 * @param {HTMLElement} el
 * @param {number} l1      text luminance
 * @param {number} l2      bg luminance
 * @param {number} bgLum   tile background luminance (for color adaptation)
 * @param {number[]} [txtRgb]  text color RGB (for the experimental APCA readout)
 * @param {number[]} [bgRgb]   bg color RGB (for the experimental APCA readout)
 */
// ─── Contrast preview verdicts ───────────────────────────────────────────────
// The pass/fail chips, APCA usage tier and font verdict are computed and shown
// per-frame from the SAME values as the ratio/Lc labels — never debounced — so
// the number a user reads and the verdict beside it can never disagree, even
// mid-drag. The frame enforces the lock BEFORE drawing and the status reads
// hue-invariant anchors, so there are no transient wrong-side frames to hide.
function renderPreviewWcag(el, l1, l2, bgLum, txtRgb, bgRgb, lcOverride, lockedPair) {
  const dom = _wcagDom.get(el) || buildPreviewWcag(el);
  const ratio   = contrastRatio(l1, l2);
  // Locked pair: when the lock REPORTS met, the solver has pinned this anchor pair to within
  // its own tolerance (EPS = 0.005) of the target — so judge the target exactly. Snapping keeps
  // the label, the AA/AAA chips and the lock's "met" state in agreement. Unreachable best-effort
  // pins report NOT met (_contrastLockMet false), so they don't snap (chip fails + message).
  //
  // Gate on _contrastLockMet alone — NOT on a second `ratio >= target - 0.005` test. The solver
  // lands the pair at exactly target − EPS, whose float value (e.g. 6.99499… for a 7:1 lock) is
  // < 6.995, so that extra test missed on a knife-edge: the badge read one step below target
  // (6.99, AAA off) while the lock said met, and wobbled across the boundary during a Lum drag
  // (the flicker). A loose −0.02 bound stays only as defence against a grossly-off pair (never
  // expected while met), well clear of the EPS boundary + float noise.
  const ratioJudged = (lockedPair && _contrastLockMet && contrastLockMode === 'wcag2' && contrastLockTarget &&
                       ratio >= contrastLockTarget - 0.02)
    ? Math.max(ratio, contrastLockTarget) : ratio;
  // The ACTUAL measured WCAG ratio of the rendered (composited) 8-bit colours.
  const wcagActual = (txtRgb && bgRgb)
    ? contrastRatio(relativeLuminance(...txtRgb), relativeLuminance(...bgRgb)) : ratioJudged;
  // The floor the label shows and the AA/AAA chips judge must NEVER exceed what the pixels
  // actually render — otherwise a chip reads "pass" while the real contrast is below threshold
  // (the "4.50:1 (4.47)" + AA-on false pass). 8-bit quantization, and the lock's target snap
  // above, can put the anchor floor a hair ABOVE the measured value; clamp it to the measured
  // ratio so floor ≤ measured by construction. The flicker fix survives: when the pair really
  // clears the target the measured is ≥ it, so the min keeps the snapped floor.
  const judged = Math.min(ratioJudged, wcagActual);
  // Judge the AA/AAA chips from the EXACT value shown (2-dp rounded), so the ratio label and its
  // chips can never disagree at a threshold. Rounding is monotonic, so ratioShown ≤ the rounded
  // measured value too — the displayed floor is never shown above the measured ratio.
  const ratioShown = Number(judged.toFixed(2));
  const isLight = bgLum > 0.179;
  const dim     = isLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)';

  const apcaMode = contrastLockMode === 'apca';
  if (dom.ratioEl) {
    if (apcaMode) {
      // WCAG is the non-active metric in APCA mode — just show the measured ratio.
      dom.ratioEl.textContent = wcagActual.toFixed(2) + ':1';
      dom.ratioEl.title = 'WCAG 2.2 contrast ratio (measured)';
    } else {
      // WCAG active: main = the guaranteed floor the badges judge (hue-invariant: a function of
      // Lum & Opacity only), parenthetical = the current measured ratio (always ≥ the floor).
      dom.ratioEl.textContent = ratioShown.toFixed(2) + ':1 (' + wcagActual.toFixed(2) + ')';
      dom.ratioEl.title = 'Guaranteed ≥ ' + ratioShown.toFixed(2) + ':1 at this luminance & opacity for any hue/sat (the badges judge this floor); (' + wcagActual.toFixed(2) + ') is the current measured ratio';
    }
    dom.ratioEl.style.color = cvdTransformRgba(dim);
  }
  // Discrete verdict state for this frame (applied per-frame, in lockstep with labels).
  const disc = { passes: dom.badges.map(({ threshold }) => ratioShown >= threshold), tier: '', tierTitle: '', font: null };

  if (dom.apcaEl) {
    if (txtRgb && bgRgb) {
      const lc = (lcOverride !== undefined) ? lcOverride : apcaLc(txtRgb, bgRgb);
      dom.apcaEl.style.color = cvdTransformRgba(dim);
      // APCA is size/weight-dependent — judge the chosen font against the
      // official lookup (apcaFontVerdict, shared with the chip editor so both
      // always agree). These are DISCRETE verdict state: computed here, then
      // routed through the stability debounce before display. Computed in EVERY
      // mode (not only APCA) so the APCA verdict group always reserves its height
      // — the tile then never changes height when the mode toggles (which on
      // desktop re-fits the app's zoom); it's just hidden via visibility in
      // non-APCA modes (see .preview-verdict-apca).
      {
        // Judge the discrete APCA verdicts from the SAME |Lc| the label shows (the
        // anchor lcOverride when provided). When the APCA lock pins this pair, the anchor
        // sits within display-rounding of the target — snap it up so the tier/font
        // verdict, the "Lc" label and the lock's "met" state always agree. The old
        // condition tested the RENDERED composite pair instead, which in translucent mode
        // can read below the target while the anchor (what the lock actually holds and
        // the label shows) is exactly on it — so the label read "met" while the chip
        // showed a miss. Unreachable best-effort pins sit well below, so they don't snap.
        let lcAbs = Math.abs(lc);
        // Snap UP to the target while the lock MEETS it (not a best-effort pin). The solver
        // lands the pinned pair at exactly target − EPS (0.5 for APCA), so the OLD two-sided
        // test `|lcAbs - target| <= 0.5` sat right on a knife-edge: in float, target−0.5 often
        // reads as 0.5000…1 away and MISSED, so the locked tile showed target−1 (e.g. "Lc 44"
        // under a 45 lock) and a sub-target verdict even though the lock was met — and flipped
        // as the solve drifted across the boundary. Use a loose lower bound (well past the EPS
        // knife-edge) with Math.max, so a met lock reliably reads the target while a tile sitting
        // genuinely ABOVE it (the reverse-polarity tile) keeps its own higher verdict. Unreachable
        // best-effort pins report NOT met, so they don't snap (they show the real miss + message).
        if (lockedPair && _contrastLockMet && apcaLockTarget && lcAbs >= apcaLockTarget - 0.6) {
          lcAbs = Math.max(lcAbs, apcaLockTarget);
        }
        // The live measured |Lc| of the rendered 8-bit pair — shown in the parenthetical only.
        // Do NOT clamp the judged lcAbs to it: APCA |Lc| is quantization-sensitive, so at a FIXED
        // luminance the 8-bit measured value wobbles ±1–2 as hue/sat sweep. Clamping the verdict
        // to that made the usage tier and font verdict flicker across a threshold during
        // exploration even though the LOCKED (continuous-luminance) contrast is steady — breaking
        // the app's promise that hue/sat never shakes the verdict. Judge the hue-invariant anchor
        // (pinned to the target when the lock is met); the measured only rides in the parens.
        // The floor must never exceed the rendered pixels: clamp to the measured |Lc|. With the
        // lock now pinning the pair to the actual target (not target−EPS), the biased render lands
        // at/above the target, so measured ≥ the anchor and this min is a no-op in the common case
        // — it only trims the rare 8-bit dip, and since measured sits at the target (above the
        // usage-ladder boundary at target−0.3) it doesn't flip the tier, so no flicker.
        const measuredLcAbs = Math.abs(apcaLc(txtRgb, bgRgb));
        lcAbs = Math.min(lcAbs, measuredLcAbs);
        // Label uses floor(|Lc|+0.3): the usage ladder steps 0.3 before each integer
        // (…44.7, 59.7…), so this shows the SAME integer the tier switches on — the "Lc N"
        // number and its usage tier can never straddle a boundary (no "Lc 15 / INVISIBLE").
        // Tier/font judge the EXACT fractional |Lc| so a fractional Type-lock target (e.g.
        // 43.2) still verdicts precisely — rounding it would drop the font below threshold.
        const lcLabel = Math.floor(lcAbs + 0.3);
        const signed = mag => (mag === 0 ? '0' : (lc < 0 ? -mag : mag));
        if (apcaMode) {
          // APCA active: main = the guaranteed floor |Lc| the verdict judges (hue-invariant),
          // parenthetical = the current measured |Lc| (≥ the floor — the floor is clamped to it).
          const actualMag = Math.floor(measuredLcAbs + 0.3);
          dom.apcaEl.textContent = 'Lc ' + signed(lcLabel) + ' (' + signed(actualMag) + ')';
          dom.apcaEl.title = 'Guaranteed |Lc| ≥ ' + lcLabel + ' at this luminance & opacity for any hue/sat (the verdict judges this floor); (' + signed(actualMag) + ') is the current measured Lc';
        } else {
          // APCA is the non-active metric in WCAG mode — lc is already the measured value.
          dom.apcaEl.textContent = 'Lc ' + signed(lcLabel);
        }
        disc.tier = apcaUsageTier(lcAbs);
        disc.tierTitle = 'APCA usage level for |Lc| ' + lcLabel + ' (reference-tool ladder)';
        disc.font = apcaFontVerdict(lcAbs);
      }
    } else {
      dom.apcaEl.textContent = '';
      if (dom.apcaTierEl) dom.apcaTierEl.textContent = '';
      if (dom.apcaFontEl) dom.apcaFontEl.textContent = '';
    }
  }

  // Derive the pass-badge greens' luminances straight from their hexes — single source of truth,
  // so the AA (4.5:1) boundary below is exact. (Hard-coded values had drifted: the dark green's
  // was 0.057 vs the true 0.145, over-crediting its contrast and letting it fail AA on mid-lum bg.)
  const LUM_BRIGHT = relativeLuminance(...hexToRgb(PASS_GREEN));    // bright green ≈ 0.564
  const LUM_DARK   = relativeLuminance(...hexToRgb(PASS_GREEN_DK)); // dark green   ≈ 0.145
  const cr = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const crBright = cr(bgLum, LUM_BRIGHT);
  const crDark   = cr(bgLum, LUM_DARK);

  // Text: use green when it achieves ≥4.5:1; otherwise fall back to black/white
  // (isLight ≡ bgLum > 0.179 ≡ black gives more contrast than white)
  const passColor = crBright >= 4.5 ? PASS_GREEN
                  : crDark   >= 4.5 ? PASS_GREEN_DK
                  : isLight          ? '#000000'
                  :                    '#ffffff';

  // Border/bg: always use whichever green has more contrast against tile bg
  const useBrightStyle = crBright >= crDark;
  const passBorder = useBrightStyle ? 'rgba(93,222,138,0.45)' : 'rgba(26,122,66,0.45)';
  const passBg     = useBrightStyle ? 'rgba(93,222,138,0.10)' : 'rgba(26,122,66,0.10)';
  const passRing   = isLight ? '0 0 0 1px rgba(0,0,0,0.16)' : '0 0 0 1px rgba(255,255,255,0.18)';

  // APCA vs WCAG verdict UI: both groups occupy the same grid cell, so switching
  // modes flips only their visibility (CSS) — the tile height stays put, so the
  // desktop fit-zoom never rescales the whole app on a mode toggle.
  const apca = contrastLockMode === 'apca';
  if (dom.rowsEl) dom.rowsEl.classList.toggle('apca', apca);
  if (dom.sizeSel && dom.sizeSel.value  !== String(apcaFontSize))   dom.sizeSel.value = String(apcaFontSize);
  if (dom.wghtSel && dom.wghtSel.value !== String(apcaFontWeight)) dom.wghtSel.value = String(apcaFontWeight);
  for (const catEl of dom.cats) catEl.style.color = cvdTransformRgba(dim);

  // Verdicts apply per-frame, in lockstep with the ratio/Lc labels they're derived
  // from — so the shown number and its pass/fail chips, usage tier and font verdict
  // never disagree, even mid-drag. (The lock enforces before the draw and the status
  // reads hue-invariant anchors, so no transient wrong-side frame is left to hide.)
  const shown = disc;

  if (dom.apcaTierEl) {
    dom.apcaTierEl.textContent = shown.tier;
    dom.apcaTierEl.title = shown.tierTitle;
    if (shown.tier) dom.apcaTierEl.style.color = cvdTransformRgba(dim);
  }
  if (dom.apcaFontEl) {
    if (shown.font) {
      dom.apcaFontEl.textContent = shown.font.text;
      dom.apcaFontEl.title = shown.font.title;
      dom.apcaFontEl.style.color = cvdTransformHex(shown.font.pass
        ? (isLight ? PASS_GREEN_DK : PASS_GREEN)
        : (isLight ? FAIL_RED_DK : FAIL_RED));
    } else {
      dom.apcaFontEl.textContent = '';
    }
  }

  dom.badges.forEach(({ el: b }, i) => {
    if (shown.passes[i]) {
      b.style.color       = cvdTransformHex(passColor);
      b.style.borderColor = cvdTransformRgba(passBorder);
      b.style.background  = cvdTransformRgba(passBg);
      b.style.boxShadow   = cvdTransformRgba(passRing);
    } else {
      b.style.color       = cvdTransformRgba(isLight ? 'rgba(0,0,0,0.3)'   : 'rgba(255,255,255,0.3)');
      b.style.borderColor = cvdTransformRgba(isLight ? 'rgba(0,0,0,0.12)'  : 'rgba(255,255,255,0.12)');
      b.style.background  = cvdTransformRgba(isLight ? 'rgba(0,0,0,0.04)'  : 'rgba(255,255,255,0.04)');
      b.style.boxShadow   = 'none';
    }
  });
}

/**
 * Update the vs-White and vs-Black preview tiles.
 * @param {string} selectedHex
 * @param {number} selectedLum
 */
function updatePreviewFixed(selectedHex, selectedLum) {
  const selRgb = hexToRgb(selectedHex);
  const a = selAlpha;
  const translucent = a < 0.9995;
  // Translucent text is shown (and judged) composited over the tile's background.
  const textCss = translucent
    ? cvdTransformRgba(`rgba(${selRgb[0]},${selRgb[1]},${selRgb[2]},${a})`)
    : cvdTransformHex(selectedHex);

  // vs White (bg lum = 1, isLight = true)
  const tileW = /** @type {HTMLElement} */ (document.getElementById('preview-white'));
  tileW.style.background = cvdTransformHex('#ffffff');
  tileW.style.setProperty('--tile-bg', cvdTransformHex('#ffffff'));
  tileW.style.color = cvdTransformRgba('rgba(0,0,0,0.55)');
  /** @type {HTMLElement} */ (document.getElementById('pvw-text-dot')).style.background = textCss;
  /** @type {HTMLElement} */ (document.getElementById('pvw-text-dot')).style.borderColor = cvdTransformRgba('rgba(0,0,0,0.2)');
  for (const id of ['pvw-display', 'pvw-body', 'pvw-ui']) {
    /** @type {HTMLElement} */ (document.getElementById(id)).style.color = textCss;
  }
  const onW = compositeRgb(selRgb, a, [255, 255, 255]);
  // Text is luminance-locked, so judge from the gray-composited anchor (hue-
  // invariant) in the anchor regime; live composite otherwise.
  renderPreviewWcag(
    /** @type {HTMLElement} */ (document.getElementById('pvw-wcag')),
    (contrastLockMode !== 'apca' || a < 0.9995) ? compositeRelLum(targetLum, a, 1) : relativeLuminance(...onW), 1, 1,
    onW, [255, 255, 255],
    apcaAnchorLc('pvw'),
  );

  // vs Black (bg lum = 0, isLight = false)
  const tileB = /** @type {HTMLElement} */ (document.getElementById('preview-black'));
  tileB.style.background = cvdTransformHex('#000000');
  tileB.style.setProperty('--tile-bg', cvdTransformHex('#000000'));
  tileB.style.color = cvdTransformRgba('rgba(255,255,255,0.55)');
  /** @type {HTMLElement} */ (document.getElementById('pvb-text-dot')).style.background = textCss;
  /** @type {HTMLElement} */ (document.getElementById('pvb-text-dot')).style.borderColor = cvdTransformRgba('rgba(255,255,255,0.25)');
  for (const id of ['pvb-display', 'pvb-body', 'pvb-ui']) {
    /** @type {HTMLElement} */ (document.getElementById(id)).style.color = textCss;
  }
  const onB = compositeRgb(selRgb, a, [0, 0, 0]);
  renderPreviewWcag(
    /** @type {HTMLElement} */ (document.getElementById('pvb-wcag')),
    (contrastLockMode !== 'apca' || a < 0.9995) ? compositeRelLum(targetLum, a, 0) : relativeLuminance(...onB), 0, 0,
    onB, [0, 0, 0],
    apcaAnchorLc('pvb'),
  );
}

/**
 * Update both custom preview tiles.
 * @param {string} selectedHex  The color from the wheel
 * @param {string} customHex    The custom comparison color
 * @param {number} selectedLum  Relative luminance of selected color
 * @param {number} customLum    Relative luminance of custom color
 */
function updatePreview(selectedHex, customHex, selectedLum, customLum) {
  const selRgb = hexToRgb(selectedHex), cusRgb = [cR, cG, cB];
  // Each side's effective opaque colour when it acts as a BACKGROUND (over the
  // white page), and the translucent CSS colour for when it's shown as TEXT.
  const effBgCustom = effBgRgb(cusRgb, cAlpha);            // custom as bg
  const effBgSel    = effBgRgb(selRgb, selAlpha);          // selected as bg
  const selTextCss = selAlpha < 0.9995 ? cvdTransformRgba(`rgba(${selRgb[0]},${selRgb[1]},${selRgb[2]},${selAlpha})`) : cvdTransformHex(selectedHex);
  const cusTextCss = cAlpha  < 0.9995 ? cvdTransformRgba(`rgba(${cusRgb[0]},${cusRgb[1]},${cusRgb[2]},${cAlpha})`)     : cvdTransformHex(customHex);
  const selBgCss = cvdTransformHex(toHex(...effBgSel));
  const cusBgCss = cvdTransformHex(toHex(...effBgCustom));

  // ── Tile A: selected color as TEXT on custom BACKGROUND ──
  const tileA  = /** @type {HTMLElement} */ (document.getElementById('preview-a'));
  const fgA    = getForeground(relativeLuminance(...effBgCustom));
  const dotBorderA = relativeLuminance(...effBgCustom) > 0.179 ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)';
  tileA.style.background = cusBgCss;
  tileA.style.setProperty('--tile-bg', cusBgCss);
  tileA.style.color      = cvdTransformHex(fgA);  // inherited by role labels

  for (const id of ['pa-display', 'pa-body', 'pa-ui']) {
    /** @type {HTMLElement} */ (document.getElementById(id)).style.color = selTextCss;
  }
  const paTxt = /** @type {HTMLElement} */ (document.getElementById('pa-text-dot'));
  const paBg  = /** @type {HTMLElement} */ (document.getElementById('pa-bg-dot'));
  paTxt.style.background   = selTextCss;
  paTxt.style.borderColor  = cvdTransformRgba(dotBorderA);
  paBg.style.background    = cusBgCss;
  paBg.style.borderColor   = cvdTransformRgba(dotBorderA);
  // Anchor regime: the WCAG ratio/badges judge the HELD anchor luminances (targetLum for
  // the wheel text, bgLumAnchor() for the custom BG — cuLum in Lum mode, the lock's solved
  // value when locked, or the live luminance in Color/HSL mode), NOT the rendered 8-bit RGB.
  // So a Lum-picker hue/sat sweep can't shift the verdict via quantization — matching what
  // the (anchor-based) contrast lock pins. Used whenever the WCAG rows are shown (non-APCA)
  // or anything is translucent; in Color/HSL mode bgLumAnchor() tracks the live luminance,
  // so the status still changes there — as intended.
  const useAnchor = contrastLockMode !== 'apca' || selAlpha < 0.9995 || cAlpha < 0.9995;
  const uRel = relativeLuminance(...underlayRgb);
  const effTextA = compositeRgb(selRgb, selAlpha, effBgCustom);
  const effBgRelA = useAnchor ? compositeRelLum(bgLumAnchor(), cAlpha, uRel) : relativeLuminance(...effBgCustom);
  const effTextRelA = useAnchor ? compositeRelLum(targetLum, selAlpha, effBgRelA) : relativeLuminance(...effTextA);
  renderPreviewWcag(
    /** @type {HTMLElement} */ (document.getElementById('pa-wcag')),
    effTextRelA, effBgRelA, relativeLuminance(...effBgCustom),
    effTextA, effBgCustom, apcaAnchorLc('pa'), true,
  );

  // ── Tile B: custom color as TEXT on selected BACKGROUND ──
  const tileB  = /** @type {HTMLElement} */ (document.getElementById('preview-b'));
  const fgB    = getForeground(relativeLuminance(...effBgSel));
  const dotBorderB = relativeLuminance(...effBgSel) > 0.179 ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)';
  tileB.style.background = selBgCss;
  tileB.style.setProperty('--tile-bg', selBgCss);
  tileB.style.color      = cvdTransformHex(fgB);

  for (const id of ['pb-display', 'pb-body', 'pb-ui']) {
    /** @type {HTMLElement} */ (document.getElementById(id)).style.color = cusTextCss;
  }
  const pbTxt = /** @type {HTMLElement} */ (document.getElementById('pb-text-dot'));
  const pbBg  = /** @type {HTMLElement} */ (document.getElementById('pb-bg-dot'));
  pbTxt.style.background   = cusTextCss;
  pbTxt.style.borderColor  = cvdTransformRgba(dotBorderB);
  pbBg.style.background    = selBgCss;
  pbBg.style.borderColor   = cvdTransformRgba(dotBorderB);
  const effTextB = compositeRgb(cusRgb, cAlpha, effBgSel);
  // Tile B: sel (wheel) is the BG here — always luminance-locked → held; custom is
  // the TEXT — held only in Lum mode.
  const effBgRelB  = useAnchor ? compositeRelLum(targetLum, selAlpha, uRel) : relativeLuminance(...effBgSel);
  const effTextRelB = useAnchor ? compositeRelLum(bgLumAnchor(), cAlpha, effBgRelB) : relativeLuminance(...effTextB);
  renderPreviewWcag(
    /** @type {HTMLElement} */ (document.getElementById('pb-wcag')),
    effTextRelB, effBgRelB, relativeLuminance(...effBgSel),
    effTextB, effBgSel, apcaAnchorLc('pb'), true,
  );

  // Announce the main pair (tile A: selected TEXT on custom BG) to the live region. In APCA mode
  // read the rendered usage tier + font verdict (the source of truth the user sees); in WCAG mode
  // state the ratio and the highest level it clears.
  if (contrastLockMode === 'apca') {
    const tier = (document.querySelector('#pa-wcag .preview-apca-tier')?.textContent || '').trim();
    const font = (document.querySelector('#pa-wcag .preview-apca-font')?.textContent || '').trim();
    announceContrast(['Text on background, APCA', tier, font].filter(Boolean).join(' — '));
  } else {
    const r = contrastRatio(effTextRelA, effBgRelA);
    const verdict = r >= 7 ? 'passes AAA' : r >= 4.5 ? 'passes AA'
                  : r >= 3 ? 'passes AA for large text only' : 'fails AA';
    announceContrast(`Text on background contrast ${r.toFixed(2)} to 1, ${verdict}.`);
  }
}

// ─── Preview sample text sizes ────────────────────────────────────────────────
// Each preview states the ON-SCREEN (rendered, post-zoom) px of its sample text:
// the contrast tiles' "Ag" (large) / body (normal) in their section labels, and
// the chip editor's "Ag". getBoundingClientRect on a line-height:1 probe returns
// real on-screen px, so it captures the desktop fit-zoom for the contrast tiles
// (inside the zoomed #app-wrapper) AND reads correctly for the chip editor (which
// lives outside it, unzoomed) — no per-context zoom bookkeeping needed.
function onScreenFontPx(el) {
  const probe = document.createElement('span');
  probe.textContent = ' ';
  probe.style.cssText = 'font:inherit;line-height:1;white-space:pre;display:inline-block;position:absolute;visibility:hidden;padding:0;border:0;';
  el.appendChild(probe);
  const h = probe.getBoundingClientRect().height; // ≈ font-size in on-screen px
  probe.remove();
  return h;
}

function setPreviewSizeLabel(sampleEl, px) {
  const section = sampleEl.closest('.preview-section');
  const label = section && section.querySelector('.preview-section-label');
  if (!label) return;
  let badge = label.querySelector('.preview-size');
  if (!badge) { badge = document.createElement('span'); badge.className = 'preview-size'; label.appendChild(badge); }
  badge.textContent = px + 'px';
}

function updateChipEditorAgSize() {
  if (!_ceRefs || !_ceRefs.agSize || !_ceRefs.ag || !_ceEl || !_ceEl.isConnected) return;
  _ceRefs.agSize.textContent = Math.round(onScreenFontPx(_ceRefs.ag)) + 'px';
}

function updatePreviewFontSizes() {
  const disp = document.querySelector('.preview-display');
  const body = document.querySelector('.preview-body');
  if (disp && body) {
    const lg = Math.round(onScreenFontPx(disp));   // all tiles share the class → one size each
    const nm = Math.round(onScreenFontPx(body));
    document.querySelectorAll('.preview-display').forEach(el => setPreviewSizeLabel(el, lg));
    document.querySelectorAll('.preview-body').forEach(el => setPreviewSizeLabel(el, nm));
  }
  updateChipEditorAgSize();
}
window.addEventListener('resize', updatePreviewFontSizes);
requestAnimationFrame(updatePreviewFontSizes);             // once styles are applied

// Re-fit every hex field when the layout width changes (orientation, sidebar resize),
// so a value that shrank on a narrow field restores its size when there's room again.
window.addEventListener('resize', () => {
  document.querySelectorAll('.custom-hex-input').forEach(el => fitHexField(/** @type {HTMLInputElement} */ (el)));
});

// ─── Main UI update ───────────────────────────────────────────────────────────

function updateUI() {
  const [r, g, b] = selectedRgbBiased();
  const selLum    = relativeLuminance(r, g, b);
  const selHex    = toHex(r, g, b);            // opaque, for cvd/wheel/marker use
  const selHexA   = toHexA(r, g, b, selAlpha); // 8-digit when translucent — field/export/storage
  const hsl       = rgbToHsl(r, g, b);

  // Swatch + accent: show the colour AS IT APPEARS on the white page (composited
  // over white when translucent), so the swatch reflects the opacity.
  const swatchRgb = compositeRgb([r, g, b], selAlpha, underlayRgb);
  const cvdSelHex = cvdTransformHex(toHex(...swatchRgb));
  const [cvdSelR, cvdSelG, cvdSelB] = hexToRgb(cvdSelHex);
  const cvdSelLum = relativeLuminance(cvdSelR, cvdSelG, cvdSelB);

  document.getElementById('swatch').style.background = cvdSelHex;
  const swatchHexEl = /** @type {HTMLInputElement} */ (document.getElementById('swatch-hex'));
  // Don't clobber the field while the user is typing/editing it.
  if (document.activeElement !== swatchHexEl) swatchHexEl.value = formatHex(selHexA);
  fitHexField(swatchHexEl);
  // The pin overlays the coloured swatch, so tint it to stay legible on top.
  /** @type {HTMLElement} */ (document.getElementById('pin-selected')).style.color =
    cvdSelLum > 0.179 ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.75)';
  document.documentElement.style.setProperty('--accent', cvdSelHex);

  // Data grid
  document.getElementById('v-hex').textContent = formatHex(selHexA);
  document.getElementById('v-lum').textContent = selLum.toFixed(4);
  const hH = Math.round(hsl[0]), hS = Math.round(hsl[1] * 100), hL = Math.round(hsl[2] * 100);
  setUnitVal(document.getElementById('vh-h'), hH, '°');
  setUnitVal(document.getElementById('vh-s'), hS, '%');
  setUnitVal(document.getElementById('vh-l'), hL, '%');
  document.getElementById('v-hsl').dataset.copy = `${hH}° ${hS}% ${hL}%`;
  document.getElementById('vr-r').textContent = String(r);
  document.getElementById('vr-g').textContent = String(g);
  document.getElementById('vr-b').textContent = String(b);
  const aPct = Math.round(selAlpha * 100);
  setUnitVal(document.getElementById('vr-a'), aPct, '%');
  // Copy as CSS Color 4: bytes plus a percentage alpha only when translucent, so an
  // opaque colour still copies the plain "r g b" (usable straight inside rgb()/rgba()).
  document.getElementById('v-rgb').dataset.copy = aPct < 100 ? `${r} ${g} ${b} / ${aPct}%` : `${r} ${g} ${b}`;

  // Contrast previews
  const customLum = relativeLuminance(cR, cG, cB);
  updatePreviewFixed(selHex, selLum);
  updatePreview(selHex, customColor, selLum, customLum);

  // Marker + slider tracks
  drawMarker(selX, selY);
  updateLumSliderTrack();
  updateHueSliderTrack();
  updateSatSliderTrack();
  // Alpha slider + readout (don't clobber the field while typing)
  const alphaSl = /** @type {HTMLInputElement} */ (document.getElementById('alpha-slider'));
  const alphaVal = /** @type {HTMLInputElement} */ (document.getElementById('alpha-val'));
  if (alphaSl) alphaSl.value = String(Math.round(selAlpha * 100));
  if (alphaVal && document.activeElement !== alphaVal) alphaVal.value = Math.round(selAlpha * 100) + '%';
}

// ─── State & helpers ──────────────────────────────────────────────────────────

let selHue = 312, selSat = 1, targetLum = 0.546;
let selAlpha = 1; // main (TEXT) opacity, 0–1
let selX = CSS_SZ / 2, selY = CSS_SZ / 2;
let isDown = false;

// Custom color state (RGB is source of truth; HSL is derived/kept for sliders)
let customColor = '#66001B';
let cR = 102, cG = 0, cB = 27;
let cH = 344, cS = 1, cL = 0.2;
let cAlpha = 1; // custom (BG) opacity, 0–1

// Custom panel mode: 'color' | 'gray' | 'lum'
let customMode = 'color';
let customColorSaved = { r: 102, g: 0, b: 27 };
let customGraySaved = 128;
// Lum mode state (authoritative Lum/Sat/Hue — independent of cH/cS/cL rounding)
let cuLum = 0.2, cuHue = 0, cuSat = 1;
let customLumSaved = null;

// Preferences
let stripHash = false;
let shareState = true;
let shareTheme = true;

// Contrast lock: 0 = off, or a WCAG 2.2 threshold ratio — 3 (large text AA /
// UI components), 4.5 (normal AA / large AAA), 7 (normal AAA)
let contrastLockTarget = 0;
// APCA lock (WCAG 3 working-draft candidate, not yet normative):
// 0 = off, or a minimum |Lc| of 45 / 60 / 75 / 90 (Bronze Simple Mode levels)
// Always launches with the target Off (per mode) so an active lock never survives a reload
// and silently moves colors at launch. WCAG 2 is the default mode; the standalone Off tab is
// gone, so the "no lock" state is each mode's own Off target.
let contrastLockMode = 'wcag2'; // 'wcag2' | 'apca' ('off' kept as a defensive internal value)
let apcaLockTarget = 0;
// A locked pair can usually meet the target with the auto-adjusted (free) color on EITHER the
// lighter or the darker side of the two colors' crossover — both are valid. This preference
// picks which; 'mid' takes whichever of the two is nearer a mid-tone gray. The solver falls
// back to whichever solution is reachable when only one is.
let lockSide = 'mid'; // 'lighter' | 'mid' | 'darker'
try { const _ls = localStorage.getItem('contrast-lock-side'); if (_ls === 'lighter' || _ls === 'darker' || _ls === 'mid') lockSide = _ls; } catch (e) {}
function apcaLockActive() { return contrastLockMode === 'apca'; }
/** The target the current mode enforces (0 when the lock is off). */
function activeContrastTarget() {
  return contrastLockMode === 'apca' ? apcaLockTarget
       : contrastLockMode === 'wcag2' ? contrastLockTarget
       : 0;
}
/** Format a #rrggbb hex string according to the current stripHash preference. */
function formatHex(hex) { return stripHash ? hex.slice(1) : hex; }
/** Hex for DISPLAY / labels / swatch copy: honours the "Include # in hex"
    opt-out and upper-cases (so tooltips, swatch names, the chip editor field
    and swatch-copied values all drop the # when the option is off). */
function hexDisplay(hex) { return formatHex(hex).toUpperCase(); }
/** CVD-transformed swatch colour for a (possibly 8-digit / translucent) hex:
    composite over the white page first so it renders correctly and reflects the
    opacity. Use wherever a swatch background shows a stored palette colour. */
function cvdDisplayHex(hex) {
  const [r, g, b, a] = hexToRgba(hex);
  return cvdTransformHex(toHex(...compositeRgb([r, g, b], a, underlayRgb)));
}

// Shrink a hex <input>'s font only as much as needed so its (centered) value never
// runs under the trailing copy icon — a translucent 8-digit #RRGGBBAA in a narrow
// mobile field would otherwise overlap it. The value stays centered on the field; we
// only reduce the type size, and only when it wouldn't otherwise fit clear of the icon.
const _hexFitCtx = document.createElement('canvas').getContext('2d');
function fitHexField(input) {
  if (!input) return;
  input.style.fontSize = ''; // reset to the CSS base each time so widening restores it
  const cs = getComputedStyle(input);
  const baseFont = parseFloat(cs.fontSize);
  if (!baseFont) return;
  const val = input.value || '';
  _hexFitCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const textW = _hexFitCtx.measureText(val).width + (parseFloat(cs.letterSpacing) || 0) * val.length;
  const rect = input.getBoundingClientRect();
  const center = rect.left + rect.width / 2;
  // Widest the centered value may be: bounded by the left padding, and — the real
  // constraint — by clearing the copy icon on the right (with a little breathing room).
  let maxHalf = rect.width / 2 - (parseFloat(cs.paddingLeft) || 0);
  const icon = input.parentElement && input.parentElement.querySelector('.custom-hex-copy-icon');
  if (icon) maxHalf = Math.min(maxHalf, icon.getBoundingClientRect().left - 3 - center);
  const maxW = maxHalf * 2;
  if (maxW > 0 && textW > maxW) input.style.fontSize = Math.max(8, baseFont * (maxW / textW)) + 'px';
}

// ─── RAF render scheduler ─────────────────────────────────────────────────────
// iOS fires slider input events well above 60 Hz. Without throttling, each
// event runs renderCustomWheel() (~17 k hslToRgb calls) + three slider-track
// updates synchronously, saturating the main thread and causing visible jank.
// scheduleRender() coalesces all rapid events into one render per animation frame.
let _rafId = null;
let _pendingWheelDraw = false;
let _pendingCustomSync = false;
let _lockSettleTimer = null;

function _renderFrame() {
  _rafId = null;
  // Contrast lock FIRST, then draw: every frame renders the post-enforcement
  // pair, so the pass/fail chips can never show the transient un-enforced
  // state (the old draw-then-enforce order flickered on every drag tick).
  // Renders scheduled by the enforcement itself skip re-enforcement to
  // prevent ping-ponging — UNLESS fresh user input coalesced into the same
  // frame (_userDirty), which previously left that input un-enforced for a
  // frame. Wheel hue/sat renders arrive with neither flag set, but still
  // shift the fg color (RGB quantization; APCA's Lc is hue-dependent even at
  // equal luminance) — treat them as fg-touched so the lock tracks every
  // tick. Redundant runs are cheap: enforcement no-ops unless the free
  // side's rendered color would actually change.
  // Which side did the USER touch this frame? _pendingCustomSync can't answer
  // that: the lock's own bg adjustment also sets it, and in a coalesced frame
  // that misread made us enforce the WRONG side — moving the user's Lum value
  // and landing the pair just below the target until the settle pass. Only
  // scheduleRender calls without _skipEnforceOnce record the user's side.
  const userSide = _pendingUserSide;
  _pendingUserSide = null;
  const skipEnforce = _skipEnforceOnce && !_userDirty;
  _skipEnforceOnce = false;
  _userDirty = false;
  if (!skipEnforce) enforceContrastLock(userSide || _lastTouchedSide);
  // An adjustment above may have flagged the wheel/custom sync for this
  // same frame — draw AFTER it so the frame shows the corrected state.
  if (_pendingWheelDraw)  { drawWheel(targetLum); _pendingWheelDraw  = false; }
  if (_pendingCustomSync) { syncCustomUI();        _pendingCustomSync = false; }
  updateUI();
  // Settle pass: verify and correct once the frame stream goes quiet.
  // Idempotent: the enforcement no-ops when the pair is already pinned.
  clearTimeout(_lockSettleTimer);
  _lockSettleTimer = setTimeout(() => {
    if (activeContrastTarget() > 0) enforceContrastLock(_lastTouchedSide);
  }, 120);
}

function scheduleRender(redrawWheel, syncCustom) {
  // Remember which side the user touched last (wheel = fg, custom = bg) so a
  // contrast-target change adjusts the other one. Renders scheduled by the
  // contrast-lock enforcement itself (_skipEnforceOnce set) don't count.
  // Classify by _inEnforcement, NOT _skipEnforceOnce: the skip flag stays
  // armed until the next frame, so an input arriving just after a lock
  // adjustment was misread as lock-origin and went un-enforced for a frame.
  if (!_inEnforcement) { _lastTouchedSide = syncCustom ? 'bg' : 'fg'; _pendingUserSide = _lastTouchedSide; _userDirty = true; }
  if (redrawWheel)  _pendingWheelDraw  = true;
  if (syncCustom)   _pendingCustomSync = true;
  if (_rafId !== null) return;
  _rafId = requestAnimationFrame(_renderFrame);
}

// ─── Contrast lock ─────────────────────────────────────────────────────
// When active, changing one side's luminance auto-adjusts the other side so
// contrastRatio(fg, bg) meets the target. Hue/saturation are preserved; only
// the luminance of the untouched side moves (via findLightness).

let _skipEnforceOnce = false;
let _userDirty = false; // fresh user input coalesced into an enforcement-scheduled frame
let _pendingUserSide = null; // side ('fg'|'bg') the user touched for the pending frame
let _inEnforcement = false;  // renders scheduled while true originate from the lock, not the user
let _lastTouchedSide = 'fg'; // which side the user adjusted most recently
// Whether the active lock currently MEETS its target (vs. a best-effort pin when the
// target is unreachable). The preview snaps a locked pair's verdict to the exact target
// only while this is true — otherwise the unreachable best-effort |Lc|/ratio would snap
// up and read as "achieved" while the lock itself shows "can't reach …".
let _contrastLockMet = false;
// The contrast-relevant luminance state at the last alpha-lock pin: both sides' HELD
// luminances, both alphas, and the underlay. When it's unchanged the alpha lock skips
// enforcement entirely, so a hue/sat sweep in Lum mode (which holds every luminance)
// never re-pins the free side or shifts the status — reachable or best-effort alike. A
// real lum/alpha edit (or an HSL-mode hue/sat sweep, which moves bgLumAnchor()) changes
// the key and re-pins. Reset to null when the lock is off/target-less so re-entry re-arms.
let _lumStateKey = null;
function lumStateKey() {
  return `${targetLum.toFixed(6)}|${bgLumAnchor().toFixed(6)}|${selAlpha.toFixed(4)}|${cAlpha.toFixed(4)}|${underlayRgb.join(',')}`;
}

function setContrastLockError(msg, full) {
  const el = document.getElementById('contrast-lock-error');
  if (el) { el.textContent = msg; el.title = full ?? msg; }
  // Also flag the row so the selected target chip turns red — the text alone
  // gets truncated to nothing on narrow screens, so the chip is the reliable
  // "target unreachable" signal there.
  const row = document.getElementById('contrast-lock-row');
  if (row) row.classList.toggle('has-error', !!msg);
}

/** Move the free side to the desired WCAG luminance, preserving its hue/sat.
    Shared by the WCAG 2 and APCA locks. `desired` is the exact boundary;
    every mode quantizes directionally (away from the fixed side), so the
    result lands on the first representable color at-or-beyond the target —
    no fixed overshoot margin needed. */
function applyLockAdjustment(changed, desired) {
  _skipEnforceOnce = true;
  if (changed === 'fg') {
    // Free side = custom bg; push its rounding away from the fg target
    const dir = Math.sign(desired - targetLum);
    if (customMode === 'lum') {
      setCustomFromLumHueSat(desired, cuHue, cuSat); // biases internally
    } else if (customMode === 'gray') {
      const lRaw = findLightness(0, 0, desired) * 255;
      const v = Math.max(0, Math.min(255,
        dir > 0 ? Math.ceil(lRaw) : dir < 0 ? Math.floor(lRaw) : Math.round(lRaw)));
      setCustomFromRgb(v, v, v);
    } else {
      setCustomFromHsl(cH, cS, findLightnessBiased(cH, cS, desired, dir));
    }
    // Keep the continuous anchor on the solved boundary so the anchor-based
    // APCA readouts stay frozen through locked sweeps too.
    _bgHeldLum = desired;
    _bgHeldRgb = cR + ',' + cG + ',' + cB;
  } else {
    // Free side = wheel fg; selectedRgbBiased() biases away from the bg
    targetLum = desired;
    lumSlider.value = String(Math.round(targetLum * 1000));
    if (document.activeElement !== lumValEl) lumValEl.value = targetLum.toFixed(3);
    saveToStorage('sel-lum', String(relLumOf(targetLum)));
    scheduleRender(true);
  }
}

/** The integer RGB the free side would render at luminance `lum`. Mirrors the
    setters in applyLockAdjustment (including their quantization biases) so an
    enforcement can be skipped exactly when it wouldn't change the color. */
function lockFreeRgbAt(changed, lum) {
  if (changed === 'fg') { // free side = custom bg
    const dir = Math.sign(lum - targetLum);
    if (customMode === 'lum') {
      return hslToRgb(cuHue, cuSat, findLightnessBiased(cuHue, cuSat, lum, dir));
    }
    if (customMode === 'gray') {
      const lRaw = findLightness(0, 0, lum) * 255;
      const v = Math.max(0, Math.min(255,
        dir > 0 ? Math.ceil(lRaw) : dir < 0 ? Math.floor(lRaw) : Math.round(lRaw)));
      return [v, v, v];
    }
    return hslToRgb(cH, cS, findLightnessBiased(cH, cS, lum, dir));
  }
  const dir = Math.sign(lum - wheelLum(cR, cG, cB));
  return hslToRgb(selHue, selSat, findLightnessBiased(selHue, selSat, lum, dir));
}

/** true when `rgb` already matches the free side's current color. */
function lockFreeAtRgb(changed, rgb) {
  const cur = changed === 'fg' ? [cR, cG, cB] : selectedRgbBiased();
  return rgb[0] === cur[0] && rgb[1] === cur[1] && rgb[2] === cur[2];
}

// ── Alpha-aware contrast lock ────────────────────────────────────────────────
// When either side is translucent, the lock must hold the COMPOSITED (visible)
// contrast, not the opaque one. The closed-form WCAG solve and the APCA branch
// search both assume opaque colours, so for the translucent case we numerically
// search the free side's underlying luminance for the point where the effective
// contrast meets the target — mirroring how the contrast tiles composite.
function lockHasAlpha() { return selAlpha < 0.9995 || cAlpha < 0.9995; }

/** Composited contrast at a candidate free-side luminance, computed in the SAME
    gray-composite luminance space as the status readouts (compositeRelLum /
    compositeYs) — so the lock pins exactly what the badges judge (no flicker, no
    residual gap after a Lum/Alpha drag). `lum`, targetLum and bgLumAnchor() are
    all in wheelLum units (relative luminance in WCAG mode, Ys in APCA mode). */
function effLockMetricAt(changed, lum, metric) {
  const apca = metric === 'apca';
  const uL = apca ? apcaY(...underlayRgb) : relativeLuminance(...underlayRgb);
  const comp = apca ? compositeYs : compositeRelLum;
  const fgL = changed === 'fg' ? targetLum : lum;      // wheel = text; free when changed==='bg'
  const bgL = changed === 'fg' ? lum : bgLumAnchor();  // custom = bg;  free when changed==='fg'
  const eb = comp(bgL, cAlpha, uL);
  const et = comp(fgL, selAlpha, eb);
  return apca ? Math.abs(apcaLcYs(et, eb)) : contrastRatio(et, eb);
}

/** Free-side underlying luminance for the translucent lock, as {lum, reached}:
    - reached: a luminance whose composited contrast meets `target`, chosen nearest
      the current one (least disruptive).
    - !reached (target unreachable at this opacity): the luminance that MAXIMISES the
      composited contrast — a best-effort pin so the pair gets as close as physically
      possible while the caller shows a "can't reach" message, instead of leaving the
      free side stranded (which read as the lock silently not following). */
function solveLockAlpha(changed, metric, target) {
  const cur = changed === 'fg' ? wheelLum(cR, cG, cB) : wheelLum(...selectedRgbBiased());
  const m = lum => effLockMetricAt(changed, lum, metric);
  // Pin the free side so the CONTINUOUS pair meets the ACTUAL target — not target−EPS. Aiming
  // at target−EPS (the old behaviour) left the pinned pair half a step short, so the guaranteed
  // floor was really target−EPS while the tile snapped the DISPLAY up to the target: the rendered
  // 8-bit contrast then read BELOW the shown floor (e.g. "Lc 60 (59)"). Aiming at the target makes
  // the floor a true minimum — the biased 8-bit render lands at/above it, so measured ≥ floor.
  // EPS survives only as the "reached" tolerance (below): a pair whose best contrast rounds to the
  // target (≥ target−EPS: WCAG 2 dp, APCA nearest integer) still reports met, absorbing the
  // float error at exact-boundary pins (e.g. contrastRatio(1, 0.10) = 6.9999999 for a 7:1 lock).
  const EPS = metric === 'apca' ? 0.5 : 0.005;
  const f = lum => m(lum) - target;
  const N = 256;
  const bounds = [];
  // bestL/M: coarse argmax (for the unreachable best-effort pin). worstL/M: coarse argmin —
  // the CROSSOVER where the two colors' contrast is minimal; the target's two solutions sit one
  // on each side of it, so it partitions "lighter" (> worstL) from "darker" (< worstL) correctly
  // even when alpha compositing shifts that point away from equal underlying luminance.
  let prevL = 0, prevF = f(0), bestL = 0, bestM = m(0), worstL = 0, worstM = m(0);
  for (let i = 1; i <= N; i++) {
    const l = i / N, fl = f(l), ml = fl + target;
    if (ml > bestM) { bestM = ml; bestL = l; }
    if (ml < worstM) { worstM = ml; worstL = l; }
    if ((prevF < 0) !== (fl < 0)) { // sign change ⇒ a target-boundary between prevL and l
      let lo = prevL, hi = l;
      for (let k = 0; k < 28; k++) { const mid = (lo + hi) / 2; if ((f(mid) < 0) === (prevF < 0)) lo = mid; else hi = mid; }
      bounds.push((lo + hi) / 2);
    }
    prevL = l; prevF = fl;
  }
  if (bounds.length) {
    if (bounds.length === 1) return { lum: bounds[0], reached: true };
    if (lockSide === 'mid') {
      // "Mid" mode: of the (still target-meeting) solutions, take the one whose luminance is
      // closest to 0.5 in the active metric (relative luminance in WCAG mode, APCA Ys in APCA
      // mode) — the most moderate of the two. Ties → nearer the current luminance.
      const byMid = bounds.slice().sort((a, b) =>
        (Math.abs(a - 0.5) - Math.abs(b - 0.5)) || (Math.abs(a - cur) - Math.abs(b - cur)));
      return { lum: byMid[0], reached: true };
    }
    // Split by the crossover, then take the user's preferred side (falling back to the other
    // when only one side reaches the target). Within a side, the nearest solution to the current
    // luminance wins, so the pick stays as stable/least-disruptive as before.
    const lighter = bounds.filter(b => b > worstL);
    const darker  = bounds.filter(b => b <= worstL);
    let pool = lockSide === 'lighter' ? lighter : darker;
    if (!pool.length) pool = lockSide === 'lighter' ? darker : lighter;
    pool.sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur));
    return { lum: pool[0], reached: true };
  }
  if (f(0) >= 0 || f(1) >= 0) return { lum: cur, reached: true }; // meets target everywhere → keep
  // No luminance reaches the target exactly. Pin at the max-contrast point (best effort) and
  // refine the coarse argmax. Report reached when that best rounds to the target (bestM ≥
  // target−EPS) — so a pair whose display rounds to the target isn't flagged "can't reach";
  // otherwise it's genuinely short and the caller shows the message.
  let lo = Math.max(0, bestL - 1 / N), hi = Math.min(1, bestL + 1 / N);
  for (let k = 0; k < 24; k++) {
    const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
    if (m(a) < m(b)) lo = a; else hi = b;
  }
  return { lum: (lo + hi) / 2, reached: bestM >= target - EPS };
}

/** Pin the free side to continuous luminance `desired` for the translucent lock.
    The status/anchors judge the CONTINUOUS held luminance, so it must track `desired`
    exactly every tick — otherwise the badge drifts off-target between 8-bit steps (the
    flicker) and can end a drag below target. The quantized RGB is only re-set when it
    would actually change, so a steady-state re-enforce (the settle pass) refreshes the
    anchor WITHOUT scheduling a render — which would otherwise loop the settle forever. */
function applyLockAlpha(changed, desired) {
  if (!lockFreeAtRgb(changed, lockFreeRgbAt(changed, desired))) {
    applyLockAdjustment(changed, desired); // RGB moves → full setter + render + anchor
    return;
  }
  if (changed === 'fg') {                  // free = custom bg
    // In LUM mode the status/anchor reads cuLum (not _bgHeldLum), so refresh THAT too —
    // otherwise a quantization-unchanged pin leaves cuLum stale and tile A shows the old
    // (sub-target) ratio while the lock reports "met" (e.g. 6.98 under a 7:1 lock).
    if (customMode === 'lum') {
      cuLum = desired;
      const s = /** @type {HTMLInputElement} */ (document.getElementById('cu-lum-slider'));
      const v = /** @type {HTMLInputElement} */ (document.getElementById('cu-lum-val'));
      if (s) s.value = String(Math.round(cuLum * 1000));
      if (v && document.activeElement !== v) v.value = cuLum.toFixed(3);
    }
    _bgHeldLum = desired;
    _bgHeldRgb = cR + ',' + cG + ',' + cB;
  } else {                                 // free = wheel text; anchor is targetLum itself
    targetLum = desired;
    lumSlider.value = String(Math.round(targetLum * 1000));
    if (document.activeElement !== lumValEl) lumValEl.value = targetLum.toFixed(3);
    saveToStorage('sel-lum', String(relLumOf(targetLum)));
  }
}

function enforceContrastLock(changed) {
  if (contrastLockMode === 'off') { _contrastLockMet = false; _lumStateKey = null; return; }
  _inEnforcement = true;
  try { _enforceContrastLockInner(changed); } finally { _inEnforcement = false; }
}

// Re-pin after a lock CONFIG change (turned on, mode switched, or a new target) rather than a
// colour change. The lumStateKey guard normally skips frames whose held luminances are
// unchanged (hue/sat sweeps) — but a target/mode change keeps the luminances yet must still
// move the free side to the NEW target, so clear the key to force one enforcement. Holds
// `changed` (the last-touched side) and adjusts the other, exactly like a colour edit does.
function reenforceContrastLock(changed) {
  _lumStateKey = null;
  enforceContrastLock(changed);
}

function _enforceContrastLockInner(changed) {
  if (apcaLockActive()) { enforceApcaLock(changed); return; }
  if (!contrastLockTarget) { _contrastLockMet = false; _lumStateKey = null; return; }
  const R = contrastLockTarget;

  // Skip when nothing contrast-relevant changed. By the wheel's construction only Lum and
  // Opacity move relative luminance, so a hue/sat sweep in Lum mode holds every luminance —
  // the lock must NOT re-pin the free side or shift the status. lumStateKey() (both sides'
  // held luminances + both alphas + underlay) is unchanged then, so we return. A Lum/Opacity
  // edit — or an HSL-mode hue/sat sweep, which moves bgLumAnchor() — changes the key and
  // re-pins (the intended exception where the main picker is in HSL mode).
  if (lumStateKey() === _lumStateKey) return;
  // Anchor-based numeric solve — for opaque OR translucent (solveLockAlpha composites over
  // alpha, a no-op at alpha 1, and judges the HELD anchor luminances, not the rendered 8-bit
  // RGB). It pins the free side's anchor so the ANCHOR pair meets R exactly and every
  // reachable hue/sat (which shares that anchor luminance) meets it too; best-effort
  // maximise when R is unreachable at this luminance/opacity.
  const sol = solveLockAlpha(changed, 'wcag', R);
  _contrastLockMet = sol.reached;
  applyLockAlpha(changed, sol.lum);
  _lumStateKey = lumStateKey(); // post-pin state, so the settle pass and hue/sat sweeps no-op
  setContrastLockError(
    sol.reached ? '' : changed === 'fg' ? `BG can't reach ${R}:1` : `Text can't reach ${R}:1`,
    sol.reached ? undefined : changed === 'fg' ? `No background can reach ${R}:1 here.` : `No wheel color can reach ${R}:1 here.`);
}

// ─── APCA lock ────────────────────────────────────────────────────────────────
// Pins the free side so |Lc(text = wheel color, bg = custom color)| meets the
// target. APCA is polarity-aware and has no closed-form inverse through the
// hue/sat-preserving lightness solver, so the boundary is found numerically:
// |Lc| is ~0 where the free side's luminance matches the fixed side's and
// grows monotonically toward black and white, giving at most two boundary
// solutions. As with the WCAG 2 lock, the more moderate one (closer to mid
// luminance) wins.

function enforceApcaLock(changed) {
  const T = apcaLockTarget;
  if (!T) { _contrastLockMet = false; _lumStateKey = null; return; }
  const Td = Math.round(T); // integer for human-readable messages (T may be a fractional Type target)

  // Skip when nothing contrast-relevant changed (hue/sat sweep in Lum mode holds every
  // luminance — see the WCAG lock's note). Otherwise pin the free side's HELD luminance
  // (anchor-based, opaque or translucent) so the anchor |Lc| meets T for every reachable
  // hue/sat; best-effort maximise when T is unreachable.
  if (lumStateKey() === _lumStateKey) return;
  const sol = solveLockAlpha(changed, 'apca', T);
  _contrastLockMet = sol.reached;
  applyLockAlpha(changed, sol.lum);
  _lumStateKey = lumStateKey();
  setContrastLockError(
    sol.reached ? '' : changed === 'fg' ? `BG can't reach Lc ${Td}` : `Text can't reach Lc ${Td}`,
    sol.reached ? undefined : changed === 'fg' ? `No background can reach |Lc| ${Td} here.` : `No wheel color can reach |Lc| ${Td} here.`);
}

// ─── Custom color wheel ───────────────────────────────────────────────────────

const CW_CSS = 148;
const CW_DPR = Math.min(window.devicePixelRatio || 1, 2);
const CW_BUF = Math.round(CW_CSS * CW_DPR); // integer, same reason as BUF_SZ

const customWheelCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById('custom-wheel'));
customWheelCanvas.width = customWheelCanvas.height = CW_BUF;
const cwCtx = /** @type {CanvasRenderingContext2D} */ (customWheelCanvas.getContext('2d'));

// Caches for wheel backgrounds (expensive to render; invalidated only when the
// governing lightness/luminance changes — dragging H/S sliders reuses the cache)
let _cwLumCache = null;   // { lum: number, imageData: ImageData }
let _cwColorCache = null; // { l: number, imageData: ImageData }

function renderCustomWheel() {
  const radius = CW_BUF / 2;

  // ── Gray mode: solid circle ────────────────────────────────────────────────
  if (customMode === 'gray') {
    const img  = cwCtx.createImageData(CW_BUF, CW_BUF);
    const data = img.data;
    for (let py = 0; py < CW_BUF; py++) {
      for (let px = 0; px < CW_BUF; px++) {
        const dx = px - radius, dy = py - radius;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius + 1) continue;
        const alpha = dist > radius - 0.5
          ? Math.max(0, Math.round((radius + 1 - dist) * 255)) : 255;
        const idx = (py * CW_BUF + px) * 4;
        const [tr, tg, tb] = cvdTransformRgb(cR, cG, cB);
        data[idx] = tr; data[idx+1] = tg; data[idx+2] = tb; data[idx+3] = alpha;
      }
    }
    cwCtx.putImageData(img, 0, 0);
    return;
  }

  // ── Lum mode: luminance-locked wheel (same as main, using cuLum) ───────────
  if (customMode === 'lum') {
    if (!_cwLumCache || _cwLumCache.lum !== cuLum) {
      // Reuse the cached pixel buffer across lum-drag frames (zero allocation):
      // the circular mask is geometry-only and constant, so every inside pixel is
      // rewritten and the skipped outside pixels stay transparent from first alloc.
      const img  = _cwLumCache ? _cwLumCache.imageData : cwCtx.createImageData(CW_BUF, CW_BUF);
      const data = img.data;
      for (let py = 0; py < CW_BUF; py++) {
        for (let px = 0; px < CW_BUF; px++) {
          const dx = px - radius, dy = py - radius;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > radius + 1) continue;
          const hue = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
          const sat = Math.min(dist / radius, 1);
          const l   = findLightness(hue, sat, cuLum);
          const [rr, gg, bb] = hslToRgb(hue, sat, l);
          const [tr, tg, tb] = cvdTransformRgb(rr, gg, bb);
          const alpha = dist > radius - 0.5
            ? Math.max(0, Math.round((radius + 1 - dist) * 255)) : 255;
          const idx = (py * CW_BUF + px) * 4;
          data[idx] = tr; data[idx+1] = tg; data[idx+2] = tb; data[idx+3] = alpha;
        }
      }
      _cwLumCache = { lum: cuLum, imageData: img };
    }
    cwCtx.putImageData(_cwLumCache.imageData, 0, 0);
    // Marker at cuHue / cuSat
    const mAngle = cuHue * Math.PI / 180;
    const mDist  = cuSat * radius;
    const mx = radius + Math.cos(mAngle) * mDist;
    const my = radius + Math.sin(mAngle) * mDist;
    cwCtx.save();
    cwCtx.strokeStyle = relativeLuminance(cR, cG, cB) > 0.179
      ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)';
    cwCtx.lineWidth = 1.5 * CW_DPR;
    cwCtx.beginPath();
    cwCtx.arc(mx, my, 4.5 * CW_DPR, 0, Math.PI * 2);
    cwCtx.stroke();
    cwCtx.restore();
    return;
  }

  // ── Color mode: HSL wheel at current lightness (original behavior) ──────────
  if (!_cwColorCache || _cwColorCache.l !== cL) {
    const img  = _cwColorCache ? _cwColorCache.imageData : cwCtx.createImageData(CW_BUF, CW_BUF);
    const data = img.data;
    for (let py = 0; py < CW_BUF; py++) {
      for (let px = 0; px < CW_BUF; px++) {
        const dx = px - radius, dy = py - radius;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius + 1) continue;
        const hue = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
        const sat = Math.min(dist / radius, 1);
        const [rr, gg, bb] = hslToRgb(hue, sat, cL);
        const [tr, tg, tb] = cvdTransformRgb(rr, gg, bb);
        const alpha = dist > radius - 0.5
          ? Math.max(0, Math.round((radius + 1 - dist) * 255)) : 255;
        const idx = (py * CW_BUF + px) * 4;
        data[idx] = tr; data[idx+1] = tg; data[idx+2] = tb; data[idx+3] = alpha;
      }
    }
    _cwColorCache = { l: cL, imageData: img };
  }
  cwCtx.putImageData(_cwColorCache.imageData, 0, 0);
  const mAngle = cH * Math.PI / 180;
  const mDist  = cS * radius;
  const mx = radius + Math.cos(mAngle) * mDist;
  const my = radius + Math.sin(mAngle) * mDist;
  cwCtx.save();
  cwCtx.strokeStyle = cL > 0.5 ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)';
  cwCtx.lineWidth = 1.5 * CW_DPR;
  cwCtx.beginPath();
  cwCtx.arc(mx, my, 4.5 * CW_DPR, 0, Math.PI * 2);
  cwCtx.stroke();
  cwCtx.restore();
}

let cwIsDown = false;

function handleCustomWheelPointer(e) {
  if (customMode === 'gray') return; // wheel is non-interactive in gray mode
  const rect = customWheelCanvas.getBoundingClientRect();
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  const dx = cx - rect.left - rect.width / 2;
  const dy = cy - rect.top  - rect.height / 2;
  const r   = rect.width / 2;
  const sat = Math.min(Math.sqrt(dx * dx + dy * dy) / r, 1);
  const hue = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
  if (customMode === 'lum') {
    setCustomFromLumHueSat(cuLum, hue, sat);
  } else {
    setCustomHueSat(hue, sat);
  }
}

customWheelCanvas.addEventListener('mousedown', e => { cwIsDown = true; handleCustomWheelPointer(e); });
document.addEventListener('mousemove', e => { if (cwIsDown) handleCustomWheelPointer(e); });
document.addEventListener('mouseup', () => { cwIsDown = false; });
customWheelCanvas.addEventListener('touchstart', e => {
  e.preventDefault(); cwIsDown = true; handleCustomWheelPointer(e);
}, { passive: false });
document.addEventListener('touchmove', e => {
  if (cwIsDown) { e.preventDefault(); handleCustomWheelPointer(e); }
}, { passive: false });
document.addEventListener('touchend', () => { cwIsDown = false; });

// ─── Custom color panel ───────────────────────────────────────────────────────

function updateCustomSliderTracks() {
  const rSl = /** @type {HTMLInputElement} */ (document.getElementById('c-r-slider'));
  const gSl = /** @type {HTMLInputElement} */ (document.getElementById('c-g-slider'));
  const bSl = /** @type {HTMLInputElement} */ (document.getElementById('c-b-slider'));
  const hSl = /** @type {HTMLInputElement} */ (document.getElementById('c-h-slider'));
  const sSl = /** @type {HTMLInputElement} */ (document.getElementById('c-s-slider'));
  const lSl = /** @type {HTMLInputElement} */ (document.getElementById('c-l-slider'));

  rSl.style.backgroundImage = `linear-gradient(to right,${cvdTransformHex(toHex(0,cG,cB))},${cvdTransformHex(toHex(255,cG,cB))})`;
  gSl.style.backgroundImage = `linear-gradient(to right,${cvdTransformHex(toHex(cR,0,cB))},${cvdTransformHex(toHex(cR,255,cB))})`;
  bSl.style.backgroundImage = `linear-gradient(to right,${cvdTransformHex(toHex(cR,cG,0))},${cvdTransformHex(toHex(cR,cG,255))})`;

  const hStops = Array.from({ length: 13 }, (_, i) => {
    const h = i * 30;
    return `${cvdTransformHex(toHex(...hslToRgb(h, cS, cL)))} ${Math.round(i / 12 * 100)}%`;
  });
  hSl.style.backgroundImage = `linear-gradient(to right,${hStops.join(',')})`;
  sSl.style.backgroundImage = `linear-gradient(to right,${cvdTransformHex(toHex(...hslToRgb(cH,0,cL)))},${cvdTransformHex(toHex(...hslToRgb(cH,1,cL)))})`;
  lSl.style.backgroundImage = `linear-gradient(to right,${cvdTransformHex(toHex(...hslToRgb(cH,cS,0)))},${cvdTransformHex(toHex(...hslToRgb(cH,cS,0.5)))},${cvdTransformHex(toHex(...hslToRgb(cH,cS,1)))})`;
}

let _cuTracksKey = '';
function updateLumModeSliderTracks() {
  const key = cuHue + '/' + cuSat + '/' + cuLum;
  if (key === _cuTracksKey) return;
  _cuTracksKey = key;
  const lumSl = /** @type {HTMLInputElement} */ (document.getElementById('cu-lum-slider'));
  const satSl = /** @type {HTMLInputElement} */ (document.getElementById('cu-sat-slider'));
  const hueSl = /** @type {HTMLInputElement} */ (document.getElementById('cu-hue-slider'));

  // Luminance track: actual hue/sat colors sampled across lum 0→1
  const lumStops = [0, 0.04, 0.18, 0.40, 0.65, 1.0].map(lm => {
    const l = findLightness(cuHue, cuSat, lm);
    return `${cvdTransformHex(toHex(...hslToRgb(cuHue, cuSat, l)))} ${Math.round(lm * 100)}%`;
  });
  lumSl.style.backgroundImage = `linear-gradient(to right,${lumStops.join(',')})`;

  // Saturation track: achromatic → vivid at current hue/lum
  const s0 = cvdTransformHex(toHex(...hslToRgb(cuHue, 0, findLightness(cuHue, 0, cuLum))));
  const s1 = cvdTransformHex(toHex(...hslToRgb(cuHue, 1, findLightness(cuHue, 1, cuLum))));
  satSl.style.backgroundImage = `linear-gradient(to right,${s0},${s1})`;

  // Hue track: rotate hue at current sat/lum
  const hStops = Array.from({ length: 13 }, (_, i) => {
    const h = i * 30;
    const l = findLightness(h, cuSat, cuLum);
    return `${cvdTransformHex(toHex(...hslToRgb(h, cuSat, l)))} ${Math.round(i / 12 * 100)}%`;
  });
  hueSl.style.backgroundImage = `linear-gradient(to right,${hStops.join(',')})`;
}

/** Sync all custom controls EXCEPT the hex text input (safe while user is typing). */
function syncCustomControls() {
  customColor = toHex(cR, cG, cB);
  saveToStorage('sel-custom-color', customColor);
  if (customMode === 'gray') {
    customGraySaved = cR;
    saveToStorage('custom-gray-v', String(customGraySaved));
  } else {
    // Color and Lum share the same color save slot
    customColorSaved = { r: cR, g: cG, b: cB };
    saveToStorage('custom-color-rgb', JSON.stringify(customColorSaved));
    if (customMode === 'lum') {
      customLumSaved = { lum: relLumOf(cuLum), hue: cuHue, sat: cuSat };
      saveToStorage('custom-lum-v', JSON.stringify(customLumSaved));
    }
  }
  const customSwatchEl = /** @type {HTMLElement} */ (document.getElementById('custom-swatch-display'));
  // Show the swatch as it appears on the white page (composite when translucent).
  const cvdCustomColor = cvdTransformHex(toHex(...compositeRgb([cR, cG, cB], cAlpha, underlayRgb)));
  const [cvdCustomR, cvdCustomG, cvdCustomB] = hexToRgb(cvdCustomColor);
  customSwatchEl.style.background = cvdCustomColor;
  customSwatchEl.style.color = relativeLuminance(cvdCustomR, cvdCustomG, cvdCustomB) > 0.179
    ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.75)';
  // Alpha slider + readout — one per mode (Lum shows it 2nd, others last); all synced.
  document.querySelectorAll('.custom-sliders-wrap .custom-alpha-slider').forEach(
    sl => { /** @type {HTMLInputElement} */ (sl).value = String(Math.round(cAlpha * 100)); });
  document.querySelectorAll('.custom-sliders-wrap .custom-alpha-val').forEach(
    v => { if (document.activeElement !== v) /** @type {HTMLInputElement} */ (v).value = Math.round(cAlpha * 100) + '%'; });
  saveToStorage('custom-alpha', String(cAlpha));

  const grayVal = Math.round(cL * 255);
  /** @type {HTMLInputElement} */ (document.getElementById('c-gray-slider')).value = String(grayVal);
  setValIfBlurred('c-gray-val', String(grayVal));

  /** @type {HTMLInputElement} */ (document.getElementById('c-r-slider')).value = String(cR);
  /** @type {HTMLInputElement} */ (document.getElementById('c-g-slider')).value = String(cG);
  /** @type {HTMLInputElement} */ (document.getElementById('c-b-slider')).value = String(cB);
  setValIfBlurred('c-r-val', String(cR));
  setValIfBlurred('c-g-val', String(cG));
  setValIfBlurred('c-b-val', String(cB));

  /** @type {HTMLInputElement} */ (document.getElementById('c-h-slider')).value = String(Math.round(cH));
  /** @type {HTMLInputElement} */ (document.getElementById('c-s-slider')).value = String(Math.round(cS * 100));
  /** @type {HTMLInputElement} */ (document.getElementById('c-l-slider')).value = String(Math.round(cL * 100));
  setUnitVal(document.getElementById('c-h-val'), Math.round(cH), '°');
  setUnitVal(document.getElementById('c-s-val'), Math.round(cS * 100), '%');
  setUnitVal(document.getElementById('c-l-val'), Math.round(cL * 100), '%');

  updateCustomSliderTracks();
  renderCustomWheel();

  if (customMode === 'lum') {
    const cuLumSl = /** @type {HTMLInputElement} */ (document.getElementById('cu-lum-slider'));
    const cuSatSl = /** @type {HTMLInputElement} */ (document.getElementById('cu-sat-slider'));
    const cuHueSl = /** @type {HTMLInputElement} */ (document.getElementById('cu-hue-slider'));
    if (document.activeElement !== cuLumSl) cuLumSl.value = String(Math.round(cuLum * 1000));
    if (document.activeElement !== cuSatSl) cuSatSl.value = String(Math.round(cuSat * 100));
    if (document.activeElement !== cuHueSl) cuHueSl.value = String(Math.round(cuHue));
    setValIfBlurred('cu-lum-val', cuLum.toFixed(3));
    setUnitVal(document.getElementById('cu-sat-val'), Math.round(cuSat * 100), '%');
    setUnitVal(document.getElementById('cu-hue-val'), Math.round(cuHue), '°');
    updateLumModeSliderTracks();
  }
}

/** Full sync including hex text input (use when change did NOT come from that input). */
function syncCustomUI() {
  const chi = /** @type {HTMLInputElement} */ (document.getElementById('custom-hex-input'));
  // Don't rewrite the field while the user is typing in it — otherwise a live edit (which
  // re-renders) reformats a half-typed value, so "000"/"fff" shorthand gets auto-expanded
  // mid-keystroke. Like the main TEXT hex field, expansion happens only on Enter/blur.
  if (document.activeElement !== chi) chi.value = formatHex(toHexA(cR, cG, cB, cAlpha));
  fitHexField(chi);
  syncCustomControls();
}

function setCustomFromRgb(r, g, b) {
  cR = Math.round(Math.max(0, Math.min(255, r)));
  cG = Math.round(Math.max(0, Math.min(255, g)));
  cB = Math.round(Math.max(0, Math.min(255, b)));
  const [h, s, l] = rgbToHsl(cR, cG, cB);
  cH = h; cS = s; cL = l;
  scheduleRender(false, true);
}

function setCustomFromHsl(h, s, l) {
  cH = h; cS = s; cL = l;
  const [r, g, b] = hslToRgb(cH, cS, cL);
  cR = r; cG = g; cB = b;
  scheduleRender(false, true);
}

// ─── Luminance-holding hue/sat for the custom COLOR mode ─────────────────────
// Classically the Color-mode H/S controls hold HSL lightness, which lets the
// colour's LUMINANCE wander — so a hue sweep could drag the background into a
// mid luminance no text can contrast against ("can't reach" errors while
// locked). With a contrast target active, or once the user has deliberately
// set BOTH sides' luminance values, hue/sat must not change the achieved
// contrast: re-solve the lightness to hold the colour's wheel-luminance
// (quantization biased away from the text side so the achieved contrast
// stays at-or-above, never below). Otherwise keep the classic HSL behaviour.
// Continuous luminance anchor for the BG, maintained by the contrast lock
// (applyLockAdjustment) so the anchor-based APCA/WCAG readouts stay frozen
// through locked sweeps. Not touched by the HSL sliders — those are classic.
let _bgHeldLum = 0, _bgHeldRgb = '';
// Color mode's H/S = a CLASSIC HSL picker: hold lightness, so dragging hue or
// saturation never moves the Lightness slider (luminance/contrast may change).
// Luminance-locked exploration is Lum mode's job (setCustomFromLumHueSat holds
// the luminance); when a contrast lock is on, enforceContrastLock re-pins the
// OTHER side to the target — the classic HSL side you drag is left as you set it.
function setCustomHueSat(h, s) {
  setCustomFromHsl(h, s, cL);
}

// ─────────────────────────────────────────────────────────────────────────────

function updateMarkerPosition() {
  const angle = selHue * Math.PI / 180;
  selX = CSS_SZ / 2 + Math.cos(angle) * selSat * R_CSS;
  selY = CSS_SZ / 2 + Math.sin(angle) * selSat * R_CSS;
}

function syncSliders() {
  hueSlider.value      = String(Math.round(selHue));
  satSlider.value      = String(Math.round(selSat * 100));
  setUnitVal(hueValEl, Math.round(selHue), '°');
  setUnitVal(satValEl, Math.round(selSat * 100), '%');
}

// ─── Pointer interaction ──────────────────────────────────────────────────────

function handlePointer(e) {
  const rect  = wheelCanvas.getBoundingClientRect();
  const ex    = e.touches ? e.touches[0].clientX : e.clientX;
  const ey    = e.touches ? e.touches[0].clientY : e.clientY;
  // Normalise rendered-px → CSS_SZ coords so marker drawing stays in sync
  const scale = CSS_SZ / rect.width;
  const px    = (ex - rect.left) * scale;
  const py    = (ey - rect.top)  * scale;

  const cx = CSS_SZ / 2, cy = CSS_SZ / 2;
  const dx = px - cx, dy = py - cy;
  const dist  = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);

  if (dist <= R_CSS) {
    selX = px; selY = py; selSat = dist / R_CSS;
  } else {
    selX = cx + Math.cos(angle) * R_CSS;
    selY = cy + Math.sin(angle) * R_CSS;
    selSat = 1;
  }
  selHue = ((angle * 180 / Math.PI) + 360) % 360;

  syncSliders();
  scheduleRender();
  saveToStorage('sel-hue', String(selHue));
  saveToStorage('sel-sat', String(selSat));
}

wheelCanvas.addEventListener('mousedown', e => { isDown = true; handlePointer(e); });
document.addEventListener('mousemove',    e => { if (isDown) handlePointer(e); });
document.addEventListener('mouseup',      () => { isDown = false; });
wheelCanvas.addEventListener('touchstart', e => {
  e.preventDefault(); isDown = true; handlePointer(e);
}, { passive: false });
document.addEventListener('touchmove', e => {
  if (isDown) { e.preventDefault(); handlePointer(e); }
}, { passive: false });
document.addEventListener('touchend', () => { isDown = false; });
wheelCanvas.style.cursor = 'crosshair';

// ─── Wheel slider elements ────────────────────────────────────────────────────

const lumSlider = /** @type {HTMLInputElement} */ (document.getElementById('lum-slider'));
const hueSlider = /** @type {HTMLInputElement} */ (document.getElementById('hue-slider'));
const satSlider = /** @type {HTMLInputElement} */ (document.getElementById('sat-slider'));
const lumValEl  = /** @type {HTMLInputElement} */ (document.getElementById('lum-val'));
const hueValEl  = /** @type {HTMLInputElement} */ (document.getElementById('hue-val'));
const satValEl  = /** @type {HTMLInputElement} */ (document.getElementById('sat-val'));
const alphaSlider = /** @type {HTMLInputElement} */ (document.getElementById('alpha-slider'));
const alphaValEl  = /** @type {HTMLInputElement} */ (document.getElementById('alpha-val'));

alphaSlider.addEventListener('input', () => {
  selAlpha = Math.max(0, Math.min(1, alphaSlider.value / 100));
  if (document.activeElement !== alphaValEl) alphaValEl.value = Math.round(selAlpha * 100) + '%';
  scheduleRender();
  saveToStorage('sel-alpha', String(selAlpha));
});

lumSlider.addEventListener('input', () => {
  targetLum = lumSlider.value / 1000;
  if (document.activeElement !== lumValEl) lumValEl.value = targetLum.toFixed(3);
  scheduleRender(true);
  saveToStorage('sel-lum', String(relLumOf(targetLum)));
});

hueSlider.addEventListener('input', () => {
  selHue = parseFloat(hueSlider.value);
  setUnitVal(hueValEl, Math.round(selHue), '°');
  updateMarkerPosition();
  scheduleRender();
  saveToStorage('sel-hue', String(selHue));
});

satSlider.addEventListener('input', () => {
  selSat = satSlider.value / 100;
  setUnitVal(satValEl, Math.round(selSat * 100), '%');
  updateMarkerPosition();
  scheduleRender();
  saveToStorage('sel-sat', String(selSat));
});

// A native <input type=range> tracks its thumb through the browser's implicit pointer capture.
// In web Figma the plugin runs in a sandboxed iframe that DROPS that capture on a quick mouse
// drag, so the thumb stalls and stops following (native Figma is unaffected). The colour wheel
// stays smooth there because it drags off DOCUMENT-level pointer events, which web Figma always
// delivers — so drive the sliders the same way: while a range is pressed, follow the document's
// pointermove and set the value from the cursor's X. The mapping matches the browser's exactly
// (usable track = width minus one thumb, split as an inset each side), so on the normal path
// where native tracking works this computes the identical value and is a harmless no-op; where
// native stalls, it keeps the drag going. Delegated so it also covers the chip editor's
// dynamically-built sliders, and it never preventDefaults so click-to-set and keyboard still work.
let _sliderDrag = null;
function sliderValueAtX(el, clientX) {
  const r = el.getBoundingClientRect();
  const inset = (IS_COARSE ? 24 : 13) / 2; // half the thumb (matches the CSS thumb size)
  const usable = Math.max(1, r.width - inset * 2);
  const frac = Math.max(0, Math.min(1, (clientX - (r.left + inset)) / usable));
  const min = el.min === '' ? 0 : +el.min;
  const max = el.max === '' ? 100 : +el.max;
  const step = +el.step || 1;
  const v = min + Math.round((frac * (max - min)) / step) * step;
  return Math.max(min, Math.min(max, v));
}
document.addEventListener('pointerdown', e => {
  const el = /** @type {HTMLElement} */ (e.target);
  if (el instanceof HTMLInputElement && el.type === 'range' && !el.disabled) {
    _sliderDrag = { el, id: e.pointerId };
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* best effort */ }
  }
}, true);
document.addEventListener('pointermove', e => {
  if (!_sliderDrag || e.pointerId !== _sliderDrag.id) return;
  const el = _sliderDrag.el;
  const v = String(sliderValueAtX(el, e.clientX));
  if (el.value !== v) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
});
function _endSliderDrag(e) {
  if (_sliderDrag && (e.pointerId === undefined || e.pointerId === _sliderDrag.id)) _sliderDrag = null;
}
document.addEventListener('pointerup', _endSliderDrag);
document.addEventListener('pointercancel', _endSliderDrag);

// ─── Custom color panel event listeners ──────────────────────────────────────

document.getElementById('c-r-slider').addEventListener('input', e => {
  cR = +/** @type {HTMLInputElement} */ (e.target).value;
  [cH, cS, cL] = rgbToHsl(cR, cG, cB);
  scheduleRender(false, true);
});
document.getElementById('c-g-slider').addEventListener('input', e => {
  cG = +/** @type {HTMLInputElement} */ (e.target).value;
  [cH, cS, cL] = rgbToHsl(cR, cG, cB);
  scheduleRender(false, true);
});
document.getElementById('c-b-slider').addEventListener('input', e => {
  cB = +/** @type {HTMLInputElement} */ (e.target).value;
  [cH, cS, cL] = rgbToHsl(cR, cG, cB);
  scheduleRender(false, true);
});
document.getElementById('c-h-slider').addEventListener('input', e => {
  setCustomHueSat(+/** @type {HTMLInputElement} */ (e.target).value, cS);
});
document.getElementById('c-s-slider').addEventListener('input', e => {
  setCustomHueSat(cH, +/** @type {HTMLInputElement} */ (e.target).value / 100);
});
document.getElementById('c-l-slider').addEventListener('input', e => {
  cL = +/** @type {HTMLInputElement} */ (e.target).value / 100;
  [cR, cG, cB] = hslToRgb(cH, cS, cL);
  scheduleRender(false, true);
});

// Grayscale slider
document.getElementById('c-gray-slider').addEventListener('input', e => {
  const v = +/** @type {HTMLInputElement} */ (e.target).value;
  setCustomFromRgb(v, v, v);
});

// Opacity sliders (custom BG) — one per mode; all drive the same cAlpha.
document.querySelectorAll('.custom-sliders-wrap .custom-alpha-slider').forEach(sl => {
  sl.addEventListener('input', e => {
    cAlpha = Math.max(0, Math.min(1, +/** @type {HTMLInputElement} */ (e.target).value / 100));
    scheduleRender(false, true); // syncCustomControls syncs every alpha slider/readout
  });
});

// ─── Lum mode sliders ─────────────────────────────────────────────────────────

function setCustomFromLumHueSat(lum, hue, sat) {
  cuLum = Math.max(0, Math.min(1, lum));
  cuHue = ((hue % 360) + 360) % 360;
  cuSat = Math.max(0, Math.min(1, sat));
  // Quantization biased away from the wheel side's target luminance — the mirror of
  // selectedRgbBiased(), so hue/sat sweeps in Lum mode can't dip the contrast. Translucent →
  // bias on the bg's sRGB composite over the page underlay (its actual on-screen pixel), so the
  // composited contrast holds across the sweep too.
  const over = cAlpha < 0.9995 ? underlayRgb : null;
  const l = findLightnessBiased(cuHue, cuSat, cuLum, Math.sign(cuLum - targetLum), cAlpha, over);
  const [r, g, b] = hslToRgb(cuHue, cuSat, l);
  setCustomFromRgb(r, g, b);
}

document.getElementById('cu-lum-slider').addEventListener('input', e => {
  setCustomFromLumHueSat(+/** @type {HTMLInputElement} */ (e.target).value / 1000, cuHue, cuSat);
});
document.getElementById('cu-sat-slider').addEventListener('input', e => {
  setCustomFromLumHueSat(cuLum, cuHue, +/** @type {HTMLInputElement} */ (e.target).value / 100);
});
document.getElementById('cu-hue-slider').addEventListener('input', e => {
  setCustomFromLumHueSat(cuLum, +/** @type {HTMLInputElement} */ (e.target).value, cuSat);
});

// ─── Wire editable value inputs ──────────────────────────────────────────────

wireValInput(lumValEl, 0, 1, 0.001, parseFloat, v => v.toFixed(3), v => {
  targetLum = v;
  lumSlider.value = String(Math.round(v * 1000));
  scheduleRender(true);
  saveToStorage('sel-lum', String(relLumOf(targetLum)));
});

wireValInput(hueValEl, 0, 359, 1, str => Math.round(parseFloat(str)), v => v + '°', v => {
  selHue = v;
  hueSlider.value = String(v);
  updateMarkerPosition(); scheduleRender();
  saveToStorage('sel-hue', String(selHue));
}, true);

wireValInput(satValEl, 0, 100, 1, str => Math.round(parseFloat(str)), v => v + '%', v => {
  selSat = v / 100;
  satSlider.value = String(v);
  updateMarkerPosition(); scheduleRender();
  saveToStorage('sel-sat', String(selSat));
});

wireValInput(alphaValEl, 0, 100, 1, str => Math.round(parseFloat(str)), v => v + '%', v => {
  selAlpha = v / 100;
  alphaSlider.value = String(v);
  scheduleRender();
  saveToStorage('sel-alpha', String(selAlpha));
});

wireValInput(
  /** @type {HTMLInputElement} */ (document.getElementById('c-r-val')),
  0, 255, 1, str => Math.round(parseFloat(str)), String,
  v => { cR = v; /** @type {HTMLInputElement} */ (document.getElementById('c-r-slider')).value = String(v); [cH, cS, cL] = rgbToHsl(cR, cG, cB); scheduleRender(false, true); }
);
wireValInput(
  /** @type {HTMLInputElement} */ (document.getElementById('c-g-val')),
  0, 255, 1, str => Math.round(parseFloat(str)), String,
  v => { cG = v; /** @type {HTMLInputElement} */ (document.getElementById('c-g-slider')).value = String(v); [cH, cS, cL] = rgbToHsl(cR, cG, cB); scheduleRender(false, true); }
);
wireValInput(
  /** @type {HTMLInputElement} */ (document.getElementById('c-b-val')),
  0, 255, 1, str => Math.round(parseFloat(str)), String,
  v => { cB = v; /** @type {HTMLInputElement} */ (document.getElementById('c-b-slider')).value = String(v); [cH, cS, cL] = rgbToHsl(cR, cG, cB); scheduleRender(false, true); }
);
wireValInput(
  /** @type {HTMLInputElement} */ (document.getElementById('c-h-val')),
  0, 359, 1, str => Math.round(parseFloat(str)), v => v + '°',
  v => { /** @type {HTMLInputElement} */ (document.getElementById('c-h-slider')).value = String(v); setCustomHueSat(v, cS); },
  true
);
wireValInput(
  /** @type {HTMLInputElement} */ (document.getElementById('c-s-val')),
  0, 100, 1, str => Math.round(parseFloat(str)), v => v + '%',
  v => { /** @type {HTMLInputElement} */ (document.getElementById('c-s-slider')).value = String(v); setCustomHueSat(cH, v / 100); }
);
wireValInput(
  /** @type {HTMLInputElement} */ (document.getElementById('c-l-val')),
  0, 100, 1, str => Math.round(parseFloat(str)), v => v + '%',
  v => { cL = v / 100; /** @type {HTMLInputElement} */ (document.getElementById('c-l-slider')).value = String(v); [cR, cG, cB] = hslToRgb(cH, cS, cL); scheduleRender(false, true); }
);
wireValInput(
  /** @type {HTMLInputElement} */ (document.getElementById('c-gray-val')),
  0, 255, 1, str => Math.round(parseFloat(str)), String,
  v => { /** @type {HTMLInputElement} */ (document.getElementById('c-gray-slider')).value = String(v); setCustomFromRgb(v, v, v); }
);
document.querySelectorAll('.custom-sliders-wrap .custom-alpha-val').forEach(el => wireValInput(
  /** @type {HTMLInputElement} */ (el),
  0, 100, 1, str => Math.round(parseFloat(str)), v => v + '%',
  v => { cAlpha = v / 100; scheduleRender(false, true); }
));
wireValInput(
  /** @type {HTMLInputElement} */ (document.getElementById('cu-lum-val')),
  0, 1, 0.001, parseFloat, v => v.toFixed(3),
  v => { /** @type {HTMLInputElement} */ (document.getElementById('cu-lum-slider')).value = String(Math.round(v * 1000)); setCustomFromLumHueSat(v, cuHue, cuSat); }
);
wireValInput(
  /** @type {HTMLInputElement} */ (document.getElementById('cu-sat-val')),
  0, 100, 1, str => Math.round(parseFloat(str)), v => v + '%',
  v => { /** @type {HTMLInputElement} */ (document.getElementById('cu-sat-slider')).value = String(v); setCustomFromLumHueSat(cuLum, cuHue, v / 100); }
);
wireValInput(
  /** @type {HTMLInputElement} */ (document.getElementById('cu-hue-val')),
  0, 359, 1, str => Math.round(parseFloat(str)), v => v + '°',
  v => { /** @type {HTMLInputElement} */ (document.getElementById('cu-hue-slider')).value = String(v); setCustomFromLumHueSat(cuLum, v, cuSat); },
  true
);

// Hex text input
const customHexInput = /** @type {HTMLInputElement} */ (document.getElementById('custom-hex-input'));

// ─── Custom slider mode (Color / Gray) ───────────────────────────────────────

function applyCustomModeTabs(mode) {
  for (const m of ['color', 'gray', 'lum']) {
    /** @type {HTMLElement} */ (document.getElementById('custom-group-' + m)).classList.toggle('active', m === mode);
    /** @type {HTMLElement} */ (document.getElementById('custom-tab-' + m)).classList.toggle('active', m === mode);
  }
}

function setCustomMode(mode) {
  if (mode === customMode) return;
  const prev = customMode;

  // ── Color ↔ Lum: shared color, no save/restore ────────────────────────────
  if ((prev === 'color' && mode === 'lum') || (prev === 'lum' && mode === 'color')) {
    customMode = mode;
    saveToStorage('custom-mode', mode);
    if (mode === 'lum') {
      // Derive Lum-mode params from the current color
      cuLum = Math.max(0.001, wheelLum(cR, cG, cB));
      cuHue = cH;
      cuSat = cS;
    }
    scheduleRender(false, true);
    applyCustomModeTabs(mode);
    return;
  }

  // ── Transitions involving Gray: save current, restore target ──────────────
  if (prev === 'gray') {
    customGraySaved = cR;
    saveToStorage('custom-gray-v', String(customGraySaved));
  } else {
    // prev is 'color' or 'lum' — both save to the shared color slot
    customColorSaved = { r: cR, g: cG, b: cB };
    saveToStorage('custom-color-rgb', JSON.stringify(customColorSaved));
  }
  customMode = mode;
  saveToStorage('custom-mode', mode);

  if (mode === 'gray') {
    setCustomFromRgb(customGraySaved, customGraySaved, customGraySaved);
  } else {
    // Entering 'color' or 'lum' from gray: restore shared color
    setCustomFromRgb(customColorSaved.r, customColorSaved.g, customColorSaved.b);
    if (mode === 'lum') {
      cuLum = Math.max(0.001, wheelLum(cR, cG, cB));
      cuHue = cH;
      cuSat = cS;
    }
  }
  applyCustomModeTabs(mode);
}

document.getElementById('custom-tab-color').addEventListener('click', () => setCustomMode('color'));
document.getElementById('custom-tab-gray').addEventListener('click',  () => setCustomMode('gray'));
document.getElementById('custom-tab-lum').addEventListener('click',   () => setCustomMode('lum'));
customHexInput.addEventListener('input', () => {
  customHexInput.value = sanitizeHexField(customHexInput.value, 8);
  const full = normalizeHexInput(customHexInput.value); // accepts 3/4/6/8-digit shorthand
  if (full) applyCustomHex(...hexToRgba(full));
});
const customHexCopyIcon = /** @type {HTMLElement} */ (document.getElementById('custom-hex-copy-icon'));

function doCopyCustomHex() {
  const raw = /^#/i.test(customHexInput.value) ? customHexInput.value : '#' + customHexInput.value;
  copyToClipboard(formatHex(raw));
  customHexInput.classList.add('hex-copied');
  customHexCopyIcon.classList.add('hex-copied');
  setTimeout(() => {
    customHexInput.classList.remove('hex-copied');
    customHexCopyIcon.classList.remove('hex-copied');
  }, 1500);
}

customHexInput.addEventListener('click', () => customHexInput.select());
customHexCopyIcon.addEventListener('click', doCopyCustomHex);
customHexInput.addEventListener('blur', () => {
  const full = normalizeHexInput(customHexInput.value); // expand shorthand / revert invalid
  customHexInput.value = full ? formatHex(full.toUpperCase()) : formatHex(toHexA(cR, cG, cB, cAlpha));
  fitHexField(customHexInput);
});
customHexInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') customHexInput.blur();
});

// ─── Main TEXT picker hex input (editable, click-to-select, copy icon) ────────
// Mirrors the custom BG hex field. Typing/pasting a valid hex drives the
// luminance-locked main picker: set the target luminance + hue + sat from the
// colour, sync the sliders/marker, and re-render.
const swatchHexInput = /** @type {HTMLInputElement} */ (document.getElementById('swatch-hex'));
const swatchHexCopy  = /** @type {HTMLElement} */ (document.getElementById('swatch-hex-copy'));

function applyMainHex(r, g, b, a = 1) {
  targetLum = wheelLum(r, g, b); // interpret under the active definition (WCAG / APCA Ys)
  const [h, s] = rgbToHsl(r, g, b);
  selHue = h;
  selSat = s;
  selAlpha = Math.max(0, Math.min(1, a));
  saveToStorage('sel-alpha', String(selAlpha));
  lumSlider.value = String(Math.round(targetLum * 1000));
  hueSlider.value = String(Math.round(selHue));
  satSlider.value = String(Math.round(selSat * 100));
  if (document.activeElement !== lumValEl) lumValEl.value = targetLum.toFixed(3);
  setUnitVal(hueValEl, Math.round(selHue), '°');
  setUnitVal(satValEl, Math.round(selSat * 100), '%');
  updateMarkerPosition();
  scheduleRender(true);
  saveToStorage('sel-lum', String(relLumOf(targetLum)));
  saveToStorage('sel-hue', String(selHue));
  saveToStorage('sel-sat', String(selSat));
}

// Set the custom (background) picker from an RGB — the same path as typing a hex
// into the custom field. Used by the custom hex input and the palette "recall".
function applyCustomHex(r, g, b, a = 1) {
  cR = r; cG = g; cB = b;
  cAlpha = Math.max(0, Math.min(1, a));
  [cH, cS, cL] = rgbToHsl(r, g, b);
  // Reseed the Lum-mode substate from the new colour too — otherwise a paste /
  // palette-recall while the BG picker is in Lum mode leaves the Lum wheel (drawn
  // at cuLum) and its hue/sat/lum sliders showing the OLD colour (they only track
  // cuLum/cuHue/cuSat, which this didn't touch). Mirrors setCustomMode's reseed.
  cuLum = Math.max(0.001, wheelLum(cR, cG, cB));
  cuHue = cH;
  cuSat = cS;
  scheduleRender(false, true);
}

swatchHexInput.addEventListener('input', () => {
  swatchHexInput.value = sanitizeHexField(swatchHexInput.value, 8);
  const full = normalizeHexInput(swatchHexInput.value); // accepts 3/4/6/8-digit shorthand
  if (full) { const [r, g, b, a] = hexToRgba(full); applyMainHex(r, g, b, a); }
});
swatchHexInput.addEventListener('click', () => swatchHexInput.select());
swatchHexInput.addEventListener('blur', () => {
  const [r, g, b] = selectedRgbBiased();
  swatchHexInput.value = formatHex(toHexA(r, g, b, selAlpha)); // normalize / revert invalid
  fitHexField(swatchHexInput);
});
swatchHexInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') swatchHexInput.blur();
});
swatchHexCopy.addEventListener('click', () => {
  const [r, g, b] = selectedRgbBiased();
  copyToClipboard(formatHex(toHexA(r, g, b, selAlpha)));
  swatchHexCopy.classList.add('hex-copied');
  setTimeout(() => swatchHexCopy.classList.remove('hex-copied'), 1500);
});

// ─── Eyedropper (EyeDropper API) — pick a color from anywhere on screen ─────────
// Reveal the buttons only where the API exists (Chromium desktop); elsewhere they stay
// hidden, so the UI never shows a control that can't work. `open()` returns an opaque
// #rrggbb; feed it through the same apply path as typing a hex (opacity left untouched).
if (typeof window !== 'undefined' && 'EyeDropper' in window) {
  const wire = (btnId, apply) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.hidden = false;
    btn.addEventListener('click', async () => {
      if (btn.classList.contains('picking')) return; // ignore re-entry while a pick is open
      btn.classList.add('picking');
      try {
        const res = await new window.EyeDropper().open();
        const full = normalizeHexInput(res.sRGBHex);
        if (full) { const [r, g, b] = hexToRgba(full); apply(r, g, b); } // keep current alpha
      } catch (_) { /* user pressed Esc / cancelled — no-op */ }
      finally { btn.classList.remove('picking'); }
    });
  };
  wire('swatch-eyedropper', (r, g, b) => applyMainHex(r, g, b, selAlpha));
  wire('custom-eyedropper', (r, g, b) => applyCustomHex(r, g, b, cAlpha));
}

// ─── Clipboard copy ───────────────────────────────────────────────────────────

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  // Keep the throwaway field out of the a11y tree and tab order — it exists for
  // a single synchronous execCommand and must never catch AT focus.
  el.setAttribute('aria-hidden', 'true');
  el.tabIndex = -1;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}

// Click-to-copy value readouts (.copyable). Keyboard-operable too: the markup carries
// role="button" + tabindex="0", and Enter/Space activate the same copy as a click.
function _activateCopyable(target) {
  const el = /** @type {HTMLElement | null} */ (target && target.closest && target.closest('.copyable'));
  if (!el || el.classList.contains('copied')) return;
  copyToClipboard(el.dataset.copy ?? el.textContent.trim());
  el.classList.add('copied');
  setTimeout(() => el.classList.remove('copied'), 1500);
}
document.addEventListener('click', e => _activateCopyable(e.target));
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  const el = /** @type {HTMLElement} */ (e.target);
  if (!el.closest || !el.closest('.copyable')) return;
  e.preventDefault();
  _activateCopyable(el);
});

// ─── Theme toggle (handled inside settings panel) ─────────────────────────────

// ─── Preferences panel ───────────────────────────────────────────────────────

{
  const stripHashCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('strip-hash-checkbox'));
  try {
    const stored = localStorage.getItem('pref-strip-hash');
    if (stored !== null) {
      // '1' = old opt-in to strip → new checkbox unchecked; '0' = include → checked
      stripHash = stored === '1';
      stripHashCheckbox.checked = !stripHash;
    }
    // No stored value: HTML default (checked) applies, stripHash stays false
  } catch(e) {}
  stripHashCheckbox.addEventListener('change', () => {
    stripHash = !stripHashCheckbox.checked;
    try { localStorage.setItem('pref-strip-hash', stripHash ? '1' : '0'); } catch(e) {}
    updateUI();
    syncCustomUI();
    renderPalette();
    if (_syncUnderlayHex) _syncUnderlayHex();
  });
}

// ─── Preferences: transparent-BG underlay picker (RGB / HSL / Lum / Gray) ──────
// The page colour a translucent background composites over for contrast + swatch
// display (default white). Mirrors the chip editor's 4-mode picker; Lum default.
let _syncUnderlayHex = null; // set below; lets the # opt-out re-render this field
{
  const pick = document.getElementById('underlay-picker');
  if (pick) {
    let mode = 'lum';
    let hsl = [0, 0, 100];      // [h, s%, l%]
    let lum = [1000, 0, 0];     // [L(0–1000), s%, h]
    const ranges = {}, vals = {}, groups = {};
    const tabs = [...pick.querySelectorAll('[data-umode]')];
    pick.querySelectorAll('[data-uch]').forEach(i => { ranges[i.dataset.uch] = i; });
    pick.querySelectorAll('[data-uchv]').forEach(i => { vals[i.dataset.uchv] = i; });
    pick.querySelectorAll('[data-ugroup]').forEach(g => { groups[g.dataset.ugroup] = g; });
    const hexEl = /** @type {HTMLInputElement} */ (document.getElementById('underlay-hex'));
    const swatchEl = /** @type {HTMLElement} */ (document.getElementById('underlay-swatch'));
    const clampB = v => Math.max(0, Math.min(255, Math.round(v)));

    const reseed = () => {
      const [h, s, l] = rgbToHsl(underlayRgb[0], underlayRgb[1], underlayRgb[2]);
      hsl = [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
      lum = [Math.round(wheelLum(...underlayRgb) * 1000), Math.round(s * 100), Math.round(h)];
    };
    const readInputs = () => {
      if (mode === 'rgb') { underlayRgb[0] = +ranges.r.value; underlayRgb[1] = +ranges.g.value; underlayRgb[2] = +ranges.b.value; }
      else if (mode === 'hsl') { const h = +ranges.h.value, s = +ranges.s.value, l = +ranges.l.value; hsl = [h, s, l]; const [r, g, b] = hslToRgb(h, s / 100, l / 100); underlayRgb[0] = r; underlayRgb[1] = g; underlayRgb[2] = b; }
      else if (mode === 'lum') { const L = +ranges.ulum.value, s = +ranges.usat.value, h = +ranges.uhue.value; lum = [L, s, h]; const li = findLightness(h, s / 100, L / 1000); const [r, g, b] = hslToRgb(h, s / 100, li); underlayRgb[0] = r; underlayRgb[1] = g; underlayRgb[2] = b; }
      else { const v = +ranges.gray.value; underlayRgb[0] = underlayRgb[1] = underlayRgb[2] = v; }
    };
    const syncRanges = () => {
      if (mode === 'rgb') { ranges.r.value = underlayRgb[0]; ranges.g.value = underlayRgb[1]; ranges.b.value = underlayRgb[2]; }
      else if (mode === 'hsl') { ranges.h.value = hsl[0]; ranges.s.value = hsl[1]; ranges.l.value = hsl[2]; }
      else if (mode === 'lum') { ranges.ulum.value = lum[0]; ranges.usat.value = lum[1]; ranges.uhue.value = lum[2]; }
      else ranges.gray.value = underlayRgb[0];
    };
    const setV = (el, v) => { if (el && document.activeElement !== el) el.value = v; };
    const syncVals = () => {
      if (mode === 'rgb') { setV(vals.r, underlayRgb[0]); setV(vals.g, underlayRgb[1]); setV(vals.b, underlayRgb[2]); }
      else if (mode === 'hsl') { setV(vals.h, hsl[0] + '°'); setV(vals.s, hsl[1] + '%'); setV(vals.l, hsl[2] + '%'); }
      else if (mode === 'lum') { setV(vals.ulum, (lum[0] / 1000).toFixed(3)); setV(vals.usat, lum[1] + '%'); setV(vals.uhue, lum[2] + '°'); }
      else setV(vals.gray, underlayRgb[0]);
    };
    const syncHex = () => { if (document.activeElement !== hexEl) hexEl.value = formatHex(toHex(...underlayRgb)); fitHexField(hexEl); };
    const syncSwatch = () => { swatchEl.style.background = cvdTransformHex(toHex(...underlayRgb)); };
    const syncAll = () => { syncRanges(); syncVals(); syncHex(); syncSwatch(); };
    const refresh = () => {
      saveToStorage('underlay-rgb', JSON.stringify([underlayRgb[0], underlayRgb[1], underlayRgb[2]]));
      if (activeContrastTarget() > 0) enforceContrastLock(_lastTouchedSide); // re-pin against the new underlay
      updateUI();      // recompute previews + swatches with the new underlay
      syncCustomUI();  // the custom-BG swatch composites over the underlay too
    };
    const applyMode = m => {
      mode = m;
      tabs.forEach(t => t.classList.toggle('active', t.dataset.umode === m));
      Object.entries(groups).forEach(([k, g]) => g.classList.toggle('active', k === m));
    };

    tabs.forEach(t => t.addEventListener('click', () => { applyMode(t.dataset.umode); reseed(); syncAll(); }));
    Object.values(ranges).forEach(r => r.addEventListener('input', () => { readInputs(); syncVals(); syncHex(); syncSwatch(); refresh(); }));
    // Display-format a value field from its range value, matching syncVals().
    const fmtVal = (key, rv) =>
      key === 'ulum' ? (rv / 1000).toFixed(3)
      : (key === 'h' || key === 'uhue') ? rv + '°'
      : (key === 's' || key === 'l' || key === 'usat') ? rv + '%'
      : String(rv);
    const commitVal = (v, n) => {
      const key = v.dataset.uchv;
      const r = ranges[key];
      if (!r) return;
      r.value = String(clampByteFor(key, n));
      readInputs(); syncAll(); refresh();
      v.value = fmtVal(key, +r.value); // syncVals skips the focused field, so write it here
    };
    Object.values(vals).forEach(v => {
      v.addEventListener('change', () => {
        commitVal(v, parseFloat(String(v.value).replace(/[^0-9.\-]/g, '')) || 0);
      });
      v.addEventListener('focus', () => v.select());
      // ↑/↓ nudge by the field's min unit (Shift = 10×) — matches the main/custom/chip fields,
      // which the underlay picker previously lacked.
      v.addEventListener('keydown', e => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const dispStep = (v.dataset.uchv === 'ulum' ? 0.001 : 1) * (e.shiftKey ? 10 : 1);
        const cur = parseFloat(String(v.value).replace(/[^0-9.\-]/g, '')) || 0;
        commitVal(v, cur + (e.key === 'ArrowUp' ? dispStep : -dispStep));
      });
    });
    function clampByteFor(key, n) {
      if (key === 'ulum') return Math.max(0, Math.min(1000, Math.round(n * 1000)));
      if (key === 'r' || key === 'g' || key === 'b' || key === 'gray') return clampB(n);
      if (key === 'h' || key === 'uhue') return ((Math.round(n) % 360) + 360) % 360; // hue is cyclic — wraps 0↔359
      return Math.max(0, Math.min(100, Math.round(n))); // s, l, usat
    }
    hexEl.addEventListener('input', () => {
      hexEl.value = sanitizeHexField(hexEl.value, 6);
      const full = normalizeHexInput(hexEl.value); // 3/6-digit shorthand (alpha ignored — underlay is opaque)
      if (full) { const [r, g, b] = hexToRgb(full); underlayRgb[0] = r; underlayRgb[1] = g; underlayRgb[2] = b; reseed(); syncRanges(); syncVals(); syncSwatch(); refresh(); }
    });
    hexEl.addEventListener('blur', () => { hexEl.value = formatHex(toHex(...underlayRgb)); });
    hexEl.addEventListener('keydown', e => { if (e.key === 'Enter') hexEl.blur(); }); // Enter commits + expands, like the main hex field
    hexEl.addEventListener('click', () => hexEl.select());
    // Copy affordance, like the other hex fields (honours the # opt-out).
    const copyIcon = /** @type {HTMLElement} */ (document.getElementById('underlay-hex-copy'));
    if (copyIcon) copyIcon.addEventListener('click', () => {
      copyToClipboard(formatHex(toHex(...underlayRgb)));
      hexEl.classList.add('hex-copied'); copyIcon.classList.add('hex-copied');
      setTimeout(() => { hexEl.classList.remove('hex-copied'); copyIcon.classList.remove('hex-copied'); }, 1500);
    });
    // Let the "Include # in hex" toggle re-render this field live.
    _syncUnderlayHex = () => { syncHex(); syncSwatch(); };

    // Restore saved underlay (default stays white).
    try {
      const st = localStorage.getItem('underlay-rgb');
      if (st) { const p = JSON.parse(st); if (Array.isArray(p) && p.length === 3) { underlayRgb[0] = clampB(p[0]); underlayRgb[1] = clampB(p[1]); underlayRgb[2] = clampB(p[2]); } }
    } catch (e) { console.warn('Failed to restore underlay color from storage; using white:', e); }
    applyMode('lum');
    reseed();
    syncAll();
  }
}

{
  const shareStateCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('share-state-checkbox'));
  try {
    if (localStorage.getItem('pref-share-state') === '0') {
      shareState = false;
      shareStateCheckbox.checked = false;
    }
  } catch(e) {}
  shareStateCheckbox.addEventListener('change', () => {
    shareState = shareStateCheckbox.checked;
    try { localStorage.setItem('pref-share-state', shareState ? '1' : '0'); } catch(e) {}
  });
}

{
  const shareThemeCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('share-theme-checkbox'));
  try {
    if (localStorage.getItem('pref-share-theme') === '0') {
      shareTheme = false;
      shareThemeCheckbox.checked = false;
    }
  } catch(e) {}
  shareThemeCheckbox.addEventListener('change', () => {
    shareTheme = shareThemeCheckbox.checked;
    try { localStorage.setItem('pref-share-theme', shareTheme ? '1' : '0'); } catch(e) {}
  });
}

{
  const lockModeWrap = /** @type {HTMLElement} */ (document.getElementById('contrast-lock-mode'));
  const modeBtns = /** @type {HTMLButtonElement[]} */ ([...lockModeWrap.querySelectorAll('.contrast-lock-btn')]);
  const wcagWrap = /** @type {HTMLElement} */ (document.getElementById('contrast-lock-btns-wcag2'));
  const lockBtns = /** @type {HTMLButtonElement[]} */ ([...wcagWrap.querySelectorAll('.contrast-lock-btn')]);
  const apcaWrap = /** @type {HTMLElement} */ (document.getElementById('contrast-lock-btns-apca'));
  const apcaBtns = /** @type {HTMLButtonElement[]} */ ([...apcaWrap.querySelectorAll('.contrast-lock-btn')]);
  const sideWrap = /** @type {HTMLElement} */ (document.getElementById('contrast-lock-side'));
  const sideBtns = /** @type {HTMLButtonElement[]} */ ([...sideWrap.querySelectorAll('.contrast-lock-btn')]);
  // Show the lighter/darker toggle only while a lock is engaged (it's meaningless with no target).
  const refreshSideUI = () => {
    sideWrap.hidden = !(activeContrastTarget() > 0);
    sideBtns.forEach(b => b.classList.toggle('active', b.dataset.lockside === lockSide));
  };

  // "Type" lock (reverse lookup): lock to the |Lc| the chosen font needs
  // (apcaLcForFont). The font size/weight comes from the tiles' existing APCA
  // font selectors (the global apcaFontSize/apcaFontWeight) — no second pair of
  // selects — and changing them re-targets the lock via syncApcaTypeControls.
  const typeControls = /** @type {HTMLElement} */ (document.getElementById('apca-type-controls'));
  const typeReadout = /** @type {HTMLElement} */ (document.getElementById('apca-type-readout'));
  let apcaTypeLock = false;

  function applyApcaTypeLock() {
    apcaBtns.forEach(b => b.classList.toggle('active', b.dataset.apcaTarget === 'type'));
    const font = apcaFontSize + 'px/' + apcaFontWeight;
    const lc = apcaLcForFont(apcaFontSize, apcaFontWeight);
    if (lc == null) { // size unreachable at this weight → nothing to lock to
      apcaLockTarget = 0;
      typeReadout.textContent = font + ' — no Lc fits';
      typeReadout.title = apcaFontSize + 'px is below the smallest size weight ' + apcaFontWeight + ' can render at any contrast — pick a larger size or heavier weight in a tile’s Font selector';
      setContrastLockError('');
      return;
    }
    // Lock to the EXACT Lc the font needs (not ceil'd): apcaFontVerdict flips pass/fail
    // at this same threshold, so the lock's reached / "can't reach" state and the font
    // verdict now switch on the identical |Lc|. Ceiling it left a sub-1-Lc band where the
    // font read ✓ while the lock still said "can't reach Lc N". Displays round for reading.
    apcaLockTarget = lc;
    const shownLc = Math.round(lc);
    typeReadout.textContent = font + ' → Lc ' + shownLc;
    typeReadout.title = font + ' needs |Lc| ' + shownLc + ' (APCA font lookup) — set the size/weight in a tile’s Font selector';
    setContrastLockError('');
    refreshSideUI();
    reenforceContrastLock(_lastTouchedSide); // Type target changed; force a re-pin
  }

  // Called by the tiles' APCA font selectors: re-target the Type lock when it's on.
  syncApcaTypeControls = () => {
    if (apcaTypeLock && contrastLockMode === 'apca') applyApcaTypeLock();
  };

  // The target groups swap with the selected mode; Off hides both
  function refreshLockUI() {
    modeBtns.forEach(b => b.classList.toggle('active', b.dataset.lockmode === contrastLockMode));
    wcagWrap.hidden = contrastLockMode !== 'wcag2';
    apcaWrap.hidden = contrastLockMode !== 'apca';
    typeControls.hidden = !(contrastLockMode === 'apca' && apcaTypeLock);
    refreshSideUI();
  }

  function setLockTarget(target, persist) {
    contrastLockTarget = target;
    lockBtns.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.target) === target));
    setContrastLockError('');
    if (persist) { try { localStorage.setItem('contrast-lock-target', String(target)); } catch(e) {} }
    refreshSideUI();
    // The side the user touched last stays put; the other one gets adjusted (force-repin:
    // the target changed but the luminances didn't, so the normal guard would skip it).
    if (target > 0) reenforceContrastLock(_lastTouchedSide);
  }

  function setApcaTarget(target, persist) {
    apcaLockTarget = target;
    apcaBtns.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.apcaTarget) === target));
    setContrastLockError('');
    if (persist) { try { localStorage.setItem('contrast-lock-apca-target', String(target)); } catch(e) {} }
    refreshSideUI();
    if (target > 0) reenforceContrastLock(_lastTouchedSide);
  }

  // Launch with each mode's Off target selected so a reload never starts silently adjusting
  // colors (WCAG 2 is the default mode now that the standalone Off tab is gone).
  contrastLockTarget = 0;
  apcaLockTarget = 0;
  lockBtns.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.target) === contrastLockTarget));
  apcaBtns.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.apcaTarget) === apcaLockTarget));

  refreshLockUI();

  modeBtns.forEach(btn => btn.addEventListener('click', () => {
    const m = btn.dataset.lockmode;
    const next = m === 'apca' ? 'apca' : 'wcag2';
    // Entering/leaving APCA changes the luminance definition the wheels equalize on (WCAG
    // relative luminance ↔ APCA Ys). Switching the contrast METRIC must NOT repaint the
    // colours: preserve the exact selected hex of both pickers (the lock may still move the
    // untouched side afterward), and re-express the target luminances so the floor is stable.
    const defChanged = (next === 'apca') !== (contrastLockMode === 'apca');
    if (defChanged) {
      const toApca = next === 'apca';
      const oldTarget = targetLum;         // continuous level in the OLD metric
      const selRgb = selectedRgbBiased();  // exact wheel hex under the OLD definition
      const want = selRgb.join(',');
      contrastLockMode = next;
      // BG (custom) hex is preserved automatically (cR,cG,cB are not recomputed here); express
      // its luminance in the new metric so the floor tracks the same colour (round-trip-stable
      // because the hex — and thus its luminance in each metric — never changes).
      if (customMode === 'lum') cuLum = Math.max(0.001, wheelLum(cR, cG, cB));
      // Preserve the wheel hex AND the contrast floor: start from the same luminance LEVEL in the
      // new metric (gray-equivalent of the old target — invertible, so a round-trip returns to
      // it), then nudge minimally only if 8-bit rounding lands a different colour, until the exact
      // pre-switch hex is reproduced. Staying near the gray-equivalent keeps targetLum (and thus
      // the floor) from snapping across the switch.
      const start = Math.max(0, Math.min(1, toApca ? relLumToYs(oldTarget) : ysToRelLum(oldTarget)));
      targetLum = start;
      if (selectedRgbBiased().join(',') !== want) {
        let found = false;
        for (let i = 1; i <= 320 && !found; i++) {
          for (const d of [-i / 4000, i / 4000]) {
            targetLum = Math.max(0, Math.min(1, start + d));
            if (selectedRgbBiased().join(',') === want) { found = true; break; }
          }
        }
        if (!found) targetLum = start; // give up gracefully (hex may move ~1 step; rare)
      }
      lumSlider.value = String(Math.round(targetLum * 1000));
      if (document.activeElement !== lumValEl) lumValEl.value = targetLum.toFixed(3);
      saveToStorage('sel-lum', String(relLumOf(targetLum)));
      // Everything below is cached against the old definition
      _cwLumCache = null;
      _lumTrackKey = '';
      _hueTrackKey = -1;
      _satTrackKey = '';
      _cuTracksKey = '';
      _ceWheelCache = null;
      if (_ce) { reseedSubstates(); syncChipEditorControls(); }
      // This render is the mode switch itself, not a user touch: don't let it
      // overwrite _lastTouchedSide (syncCustom=true records 'bg', which would make the
      // re-pin below move the side the user touched last), and skip the frame's own
      // enforcement pass — the explicit reenforceContrastLock(_lastTouchedSide) below
      // handles it. scheduleRender's bookkeeping guards on _inEnforcement, not
      // _skipEnforceOnce, so capture the real last-touched side and restore it after.
      const heldSide = _lastTouchedSide;
      _skipEnforceOnce = true;
      scheduleRender(true, true);
      _lastTouchedSide = heldSide;
      _pendingUserSide = null;
      _userDirty = false;
    } else {
      contrastLockMode = next;
    }
    setContrastLockError('');
    refreshLockUI();
    // Turning the lock on or switching mode must re-pin even though no colour moved.
    if (activeContrastTarget() > 0) reenforceContrastLock(_lastTouchedSide);
  }));

  lockBtns.forEach(btn => btn.addEventListener('click', () => {
    setLockTarget(parseFloat(/** @type {HTMLElement} */ (btn).dataset.target), true);
  }));

  apcaBtns.forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.apcaTarget === 'type') {
      apcaTypeLock = true;
      typeControls.hidden = false;
      applyApcaTypeLock();
    } else {
      apcaTypeLock = false;
      typeControls.hidden = true;
      setApcaTarget(parseFloat(/** @type {HTMLElement} */ (btn).dataset.apcaTarget), true);
    }
  }));

  sideBtns.forEach(btn => btn.addEventListener('click', () => {
    const side = btn.dataset.lockside; // 'lighter' | 'mid' | 'darker'
    if (side !== 'lighter' && side !== 'darker' && side !== 'mid' || side === lockSide) return;
    lockSide = side;
    try { localStorage.setItem('contrast-lock-side', lockSide); } catch (e) {}
    sideBtns.forEach(b => b.classList.toggle('active', b.dataset.lockside === lockSide));
    // Same held luminances, different solution branch — force a re-pin of the free side.
    if (activeContrastTarget() > 0) reenforceContrastLock(_lastTouchedSide);
  }));

}

{
  const DEFAULT_HUE = 240;
  const DEFAULT_SAT = 0; // achromatic

  const uiHueSlider   = /** @type {HTMLInputElement} */  (document.getElementById('ui-hue-slider'));
  const uiSatSlider   = /** @type {HTMLInputElement} */  (document.getElementById('ui-sat-slider'));
  const uiHueVal      = /** @type {HTMLElement} */       (document.getElementById('ui-hue-val'));
  const uiSatVal      = /** @type {HTMLElement} */       (document.getElementById('ui-sat-val'));
  const uiBrightnessSlider = /** @type {HTMLInputElement} */ (document.getElementById('ui-brightness-slider'));
  const uiBrightnessVal    = /** @type {HTMLElement} */      (document.getElementById('ui-brightness-val'));
  const recommendBtn       = /** @type {HTMLButtonElement} */ (document.getElementById('settings-recommend'));
  const neutralizeBtn      = /** @type {HTMLButtonElement} */ (document.getElementById('settings-neutralize'));
  const themeBtnDark       = /** @type {HTMLButtonElement} */ (document.getElementById('theme-btn-dark'));
  const themeBtnLight      = /** @type {HTMLButtonElement} */ (document.getElementById('theme-btn-light'));

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch(e) {}
    themeBtnDark.classList.toggle('active',  theme === 'dark');
    themeBtnLight.classList.toggle('active', theme === 'light');
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
    // Keep browser chrome (address bar / PWA title bar) matching the in-app
    // theme, which can differ from the OS prefers-color-scheme that the
    // static meta tags follow before JS runs.
    requestAnimationFrame(() => {
      const bg = getComputedStyle(document.body).backgroundColor;
      document.querySelectorAll('meta[name="theme-color"]')
        .forEach(m => m.setAttribute('content', bg));
    });
  }

  const DARK_DEFAULT_L  = 7;
  const LIGHT_DEFAULT_L = 97;

  function themeDefaultL(theme) {
    return theme === 'light' ? LIGHT_DEFAULT_L : DARK_DEFAULT_L;
  }

  function applyBrightness(theme) {
    const [minL, maxL] = theme === 'dark' ? [0, 50] : [50, 100];
    uiBrightnessSlider.min = String(minL);
    uiBrightnessSlider.max = String(maxL);

    const saved = localStorage.getItem(`ui-ground-l-${theme}`);
    const raw   = saved !== null ? +saved : themeDefaultL(theme);
    const val   = Math.max(minL, Math.min(maxL, raw));
    uiBrightnessSlider.value    = String(val);
    setUnitVal(uiBrightnessVal, val, '%');
    if (saved !== null) {
      document.documentElement.style.setProperty('--ui-ground-l', String(val));
    } else {
      document.documentElement.style.removeProperty('--ui-ground-l');
    }
  }

  uiBrightnessSlider.addEventListener('input', () => {
    const theme = document.documentElement.dataset.theme || 'dark';
    const val   = +uiBrightnessSlider.value;
    setUnitVal(uiBrightnessVal, val, '%');
    document.documentElement.style.setProperty('--ui-ground-l', String(val));
    saveToStorage(`ui-ground-l-${theme}`, String(val));
  });

  document.addEventListener('themechange', (/** @type {CustomEvent} */ e) => {
    applyBrightness(e.detail.theme);
  });

  // Init active theme button. Must run after the themechange listener above so
  // applyBrightness() sets the slider's per-theme min/max on first load too
  // (the HTML attributes only cover the dark range).
  setTheme(document.documentElement.dataset.theme || 'dark');

  themeBtnDark.addEventListener('click',  () => setTheme('dark'));
  themeBtnLight.addEventListener('click', () => setTheme('light'));

  function applyUiColors(hue, sat100) {
    document.documentElement.style.setProperty('--ui-hue', String(hue));
    document.documentElement.style.setProperty('--ui-sat', (sat100 / 100).toFixed(4));
  }

  function updateSatSliderBg(hue) {
    uiSatSlider.style.backgroundImage = `linear-gradient(to right, hsl(${hue},0%,55%), hsl(${hue},75%,55%))`;
  }

  // Restore saved values (CSS vars already applied via head script; just sync UI).
  // Shared-link theme params (uh/us/ug) override localStorage and are persisted,
  // so the received theme survives into future visits — same as `t`, which
  // setTheme() above already persisted via dataset.theme.
  const _q = new URLSearchParams(location.search);
  const _qNum = (key, lo, hi) => {
    const n = parseFloat(_q.get(key) ?? '');
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null;
  };
  const urlHue = _qNum('uh', 0, 359);
  const urlSat = _qNum('us', 0, 200);
  const savedHue = urlHue ?? +(localStorage.getItem('ui-hue') ?? 240);
  const savedSat = urlSat ?? +(localStorage.getItem('ui-sat') ?? 0);
  uiHueSlider.value = String(savedHue);
  uiSatSlider.value = String(savedSat);
  setUnitVal(uiHueVal, savedHue, '°');
  setUnitVal(uiSatVal, savedSat, '%');
  updateSatSliderBg(savedHue);
  if (urlHue !== null || urlSat !== null) {
    applyUiColors(savedHue, savedSat);
    saveToStorage('ui-hue', String(savedHue));
    saveToStorage('ui-sat', String(savedSat));
  }
  {
    const theme = document.documentElement.dataset.theme || 'dark';
    const [minL, maxL] = theme === 'dark' ? [0, 50] : [50, 100];
    const urlGl = _qNum('ug', minL, maxL);
    if (urlGl !== null) {
      uiBrightnessSlider.value = String(urlGl);
      setUnitVal(uiBrightnessVal, urlGl, '%');
      document.documentElement.style.setProperty('--ui-ground-l', String(urlGl));
      saveToStorage(`ui-ground-l-${theme}`, String(urlGl));
    }
  }

  uiHueSlider.addEventListener('input', () => {
    const h = +uiHueSlider.value, s = +uiSatSlider.value;
    setUnitVal(uiHueVal, h, '°');
    applyUiColors(h, s);
    updateSatSliderBg(h);
    saveToStorage('ui-hue', String(h));
  });

  uiSatSlider.addEventListener('input', () => {
    const h = +uiHueSlider.value, s = +uiSatSlider.value;
    setUnitVal(uiSatVal, s, '%');
    applyUiColors(h, s);
    saveToStorage('ui-sat', String(s));
  });

  recommendBtn.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme || 'dark';
    uiHueSlider.value = String(DEFAULT_HUE);
    uiSatSlider.value = String(DEFAULT_SAT);
    setUnitVal(uiHueVal, DEFAULT_HUE, '°');
    setUnitVal(uiSatVal, DEFAULT_SAT, '%');
    applyUiColors(DEFAULT_HUE, DEFAULT_SAT);
    updateSatSliderBg(DEFAULT_HUE);
    document.documentElement.style.removeProperty('--ui-ground-l');
    uiBrightnessSlider.value = String(themeDefaultL(theme));
    setUnitVal(uiBrightnessVal, themeDefaultL(theme), '%');
    try {
      localStorage.removeItem('ui-hue');
      localStorage.removeItem('ui-sat');
      localStorage.removeItem(`ui-ground-l-${theme}`);
    } catch(e) {}
  });

  neutralizeBtn.addEventListener('click', () => {
    const h = +uiHueSlider.value;
    uiSatSlider.value = '0';
    setUnitVal(uiSatVal, 0, '%');
    applyUiColors(h, 0);
    updateSatSliderBg(h);
    saveToStorage('ui-sat', '0');
  });

  // The value readouts are editable inputs (matching the underlay / main-picker
  // sliders): typing or arrow-keys drives the slider + applies + persists, mirroring
  // each slider's own input handler above.
  wireValInput(uiSatVal, 0, 200, 1, s => parseInt(s, 10), v => v + '%', v => {
    uiSatSlider.value = String(v);
    applyUiColors(+uiHueSlider.value, v);
    saveToStorage('ui-sat', String(v));
  });
  wireValInput(uiHueVal, 0, 359, 1, s => parseInt(s, 10), v => v + '°', v => {
    uiHueSlider.value = String(v);
    applyUiColors(v, +uiSatSlider.value);
    updateSatSliderBg(v);
    saveToStorage('ui-hue', String(v));
  }, true);
  // Brightness min/max depend on the theme (dark 0–50, light 50–100); read them live
  // off the slider, which applyBrightness() keeps in sync with the active theme.
  wireValInput(uiBrightnessVal, 0, 100, 1, s => parseInt(s, 10), v => v + '%', v => {
    const lo = +uiBrightnessSlider.min, hi = +uiBrightnessSlider.max;
    const cl = Math.max(lo, Math.min(hi, v));
    uiBrightnessVal.value = cl + '%';
    uiBrightnessSlider.value = String(cl);
    document.documentElement.style.setProperty('--ui-ground-l', String(cl));
    saveToStorage(`ui-ground-l-${document.documentElement.dataset.theme || 'dark'}`, String(cl));
  });

}

// ─── Restore persisted selection state ────────────────────────────────────────

try {
  const sh = localStorage.getItem('sel-hue');
  const ss = localStorage.getItem('sel-sat');
  const sl = localStorage.getItem('sel-lum');
  const sc = localStorage.getItem('sel-custom-color');
  if (sh !== null) selHue = parseFloat(sh);
  if (ss !== null) selSat = parseFloat(ss);
  if (sl !== null) {
    targetLum = parseFloat(sl);
    lumSlider.value = String(Math.round(targetLum * 1000));
    lumValEl.value = targetLum.toFixed(3);
  }
  const sa = localStorage.getItem('sel-alpha');
  if (sa !== null) { const v = parseFloat(sa); if (v >= 0 && v <= 1) selAlpha = v; }
  const sca = localStorage.getItem('custom-alpha');
  if (sca !== null) { const v = parseFloat(sca); if (v >= 0 && v <= 1) cAlpha = v; }
  // legacy: keep reading sel-custom-color as fallback
  if (sc !== null && /^#[0-9a-fA-F]{6}$/i.test(sc)) {
    const [r, g, b] = hexToRgb(sc);
    customColorSaved = { r, g, b };
  }
} catch(e) {}

// Mode-aware custom color restore
try {
  const m = localStorage.getItem('custom-mode');
  if (m === 'color' || m === 'gray' || m === 'lum') customMode = m;
  const cc = localStorage.getItem('custom-color-rgb');
  if (cc) { const p = JSON.parse(cc); if (typeof p.r === 'number') customColorSaved = { r: p.r, g: p.g, b: p.b }; }
  const cgv = localStorage.getItem('custom-gray-v');
  if (cgv !== null) { const v = parseInt(cgv); if (!isNaN(v)) customGraySaved = Math.max(0, Math.min(255, v)); }
  const clv = localStorage.getItem('custom-lum-v');
  if (clv) {
    const p = JSON.parse(clv);
    if (typeof p.lum === 'number') {
      customLumSaved = { lum: p.lum, hue: p.hue || 0, sat: p.sat || 1 };
      cuLum = customLumSaved.lum; cuHue = customLumSaved.hue; cuSat = customLumSaved.sat;
    }
  }
} catch(e) { console.warn('Failed to restore custom color from storage; using defaults:', e); }

// Apply the active mode's color to cR/cG/cB
if (customMode === 'gray') {
  cR = cG = cB = customGraySaved;
} else if (customMode === 'lum' && customLumSaved !== null) {
  // Restore exact Lum params from saved state (avoids integer-RGB rounding drift)
  cuLum = customLumSaved.lum; cuHue = customLumSaved.hue; cuSat = customLumSaved.sat;
  const _l = findLightnessBiased(cuHue, cuSat, cuLum, Math.sign(cuLum - targetLum));
  [cR, cG, cB] = hslToRgb(cuHue, cuSat, _l);
} else {
  // Color mode, or Lum mode with no saved lum params
  cR = customColorSaved.r; cG = customColorSaved.g; cB = customColorSaved.b;
  if (customMode === 'lum') {
    [cH, cS, cL] = rgbToHsl(cR, cG, cB);
    cuLum = Math.max(0.001, wheelLum(cR, cG, cB));
    cuHue = cH; cuSat = cS;
  }
}
[cH, cS, cL] = rgbToHsl(cR, cG, cB);
customColor = toHex(cR, cG, cB);

// ─── URL state restore (overrides localStorage if state params present) ───────
try {
  const sp = new URLSearchParams(location.search);
  if (sp.has('l') || sp.has('c')) {
    const ph = sp.get('h'), ps = sp.get('s'), pl = sp.get('l');
    const pc = sp.get('c'), pm = sp.get('m');
    if (pl !== null) {
      targetLum = Math.max(0, Math.min(1, parseFloat(pl) / 1000));
      lumSlider.value = String(Math.round(targetLum * 1000));
      lumValEl.value  = targetLum.toFixed(3);
    }
    if (ph !== null) selHue = Math.max(0, Math.min(359, parseFloat(ph)));
    if (ps !== null) selSat = Math.max(0, Math.min(1,   parseFloat(ps) / 100));
    const pa = sp.get('a'), pca = sp.get('ca');
    if (pa  !== null) selAlpha = Math.max(0, Math.min(1, parseFloat(pa) / 100));
    if (pca !== null) cAlpha   = Math.max(0, Math.min(1, parseFloat(pca) / 100));
    if (pm === 'color' || pm === 'lum' || pm === 'gray') customMode = pm;
    if (pc !== null && /^[0-9a-fA-F]{6}$/.test(pc)) {
      [cR, cG, cB] = hexToRgb('#' + pc);
    }
    if (customMode === 'lum') {
      const pcl = sp.get('cl'), pch = sp.get('ch'), pcs = sp.get('cs');
      if (pcl !== null) cuLum = Math.max(0.001, Math.min(1, parseFloat(pcl) / 1000));
      if (pch !== null) cuHue = Math.max(0, Math.min(359, parseFloat(pch)));
      if (pcs !== null) cuSat = Math.max(0, Math.min(1,   parseFloat(pcs) / 100));
      const _l = findLightnessBiased(cuHue, cuSat, cuLum, Math.sign(cuLum - targetLum));
      [cR, cG, cB] = hslToRgb(cuHue, cuSat, _l);
    }
    [cH, cS, cL] = rgbToHsl(cR, cG, cB);
    customColor = toHex(cR, cG, cB);
    if (customMode === 'gray') {
      customGraySaved = cR;
    } else {
      customColorSaved = { r: cR, g: cG, b: cB };
    }
  }
} catch(e) {}

// ─── Init ─────────────────────────────────────────────────────────────────────

try {
  glState = initGL();
} catch (err) {
  console.warn('WebGL init failed, falling back to 2D canvas:', err);
}

if (glState) {
  drawWheel(targetLum);
  drawHueLabels();
} else {
  renderWheel2D(targetLum);
}

// The WebGL context can be lost (GPU reset, driver hiccup, tab backgrounded on
// some devices). Once lost, drawWheel() would keep no-op'ing against a dead
// context and the wheel goes black with no recovery. Swallow the loss
// (preventDefault is required, or the browser never fires 'restored'), drop the
// stale state, then re-init + redraw when the context comes back.
if (glState) {
  wheelCanvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    glState = null;
  }, false);
  wheelCanvas.addEventListener('webglcontextrestored', () => {
    try { glState = initGL(); }
    catch (err) { glState = null; console.warn('WebGL restore failed:', err); }
    if (glState) { drawWheel(targetLum); drawHueLabels(); }
  }, false);
}

updateMarkerPosition();
syncSliders();
syncCustomUI();
updateUI();
renderCustomWheel();
applyCustomModeTabs(customMode);
// Contrast lock persisted from a previous session: enforce against the
// (possibly URL-restored) state, treating the wheel side as authoritative
if (activeContrastTarget() > 0) enforceContrastLock(_lastTouchedSide);

// ─── Mobile slider touch fix ──────────────────────────────────────────────────
// On touch devices the browser may start a page scroll before the native range
// input can claim the gesture. This directional-lock handler intercepts touchmove
// on each slider: if the first significant movement is horizontal it takes over
// and prevents the scroll; if vertical it steps aside and lets the page scroll.
function addSliderTouchFix(slider) {
  let startX = 0, startY = 0, active = false, decided = false;

  slider.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    active = true;
    decided = false;
  }, { passive: true });

  slider.addEventListener('touchmove', e => {
    if (!active) return;
    const adx = Math.abs(e.touches[0].clientX - startX);
    const ady = Math.abs(e.touches[0].clientY - startY);

    if (!decided && (adx > 4 || ady > 4)) {
      decided = true;
      if (ady > adx) { active = false; return; } // vertical → let browser scroll
    }
    if (!active) return;

    e.preventDefault();
    const rect = slider.getBoundingClientRect();
    const min = +slider.min, max = +slider.max, step = +(slider.step) || 1;
    const ratio = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
    const val = Math.max(min, Math.min(max, Math.round((min + ratio * (max - min)) / step) * step));
    if (+slider.value !== val) {
      slider.value = String(val);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, { passive: false });

  const reset = () => { active = false; decided = false; };
  slider.addEventListener('touchend', reset);
  slider.addEventListener('touchcancel', reset);
}

document.querySelectorAll('input[type="range"]').forEach(addSliderTouchFix);

// ─── Share buttons ────────────────────────────────────────────────────────────

const SHARE_URL   = 'https://relative-luminous-color-wheel.vercel.app/';
const SHARE_TITLE = 'Relative Luminous Color Wheel';

function buildShareUrl() {
  const p = new URLSearchParams();
  if (shareState) {
    p.set('h', String(Math.round(selHue)));
    p.set('s', String(Math.round(selSat * 100)));
    p.set('l', String(Math.round(relLumOf(targetLum) * 1000)));
    p.set('c', toHex(cR, cG, cB).slice(1).toLowerCase());
    p.set('m', customMode);
    if (selAlpha < 0.9995) p.set('a',  String(Math.round(selAlpha * 100)));
    if (cAlpha   < 0.9995) p.set('ca', String(Math.round(cAlpha * 100)));
    if (customMode === 'lum') {
      p.set('cl', String(Math.round(relLumOf(cuLum) * 1000)));
      p.set('ch', String(Math.round(cuHue)));
      p.set('cs', String(Math.round(cuSat * 100)));
    }
    if (palette.length) p.set('p', palette.map(e => (e.role === 'fg' ? 'f' : 'b') + e.hex.slice(1)).join(','));
  }
  if (shareTheme) {
    const theme = document.documentElement.dataset.theme || 'dark';
    p.set('t', theme === 'light' ? 'l' : 'd');
    // Sliders are the live source of truth (localStorage writes are debounced)
    p.set('uh', /** @type {HTMLInputElement} */ (document.getElementById('ui-hue-slider')).value);
    p.set('us', /** @type {HTMLInputElement} */ (document.getElementById('ui-sat-slider')).value);
    p.set('ug', /** @type {HTMLInputElement} */ (document.getElementById('ui-brightness-slider')).value);
  }
  const qs = p.toString();
  return qs ? SHARE_URL + '?' + qs : SHARE_URL;
}

document.querySelectorAll('.preview-share-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    btn.focus();
    const shareUrl = buildShareUrl();
    try {
      if (navigator.share) {
        await navigator.share({ title: SHARE_TITLE, url: shareUrl });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        const label = btn.querySelector('.preview-share-label');
        const prev  = label.textContent;
        label.textContent = 'Copied!';
        setTimeout(() => { label.textContent = prev; }, 2000);
      }
    } catch (_) { /* cancelled or denied */ }
  });
});
/**
 * Open a URL in a new tab using an anchor click rather than window.open,
 * so iOS Safari treats it as a user-initiated navigation and reliably
 * hands off to registered Universal Link / App Link handlers.
 * @param {string} url
 */
function openShareLink(url) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

document.querySelectorAll('.preview-platform-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const platform = btn.dataset.platform;
    const shareUrl = buildShareUrl();
    if (platform === 'x') {
      // x.com is the canonical domain; the X app registers it as a Universal Link
      openShareLink(
        'https://x.com/intent/tweet?url=' + encodeURIComponent(shareUrl) + '&text=' + encodeURIComponent(SHARE_TITLE)
      );
    } else if (platform === 'line') {
      // line.me/R/share is LINE's Universal Link — opens native app directly on iOS/Android
      openShareLink(
        'https://line.me/R/share?text=' + encodeURIComponent(SHARE_TITLE + '\n' + shareUrl)
      );
    } else if (platform === 'pinterest') {
      // media= must be explicit; Pinterest cannot scrape images from this SPA
      const OGP_IMAGE = 'https://relative-luminous-color-wheel.vercel.app/ogp.png';
      openShareLink(
        'https://pinterest.com/pin/create/button/?url=' + encodeURIComponent(shareUrl) +
        '&media=' + encodeURIComponent(OGP_IMAGE) +
        '&description=' + encodeURIComponent(SHARE_TITLE)
      );
    }
  });
});

// ─── Export (CSS / Tailwind / design tokens JSON) ─────────────────────────────

// Color value format for the palette-sidebar export: 'hex' (default — the most
// universal notation, understood by every tool and pipeline) or 'oklch' (modern,
// perceptual, wide-gamut, Tailwind v4's native format). Toggled via any
// .export-colorfmt-btn and persisted across sessions. (The Scales global-token
// export keeps its own independent color-format state.) A previously-persisted
// 'rgb' value is ignored by the .includes() guard below and falls back to hex.
const EXPORT_COLOR_FMTS = ['oklch', 'hex'];
let exportColorFmt = 'hex';
try {
  const v = localStorage.getItem('export-color-fmt');
  if (EXPORT_COLOR_FMTS.includes(v)) exportColorFmt = v;
} catch (e) {}

function syncExportColorFmtButtons() {
  document.querySelectorAll('.export-colorfmt-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.colorfmt === exportColorFmt));
}

function setExportColorFmt(fmt) {
  if (!EXPORT_COLOR_FMTS.includes(fmt) || fmt === exportColorFmt) return;
  exportColorFmt = fmt;
  try { localStorage.setItem('export-color-fmt', fmt); } catch (e) {}
  syncExportColorFmtButtons();
}

// Delegated so one handler covers both the static Preferences buttons and the
// ones the palette sidebar builds later.
document.addEventListener('click', e => {
  const btn = e.target.closest?.('.export-colorfmt-btn');
  if (btn) setExportColorFmt(btn.dataset.colorfmt);
});

function buildExport(format) {
  // Export the palette grouped by role. Each role's first pinned color is its
  // primary, the second its secondary, then plain ordinals.
  // If the palette already has colors saved for a role, only those saved colors
  // are exported. Otherwise, the live picker color is exported as a fallback.
  const wheelHex  = toHexA(...selectedRgbBiased(), selAlpha).toLowerCase();
  const customHex = toHexA(cR, cG, cB, cAlpha).toLowerCase();
  const roleColors = (role, liveHex) => {
    const entries = palette.filter(e => e.role === role);
    if (entries.length === 0) return [{ hex: liveHex, lum: relativeLuminance(...hexToRgb(liveHex)) }];
    return entries.map(e => ({ hex: e.hex, name: e.name, lum: relativeLuminance(...hexToRgb(e.hex)) }));
  };
  const text = roleColors('fg', wheelHex);
  const bg   = roleColors('bg', customHex);
  const RANKS = ['primary', 'secondary', 'tertiary', 'quaternary', 'quinary', 'senary', 'septenary', 'octonary', 'nonary', 'denary'];
  const key = pos => RANKS[pos] || String(pos + 1);
  // Token/variable name per colour: its user-set name (sanitized to a valid identifier) when
  // present, else the positional rank. De-duplicated within a role group so two same-named
  // colours don't collide (…-2, …-3). The role prefix (text/bg or content/surface) is added
  // by each format below. The user's CASE is preserved (CSS custom properties and DTCG token
  // names are both case-sensitive, and no format mandates lowercasing names) — only characters
  // invalid in an identifier are collapsed to '-'. Colour VALUES stay lowercase (the hex
  // convention across CSS/Tailwind/DTCG).
  const sanitizeName = s => s.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const resolveKeys = list => {
    const used = new Set();
    return list.map((c, i) => {
      let base = (c.name && sanitizeName(c.name)) || key(i);
      let name = base, n = 2;
      while (used.has(name)) name = base + '-' + (n++);
      used.add(name);
      return name;
    });
  };
  const textKeys = resolveKeys(text);
  const bgKeys   = resolveKeys(bg);
  const ratio = contrastRatio(text[0].lum, bg[0].lum); // text-primary vs bg-primary

  // Color value in the chosen format (hex string or oklch()); the alternate
  // representation is kept in a trailing comment for reference.
  const cssVal = c => exportColorFmt === 'hex' ? c.hex.toLowerCase() : oklchCss(c.hex);
  const altComment = c => exportColorFmt === 'hex' ? oklchCss(c.hex) : c.hex.toLowerCase();

  if (format === 'css') {
    const cssLine = (name, c) => `  ${name}: ${cssVal(c)};  /* ${altComment(c)} — luminance ${c.lum.toFixed(4)} */`;
    const lines = [
      ...text.map((c, i) => cssLine(`--color-text-${textKeys[i]}`, c)),
      ...bg.map((c, i)   => cssLine(`--color-bg-${bgKeys[i]}`, c)),
    ];
    return `:root {
  /* text-primary vs bg-primary contrast ${ratio.toFixed(2)}:1 — relative-luminous-color-wheel.vercel.app */
  /* liveText: ${wheelHex} (${oklchCss(wheelHex)}), liveBg: ${customHex} (${oklchCss(customHex)}) */
${lines.join('\n')}
}
`;
  }
  if (format === 'tailwind') {
    // Tailwind v4 @theme. Every --color-* here becomes a colour name, so the role
    // prefix is mapped to the design-system-standard content/surface pair (text→content,
    // bg→surface) — otherwise the app's text/bg roles would double the utility prefix
    // (--color-text-primary → text-text-primary, --color-bg-primary → bg-bg-primary).
    // content/surface reads naturally as text-content-primary / bg-surface-primary. The
    // CSS and JSON exports keep the plain text/bg roles (no utility-prefix collision there).
    const twLine = (name, c) => `  ${name}: ${cssVal(c)};  /* ${altComment(c)} */`;
    const lines = [
      ...text.map((c, i) => twLine(`--color-content-${textKeys[i]}`, c)),
      ...bg.map((c, i)   => twLine(`--color-surface-${bgKeys[i]}`, c)),
    ];
    return `@theme {
  /* content-* = text-role colours (use as text-content-*), surface-* = background-role
     colours (use as bg-surface-*). liveText: ${wheelHex} (${oklchCss(wheelHex)}), liveBg: ${customHex} (${oklchCss(customHex)}) */
${lines.join('\n')}
}
`;
  }
  // W3C Design Tokens (DTCG), Format Module 2025.10 (first stable release). A color $value is
  // the spec's OBJECT form { colorSpace, components, hex }: spec-aware processors (Style
  // Dictionary, Tokens Studio, Terrazzo) read the components, and `hex` is the spec's own
  // fallback so hex-only tools still import a colour. The toggle picks the colorSpace (srgb:
  // components 0–1, or oklch: [L, C, H]); alpha appears only when <1. The app's relative
  // luminance stays under $extensions (which tools MUST preserve).
  const NS = 'app.vercel.relative-luminous-color-wheel'; // reverse-DNS ext namespace (DTCG SHOULD)
  const colorValue = hex => {
    const v = {
      colorSpace: exportColorFmt === 'oklch' ? 'oklch' : 'srgb',
      components: exportColorFmt === 'oklch' ? oklchComponentsDTCG(hex) : hexToRgb(hex).map(v => +(v / 255).toFixed(4)),
      hex: hex.slice(0, 7).toLowerCase(), // DTCG hex fallback MUST be 6-digit #rrggbb; alpha rides in `alpha`
    };
    const a = +hexToRgba(hex)[3].toFixed(4);
    if (a < 1) v.alpha = a;
    return v;
  };
  const colorToken = c => ({ $value: colorValue(c.hex), $extensions: { [NS]: { luminance: +c.lum.toFixed(4) } } });
  const groupTokens = (list, keys) => Object.fromEntries(list.map((c, i) => [keys[i], colorToken(c)]));
  const fmtNote = exportColorFmt === 'oklch'
    ? 'Each color $value is a DTCG object: colorSpace "oklch", components [L, C, H], plus a hex fallback.'
    : 'Each color $value is a DTCG object: colorSpace "srgb", components [r, g, b] (0–1), plus a hex fallback.';
  const json = {
    $schema: 'https://www.designtokens.org/schemas/2025.10/format.json',
    $description: `Accessible color palette exported from the Relative Luminous Color Wheel (relative-luminous-color-wheel.vercel.app). ${fmtNote} Follows the W3C DTCG Format Module 2025.10 (first stable release); the object color's hex property is the spec's fallback for hex-only tools.`,
    color: {
      $type: 'color',
      text: groupTokens(text, textKeys),
      bg:   groupTokens(bg, bgKeys),
    },
    $extensions: {
      [NS]: {
        textBgContrastRatio: +ratio.toFixed(2),
        liveText: { hex: wheelHex, oklch: oklchCss(wheelHex) },
        liveBg:   { hex: customHex, oklch: oklchCss(customHex) },
      },
    },
  };
  return JSON.stringify(json, null, 2) + '\n';
}

// Filename + MIME per export format. JSON uses the DTCG-preferred media type
// (application/design-tokens+json) so design-token-aware tools recognise it;
// application/json remains an acceptable fallback per the spec.
const EXPORT_FILE = {
  css:      { name: 'color-palette.css',          mime: 'text/css' },
  tailwind: { name: 'color-palette.tailwind.css', mime: 'text/css' },
  json:     { name: 'color-palette.tokens.json',  mime: 'application/design-tokens+json' },
};

/** Save the given export format as a downloaded file. */
function downloadExport(format) {
  const f = EXPORT_FILE[format] || EXPORT_FILE.css;
  const blob = new Blob([buildExport(format)], { type: f.mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Palette sidebar export ───────────────────────────────────────────────────
// Color-palette export lives in the palette sidebar (this block); global tokens
// export from the Scales panel in the Layout Preview. Preferences has no export UI.
{
  const host = /** @type {HTMLElement} */ (document.getElementById('palette-export'));
  const FORMATS = [['css', 'CSS'], ['tailwind', 'Tailwind'], ['json', 'JSON']];

  // Segmented .settings-theme-btns groups: pick one file format, then Copy/Download
  // act on it. Defaults to CSS — the most universally usable format (see exportColorFmt,
  // which defaults to hex) so the out-of-the-box export is CSS + hex.
  let selectedFormat = 'css';
  const mkGroup = () => { const d = document.createElement('div'); d.className = 'settings-theme-btns'; return d; };

  // HEX/OKLCH color-format toggle (the .export-colorfmt-btn delegated click handler
  // drives it and persists exportColorFmt).
  const colorGroup = mkGroup();
  for (const cf of EXPORT_COLOR_FMTS) {
    const b = document.createElement('button');
    b.className = 'settings-theme-btn export-colorfmt-btn';
    b.dataset.colorfmt = cf;
    b.textContent = cf.toUpperCase();
    b.title = `Export colors as ${cf.toUpperCase()}`;
    colorGroup.appendChild(b);
  }

  // File-format tabs (CSS / Tailwind / JSON) — one is selected; the actions use it.
  const fileGroup = mkGroup();
  const fileBtns = {};
  const selectFormat = fmt => {
    selectedFormat = fmt;
    for (const k in fileBtns) fileBtns[k].classList.toggle('active', k === fmt);
  };
  for (const [format, label] of FORMATS) {
    const b = document.createElement('button');
    b.className = 'settings-theme-btn palette-fileformat-btn';
    b.textContent = label;
    b.title = `Select ${label} export`;
    b.addEventListener('click', () => selectFormat(format));
    fileBtns[format] = b;
    fileGroup.appendChild(b);
  }

  // One row: file-format tabs first (you pick the target format), then the colour
  // format — matching the usual "choose a file format, then tune the colour" flow.
  const tabs = document.createElement('div');
  tabs.className = 'palette-export-tabs';
  tabs.append(fileGroup, colorGroup);

  // Copy + Download — two independent buttons that each fill half the row.
  const flashLabel = (btn, text, cls) => {
    const orig = btn.textContent;
    btn.textContent = text;
    btn.classList.add(cls);
    setTimeout(() => { btn.textContent = orig; btn.classList.remove(cls); }, 1500);
  };
  const actions = document.createElement('div');
  actions.className = 'palette-export-actions';
  const copy = document.createElement('button');
  copy.className = 'palette-export-btn palette-export-copy';
  copy.textContent = 'Copy';
  copy.title = 'Copy the selected export';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(buildExport(selectedFormat));
      flashLabel(copy, 'Copied', 'copied');
    } catch (_) { /* clipboard denied */ }
  });
  const dl = document.createElement('button');
  dl.className = 'palette-export-btn palette-export-dl';
  dl.textContent = 'Download';
  dl.title = 'Download the selected export';
  dl.addEventListener('click', () => { downloadExport(selectedFormat); flashLabel(dl, 'Saved', 'done'); });
  actions.append(copy, dl);

  host.append(tabs, actions);

  selectFormat('css');
  // Reflect the persisted color format on every toggle button now that they all exist.
  syncExportColorFmtButtons();
}

// ─── "What is this?" — modal on wide screens, inline <details> on narrow ──────
// Wide viewports leave the 720px prose column stranded beside a wide, empty
// section, so there the trigger opens a centered modal instead. The real
// .about-body node is moved into the modal (never duplicated — keeps a single
// copy for SEO) and moved back on close. Narrow screens keep the inline expand.
{
  const section = document.querySelector('.about');
  const details = section && section.querySelector('details');
  const summary = section && section.querySelector('summary');
  const body    = section && section.querySelector('.about-body');
  const modal   = document.getElementById('about-modal');
  const content = document.getElementById('about-modal-content');
  if (details && summary && body && modal && content) {
    const wide = window.matchMedia('(min-width: 861px)'); // match the app's desktop/mobile breakpoint
    let lastFocus = null;

    // Mark every sibling of the modal inert while it's open, so keyboard/AT focus
    // can't wander behind it (a focus trap without a manual key loop — the modern
    // primitive). Background scroll is already frozen via .about-modal-open.
    const setBackgroundInert = on => {
      for (const el of modal.parentElement.children) if (el !== modal) el.inert = on;
    };
    const openModal = () => {
      details.open = false;          // keep the inline copy collapsed
      content.appendChild(body);     // move the node in (no duplicate text)
      modal.hidden = false;
      document.body.classList.add('about-modal-open');
      setBackgroundInert(true);
      lastFocus = document.activeElement;
      modal.querySelector('.about-modal-close').focus();
    };
    const closeModal = () => {
      if (modal.hidden) return;
      modal.hidden = true;
      document.body.classList.remove('about-modal-open');
      setBackgroundInert(false);
      details.appendChild(body);     // return the node to <details>
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      else summary.focus();
    };

    summary.addEventListener('click', e => {
      if (!wide.matches) return;     // narrow: let <details> toggle inline
      e.preventDefault();
      openModal();
    });
    modal.addEventListener('click', e => {
      if (/** @type {HTMLElement} */ (e.target).hasAttribute('data-about-close')) closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !modal.hidden) closeModal();
    });
    // Keep the two presentations consistent when the viewport crosses the breakpoint.
    const onChange = () => {
      if (wide.matches) { if (details.open) openModal(); }  // inline → modal
      else if (!modal.hidden) closeModal();                 // modal → collapsed
    };
    if (wide.addEventListener) wide.addEventListener('change', onChange);
    else if (wide.addListener) wide.addListener(onChange);
  }
}

// ─── Color-vision-deficiency simulation ───────────────────────────────────────
// The whole app is simulated by transforming every color the app itself renders
// (cvdTransform* + the wheel shader) — see the note above cvdTransformRgb for why
// a CSS/SVG reference filter cannot cover composited layers on iOS WebKit.
// The pieces not covered by the render pipeline are handled here:
//   1. Theme CSS variables (--ground/--surface/--text/… drive every themed color,
//      including the page background and both fixed overlays): resolve each
//      variable's untransformed color via a probe element, transform it, and pin
//      the result as an inline override on <html>. Re-runs whenever the theme
//      inputs (data-theme / --ui-hue / --ui-sat / --ui-ground-l) change.
//   2. Static chromatic bits outside the theme system: the Preferences hue
//      slider's rainbow, the saturation slider's endpoint, and the R/G/B channel
//      letter colors.
// Intentionally not persisted: a simulation surviving reload would look broken.

// Theme-derived variables to override under simulation. --accent is excluded:
// applyAll() already writes it from the (transformed) selected color.
const CVD_THEME_VARS = ['--ground', '--surface', '--surface2', '--border', '--text', '--muted', '--pass', '--pass-border', '--pass-bg', '--error'];
let _cvdProbe = null;

function applyCvdThemeVars() {
  const root = document.documentElement;
  // Clear previous overrides first so the probe resolves the raw theme values.
  for (const v of CVD_THEME_VARS) root.style.removeProperty(v);
  if (!currentCvd) return;
  if (!_cvdProbe) {
    _cvdProbe = document.createElement('span');
    _cvdProbe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;';
    document.body.appendChild(_cvdProbe);
  }
  const cs = getComputedStyle(_cvdProbe);
  for (const v of CVD_THEME_VARS) {
    _cvdProbe.style.color = `var(${v})`;
    root.style.setProperty(v, cvdTransformRgba(cs.color));
  }
}

// Static chromatic colors that are not routed through the render pipeline.
function applyCvdStaticUi() {
  // Preferences hue slider: regenerate its rainbow through the simulation
  // (matches the CSS rule's 13 hsl stops; !important there needs it here too).
  const hueSlider = document.getElementById('ui-hue-slider');
  if (hueSlider) {
    if (currentCvd) {
      const stops = [];
      for (let h = 0; h <= 360; h += 30) stops.push(cvdTransformHex(toHex(...hslToRgb(h % 360, 0.7, 0.55))));
      hueSlider.style.setProperty('background-image', `linear-gradient(to right, ${stops.join(', ')})`, 'important');
    } else {
      hueSlider.style.removeProperty('background-image');
    }
  }
  // Preferences saturation slider: its endpoint carries the current UI hue.
  const satSlider = /** @type {HTMLInputElement} */ (document.getElementById('ui-sat-slider'));
  const hueVal = hueSlider ? +(/** @type {HTMLInputElement} */ (hueSlider).value) : 240;
  if (satSlider) {
    satSlider.style.backgroundImage =
      `linear-gradient(to right, ${cvdTransformHex(toHex(...hslToRgb(hueVal, 0, 0.55)))}, ${cvdTransformHex(toHex(...hslToRgb(hueVal, 0.75, 0.55)))})`;
  }
  // R/G/B channel letters (inline colors in the markup and the chip-editor clone).
  applyCvdChannelLetters(document);
}

/** Transform the R/G/B letter colors under `root` (idempotent — the original
    color is stashed in dataset so the simulation can be re-derived or removed). */
function applyCvdChannelLetters(root) {
  for (const el of root.querySelectorAll('.custom-ch[style], .custom-ch[data-cvd-base]')) {
    const base = el.dataset.cvdBase || el.style.color;
    if (!base) continue;
    el.dataset.cvdBase = base;
    el.style.color = currentCvd ? cvdTransformHex(rgbCssToHex(base)) : base;
  }
}

/** Normalize a CSS color that may be `#rrggbb` or `rgb(r, g, b)` to hex. */
function rgbCssToHex(c) {
  if (c.startsWith('#')) return c;
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? toHex(+m[1], +m[2], +m[3]) : c;
}

// Re-derive the variable overrides whenever the theme inputs change (dark/light
// switch, UI tint sliders, brightness, URL restore, reset) — watching the inputs
// beats hooking every writer. The derived-var overrides written by
// applyCvdThemeVars don't alter these inputs, so this cannot loop.
{
  const root = document.documentElement;
  const themeSig = () => [
    root.dataset.theme,
    root.style.getPropertyValue('--ui-hue'),
    root.style.getPropertyValue('--ui-sat'),
    root.style.getPropertyValue('--ui-ground-l'),
  ].join('|');
  let _lastThemeSig = themeSig();
  new MutationObserver(() => {
    const s = themeSig();
    if (s === _lastThemeSig) return;
    _lastThemeSig = s;
    if (currentCvd) { applyCvdThemeVars(); applyCvdStaticUi(); }
  }).observe(root, { attributes: true, attributeFilter: ['style', 'data-theme'] });
}

{
  const cvdBtns = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('.settings-theme-btn[data-cvd]')]);
  cvdBtns.forEach(btn => btn.addEventListener('click', () => {
    cvdBtns.forEach(b => b.classList.toggle('active', b === btn));
    const v = btn.dataset.cvd || '';

    currentCvd = v;

    // Invalidate custom wheel, slider tracks, and chip editor caches
    _cwLumCache = null;
    _cwColorCache = null;
    _lumTrackKey = '';
    _hueTrackKey = -1;
    _satTrackKey = '';
    _cuTracksKey = '';
    _ceWheelCache = null;

    applyCvdThemeVars();
    applyCvdStaticUi();

    // Repaint all canvas layers and sync UI after toggling so the renderer sees fresh pixels
    scheduleRender(true, true);
    renderPalette();
  }));
}

// ─── Hover/tap popper (Preferences + Layout preview) ──────────────────────────
// Reusable dropdown wiring shared by the Preferences gear and the Layout-preview
// window icon. Opens on mouse hover (CSS) and on tap (sticky :hover); a click
// toggles it and .settings-dismissed force-closes over a lingering :hover.
// syncPanelHeight caps the popper to the visible viewport so it never runs off a
// short screen, leaving a bottom gap equal to the body's side padding; its
// content then scrolls inside (overflow-y:auto in CSS). `onOpen` runs on every
// (re)open so a panel can refresh its contents lazily.
function setupHoverPopper(wrap, btn, panel, onOpen) {
  if (!wrap || !panel) return;
  const syncPanelHeight = () => {
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const gap = parseFloat(getComputedStyle(document.getElementById('app-wrapper') || document.body).paddingLeft) || 16; // match side margins
    const top = wrap.getBoundingClientRect().bottom + 4; // panel sits 4px below the wrap (real px)
    // Bottom strip occupied by the Figma plugin's fixed action bar (0 on the web) — keep the
    // panel above it so its lower edge isn't hidden behind the bar.
    const reserve = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rlcw-fit-reserve')) || 0;
    // The panel lives inside the fit-to-viewport zoomed wrapper, so a CSS px set
    // here renders zoom× larger — divide the real-px budget back out.
    const zoom = parseFloat((document.getElementById('app-wrapper') || {}).style?.zoom) || 1;
    panel.style.maxHeight = Math.max(140, (vh - top - gap - reserve) / zoom) + 'px';
    // Mobile modal (CSS): drop the sheet from just below the trigger so the header
    // stays visible and its icon can toggle it closed (zoom is off there → raw px).
    panel.style.setProperty('--pop-top', top + 'px');
  };
  // onOpen (Layout/Scales) WIPES the panel's innerHTML to rebuild it. Run it ONLY on the
  // closed→open transition — never again while the popper stays open. Otherwise a second
  // pointerenter (web Figma's sandboxed iframe fires one when the panel reveals / the pointer
  // moves onto freshly-inserted content) rebuilds the panel mid-interaction, detaching the tab
  // the user is about to click — so in web Figma the Palette/Scales tabs did nothing. A repeated
  // pointerenter still syncs the height (cheap, safe), just never rebuilds. `_populated` resets
  // on close so the next open re-renders with the current colours. Tab clicks rebuild explicitly.
  let _populated = false;
  const refresh = () => { syncPanelHeight(); if (onOpen && !_populated) { _populated = true; onOpen(); } };
  // Hover reveal is fine-pointer only (touch opens via the click handler → openIt → refresh).
  // Gate on `!== 'touch'` (not `=== 'mouse'`): the first pointer event after load can report an
  // empty pointerType, which `=== 'mouse'` would drop — so hover revealed the panel via CSS but
  // onOpen never ran and the popper showed empty on the first open.
  wrap.addEventListener('pointerenter', e => { if (!IS_COARSE && e.pointerType !== 'touch') refresh(); });
  window.addEventListener('resize', syncPanelHeight);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', syncPanelHeight);
  syncPanelHeight();
  if (!btn) return;
  let sOpen = false;
  const openIt  = () => { sOpen = true;  wrap.classList.remove('settings-dismissed'); wrap.classList.add('settings-open'); refresh(); };
  const closeIt = () => { sOpen = false; _populated = false; wrap.classList.remove('settings-open'); wrap.classList.add('settings-dismissed'); btn.blur(); };
  const reset   = () => { sOpen = false; _populated = false; wrap.classList.remove('settings-open', 'settings-dismissed'); };
  // Mobile: a dim backdrop behind the modal sheet. It lives inside the wrap (so
  // the outside-close below, which treats anything in the wrap as "not outside",
  // ignores it) but carries its own tap-to-close — the standard modal dismissal.
  // CSS fades it in/out with the sheet and hides it entirely off the modal size.
  const backdrop = document.createElement('div');
  backdrop.className = 'settings-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  wrap.appendChild(backdrop);
  backdrop.addEventListener('pointerdown', () => closeIt());
  // Hover model — fine pointers only (coarse/touch opens by tap, closes by tapping the
  // backdrop). Hovering the trigger opens; moving the cursor OUT of the popover closes it.
  // In the narrow-width MODAL layout the panel is also revealed by the CSS `:hover`, and a
  // full-screen backdrop (child of the wrap) keeps the wrap hovered everywhere — so
  // wrap.pointerleave never fires and only .settings-dismissed (closeIt) can hide it. The
  // backdrop, by z-order, receives pointer moves only when the cursor is OFF both the trigger
  // and the panel. There, keep open only while the cursor is in the corridor directly between
  // the trigger and the panel (i.e. aimed at the panel); a move up or sideways closes at once.
  btn.addEventListener('pointerenter', e => { if (!IS_COARSE && e.pointerType !== 'touch') openIt(); });
  backdrop.addEventListener('pointermove', e => {
    if (IS_COARSE || e.pointerType === 'touch' || !sOpen) return;
    const tr = btn.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    // The panel sits just below the trigger; the only "toward the panel" path across the
    // backdrop is the thin gap directly beneath the trigger. Anywhere else on the backdrop
    // (above, or off to the side) is a move away → close immediately.
    const towardPanel = e.clientY >= tr.bottom - 1 && e.clientY <= pr.top + 1 &&
                        e.clientX >= tr.left - 2 && e.clientX <= tr.right + 2;
    if (!towardPanel) closeIt();
  });
  wrap.addEventListener('pointerleave', e => { if (!IS_COARSE && e.pointerType !== 'touch') reset(); });
  btn.addEventListener('click', e => {
    // A POINTER press (mouse or touch) only ever OPENS: pressing the trigger of an
    // already-open popper keeps it open — never a close→reopen flicker (on desktop the
    // sticky :hover re-opened it; on mobile the modal toggled shut then animated back).
    // Closing by pointer is via moving the mouse away (desktop) or tapping the dim
    // backdrop / outside the sheet (mobile). Keyboard (Enter/Space → click with detail 0)
    // still toggles, since it has no hover or backdrop to close with.
    if (e.detail === 0) {
      sOpen ? closeIt() : openIt();
    } else if (!sOpen) {
      openIt();
    }
  });
  // Tap/click anywhere outside the control closes it. closeIt sets
  // .settings-dismissed so it beats a lingering sticky :hover on touch.
  document.addEventListener('pointerdown', e => {
    if (sOpen && !wrap.contains(/** @type {Node} */ (e.target))) closeIt();
  }, true);
  return { close: () => { if (sOpen) closeIt(); } };
}
// Closer for the Layout-preview popper — used to hand off to the sidebar after saving a theme
// to the palette on narrow (modal) widths, where the popper covers the screen.
let _closeLayoutPopper = null;
{
  const sBtn = document.getElementById('settings-btn');
  setupHoverPopper(sBtn && sBtn.closest('.settings-wrap'), sBtn, document.getElementById('settings-panel'));
  const lBtn = document.getElementById('layout-btn');
  const lp = setupHoverPopper(lBtn && lBtn.closest('.layout-wrap'), lBtn, document.getElementById('layout-panel'), renderLayoutPreview);
  _closeLayoutPopper = lp && lp.close;
}

// ─── Scale & theme generator (v2 beta) ────────────────────────────────────────
// From the current colour, generate a tonal scale (50–950) stepped evenly in OKLab
// perceptual lightness (not in WCAG relative luminance) and
// derive light + dark semantic themes whose text/muted/accent contrasts are
// guaranteed by construction: each step is solved to a target WCAG relative
// luminance, so pair contrasts are KNOWN (not audited afterwards). Reuses the
// wheel's core idea — a colour at a target relative luminance — plus contrastRatio.
// (Surfaced inside the Layout preview's "Scales" mode; no separate popper.)
const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
// A perceptually-even OKLab LIGHTNESS ramp for the 11 steps: light (near-white, step 50) →
// dark (near-black, step 950). Linear in OKLab L, which is perceptually uniform, so the lightness
// progression is as smooth as it can be. These are OKLab L values, NOT WCAG relative luminance:
// the generated scale/gradient is a design tool whose intermediate steps needn't meet a contrast
// target — the derived light/dark THEMES still choose roles by MEASURED contrast (.lum below).
const SCALE_L_LIGHT = 0.97;
const SCALE_L_DARK  = 0.13;
const SCALE_L = SCALE_STEPS.map((_, i) => SCALE_L_LIGHT + (SCALE_L_DARK - SCALE_L_LIGHT) * (i / (SCALE_STEPS.length - 1)));

// OKLCh → linear-sRGB, UNCLAMPED (for gamut testing; the display path clamps in oklchToRgb).
function oklchToLinear(L, C, H) {
  const hr = H * Math.PI / 180;
  const a = C * Math.cos(hr), bb = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * bb;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
// Largest chroma keeping OKLCh(L, ·, H) inside the sRGB gamut — the CSS Color 4 gamut-map step
// (hold L and H, reduce chroma to the boundary). The boundary is continuous in L and H, so along
// a smooth L-ramp / hue path this ceiling — and hence the scale's chroma — varies smoothly.
function maxChromaInGamut(L, H) {
  const inG = C => oklchToLinear(L, C, H).every(v => v >= -1e-4 && v <= 1 + 1e-4);
  if (inG(0.5)) return 0.5; // 0.5 exceeds sRGB's OKLCh chroma max, so it always brackets
  let lo = 0, hi = 0.5;
  for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (inG(m)) lo = m; else hi = m; }
  return lo;
}

// Which main colours seed the scale: 'gradient' blends the main TEXT and BG
// colours across the ramp (default); 'text'/'bg' use just that one.
let _scaleSource = 'gradient';

// Shortest circular interpolation between two hues (degrees).
function lerpHue(a, b, t) {
  const d = (((b - a) % 360) + 540) % 360 - 180;
  return (((a + d * t) % 360) + 360) % 360;
}

// Build the 11-step scale as a smooth path in OKLab: L follows the perceptually-even ramp,
// chromaHueAt(t) gives the [target chroma, hue°] at position t (0 = light 50 → 1 = dark 950), and
// the realised chroma is that target reduced to the sRGB gamut boundary (chroma-only, holding L
// and H). Every input varies smoothly in t and the gamut ceiling is continuous, so the ramp is
// smooth BY CONSTRUCTION — no per-step luminance solve, no hard clamp, no dull outlier steps.
function buildScaleFrom(chromaHueAt) {
  return SCALE_STEPS.map((step, i) => {
    const t = i / (SCALE_STEPS.length - 1);
    const L = SCALE_L[i];
    const [chromaTarget, hue] = chromaHueAt(t);
    const C = Math.min(Math.max(0, chromaTarget), maxChromaInGamut(L, hue));
    const [r, g, b] = oklchToRgb(L, C, hue);
    return { step, hex: toHex(r, g, b).toLowerCase(), lum: relativeLuminance(r, g, b) };
  });
}

// The scale for the current source setting and the current main text/bg colours, built entirely
// in OKLab/OKLCh: a smooth lightness ramp carries the seed hue (single source) or a shortest-arc
// hue blend between the two seeds (gradient), with a chroma target interpolated from the seeds'
// own chroma and gamut-clamped per step. Perceptually uniform and smooth by construction.
function currentScale() {
  const textRgb = selectedRgbBiased();
  const bgRgb = [cR, cG, cB];
  const [, cT, hT]  = rgbToOklch(...textRgb);
  const [, cB2, hB2] = rgbToOklch(...bgRgb);
  if (_scaleSource === 'text') return buildScaleFrom(() => [cT, hT]);
  if (_scaleSource === 'bg')   return buildScaleFrom(() => [cB2, hB2]);
  // gradient: the lighter seed anchors the light end, the darker the dark end, so the ramp stays
  // light→dark while blending both hues (and chroma) across it.
  const lightFirst = relativeLuminance(...textRgb) >= relativeLuminance(...bgRgb);
  const lo = lightFirst ? [cT, hT] : [cB2, hB2];
  const hi = lightFirst ? [cB2, hB2] : [cT, hT];
  return buildScaleFrom(t => [lo[0] + (hi[0] - lo[0]) * t, lerpHue(lo[1], hi[1], t)]);
}

// Segmented Text→BG / Text / BG source selector (shared by the scale popper and
// the layout theme preview); `onChange` re-renders that surface.
function scaleSourceToggle(onChange) {
  const wrap = lpEl('div', 'lp-modes');
  for (const [m, label, tip] of [
    ['gradient', 'Text / BG', 'Blend the main text and background colours across the scale'],
    ['text', 'Text', 'Use only the main text colour'],
    ['bg', 'BG', 'Use only the main background colour'],
  ]) {
    const b = lpEl('button', 'lp-mode-btn' + (_scaleSource === m ? ' active' : ''), label);
    b.type = 'button'; b.title = tip;
    b.addEventListener('click', () => { if (_scaleSource !== m) { _scaleSource = m; onChange(); } });
    wrap.appendChild(b);
  }
  return wrap;
}

// A seed readout reflecting the current source (two swatches for the gradient).
function scaleSeedLine() {
  const textHex = toHex(...selectedRgbBiased()).toLowerCase();
  const bgHex = toHex(cR, cG, cB).toLowerCase();
  const seed = lpEl('div', 'sg-seed');
  const dotOf = hex => { const d = lpEl('span', 'sg-seed-dot'); d.style.background = cvdTransformHex(hex); return d; };
  if (_scaleSource === 'gradient') {
    seed.append(dotOf(textHex), dotOf(bgHex),
      lpEl('span', 'sg-seed-txt', 'Text → BG · ' + hexDisplay(textHex) + ' → ' + hexDisplay(bgHex)));
  } else {
    const hex = _scaleSource === 'bg' ? bgHex : textHex;
    seed.append(dotOf(hex), lpEl('span', 'sg-seed-txt', (_scaleSource === 'bg' ? 'BG ' : 'Text ') + hexDisplay(hex)));
  }
  return seed;
}

// First scale entry (searching from the dark or light end) whose contrast vs
// refLum meets minRatio — so a role is the lightest/darkest step that still passes.
function pickByContrast(scale, refLum, minRatio, fromDark) {
  const list = fromDark ? [...scale].reverse() : scale;
  return list.find(s => contrastRatio(s.lum, refLum) >= minRatio) || list[list.length - 1];
}

// Brand-accent fill: a saturated mid step, DISTINCT from the text tones (so it
// never collides with `muted`/`text` when saved to the palette), paired with
// black or white — whichever contrasts more. These steps' luminances are fixed,
// so the chosen label always clears AA (≥4.5) by construction.
function accentPair(scale, idx) {
  const accent = scale[idx];
  const white = { step: null, hex: '#ffffff', lum: 1 };
  const black = { step: null, hex: '#000000', lum: 0 };
  const accentText = contrastRatio(accent.lum, white.lum) >= contrastRatio(accent.lum, black.lum) ? white : black;
  return { accent, accentText };
}

// Colour for inline links (rendered on `surface`). The accent is picked to be a
// good fill, which isn't always ≥ AA as text — so use it as a link only when it
// clears 4.5:1 on the surface, otherwise fall back to the body text colour (an
// underline carries the link affordance). Keeps every rendered link accessible.
function themeLink(th) {
  return contrastRatio(th.accent.lum, th.surface.lum) >= 4.5 ? th.accent : th.text;
}

// State (status) colors — fixed, seed-INDEPENDENT hues that every product UI needs: success
// (green), warning (amber), danger (red), info (blue). Generated in OKLab like the scale so they
// sit at a consistent lightness/vividness and pair with light/dark themes.
const STATE_HUES = { success: 152, warning: 85, danger: 27, info: 255 };

// A role value {step,hex,lum} built straight from OKLCh (off the tonal scale — step:null).
function mkOklch(L, C, H) {
  const [r, g, b] = oklchToRgb(L, C, H);
  return { step: null, hex: toHex(r, g, b).toLowerCase(), lum: relativeLuminance(r, g, b) };
}
// The status FOREGROUND colour (text/icon on the page, also usable as a solid fill). Starts at a
// nominal tone (dark-ish on light, bright on dark) but is then solved AGAINST the surface so it
// clears WCAG AA (4.5:1) as text — because at a fixed OKLab L the four hues land at very different
// relative luminances (green's 0.7152 Y-weight makes it the lightest), so a fixed L left green
// below AA on light surfaces. Moves toward more contrast (darker on light / lighter on dark) only
// as far as needed, keeping each hue as vivid as possible. Guarantees AA on bg too (surface is the
// harder of bg/surface). refLum defaults to white/black when a theme surface isn't supplied.
function stateColor(hue, dark, refLum) {
  const ref = refLum != null ? refLum : (dark ? 0 : 1);
  const mk = l => mkOklch(l, maxChromaInGamut(l, hue) * 0.92, hue);
  let L = dark ? 0.72 : 0.56, col = mk(L);
  const dir = dark ? +1 : -1;
  for (let i = 0; i < 40 && contrastRatio(col.lum, ref) < 4.5; i++) {
    const nL = L + dir * 0.01;
    if (nL <= 0.06 || nL >= 0.96) break;
    L = nL; col = mk(L);
  }
  return col;
}
// Material-3-style container pair for a hue: a soft FILL + its on-colour. Light theme → pale
// tint + dark-saturated on-colour; dark theme → deep muted fill + light on-colour. Lets filled
// badges / alerts / soft buttons be built accessibly (verified ≥ AA below by construction).
function containerPair(hue, dark) {
  const fillL = dark ? 0.34 : 0.93, onL = dark ? 0.90 : 0.38;
  return {
    fill: mkOklch(fillL, Math.min(maxChromaInGamut(fillL, hue), dark ? 0.07 : 0.05), hue),
    on:   mkOklch(onL,   maxChromaInGamut(onL, hue) * 0.85, hue),
  };
}
// Interaction-state shade of a fill: shift OKLab L toward "more pressed" (darker on light
// themes, lighter on dark), holding hue, chroma re-clamped to gamut. hover < active.
function shiftLightness(hex, dL, dark) {
  const [L, C, H] = rgbToOklch(...hexToRgb(hex));
  const nL = Math.max(0.06, Math.min(0.96, L + (dark ? dL : -dL)));
  return mkOklch(nL, Math.min(C, maxChromaInGamut(nL, H)), H);
}
// White/black on-colour with the most contrast over `hex` — the legible label on a solid fill.
function onColorFor(hex) {
  const l = relativeLuminance(...hexToRgb(hex));
  const white = { step: null, hex: '#ffffff', lum: 1 }, black = { step: null, hex: '#000000', lum: 0 };
  return contrastRatio(l, 1) >= contrastRatio(l, 0) ? white : black;
}
// Per-state roles: the status foreground (AA-solved vs `refLum` = the theme surface) with its
// hover/active shades and an on-colour for use as a solid fill, plus a soft container fill + its
// on-colour — for every hue.
function stateRoles(dark, refLum) {
  const out = {};
  for (const [name, hue] of Object.entries(STATE_HUES)) {
    const fill = stateColor(hue, dark, refLum);
    out[name] = fill;                               // status text / icon on the page, also a solid fill
    out[name + 'Text']   = onColorFor(fill.hex);    // legible label when the status colour is a fill
    out[name + 'Hover']  = shiftLightness(fill.hex, 0.05, dark); // pressed-ward shades for a solid
    out[name + 'Active'] = shiftLightness(fill.hex, 0.10, dark); // status button (mirrors accent-hover/active)
    const cont = containerPair(hue, dark);
    out[name + 'Container']   = cont.fill;          // soft fill for filled alerts / badges
    out[name + 'OnContainer'] = cont.on;            // text / icon on that fill
  }
  return out;
}

// Accent interaction states + container. Hover/active are ADJACENT SCALE STEPS (darker on light,
// lighter on dark), so they sit on the brand ramp and reference color.scale.* — the accent's
// palette stays one coherent family instead of scattering into off-scale primitives. The soft
// container pair is a low-chroma tint at the accent's hue (genuinely off the scale).
function accentRoles(scale, accIdx, dark) {
  const clamp = i => scale[Math.max(0, Math.min(scale.length - 1, i))];
  const hue = rgbToOklch(...hexToRgb(scale[accIdx].hex))[2];
  const cont = containerPair(hue, dark);
  return {
    accentContainer: cont.fill, accentContainerText: cont.on,
    accentHover:  clamp(dark ? accIdx - 1 : accIdx + 1),   // one step more pressed
    accentActive: clamp(dark ? accIdx - 2 : accIdx + 2),   // two steps
  };
}

// Scrim: a fixed translucent-black overlay for modal backdrops / drawer scrims, identical in
// light and dark. 33.33% black — hex #00000055 (0x55/255 ≈ 0.3333); the export carries the alpha
// through as an 8-digit hex / rgba / oklch(… / 0.333) and a DTCG $value with an `alpha` field.
const SCRIM = { step: null, hex: '#00000055', lum: 0 };

// Pick the accent's scale index: keep the preferred vivid mid step, but if it collides with the
// text or muted step (so the accent fill would be the SAME colour as body / secondary text — a
// WCAG 1.4.1 affordance failure and visually confusing), fall back to the nearest saturated step
// that's distinct. muted is left at its contrast-optimal pick; only the (semantically flexible)
// accent moves. `avoid` are the step numbers already taken by text/muted.
function chooseAccentIdx(scale, preferred, candidates, avoid) {
  for (const i of [preferred, ...candidates])
    if (i >= 0 && i < scale.length && !avoid.includes(scale[i].step)) return i;
  return preferred; // scale exhausted (won't happen for 11 steps) — keep preferred
}

function deriveTheme(scale, dark) {
  // Body & muted text are picked against SURFACE-2 (the most elevated nested panel), which is the
  // hardest of the three backgrounds (bg / surface / surface-2). Clearing the threshold there
  // guarantees AA on surface and bg too — so muted stays legible even on the elevated panel.
  // `border` is a subtle divider (~2:1); `border-strong` is a ≥3:1 step for UI-component
  // boundaries that must meet WCAG 1.4.11 (input outlines, etc.).
  if (!dark) {
    const bg = { step: null, hex: '#ffffff', lum: 1 };
    const surface = scale[0];                                // 50  — cards / panels
    const surface2 = scale[1];                               // 100 — nested / elevated
    const text  = pickByContrast(scale, surface2.lum, 7,   false); // lightest dark step ≥ AAA on all surfaces
    const muted = pickByContrast(scale, surface2.lum, 4.5, false); // …≥ AA on all surfaces
    const accIdx = chooseAccentIdx(scale, 6, [7, 5, 8, 4], [text.step, muted.step]); // vivid mid, distinct from text/muted
    const acc = accentPair(scale, accIdx);
    return {
      dark: false, bg, surface, surface2, border: scale[2], // border (200) = subtle divider
      borderStrong: pickByContrast(scale, bg.lum, 3, false), // ≥ 3:1 vs bg — WCAG 1.4.11 UI boundary
      scrim: SCRIM,
      // `text` is the AAA body colour (lightest step clearing 7:1); `text-strong` is a darker
      // on-ramp step for emphasis / headings — more contrast than text, still a color.scale alias.
      text, textStrong: scale[scale.length - 2], muted,
      accent: acc.accent, accentText: acc.accentText,
      ...accentRoles(scale, accIdx, false),
      ...stateRoles(false, surface2.lum), // status fg solved to clear AA on all surfaces
    };
  }
  const bg = scale[scale.length - 1];                        // 950
  const surface = scale[scale.length - 2];                   // 900 — cards / panels
  const surface2 = scale[scale.length - 3];                  // 800 — nested / elevated
  const text  = scale[1];                                    // 100 — clears AAA on bg & surface
  const muted = pickByContrast(scale, surface2.lum, 4.5, true); // ≥ AA on all surfaces (surface-2 is the hardest)
  const accIdx = chooseAccentIdx(scale, 3, [2, 4, 1, 5], [text.step, muted.step]); // bright, distinct from text/muted
  const acc = accentPair(scale, accIdx);
  return {
    dark: true, bg, surface, surface2, border: scale[scale.length - 4], // border (700) = subtle divider
    borderStrong: pickByContrast(scale, bg.lum, 3, true),    // ≥ 3:1 vs bg — WCAG 1.4.11 UI boundary
    scrim: SCRIM,
    // `text-strong`: a lighter on-ramp step than `text` for emphasis / headings on the dark bg.
    text, textStrong: scale[0], muted,
    accent: acc.accent, accentText: acc.accentText,
    ...accentRoles(scale, accIdx, true),
    ...stateRoles(true, surface2.lum), // status fg solved to clear AA on all surfaces
  };
}


// Copy a swatch's hex and confirm it: flash a green outline and flip the hover
// tooltip (the [data-name] ::after) to "✓ Copied #HEX" so it's obvious a click
// copied the value.
function copyHexSwatch(hex, el) {
  if (!navigator.clipboard) return;
  navigator.clipboard.writeText(hexDisplay(hex)).then(() => {
    const orig = el.dataset.name;
    el.classList.add('copied');
    el.dataset.name = '✓ Copied ' + hexDisplay(hex);
    setTimeout(() => { el.classList.remove('copied'); el.dataset.name = orig; }, 1000);
  }).catch(() => {});
}

// Scale export controls (independent of the sidebar palette export).
let _scaleExportFmt = 'css';      // 'css' | 'tailwind' | 'json' — CSS custom properties by default
let _scaleExportColorFmt = 'hex'; // 'oklch' | 'hex' — HEX (most universal) by default

// Semantic role → theme key. The order the themes are emitted in. Layered like Material 3:
// surfaces (bg → surface → surface-raised → border → scrim overlay), text (on-surface / -variant), the accent with
// its on-colour, interaction states (hover/active) and soft container pair, then the four
// status colours — each a foreground/solid fill with its own hover/active states plus a
// container fill + on-container.
const SCALE_SEM_ROLES = [
  ['bg', 'bg'], ['surface', 'surface'], ['surface-raised', 'surface2'], ['border', 'border'], ['border-strong', 'borderStrong'], ['scrim', 'scrim'],
  ['text', 'text'], ['text-strong', 'textStrong'], ['muted', 'muted'],
  ['accent', 'accent'], ['accent-foreground', 'accentText'],
  ['accent-hover', 'accentHover'], ['accent-active', 'accentActive'],
  ['accent-container', 'accentContainer'], ['accent-container-foreground', 'accentContainerText'],
  ['success', 'success'], ['success-foreground', 'successText'], ['success-hover', 'successHover'], ['success-active', 'successActive'], ['success-container', 'successContainer'], ['success-container-foreground', 'successOnContainer'],
  ['warning', 'warning'], ['warning-foreground', 'warningText'], ['warning-hover', 'warningHover'], ['warning-active', 'warningActive'], ['warning-container', 'warningContainer'], ['warning-container-foreground', 'warningOnContainer'],
  ['danger', 'danger'],   ['danger-foreground', 'dangerText'],   ['danger-hover', 'dangerHover'],   ['danger-active', 'dangerActive'],   ['danger-container', 'dangerContainer'],   ['danger-container-foreground', 'dangerOnContainer'],
  ['info', 'info'],       ['info-foreground', 'infoText'],       ['info-hover', 'infoHover'],       ['info-active', 'infoActive'],       ['info-container', 'infoContainer'],       ['info-container-foreground', 'infoOnContainer'],
];

/** Full Scale export as GLOBAL (primitive) tokens — the OKLab-lightness tonal
 *  scale 50–950 — plus the light/dark semantic themes as tokens that REFERENCE
 *  those globals (var() in CSS/Tailwind, DTCG aliases in JSON). This is distinct
 *  from the palette export, which is purely semantic role tokens.
 *  @param {'css'|'tailwind'|'json'} format
 *  @param {'oklch'|'hex'} colorFmt */
// OKLCH hue (0–360) → a colour-family name, using the familiar Tailwind palette names (the tool
// already targets Tailwind/shadcn). Fine granularity (~17 stops) so two colours whose hue differs
// by more than ~15° land in DIFFERENT families and get distinct names — instead of colliding in a
// coarse bucket and needing a "-2" suffix. Descriptive only, so exact boundaries needn't be perfect.
function hueFamily(H) {
  H = ((H % 360) + 360) % 360;
  const t = [[15,'rose'],[35,'red'],[50,'orange'],[70,'amber'],[95,'yellow'],[130,'lime'],
             [155,'green'],[178,'emerald'],[198,'teal'],[218,'cyan'],[248,'sky'],[272,'blue'],
             [292,'indigo'],[315,'violet'],[335,'purple'],[350,'fuchsia'],[360,'pink']];
  for (const [max, name] of t) if (H < max) return name;
  return 'rose';
}
// OKLab lightness → a tone number on the same 50–950 ramp as color.scale.*, but at a FINE
// (25-unit) resolution. The scale itself uses the coarse canonical steps; off-scale primitives
// interpolate that L→step mapping and snap to 25, so two colours whose lightness differs (even by
// ~0.03 L) get DISTINCT tone numbers (e.g. green-200 vs green-225) instead of colliding in one
// coarse bucket and needing a "-2" suffix. Tone still honestly tracks lightness.
function toneForL(L) {
  let t;
  if (L >= SCALE_L[0]) t = SCALE_STEPS[0];
  else if (L <= SCALE_L[SCALE_L.length - 1]) t = SCALE_STEPS[SCALE_STEPS.length - 1];
  else {
    t = SCALE_STEPS[SCALE_STEPS.length - 1];
    for (let i = 0; i < SCALE_L.length - 1; i++) {
      if (L <= SCALE_L[i] && L >= SCALE_L[i + 1]) {
        const f = (SCALE_L[i] - L) / (SCALE_L[i] - SCALE_L[i + 1]);
        t = SCALE_STEPS[i] + f * (SCALE_STEPS[i + 1] - SCALE_STEPS[i]);
        break;
      }
    }
  }
  return Math.max(50, Math.min(950, Math.round(t / 25) * 25));
}
// Descriptive name PARTS for an off-scale colour: a fixed name (white/black, incl. an -aNN alpha
// suffix), or a colour family + tone. No role or theme is encoded — the primitive layer describes
// colour only; the semantic theme layer carries meaning via aliases.
function colorNameParts(hex) {
  const [L, C, H] = rgbToOklch(...hexToRgb(hex));
  const a = hexToRgba(hex)[3];
  const aSuf = a < 0.9995 ? '-a' + Math.round(a * 100) : '';
  if (C < 0.02) { // achromatic
    const h = hex.slice(0, 7).toLowerCase();
    if (h === '#ffffff') return { fixed: 'white' + aSuf };
    if (h === '#000000') return { fixed: 'black' + aSuf };
    const t = toneForL(L);
    if (t <= 50)  return { fixed: 'white' + aSuf };
    if (t >= 950) return { fixed: 'black' + aSuf };
    return { family: 'neutral', tone: t, aSuf };
  }
  // Chroma tier: low-chroma (desaturated) colours — the soft container fills — get a "-muted"
  // family qualifier (still colour-descriptive, chroma being a colour property), so a pale
  // red container reads as red-muted-700 instead of colliding with a vivid red-700 and taking a
  // "-2" suffix. Vivid colours keep the plain family name.
  const family = hueFamily(H) + (C < 0.09 ? '-muted' : '');
  return { family, tone: toneForL(L), aSuf };
}

function buildScaleExport(format, colorFmt, scale, light, dark) {
  const cval = hex => colorFmt === 'hex' ? hex.toLowerCase() : oklchCss(hex);
  const alt  = hex => colorFmt === 'hex' ? oklchCss(hex) : hex.toLowerCase();

  // Off-scale theme values → DESCRIPTIVE primitive names (colour family + tone, e.g. green-700).
  // The primitive layer describes colour only — no role or theme in a name. The tone number is
  // ALWAYS the colour's true OKLab lightness step (toneForL): a near-white red is red-100, never
  // a higher number — so "tone = lightness" holds and a name can't misrepresent brightness. When
  // two genuinely-different hexes map to the same family+tone (e.g. a red-family accent container
  // and the danger container both at tone 100 with slightly different hues), the later one gets a
  // numeric suffix (red-100, red-100-2) — an honest "another colour at this exact tone" rather
  // than bumping the tone number to a value that lies about the lightness. Shared hexes dedupe;
  // light roles are named before dark for deterministic output.
  const BASE_NAMES = {};
  const usedNames = new Set();
  // Perceptual, HUE-AWARE dedupe. Two off-scale colours are "the same primitive" when they're
  // indistinguishable to the eye — but ΔE alone can't tell a genuine near-twin (same hue, trivially
  // different L) from two DIFFERENT hues that happen to sit at a similar ΔE. So merge when either:
  //   • ΔE < 0.024 (~JND — clearly one colour), or
  //   • same hue (ΔH < 4°) and ΔE < 0.032 (a near-twin differing only slightly in lightness).
  // Different-hue colours (e.g. a brick red vs a rose red, ΔH 17–23°) are NEVER merged — they're
  // distinct and keep separate primitives. A small WCAG contrast ratio (≈1.0) is NOT identity, so
  // it's never the test. Alpha must match (an opaque colour ≠ its translucent twin).
  const oklchOf = hex => rgbToOklch(...hexToRgb(hex)); // [L, C, H°]
  const labOf = hex => { const [L, C, H] = oklchOf(hex); const r = H * Math.PI / 180; return [L, C * Math.cos(r), C * Math.sin(r)]; };
  const alphaOf = hex => hexToRgba(hex)[3];
  const dHue = (a, b) => { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const assign = hex => {
    if (BASE_NAMES[hex]) return;
    const lab = labOf(hex), a = alphaOf(hex), [, C, H] = oklchOf(hex);
    for (const h of Object.keys(BASE_NAMES)) {                 // reuse a perceptually-identical primitive
      if (Math.abs(alphaOf(h) - a) >= 0.005) continue;
      const l2 = labOf(h), dE = Math.hypot(lab[0] - l2[0], lab[1] - l2[1], lab[2] - l2[2]);
      const [, C2, H2] = oklchOf(h);
      const sameHue = C > 0.02 && C2 > 0.02 && dHue(H, H2) < 4;
      if (dE < 0.024 || (sameHue && dE < 0.032)) { BASE_NAMES[hex] = BASE_NAMES[h]; return; }
    }
    const p = colorNameParts(hex);
    const base = p.fixed ? p.fixed : (p.family + '-' + p.tone + (p.aSuf || ''));
    let name = base, i = 2;
    while (usedNames.has(name)) name = base + '-' + (i++); // honest tone kept; suffix only on a real same-tone/different-hue clash
    usedNames.add(name); BASE_NAMES[hex] = name;
  };
  for (const [, k] of SCALE_SEM_ROLES) if (light[k] && light[k].step === null) assign(light[k].hex);
  for (const [, k] of SCALE_SEM_ROLES) if (dark[k]  && dark[k].step === null)  assign(dark[k].hex);

  if (format === 'css') {
    const gval = hex => cval(hex);
    const baseUsed = new Map(); // hex → var name, for the base primitives actually referenced
    const ref = e => {
      if (e.step !== null) return `var(--color-${e.step})`;
      const h = e.hex.toLowerCase();
      const name = BASE_NAMES[h] || ('c' + h.slice(1));
      baseUsed.set(h, name);
      return `var(--color-${name})`;
    };
    const roleLines = t => SCALE_SEM_ROLES.map(([n, k]) => `  --${n}: ${ref(t[k])};`).join('\n');
    const lightLines = roleLines(light), darkLines = roleLines(dark); // populates baseUsed
    const baseGlobals = [...baseUsed.entries()].sort((a, b) => a[0] < b[0] ? 1 : -1) // white → black
      .map(([hex, name]) => `  --color-${name}: ${gval(hex)};  /* ${alt(hex)} */`).join('\n');
    const globals = scale.map(c => `  --color-${c.step}: ${gval(c.hex)};  /* ${alt(c.hex)} */`).join('\n');
    return `/* Global tokens — base white/black + a tonal scale (50–950) stepped evenly in OKLab
   perceptual lightness (not in WCAG relative luminance), primitives. The light/dark semantic
   themes below reference ONLY these. From the Relative Luminous Color Wheel — relative-luminous-color-wheel.vercel.app */
:root {
${baseGlobals ? baseGlobals + '\n' : ''}${globals}
}
/* Semantic tokens — light theme (default), referencing the globals above. */
:root, [data-theme="light"] {
${lightLines}
}
/* Semantic tokens — dark theme. */
[data-theme="dark"] {
${darkLines}
}
`;
  }

  if (format === 'tailwind') {
    // Tailwind v4 @theme: the scale becomes global colour tokens, so you get
    // utilities like bg-brand-500 / text-brand-700; the semantic layer follows.
    const baseUsed = new Map();
    const ref = e => {
      if (e.step !== null) return `var(--color-brand-${e.step})`;
      const h = e.hex.toLowerCase();
      const name = BASE_NAMES[h] || ('c' + h.slice(1));
      baseUsed.set(h, name);
      return `var(--color-${name})`; // Tailwind's own --color-white/--color-black namespace
    };
    const roleLines = t => SCALE_SEM_ROLES.map(([n, k]) => `  --color-${n}: ${ref(t[k])};`).join('\n');
    const lightLines = roleLines(light), darkLines = roleLines(dark); // populates baseUsed
    const baseGlobals = [...baseUsed.entries()].sort((a, b) => a[0] < b[0] ? 1 : -1) // white → black
      .map(([hex, name]) => `  --color-${name}: ${cval(hex)};  /* ${alt(hex)} */`).join('\n');
    const globals = scale.map(c => `  --color-brand-${c.step}: ${cval(c.hex)};  /* ${alt(c.hex)} */`).join('\n');
    return `@theme {
  /* Global tokens — base white/black + tonal scale → utilities like bg-brand-500, text-brand-700. */
${baseGlobals ? baseGlobals + '\n' : ''}${globals}
}
/* Semantic tokens (reference the globals only). Toggle dark with [data-theme="dark"]. */
:root, [data-theme="light"] {
${lightLines}
}
[data-theme="dark"] {
${darkLines}
}
`;
  }

  if (format === 'shadcn') {
    // shadcn/ui theme: the app's roles mapped to shadcn's fixed token names, emitted as the
    // :root (light) + .dark blocks shadcn expects in globals.css. Values honour the colour-format
    // toggle (hex or oklch — modern shadcn uses oklch). Drop-in: paste over the generated
    // :root/.dark in a shadcn project (the @theme inline mapping there consumes these).
    const on = hex => { const l = relativeLuminance(...hexToRgb(hex)); return contrastRatio(l, 1) >= contrastRatio(l, 0) ? '#ffffff' : '#000000'; };
    const vars = t => [
      ['background', t.bg.hex], ['foreground', t.text.hex],
      ['card', t.surface.hex], ['card-foreground', t.text.hex],
      ['popover', t.surface2.hex], ['popover-foreground', t.text.hex],
      ['primary', t.accent.hex], ['primary-foreground', t.accentText.hex],
      ['secondary', t.surface2.hex], ['secondary-foreground', t.text.hex],
      ['muted', t.surface2.hex], ['muted-foreground', t.muted.hex],
      ['accent', t.accentContainer.hex], ['accent-foreground', t.accentContainerText.hex],
      ['destructive', t.danger.hex], ['destructive-foreground', on(t.danger.hex)],
      ['border', t.border.hex], ['input', t.border.hex], ['ring', t.accent.hex],
      // Five chart hues: the accent plus the four status colours.
      ['chart-1', t.accent.hex], ['chart-2', t.info.hex], ['chart-3', t.success.hex],
      ['chart-4', t.warning.hex], ['chart-5', t.danger.hex],
      // Sidebar surface set (shadcn ≥ 0.9).
      ['sidebar', t.surface.hex], ['sidebar-foreground', t.text.hex],
      ['sidebar-primary', t.accent.hex], ['sidebar-primary-foreground', t.accentText.hex],
      ['sidebar-accent', t.accentContainer.hex], ['sidebar-accent-foreground', t.accentContainerText.hex],
      ['sidebar-border', t.border.hex], ['sidebar-ring', t.accent.hex],
    ];
    const lines = t => vars(t).map(([n, hex]) => `  --${n}: ${cval(hex)};`).join('\n');
    return `/* shadcn/ui theme — from the Relative Luminous Color Wheel (relative-luminous-color-wheel.vercel.app).
   Paste over the :root / .dark blocks in your globals.css. */
:root {
  --radius: 0.625rem;
${lines(light)}
}

.dark {
${lines(dark)}
}
`;
  }

  // JSON — W3C Design Tokens (DTCG), Format Module 2025.10 (first stable release). A color
  // $value is the spec's OBJECT form { colorSpace, components, hex }: spec-aware tools (Style
  // Dictionary, Tokens Studio, Terrazzo) read the components, while `hex` is the spec's own
  // built-in fallback so hex-only importers still get a colour — the widest-compatible shape.
  // The export toggle chooses the colorSpace (srgb: components 0–1, or oklch: [L,C,H]); alpha
  // rides in $value only when <1. Scale primitives live under color.scale; the light/dark
  // themes under theme.* are ALIASES ({color.scale.N}). App luminance stays in $extensions.
  const NS = 'app.vercel.relative-luminous-color-wheel';
  const colorValue = hex => {
    const v = {
      colorSpace: colorFmt === 'oklch' ? 'oklch' : 'srgb',
      components: colorFmt === 'oklch' ? oklchComponentsDTCG(hex) : hexToRgb(hex).map(v => +(v / 255).toFixed(4)),
      hex: hex.slice(0, 7).toLowerCase(), // DTCG hex fallback MUST be 6-digit #rrggbb; alpha rides in `alpha`
    };
    const a = +hexToRgba(hex)[3].toFixed(4);
    if (a < 1) v.alpha = a;
    return v;
  };
  const litToken = (hex, lum) => {
    const t = { $value: colorValue(hex) };
    if (lum != null) t.$extensions = { [NS]: { luminance: +lum.toFixed(4) } };
    return t;
  };
  const scaleGroup = Object.fromEntries(scale.map(c => [String(c.step), litToken(c.hex, c.lum)]));
  // Keep the semantic layer alias-ONLY: any theme value not on the scale is promoted to a
  // color.base.* primitive with a DESCRIPTIVE name (colour family + tone, e.g. green-700) and
  // referenced, so a primitive describes colour only — role and theme live solely in theme.*.
  // (BASE_NAMES is declared once near the top of the function, shared by all formats.)
  // A flat primitive name (family + tone, e.g. green-700 / red-muted-700) nests under its hue
  // family: green-700 → base.green.700, red-muted-700 → base['red-muted'].700. Names without a
  // trailing tone (white, black, the translucent black-a33) stay leaf tokens directly under base.
  // So the alias path swaps the last "-<tone>" for ".<tone>".
  const nestPath = name => { const m = name.match(/^(.+)-(\d+)$/); return m ? `${m[1]}.${m[2]}` : name; };
  const baseUsed = new Map(); // hex → { name, lum } for every base primitive actually referenced
  const themeRef = e => {
    if (e.step !== null) return { $value: `{color.scale.${e.step}}` };
    const hex = e.hex.toLowerCase();
    const name = BASE_NAMES[hex] || ('c' + hex.slice(1)); // stable name for any non-white/black literal
    baseUsed.set(hex, { name, lum: e.lum });
    return { $value: `{color.base.${nestPath(name)}}` };
  };
  const themeGroup = t => Object.fromEntries(SCALE_SEM_ROLES.map(([n, k]) => [n, themeRef(t[k])]));
  const lightGroup = themeGroup(light), darkGroup = themeGroup(dark); // populates baseUsed
  // Nest the primitives by hue family so color.base is navigable and each family can carry its own
  // metadata: base.green.{tones}, base['red-muted'].{tones}, plus leaf white/black/black-a33.
  const baseGroup = {};
  for (const [hex, { name, lum }] of [...baseUsed.entries()].sort((a, b) => b[1].lum - a[1].lum)) { // white → black
    const m = name.match(/^(.+)-(\d+)$/);
    if (m) { (baseGroup[m[1]] || (baseGroup[m[1]] = {}))[m[2]] = litToken(hex, lum); }
    else baseGroup[name] = litToken(hex, lum);
  }
  const fmtNote = colorFmt === 'oklch' ? 'Each color $value is a DTCG object: colorSpace "oklch", components [L, C, H], plus a hex fallback.'
                :                        'Each color $value is a DTCG object: colorSpace "srgb", components [r, g, b] (0–1), plus a hex fallback.';
  const json = {
    $schema: 'https://www.designtokens.org/schemas/2025.10/format.json',
    $description: `Global primitive tokens (color.scale.* tonal ramp and color.base.* colour-descriptive primitives) plus light and dark semantic themes (theme.*) that reference them by alias only, exported from the Relative Luminous Color Wheel (relative-luminous-color-wheel.vercel.app). ${fmtNote} Follows the W3C DTCG Format Module 2025.10 (first stable release); the object color's hex property is the spec's fallback for hex-only tools.`,
    color: {
      $type: 'color',
      $description: 'Primitive colors, described by colour only (no role, no theme): color.scale is a tonal scale (50–950) stepped evenly in OKLab perceptual lightness — NOT in WCAG relative luminance, whose steps compress toward the dark end. color.base holds off-scale primitives nested by hue family (color.base.green.700, color.base.blue.300; low-chroma tints under family-muted; leaf white/black). With the Text/BG (gradient) source the scale also interpolates hue between the two seeds; single-source keeps one hue. The semantic theme tokens below reference these; nothing under theme.* hard-codes an absolute color.',
      base:  baseGroup,
      scale: scaleGroup,
    },
    theme: {
      $type: 'color',
      $description: 'Semantic role tokens for the light and dark themes. Each value is an alias to a color.scale or color.base primitive (colors live only in the primitive layer). DTCG has no built-in theming: light and dark are parallel role groups sharing the same primitives — pick one at build time (a 2025.10 sets/resolutionOrder resolver would be a separate document; it is not embedded here). Usage notes: (1) `border` is a subtle ~2:1 divider — use `border-strong` (≥3:1) for meaningful UI boundaries like input outlines (WCAG 1.4.11). (2) `scrim` is translucent (see its `alpha`); its 6-digit `hex` fallback is opaque, so hex-only tools render it solid — read `alpha`. (3) In dark, `muted` meets WCAG AAA but sits near APCA Lc −52; for small secondary text in dark mode prefer `text`. (4) accent `-hover`/`-active` are adjacent steps on a single-hue ramp, so they can share a luminance with nearby `text`/`muted` — distinguish interactive states with more than colour (underline, weight, motion). (5) The scale carries the seed colour’s hue (a brand ramp, not a neutral grey). (6) `text` is the AAA body colour; `text-strong` is a higher-emphasis step (darker on light, lighter on dark) for headings / emphasised text.',
      light: lightGroup,
      dark:  darkGroup,
    },
    $extensions: {
      [NS]: {
        // Ordered list of the scale's step names (a convenience index; the per-token relative
        // luminance lives on each color.scale.* token's own $extensions — not duplicated here).
        scaleSteps: scale.map(c => c.step),
      },
    },
  };
  return JSON.stringify(json, null, 2) + '\n';
}

const SCALE_EXPORT_FILE = {
  css:      { name: 'scale.tokens.css',   mime: 'text/css' },
  tailwind: { name: 'scale.tailwind.css', mime: 'text/css' },
  shadcn:   { name: 'shadcn-theme.css',   mime: 'text/css' },
  json:     { name: 'scale.tokens.json',  mime: 'application/design-tokens+json' },
};
function downloadScaleExport(format, colorFmt, scale, light, dark) {
  const f = SCALE_EXPORT_FILE[format] || SCALE_EXPORT_FILE.css;
  const blob = new Blob([buildScaleExport(format, colorFmt, scale, light, dark)], { type: f.mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = f.name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ─── Layout preview ───────────────────────────────────────────────────────────
// A live mock UI that dresses a small landing page (nav → hero → card grid) in
// the saved palette so the colours can be judged in context instead of as
// isolated swatches. Every saved colour is guaranteed to appear: the card grid
// renders one surface per background colour, and the closing legend lists every
// text and background colour by rank and hex. All palette colours pass through
// cvdTransformHex() so the colour-vision simulation applies here too; the chrome
// uses theme variables for the same reason. With nothing pinned yet, the live
// picker pair stands in so the preview is never empty.
const layoutPreviewEl = document.getElementById('layout-preview');

function lpEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

let _lpMode = 'palette'; // layout-preview source: saved palette | generated scale/themes

function lpModeToggle() {
  const wrap = lpEl('div', 'lp-modes');
  for (const [m, label] of [['palette', 'Palette'], ['theme', 'Scales']]) {
    const btn = lpEl('button', 'lp-mode-btn' + (_lpMode === m ? ' active' : ''), label);
    btn.type = 'button';
    btn.addEventListener('click', () => { if (_lpMode !== m) { _lpMode = m; renderLayoutPreview(); } });
    wrap.appendChild(btn);
  }
  return wrap;
}

function renderLayoutPreview() {
  if (!layoutPreviewEl) return;
  layoutPreviewEl.innerHTML = '';
  layoutPreviewEl.appendChild(lpModeToggle());
  if (_lpMode === 'theme') renderThemeLayout();
  else renderPaletteLayout();
}

// Which face of the theme each preview shows: a marketing 'page', or a systematic
// 'components' gallery (buttons / inputs / badges / table across default·hover·active·disabled).
let _lpThemeView = 'page';

function themeViewToggle() {
  const wrap = lpEl('div', 'lp-modes lp-view-modes');
  for (const [v, label] of [['page', 'Page'], ['components', 'Components']]) {
    const btn = lpEl('button', 'lp-mode-btn' + (_lpThemeView === v ? ' active' : ''), label);
    btn.type = 'button';
    btn.addEventListener('click', () => { if (_lpThemeView !== v) { _lpThemeView = v; renderLayoutPreview(); } });
    wrap.appendChild(btn);
  }
  return wrap;
}

// Dispatch to the current theme view. Both faces are driven entirely by `th`'s role colours, so
// they stay consistent with the tokens the app exports.
function buildThemeView(th, footerNote) {
  return _lpThemeView === 'components' ? buildComponentGallery(th, footerNote) : buildThemeMock(th, footerNote);
}

// ── Contrast audit (shared by both Layout preview modes) ──────────────────────
// A panel below each preview, judged in the app's CURRENT contrast mode: WCAG 2
// ratio tiers, or APCA |Lc| + usage tier + the chosen font-size/weight verdict.
// Text tokens (AA / AAA / ✗ / Lc numbers) are the primary signal — colour only
// reinforces them — so the audit itself reads under colour-vision deficiency.
function lpAuditIsApca() { return contrastLockMode === 'apca'; }

// WCAG: show the ACHIEVED contrast ratio itself — an "AA"/"AAA" token can't say
// whether it's the normal- or large-text bar (3:1 = AA large / UI, 4.5:1 = AA
// normal & AAA large, 7:1 = AAA normal), so the ratio is the unambiguous value.
// Colour still reinforces: pass ≥ 4.5 (AA normal), warn ≥ 3 (large text / UI),
// else fail. The tooltip spells out exactly which levels the ratio meets.
function wcagLevels(r) {
  if (r >= 7)   return 'AAA normal & large text';
  if (r >= 4.5) return 'AA normal & large text · AAA large text';
  if (r >= 3)   return 'AA large text (≥24px, or ≥18.66px bold) / UI only';
  return 'below AA (fails 3:1)';
}
function lpWcagVerdict(txtHex, bgHex) {
  const r = contrastRatio(relativeLuminance(...hexToRgb(txtHex)), relativeLuminance(...hexToRgb(bgHex)));
  const cls = r >= 4.5 ? 'pass' : r >= 3 ? 'warn' : 'fail';
  return {
    cls,
    cell: r >= 10 ? r.toFixed(0) : r.toFixed(1), // compact for a matrix cell (e.g. 6.2, 13)
    full: r.toFixed(2) + ':1',                   // precise, for the checklist + tooltips
    levels: wcagLevels(r),
  };
}

// APCA: |Lc| + usage tier + verdict for the currently selected font size/weight.
function lpApcaVerdict(txtHex, bgHex) {
  const lc = Math.abs(apcaLc(hexToRgb(txtHex), hexToRgb(bgHex)));
  const v = apcaFontVerdict(lc);
  return { lc, cls: v.pass ? 'pass' : (lc > 29.7 ? 'warn' : 'fail'),
           tier: apcaUsageTier(lc), fontText: v.text, fontTitle: v.title };
}

/** Palette mode: a Text × Background contrast matrix, one cell per pair. */
function buildContrastMatrix(texts, bgs) {
  const apca = lpAuditIsApca();
  const wrap = lpEl('div', 'lp-audit');
  wrap.appendChild(lpEl('div', 'lp-audit-head',
    'Contrast — ' + (apca ? 'APCA · |Lc| at ' + apcaFontSize + 'px/' + apcaFontWeight : 'WCAG 2 · ratio (n:1) · text × background')));
  const table = lpEl('div', 'lp-matrix');
  table.style.gridTemplateColumns = 'auto repeat(' + bgs.length + ', minmax(0, 1fr))';
  const corner = lpEl('div', 'lp-matrix-corner', 'T \\ BG');
  corner.title = 'Rows = text ranks · Columns = background ranks';
  table.appendChild(corner);
  bgs.forEach((hex, j) => {
    const c = lpEl('div', 'lp-matrix-colh', String(j + 1));
    c.title = 'Background ' + paletteRankLabel(j) + ' · ' + hexDisplay(hex);
    const sw = lpEl('span', 'lp-matrix-dot'); sw.style.background = cvdTransformHex(hex);
    c.prepend(sw);
    table.appendChild(c);
  });
  texts.forEach((thex, i) => {
    const rh = lpEl('div', 'lp-matrix-rowh', String(i + 1));
    rh.title = 'Text ' + paletteRankLabel(i) + ' · ' + hexDisplay(thex);
    const sw = lpEl('span', 'lp-matrix-dot'); sw.style.background = cvdTransformHex(thex);
    rh.prepend(sw);
    table.appendChild(rh);
    bgs.forEach(bhex => {
      let label, cls, title;
      if (apca) {
        const v = lpApcaVerdict(thex, bhex);
        label = String(Math.round(v.lc)); cls = v.cls;
        title = 'Text ' + hexDisplay(thex) + ' on ' + hexDisplay(bhex) + '\n' + v.fontText + ' · ' + v.tier;
      } else {
        const v = lpWcagVerdict(thex, bhex);
        label = v.cell; cls = v.cls;
        title = 'Text ' + hexDisplay(thex) + ' on ' + hexDisplay(bhex) + ' — ' + v.full + '\n' + v.levels;
      }
      const cell = lpEl('div', 'lp-matrix-cell lp-v-' + cls, label);
      cell.title = title;
      table.appendChild(cell);
    });
  });
  wrap.appendChild(table);
  return wrap;
}

/** Themes mode: a per-theme checklist of the semantic text pairs. */
function buildThemeChecklist(th) {
  const apca = lpAuditIsApca();
  const wrap = lpEl('div', 'lp-audit');
  wrap.appendChild(lpEl('div', 'lp-audit-head', 'Contrast — ' + (apca ? 'APCA' : 'WCAG 2')));
  // Body & muted judged on SURFACE (the harder bg of bg/surface); button label
  // on the accent fill. These are the theme's binding text-contrast constraints.
  [['Body text', th.text.hex, th.surface.hex],
   ['Muted text', th.muted.hex, th.surface.hex],
   ['Link', themeLink(th).hex, th.surface.hex],
   ['Button label', th.accentText.hex, th.accent.hex]].forEach(([label, tHex, bHex]) => {
    const row = lpEl('div', 'lp-check');
    row.appendChild(lpEl('span', 'lp-check-label', label));
    let detail, cls, title;
    if (apca) { const v = lpApcaVerdict(tHex, bHex); detail = 'Lc ' + Math.round(v.lc); cls = v.cls; title = v.tier + ' — ' + v.fontText; }
    else      { const v = lpWcagVerdict(tHex, bHex); detail = v.full; cls = v.cls; title = v.levels; }
    const val = lpEl('span', 'lp-check-val lp-v-' + cls, detail);
    val.title = title;
    row.appendChild(val);
    wrap.appendChild(row);
  });
  return wrap;
}

// ── Palette mode: a colourful mock site where every saved colour is a section
// surface / text rank, so all 10×2 palette colours appear in context. ──
function renderPaletteLayout() {
  const liveText = toHex(...selectedRgbBiased()).toLowerCase();
  const liveBg   = toHex(cR, cG, cB).toLowerCase();
  const saved = palette.length > 0;

  // Dress the SAME semantic mock the Scales preview uses, but sourced from the palette by NAME
  // so each colour lands in the role its name implies: 'body'/'text'→text, 'muted'→muted,
  // 'page'→bg, 'surface'→surface, 'border'→border, 'accent'→accent, 'on-accent'→accentText,
  // 'success'/'warning'/'danger'/'info'→their status roles. Unmatched roles fall back to the
  // first colour of that role, then the live picker pair — so a hand-pinned palette still previews.
  const wrap = hex => ({ hex, lum: relativeLuminance(...hexToRgb(hex)) });
  const byName = (role, ...names) => {
    for (const nm of names) {
      const e = palette.find(x => x.role === role && (x.name || '').toLowerCase() === nm);
      if (e) return e.hex;
    }
    return null;
  };
  const firstOf = role => { const e = palette.find(x => x.role === role); return e ? e.hex : null; };
  // Missing roles resolve WITHIN the palette; the only non-palette colour we ever allow is the
  // main picker's colour for a group that's EMPTY — an empty Text palette borrows the picker's
  // TEXT colour, an empty Background palette borrows the picker's BG colour (per the user's rule).
  // `bestFgOn` picks the most-contrasting TEXT colour already saved to sit on `overHex`, and only
  // falls back to the picker's TEXT colour when the Text palette has no entries at all.
  const lumOf = hex => relativeLuminance(...hexToRgb(hex));
  const bestFgOn = overHex => {
    let best = null, bestC = -1;
    for (const e of palette) if (e.role === 'fg') { const cc = contrastRatio(lumOf(e.hex), lumOf(overHex)); if (cc > bestC) { bestC = cc; best = e.hex; } }
    return best || liveText;
  };

  const textHex   = byName('fg', 'body', 'text') || firstOf('fg') || liveText; // empty Text → picker TEXT
  const bgHex     = byName('bg', 'page', 'bg', 'background') || firstOf('bg') || liveBg; // empty BG → picker BG
  const accentHex = byName('bg', 'accent') || firstOf('bg') || liveBg;
  const th = {
    bg:         wrap(bgHex),
    surface:    wrap(byName('bg', 'surface') || bgHex),
    border:     wrap(byName('bg', 'border') || byName('fg', 'muted') || textHex),
    text:       wrap(textHex),
    muted:      wrap(byName('fg', 'muted') || textHex),
    accent:     wrap(accentHex),
    accentText: wrap(byName('fg', 'on-accent', 'onaccent', 'accent-foreground') || bestFgOn(accentHex)),
  };
  // Optional roles — only set when the palette actually carries them, so the mock shows the
  // surface-2 panel / filled containers / hover-active chips exactly when those colours exist.
  const opt = (key, role, ...names) => { const h = byName(role, ...names); if (h) th[key] = wrap(h); };
  opt('surface2', 'bg', 'surface-raised', 'surface-2', 'surface2'); // 'surface-2' kept for older saved palettes
  opt('accentContainer', 'bg', 'accent-container');
  opt('accentContainerText', 'fg', 'on-accent-container');
  opt('accentHover', 'bg', 'accent-hover');
  opt('accentActive', 'bg', 'accent-active');
  for (const s of Object.keys(STATE_HUES)) {
    opt(s, 'fg', s);
    opt(s + 'Container', 'bg', s + '-container');
    opt(s + 'OnContainer', 'fg', 'on-' + s + '-container');
  }

  if (!saved) {
    layoutPreviewEl.appendChild(lpEl('div', 'lp-hint',
      'Showing the current picker pair. Pin colours — or save a theme from Scales — to preview your palette used by role here.'));
  }

  layoutPreviewEl.appendChild(themeViewToggle());
  layoutPreviewEl.appendChild(buildThemeView(th, saved ? '© 2026 Aurora — your palette' : '© 2026 Aurora — live pair'));

  // Coverage bar — EVERY saved colour, labelled by its NAME (or rank) + hex, so nothing the
  // palette holds is hidden even when it isn't one of the semantic roles the mock consumes.
  const texts = palette.filter(e => e.role === 'fg');
  const bgs   = palette.filter(e => e.role === 'bg');
  if (saved) {
    const pal = lpEl('div', 'lp-palette lp-palette-standalone');
    const addPal = (label, items, role) => {
      if (!items.length) return;
      const grp = lpEl('div', 'lp-pal-group');
      grp.appendChild(lpEl('div', 'lp-pal-label', label));
      const sws = lpEl('div', 'lp-pal-swatches');
      items.forEach((e, i) => {
        const sw = lpEl('span', 'lp-pal-swatch');
        sw.title = (e.name || paletteRankLabel(i)) + ' · ' + hexDisplay(e.hex);
        if (role === 'fg') { sw.textContent = 'Ag'; sw.style.color = cvdTransformHex(e.hex); }
        else { sw.classList.add('lp-pal-swatch-fill'); sw.style.background = cvdTransformHex(e.hex); }
        sws.appendChild(sw);
      });
      grp.appendChild(sws);
      pal.appendChild(grp);
    };
    addPal('Text', texts, 'fg');
    addPal('Background', bgs, 'bg');
    layoutPreviewEl.appendChild(pal);
  }

  // Contrast audit of every text × background pair.
  layoutPreviewEl.appendChild(buildContrastMatrix(
    texts.length ? texts.map(e => e.hex) : [liveText],
    bgs.length ? bgs.map(e => e.hex) : [liveBg]));
}

// ── Scales mode: preview the GENERATED scale/themes in a real layout —
// the tonal scale strip, then a mock site dressed in the light theme and the
// dark theme (semantic roles: bg / surface / border / text / muted / accent). ──
function renderThemeLayout() {
  const scale = currentScale();
  const light = deriveTheme(scale, false);
  const dark  = deriveTheme(scale, true);
  // Generator controls (source + seed) folded in from the old standalone popper.
  layoutPreviewEl.appendChild(scaleSourceToggle(renderLayoutPreview));
  layoutPreviewEl.appendChild(scaleSeedLine());
  layoutPreviewEl.appendChild(lpEl('div', 'lp-theme-name', 'Scale — click a swatch to copy'));
  const strip = lpEl('div', 'lp-theme-scale');
  scale.forEach(c => {
    const sw = lpEl('span', 'lp-theme-swatch');
    sw.style.background = cvdTransformHex(c.hex);
    sw.dataset.name = c.step + ' · ' + hexDisplay(c.hex) + ' ⧉'; // hover label: step + hex + copy cue
    sw.title = 'Click to copy ' + hexDisplay(c.hex) + ' (step ' + c.step + ')';
    sw.tabIndex = 0; sw.setAttribute('role', 'button'); sw.setAttribute('aria-label', 'Copy ' + hexDisplay(c.hex) + ' (step ' + c.step + ')');
    sw.addEventListener('click', () => copyHexSwatch(c.hex, sw));
    sw.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copyHexSwatch(c.hex, sw); } });
    strip.appendChild(sw);
  });
  layoutPreviewEl.appendChild(strip);
  // Page ⇄ Components view toggle, then each theme dressed in the chosen face.
  layoutPreviewEl.appendChild(themeViewToggle());
  layoutPreviewEl.appendChild(themedScreen('Light', light));
  layoutPreviewEl.appendChild(themedScreen('Dark',  dark));
  // Full export as GLOBAL tokens, laid out like the sidebar palette export: a
  // colour group + a file-format group on one row (equal-width segmented tabs),
  // then Copy / Download on their own row. The scale is emitted as global
  // primitives and the themes reference them (independent of the palette export).
  const exp = lpEl('div', 'sg-export');
  exp.appendChild(lpEl('div', 'sg-label', 'Export global tokens'));
  const seg = (opts, current, onPick) => {
    const g = lpEl('div', 'settings-theme-btns');
    opts.forEach(([val, txt]) => {
      const b = lpEl('button', 'settings-theme-btn' + (val === current ? ' active' : ''), txt);
      b.type = 'button';
      b.title = txt;
      b.addEventListener('click', () => { if (val !== current) onPick(val); });
      g.appendChild(b);
    });
    return g;
  };
  const tabs = lpEl('div', 'palette-export-tabs'); // file-format group first, then colour group
  tabs.append(
    seg([['css', 'CSS'], ['tailwind', 'Tailwind'], ['shadcn', 'shadcn'], ['json', 'JSON']], _scaleExportFmt,
      v => { _scaleExportFmt = v; renderLayoutPreview(); }),
    seg([['oklch', 'OKLCH'], ['hex', 'HEX']], _scaleExportColorFmt,
      v => { _scaleExportColorFmt = v; renderLayoutPreview(); }),
  );
  exp.appendChild(tabs);
  const flash = (btn, text, cls) => {
    const orig = btn.textContent; btn.textContent = text; btn.classList.add(cls);
    setTimeout(() => { btn.textContent = orig; btn.classList.remove(cls); }, 1500);
  };
  const actions = lpEl('div', 'palette-export-actions');
  const copyBtn = lpEl('button', 'palette-export-btn', 'Copy');
  copyBtn.type = 'button'; copyBtn.title = 'Copy the selected export';
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(buildScaleExport(_scaleExportFmt, _scaleExportColorFmt, scale, light, dark)); flash(copyBtn, 'Copied', 'copied'); } catch (_) { /* clipboard denied */ }
  });
  const dlBtn = lpEl('button', 'palette-export-btn', 'Download');
  dlBtn.type = 'button'; dlBtn.title = 'Download the selected export';
  dlBtn.addEventListener('click', () => { downloadScaleExport(_scaleExportFmt, _scaleExportColorFmt, scale, light, dark); flash(dlBtn, 'Saved', 'done'); });
  actions.append(copyBtn, dlBtn);
  exp.appendChild(actions);
  layoutPreviewEl.appendChild(exp);
}

// Shared semantic mock screen. Dressed in a theme's roles so every colour is shown in the
// role its NAME implies: accent carries fills, on-accent (accentText) is the label ON those
// fills, muted is secondary text, and success / warning / danger / info drive status messages.
// Used by BOTH the Scales/gradient preview (themedScreen) and the palette preview
// (renderPaletteLayout) so the two stay consistent. `th` is a role map of { hex, lum } objects;
// status roles are optional and their rows are skipped when absent.
function buildThemeMock(th, footerNote) {
  const C = hex => cvdTransformHex(hex);
  const bg = th.bg.hex, surface = th.surface.hex, border = th.border.hex,
        text = th.text.hex, muted = th.muted.hex, accent = th.accent.hex, accentFg = th.accentText.hex;
  const surface2 = th.surface2 ? th.surface2.hex : surface; // nested / elevated surface (falls back to surface)

  const screen = lpEl('div', 'lp-screen');
  screen.style.background = C(bg);
  screen.style.borderColor = C(border);
  screen.style.color = C(text); // inherited default = the theme's body text, so no element ever
                                // falls back to the stylesheet's grey (a non-palette colour)

  // Nav
  const nav = lpEl('div', 'lp-nav'); nav.style.borderBottom = '1px solid ' + C(border);
  const brandWrap = lpEl('div', 'lp-brand-wrap');
  const dot = lpEl('span', 'lp-brand-dot'); dot.style.background = C(accent);
  const brand = lpEl('span', 'lp-brand', 'Aurora'); brand.style.color = C(text);
  brandWrap.append(dot, brand);
  const navLinks = lpEl('div', 'lp-navlinks');
  ['Product', 'Docs', 'Blog'].forEach(x => { const a = lpEl('span', 'lp-navlink', x); a.style.color = C(muted); navLinks.appendChild(a); });
  const navCta = lpEl('span', 'lp-btn', 'Sign up'); navCta.style.background = C(accent); navCta.style.color = C(accentFg);
  nav.append(brandWrap, navLinks, navCta);
  screen.appendChild(nav);

  // Hero
  const hero = lpEl('div', 'lp-hero');
  const h1 = lpEl('div', 'lp-h1', 'Accessible colour, themed.'); h1.style.color = C(text);
  const sub = lpEl('div', 'lp-sub', 'One palette, light and dark — contrast guaranteed by construction.'); sub.style.color = C(muted);
  const hb = lpEl('div', 'lp-herobtns');
  const b1 = lpEl('span', 'lp-btn lp-btn-lg', 'Get started'); b1.style.background = C(accent); b1.style.color = C(accentFg);
  const b2 = lpEl('span', 'lp-btn lp-btn-lg lp-btn-ghost', 'Docs'); b2.style.color = C(text); b2.style.borderColor = C(border);
  hb.append(b1, b2);
  hero.append(h1, sub, hb);
  // Interaction states — the accent fill's default / hover / active shades, shown as a swatch
  // trio so the hover & active roles are visible (they're expressed as CSS :hover in real code).
  if (th.accentHover && th.accentActive) {
    const states = lpEl('div', 'lp-states');
    [['Default', accent], ['Hover', th.accentHover.hex], ['Active', th.accentActive.hex]].forEach(([lab, hex]) => {
      const chip = lpEl('span', 'lp-state-chip', lab); chip.style.background = C(hex); chip.style.color = C(accentFg);
      states.appendChild(chip);
    });
    hero.appendChild(states);
  }
  screen.appendChild(hero);

  // Cards (surface)
  const cards = lpEl('div', 'lp-theme-cards');
  ['Fast', 'Accessible', 'Themeable'].forEach(title => {
    const card = lpEl('div', 'lp-theme-card');
    card.style.background = C(surface); card.style.borderColor = C(border);
    const ct = lpEl('div', 'lp-theme-card-title', title); ct.style.color = C(text);
    const cb = lpEl('div', 'lp-theme-card-body', 'The quick brown fox jumps over the lazy dog.'); cb.style.color = C(muted);
    const cl = lpEl('span', 'lp-theme-card-link', 'Learn more →'); cl.style.color = C(themeLink(th).hex);
    card.append(ct, cb, cl);
    cards.appendChild(card);
  });
  screen.appendChild(cards);

  // Status section — nested on the surface-2 (elevated) panel. Each status is shown as a FILLED
  // alert using its container fill + on-container text when those roles exist (success=confirm,
  // warning=caution, danger=error, info=notice); otherwise it falls back to the status foreground
  // on the panel. Rows for roles the theme/palette doesn't carry are omitted.
  const statusRows = [
    ['success', '✓', 'Payment received — your order is confirmed.'],
    ['warning', '⚠', 'Storage is almost full — free up space soon.'],
    ['danger',  '✕', 'Your card was declined. Please try another.'],
    ['info',    'ℹ', 'A new version is available to install.'],
  ].filter(([k]) => th[k] || th[k + 'Container']);
  if (statusRows.length) {
    const alerts = lpEl('div', 'lp-alerts');
    alerts.style.background = C(surface2); alerts.style.borderColor = C(border);
    statusRows.forEach(([k, icon, msg]) => {
      const cont = th[k + 'Container'], onCont = th[k + 'OnContainer'];
      const row = lpEl('div', 'lp-alert');
      const ic = lpEl('span', 'lp-alert-icon', icon);
      if (cont && onCont) {                        // filled: container fill + on-container text
        row.classList.add('lp-alert-filled');
        row.style.background = C(cont.hex); row.style.color = C(onCont.hex);
      } else {                                     // fallback: status foreground on the panel
        row.style.color = C(th[k].hex); ic.style.color = C(th[k].hex);
      }
      row.append(ic, lpEl('span', 'lp-alert-text', msg));
      alerts.appendChild(row);
    });
    screen.appendChild(alerts);
  }

  // CTA band (accent) — on-accent label ON the accent fill
  const cta = lpEl('div', 'lp-cta'); cta.style.background = C(accent);
  const ctaT = lpEl('div', 'lp-cta-title', 'Start building today.'); ctaT.style.color = C(accentFg);
  const ctaBtn = lpEl('span', 'lp-btn lp-btn-lg', 'Get started free'); ctaBtn.style.background = C(bg); ctaBtn.style.color = C(text);
  cta.append(ctaT, ctaBtn);
  screen.appendChild(cta);

  // Footer (surface)
  const footer = lpEl('div', 'lp-footer'); footer.style.background = C(surface); footer.style.borderTop = '1px solid ' + C(border);
  const ftag = lpEl('div', 'lp-footer-tag', footerNote || '© 2026 Aurora'); ftag.style.color = C(muted);
  footer.appendChild(ftag);
  screen.appendChild(footer);

  return screen;
}

// Component gallery — the same theme roles, but shown as a systematic set of real UI components
// across default / hover / active / disabled, so the M3 roles (surfaces, accent + interaction
// states, containers, status) are all demonstrated at a glance. Every colour is inline from `th`,
// so it works for both the generated themes and a saved palette. Hover/active shades for fills
// that carry no explicit token are derived with the SAME OKLab nudge the generator uses.
function buildComponentGallery(th, footerNote) {
  const C = hex => cvdTransformHex(hex);
  const bg = th.bg.hex, surface = th.surface.hex, border = th.border.hex,
        text = th.text.hex, muted = th.muted.hex, accent = th.accent.hex, accentFg = th.accentText.hex;
  const surface2 = th.surface2 ? th.surface2.hex : surface;
  const isDark = th.bg.lum < 0.5;
  const shade = (hex, dL) => shiftLightness(hex, dL, isDark).hex; // pressed-ward OKLab nudge
  const bestOn = hex => { const l = relativeLuminance(...hexToRgb(hex)); return contrastRatio(l, 1) >= contrastRatio(l, 0) ? '#ffffff' : '#000000'; };
  const accHover  = th.accentHover  ? th.accentHover.hex  : shade(accent, 0.05);
  const accActive = th.accentActive ? th.accentActive.hex : shade(accent, 0.10);
  const accCont   = th.accentContainer ? th.accentContainer.hex : surface2;

  const screen = lpEl('div', 'lp-screen lp-gallery');
  screen.style.background = C(bg); screen.style.borderColor = C(border); screen.style.color = C(text);

  const section = title => { const s = lpEl('div', 'lp-cg-sec'); s.appendChild(lpEl('div', 'lp-cg-h', title)); return s; };
  // A filled/outlined "control" chip. o = {bg, fg, bd} (any omitted → not set).
  const chip = (label, o, cls) => {
    const n = lpEl('span', 'lp-cg-btn' + (cls ? ' ' + cls : ''), label);
    if (o.bg) n.style.background = C(o.bg);
    if (o.fg) n.style.color = C(o.fg);
    if (o.bd) { n.style.borderColor = C(o.bd); n.style.borderStyle = 'solid'; }
    return n;
  };
  const STATES = ['Default', 'Hover', 'Active', 'Disabled'];
  // One variant row: four state cells built from a base fill.
  const variantRow = (name, states) => {
    const row = lpEl('div', 'lp-cg-row');
    row.appendChild(lpEl('span', 'lp-cg-rowlabel', name));
    STATES.forEach(st => {
      const cell = lpEl('div', 'lp-cg-cell');
      cell.appendChild(chip(st, states[st] || states.Default, st === 'Disabled' ? 'lp-cg-disabled' : ''));
      row.appendChild(cell);
    });
    return row;
  };

  // ── Buttons ───────────────────────────────────────────────────────────────
  const btns = section('Buttons');
  const head = lpEl('div', 'lp-cg-row lp-cg-head');
  head.appendChild(lpEl('span', 'lp-cg-rowlabel', ''));
  STATES.forEach(s => { const h = lpEl('span', 'lp-cg-state', s); h.style.color = C(muted); head.appendChild(h); });
  btns.appendChild(head);
  const disabledCell = { bg: surface2, fg: muted, bd: border };
  btns.appendChild(variantRow('Primary', {
    Default: { bg: accent,    fg: accentFg },
    Hover:   { bg: accHover,  fg: accentFg },
    Active:  { bg: accActive, fg: accentFg },
    Disabled: disabledCell,
  }));
  btns.appendChild(variantRow('Secondary', {
    Default: { bg: surface2,          fg: text, bd: border },
    Hover:   { bg: border,            fg: text, bd: border },
    Active:  { bg: shade(border, 0.04), fg: text, bd: border },
    Disabled: disabledCell,
  }));
  if (th.danger) {
    const dng = th.danger.hex;
    btns.appendChild(variantRow('Destructive', {
      Default: { bg: dng,            fg: bestOn(dng) },
      Hover:   { bg: shade(dng, 0.05), fg: bestOn(dng) },
      Active:  { bg: shade(dng, 0.10), fg: bestOn(dng) },
      Disabled: disabledCell,
    }));
  }
  btns.appendChild(variantRow('Ghost', {
    Default: { fg: themeLink(th).hex },
    Hover:   { bg: accCont, fg: themeLink(th).hex },
    Active:  { bg: shade(accCont, 0.04), fg: themeLink(th).hex },
    Disabled: { fg: muted },
  }));
  screen.appendChild(btns);

  // ── Inputs ────────────────────────────────────────────────────────────────
  const inputs = section('Inputs');
  const inRow = lpEl('div', 'lp-cg-inputs');
  const field = (label, o) => {
    const wrap = lpEl('div', 'lp-cg-field');
    const lab = lpEl('div', 'lp-cg-flabel', label); lab.style.color = C(muted);
    const box = lpEl('div', 'lp-cg-input');
    box.style.background = C(o.bg); box.style.borderColor = C(o.bd); box.style.color = C(o.fg);
    if (o.ring) box.style.boxShadow = '0 0 0 2px ' + C(o.ring);
    box.textContent = o.text;
    wrap.append(lab, box);
    return wrap;
  };
  inRow.append(
    field('Default', { bg: bg,       bd: border, fg: muted, text: 'you@example.com' }),
    field('Focus',   { bg: bg,       bd: accent, fg: text,  text: 'you@example.com', ring: accent }),
    field('Disabled',{ bg: surface2, bd: border, fg: muted, text: 'Disabled' }),
  );
  inputs.appendChild(inRow);
  screen.appendChild(inputs);

  // ── Badges (status containers + accent) ──────────────────────────────────
  const badges = section('Badges');
  const bwrap = lpEl('div', 'lp-cg-badges');
  const badge = (label, o) => { const n = lpEl('span', 'lp-cg-badge', label); n.style.background = C(o.bg); n.style.color = C(o.fg); if (o.bd) n.style.borderColor = C(o.bd); return n; };
  bwrap.appendChild(badge('Accent', { bg: accent, fg: accentFg }));
  bwrap.appendChild(badge('Neutral', { bg: surface2, fg: muted, bd: border }));
  [['success', 'Success'], ['warning', 'Warning'], ['danger', 'Danger'], ['info', 'Info']].forEach(([k, lab]) => {
    const cont = th[k + 'Container'], on = th[k + 'OnContainer'];
    if (cont && on) bwrap.appendChild(badge(lab, { bg: cont.hex, fg: on.hex }));
  });
  badges.appendChild(bwrap);
  screen.appendChild(badges);

  // ── Table ─────────────────────────────────────────────────────────────────
  const tsec = section('Table');
  const table = lpEl('div', 'lp-cg-table'); table.style.borderColor = C(border);
  const thead = lpEl('div', 'lp-cg-tr lp-cg-thead'); thead.style.background = C(surface2); thead.style.borderColor = C(border);
  ['Name', 'Role', 'Status'].forEach(h => { const c = lpEl('span', 'lp-cg-td', h); c.style.color = C(text); thead.appendChild(c); });
  table.appendChild(thead);
  const rows = [['Mira Chen', 'Owner', 'success', 'Active'], ['Sam Ito', 'Editor', 'warning', 'Pending'], ['Lee Park', 'Viewer', 'danger', 'Blocked']];
  rows.forEach(([nm, role, k, stLab], i) => {
    const tr = lpEl('div', 'lp-cg-tr'); tr.style.background = C(i % 2 ? surface : bg); tr.style.borderColor = C(border);
    const c1 = lpEl('span', 'lp-cg-td', nm); c1.style.color = C(text);
    const c2 = lpEl('span', 'lp-cg-td', role); c2.style.color = C(muted);
    const c3 = lpEl('span', 'lp-cg-td');
    const cont = th[k + 'Container'], on = th[k + 'OnContainer'];
    if (cont && on) { const b = lpEl('span', 'lp-cg-badge', stLab); b.style.background = C(cont.hex); b.style.color = C(on.hex); c3.appendChild(b); }
    else { c3.textContent = stLab; c3.style.color = C(th[k] ? th[k].hex : text); }
    tr.append(c1, c2, c3);
    table.appendChild(tr);
  });
  tsec.appendChild(table);
  screen.appendChild(tsec);

  // ── Overlay (scrim) — a modal backdrop dimming the content, with a dialog on top ──
  if (th.scrim) {
    const osec = section('Overlay');
    const stage = lpEl('div', 'lp-cg-overlay'); stage.style.background = C(surface); stage.style.borderColor = C(border);
    // Dimmed content behind the scrim.
    const behind = lpEl('div', 'lp-cg-overlay-behind');
    behind.append(lpEl('div', 'lp-cg-obar'), lpEl('div', 'lp-cg-obar'), lpEl('div', 'lp-cg-obar'));
    [...behind.children].forEach((b, i) => { b.style.background = C(i ? muted : text); b.style.width = ['70%', '90%', '55%'][i]; });
    // The scrim: 33.33% black. Black is CVD-invariant, so an rgba from its alpha is exact.
    const scrimA = hexToRgba(th.scrim.hex)[3];
    const veil = lpEl('div', 'lp-cg-scrim'); veil.style.background = `rgba(0,0,0,${scrimA})`;
    // Dialog floating above the scrim.
    const dialog = lpEl('div', 'lp-cg-dialog'); dialog.style.background = C(bg); dialog.style.borderColor = C(border);
    const dt = lpEl('div', 'lp-cg-dtitle', 'Delete file?'); dt.style.color = C(text);
    const db = lpEl('div', 'lp-cg-dbody', 'This action can’t be undone.'); db.style.color = C(muted);
    const da = lpEl('div', 'lp-cg-dbtns');
    const cancel = lpEl('span', 'lp-cg-btn', 'Cancel'); cancel.style.background = C(surface2); cancel.style.color = C(text); cancel.style.borderColor = C(border); cancel.style.borderStyle = 'solid';
    const ok = lpEl('span', 'lp-cg-btn', 'Delete'); const dng = th.danger ? th.danger.hex : accent; ok.style.background = C(dng); ok.style.color = C(bestOn(dng));
    da.append(cancel, ok); dialog.append(dt, db, da);
    stage.append(behind, veil, dialog);
    osec.appendChild(stage);
    screen.appendChild(osec);
  }

  const footer = lpEl('div', 'lp-footer'); footer.style.background = C(surface); footer.style.borderTop = '1px solid ' + C(border);
  const ftag = lpEl('div', 'lp-footer-tag', footerNote || '© 2026 Aurora'); ftag.style.color = C(muted);
  footer.appendChild(ftag);
  screen.appendChild(footer);
  return screen;
}

function themedScreen(name, th) {
  const block = lpEl('div', 'lp-theme-block');
  const head = lpEl('div', 'lp-theme-head');
  head.appendChild(lpEl('span', 'lp-theme-name', name));
  const saveBtn = lpEl('button', 'lp-theme-save', '+ Palette');
  saveBtn.type = 'button';
  saveBtn.title = 'Save this theme’s full role set to the palette — surfaces, text, accent (+container), and the four status colours with their containers';
  saveBtn.addEventListener('click', () => {
    // Save with the semantic ROLE as each colour's name so the palette isn't a bare numbered
    // list and its export reads as --color-text-body / --color-bg-surface … (the palette groups
    // are Text=fg / Background=bg, so names are the bare role — no doubled text-/bg- prefix).
    const entries = [
      { hex: th.text.hex,                role: 'fg', name: 'body' },
      { hex: th.muted.hex,               role: 'fg', name: 'muted' },
      { hex: th.accentText.hex,          role: 'fg', name: 'on-accent' },
      { hex: th.accentContainerText.hex, role: 'fg', name: 'on-accent-container' },
      { hex: th.bg.hex,                  role: 'bg', name: 'page' },
      { hex: th.surface.hex,             role: 'bg', name: 'surface' },
      { hex: th.surface2.hex,            role: 'bg', name: 'surface-raised' },
      { hex: th.border.hex,              role: 'bg', name: 'border' },
      { hex: th.accent.hex,              role: 'bg', name: 'accent' },
      { hex: th.accentContainer.hex,     role: 'bg', name: 'accent-container' },
    ];
    // Status colours: the page foreground (success/…, Text group), its soft container fill
    // (Background) and the on-container text (Text) — so a filled alert/badge can be built from
    // the palette too. Interaction states (accent hover/active) stay export-only (they're CSS
    // :hover shades, not swatches you pick by hand).
    for (const s of Object.keys(STATE_HUES)) {
      if (th[s])                 entries.push({ hex: th[s].hex,                 role: 'fg', name: s });
      if (th[s + 'Container'])   entries.push({ hex: th[s + 'Container'].hex,   role: 'bg', name: s + '-container' });
      if (th[s + 'OnContainer']) entries.push({ hex: th[s + 'OnContainer'].hex, role: 'fg', name: 'on-' + s + '-container' });
    }
    const n = addColorsToPalette(entries);
    saveBtn.textContent = n ? 'Saved ' + n : 'Nothing new';
    setTimeout(() => { saveBtn.textContent = '+ Palette'; }, 1400);
    // On narrow (modal) widths the Layout popper covers the screen, so hand off to the sidebar:
    // close the popper and slide the palette in so the just-saved colours are visible.
    if (n && window.matchMedia('(max-width: 640px)').matches) {
      if (_closeLayoutPopper) _closeLayoutPopper();
      setPaletteOpen(true);
    }
  });
  head.appendChild(saveBtn);
  block.appendChild(head);

  const screen = buildThemeView(th, '© 2026 Aurora — ' + name.toLowerCase() + ' theme');
  block.appendChild(screen);
  block.appendChild(buildThemeChecklist(th)); // contrast audit for this theme
  return block;
}

// ─── Palette rail + contrast matrix ───────────────────────────────────────────
// Pinned colors persist in localStorage and travel in the share URL (`p`,
// governed by the "Color in share link" preference). The section is hidden
// while empty so it never affects the height-fitted layouts.

// Max colours stored per role (fg / bg). Sized to hold a whole saved theme's role set
// (surfaces + text + accent(+container) + the four status colours with containers) with room
// to spare. The first ten positions get Latin-ordinal names (primary … denary, PALETTE_RANKS);
// beyond that a plain ordinal (11, 12, …) is used, and any colour with a user name shows that.
const PALETTE_ROLE_MAX = 24;
/** @type {{hex: string, role: 'fg'|'bg'}[]} hex is lowercase '#rrggbb'; role
    records which picker the color was pinned from (fg = wheel, bg = custom)
    so re-editing reopens it in the same picker */
let palette = [];

const paletteSection = /** @type {HTMLElement} */ (document.getElementById('palette-section'));
const paletteRail    = /** @type {HTMLElement} */ (document.getElementById('palette-rail'));
const paletteToggle      = /** @type {HTMLButtonElement} */ (document.getElementById('palette-toggle'));
const paletteToggleCount = /** @type {HTMLElement} */ (document.getElementById('palette-toggle-count'));

let paletteOpen = false;
let _paletteCloseTimer = null;
let _paletteOpenTimer = null;
let _paletteInteracted = false;

function applyPaletteOpen() {
  clearTimeout(_paletteCloseTimer);
  clearTimeout(_paletteOpenTimer);
  if (paletteOpen) {
    _paletteSwipe = null;
    resetPaletteSwipeStyles();
    paletteSection.classList.remove('palette-section--closing');
    paletteSection.classList.add('palette-section--opening');
    paletteSection.hidden = false;
    syncSidebarHeight(); // measure the toolbar gap now that it's showing
    updateRailFade();    // rail now has a real height — set the correct top/bottom fade
    _paletteOpenTimer = setTimeout(() => {
      paletteSection.classList.remove('palette-section--opening');
    }, 220);
  } else if (!paletteSection.hidden) {
    paletteSection.classList.remove('palette-section--opening');
    paletteSection.classList.add('palette-section--closing');
    _paletteCloseTimer = setTimeout(() => {
      paletteSection.classList.remove('palette-section--closing');
      paletteSection.hidden = true;
    }, 220);
  }
  document.body.classList.toggle('palette-open', paletteOpen);
  paletteToggle.setAttribute('aria-expanded', String(paletteOpen));
}

function setPaletteOpen(open) {
  paletteOpen = open;
  if (open) _paletteInteracted = false; // fresh open starts as "untouched"
  applyPaletteOpen();
  saveToStorage('palette-open', open ? '1' : '0');
}

// Keep the sidebar's CONTENT clear of iOS Safari's bottom toolbar. The sidebar
// element itself spans the full fixed containing block (top:0/bottom:0 — behind
// the toolbar), because shrinking the overlay to a JS px height pinned at
// visualViewport.height made Safari re-rasterise the page tiles to that smaller
// height while the sidebar was open, clipping the page's bottom strip behind the
// toolbar. Instead, measure how far the sidebar's bottom extends past the
// visible viewport (toolbar and/or keyboard) and fold that into the bottom
// padding via --palette-vv-gap, so the export footer stays fully visible.
// visualViewport.height is the ground truth (100dvh can briefly report the
// toolbar-hidden height while the toolbar is actually shown).
// Only mutate while the sidebar is showing, and NOT on every visualViewport
// scroll tick: restyling a fixed overlay each scroll frame made iOS drop the
// paint of the content behind it (the preview tiles vanished while open).
function syncSidebarHeight() {
  if (paletteSection.hidden) return;
  const vv = window.visualViewport;
  if (!vv) return; // bottom:0 already matches the viewport on older browsers
  // rect.bottom is set by bottom:0, independent of the padding this feeds.
  const gap = Math.max(0, Math.round(paletteSection.getBoundingClientRect().bottom - (vv.offsetTop + vv.height)));
  document.documentElement.style.setProperty('--palette-vv-gap', gap + 'px');
}
window.addEventListener('resize', syncSidebarHeight);
if (window.visualViewport) window.visualViewport.addEventListener('resize', syncSidebarHeight);

// ─── Desktop fit-to-viewport scale ────────────────────────────────────────────
// On PC-width layouts the app must always fit without scrolling AND use the
// whole screen: instead of stepped max-height media queries, continuously scale
// the app (CSS zoom = window height ÷ natural content height) so every window
// size — including all the in-between ones — fits exactly. Width still flows
// naturally: the zoomed layout width is realWidth/zoom, so wide screens keep
// stretching the flexible columns. A zoom change itself reflows the layout
// (width changes → content height changes), so the ResizeObserver iterates the
// fit to its fixed point in a couple of passes; it also re-fits after content
// changes (opening the inline About, palette strips growing tiles, …).
// The fit runs as a SINGLE synchronous session per trigger: it iterates zoom to
// its fixed point in one go (each scrollHeight read forces the reflow), then
// records the outcome. The ResizeObserver only starts a new session when the
// content genuinely changed at the recorded zoom (or the window resized) — NOT
// in response to the session's own writes. Feedback-driven refits (the earlier
// design) can flicker forever at window widths where a line wrap flips the content
// height across the fit boundary; a settled session cannot.
let _fitQueued = false;
let _fitLast = { zoom: '', natural: 0, w: 0, h: 0 };

function _runFitSession() {
  _fitQueued = false;
  const el = document.getElementById('app-wrapper');
  if (!el) return;
  // Height available to the app. The Figma plugin build reserves space at the bottom for
  // its fixed action bar via --rlcw-fit-reserve; 0 on the web, so this is a no-op there.
  const _reserve = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rlcw-fit-reserve')) || 0;
  const availH = window.innerHeight - _reserve;
  if (window.innerWidth < 861 || !CSS.supports('zoom', '1')) {
    if (el.style.zoom) el.style.zoom = '';
    const ab = el.querySelector('.app-body');
    if (ab) ab.style.removeProperty('--wheel-col'); // let the mobile CSS var apply
    _fitLast = { zoom: '', natural: el.scrollHeight, w: window.innerWidth, h: window.innerHeight };
    return;
  }
  let z = parseFloat(el.style.zoom) || 1;
  const appBody = el.querySelector('.app-body');
  const colLeft = el.querySelector('.col-left');
  const colRight = el.querySelector('.col-right');
  const wheelWrap = el.querySelector('.wheel-wrap');
  // Iterate to the fixed point (a zoom change reflows the layout width, which
  // changes the content height). Each pass also sizes the wheel column in
  // layout px so the LEFT column's height matches the RIGHT column's: spare
  // width grows the wheel and sliders instead of leaving dead side space, while
  // the wheel can never inflate the page height (which previously pinned the
  // zoom to its floor on short-and-wide windows). Capped defensively; a
  // two-state wrap flip (some widths toggle a line wrap) settles on the
  // smaller, fitting zoom.
  let prevNz = 0;
  for (let i = 0; i < 10; i++) {
    if (appBody && colLeft && colRight && wheelWrap) {
      const lw = appBody.clientWidth;
      const overhead = colLeft.offsetHeight - wheelWrap.offsetHeight; // sliders/swatch/data grid
      const balance = colRight.offsetHeight - overhead; // wheel size that levels the columns
      // Level the columns by default; when the window is wide, let the wheel
      // grow past the balance point (up to +35%) — a bigger wheel and longer
      // left-column sliders beat perfectly even column bottoms there. The
      // 1.35 bound keeps the wheel from re-inflating the page height on
      // short-and-wide windows (which would pin the zoom to its floor).
      const wheel = Math.max(240, Math.min(600, 0.28 * lw,
        Math.max(balance, Math.min(0.22 * lw, 1.35 * balance))));
      appBody.style.setProperty('--wheel-col', Math.round(wheel) + 'px');
    }
    const natural = el.scrollHeight;
    if (!natural) break;
    let nz = (availH - 1) / natural; // −1: keep rounding on the no-scroll side
    // Never squeeze the layout narrower than the two-column desktop design
    // (very tall portrait windows hit this cap first — the leftover height is
    // then centered by the body flex rule); clamp the extremes (below ~0.55
    // the UI stops being usable — allow scroll there; above 3 a huge display
    // just gets a proportionally huge app).
    nz = Math.min(nz, window.innerWidth / 880);
    nz = Math.max(0.55, Math.min(3, nz));
    if (Math.abs(nz - z) < 0.002) break;
    if (Math.abs(nz - prevNz) < 0.002) { // 2-cycle wrap flip: take the fitting (smaller) state
      z = Math.min(nz, z);
      el.style.zoom = z.toFixed(4);
      break;
    }
    prevNz = z;
    z = nz;
    el.style.zoom = z.toFixed(4);
  }
  // If the landed state still spills (e.g. the iteration cap hit an alternating
  // wrap flip), shrink from the RENDERED height until it fits — this always
  // ends below the flip point. Compare real rendered px against the window
  // directly: document.scrollHeight can under-report the spill when the body
  // flex-centering clips the top edge.
  for (let i = 0; i < 4 && el.getBoundingClientRect().height > availH - 0.5; i++) {
    z = Math.max(0.55, z * (availH - 1) / el.getBoundingClientRect().height);
    el.style.zoom = z.toFixed(4);
  }
  _fitLast = { zoom: el.style.zoom, natural: el.scrollHeight, w: window.innerWidth, h: window.innerHeight };
  updatePreviewFontSizes(); // the zoom just changed → refresh the on-screen px labels
}

function fitDesktopScale() {
  if (_fitQueued) return; // coalesce bursts into one session per frame
  _fitQueued = true;
  requestAnimationFrame(_runFitSession);
}
window.addEventListener('resize', fitDesktopScale);
if (window.ResizeObserver) {
  new ResizeObserver(() => {
    const el = document.getElementById('app-wrapper');
    if (!el) return;
    // Ignore echoes of the session's own writes: same window, same zoom, and a
    // content height within the wrap-flip noise band → already settled.
    if (window.innerWidth === _fitLast.w && window.innerHeight === _fitLast.h
        && el.style.zoom === _fitLast.zoom
        && Math.abs(el.scrollHeight - _fitLast.natural) < 8) return;
    fitDesktopScale();
  }).observe(/** @type {Element} */ (document.getElementById('app-wrapper')));
}
fitDesktopScale();

// After the sidebar height re-syncs to the keyboard-shrunk viewport, keep the
// chip editor tidy in the rail (registered after syncSidebarHeight so the rail's
// new size is already applied). The keyboard's open/close animation fires a burst
// of resize events, so coalesce them and run a single smooth scroll once it
// settles: while the hex is focused, glide it into view; once the keyboard is
// dismissed, glide the editor back to its centered position.
let _ceHexScrollTimer = null;
let _ceHexReturnPending = false;
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    if (!(_ceEl && paletteRail.contains(_ceEl))) return; // only while the editor is open
    clearTimeout(_ceHexScrollTimer);
    _ceHexScrollTimer = setTimeout(() => {
      if (_ceRefs && _ceRefs.hex && document.activeElement === _ceRefs.hex) {
        scrollChipHexIntoView(true);          // keyboard open → keep the hex visible
      } else if (_ceHexReturnPending && !_ceEl.contains(document.activeElement)) {
        centerChipEditorInRail(true);         // keyboard dismissed → glide back to center
        _ceHexReturnPending = false;
      }
    }, 80);
  });
}

// Hovering the toggle opens the sidebar (mouse only — on touch, the tap's
// synthesized pointerenter would open it just before click toggled it shut).
// A click that lands while the hover-open is still active is absorbed, so
// hover-then-click out of habit doesn't immediately close the drawer.
let _paletteHoverOpened = false;
paletteToggle.addEventListener('pointerenter', e => {
  // Fine pointers only — on a coarse pointer (mobile/tablet) the sidebar opens by tap.
  if (!IS_COARSE && e.pointerType === 'mouse' && !paletteOpen) {
    setPaletteOpen(true);
    _paletteHoverOpened = true;
  }
});
paletteToggle.addEventListener('pointerleave', () => { _paletteHoverOpened = false; });
paletteToggle.addEventListener('click', () => {
  if (_paletteHoverOpened) { _paletteHoverOpened = false; return; }
  setPaletteOpen(!paletteOpen);
});
// Auto-close an untouched sidebar when the mouse leaves its area (sidebar +
// toggle): an accidental open — typically via hover — dismisses itself. Any
// interaction inside (press or scroll) marks it as intentional; from then on
// it closes only through the explicit routes (outside press, ×, toggle).
paletteSection.addEventListener('pointerdown', () => { _paletteInteracted = true; });
paletteSection.addEventListener('wheel', () => { _paletteInteracted = true; }, { passive: true });

// The sidebar is a fixed overlay: a touch-drag on it (reordering a chip, or
// just a stray move before the long-press lifts) would otherwise scroll the
// page behind it. Keep every in-sidebar touch inside the sidebar — allow only
// the rail's own scroll, and only when it actually overflows. Non-passive so
// preventDefault can cancel the page scroll.
paletteSection.addEventListener('touchmove', e => {
  if (_chipDragActive) { e.preventDefault(); return; } // lifted reorder: pin the page
  if (_paletteSwipe && _paletteSwipe.dragging) { e.preventDefault(); return; }
  const railScrolls = paletteRail.scrollHeight > paletteRail.clientHeight
    && paletteRail.contains(/** @type {Node} */ (e.target));
  if (!railScrolls) e.preventDefault();
}, { passive: false });

// Rubber-band for a short list. When the rail has nothing to scroll (few colors),
// a vertical drag is otherwise dead — the guard above just pins the page. Here we
// translate the content with sub-linear damping and spring it back on release, so
// the list always feels draggable with inertia. Real overflow (many colors) is
// left to native momentum scroll, which bounces on its own; drags from the grip
// (reorder) and horizontal drags (swipe-to-close) are handed off untouched.
let _railElastic = null;
function springRailBack() {
  if (!_railElastic) return;
  if (_railElastic.engaged) {
    const c = _railElastic.content;
    c.style.transition = 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)'; // ease-out spring
    c.style.transform = 'translateY(0)';
    // Clear the drag-time edge fade once the content has sprung back to rest.
    setTimeout(updateRailFade, 400);
  }
  _railElastic = null;
}
paletteRail.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) return;
  if (paletteRail.scrollHeight > paletteRail.clientHeight + 1) return; // native scroll owns it
  if (/** @type {HTMLElement} */ (e.target).closest('.palette-chip-grip')) return; // grip = reorder
  const content = paletteRail.querySelector('.palette-rail-content');
  if (!content) return;
  const t = e.touches[0];
  _railElastic = { x: t.clientX, y: t.clientY, content, engaged: false };
}, { passive: true });
paletteRail.addEventListener('touchmove', e => {
  if (!_railElastic) return;
  if (_chipDragActive || (_paletteSwipe && _paletteSwipe.dragging)) { springRailBack(); return; }
  const t = e.touches[0];
  const dx = t.clientX - _railElastic.x;
  const dy = t.clientY - _railElastic.y;
  if (!_railElastic.engaged) {
    if (Math.abs(dy) < 4) return;                                   // deadzone: taps pass through
    if (Math.abs(dx) > Math.abs(dy)) { _railElastic = null; return; } // horizontal → swipe-close owns it
    _railElastic.engaged = true;
  }
  const damped = Math.sign(dy) * Math.pow(Math.abs(dy), 0.82) * 0.6; // resists more the further it pulls
  _railElastic.content.style.transition = 'none';
  _railElastic.content.style.transform = 'translateY(' + damped.toFixed(1) + 'px)';
  // Dissolve the edge the content is being pulled past (down-drag clips the
  // bottom, up-drag the top), so the rubber-band doesn't hard-clip at the rail.
  const fade = railFadePx();
  setRailMask(damped < 0 ? fade : 0, damped > 0 ? fade : 0);
}, { passive: true });
paletteRail.addEventListener('touchend', springRailBack);
paletteRail.addEventListener('touchcancel', springRailBack);

// Fade a band ONLY where content is actually clipped by the rail viewport, so a
// visible chip is never dimmed. A fade means "there's more, hidden this way."
function railFadePx() {
  return parseFloat(getComputedStyle(paletteRail).getPropertyValue('--pal-fade')) || 15;
}
// smoothstep — a bezier-like S-curve (gentle at both ends) so the mask alpha eases
// in/out instead of a hard linear ramp, making the fade dissolve smoothly.
function railEase(t) { return t * t * (3 - 2 * t); }
const RAIL_EASE_STEPS = 8;
let _railMaskKey = '';
function setRailMask(topFade, botFade) {
  const key = topFade + '|' + botFade;
  if (key === _railMaskKey) return; // skip rebuilding an identical mask on every scroll tick
  _railMaskKey = key;
  const stops = [];
  if (topFade > 0) { // eased ramp 0→1 across the top band
    for (let i = 0; i <= RAIL_EASE_STEPS; i++) {
      const t = i / RAIL_EASE_STEPS;
      stops.push('rgba(0,0,0,' + railEase(t).toFixed(3) + ') ' + (t * topFade).toFixed(2) + 'px');
    }
  } else {
    stops.push('#000 0');
  }
  if (botFade > 0) { // eased ramp 1→0 across the bottom band
    for (let i = 0; i <= RAIL_EASE_STEPS; i++) {
      const t = i / RAIL_EASE_STEPS;
      stops.push('rgba(0,0,0,' + railEase(1 - t).toFixed(3) +
        ') calc(100% - ' + ((1 - t) * botFade).toFixed(2) + 'px)');
    }
  } else {
    stops.push('#000 100%');
  }
  const mask = 'linear-gradient(to bottom, ' + stops.join(', ') + ')';
  paletteRail.style.webkitMaskImage = mask;
  paletteRail.style.maskImage = mask;
}
// Scroll-position-aware fade (scroll-shadow): the top band shows only once scrolled
// down, the bottom band only while there's more below. So at the very bottom the
// bottom fade turns OFF — the last chip is fully opaque and, since native scroll
// rests stably at the bottom, you can scroll to it and stay there. When the list
// FITS (nothing hidden), there is NO fade at all — otherwise a list that nearly
// fills the rail had its last chip dimmed by the bottom band even though fully
// visible (the reported bug). Elastic drag re-adds a band via setRailMask while
// dragging so the rubber-band still dissolves at the moving edge.
function updateRailFade() {
  const fade = railFadePx();
  const top = paletteRail.scrollTop;
  const max = paletteRail.scrollHeight - paletteRail.clientHeight;
  if (max <= 1) { setRailMask(0, 0); return; } // fits: nothing hidden → no fade
  setRailMask(top > 1 ? fade : 0, top < max - 1 ? fade : 0);
}
paletteRail.addEventListener('scroll', updateRailFade, { passive: true });
window.addEventListener('resize', updateRailFade);
if (window.visualViewport) window.visualViewport.addEventListener('resize', updateRailFade);

// A rightward swipe drags the drawer with the finger. On release it closes only
// when the gesture has enough distance or velocity; otherwise it springs back.
let _paletteSwipe = null;
let _paletteSwipeTimer = null;
const _PALETTE_SWIPE_START = 10;
const _PALETTE_SWIPE_ANGLE = 1.2;
const _PALETTE_SWIPE_CLOSE_RATIO = 0.42;
const _PALETTE_SWIPE_LONG_RATIO = 0.72;
const _PALETTE_SWIPE_FAST = 0.65; // px/ms
const _PALETTE_SWIPE_FAST_MIN = 36;
const _PALETTE_SWIPE_SNAP_MS = 180;

function resetPaletteSwipeStyles() {
  clearTimeout(_paletteSwipeTimer);
  paletteSection.classList.remove('palette-section--swiping');
  paletteSection.style.transition = '';
  paletteSection.style.transform = '';
}

// After a touch gesture the toggle's :hover sticks (mobile Safari keeps the
// hovered look until you tap elsewhere), so a swipe-close that never touches
// the toggle leaves it looking active. Dropping the element out of hit-testing
// for one frame makes the browser recompute hover as false and clears it.
function clearPaletteToggleHover() {
  paletteToggle.blur();
  paletteToggle.style.pointerEvents = 'none';
  requestAnimationFrame(() => { paletteToggle.style.pointerEvents = ''; });
}

function finishPaletteSwipeClose(dx) {
  const w = Math.max(1, paletteSection.getBoundingClientRect().width);
  clearTimeout(_paletteCloseTimer);
  clearTimeout(_paletteSwipeTimer);
  paletteOpen = false;
  saveToStorage('palette-open', '0');
  document.body.classList.remove('palette-open');
  paletteToggle.setAttribute('aria-expanded', 'false');
  clearPaletteToggleHover();
  paletteSection.classList.add('palette-section--swiping');
  paletteSection.classList.remove('palette-section--closing');
  
  paletteSection.offsetHeight; // force reflow so starting transform is evaluated
  
  paletteSection.style.transition = `transform ${_PALETTE_SWIPE_SNAP_MS}ms ease`;
  paletteSection.style.transform = `translate3d(${Math.max(dx, w)}px, 0, 0)`;
  _paletteSwipeTimer = setTimeout(() => {
    resetPaletteSwipeStyles();
    paletteSection.hidden = true;
  }, _PALETTE_SWIPE_SNAP_MS);
}

function finishPaletteSwipeCancel() {
  clearTimeout(_paletteSwipeTimer);
  paletteSection.classList.add('palette-section--swiping');
  
  paletteSection.offsetHeight; // force reflow so starting transform is evaluated
  
  paletteSection.style.transition = `transform ${_PALETTE_SWIPE_SNAP_MS}ms cubic-bezier(.2, .8, .2, 1)`;
  paletteSection.style.transform = 'translate3d(0, 0, 0)';
  _paletteSwipeTimer = setTimeout(resetPaletteSwipeStyles, _PALETTE_SWIPE_SNAP_MS);
}

paletteSection.addEventListener('pointerdown', e => {
  if (!paletteOpen || e.pointerType === 'mouse' || (e.button != null && e.button !== 0)) return;
  if (_chipDragActive) return; // a chip reorder owns this gesture — never arm the swipe-to-close
  const t = /** @type {HTMLElement} */ (e.target);
  // The grip starts a reorder drag (touch-action:none); a press on it must NOT also arm the
  // swipe-to-close, or moving right both closes the palette AND steals the chip's pointer
  // capture — which cancels the drag at a bogus release point (the held color jumps to the top).
  if (t.closest('button,input,select,textarea,.chip-editor,.palette-chip-grip')) return;
  clearTimeout(_paletteSwipeTimer);
  resetPaletteSwipeStyles();
  _paletteSwipe = {
    x: e.clientX,
    y: e.clientY,
    lastX: e.clientX,
    lastT: performance.now(),
    id: e.pointerId,
    dragging: false,
    dx: 0,
    velocity: 0,
  };
}, true);
paletteSection.addEventListener('pointermove', e => {
  if (!_paletteSwipe || e.pointerId !== _paletteSwipe.id) return;
  if (_chipDragActive) { resetPaletteSwipeStyles(); _paletteSwipe = null; return; } // reorder took over
  const now = performance.now();
  const dx = e.clientX - _paletteSwipe.x;
  const dy = e.clientY - _paletteSwipe.y;
  if (!_paletteSwipe.dragging) {
    if (Math.abs(dy) > _PALETTE_SWIPE_START && Math.abs(dy) > Math.max(dx, 0) * _PALETTE_SWIPE_ANGLE) {
      _paletteSwipe = null;
      return;
    }
    if (dx <= _PALETTE_SWIPE_START || dx <= Math.abs(dy) * _PALETTE_SWIPE_ANGLE) return;
    _paletteSwipe.dragging = true;
    paletteSection.classList.add('palette-section--swiping');
    paletteSection.style.transition = 'none';
    try { paletteSection.setPointerCapture(e.pointerId); } catch (_) {}
  }
  e.preventDefault();
  const dt = Math.max(1, now - _paletteSwipe.lastT);
  _paletteSwipe.velocity = (e.clientX - _paletteSwipe.lastX) / dt;
  _paletteSwipe.lastX = e.clientX;
  _paletteSwipe.lastT = now;
  _paletteSwipe.dx = Math.max(0, dx);
  paletteSection.style.transform = `translate3d(${_paletteSwipe.dx}px, 0, 0)`;
}, true);
const _paletteSwipeEnd = e => {
  if (!_paletteSwipe || e.pointerId !== _paletteSwipe.id) return;
  const s = _paletteSwipe;
  _paletteSwipe = null;
  try { if (paletteSection.hasPointerCapture(e.pointerId)) paletteSection.releasePointerCapture(e.pointerId); } catch (_) {}
  if (!s.dragging) return;
  const w = Math.max(1, paletteSection.getBoundingClientRect().width);
  const shouldClose = s.dx > w * _PALETTE_SWIPE_LONG_RATIO
    || s.dx > w * _PALETTE_SWIPE_CLOSE_RATIO
    || (s.velocity > _PALETTE_SWIPE_FAST && s.dx > _PALETTE_SWIPE_FAST_MIN);
  if (shouldClose) {
    if (_ceIdx !== null) closeChipEditor(true);
    finishPaletteSwipeClose(s.dx);
  } else {
    finishPaletteSwipeCancel();
  }
};
paletteSection.addEventListener('pointerup', _paletteSwipeEnd, true);

// Trackpad two-finger horizontal swipe to dismiss (desktop) — the same drag-to-close feel as
// touch, driven by wheel deltaX. A rightward swipe (toward the screen edge the panel sits on)
// pushes the panel out; releasing past the distance/velocity threshold closes it, otherwise it
// springs back. No wheel "end" event exists, so a short idle timer finalizes the gesture. macOS
// natural scrolling reports a rightward two-finger move as NEGATIVE deltaX, so accumulate -deltaX.
let _paletteWheel = null;
let _paletteWheelIdle = null;
function _endPaletteWheel() {
  const s = _paletteWheel;
  _paletteWheel = null;
  clearTimeout(_paletteWheelIdle);
  _paletteWheelIdle = null;
  if (!s || !s.dragging) return;
  const w = Math.max(1, paletteSection.getBoundingClientRect().width);
  // Distance-only threshold (no velocity term): wheel events fire far denser than pointer moves,
  // so a per-event velocity is noisy and over-triggers. A trackpad flick still travels far enough
  // in distance to clear the ratio, so distance alone gives a reliable, predictable close.
  const shouldClose = s.dx > w * _PALETTE_SWIPE_CLOSE_RATIO;
  if (shouldClose) {
    if (_ceIdx !== null) closeChipEditor(true);
    finishPaletteSwipeClose(s.dx);
  } else {
    finishPaletteSwipeCancel();
  }
}
paletteSection.addEventListener('wheel', e => {
  if (!paletteOpen || _paletteSwipe) return; // pointer-drag in progress takes precedence
  const railScrolls = paletteRail.scrollHeight > paletteRail.clientHeight + 1 && paletteRail.contains(/** @type {Node} */ (e.target));
  if (!_paletteWheel) {
    // Only start on a clearly-horizontal, rightward gesture; a vertical scroll (esp. over the
    // scrollable rail) is left alone so the list still scrolls normally.
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || -e.deltaX <= 0) return;
    if (railScrolls && Math.abs(e.deltaY) > 0.5) return;
    _paletteWheel = { dx: 0, dragging: false };
  }
  const nextDx = Math.max(0, _paletteWheel.dx + (-e.deltaX));
  if (!_paletteWheel.dragging) {
    if (nextDx < _PALETTE_SWIPE_START) { _paletteWheel.dx = nextDx; return; }
    _paletteWheel.dragging = true;
    _paletteInteracted = true;
    paletteSection.classList.add('palette-section--swiping');
    paletteSection.style.transition = 'none';
  }
  e.preventDefault(); // we own the gesture now — don't let the page/rail scroll
  _paletteWheel.dx = nextDx;
  paletteSection.style.transform = `translate3d(${nextDx}px, 0, 0)`;
  clearTimeout(_paletteWheelIdle);
  _paletteWheelIdle = setTimeout(_endPaletteWheel, 110); // momentum settled → finalize
}, { passive: false });
paletteSection.addEventListener('pointercancel', e => {
  if (!_paletteSwipe || e.pointerId !== _paletteSwipe.id) return;
  const wasDragging = _paletteSwipe.dragging;
  _paletteSwipe = null;
  try { if (paletteSection.hasPointerCapture(e.pointerId)) paletteSection.releasePointerCapture(e.pointerId); } catch (_) {}
  if (wasDragging) finishPaletteSwipeCancel();
}, true);

const _paletteMaybeAutoClose = e => {
  if (e.pointerType !== 'mouse' || !paletteOpen || _paletteInteracted) return;
  const to = /** @type {Node | null} */ (e.relatedTarget);
  if (to && (paletteSection.contains(to) || paletteToggle.contains(to))) return;
  setPaletteOpen(false);
};
paletteSection.addEventListener('pointerleave', _paletteMaybeAutoClose);
paletteToggle.addEventListener('pointerleave', _paletteMaybeAutoClose);

// Pressing anywhere outside the sidebar closes it — on pointerdown, not
// click, so it reacts the moment the press starts. This also keeps in-sidebar
// deletes from closing it: by click time the removed chip's × is already
// detached by renderPalette() and would no longer count as "inside". Exempt:
// the toggle (manages itself) and the pin buttons (their click is about to
// auto-open it — closing here first would cause a close/reopen flicker).
document.addEventListener('pointerdown', e => {
  if (!paletteOpen) return;
  const t = /** @type {HTMLElement} */ (e.target);
  if (paletteSection.contains(t) || paletteToggle.contains(t)) return;
  // Pin buttons and the preview strips both open the sidebar on click, so
  // don't let this close it first (that would flicker close→open). The scale
  // import popover lives on <body> (outside the sidebar) but adding a colour
  // from it should keep the sidebar open too, so exempt it as well.
  if (t.closest && (t.closest('.pin-btn') || t.closest('.preview-palette') || t.closest('.scale-import'))) return;
  setPaletteOpen(false);
});

// Mobile: the toggle moves into the header, next to the Preferences button;
// desktop: it sits at the right end of the "vs White & Black" row. Moving the
// node keeps its listeners and count badge.
const _paletteToggleHome = paletteToggle.parentElement;
const _paletteToggleMq = window.matchMedia('(max-width: 860px)');
function placePaletteToggle() {
  if (_paletteToggleMq.matches) {
    document.querySelector('.header-right').appendChild(paletteToggle);
  } else {
    _paletteToggleHome.appendChild(paletteToggle);
  }
}
placePaletteToggle();
if (_paletteToggleMq.addEventListener) _paletteToggleMq.addEventListener('change', placePaletteToggle);
else if (_paletteToggleMq.addListener) _paletteToggleMq.addListener(placePaletteToggle);

function savePalette() { saveToStorage('palette-colors', JSON.stringify(palette)); }

// ─── Palette undo / redo ──────────────────────────────────────────────────────
// Snapshot the palette before each structural edit (add / remove / clear /
// reorder) so those edits — deletions especially — can be undone and redone.
let _palUndo = [];
let _palRedo = [];
const _PAL_HISTORY_MAX = 50;
const _clonePalette = () => palette.map(e => ({ ...e }));

function pushPaletteHistory(snapshot) {
  _palUndo.push(snapshot);
  if (_palUndo.length > _PAL_HISTORY_MAX) _palUndo.shift();
  _palRedo.length = 0;
  updatePaletteHistoryButtons();
}
function recordPaletteHistory() { pushPaletteHistory(_clonePalette()); }
function _restorePaletteSnapshot(snapshot) {
  if (_ceIdx !== null) {
    // Drop any in-progress edit (revert to its original) so closing the editor
    // doesn't record it as a separate history step during undo/redo.
    if (_ceOrigHex !== null && palette[_ceIdx]) palette[_ceIdx].hex = _ceOrigHex;
    closeChipEditor(true);
  }
  palette = snapshot.map(e => ({ ...e }));
  savePalette();
  renderPalette();
  updatePaletteHistoryButtons();
}
function undoPalette() {
  if (!_palUndo.length) return;
  _palRedo.push(_clonePalette());
  _restorePaletteSnapshot(_palUndo.pop());
}
function redoPalette() {
  if (!_palRedo.length) return;
  _palUndo.push(_clonePalette());
  _restorePaletteSnapshot(_palRedo.pop());
}
function updatePaletteHistoryButtons() {
  const u = /** @type {HTMLButtonElement} */ (document.getElementById('palette-undo'));
  const r = /** @type {HTMLButtonElement} */ (document.getElementById('palette-redo'));
  if (u) u.disabled = _palUndo.length === 0;
  if (r) r.disabled = _palRedo.length === 0;
}

function addToPalette(hex, role) {
  const commit = () => {
    hex = hex.toLowerCase();
    if (!/^#([0-9a-f]{6}|[0-9a-f]{8})$/.test(hex)) return;
    // Duplicates are allowed: some users add the colors they need first, then
    // tune them individually via the inline chip editor — so an identical color
    // can be saved again. Only the per-role cap still applies.
    if (palette.filter(e => e.role === role).length >= PALETTE_ROLE_MAX) return;
    recordPaletteHistory();
    palette.push({ hex, role });
    savePalette();
    renderPalette();
    // Pinning while the sidebar is closed opens it so the color visibly lands
    if (!paletteOpen) setPaletteOpen(true);
  };
  if (_ceIdx !== null) closeChipEditor(true, commit);
  else commit();
}

function removeFromPalette(index) {
  const commit = () => {
    recordPaletteHistory();
    palette.splice(index, 1);
    savePalette();
    renderPalette();
  };
  if (_ceIdx !== null) closeChipEditor(true, commit);
  else commit();
}

/** Duplicate the color at `index`, inserting the copy right after it (so it lands
    as the next swatch in the same role). Respects the per-role cap; one undo step. */
function duplicateInPalette(index) {
  const commit = () => {
    const src = palette[index];
    if (!src) return;
    if (palette.filter(e => e.role === src.role).length >= PALETTE_ROLE_MAX) return;
    recordPaletteHistory();
    palette.splice(index + 1, 0, { ...src }); // carry the semantic name too (export dedups collisions)
    savePalette();
    renderPalette();
  };
  if (_ceIdx !== null) closeChipEditor(true, commit);
  else commit();
}

/** Batch-add colours (e.g. a generated theme) to the palette as ONE undoable
    step: skips invalid hexes, hexes already saved in that role, and anything
    past the per-role cap. Returns how many were actually added. */
function addColorsToPalette(entries) {
  const toAdd = [];
  for (const { hex, role, name } of entries) {
    const h = String(hex).toLowerCase();
    if (!/^#([0-9a-f]{6}|[0-9a-f]{8})$/.test(h)) continue;
    const inRole = palette.filter(e => e.role === role).length + toAdd.filter(e => e.role === role).length;
    if (inRole >= PALETTE_ROLE_MAX) continue;
    const dup = palette.some(e => e.role === role && e.hex === h) || toAdd.some(e => e.role === role && e.hex === h);
    if (dup) continue;
    const entry = { hex: h, role };
    if (name && String(name).trim()) entry.name = String(name).trim().slice(0, 40); // semantic role name
    toAdd.push(entry);
  }
  if (!toAdd.length) return 0;
  recordPaletteHistory();
  palette.push(...toAdd);
  savePalette();
  renderPalette();
  if (!paletteOpen) setPaletteOpen(true);
  return toAdd.length;
}

/** Reorder palette swatches, optionally moving them across roles (fg/bg) while
    leaving other elements untouched. */
function reorderAcrossRoles(srcRole, from, dstRole, to) {
  const fgItems = palette.filter(e => e.role === 'fg');
  const bgItems = palette.filter(e => e.role === 'bg');

  if (srcRole === dstRole) {
    const items = srcRole === 'fg' ? fgItems : bgItems;
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
  } else {
    const srcItems = srcRole === 'fg' ? fgItems : bgItems;
    const dstItems = dstRole === 'fg' ? fgItems : bgItems;

    if (dstItems.length >= PALETTE_ROLE_MAX) return;

    const [moved] = srcItems.splice(from, 1);
    moved.role = dstRole;
    dstItems.splice(to, 0, moved);
  }

  palette.length = 0;
  palette.push(...fgItems, ...bgItems);
  savePalette();
}

// ─── Pointer-based reorder (iOS-home-screen style) ────────────────────────────
// Mouse: a 5px move lifts the chip. Touch: a short, slightly forgiving hold
// lifts it (a quicker vertical move stays a scroll). The lifted chip tracks the pointer
// 1:1 while siblings slide out of the way with a transform transition; on
// release it settles into its slot before the order is committed.
let _chipDragActive = false;
// Touch drags are triggered by the grip handle only (see attachChipDrag), so the
// grab engages immediately on press — no scroll-vs-drag hold delay for Android to
// cancel. Mouse still lifts after a 5px move so a click isn't read as a drag.
// Hard-reset hook for a wedged drag. A dropped pointerup (mouse released
// off-window, capture lost mid-transform) can otherwise leave a drag stuck in
// its lifted state and _chipDragActive latched true; the next press calls this
// to recover synchronously before starting fresh.
let _forceEndActiveDrag = null;

function attachChipDrag(chip, index, role, listEl) {
  // Suppress every native long-press affordance that Android would otherwise fire
  // (with a haptic + pointercancel) before our hold-to-lift engages: the context
  // menu, and the browser's native element drag-and-drop.
  chip.addEventListener('contextmenu', e => e.preventDefault());
  chip.draggable = false;
  chip.addEventListener('dragstart', e => e.preventDefault());
  chip.addEventListener('pointerdown', e => {
    // Recover any drag that never received its pointerup so it can't block this
    // press (previously the user had to click repeatedly to jog it loose).
    if (_forceEndActiveDrag) _forceEndActiveDrag();
    if (_chipDragActive || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // Buttons (edit / copy / remove) own their clicks
    if (/** @type {HTMLElement} */ (e.target).closest('button')) return;
    const isTouch = e.pointerType !== 'mouse';
    // Touch drags start ONLY from the grip handle (touch-action:none), so the
    // chip body scrolls the rail natively and Android can't hijack the press for
    // scroll/long-press and cancel the grab. Mouse still drags from anywhere.
    const onHandle = !!(/** @type {HTMLElement} */ (e.target).closest('.palette-chip-grip'));
    if (isTouch && !onHandle) return;
    const startY = e.clientY, startX = e.clientX;
    // The dragged chip's own centre at grab time; target detection tracks THIS
    // centre (start centre + drag delta), not the pointer, independent of where
    // the finger grabbed the chip.
    const chipRect0 = chip.getBoundingClientRect();
    const chipStartCenterY = chipRect0.top + chipRect0.height / 2;
    const halfChip = chipRect0.height / 2;

    // Gather boundary and chips across BOTH lists for cross-role drag-and-drop
    const fgListEl = paletteRail.querySelector('.palette-group:nth-child(1) .palette-group-list');
    const bgListEl = paletteRail.querySelector('.palette-group:nth-child(2) .palette-group-list');
    const bgGroupHead = paletteRail.querySelector('.palette-group:nth-child(2) .palette-group-head');
    // Cross-group threshold = the Background label's CENTRE axis, so switching
    // groups uses the same "leading edge crosses centre" rule as reordering
    // between chips (rather than the label's top edge).
    const bhr = bgGroupHead ? bgGroupHead.getBoundingClientRect() : null;
    const boundaryY = bhr ? bhr.top + bhr.height / 2 : 0;

    const fgChips = /** @type {HTMLElement[]} */ ([...fgListEl.querySelectorAll('.palette-chip')]);
    const bgChips = /** @type {HTMLElement[]} */ ([...bgListEl.querySelectorAll('.palette-chip')]);
    const allChips = [...fgChips, ...bgChips];

    // Cache initial mid-Y coordinates for target detection
    const chipData = [];
    const gatherChipData = (chipList, chipRole) => {
      chipList.forEach((c, idx) => {
        if (c === chip) return;
        const rect = c.getBoundingClientRect();
        chipData.push({
          el: c,
          role: chipRole,
          index: idx,
          centerY: rect.top + rect.height / 2,
        });
      });
    };
    gatherChipData(fgChips, 'fg');
    gatherChipData(bgChips, 'bg');

    const activeListEl = role === 'fg' ? fgListEl : bgListEl;
    const slot = chip.offsetHeight + (parseFloat(getComputedStyle(activeListEl).rowGap) || 0);

    let lifted = false;
    let targetRole = role;
    let targetIndex = index;
    let holdTimer = null;
    let ended = false; // guards against a second end event (up + lostcapture)

    const blockScroll = ev => ev.preventDefault();

    const lift = () => {
      lifted = true;
      _chipDragActive = true;
      if (_ceIdx !== null) closeChipEditor(true); // don't drag with an editor open
      try { chip.setPointerCapture(e.pointerId); } catch (_) {}
      chip.classList.add('palette-chip--lifted');
      // No scale on lift: scaling re-rasterizes the layer and iOS/WebKit then drops the
      // border-radius clip, squaring off the chip's corners. The chip is picked up as-is
      // (raised only by its shadow); a pure translateY during the drag just repositions the
      // already-rasterized layer, so the rounded corners survive.
      // Unclip the sidebar so the chip stays visible outside the rail
      paletteSection.classList.add('palette-section--dragging');
      document.addEventListener('touchmove', blockScroll, { passive: false });
    };

    // End listeners live on window (not the chip) so a pointerup that lands
    // off the chip — or after pointer capture is lost — still ends the drag.
    const removeListeners = () => {
      clearTimeout(holdTimer);
      document.removeEventListener('touchmove', blockScroll);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      chip.removeEventListener('lostpointercapture', onCancel);
      try { if (chip.hasPointerCapture(e.pointerId)) chip.releasePointerCapture(e.pointerId); } catch (_) {}
    };

    // Synchronous teardown used when a stale drag is recovered by a fresh press.
    // Clears the global lock and every chip's inline transform immediately
    // (renderPalette can't run here: it would detach the chip the new
    // pointerdown is firing on).
    const forceEnd = () => {
      if (ended) return;
      ended = true;
      removeListeners();
      _forceEndActiveDrag = null;
      _chipDragActive = false;
      paletteSection.classList.remove('palette-section--dragging');
      allChips.forEach(c => {
        c.classList.remove('palette-chip--lifted', 'palette-chip--settling');
        c.style.transform = '';
      });
      if (bgGroupHead) bgGroupHead.style.transform = '';
    };

    const determineTarget = (clientY) => {
      // The dragged chip's current centre (start centre + drag distance).
      const refY = chipStartCenterY + (clientY - startY);
      // Ordering flips when the dragged chip's LEADING edge — its front in the
      // drag direction (bottom edge moving down, top edge moving up) — crosses a
      // neighbour's centre axis. That's half a chip earlier than centre-to-centre
      // and behaves identically in both directions. `lead` is the leading edge.
      const dir = Math.sign(clientY - startY) || 1;
      const lead = refY + dir * halfChip;
      // Same leading-edge rule for the group boundary: cross into the other group
      // when the leading edge passes the Background label's centre axis.
      let tr = lead < boundaryY ? 'fg' : 'bg';

      // Limit check: do not allow dragging into a group that is already full
      if (tr !== role) {
        const targetCount = tr === 'fg' ? fgChips.length : bgChips.length;
        if (targetCount >= PALETTE_ROLE_MAX) {
          tr = role; // Lock to original role
        }
      }

      const targetRoleChips = chipData.filter(d => d.role === tr);
      let ti = targetRoleChips.length; // Default to end of target list
      for (let i = 0; i < targetRoleChips.length; i++) {
        if (lead < targetRoleChips[i].centerY) {
          ti = i;
          break;
        }
      }
      return { tr, ti };
    };

    const applyVisualShift = (tr, ti) => {
      targetRole = tr;
      targetIndex = ti;
      const cross = tr !== role;

      // Treat the two lists plus the Background header as one continuous column
      // (fg chips → BG head → bg chips) so a cross-group move opens a single,
      // clean insertion gap and the header slides with it — instead of leaving
      // a stray gap above a pinned "BACKGROUND" label.
      chipData.forEach(d => {
        let shift = 0;
        if (!cross) {
          // Reorder within the same group
          if (d.role === role) {
            if (index < ti && d.index > index && d.index <= ti) shift = -slot;
            else if (index > ti && d.index >= ti && d.index < index) shift = slot;
          }
        } else if (role === 'fg') {
          // fg → bg: everything below the source and above the insertion point
          // (the trailing fg chips, and the bg chips before ti) slides up.
          if (d.role === 'fg' && d.index > index) shift = -slot;
          else if (d.role === 'bg' && d.index < ti) shift = -slot;
        } else {
          // bg → fg: everything from the insertion point down to the source
          // (the fg chips at/after ti, and the bg chips before the source) slides down.
          if (d.role === 'fg' && d.index >= ti) shift = slot;
          else if (d.role === 'bg' && d.index < index) shift = slot;
        }
        d.el.style.transform = shift ? `translateY(${shift}px)` : '';
      });

      // The Background header sits between the lists, so it moves with a
      // cross-group drag: up when a Text color leaves for Background (Text
      // shrinks), down when a Background color moves up to Text (Text grows).
      const headShift = cross ? (role === 'fg' ? -slot : slot) : 0;
      if (bgGroupHead) bgGroupHead.style.transform = headShift ? `translateY(${headShift}px)` : '';
    };

    const onMove = ev => {
      const rawDy = ev.clientY - startY;
      if (!lifted) {
        // Only mouse reaches here un-lifted (touch lifts immediately from the
        // grip); a 5px move confirms an intentional drag over a click.
        if (Math.hypot(ev.clientX - startX, rawDy) <= 5) return;
        lift();
      }
      // Free movement — only the insertion target is clamped to the list span
      chip.style.transform = `translateY(${rawDy}px)`;
      const { tr, ti } = determineTarget(ev.clientY);
      applyVisualShift(tr, ti);
    };

    // Commit on release in a single tick: reorder the data, re-render, and drop
    // the drag lock together.
    const settle = commit => {
      if (ended) return;
      ended = true;
      removeListeners();
      _forceEndActiveDrag = null;
      _chipDragActive = false;
      paletteSection.classList.remove('palette-section--dragging');
      if (!lifted) return;
      if (commit && (targetRole !== role || targetIndex !== index)) {
        recordPaletteHistory();
        reorderAcrossRoles(role, index, targetRole, targetIndex);
      }
      renderPalette(); // rebuild resets every chip's inline transform + rank labels
    };

    // Snap the target to the release point. A fast flick can reach pointerup
    // before its final pointermove arrives (targetIndex left stale near the
    // start), or outrun the 5px lift threshold entirely — so recompute from the
    // release Y and, for mouse, treat a past-threshold release as a lift so the
    // reorder still commits instead of springing back.
    const onUp = ev => {
      const y = ev && typeof ev.clientY === 'number' ? ev.clientY : startY;
      if (!lifted && !isTouch && Math.abs(y - startY) > 5) lift();
      if (lifted) {
        const { tr, ti } = determineTarget(y);
        targetRole = tr;
        targetIndex = ti;
      }
      settle(true);
    };
    // iOS Safari fires pointercancel (and drops pointer capture) during
    // legitimate touch drags — its scroll/gesture recognizer competes with our
    // grip drag, most often when dragging DOWNWARD (Text→Background) along the
    // rail's scroll axis. Treat a canceled *lifted* drag like a normal release:
    // commit to the last previewed target instead of springing back, so a
    // deliberate cross-group move isn't silently lost. (settle() is guarded by
    // `ended`, so a follow-up pointerup can't double-commit.)
    const onCancel = ev => {
      // If a palette swipe-close is in progress, this cancel is capture theft, not an
      // iOS scroll gesture — the release point is bogus (often clientY≈0, which would
      // reorder the held chip to the top). Revert instead of committing.
      if (_paletteSwipe && _paletteSwipe.dragging) { settle(false); return; }
      if (lifted) { onUp(ev); return; }
      settle(false);
    };

    _forceEndActiveDrag = forceEnd;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    chip.addEventListener('lostpointercapture', onCancel);
    // Touch reaches here only via the grip → grab immediately (an explicit handle
    // needs no scroll-vs-drag hold; that delay is what Android was cancelling).
    if (isTouch) lift();
  });
}

/** Rank name by position within a role group: 0 → Primary … 9 → Denary (the
    PALETTE_ROLE_MAX cap), then the plain ordinal. Shared by the sidebar badges
    and the export. */
const PALETTE_RANKS = ['Primary', 'Secondary', 'Tertiary', 'Quaternary', 'Quinary', 'Senary', 'Septenary', 'Octonary', 'Nonary', 'Denary'];
function paletteRankLabel(pos) {
  return PALETTE_RANKS[pos] || String(pos + 1);
}

// Icons for the palette chips / group headers
const PENCIL_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125"/></svg>';
// Eyedropper — "load this saved colour into the matching main picker".
const RECALL_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 11.25 1.5 21H0v-1.5L9.75 6M15 11.25l3.75-3.75a2.121 2.121 0 0 0-3-3L12 8.25M15 11.25 12 8.25"/></svg>';
const PLUS_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg>';
// Two stacked squares (a copy peeking behind) + a plus: "duplicate this color".
const DUPLICATE_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2"/><path d="M14.5 12.5v4M12.5 14.5h4"/></svg>';
// Six-dot grip for the chip's drag handle (touch-action:none, so Android can't
// hijack the press for scroll/long-press before the grab engages).
const GRIP_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>';
// A painter's palette: the kidney-shaped board with a thumb hole and paint dabs.
const IMPORT_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3c-4.97 0-9 3.58-9 8 0 2.9 2.35 4.7 4.7 4.7.95 0 1.55.62 1.55 1.55 0 1.24 1.03 2.45 2.75 2.45 4.83 0 8.5-3.75 8.5-8.65C20.5 6.35 16.7 3 12 3Z"/><circle cx="7.6" cy="10.2" r="1.05" fill="currentColor" stroke="none"/><circle cx="11" cy="7.4" r="1.05" fill="currentColor" stroke="none"/><circle cx="14.8" cy="7.7" r="1.05" fill="currentColor" stroke="none"/><circle cx="17" cy="10.9" r="1.05" fill="currentColor" stroke="none"/></svg>';

// ── Import a colour from the generated Scales into a palette role ─────
let _scaleImportEl = null;
function closeScaleImport() {
  if (_scaleImportEl) { _scaleImportEl.remove(); _scaleImportEl = null; }
  document.removeEventListener('pointerdown', _scaleImportOutside, true);
  document.removeEventListener('keydown', _scaleImportKey, true);
}
function _scaleImportOutside(e) {
  const t = /** @type {HTMLElement} */ (e.target);
  if (_scaleImportEl && !_scaleImportEl.contains(t) && !(t.closest && t.closest('.palette-group-import'))) closeScaleImport();
}
function _scaleImportKey(e) { if (e.key === 'Escape') closeScaleImport(); }

function openScaleImport(role, anchor) {
  const sameRole = _scaleImportEl && _scaleImportEl.dataset.role === role;
  closeScaleImport();
  if (sameRole) return; // clicking the same group's import again closes it

  const scale = currentScale();

  const pop = document.createElement('div');
  pop.className = 'scale-import';
  pop.dataset.role = role;
  pop.appendChild(lpEl('div', 'scale-import-title', 'Import → ' + (role === 'fg' ? 'Text' : 'Background')));

  const roomLeft = () => PALETTE_ROLE_MAX - palette.filter(e => e.role === role).length;
  const status = lpEl('div', 'scale-import-status', '');
  const refresh = () => {
    const n = roomLeft();
    status.textContent = n > 0 ? n + ' slot' + (n === 1 ? '' : 's') + ' left' : 'This role is full';
    pop.classList.toggle('full', n <= 0);
  };
  const makeSwatch = (hex, label) => {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'scale-import-sw';
    sw.style.background = cvdTransformHex(hex);
    sw.dataset.name = (label ? label + ' · ' : '') + hexDisplay(hex); // instant hover label (CSS)
    sw.title = sw.dataset.name;
    sw.addEventListener('click', () => {
      if (roomLeft() <= 0) return;
      const added = addColorsToPalette([{ hex, role }]); // dedup + cap + one undo step
      sw.classList.add(added ? 'ok' : 'dup');
      setTimeout(() => sw.classList.remove('ok', 'dup'), 650);
      refresh();
    });
    return sw;
  };
  const addRow = (label, items) => {
    pop.appendChild(lpEl('div', 'scale-import-label', label));
    const row = lpEl('div', 'scale-import-row');
    items.forEach(([hex, lab]) => row.appendChild(makeSwatch(hex, lab)));
    pop.appendChild(row);
  };
  addRow('Scale', scale.map(c => [c.hex, String(c.step)]));
  [['Light', deriveTheme(scale, false)], ['Dark', deriveTheme(scale, true)]].forEach(([name, th]) => {
    addRow(name + ' theme', [['bg', th.bg], ['surface', th.surface], ['border', th.border],
      ['text', th.text], ['muted', th.muted], ['accent', th.accent]].map(([rn, e]) => [e.hex, name + ' ' + rn]));
  });
  pop.appendChild(status);
  refresh();

  // Fixed to the viewport so renderPalette() (which clears the rail on every
  // import) can't destroy it; aligned under the anchor's right edge.
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = (r.bottom + 4) + 'px';
  pop.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  _scaleImportEl = pop;
  document.addEventListener('pointerdown', _scaleImportOutside, true);
  document.addEventListener('keydown', _scaleImportKey, true);
}

// ─── Inline palette-chip editor ───────────────────────────────────────────────
// Re-editing a saved swatch happens in place, inside the sidebar: the edit
// button expands an editor under the chip with RGB / HSL / Lum / Gray modes, a
// mini wheel, and a live contrast preview against one swappable opposite-role
// color. Self-contained — it uses only the pure color helpers and never touches
// the main picker globals or the contrast lock.
const _chipEditorTpl = /** @type {HTMLTemplateElement} */ (document.getElementById('chip-editor-tpl'));
let _ceEl = null;      // the single cloned editor element (reused across chips)
let _ceRefs = null;    // cached inner element references
let _ceIdx = null;     // flat palette index being edited, or null
let _ceOrigHex = null; // original hex color before editing
let _ceOrigName;       // original name before editing (undefined = was unnamed); restored on cancel

// Position of a palette entry within its role group (0 = primary, 1 = secondary…). Drives the
// default label a color falls back to when it has no user-set name.
function paletteRankPosOf(idx) {
  const role = palette[idx] && palette[idx].role;
  let pos = 0;
  for (let i = 0; i < idx; i++) if (palette[i] && palette[i].role === role) pos++;
  return pos;
}
let _ce = null;        // working state { role, r, g, b, mode, hsl, lum, gray }
let _cePartner = 0;    // partner-color cycle index
let _ceRaf = 0;        // rAF gate for wheel + preview repaint
let _ceWheelCache = null;
let _ceCloseTimer = null;

// Display size (CSS px) the chip-editor wheel is drawn/measured against. The
// CSS caps the wheel at this width; the canvas buffer and marker scale off it.
const CE_WHEEL_SIZE = 200;

const _ceClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function chipEditorActiveIdx() { return _ceIdx; }

function buildChipEditor() {
  _ceEl = /** @type {HTMLElement} */ (_chipEditorTpl.content.firstElementChild.cloneNode(true));
  applyCvdChannelLetters(_ceEl); // fresh clone: simulate its R/G/B letters too
  _ceEl.querySelectorAll('input[type="range"]').forEach(_labelSlider); // label the cloned sliders (they're off-DOM at page load)
  const q = sel => _ceEl.querySelector(sel);
  _ceRefs = {
    tabs:   [..._ceEl.querySelectorAll('[data-emode]')],
    groups: [..._ceEl.querySelectorAll('[data-egroup]')],
    wheel:  q('.chip-editor-wheel'),
    hex:    q('.chip-editor-hex'),
    hexCopy: q('.chip-editor-hex-copy'),
    name:   q('.chip-editor-name'),
    nameReset: q('.chip-editor-name-reset'),
    tile:   q('.chip-editor-tile'),
    ag:     q('.chip-editor-ag'),
    agSize: q('.chip-editor-ag-size'),
    tileLabel: q('.chip-editor-tile-label'),
    cmpBtn: q('.chip-editor-cmp-btn'),
    dropdown: q('.chip-editor-dropdown'),
    cmpRole: q('.chip-editor-cmp-role'),
    ratio:  q('.chip-editor-cmp-ratio'),
    badges: q('.chip-editor-badges'),
    apcaTier: q('.chip-editor-apca-tier'),
    apcaFont: q('.chip-editor-apca-font'),
    cancel: q('.chip-editor-cancel'),
    done:   q('.chip-editor-done'),
    ranges: {}, vals: {},
  };
  _ceEl.querySelectorAll('[data-ch]').forEach(inp => { _ceRefs.ranges[inp.dataset.ch] = inp; });
  _ceEl.querySelectorAll('[data-chv]').forEach(inp => { _ceRefs.vals[inp.dataset.chv] = inp; });
  // Alpha is a per-mode row (Lum shows it 2nd, other modes last); all share _ce.alpha.
  _ceRefs.alphaRanges = [..._ceEl.querySelectorAll('.ce-alpha-range')];
  _ceRefs.alphaVals   = [..._ceEl.querySelectorAll('.ce-alpha-val')];
  const onAlpha = a => {
    _ce.alpha = Math.max(0, Math.min(1, a));
    chipEditorWriteThrough(); syncChipEditorAlpha(); syncChipEditorHex(); scheduleChipEditorPaint();
  };
  _ceRefs.alphaRanges.forEach(r => { r.addEventListener('input', () => onAlpha(+r.value / 100)); addSliderTouchFix(r); });
  _ceRefs.alphaVals.forEach(v => {
    v.addEventListener('change', () => { const n = parseFloat(String(v.value).replace(/[^0-9.\-]/g, '')); onAlpha((Number.isFinite(n) ? n : 100) / 100); });
    v.addEventListener('focus', () => v.select());
    v.addEventListener('keydown', e => { if (e.key === 'Enter') v.blur(); });
  });
  // Render above the display size for a smooth downsample, but cap the buffer:
  // Lum mode rebuilds the whole wheel (per-pixel lightness search) whenever the
  // target luminance changes, so an unbounded high-DPI buffer would make the Lum
  // slider drag janky. 300px keeps that cost near the old 132px wheel's while the
  // wheel now displays much larger.
  const wdpr = Math.min(window.devicePixelRatio || 1, 2);
  const buf = Math.min(Math.round(CE_WHEEL_SIZE * wdpr), 300);
  _ceRefs.wheel.width = _ceRefs.wheel.height = buf;
  _ceRefs.ctx = _ceRefs.wheel.getContext('2d');

  // Keep chip drag / outside-close from firing on editor interactions
  _ceEl.addEventListener('pointerdown', e => e.stopPropagation());
  _ceEl.addEventListener('click', e => e.stopPropagation());
  _ceEl.addEventListener('wheel', e => e.stopPropagation());

  _ceRefs.tabs.forEach(t => t.addEventListener('click', () => setChipEditorMode(t.dataset.emode)));
  Object.values(_ceRefs.ranges).forEach(inp => {
    inp.addEventListener('input', onChipEditorSlider);
    addSliderTouchFix(inp); // cloned after the initial pass, so wire touch dragging here
  });
  // Value inputs behave like the main picker's: select-all on focus (paste/copy),
  // Arrow Up/Down nudge by one unit (Shift = 10× the min unit), Enter commits.
  Object.values(_ceRefs.vals).forEach(inp => {
    inp.addEventListener('change', onChipEditorValInput);
    inp.addEventListener('focus', () => inp.select());
    inp.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        chipEditorValStep(inp, (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
      } else if (e.key === 'Enter') {
        inp.blur();
      }
    });
  });
  _ceRefs.cancel.addEventListener('click', () => cancelChipEditor());
  _ceRefs.done.addEventListener('click', () => closeChipEditor());
  // Match the main TEXT hex field exactly: typing live-applies to the wheel/preview and keeps
  // the shorthand you typed (syncChipEditorHex is guarded on activeElement, so it won't reformat
  // mid-keystroke); Enter/blur expand "000"/"fff" to full hex (or revert an invalid value).
  _ceRefs.hex.addEventListener('input', () => {
    _ceRefs.hex.value = sanitizeHexField(_ceRefs.hex.value, 8);
    const full = normalizeHexInput(_ceRefs.hex.value); // accepts 3/4/6/8-digit shorthand
    if (full) { const [r, g, b, a] = hexToRgba(full); _ce.alpha = a; chipEditorSetRgb(r, g, b); syncChipEditorAlpha(); }
  });
  // Focusing/tapping selects all; the icon copies. Also keep the field visible in the rail —
  // the mobile keyboard shrinks the viewport after focus, so scroll now and once it settles.
  _ceRefs.hex.addEventListener('focus', () => { _ceRefs.hex.select(); scrollChipHexIntoView(); });
  _ceRefs.hex.addEventListener('click', () => _ceRefs.hex.select());
  _ceRefs.hex.addEventListener('keydown', e => { if (e.key === 'Enter') _ceRefs.hex.blur(); });
  // Commit on blur: expand shorthand / revert invalid to the current colour, then arm the smooth
  // "return" so the editor glides back to centre when the mobile keyboard is dismissed.
  _ceRefs.hex.addEventListener('blur', () => {
    _ceRefs.hex.value = formatHex(toHexA(_ce.r, _ce.g, _ce.b, _ce.alpha ?? 1));
    fitHexField(_ceRefs.hex);
    _ceHexReturnPending = true;
  });
  _ceRefs.hexCopy.addEventListener('click', () => {
    copyToClipboard(formatHex(toHexA(_ce.r, _ce.g, _ce.b, _ce.alpha ?? 1)));
    // Flash the copy icon only (✓) — not the whole field — matching the main picker's hex copy.
    _ceRefs.hexCopy.classList.add('hex-copied');
    setTimeout(() => _ceRefs.hexCopy.classList.remove('hex-copied'), 1500);
  });
  // Optional semantic name. The field ALWAYS shows the color's current effective name — the
  // user-set name, or (unnamed) the default position label (Primary / Secondary…). Typing sets
  // the name; clearing it, or matching the position label, falls back to the default (no name
  // stored). The ↺ reset restores the default; Cancel reverts to the pre-edit name. Stored
  // straight on the entry and persisted; the rail isn't re-rendered mid-edit (that would detach
  // the open editor), so the chip's shown name refreshes on close.
  if (_ceRefs.name) {
    const defaultLabel = () => paletteRankLabel(paletteRankPosOf(_ceIdx));
    const commitName = () => {
      if (_ceIdx === null || !palette[_ceIdx]) return;
      const v = _ceRefs.name.value.trim().slice(0, 40);
      if (!v || v.toLowerCase() === defaultLabel().toLowerCase()) delete palette[_ceIdx].name;
      else palette[_ceIdx].name = v;
      savePalette();
    };
    _ceRefs.name.addEventListener('input', commitName);
    _ceRefs.name.addEventListener('focus', () => { _ceRefs.name.select(); scrollChipHexIntoView(); });
    _ceRefs.name.addEventListener('keydown', e => { if (e.key === 'Enter') _ceRefs.name.blur(); });
    // Leaving the field empty reverts the display to the default label (name already cleared).
    _ceRefs.name.addEventListener('blur', () => { if (!_ceRefs.name.value.trim()) _ceRefs.name.value = defaultLabel(); });
    if (_ceRefs.nameReset) {
      // Reset to the default label WITHOUT focusing the field — mirrors the hex copy icon, which
      // doesn't move focus to the hex input. (Pressing the button then focusing would fire the
      // field's focus→select, selecting all the text, which felt like an accidental edit.)
      _ceRefs.nameReset.addEventListener('mousedown', e => e.preventDefault()); // don't focus on press
      _ceRefs.nameReset.addEventListener('click', () => {
        if (_ceIdx === null || !palette[_ceIdx]) return;
        delete palette[_ceIdx].name;
        savePalette();
        _ceRefs.name.value = defaultLabel();
      });
    }
  }
  // The compare-color dropdown opens on CLICK/TAP only (the whole label+caret
  // button toggles it); clicking again or outside closes it. No hover-open, so
  // it behaves the same on mouse and touch and never appears unintentionally.
  _ceRefs.cmpBtn.addEventListener('click', toggleChipEditorDropdown);
  _ceRefs.cmpBtn.setAttribute('aria-haspopup', 'listbox');
  attachChipEditorWheel();
}

// ── Compare-color dropdown (single-select) ────────────────────────────────────
function toggleChipEditorDropdown() {
  if (_ceRefs.dropdown.hidden) openChipEditorDropdown();
  else closeChipEditorDropdown();
}

function buildChipEditorDropdown() {
  const dd = _ceRefs.dropdown;
  dd.innerHTML = '';
  // The rounded shell stays put; this inner element is what scrolls (avoids the
  // transparent-corner flash a rounded overflow:auto box shows on fast scroll).
  const scroll = document.createElement('div');
  scroll.className = 'chip-editor-dd-scroll';
  scroll.setAttribute('role', 'listbox');
  scroll.setAttribute('aria-label', 'Comparison color');
  dd.appendChild(scroll);
  const list = partnerList();
  if (!list.length) {
    const info = document.createElement('div');
    info.className = 'chip-editor-dd-item';
    info.setAttribute('disabled', '');
    info.textContent = `No saved ${chipEditorOppRole() === 'fg' ? 'text' : 'background'} colors`;
    scroll.appendChild(info);
    return;
  }
  const roleLabel = chipEditorOppRole() === 'fg' ? 'TEXT' : 'BG';
  list.forEach((hex, i) => {
    const it = document.createElement('button');
    it.type = 'button';
    it.className = 'chip-editor-dd-item';
    it.id = `chip-editor-dd-opt-${i}`;
    it.setAttribute('role', 'option');
    it.setAttribute('aria-selected', String(i === _cePartner));
    // Role type (TEXT / BG) leads, then the rank name; hex is a muted suffix.
    const rl = document.createElement('span'); rl.className = 'chip-editor-dd-role'; rl.textContent = roleLabel;
    const sw = document.createElement('span'); sw.className = 'chip-editor-dd-swatch'; sw.style.background = cvdTransformHex(hex);
    const nm = document.createElement('span'); nm.className = 'chip-editor-dd-name'; nm.textContent = paletteRankLabel(i);
    const hx = document.createElement('span'); hx.className = 'chip-editor-dd-hex'; hx.textContent = formatHex(hex);
    // Always append the check slot (fixed width via CSS) so the hex and other
    // columns sit at the same x on every row — only the selected row shows the ✓.
    const ck = document.createElement('span'); ck.className = 'chip-editor-dd-check'; ck.textContent = i === _cePartner ? '✓' : '';
    it.append(rl, sw, nm, hx, ck);
    it.addEventListener('click', () => { _cePartner = i; chipEditorRenderPreview(); closeChipEditorDropdown(); });
    scroll.appendChild(it);
  });
}

function openChipEditorDropdown() {
  buildChipEditorDropdown();
  _ceRefs.dropdown.hidden = false;
  _ceRefs.cmpBtn.setAttribute('aria-expanded', 'true');
  // capture phase so the editor's own stopPropagation doesn't hide these clicks
  document.addEventListener('pointerdown', _ceDropdownOutside, true);
  _ceRefs.dropdown.addEventListener('keydown', _ceDropdownKey);
  // Move focus into the list (the selected option, else the first) so the
  // arrow keys drive it immediately — a proper listbox, not a mouse-only menu.
  const sel = _ceRefs.dropdown.querySelector('.chip-editor-dd-item[aria-selected="true"]')
           || _ceRefs.dropdown.querySelector('.chip-editor-dd-item:not([disabled])');
  if (sel) sel.focus();
}

function closeChipEditorDropdown() {
  if (!_ceRefs || _ceRefs.dropdown.hidden) return;
  _ceRefs.dropdown.hidden = true;
  _ceRefs.cmpBtn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', _ceDropdownOutside, true);
  _ceRefs.dropdown.removeEventListener('keydown', _ceDropdownKey);
}

function _ceDropdownOutside(e) {
  const t = e.target;
  if (!_ceRefs.dropdown.contains(t) && !_ceRefs.cmpBtn.contains(t)) closeChipEditorDropdown();
}

// Arrow-key roving focus for the compare-color listbox. The options are real
// <button>s, so Enter/Space already select via their click handler — this adds
// Up/Down/Home/End movement and Escape-to-close (returning focus to the trigger).
function _ceDropdownKey(e) {
  const items = [..._ceRefs.dropdown.querySelectorAll('.chip-editor-dd-item:not([disabled])')];
  if (!items.length) return;
  const cur = items.indexOf(/** @type {Element} */ (document.activeElement));
  if (e.key === 'ArrowDown')      { e.preventDefault(); items[(cur + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp')   { e.preventDefault(); items[(cur - 1 + items.length) % items.length].focus(); }
  else if (e.key === 'Home')      { e.preventDefault(); items[0].focus(); }
  else if (e.key === 'End')       { e.preventDefault(); items[items.length - 1].focus(); }
  else if (e.key === 'Escape')    { e.preventDefault(); closeChipEditorDropdown(); _ceRefs.cmpBtn.focus(); }
}

function reseedSubstates() {
  const { r, g, b } = _ce;
  const [h, s, l] = rgbToHsl(r, g, b);
  _ce.hsl  = [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
  _ce.lum  = [Math.round(wheelLum(r, g, b) * 1000), Math.round(s * 100), Math.round(h)];
  _ce.gray = Math.round((r + g + b) / 3);
}

function applyChipEditorMode(mode) {
  _ce.mode = mode;
  _ceRefs.tabs.forEach(t => t.classList.toggle('active', t.dataset.emode === mode));
  _ceRefs.groups.forEach(gr => gr.classList.toggle('active', gr.dataset.egroup === mode));
  _ceRefs.wheel.hidden = (mode === 'gray');
}

function setChipEditorMode(mode) {
  const prev = _ce.mode;
  if (mode === prev) return;

  // RGB / HSL / LUM share one live colour; Gray is independent (matches the main
  // BG picker). Switching among the three colour modes just re-derives the
  // substates from the shared colour.
  if (mode !== 'gray' && prev !== 'gray') {
    reseedSubstates();
    applyChipEditorMode(mode);
    _ceWheelCache = null;
    syncChipEditorControls();
    return;
  }

  // Crossing the Gray boundary: stash the outgoing side's value and restore the
  // incoming side's — so Gray keeps its own level and the colour modes keep
  // their colour independently.
  if (prev === 'gray') {
    _ce.savedGray = _ce.gray;
    _ce.r = _ce.savedColor.r; _ce.g = _ce.savedColor.g; _ce.b = _ce.savedColor.b;
  } else {
    _ce.savedColor = { r: _ce.r, g: _ce.g, b: _ce.b };
    _ce.r = _ce.g = _ce.b = _ce.savedGray; // grayscale immediately on entering Gray
  }
  reseedSubstates();
  applyChipEditorMode(mode);
  _ceWheelCache = null;
  syncChipEditorControls();
}

function readChipEditorInputs() {
  const R = _ceRefs.ranges;
  if (_ce.mode === 'rgb') {
    _ce.r = +R.r.value; _ce.g = +R.g.value; _ce.b = +R.b.value;
  } else if (_ce.mode === 'hsl') {
    const h = +R.h.value, s = +R.s.value, l = +R.l.value;
    _ce.hsl = [h, s, l];
    [_ce.r, _ce.g, _ce.b] = hslToRgb(h, s / 100, l / 100);
  } else if (_ce.mode === 'lum') {
    const lm = +R.clum.value, s = +R.csat.value, h = +R.chue.value;
    _ce.lum = [lm, s, h];
    const L = findLightness(h, s / 100, lm / 1000);
    [_ce.r, _ce.g, _ce.b] = hslToRgb(h, s / 100, L);
  } else {
    const v = +R.gray.value; _ce.gray = v; _ce.r = _ce.g = _ce.b = v;
  }
}

function syncChipEditorRanges() {
  const R = _ceRefs.ranges;
  if (_ce.mode === 'rgb')      { R.r.value = _ce.r; R.g.value = _ce.g; R.b.value = _ce.b; }
  else if (_ce.mode === 'hsl') { R.h.value = _ce.hsl[0]; R.s.value = _ce.hsl[1]; R.l.value = _ce.hsl[2]; }
  else if (_ce.mode === 'lum') { R.clum.value = _ce.lum[0]; R.csat.value = _ce.lum[1]; R.chue.value = _ce.lum[2]; }
  else                         { R.gray.value = _ce.gray; }
}

function syncChipEditorVals() {
  const V = _ceRefs.vals;
  if (_ce.mode === 'rgb')      { V.r.value = _ce.r; V.g.value = _ce.g; V.b.value = _ce.b; }
  else if (_ce.mode === 'hsl') { V.h.value = _ce.hsl[0] + '°'; V.s.value = _ce.hsl[1] + '%'; V.l.value = _ce.hsl[2] + '%'; }
  else if (_ce.mode === 'lum') { V.clum.value = (_ce.lum[0] / 1000).toFixed(3); V.csat.value = _ce.lum[1] + '%'; V.chue.value = _ce.lum[2] + '°'; }
  else                         { V.gray.value = _ce.gray; }
}

// Every mode's Alpha slider/readout reflects the shared _ce.alpha.
function syncChipEditorAlpha() {
  const pct = Math.round((_ce.alpha ?? 1) * 100);
  (_ceRefs.alphaRanges || []).forEach(r => { r.value = String(pct); });
  (_ceRefs.alphaVals || []).forEach(v => { if (document.activeElement !== v) v.value = pct + '%'; });
}

function syncChipEditorHex() { if (document.activeElement !== _ceRefs.hex) _ceRefs.hex.value = formatHex(toHexA(_ce.r, _ce.g, _ce.b, _ce.alpha ?? 1)); fitHexField(_ceRefs.hex); }

function syncChipEditorControls() {
  syncChipEditorRanges();
  syncChipEditorVals();
  syncChipEditorAlpha();
  syncChipEditorHex();
  scheduleChipEditorPaint();
}

function paintChipEditor() {
  renderChipEditorWheel();
  renderChipEditorSliderTracks();
  chipEditorRenderPreview();
}

function scheduleChipEditorPaint() {
  if (_ceRaf) return;
  _ceRaf = requestAnimationFrame(() => { _ceRaf = 0; paintChipEditor(); });
}

// Paint synchronously, cancelling any pending rAF. Used when a wheel gesture
// ends: on Android a single tap's rAF-deferred paint can be dropped by the
// compositor, leaving the picker ring unpainted — a synchronous draw inside the
// pointer event is presented reliably, so the ring always lands on the wheel.
function flushChipEditorPaint() {
  if (_ceRaf) { cancelAnimationFrame(_ceRaf); _ceRaf = 0; }
  paintChipEditor();
}

// Colour the active mode's slider tracks, mirroring the main custom picker so
// each slider previews the color it produces.
function renderChipEditorSliderTracks() {
  if (!_ceEl) return;
  const R = _ceRefs.ranges, { r, g, b } = _ce;
  if (_ce.mode === 'rgb') {
    R.r.style.backgroundImage = `linear-gradient(to right,${cvdTransformHex(toHex(0, g, b))},${cvdTransformHex(toHex(255, g, b))})`;
    R.g.style.backgroundImage = `linear-gradient(to right,${cvdTransformHex(toHex(r, 0, b))},${cvdTransformHex(toHex(r, 255, b))})`;
    R.b.style.backgroundImage = `linear-gradient(to right,${cvdTransformHex(toHex(r, g, 0))},${cvdTransformHex(toHex(r, g, 255))})`;
  } else if (_ce.mode === 'hsl') {
    const [h, s, l] = _ce.hsl, sf = s / 100, lf = l / 100;
    const hStops = Array.from({ length: 13 }, (_, i) => `${cvdTransformHex(toHex(...hslToRgb(i * 30, sf, lf)))} ${Math.round(i / 12 * 100)}%`);
    R.h.style.backgroundImage = `linear-gradient(to right,${hStops.join(',')})`;
    R.s.style.backgroundImage = `linear-gradient(to right,${cvdTransformHex(toHex(...hslToRgb(h, 0, lf)))},${cvdTransformHex(toHex(...hslToRgb(h, 1, lf)))})`;
    R.l.style.backgroundImage = `linear-gradient(to right,${cvdTransformHex(toHex(...hslToRgb(h, sf, 0)))},${cvdTransformHex(toHex(...hslToRgb(h, sf, 0.5)))},${cvdTransformHex(toHex(...hslToRgb(h, sf, 1)))})`;
  } else if (_ce.mode === 'lum') {
    const [lm, s, h] = _ce.lum, sf = s / 100, lumT = lm / 1000;
    const lumStops = [0, 0.04, 0.18, 0.40, 0.65, 1.0].map(x => `${cvdTransformHex(toHex(...hslToRgb(h, sf, findLightness(h, sf, x))))} ${Math.round(x * 100)}%`);
    R.clum.style.backgroundImage = `linear-gradient(to right,${lumStops.join(',')})`;
    R.csat.style.backgroundImage = `linear-gradient(to right,${cvdTransformHex(toHex(...hslToRgb(h, 0, findLightness(h, 0, lumT))))},${cvdTransformHex(toHex(...hslToRgb(h, 1, findLightness(h, 1, lumT))))})`;
    const hStops = Array.from({ length: 13 }, (_, i) => `${cvdTransformHex(toHex(...hslToRgb(i * 30, sf, findLightness(i * 30, sf, lumT))))} ${Math.round(i / 12 * 100)}%`);
    R.chue.style.backgroundImage = `linear-gradient(to right,${hStops.join(',')})`;
  }
  // Gray uses the static black→white .custom-gray-slider gradient.
}

function chipEditorWriteThrough() {
  const hex = toHexA(_ce.r, _ce.g, _ce.b, _ce.alpha ?? 1).toLowerCase();
  if (_ceIdx != null && palette[_ceIdx]) {
    palette[_ceIdx].hex = hex;
    updateChipVisual(_ceIdx, hex);
    savePalette(); // saveToStorage is debounced, so per-tick calls are cheap
  }
}

function updateChipVisual(idx, hex) {
  const chipEl = paletteRail.querySelector(`.palette-chip[data-idx="${idx}"]`);
  if (!chipEl) return;
  const cvdHex = cvdDisplayHex(hex);
  const [cvdChipR, cvdChipG, cvdChipB] = hexToRgb(cvdHex);
  const cvdLum = relativeLuminance(cvdChipR, cvdChipG, cvdChipB);
  chipEl.style.background = cvdHex;
  chipEl.style.color = cvdLum > 0.179 ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.85)';
  const hx = chipEl.querySelector('.palette-chip-hex');
  if (hx) hx.textContent = formatHex(hex);
}

function onChipEditorSlider() {
  readChipEditorInputs();
  chipEditorWriteThrough();
  syncChipEditorVals();
  syncChipEditorHex();
  scheduleChipEditorPaint();
}

function onChipEditorValInput() {
  const R = _ceRefs.ranges, V = _ceRefs.vals;
  const n = s => { const x = parseFloat(String(s).replace(/[^0-9.\-]/g, '')); return Number.isFinite(x) ? x : 0; };
  const set = (rng, v, lo, hi) => { rng.value = String(_ceClamp(Math.round(v), lo, hi)); };
  const setHue = (rng, v) => { rng.value = String(((Math.round(v) % 360) + 360) % 360); }; // cyclic — wraps 0↔359
  if (_ce.mode === 'rgb')      { set(R.r, n(V.r.value), 0, 255); set(R.g, n(V.g.value), 0, 255); set(R.b, n(V.b.value), 0, 255); }
  else if (_ce.mode === 'hsl') { setHue(R.h, n(V.h.value)); set(R.s, n(V.s.value), 0, 100); set(R.l, n(V.l.value), 0, 100); }
  else if (_ce.mode === 'lum') { set(R.clum, n(V.clum.value) * 1000, 0, 1000); set(R.csat, n(V.csat.value), 0, 100); setHue(R.chue, n(V.chue.value)); }
  else                         { set(R.gray, n(V.gray.value), 0, 255); }
  onChipEditorSlider();
}

// Arrow-key nudge for a value input: ±1 display unit (Lum's luminance steps by
// 0.001, i.e. one slider step; everything else by 1), then apply + re-sync.
function chipEditorValStep(input, dir) {
  const key = input.dataset.chv;
  const rng = _ceRefs.ranges[key];
  if (!rng) return;
  const isLum = key === 'clum';
  const factor = isLum ? 1000 : 1;               // display → range units
  const dispStep = isLum ? 0.001 : 1;
  const rmin = parseFloat(rng.min), rmax = parseFloat(rng.max);
  const cur = parseFloat(String(input.value).replace(/[^0-9.\-]/g, ''));
  const base = Number.isFinite(cur) ? cur : rmin / factor;
  const isHue = key === 'h' || key === 'chue'; // hue is cyclic — wraps 0↔359 like the main picker
  const raw = base + dir * dispStep;
  const next = isHue ? ((Math.round(raw) % 360) + 360) % 360 : _ceClamp(raw, rmin / factor, rmax / factor);
  rng.value = String(Math.round(next * factor));
  onChipEditorSlider();
}

function chipEditorSetRgb(r, g, b) {
  _ce.r = _ceClamp(Math.round(r), 0, 255);
  _ce.g = _ceClamp(Math.round(g), 0, 255);
  _ce.b = _ceClamp(Math.round(b), 0, 255);
  reseedSubstates();
  chipEditorWriteThrough();
  syncChipEditorControls();
}

function attachChipEditorWheel() {
  const cv = _ceRefs.wheel;
  let down = false;
  const move = e => { if (down) { handleChipEditorWheel(e); e.preventDefault(); } };
  cv.addEventListener('pointerdown', e => {
    if (_ce.mode === 'gray') return;
    down = true;
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    handleChipEditorWheel(e);
  });
  cv.addEventListener('pointermove', move);
  // Flush a synchronous paint when the gesture ends so a stationary tap always
  // leaves the picker ring drawn (see flushChipEditorPaint — Android drops the
  // rAF-deferred paint for a lone tap).
  cv.addEventListener('pointerup',     () => { down = false; flushChipEditorPaint(); });
  cv.addEventListener('pointercancel', () => { down = false; flushChipEditorPaint(); });
}

function handleChipEditorWheel(e) {
  const rect = _ceRefs.wheel.getBoundingClientRect();
  const R = rect.width / 2;
  const dx = e.clientX - rect.left - R, dy = e.clientY - rect.top - R;
  let hue = Math.atan2(dy, dx) * 180 / Math.PI; if (hue < 0) hue += 360;
  const sat = Math.min(1, Math.hypot(dx, dy) / R);
  let rgb;
  if (_ce.mode === 'lum') {
    rgb = hslToRgb(hue, sat, findLightness(hue, sat, _ce.lum[0] / 1000));
  } else {
    const L = _ce.mode === 'hsl' ? _ce.hsl[2] / 100 : rgbToHsl(_ce.r, _ce.g, _ce.b)[2];
    rgb = hslToRgb(hue, sat, L);
  }
  chipEditorSetRgb(...rgb);
}

function renderChipEditorWheel() {
  if (!_ceEl || _ce.mode === 'gray') return;
  const cv = _ceRefs.wheel, ctx = _ceRefs.ctx, SZ = cv.width, R = SZ / 2;
  const lumMode = _ce.mode === 'lum';
  const L    = lumMode ? 0 : (_ce.mode === 'hsl' ? _ce.hsl[2] / 100 : rgbToHsl(_ce.r, _ce.g, _ce.b)[2]);
  const lumT = lumMode ? _ce.lum[0] / 1000 : 0;
  const key  = _ce.mode + '|' + (lumMode ? lumT.toFixed(3) : L.toFixed(3));
  if (!_ceWheelCache || _ceWheelCache.key !== key) {
    // Reuse the cached buffer across drag frames unless the canvas was resized
    // (see renderCustomWheel for why the constant circular mask makes this safe).
    const img = (_ceWheelCache && _ceWheelCache.img.width === SZ && _ceWheelCache.img.height === SZ)
      ? _ceWheelCache.img : ctx.createImageData(SZ, SZ);
    const d = img.data;
    for (let y = 0; y < SZ; y++) {
      for (let x = 0; x < SZ; x++) {
        const dx = x - R + 0.5, dy = y - R + 0.5, dist = Math.hypot(dx, dy), idx = (y * SZ + x) * 4;
        // Antialias the circular edge: full coverage inside, ramping to 0 across
        // the ~1px boundary band. A hard dist>R cutoff left the edge jagged (the
        // canvas composites this per-pixel alpha over the sidebar background).
        const cov = R + 0.5 - dist;
        if (cov <= 0) { d[idx + 3] = 0; continue; }
        let hue = Math.atan2(dy, dx) * 180 / Math.PI; if (hue < 0) hue += 360;
        const sat = Math.min(1, dist / R);
        const rgb = lumMode ? hslToRgb(hue, sat, findLightness(hue, sat, lumT)) : hslToRgb(hue, sat, L);
        const [tr, tg, tb] = cvdTransformRgb(rgb[0], rgb[1], rgb[2]);
        d[idx] = tr; d[idx + 1] = tg; d[idx + 2] = tb; d[idx + 3] = cov >= 1 ? 255 : Math.round(cov * 255);
      }
    }
    _ceWheelCache = { key, img };
  }
  ctx.putImageData(_ceWheelCache.img, 0, 0);
  // marker at current hue/sat
  let mh, ms;
  if (lumMode)                 { mh = _ce.lum[2]; ms = _ce.lum[1] / 100; }
  else if (_ce.mode === 'hsl') { mh = _ce.hsl[0]; ms = _ce.hsl[1] / 100; }
  else                         { const h = rgbToHsl(_ce.r, _ce.g, _ce.b); mh = h[0]; ms = h[1]; }
  const a = mh * Math.PI / 180, dd = ms * R, scale = SZ / CE_WHEEL_SIZE;
  const cx = R + Math.cos(a) * dd, cy = R + Math.sin(a) * dd, rad = 5 * scale;
  // Double ring (white halo + black core) so the marker stays visible on any
  // underlying colour — a single-tone ring vanishes when the selected colour's
  // luminance sits near the black/white threshold.
  ctx.lineWidth = 3.5 * scale;
  ctx.strokeStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.6 * scale;
  ctx.strokeStyle = '#000';
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.stroke();
}

function chipEditorOppRole() { return _ce.role === 'fg' ? 'bg' : 'fg'; }

function partnerList() {
  const opp = chipEditorOppRole();
  return palette.filter((e, i) => e.role === opp && i !== _ceIdx).map(e => e.hex);
}

function partnerHex() {
  const list = partnerList();
  if (list.length) return list[_cePartner % list.length];
  // Nothing saved in the opposite role → fall back to that role's main picker
  return _ce.role === 'fg'
    ? toHex(cR, cG, cB)               // editing text → compare against main background
    : toHex(...selectedRgbBiased());  // editing background → compare against main wheel text
}

function chipEditorRenderPreview() {
  if (!_ceEl || !_ce) return;
  const editedRgb = [_ce.r, _ce.g, _ce.b], editedA = _ce.alpha ?? 1;
  const list = partnerList();
  if (_cePartner >= Math.max(1, list.length)) _cePartner = 0;
  const partner = partnerHex();
  const [pr, pg, pb, pa] = hexToRgba(partner);
  // Role assignment + alpha compositing: the text composites over the (effective)
  // background so a translucent colour's contrast reflects what's actually seen.
  let textRgb, textA, bgRgb, bgA, cmpRole;
  if (_ce.role === 'bg') { bgRgb = editedRgb; bgA = editedA; textRgb = [pr, pg, pb]; textA = pa; cmpRole = 'Text'; }
  else                   { textRgb = editedRgb; textA = editedA; bgRgb = [pr, pg, pb]; bgA = pa; cmpRole = 'BG'; }
  const effBg = effBgRgb(bgRgb, bgA);
  const effText = compositeRgb(textRgb, textA, effBg);
  const textCss = textA < 0.9995 ? cvdTransformRgba(`rgba(${textRgb[0]},${textRgb[1]},${textRgb[2]},${textA})`) : cvdTransformHex(toHex(...textRgb));

  _ceRefs.tile.style.background = cvdTransformHex(toHex(...effBg));
  _ceRefs.ag.style.color = textCss;
  _ceRefs.cmpBtn.style.color = textCss; // icon stroke = currentColor

  // Label the preview in the text colour so it reads as a contrast sample next
  // to "Ag". When editing a Text colour (the "Ag" is that edited colour) show
  // "<edited> vs <partner>"; when editing a BG colour (the "Ag" is the partner)
  // just name the partner.
  const partnerLabel = cmpRole + ' ' + (list.length ? paletteRankLabel(_cePartner) : '(picker)');
  if (_ce.role === 'fg') {
    let rankPos = 0;
    for (let i = 0; i < _ceIdx; i++) if (palette[i] && palette[i].role === 'fg') rankPos++;
    _ceRefs.tileLabel.textContent = `Text ${paletteRankLabel(rankPos)} on ${partnerLabel}`;
  } else {
    _ceRefs.tileLabel.textContent = partnerLabel;
  }
  _ceRefs.tileLabel.style.color = textCss;

  _ceRefs.cmpRole.textContent = cmpRole + (list.length ? '' : ' (picker)');

  // Effective (composited) luminances for the verdict. When the EDITED side is in
  // Lum mode its luminance is held (_ce.lum[0]), and we gray-composite it over the
  // fixed partner + underlay — hue-invariant, so an edited hue/sat sweep in Lum
  // mode can't shift the verdict. Other edit modes (RGB/HSL/Gray) follow the
  // edited colour's actual luminance (contrast may change — as intended). Display
  // above still uses the real composited colours.
  const editedHeldLum = _ce.mode === 'lum';
  const effLums = space => {
    const uL = space === 'ys' ? apcaY(...underlayRgb) : relativeLuminance(...underlayRgb);
    const lumOf = rgb => space === 'ys' ? apcaY(...rgb) : relativeLuminance(...rgb);
    const comp = space === 'ys' ? compositeYs : compositeRelLum;
    const editedL = editedHeldLum ? _ce.lum[0] / 1000 : lumOf(editedRgb);
    const partnerL = lumOf([pr, pg, pb]);
    const [tL, tAl, bL, bAl] = _ce.role === 'bg' ? [partnerL, pa, editedL, editedA] : [editedL, editedA, partnerL, pa];
    const eBg = comp(bL, bAl, uL);
    return [comp(tL, tAl, eBg), eBg];
  };
  _ceRefs.badges.innerHTML = '';
  if (contrastLockMode === 'apca') {
    // APCA mode: the WCAG readouts give way to the APCA verdicts — Lc value,
    // official usage tier, and the chosen-font verdict (same helpers as the
    // main contrast tiles, so both always agree).
    //
    // Both sides are read on the same milli-Ys grid — round(Ys*1000)/1000 —
    // and this gives two properties at once:
    //   • Symmetry: the SAME pair reads identically whether the TEXT chip or
    //     the BG chip is open. At load _ce.lum[0] = round(wheelLum*1000), so the
    //     edited side already lives on that grid; quantizing the partner to
    //     match means neither side carries extra rounding the other lacks.
    //   • Hue/Sat stability: in Lum mode luminance is LOCKED, so the edited
    //     side is judged from its held target (_ce.lum[0]/1000), which does not
    //     move when only Hue or Saturation change — sweeping them can no longer
    //     shake the verdict across a threshold via 8-bit hex quantization. The
    //     other modes (RGB/HSL/Gray) don't hold luminance, so there the edited
    //     side follows its actual quantized colour.
    const [tYs, bYs] = effLums('ys');
    const lc = apcaLcYs(tYs, bYs);
    const lcAbs = Math.abs(lc);
    _ceRefs.ratio.textContent = 'Lc ' + (lc === 0 ? '0' : lc.toFixed(0));
    _ceRefs.apcaTier.textContent = apcaUsageTier(lcAbs);
    _ceRefs.apcaTier.title = 'APCA usage level for |Lc| ' + lcAbs.toFixed(0) + ' (reference-tool ladder)';
    const v = apcaFontVerdict(lcAbs);
    _ceRefs.apcaFont.textContent = v.text;
    _ceRefs.apcaFont.title = v.title;
    _ceRefs.apcaFont.classList.toggle('pass', v.pass);
    return;
  }
  _ceRefs.apcaTier.textContent = '';
  _ceRefs.apcaFont.textContent = '';
  const [tRel, bRel] = effLums('rel');
  const ratio = contrastRatio(tRel, bRel);
  _ceRefs.ratio.textContent = ratio.toFixed(2) + ':1';
  // Show the WCAG 2.2 ratio thresholds (3:1 large text / UI, 4.5:1 normal AA,
  // 7:1 AAA) so each use case can be checked; each lights up when the pair meets it.
  for (const [lbl, thr] of [['3:1', 3], ['4.5:1', 4.5], ['7:1', 7]]) {
    const b = document.createElement('span');
    b.className = 'chip-editor-badge' + (ratio >= thr ? ' pass' : '');
    b.textContent = lbl;
    _ceRefs.badges.appendChild(b);
  }
}

function centerChipEditorInRail(smooth = true) {
  if (!_ceEl || !paletteRail.contains(_ceEl)) return;
  const railRect = paletteRail.getBoundingClientRect();
  const editorRect = _ceEl.getBoundingClientRect();
  const next = paletteRail.scrollTop
    + (editorRect.top + editorRect.height / 2)
    - (railRect.top + railRect.height / 2);
  paletteRail.scrollTo({
    top: Math.max(0, next),
    behavior: smooth ? 'smooth' : 'auto',
  });
}

// Keep the chip-editor hex field visible in the rail's scroll area. On mobile the
// keyboard shrinks the viewport (and thus the sidebar/rail) when the field gains
// focus, which can push the selected hex out of view; this re-centers it in
// whatever visible height remains. Only scrolls when it's actually clipped, so an
// already-visible field isn't yanked around.
function scrollChipHexIntoView(smooth = true) {
  if (!_ceRefs || !_ceRefs.hex || !_ceEl || !paletteRail.contains(_ceEl)) return;
  const railRect = paletteRail.getBoundingClientRect();
  const elRect = _ceRefs.hex.getBoundingClientRect();
  const margin = 8;
  if (elRect.top >= railRect.top + margin && elRect.bottom <= railRect.bottom - margin) return;
  const next = paletteRail.scrollTop
    + (elRect.top + elRect.height / 2)
    - (railRect.top + railRect.height / 2);
  paletteRail.scrollTo({ top: Math.max(0, next), behavior: smooth ? 'smooth' : 'auto' });
}

function openChipEditor(idx) {
  if (_ceIdx === idx) return; // already editing this chip → stay open (no toggle)
  if (_ceIdx !== null) { closeChipEditor(true, () => openChipEditor(idx)); return; }
  if (!palette[idx]) return;
  if (!_ceEl) buildChipEditor();
  clearTimeout(_ceCloseTimer);
  _ceEl.classList.remove('chip-editor--closing');
  _ceIdx = idx;
  _ceOrigHex = palette[idx].hex;
  _cePartner = 0;
  _ceWheelCache = null;
  const entry = palette[idx];
  const [r, g, b, a] = hexToRgba(entry.hex);
  // savedColor holds the shared RGB/HSL/LUM colour; savedGray holds the
  // independent Gray value — so switching between Gray and the colour modes
  // keeps each side's setting (mirroring the main BG picker).
  _ce = { role: entry.role, r, g, b, alpha: a, mode: 'lum', hsl: [0, 0, 0], lum: [0, 0, 0], gray: 0,
          savedColor: { r, g, b }, savedGray: Math.round((r + g + b) / 3) };
  _ceOrigName = entry.name; // undefined when unnamed — restored on cancel
  reseedSubstates();
  applyChipEditorMode('lum');
  syncChipEditorControls();
  // Always show the effective name: the user-set name, or the default position label.
  if (_ceRefs && _ceRefs.name) _ceRefs.name.value = entry.name || paletteRankLabel(paletteRankPosOf(idx));
  chipEditorRenderPreview();
  const chipEl = paletteRail.querySelector(`.palette-chip[data-idx="${idx}"]`);
  if (chipEl) { chipEl.classList.add('editing'); chipEl.after(_ceEl); }
  requestAnimationFrame(() => {
    updateChipEditorAgSize(); // now the editor is in the DOM, measure the "Ag" px
    centerChipEditorInRail(true);
    setTimeout(() => centerChipEditorInRail(true), 180);
  });
  // A deliberate tap (not a scroll drag) outside the sidebar finishes editing.
  // We track pointerdown → pointerup to distinguish taps from scrolls: if the
  // pointer moves more than a small threshold or is held too long, the gesture
  // is treated as a scroll and the editor stays open.
  document.addEventListener('pointerdown', _ceOutsideDown, true);
  document.addEventListener('pointerup',   _ceOutsideUp,   true);
}

// --- Outside-tap detection for chip editor close ---
let _ceDownEvt = null;  // stashed pointerdown event for tap detection
const _CE_TAP_DIST  = 10;  // px — max movement to still count as a tap
const _CE_TAP_TIME  = 400; // ms — max duration to still count as a tap

function _ceOutsideDown(e) {
  if (_ceIdx === null) return;
  const t = /** @type {Node} */ (e.target);
  // Interactions inside the editor itself are not outside taps. The rest of
  // the sidebar is outside the editing section, so a deliberate tap there
  // should behave like Done: save the live edits and leave edit mode.
  if (_ceEl && _ceEl.contains(t)) { _ceDownEvt = null; return; }
  // Operating the currently-edited chip's own edit or copy button keeps the
  // editor open (the pencil no longer toggles closed; copy just copies).
  const chip = t.closest && t.closest('.palette-chip');
  if (chip && chip.dataset.idx === String(_ceIdx) && t.closest('.palette-chip-edit, .palette-chip-copy')) {
    _ceDownEvt = null; return;
  }
  // Stash for the matching pointerup to measure distance/time.
  _ceDownEvt = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
}

function _ceOutsideUp(e) {
  if (_ceIdx === null || !_ceDownEvt) return;
  // Only match the same pointer that started the gesture.
  if (e.pointerId !== _ceDownEvt.id) return;
  const dx = e.clientX - _ceDownEvt.x;
  const dy = e.clientY - _ceDownEvt.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const elapsed = Date.now() - _ceDownEvt.t;
  _ceDownEvt = null;
  // If the pointer moved too far or was held too long it was a scroll / drag,
  // not a deliberate tap — keep the editor open.
  if (dist > _CE_TAP_DIST || elapsed > _CE_TAP_TIME) return;
  closeChipEditor();
  renderPalettePreviews();
}

function closeChipEditor(skipRender, afterClose) {
  if (_ceIdx === null) { if (afterClose) afterClose(); return; }
  _ceHexReturnPending = false;
  clearTimeout(_ceHexScrollTimer);
  const lockRail = !!afterClose;
  if (lockRail) paletteRail.classList.add('palette-rail--editor-transition');
  document.removeEventListener('pointerdown', _ceOutsideDown, true);
  document.removeEventListener('pointerup',   _ceOutsideUp,   true);
  _ceDownEvt = null;
  closeChipEditorDropdown();
  const idx = _ceIdx;
  // A committed re-edit (Done / tap-away keeps the change) is undoable: record the
  // pre-edit palette (this chip back at its original hex). Cancel reverts the hex
  // first, so no change is seen here and nothing is recorded.
  if (_ceOrigHex !== null && palette[idx] && palette[idx].hex !== _ceOrigHex) {
    const pre = _clonePalette();
    pre[idx] = { ...pre[idx], hex: _ceOrigHex };
    pushPaletteHistory(pre);
  }
  _ceIdx = null;
  _ce = null;
  _ceOrigHex = null;
  _ceOrigName = undefined;
  savePalette();
  const chipEl = paletteRail.querySelector(`.palette-chip[data-idx="${idx}"]`);
  if (chipEl) chipEl.classList.remove('editing');
  clearTimeout(_ceCloseTimer);
  const removeEditor = () => {
    if (_ceEl) {
      _ceEl.classList.remove('chip-editor--closing');
      if (_ceEl.parentNode) _ceEl.parentNode.removeChild(_ceEl);
    }
    if (!skipRender) renderPalette();
    if (lockRail) paletteRail.classList.remove('palette-rail--editor-transition');
    if (afterClose) afterClose();
  };
  if (!_ceEl || !_ceEl.parentNode) {
    removeEditor();
  } else {
    _ceEl.classList.add('chip-editor--closing');
    _ceCloseTimer = setTimeout(removeEditor, 190);
  }
}

function cancelChipEditor() {
  if (_ceIdx === null) return;
  if (palette[_ceIdx]) {
    // Revert the name edit too: restore the pre-edit name (or clear it if it was unnamed).
    if (_ceOrigName !== undefined) palette[_ceIdx].name = _ceOrigName;
    else delete palette[_ceIdx].name;
  }
  if (_ceOrigHex !== null && palette[_ceIdx]) {
    palette[_ceIdx].hex = _ceOrigHex;
    updateChipVisual(_ceIdx, _ceOrigHex);
  }
  savePalette();
  closeChipEditor();
}

/** Re-attach the open editor after a renderPalette() rebuild (used as a safety
    net; structural edits close the editor before rebuilding). */
function reinsertChipEditor() {
  if (_ceIdx === null) return;
  const chipEl = paletteRail.querySelector(`.palette-chip[data-idx="${_ceIdx}"]`);
  if (chipEl && _ceEl) { chipEl.classList.add('editing'); chipEl.after(_ceEl); }
  else { _ceIdx = null; _ce = null; }
}

function renderPalette() {
  // A small dot marks a non-empty palette (no dot when empty); the old numeric
  // count is gone, so this element carries no text.
  paletteToggleCount.hidden = palette.length === 0;
  paletteRail.innerHTML = '';

  // All rail content lives in one wrapper so it can be sized just past the rail
  // on touch (min-height: 100% + 1px) — a 1px scroll range even with few colors,
  // so the list stays draggable (elastic) instead of feeling locked.
  const railContent = document.createElement('div');
  railContent.className = 'palette-rail-content';

  // Two role groups (Text = wheel colors, Background = custom colors), always
  // shown so each has an "add the current color" button — even when empty.
  // Within a group the top chip is primary, the second secondary.
  [{ role: 'fg', label: 'Text' }, { role: 'bg', label: 'Background' }].forEach(({ role, label }) => {
    const entries = palette
      .map((e, flatIdx) => ({ hex: e.hex, flatIdx }))
      .filter((_, i) => palette[i].role === role);

    const group = document.createElement('div');
    group.className = 'palette-group';

    const head = document.createElement('div');
    head.className = 'palette-group-head';
    const title = document.createElement('span');
    title.className = 'palette-group-label';
    title.textContent = label;

    const add = document.createElement('button');
    add.className = 'palette-group-add';
    add.innerHTML = PLUS_SVG;
    add.title = role === 'fg'
      ? 'Add the current wheel color (text)'
      : 'Add the current custom color (background)';
    add.setAttribute('aria-label', add.title);
    add.disabled = entries.length >= PALETTE_ROLE_MAX;
    add.addEventListener('click', () => {
      if (role === 'fg') addToPalette(toHexA(...selectedRgbBiased(), selAlpha), 'fg');
      else addToPalette(toHexA(cR, cG, cB, cAlpha), 'bg');
    });

    const importBtn = document.createElement('button');
    importBtn.className = 'palette-group-import';
    importBtn.innerHTML = IMPORT_SVG;
    importBtn.title = 'Import a colour from Scales';
    importBtn.setAttribute('aria-label', importBtn.title);
    importBtn.disabled = entries.length >= PALETTE_ROLE_MAX;
    importBtn.addEventListener('click', () => openScaleImport(role, importBtn));

    const actions = document.createElement('div');
    actions.className = 'palette-group-actions';
    actions.append(importBtn, add);
    head.append(title, actions);

    const list = document.createElement('div');
    list.className = 'palette-group-list';
    group.append(head, list);

    entries.forEach(({ hex, flatIdx }, pos) => {
    const [r, g, b] = hexToRgb(hex);
    const lum = relativeLuminance(r, g, b);
    const display = formatHex(hex); // 8-digit shows the alpha; 6-digit as before

    const chip = document.createElement('div');
    chip.className = 'palette-chip';
    chip.dataset.idx = String(flatIdx);
    chip.style.background = cvdDisplayHex(hex);
    const cvdHexColor = cvdDisplayHex(hex);
    const [cvdChipR, cvdChipG, cvdChipB] = hexToRgb(cvdHexColor);
    const cvdLum = relativeLuminance(cvdChipR, cvdChipG, cvdChipB);
    chip.style.color = cvdLum > 0.179 ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.85)';

    const grip = document.createElement('span');
    grip.className = 'palette-chip-grip';
    grip.innerHTML = GRIP_SVG;
    grip.title = 'Drag to reorder';
    grip.setAttribute('aria-hidden', 'true');

    const rank = document.createElement('span');
    rank.className = 'palette-chip-rank';
    const customName = palette[flatIdx] && palette[flatIdx].name;
    rank.textContent = customName || paletteRankLabel(pos);
    rank.classList.toggle('palette-chip-rank--named', !!customName);
    rank.title = customName
      ? `“${customName}” — used as the token name on export (edit in the color editor)`
      : `${label} ${paletteRankLabel(pos).toLowerCase()} — used in export`;

    const hexLabel = document.createElement('span');
    hexLabel.className = 'palette-chip-hex';
    hexLabel.textContent = display;

    const recall = document.createElement('button');
    recall.className = 'palette-chip-recall';
    recall.innerHTML = RECALL_SVG;
    recall.title = role === 'fg' ? 'Load into the main text picker' : 'Load into the main background picker';
    recall.setAttribute('aria-label', recall.title);
    recall.addEventListener('click', e => {
      e.stopPropagation();
      const [rr, gg, bb, aa] = hexToRgba(hex);
      if (role === 'fg') applyMainHex(rr, gg, bb, aa);
      else applyCustomHex(rr, gg, bb, aa);
    });

    const edit = document.createElement('button');
    edit.className = 'palette-chip-edit';
    edit.innerHTML = PENCIL_SVG;
    edit.title = 'Edit this color';
    edit.setAttribute('aria-label', 'Edit this color');
    edit.addEventListener('click', e => {
      e.stopPropagation();
      openChipEditor(flatIdx);
    });

    const copy = document.createElement('button');
    copy.className = 'palette-chip-copy';
    copy.title = 'Copy hex';
    copy.setAttribute('aria-label', 'Copy hex');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(display);
        copy.classList.add('copied');
        setTimeout(() => copy.classList.remove('copied'), 1200);
      } catch (_) { /* clipboard denied */ }
    });

    const duplicate = document.createElement('button');
    duplicate.className = 'palette-chip-duplicate';
    duplicate.innerHTML = DUPLICATE_SVG;
    duplicate.title = 'Duplicate this color';
    duplicate.setAttribute('aria-label', 'Duplicate this color');
    duplicate.disabled = entries.length >= PALETTE_ROLE_MAX;
    duplicate.addEventListener('click', e => {
      e.stopPropagation();
      duplicateInPalette(flatIdx);
    });

    const remove = document.createElement('button');
    remove.className = 'palette-chip-remove';
    remove.textContent = '\u00d7';
    remove.title = 'Remove from palette';
    remove.addEventListener('click', () => removeFromPalette(flatIdx));

    attachChipDrag(chip, pos, role, list);

    chip.append(grip, rank, hexLabel, edit, copy, duplicate, recall);
    chip.append(remove);
    list.appendChild(chip);
    });

    railContent.appendChild(group);
  });
  paletteRail.appendChild(railContent);

  reinsertChipEditor();
  renderPalettePreviews();
  updateRailFade(); // re-evaluate top/bottom fade for the new list length
}

/** Mirror the saved palette into the two vs-Custom preview tiles as a compact
    strip, shown against each tile's own background. Text-role colors render as
    a small colored "Ag" glyph; background-role colors as a filled square — so
    the two kinds are distinguishable at a glance. */
function renderPalettePreviews() {
  const textColors = palette.filter(e => e.role === 'fg');
  const bgColors   = palette.filter(e => e.role === 'bg');
  for (const id of ['pa', 'pb', 'pvw', 'pvb']) {
    const section = document.getElementById(id + '-palette-section');
    const host    = document.getElementById(id + '-palette');
    if (!section || !host) continue;
    host.innerHTML = '';
    section.hidden = palette.length === 0;
    if (!palette.length) continue;
    textColors.forEach(({ hex }) => {
      const el = document.createElement('span');
      el.className = 'preview-palette-text';
      el.textContent = 'Ag';
      el.style.color = cvdTransformHex(hex);
      el.title = `Text color ${formatHex(hex.toUpperCase())} — open palette`;
      host.appendChild(el);
    });
    bgColors.forEach(({ hex }) => {
      const el = document.createElement('span');
      el.className = 'preview-palette-bg';
      el.style.background = cvdTransformHex(hex);
      el.title = `Background color ${formatHex(hex.toUpperCase())} — open palette`;
      host.appendChild(el);
    });
  }
}

// Clicking a preview strip opens the palette sidebar (the strips just mirror
// the saved colors; the sidebar is where you manage them). Delegated once —
// the host elements persist across renderPalettePreviews() rebuilds.
['pa-palette', 'pb-palette', 'pvw-palette', 'pvb-palette'].forEach(id => {
  const host = document.getElementById(id);
  if (host) host.addEventListener('click', () => setPaletteOpen(true));
});

document.getElementById('pin-selected').addEventListener('click', () => {
  addToPalette(toHexA(...selectedRgbBiased(), selAlpha), 'fg');
});
document.getElementById('pin-custom').addEventListener('click', () => {
  addToPalette(toHexA(cR, cG, cB, cAlpha), 'bg');
});
document.getElementById('palette-clear').addEventListener('click', () => {
  if (!palette.length) return;
  recordPaletteHistory();
  palette = [];
  savePalette();
  renderPalette();
});

document.getElementById('palette-undo').addEventListener('click', undoPalette);
document.getElementById('palette-redo').addEventListener('click', redoPalette);
updatePaletteHistoryButtons(); // start with both disabled (empty history)

// Restore: localStorage first, then share-URL override.
// Legacy entries (plain hex strings / unprefixed URL tokens) predate the
// fg/bg distinction; they were always edited in the custom picker, so 'bg'.
// Cap each role at PALETTE_ROLE_MAX entries (older palettes could hold a different count).
function capPaletteRoles(list) {
  const kept = [], count = { fg: 0, bg: 0 };
  for (const e of list) {
    if (count[e.role] >= PALETTE_ROLE_MAX) continue;
    count[e.role]++;
    kept.push(e);
  }
  return kept;
}
try {
  const stored = JSON.parse(localStorage.getItem('palette-colors') || '[]');
  if (Array.isArray(stored)) {
    // Accept 6- AND 8-digit hex (the 8-digit #RRGGBBAA carries opacity), any case — matching
    // what addToPalette stores. The old 6-digit-lowercase-only test dropped every translucent
    // saved color on reload, silently corrupting the palette. Normalize to lowercase on the way in.
    const HEX = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;
    const withName = (o, item) => {
      if (item && typeof item.name === 'string' && item.name.trim()) o.name = item.name.trim().slice(0, 40);
      return o;
    };
    palette = capPaletteRoles(stored.map(item => {
      if (typeof item === 'string' && HEX.test(item)) return { hex: item.toLowerCase(), role: 'bg' };
      if (item && typeof item === 'object' && typeof item.hex === 'string' && HEX.test(item.hex))
        return withName({ hex: item.hex.toLowerCase(), role: item.role === 'fg' ? 'fg' : 'bg' }, item);
      return null;
    }).filter(Boolean));
  }
} catch (e) { console.warn('Failed to parse saved palette; starting empty:', e); }
try {
  const pp = new URLSearchParams(location.search).get('p');
  if (pp !== null) {
    const fromUrl = capPaletteRoles(pp.split(',').map(tok => {
      const t = tok.toLowerCase();
      if (/^[fb]([0-9a-f]{6}|[0-9a-f]{8})$/.test(t)) return { hex: '#' + t.slice(1), role: t[0] === 'f' ? 'fg' : 'bg' };
      if (/^([0-9a-f]{6}|[0-9a-f]{8})$/.test(t)) return { hex: '#' + t, role: 'bg' };
      return null;
    }).filter(Boolean));
    if (fromUrl.length) { palette = fromUrl; savePalette(); }
  }
} catch (e) { console.warn('Failed to parse palette from share URL; ignoring it:', e); }
renderPalette();
// Open state: explicit preference wins; otherwise open when colors exist
try {
  const po = localStorage.getItem('palette-open');
  paletteOpen = po !== null ? po === '1' : palette.length > 0;
} catch (e) { paletteOpen = palette.length > 0; }
applyPaletteOpen();
