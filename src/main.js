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
  const apply = v => { const c = constrain(v); input.value = format(c); applyState(c); };
  const commit = () => { const v = parse(input.value); apply(isFinite(v) ? v : min); };
  input.addEventListener('focus', () => input.select());
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = parse(input.value);
      apply((isFinite(cur) ? cur : 0) + (e.key === 'ArrowUp' ? step : -step));
    } else if (e.key === 'Enter') { commit(); input.blur(); }
  });
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

function contrastRatio(l1, l2) {
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Binary search: find HSL lightness so relativeLuminance(hsl(H,S,L)) ≈ target.
 * L=0→black(0), L=1→white(1) for any H,S — every target is reachable.
 */
function findLightness(h, s, target) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) * 0.5;
    const [r, g, b] = hslToRgb(h, s, mid);
    if (relativeLuminance(r, g, b) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) * 0.5;
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
function findLightnessBiased(h, s, target, dir) {
  let l = findLightness(h, s, target);
  if (!dir) return l;
  const STEP = 1 / 512; // ~half an 8-bit channel step in lightness
  for (let i = 0; i < 12; i++) {
    const lum = relativeLuminance(...hslToRgb(h, s, l));
    if (dir > 0 ? lum >= target : lum <= target) break;
    const next = Math.max(0, Math.min(1, l + dir * STEP));
    if (next === l) break; // hit black/white — can't go further
    l = next;
  }
  return l;
}

/** The rendered selected (wheel) color: quantization biased away from the
    custom background's luminance so the fg:bg contrast never dips below what
    the continuous target luminance promises, for any hue/sat. */
function selectedRgbBiased() {
  const dir = Math.sign(targetLum - relativeLuminance(cR, cG, cB));
  return hslToRgb(selHue, selSat, findLightnessBiased(selHue, selSat, targetLum, dir));
}

function toHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
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

/** OKLCH as a CSS oklch() string, e.g. 'oklch(62.79% 0.2577 29.23)'. */
function oklchCss(hex) {
  const [L, C, H] = rgbToOklch(...hexToRgb(hex));
  return `oklch(${(L * 100).toFixed(2)}% ${C.toFixed(4)} ${H.toFixed(2)})`;
}

/** OKLCH as a DTCG color-object `components` array [L, C, H] with tidy precision. */
function oklchComponents(hex) {
  const [L, C, H] = rgbToOklch(...hexToRgb(hex));
  return [+L.toFixed(4), +C.toFixed(4), +H.toFixed(2)];
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

function apcaLc(txtRgb, bgRgb) {
  const soft = Y => (Y <= 0.022 ? Y + Math.pow(0.022 - Y, 1.414) : Y);
  const Yt = soft(apcaY(...txtRgb));
  const Yb = soft(apcaY(...bgRgb));
  if (Math.abs(Yb - Yt) < 0.0005) return 0;
  if (Yb > Yt) {
    const S = (Math.pow(Yb, 0.56) - Math.pow(Yt, 0.57)) * 1.14;
    return S < 0.1 ? 0 : (S - 0.027) * 100;
  }
  const S = (Math.pow(Yb, 0.65) - Math.pow(Yt, 0.62)) * 1.14;
  return S > -0.1 ? 0 : (S + 0.027) * 100;
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

float sL(float c) {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}
float lum(vec3 c) {
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

  vec3  color = hsl(h, sat, (lo + hi) * 0.5);
  float a     = smoothstep(uRadius + 1.0, uRadius - 1.0, dist);
  gl_FragColor = vec4(color * a, a);
}
`;

/** @type {{ gl: WebGLRenderingContext, uLum: WebGLUniformLocation } | null} */
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

  const uLum    = /** @type {WebGLUniformLocation} */ (gl.getUniformLocation(prog, 'uLum'));
  const uCenter = /** @type {WebGLUniformLocation} */ (gl.getUniformLocation(prog, 'uCenter'));
  const uRadius = /** @type {WebGLUniformLocation} */ (gl.getUniformLocation(prog, 'uRadius'));
  gl.uniform2f(uCenter, BUF_SZ / 2, BUF_SZ / 2);
  gl.uniform1f(uRadius, R_BUF);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  return { gl, uLum };
}

function drawWheel(lum) {
  if (!glState) return;
  const { gl, uLum } = glState;
  gl.uniform1f(uLum, lum);
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
        const alpha = dist > R_BUF - 0.5 ? Math.max(0, Math.round((R_BUF + 1 - dist) * 255)) : 255;
        const idx = (py * BUF_SZ + px) * 4;
        data[idx] = r; data[idx+1] = g; data[idx+2] = b; data[idx+3] = alpha;
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
    return `${toHex(...hslToRgb(selHue, s, l))} ${(t * 100).toFixed(0)}%`;
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
    return `${toHex(...hslToRgb(h, 1, l))} ${Math.round(i / 12 * 100)}%`;
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
    return `${toHex(...hslToRgb(selHue, s, l))} ${Math.round(s * 100)}%`;
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

  const cats = [], badges = [];
  for (const { label, title, thresholds } of CATEGORIES) {
    const row = document.createElement('div');
    row.className = 'preview-wcag-row';

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

    rowsEl.appendChild(row);
  }

  el.appendChild(rowsEl);
  const ratioEl = document.getElementById(el.id.replace('-wcag', '-ratio'));
  let apcaEl = null;
  if (ratioEl) {
    apcaEl = document.createElement('span');
    apcaEl.className = 'preview-apca';
    apcaEl.title = 'APCA Lc (experimental — WCAG 2.2 ratio remains normative)';
    ratioEl.insertAdjacentElement('afterend', apcaEl);
  }
  const dom = { ratioEl, apcaEl, cats, badges };
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
function renderPreviewWcag(el, l1, l2, bgLum, txtRgb, bgRgb) {
  const dom = _wcagDom.get(el) || buildPreviewWcag(el);
  const ratio   = contrastRatio(l1, l2);
  const isLight = bgLum > 0.179;
  const dim     = isLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)';

  if (dom.ratioEl) {
    dom.ratioEl.textContent = ratio.toFixed(2) + ':1';
    dom.ratioEl.style.color = dim;
  }
  if (dom.apcaEl) {
    if (txtRgb && bgRgb) {
      const lc = apcaLc(txtRgb, bgRgb);
      dom.apcaEl.textContent = 'Lc ' + (lc === 0 ? '0' : lc.toFixed(0));
      dom.apcaEl.style.color = dim;
    } else {
      dom.apcaEl.textContent = '';
    }
  }

  // lum(#5dde8a) ≈ 0.586 (bright green),  lum(#1a7a42) ≈ 0.057 (dark green)
  const LUM_BRIGHT = 0.586, LUM_DARK = 0.057;
  const cr = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const crBright = cr(bgLum, LUM_BRIGHT);
  const crDark   = cr(bgLum, LUM_DARK);

  // Text: use green when it achieves ≥4.5:1; otherwise fall back to black/white
  // (isLight ≡ bgLum > 0.179 ≡ black gives more contrast than white)
  const passColor = crBright >= 4.5 ? '#5dde8a'
                  : crDark   >= 4.5 ? '#1a7a42'
                  : isLight          ? '#000000'
                  :                    '#ffffff';

  // Border/bg: always use whichever green has more contrast against tile bg
  const useBrightStyle = crBright >= crDark;
  const passBorder = useBrightStyle ? 'rgba(93,222,138,0.45)' : 'rgba(26,122,66,0.45)';
  const passBg     = useBrightStyle ? 'rgba(93,222,138,0.10)' : 'rgba(26,122,66,0.10)';
  const passRing   = isLight ? '0 0 0 1px rgba(0,0,0,0.16)' : '0 0 0 1px rgba(255,255,255,0.18)';

  for (const catEl of dom.cats) catEl.style.color = dim;

  for (const { el: b, threshold } of dom.badges) {
    if (ratio >= threshold) {
      b.style.color       = passColor;
      b.style.borderColor = passBorder;
      b.style.background  = passBg;
      b.style.boxShadow   = passRing;
    } else {
      b.style.color       = isLight ? 'rgba(0,0,0,0.3)'   : 'rgba(255,255,255,0.3)';
      b.style.borderColor = isLight ? 'rgba(0,0,0,0.12)'  : 'rgba(255,255,255,0.12)';
      b.style.background  = isLight ? 'rgba(0,0,0,0.04)'  : 'rgba(255,255,255,0.04)';
      b.style.boxShadow   = 'none';
    }
  }
}

/**
 * Update the vs-White and vs-Black preview tiles.
 * @param {string} selectedHex
 * @param {number} selectedLum
 */
function updatePreviewFixed(selectedHex, selectedLum) {
  // vs White (bg lum = 1, isLight = true)
  const tileW = /** @type {HTMLElement} */ (document.getElementById('preview-white'));
  tileW.style.background = '#ffffff';
  tileW.style.setProperty('--tile-bg', '#ffffff');
  tileW.style.color = 'rgba(0,0,0,0.55)';
  /** @type {HTMLElement} */ (document.getElementById('pvw-text-dot')).style.background = selectedHex;
  /** @type {HTMLElement} */ (document.getElementById('pvw-text-dot')).style.borderColor = 'rgba(0,0,0,0.2)';
  for (const id of ['pvw-display', 'pvw-body', 'pvw-ui']) {
    /** @type {HTMLElement} */ (document.getElementById(id)).style.color = selectedHex;
  }
  renderPreviewWcag(
    /** @type {HTMLElement} */ (document.getElementById('pvw-wcag')),
    selectedLum, 1, 1,
    hexToRgb(selectedHex), [255, 255, 255],
  );

  // vs Black (bg lum = 0, isLight = false)
  const tileB = /** @type {HTMLElement} */ (document.getElementById('preview-black'));
  tileB.style.background = '#000000';
  tileB.style.setProperty('--tile-bg', '#000000');
  tileB.style.color = 'rgba(255,255,255,0.55)';
  /** @type {HTMLElement} */ (document.getElementById('pvb-text-dot')).style.background = selectedHex;
  /** @type {HTMLElement} */ (document.getElementById('pvb-text-dot')).style.borderColor = 'rgba(255,255,255,0.25)';
  for (const id of ['pvb-display', 'pvb-body', 'pvb-ui']) {
    /** @type {HTMLElement} */ (document.getElementById(id)).style.color = selectedHex;
  }
  renderPreviewWcag(
    /** @type {HTMLElement} */ (document.getElementById('pvb-wcag')),
    selectedLum, 0, 0,
    hexToRgb(selectedHex), [0, 0, 0],
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
  // ── Tile A: selected color as TEXT on custom BACKGROUND ──
  const tileA  = /** @type {HTMLElement} */ (document.getElementById('preview-a'));
  const fgA    = getForeground(customLum);
  const dotBorderA = customLum > 0.179 ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)';
  tileA.style.background = customHex;
  tileA.style.setProperty('--tile-bg', customHex);
  tileA.style.color      = fgA;  // inherited by role labels

  for (const id of ['pa-display', 'pa-body', 'pa-ui']) {
    /** @type {HTMLElement} */ (document.getElementById(id)).style.color = selectedHex;
  }
  const paTxt = /** @type {HTMLElement} */ (document.getElementById('pa-text-dot'));
  const paBg  = /** @type {HTMLElement} */ (document.getElementById('pa-bg-dot'));
  paTxt.style.background   = selectedHex;
  paTxt.style.borderColor  = dotBorderA;
  paBg.style.background    = customHex;
  paBg.style.borderColor   = dotBorderA;
  renderPreviewWcag(
    /** @type {HTMLElement} */ (document.getElementById('pa-wcag')),
    selectedLum, customLum, customLum,
    hexToRgb(selectedHex), hexToRgb(customHex),
  );

  // ── Tile B: custom color as TEXT on selected BACKGROUND ──
  const tileB  = /** @type {HTMLElement} */ (document.getElementById('preview-b'));
  const fgB    = getForeground(selectedLum);
  const dotBorderB = selectedLum > 0.179 ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)';
  tileB.style.background = selectedHex;
  tileB.style.setProperty('--tile-bg', selectedHex);
  tileB.style.color      = fgB;

  for (const id of ['pb-display', 'pb-body', 'pb-ui']) {
    /** @type {HTMLElement} */ (document.getElementById(id)).style.color = customHex;
  }
  const pbTxt = /** @type {HTMLElement} */ (document.getElementById('pb-text-dot'));
  const pbBg  = /** @type {HTMLElement} */ (document.getElementById('pb-bg-dot'));
  pbTxt.style.background   = customHex;
  pbTxt.style.borderColor  = dotBorderB;
  pbBg.style.background    = selectedHex;
  pbBg.style.borderColor   = dotBorderB;
  renderPreviewWcag(
    /** @type {HTMLElement} */ (document.getElementById('pb-wcag')),
    customLum, selectedLum, selectedLum,
    hexToRgb(customHex), hexToRgb(selectedHex),
  );
}

// ─── Main UI update ───────────────────────────────────────────────────────────

function updateUI() {
  const [r, g, b] = selectedRgbBiased();
  const selLum    = relativeLuminance(r, g, b);
  const selHex    = toHex(r, g, b);
  const hsl       = rgbToHsl(r, g, b);

  // Swatch + accent
  document.getElementById('swatch').style.background = selHex;
  const swatchHexEl = /** @type {HTMLElement} */ (document.getElementById('swatch-hex'));
  swatchHexEl.textContent = formatHex(selHex);
  swatchHexEl.style.color = selLum > 0.179 ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.75)';
  swatchHexEl.style.setProperty('--icon-clr', selLum > 0.179 ? '#000' : '#fff');
  /** @type {HTMLElement} */ (document.getElementById('swatch-tools')).style.color =
    selLum > 0.179 ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.75)';
  document.documentElement.style.setProperty('--accent', selHex);

  // Data grid
  document.getElementById('v-hex').textContent = formatHex(selHex);
  document.getElementById('v-lum').textContent = selLum.toFixed(4);
  const hH = Math.round(hsl[0]), hS = Math.round(hsl[1] * 100), hL = Math.round(hsl[2] * 100);
  setUnitVal(document.getElementById('vh-h'), hH, '°');
  setUnitVal(document.getElementById('vh-s'), hS, '%');
  setUnitVal(document.getElementById('vh-l'), hL, '%');
  document.getElementById('v-hsl').dataset.copy = `${hH}° ${hS}% ${hL}%`;
  document.getElementById('vr-r').textContent = String(r);
  document.getElementById('vr-g').textContent = String(g);
  document.getElementById('vr-b').textContent = String(b);
  document.getElementById('v-rgb').dataset.copy = `${r} ${g} ${b}`;

  // Contrast previews
  const customLum = relativeLuminance(cR, cG, cB);
  updatePreviewFixed(selHex, selLum);
  updatePreview(selHex, customColor, selLum, customLum);

  // Marker + slider tracks
  drawMarker(selX, selY);
  updateLumSliderTrack();
  updateHueSliderTrack();
  updateSatSliderTrack();
}

// ─── State & helpers ──────────────────────────────────────────────────────────

let selHue = 312, selSat = 1, targetLum = 0.546;
let selX = CSS_SZ / 2, selY = CSS_SZ / 2;
let isDown = false;

// Custom color state (RGB is source of truth; HSL is derived/kept for sliders)
let customColor = '#66001B';
let cR = 102, cG = 0, cB = 27;
let cH = 344, cS = 1, cL = 0.2;

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
// Always starts 'off': an active lock surviving a reload would silently move
// colors at launch. The per-mode targets are still remembered.
let contrastLockMode = 'off'; // 'off' | 'wcag2' | 'apca'
let apcaLockTarget = 0;
function apcaLockActive() { return contrastLockMode === 'apca'; }
/** The target the current mode enforces (0 when the lock is off). */
function activeContrastTarget() {
  return contrastLockMode === 'apca' ? apcaLockTarget
       : contrastLockMode === 'wcag2' ? contrastLockTarget
       : 0;
}
/** Format a #rrggbb hex string according to the current stripHash preference. */
function formatHex(hex) { return stripHash ? hex.slice(1) : hex; }

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
  const customChanged = _pendingCustomSync;
  if (_pendingWheelDraw)  { drawWheel(targetLum); _pendingWheelDraw  = false; }
  if (_pendingCustomSync) { syncCustomUI();        _pendingCustomSync = false; }
  updateUI();
  // Contrast lock: adjust the side the user did NOT touch. Renders
  // scheduled by the enforcement itself are skipped to prevent ping-ponging.
  // Wheel hue/sat renders arrive with neither flag set, but still shift the
  // fg color (RGB quantization; APCA's Lc is hue-dependent even at equal
  // luminance) — treat them as fg-touched so the lock tracks every tick.
  // Redundant runs are cheap: enforcement no-ops unless the free side's
  // rendered color would actually change.
  if (_skipEnforceOnce) { _skipEnforceOnce = false; }
  else if (customChanged) enforceContrastLock('bg');
  else enforceContrastLock('fg');
  // Settle pass: during fast drags the newest input can land in the one
  // frame that skips enforcement (it coalesced with the lock's own
  // adjustment) and would otherwise stay un-enforced when the drag stops.
  // Once the frame stream goes quiet, verify and correct. Idempotent: the
  // enforcement no-ops when the pair is already pinned.
  clearTimeout(_lockSettleTimer);
  _lockSettleTimer = setTimeout(() => {
    if (activeContrastTarget() > 0) enforceContrastLock(_lastTouchedSide);
  }, 120);
}

function scheduleRender(redrawWheel, syncCustom) {
  // Remember which side the user touched last (wheel = fg, custom = bg) so a
  // contrast-target change adjusts the other one. Renders scheduled by the
  // contrast-lock enforcement itself (_skipEnforceOnce set) don't count.
  if (!_skipEnforceOnce) _lastTouchedSide = syncCustom ? 'bg' : 'fg';
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
let _lastTouchedSide = 'fg'; // which side the user adjusted most recently

/**
 * Most moderate luminance for the free side that reaches `ratio` against
 * `fixedLum`. Both boundary values meet the ratio exactly, so prefer the one
 * closer to mid luminance (0.5) — never white/black when a calmer color works.
 * Returns null when neither direction can reach it (possible for 7:1 when
 * 0.1 < fixedLum < 0.3, since max contrast is capped by white and black).
 */
function solveContrastLum(fixedLum, ratio) {
  const hi = ratio * (fixedLum + 0.05) - 0.05; // free side lighter than fixed
  const lo = (fixedLum + 0.05) / ratio - 0.05; // free side darker than fixed
  const canHi = hi <= 1, canLo = lo >= 0;
  if (!canHi && !canLo) return null;
  if (canHi && canLo) return Math.abs(hi - 0.5) <= Math.abs(lo - 0.5) ? hi : lo;
  return canHi ? hi : lo;
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
  } else {
    // Free side = wheel fg; selectedRgbBiased() biases away from the bg
    targetLum = desired;
    lumSlider.value = String(Math.round(targetLum * 1000));
    if (document.activeElement !== lumValEl) lumValEl.value = targetLum.toFixed(3);
    saveToStorage('sel-lum', String(targetLum));
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
  const dir = Math.sign(lum - relativeLuminance(cR, cG, cB));
  return hslToRgb(selHue, selSat, findLightnessBiased(selHue, selSat, lum, dir));
}

/** true when `rgb` already matches the free side's current color. */
function lockFreeAtRgb(changed, rgb) {
  const cur = changed === 'fg' ? [cR, cG, cB] : selectedRgbBiased();
  return rgb[0] === cur[0] && rgb[1] === cur[1] && rgb[2] === cur[2];
}

function enforceContrastLock(changed) {
  if (contrastLockMode === 'off') return;
  if (apcaLockActive()) { enforceApcaLock(changed); return; }
  if (!contrastLockTarget) return;
  const R = contrastLockTarget;
  // Use the luminances of the actual rendered colors (RGB-quantized)
  const fgLum = relativeLuminance(...selectedRgbBiased());
  const bgLum = relativeLuminance(cR, cG, cB);
  const fixedLum = changed === 'fg' ? fgLum : bgLum;

  const solved = solveContrastLum(fixedLum, R);
  if (solved === null) {
    setContrastLockError(
      changed === 'fg' ? `BG can't reach ${R}:1` : `Text can't reach ${R}:1`,
      changed === 'fg'
        ? `No background can reach ${R}:1 from this luminance.`
        : `No wheel color can reach ${R}:1 from this luminance.`);
    return;
  }

  // The free side is pinned to the exact boundary; directional quantization
  // in applyLockAdjustment guarantees the rendered color lands at-or-beyond
  // it (a fixed luminance overshoot would balloon the ratio margin on the
  // dark side, where (L + 0.05) makes the ratio hyper-sensitive).
  const desired = solved;

  // Skip only when the adjustment wouldn't change the free side's rendered
  // color — any real movement of the fixed side re-pins immediately
  if (lockFreeAtRgb(changed, lockFreeRgbAt(changed, desired)) && contrastRatio(fgLum, bgLum) >= R) {
    setContrastLockError('');
    return;
  }

  applyLockAdjustment(changed, desired);
  setContrastLockError('');
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
  if (!T) return;
  const fgRgb = selectedRgbBiased();
  const bgRgb = [cR, cG, cB];

  // Free side's hue/sat (preserved while its luminance moves)
  let freeHue, freeSat;
  if (changed === 'fg') { // custom bg is free
    if (customMode === 'gray')     { freeHue = 0;     freeSat = 0; }
    else if (customMode === 'lum') { freeHue = cuHue; freeSat = cuSat; }
    else                           { freeHue = cH;    freeSat = cS; }
  } else {
    freeHue = selHue; freeSat = selSat;
  }

  const lcAt = lum => {
    const rgb = hslToRgb(freeHue, freeSat, findLightness(freeHue, freeSat, lum));
    return Math.abs(changed === 'fg' ? apcaLc(fgRgb, rgb) : apcaLc(rgb, bgRgb));
  };

  const split   = relativeLuminance(...(changed === 'fg' ? fgRgb : bgRgb));
  const currentLc = Math.abs(apcaLc(fgRgb, bgRgb));

  // On each branch the satisfying region ends at a boundary: binary-search
  // from a satisfying endpoint toward the (unsatisfying) split point.
  const solveBranch = endpoint => {
    let sat = endpoint, unsat = split;
    for (let i = 0; i < 36; i++) {
      const mid = (sat + unsat) / 2;
      if (lcAt(mid) >= T) sat = mid; else unsat = mid;
    }
    return sat;
  };
  const candidates = [];
  if (lcAt(0) >= T) candidates.push(solveBranch(0));
  if (lcAt(1) >= T) candidates.push(solveBranch(1));

  if (!candidates.length) {
    setContrastLockError(
      changed === 'fg' ? `BG can't reach Lc ${T}` : `Text can't reach Lc ${T}`,
      changed === 'fg'
        ? `No background can reach |Lc| ${T} against this text color.`
        : `No wheel color can reach |Lc| ${T} on this background.`);
    return;
  }

  // Exact boundary — the directional quantization in applyLockAdjustment
  // only ever moves the color further from the split, so |Lc| stays ≥ T
  const desired = candidates.length === 2
    ? (Math.abs(candidates[0] - 0.5) <= Math.abs(candidates[1] - 0.5) ? candidates[0] : candidates[1])
    : candidates[0];

  // Skip only when the adjustment wouldn't change the free side's rendered
  // color — any real movement of the fixed side re-pins immediately
  if (lockFreeAtRgb(changed, lockFreeRgbAt(changed, desired)) && currentLc >= T) {
    setContrastLockError('');
    return;
  }

  applyLockAdjustment(changed, desired);
  setContrastLockError('');
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
        data[idx] = cR; data[idx+1] = cG; data[idx+2] = cB; data[idx+3] = alpha;
      }
    }
    cwCtx.putImageData(img, 0, 0);
    return;
  }

  // ── Lum mode: luminance-locked wheel (same as main, using cuLum) ───────────
  if (customMode === 'lum') {
    if (!_cwLumCache || _cwLumCache.lum !== cuLum) {
      const img  = cwCtx.createImageData(CW_BUF, CW_BUF);
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
          const alpha = dist > radius - 0.5
            ? Math.max(0, Math.round((radius + 1 - dist) * 255)) : 255;
          const idx = (py * CW_BUF + px) * 4;
          data[idx] = rr; data[idx+1] = gg; data[idx+2] = bb; data[idx+3] = alpha;
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
    const img  = cwCtx.createImageData(CW_BUF, CW_BUF);
    const data = img.data;
    for (let py = 0; py < CW_BUF; py++) {
      for (let px = 0; px < CW_BUF; px++) {
        const dx = px - radius, dy = py - radius;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius + 1) continue;
        const hue = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
        const sat = Math.min(dist / radius, 1);
        const [rr, gg, bb] = hslToRgb(hue, sat, cL);
        const alpha = dist > radius - 0.5
          ? Math.max(0, Math.round((radius + 1 - dist) * 255)) : 255;
        const idx = (py * CW_BUF + px) * 4;
        data[idx] = rr; data[idx+1] = gg; data[idx+2] = bb; data[idx+3] = alpha;
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
    setCustomFromHsl(hue, sat, cL);
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

  rSl.style.backgroundImage = `linear-gradient(to right,${toHex(0,cG,cB)},${toHex(255,cG,cB)})`;
  gSl.style.backgroundImage = `linear-gradient(to right,${toHex(cR,0,cB)},${toHex(cR,255,cB)})`;
  bSl.style.backgroundImage = `linear-gradient(to right,${toHex(cR,cG,0)},${toHex(cR,cG,255)})`;

  const hStops = Array.from({ length: 13 }, (_, i) => {
    const h = i * 30;
    return `${toHex(...hslToRgb(h, cS, cL))} ${Math.round(i / 12 * 100)}%`;
  });
  hSl.style.backgroundImage = `linear-gradient(to right,${hStops.join(',')})`;
  sSl.style.backgroundImage = `linear-gradient(to right,${toHex(...hslToRgb(cH,0,cL))},${toHex(...hslToRgb(cH,1,cL))})`;
  lSl.style.backgroundImage = `linear-gradient(to right,${toHex(...hslToRgb(cH,cS,0))},${toHex(...hslToRgb(cH,cS,0.5))},${toHex(...hslToRgb(cH,cS,1))})`;
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
    return `${toHex(...hslToRgb(cuHue, cuSat, l))} ${Math.round(lm * 100)}%`;
  });
  lumSl.style.backgroundImage = `linear-gradient(to right,${lumStops.join(',')})`;

  // Saturation track: achromatic → vivid at current hue/lum
  const s0 = toHex(...hslToRgb(cuHue, 0, findLightness(cuHue, 0, cuLum)));
  const s1 = toHex(...hslToRgb(cuHue, 1, findLightness(cuHue, 1, cuLum)));
  satSl.style.backgroundImage = `linear-gradient(to right,${s0},${s1})`;

  // Hue track: rotate hue at current sat/lum
  const hStops = Array.from({ length: 13 }, (_, i) => {
    const h = i * 30;
    const l = findLightness(h, cuSat, cuLum);
    return `${toHex(...hslToRgb(h, cuSat, l))} ${Math.round(i / 12 * 100)}%`;
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
      customLumSaved = { lum: cuLum, hue: cuHue, sat: cuSat };
      saveToStorage('custom-lum-v', JSON.stringify(customLumSaved));
    }
  }
  const customSwatchEl = /** @type {HTMLElement} */ (document.getElementById('custom-swatch-display'));
  customSwatchEl.style.background = customColor;
  customSwatchEl.style.color = relativeLuminance(cR, cG, cB) > 0.179
    ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.75)';

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
  /** @type {HTMLInputElement} */ (document.getElementById('custom-hex-input')).value = formatHex(toHex(cR, cG, cB));
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

lumSlider.addEventListener('input', () => {
  targetLum = lumSlider.value / 1000;
  if (document.activeElement !== lumValEl) lumValEl.value = targetLum.toFixed(3);
  scheduleRender(true);
  saveToStorage('sel-lum', String(targetLum));
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
  cH = +/** @type {HTMLInputElement} */ (e.target).value;
  [cR, cG, cB] = hslToRgb(cH, cS, cL);
  scheduleRender(false, true);
});
document.getElementById('c-s-slider').addEventListener('input', e => {
  cS = +/** @type {HTMLInputElement} */ (e.target).value / 100;
  [cR, cG, cB] = hslToRgb(cH, cS, cL);
  scheduleRender(false, true);
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

// ─── Lum mode sliders ─────────────────────────────────────────────────────────

function setCustomFromLumHueSat(lum, hue, sat) {
  cuLum = Math.max(0, Math.min(1, lum));
  cuHue = ((hue % 360) + 360) % 360;
  cuSat = Math.max(0, Math.min(1, sat));
  // Quantization biased away from the wheel side's target luminance — the
  // mirror of selectedRgbBiased(), so hue/sat sweeps in Lum mode can't
  // flicker across a contrast boundary either
  const l = findLightnessBiased(cuHue, cuSat, cuLum, Math.sign(cuLum - targetLum));
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
  saveToStorage('sel-lum', String(targetLum));
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
  v => { cH = v; /** @type {HTMLInputElement} */ (document.getElementById('c-h-slider')).value = String(v); [cR, cG, cB] = hslToRgb(cH, cS, cL); scheduleRender(false, true); },
  true
);
wireValInput(
  /** @type {HTMLInputElement} */ (document.getElementById('c-s-val')),
  0, 100, 1, str => Math.round(parseFloat(str)), v => v + '%',
  v => { cS = v / 100; /** @type {HTMLInputElement} */ (document.getElementById('c-s-slider')).value = String(v); [cR, cG, cB] = hslToRgb(cH, cS, cL); scheduleRender(false, true); }
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
      cuLum = Math.max(0.001, relativeLuminance(cR, cG, cB));
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
      cuLum = Math.max(0.001, relativeLuminance(cR, cG, cB));
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
  let val = customHexInput.value.replace(/[^0-9a-fA-F#]/g, '');
  if (val && !val.startsWith('#')) val = '#' + val;
  if (val.length > 7) val = val.slice(0, 7);
  customHexInput.value = val.toUpperCase();
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    const [r, g, b] = hexToRgb(val);
    cR = r; cG = g; cB = b;
    [cH, cS, cL] = rgbToHsl(r, g, b);
    scheduleRender(false, true);
  }
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
  const v = customHexInput.value;
  const full = /^#/i.test(v) ? v : '#' + v;
  customHexInput.value = /^#[0-9a-fA-F]{6}$/i.test(full)
    ? formatHex(full.toUpperCase())
    : formatHex(customColor);
});
customHexInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') customHexInput.blur();
});

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
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}

document.addEventListener('click', e => {
  const el = /** @type {HTMLElement | null} */ (
    /** @type {HTMLElement} */ (e.target).closest('.copyable')
  );
  if (!el || el.classList.contains('copied')) return;
  copyToClipboard(el.dataset.copy ?? el.textContent.trim());
  el.classList.add('copied');
  setTimeout(() => el.classList.remove('copied'), 1500);
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
  });
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

  function storedLockTarget() {
    const t = parseFloat(localStorage.getItem('contrast-lock-target') ?? '0');
    return t === 3 || t === 4.5 || t === 7 ? t : 0;
  }
  function storedApcaTarget() {
    const t = parseFloat(localStorage.getItem('contrast-lock-apca-target') ?? '0');
    return t === 45 || t === 60 || t === 75 || t === 90 ? t : 0;
  }
  // The target groups swap with the selected mode; Off hides both
  function refreshLockUI() {
    modeBtns.forEach(b => b.classList.toggle('active', b.dataset.lockmode === contrastLockMode));
    wcagWrap.hidden = contrastLockMode !== 'wcag2';
    apcaWrap.hidden = contrastLockMode !== 'apca';
  }

  function setLockTarget(target, persist) {
    contrastLockTarget = target;
    lockBtns.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.target) === target));
    setContrastLockError('');
    if (persist) { try { localStorage.setItem('contrast-lock-target', String(target)); } catch(e) {} }
    // The side the user touched last stays put; the other one gets adjusted
    if (target > 0) enforceContrastLock(_lastTouchedSide);
  }

  function setApcaTarget(target, persist) {
    apcaLockTarget = target;
    apcaBtns.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.apcaTarget) === target));
    setContrastLockError('');
    if (persist) { try { localStorage.setItem('contrast-lock-apca-target', String(target)); } catch(e) {} }
    if (target > 0) enforceContrastLock(_lastTouchedSide);
  }

  // Restore the per-mode targets only — the mode itself always launches
  // 'off' so a reload never starts silently adjusting colors
  try {
    contrastLockTarget = storedLockTarget();
    apcaLockTarget = storedApcaTarget();
  } catch(e) {}
  lockBtns.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.target) === contrastLockTarget));
  apcaBtns.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.apcaTarget) === apcaLockTarget));

  refreshLockUI();

  modeBtns.forEach(btn => btn.addEventListener('click', () => {
    const m = btn.dataset.lockmode;
    contrastLockMode = m === 'apca' || m === 'off' ? m : 'wcag2';
    setContrastLockError('');
    refreshLockUI();
    if (activeContrastTarget() > 0) enforceContrastLock(_lastTouchedSide);
  }));

  lockBtns.forEach(btn => btn.addEventListener('click', () => {
    setLockTarget(parseFloat(/** @type {HTMLElement} */ (btn).dataset.target), true);
  }));

  apcaBtns.forEach(btn => btn.addEventListener('click', () => {
    setApcaTarget(parseFloat(/** @type {HTMLElement} */ (btn).dataset.apcaTarget), true);
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
} catch(e) {}

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
    cuLum = Math.max(0.001, relativeLuminance(cR, cG, cB));
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
    p.set('l', String(Math.round(targetLum * 1000)));
    p.set('c', toHex(cR, cG, cB).slice(1).toLowerCase());
    p.set('m', customMode);
    if (customMode === 'lum') {
      p.set('cl', String(Math.round(cuLum * 1000)));
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

// Color value format for exports: 'oklch' (default) or 'hex'. Shared by the
// Preferences preview and the palette sidebar; toggled via any
// .export-colorfmt-btn and persisted across sessions.
let exportColorFmt = 'oklch';
try {
  const v = localStorage.getItem('export-color-fmt');
  if (v === 'hex' || v === 'oklch') exportColorFmt = v;
} catch (e) {}

const _exportColorFmtListeners = [];
/** Register a callback fired whenever the export color format changes. */
function onExportColorFmtChange(fn) { _exportColorFmtListeners.push(fn); }

function syncExportColorFmtButtons() {
  document.querySelectorAll('.export-colorfmt-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.colorfmt === exportColorFmt));
}

function setExportColorFmt(fmt) {
  if ((fmt !== 'hex' && fmt !== 'oklch') || fmt === exportColorFmt) return;
  exportColorFmt = fmt;
  try { localStorage.setItem('export-color-fmt', fmt); } catch (e) {}
  syncExportColorFmtButtons();
  _exportColorFmtListeners.forEach(fn => fn());
}

// Delegated so one handler covers both the static Preferences buttons and the
// ones the palette sidebar builds later.
document.addEventListener('click', e => {
  const btn = e.target.closest?.('.export-colorfmt-btn');
  if (btn) setExportColorFmt(btn.dataset.colorfmt);
});

function buildExport(format) {
  // Export the palette grouped by role. Each role's first pinned color is its
  // primary, the second its secondary, then plain ordinals. The color live in
  // the main picker (wheel for text, custom for background) is always included
  // too, appended unless that role already holds it.
  const wheelHex  = toHex(...selectedRgbBiased()).toLowerCase();
  const customHex = toHex(cR, cG, cB).toLowerCase();
  const roleColors = (role, liveHex) => {
    const hexes = palette.filter(e => e.role === role).map(e => e.hex);
    if (!hexes.includes(liveHex)) hexes.push(liveHex);
    return hexes.map(hex => ({ hex, lum: relativeLuminance(...hexToRgb(hex)) }));
  };
  const text = roleColors('fg', wheelHex);
  const bg   = roleColors('bg', customHex);
  const RANKS = ['primary', 'secondary', 'tertiary', 'quaternary'];
  const key = pos => RANKS[pos] || String(pos + 1);
  const ratio = contrastRatio(text[0].lum, bg[0].lum); // text-primary vs bg-primary

  // Color value in the chosen format; hex keeps the source, OKLCH is the modern
  // CSS color space. The unused representation is kept in a comment for reference.
  const isHex = exportColorFmt === 'hex';

  if (format === 'css') {
    const cssLine = (name, c) => isHex
      ? `  ${name}: ${c.hex.toLowerCase()};  /* ${oklchCss(c.hex)} — luminance ${c.lum.toFixed(4)} */`
      : `  ${name}: ${oklchCss(c.hex)};  /* ${c.hex.toLowerCase()} — luminance ${c.lum.toFixed(4)} */`;
    const lines = [
      ...text.map((c, i) => cssLine(`--color-text-${key(i)}`, c)),
      ...bg.map((c, i)   => cssLine(`--color-bg-${key(i)}`, c)),
    ];
    return `:root {
  /* text-primary vs bg-primary contrast ${ratio.toFixed(2)}:1 — relative-luminous-color-wheel.vercel.app */
${lines.join('\n')}
}
`;
  }
  if (format === 'tailwind') {
    // Tailwind v4 @theme; its default palette is OKLCH, so OKLCH is idiomatic.
    const twLine = (name, c) => isHex
      ? `  ${name}: ${c.hex.toLowerCase()};  /* ${oklchCss(c.hex)} */`
      : `  ${name}: ${oklchCss(c.hex)};  /* ${c.hex.toLowerCase()} */`;
    const lines = [
      ...text.map((c, i) => twLine(`--color-text-${key(i)}`, c)),
      ...bg.map((c, i)   => twLine(`--color-bg-${key(i)}`, c)),
    ];
    return `@theme {
${lines.join('\n')}
}
`;
  }
  // W3C Design Tokens (DTCG) 2025.10: color $value is an object with a
  // colorSpace + components array; `hex` is the optional sRGB fallback.
  const colorToken = c => {
    if (isHex) {
      const [r, g, b] = hexToRgb(c.hex);
      const comp = [r, g, b].map(v => +(v / 255).toFixed(4));
      return { $value: { colorSpace: 'srgb', components: comp, alpha: 1, hex: c.hex.toLowerCase() } };
    }
    return { $value: { colorSpace: 'oklch', components: oklchComponents(c.hex), alpha: 1, hex: c.hex.toLowerCase() } };
  };
  const groupTokens = list => Object.fromEntries(list.map((c, i) => [key(i), colorToken(c)]));
  const json = {
    $description: `Accessible color palette exported from the Relative Luminous Color Wheel (relative-luminous-color-wheel.vercel.app). Colors are ${isHex ? 'sRGB' : 'OKLCH'} per the W3C Design Tokens format (2025.10); each carries an sRGB hex fallback.`,
    color: {
      $type: 'color',
      text: groupTokens(text),
      bg:   groupTokens(bg),
    },
    $extensions: {
      'relative-luminous-color-wheel': {
        textBgContrastRatio: +ratio.toFixed(2),
        textLuminances: text.map(c => +c.lum.toFixed(4)),
        bgLuminances:   bg.map(c => +c.lum.toFixed(4)),
      },
    },
  };
  return JSON.stringify(json, null, 2) + '\n';
}

// Filename + MIME per export format (all plain text; extensions match syntax)
const EXPORT_FILE = {
  css:      { name: 'color-palette.css',          mime: 'text/css' },
  tailwind: { name: 'color-palette.tailwind.css', mime: 'text/css' },
  json:     { name: 'color-palette.tokens.json',  mime: 'application/json' },
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

{
  const previewEl  = /** @type {HTMLElement} */ (document.getElementById('export-preview'));
  const previewCode = /** @type {HTMLElement} */ (document.getElementById('export-preview-code'));
  const previewCopy = /** @type {HTMLButtonElement} */ (document.getElementById('export-preview-copy'));
  const previewDl  = /** @type {HTMLButtonElement} */ (document.getElementById('export-preview-dl'));
  const exportBtns = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('.export-option')]);
  const wrapEl = /** @type {HTMLElement} */ (previewEl.closest('.settings-wrap'));

  // Click-only selection (no hover previews): one tab is pinned and its
  // preview stays visible — across popper close/reopen too. Clicking the
  // pinned tab again hides the preview. JSON starts selected.
  let pinnedFormat = /** @type {string | null} */ ('json');
  let previewFormat = 'json';

  const render = format => {
    previewFormat = format;
    previewCode.textContent = buildExport(format);
  };

  // Visibility/active state only — content is rendered lazily. This runs at
  // module init, before `palette` (declared further down) exists, so calling
  // buildExport() here would throw and abort the whole script.
  const sync = () => {
    exportBtns.forEach(b => b.classList.toggle('active', b.dataset.format === pinnedFormat));
    previewEl.hidden = pinnedFormat === null;
  };

  previewCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(buildExport(previewFormat));
      previewCopy.classList.add('copied');
      setTimeout(() => { previewCopy.classList.remove('copied'); }, 1500);
    } catch (_) { /* clipboard denied */ }
  });

  previewDl.addEventListener('click', () => {
    downloadExport(previewFormat);
    previewDl.classList.add('done');
    setTimeout(() => { previewDl.classList.remove('done'); }, 1500);
  });

  exportBtns.forEach(btn => {
    const format = btn.dataset.format;
    btn.addEventListener('click', () => {
      pinnedFormat = pinnedFormat === format ? null : format;
      sync();
      if (pinnedFormat !== null) render(pinnedFormat);
    });
  });

  // The popper opens via CSS :hover on the wrap, so this always fires before
  // the panel is seen — it both fills the initial JSON preview and refreshes
  // a pinned one on reopen (colors may have changed meanwhile)
  wrapEl.addEventListener('mouseenter', () => {
    if (pinnedFormat !== null) render(pinnedFormat);
  });

  // Re-render the live preview when the OKLCH/HEX color format toggles.
  onExportColorFmtChange(() => { if (pinnedFormat !== null) render(pinnedFormat); });

  sync();
}

// ─── Palette sidebar export ───────────────────────────────────────────────────
// The sidebar surfaces the same export formats as Preferences (palette colors
// are included), so users can copy or download straight from the palette.
{
  const host = /** @type {HTMLElement} */ (document.getElementById('palette-export'));
  const DL_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 20h14"/></svg>';
  const FORMATS = [['css', 'CSS'], ['tailwind', 'Tailwind'], ['json', 'JSON']];

  const flash = (btn, cls) => { btn.classList.add(cls); setTimeout(() => btn.classList.remove(cls), 1500); };

  // OKLCH/HEX color-format toggle, shared with the Preferences export (a single
  // delegated click handler drives every .export-colorfmt-btn on the page).
  const fmtRow = document.createElement('div');
  fmtRow.className = 'palette-export-row palette-colorfmt-row';
  const fmtLabel = document.createElement('span');
  fmtLabel.className = 'palette-export-fmt';
  fmtLabel.textContent = 'Color format';
  const fmtBtns = document.createElement('div');
  fmtBtns.className = 'palette-colorfmt-btns';
  for (const cf of ['oklch', 'hex']) {
    const b = document.createElement('button');
    b.className = 'palette-colorfmt-btn export-colorfmt-btn';
    b.dataset.colorfmt = cf;
    b.textContent = cf.toUpperCase();
    b.title = `Export colors as ${cf.toUpperCase()}`;
    fmtBtns.appendChild(b);
  }
  fmtRow.append(fmtLabel, fmtBtns);
  host.appendChild(fmtRow);

  for (const [format, label] of FORMATS) {
    const row = document.createElement('div');
    row.className = 'palette-export-row';

    const name = document.createElement('span');
    name.className = 'palette-export-fmt';
    name.textContent = label;

    const copy = document.createElement('button');
    copy.className = 'palette-export-act palette-export-copy';
    copy.title = `Copy ${label}`;
    copy.setAttribute('aria-label', `Copy ${label}`);
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(buildExport(format));
        flash(copy, 'copied');
      } catch (_) { /* clipboard denied */ }
    });

    const dl = document.createElement('button');
    dl.className = 'palette-export-act palette-export-dl';
    dl.title = `Download ${label}`;
    dl.setAttribute('aria-label', `Download ${label}`);
    dl.innerHTML = DL_SVG;
    dl.addEventListener('click', () => { downloadExport(format); flash(dl, 'done'); });

    row.append(name, copy, dl);
    host.appendChild(row);
  }

  // Reflect the persisted format on every toggle button now that they all exist.
  syncExportColorFmtButtons();
}

// ─── Color-vision-deficiency simulation ───────────────────────────────────────
// Machado et al. 2009 matrices live as SVG feColorMatrix filters in index.html.
// The filter goes on #cvd-layer (a wrapper around all app content), not <body>:
// iOS Safari won't apply a body-level SVG filter to compositing layers such as
// the WebGL wheel or the animated Preferences popup, but a regular wrapper
// element rasterizes them into the filter correctly. body.cvd-active switches
// the wrapper from display:contents to a real (filterable) box.
// Intentionally not persisted: a simulation surviving reload would look broken.

{
  const cvdLayer = /** @type {HTMLElement} */ (document.getElementById('cvd-layer'));
  const cvdSidebar = /** @type {HTMLElement} */ (document.getElementById('palette-section'));
  const cvdBtns = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('.settings-theme-btn[data-cvd]')]);
  cvdBtns.forEach(btn => btn.addEventListener('click', () => {
    cvdBtns.forEach(b => b.classList.toggle('active', b === btn));
    const v = btn.dataset.cvd;
    document.body.classList.toggle('cvd-active', !!v);
    const f = v ? `url(#cvd-${v})` : '';
    cvdLayer.style.filter = f;
    // The palette sidebar sits outside #cvd-layer (a fixed / compositing layer
    // that iOS Safari won't rasterize through an ancestor filter), so filter it
    // directly — this covers the saved colors, the inline editor and its preview.
    cvdSidebar.style.filter = f;
    // iOS Safari doesn't re-run an SVG filter over the already-painted WebGL
    // wheel when the filter is (un)set, so the wheel keeps its unfiltered
    // pixels. Repaint it now that the filter state has changed so the fresh
    // canvas rasterizes through the filter.
    scheduleRender(true);
  }));
}

// ─── Palette rail + contrast matrix ───────────────────────────────────────────
// Pinned colors persist in localStorage and travel in the share URL (`p`,
// governed by the "Color in share link" preference). The section is hidden
// while empty so it never affects the height-fitted layouts.

// Per role: only the first four get names (primary / secondary / tertiary /
// quaternary); further colors are still storable up to this reasonable cap.
const PALETTE_ROLE_MAX = 10;
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
let _paletteInteracted = false;

function applyPaletteOpen() {
  clearTimeout(_paletteCloseTimer);
  if (paletteOpen) {
    paletteSection.classList.remove('palette-section--closing');
    paletteSection.hidden = false;
    syncSidebarHeight(); // pin to the visible viewport now that it's showing
  } else if (!paletteSection.hidden) {
    // Mirror of the slide-in: play the slide-out, then actually hide
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

// Pin the sidebar to the *visible* viewport. iOS Safari's 100dvh can briefly
// report the toolbar-hidden (large) height while the toolbar is actually shown
// — notably as the drawer opens — pushing the pinned-to-bottom export footer
// under the toolbar so the bottom looks cut off. visualViewport.height is the
// ground truth; the inline px height overrides the CSS 100dvh fallback.
function syncSidebarHeight() {
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  if (h) paletteSection.style.height = h + 'px';
}
syncSidebarHeight();
window.addEventListener('resize', syncSidebarHeight);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncSidebarHeight);
  window.visualViewport.addEventListener('scroll', syncSidebarHeight);
}

// Hovering the toggle opens the sidebar (mouse only — on touch, the tap's
// synthesized pointerenter would open it just before click toggled it shut).
// A click that lands while the hover-open is still active is absorbed, so
// hover-then-click out of habit doesn't immediately close the drawer.
let _paletteHoverOpened = false;
paletteToggle.addEventListener('pointerenter', e => {
  if (e.pointerType === 'mouse' && !paletteOpen) {
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
  const railScrolls = paletteRail.scrollHeight > paletteRail.clientHeight
    && paletteRail.contains(/** @type {Node} */ (e.target));
  if (!railScrolls) e.preventDefault();
}, { passive: false });

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
  // don't let this close it first (that would flicker close→open)
  if (t.closest && (t.closest('.pin-btn') || t.closest('.preview-palette'))) return;
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

function addToPalette(hex, role) {
  if (_ceIdx !== null) closeChipEditor(true); // structural change → close the inline editor
  hex = hex.toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(hex)) return;
  // Duplicates within a role are ignored; each role holds up to four colors
  // (primary / secondary / tertiary / quaternary)
  if (palette.some(e => e.hex === hex && e.role === role)) return;
  if (palette.filter(e => e.role === role).length >= PALETTE_ROLE_MAX) return;
  palette.push({ hex, role });
  savePalette();
  renderPalette();
  // Pinning while the sidebar is closed opens it so the color visibly lands
  if (!paletteOpen) setPaletteOpen(true);
}

function removeFromPalette(index) {
  if (_ceIdx !== null) closeChipEditor(true); // indices shift → close the inline editor
  palette.splice(index, 1);
  savePalette();
  renderPalette();
}

/** Reorder within one role (fg/bg) — moving `from`→`to` among that role's
    entries while leaving the other role's entries untouched. The top entry of
    each role is its "primary", the second its "secondary". */
function reorderRole(role, from, to) {
  const flatIdx = [];
  palette.forEach((e, i) => { if (e.role === role) flatIdx.push(i); });
  const items = flatIdx.map(i => palette[i]);
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
  flatIdx.forEach((fi, k) => { palette[fi] = items[k]; });
  savePalette();
}

// ─── Pointer-based reorder (iOS-home-screen style) ────────────────────────────
// Mouse: a 5px move lifts the chip. Touch: a 300ms still hold lifts it (a
// quicker vertical move stays a scroll). The lifted chip tracks the pointer
// 1:1 while siblings slide out of the way with a transform transition; on
// release it settles into its slot before the order is committed.
let _chipDragActive = false;
// Hard-reset hook for a wedged drag. A dropped pointerup (mouse released
// off-window, capture lost mid-transform) can otherwise leave a drag stuck in
// its lifted state and _chipDragActive latched true; the next press calls this
// to recover synchronously before starting fresh.
let _forceEndActiveDrag = null;

function attachChipDrag(chip, index, role, listEl) {
  chip.addEventListener('contextmenu', e => e.preventDefault()); // long-press menu
  chip.addEventListener('pointerdown', e => {
    // Recover any drag that never received its pointerup so it can't block this
    // press (previously the user had to click repeatedly to jog it loose).
    if (_forceEndActiveDrag) _forceEndActiveDrag();
    if (_chipDragActive || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // Buttons (edit / copy / remove) own their clicks — everything else on
    // the chip is a drag handle, so the two gestures never compete
    if (/** @type {HTMLElement} */ (e.target).closest('button')) return;
    const isTouch = e.pointerType !== 'mouse';
    const startY = e.clientY, startX = e.clientX;
    // Reorder is scoped to this role's list, so a Text chip stays among Text
    const chips = /** @type {HTMLElement[]} */ ([...listEl.querySelectorAll('.palette-chip')]);
    const slot = chip.offsetHeight + (parseFloat(getComputedStyle(listEl).rowGap) || 0);
    let lifted = false;
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
      chip.style.transform = 'scale(1.03)';
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
      chips.forEach(c => {
        c.classList.remove('palette-chip--lifted', 'palette-chip--settling');
        c.style.transform = '';
      });
    };

    // Insertion slot for a given pointer Y, clamped to the list span
    const targetForY = clientY =>
      Math.max(0, Math.min(chips.length - 1, index + Math.round((clientY - startY) / slot)));

    const applyTarget = ti => {
      if (ti === targetIndex) return;
      targetIndex = ti;
      chips.forEach((c, j) => {
        if (c === chip) return;
        let shift = 0;
        if (index < targetIndex && j > index && j <= targetIndex) shift = -slot;
        else if (index > targetIndex && j >= targetIndex && j < index) shift = slot;
        c.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };

    const onMove = ev => {
      const rawDy = ev.clientY - startY;
      if (!lifted) {
        // Touch before the hold fires = scroll intent; mouse needs a 5px move
        if (isTouch) {
          if (Math.hypot(ev.clientX - startX, rawDy) > 8) forceEnd();
          return;
        }
        if (Math.hypot(ev.clientX - startX, rawDy) <= 5) return;
        lift();
      }
      // Free movement — only the insertion target is clamped to the list span
      chip.style.transform = `translateY(${rawDy}px) scale(1.03)`;
      applyTarget(targetForY(ev.clientY));
    };

    // Commit on release in a single tick: reorder the data, re-render, and drop
    // the drag lock together. (A deferred settle animation used to hold the lock
    // ~190ms; a quick second grab landing in that window was swallowed, so the
    // reorder looked like it silently failed / sprang back.)
    const settle = commit => {
      if (ended) return;
      ended = true;
      removeListeners();
      _forceEndActiveDrag = null;
      _chipDragActive = false;
      paletteSection.classList.remove('palette-section--dragging');
      if (!lifted) return;
      if (commit && targetIndex !== index) reorderRole(role, index, targetIndex);
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
      if (lifted) applyTarget(targetForY(y));
      settle(true);
    };
    const onCancel = () => settle(false);

    _forceEndActiveDrag = forceEnd;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    chip.addEventListener('lostpointercapture', onCancel);
    if (isTouch) holdTimer = setTimeout(lift, 300);
  });
}

/** Rank name by position within a role group: 0 → Primary, 1 → Secondary,
    then the plain ordinal. Shared by the sidebar badges and the export. */
const PALETTE_RANKS = ['Primary', 'Secondary', 'Tertiary', 'Quaternary'];
function paletteRankLabel(pos) {
  return PALETTE_RANKS[pos] || String(pos + 1);
}

// Icons for the palette chips / group headers
const PENCIL_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125"/></svg>';
const PLUS_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg>';

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
let _ce = null;        // working state { role, r, g, b, mode, hsl, lum, gray }
let _cePartner = 0;    // partner-color cycle index
let _ceRaf = 0;        // rAF gate for wheel + preview repaint
let _ceWheelCache = null;

const _ceClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function chipEditorActiveIdx() { return _ceIdx; }

function buildChipEditor() {
  _ceEl = /** @type {HTMLElement} */ (_chipEditorTpl.content.firstElementChild.cloneNode(true));
  const q = sel => _ceEl.querySelector(sel);
  _ceRefs = {
    tabs:   [..._ceEl.querySelectorAll('[data-emode]')],
    groups: [..._ceEl.querySelectorAll('[data-egroup]')],
    wheel:  q('.chip-editor-wheel'),
    hex:    q('.chip-editor-hex'),
    hexCopy: q('.chip-editor-hex-copy'),
    tile:   q('.chip-editor-tile'),
    ag:     q('.chip-editor-ag'),
    cmpBtn: q('.chip-editor-cmp-btn'),
    dropdown: q('.chip-editor-dropdown'),
    cmpRole: q('.chip-editor-cmp-role'),
    ratio:  q('.chip-editor-cmp-ratio'),
    badges: q('.chip-editor-badges'),
    done:   q('.chip-editor-done'),
    ranges: {}, vals: {},
  };
  _ceEl.querySelectorAll('[data-ch]').forEach(inp => { _ceRefs.ranges[inp.dataset.ch] = inp; });
  _ceEl.querySelectorAll('[data-chv]').forEach(inp => { _ceRefs.vals[inp.dataset.chv] = inp; });
  // Render at device resolution (CSS holds the display size at 132px) so the
  // circle edge downsamples smoothly like the main wheels, not jagged.
  const wdpr = Math.min(window.devicePixelRatio || 1, 2);
  _ceRefs.wheel.width = _ceRefs.wheel.height = Math.round(132 * wdpr);
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
  Object.values(_ceRefs.vals).forEach(inp => inp.addEventListener('change', onChipEditorValInput));
  _ceRefs.done.addEventListener('click', () => closeChipEditor());
  _ceRefs.hex.addEventListener('change', () => {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(_ceRefs.hex.value.trim());
    if (m) chipEditorSetRgb(...hexToRgb('#' + m[1]));
    else _ceRefs.hex.value = toHex(_ce.r, _ce.g, _ce.b);
  });
  // Match the main custom hex field: focusing/tapping selects all; the icon copies
  _ceRefs.hex.addEventListener('focus', () => _ceRefs.hex.select());
  _ceRefs.hex.addEventListener('click', () => _ceRefs.hex.select());
  _ceRefs.hexCopy.addEventListener('click', () => {
    copyToClipboard(formatHex(toHex(_ce.r, _ce.g, _ce.b)));
    _ceRefs.hex.classList.add('hex-copied');
    _ceRefs.hexCopy.classList.add('hex-copied');
    setTimeout(() => {
      _ceRefs.hex.classList.remove('hex-copied');
      _ceRefs.hexCopy.classList.remove('hex-copied');
    }, 1500);
  });
  _ceRefs.cmpBtn.addEventListener('click', toggleChipEditorDropdown);
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
  const list = partnerList();
  if (!list.length) {
    const info = document.createElement('div');
    info.className = 'chip-editor-dd-item';
    info.setAttribute('disabled', '');
    info.textContent = `No saved ${chipEditorOppRole() === 'fg' ? 'text' : 'background'} colors`;
    dd.appendChild(info);
    return;
  }
  const roleLabel = chipEditorOppRole() === 'fg' ? 'TEXT' : 'BG';
  list.forEach((hex, i) => {
    const it = document.createElement('button');
    it.type = 'button';
    it.className = 'chip-editor-dd-item';
    it.setAttribute('role', 'option');
    it.setAttribute('aria-selected', String(i === _cePartner));
    // Role type (TEXT / BG) leads, then the rank name; hex is a muted suffix.
    const rl = document.createElement('span'); rl.className = 'chip-editor-dd-role'; rl.textContent = roleLabel;
    const sw = document.createElement('span'); sw.className = 'chip-editor-dd-swatch'; sw.style.background = hex;
    const nm = document.createElement('span'); nm.className = 'chip-editor-dd-name'; nm.textContent = paletteRankLabel(i);
    const hx = document.createElement('span'); hx.className = 'chip-editor-dd-hex'; hx.textContent = formatHex(hex);
    it.append(rl, sw, nm, hx);
    if (i === _cePartner) { const ck = document.createElement('span'); ck.className = 'chip-editor-dd-check'; ck.textContent = '✓'; it.appendChild(ck); }
    it.addEventListener('click', () => { _cePartner = i; chipEditorRenderPreview(); closeChipEditorDropdown(); });
    dd.appendChild(it);
  });
}

function openChipEditorDropdown() {
  buildChipEditorDropdown();
  _ceRefs.dropdown.hidden = false;
  _ceRefs.cmpBtn.setAttribute('aria-expanded', 'true');
  // capture phase so the editor's own stopPropagation doesn't hide these clicks
  document.addEventListener('pointerdown', _ceDropdownOutside, true);
}

function closeChipEditorDropdown() {
  if (!_ceRefs || _ceRefs.dropdown.hidden) return;
  _ceRefs.dropdown.hidden = true;
  _ceRefs.cmpBtn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', _ceDropdownOutside, true);
}

function _ceDropdownOutside(e) {
  const t = e.target;
  if (!_ceRefs.dropdown.contains(t) && !_ceRefs.cmpBtn.contains(t)) closeChipEditorDropdown();
}

function reseedSubstates() {
  const { r, g, b } = _ce;
  const [h, s, l] = rgbToHsl(r, g, b);
  _ce.hsl  = [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
  _ce.lum  = [Math.round(relativeLuminance(r, g, b) * 1000), Math.round(s * 100), Math.round(h)];
  _ce.gray = Math.round((r + g + b) / 3);
}

function applyChipEditorMode(mode) {
  _ce.mode = mode;
  _ceRefs.tabs.forEach(t => t.classList.toggle('active', t.dataset.emode === mode));
  _ceRefs.groups.forEach(gr => gr.classList.toggle('active', gr.dataset.egroup === mode));
  _ceRefs.wheel.hidden = (mode === 'gray');
}

function setChipEditorMode(mode) {
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

function syncChipEditorHex() { _ceRefs.hex.value = toHex(_ce.r, _ce.g, _ce.b); }

function syncChipEditorControls() {
  syncChipEditorRanges();
  syncChipEditorVals();
  syncChipEditorHex();
  scheduleChipEditorPaint();
}

function scheduleChipEditorPaint() {
  if (_ceRaf) return;
  _ceRaf = requestAnimationFrame(() => {
    _ceRaf = 0;
    renderChipEditorWheel();
    renderChipEditorSliderTracks();
    chipEditorRenderPreview();
  });
}

// Colour the active mode's slider tracks, mirroring the main custom picker so
// each slider previews the color it produces.
function renderChipEditorSliderTracks() {
  if (!_ceEl) return;
  const R = _ceRefs.ranges, { r, g, b } = _ce;
  if (_ce.mode === 'rgb') {
    R.r.style.backgroundImage = `linear-gradient(to right,${toHex(0, g, b)},${toHex(255, g, b)})`;
    R.g.style.backgroundImage = `linear-gradient(to right,${toHex(r, 0, b)},${toHex(r, 255, b)})`;
    R.b.style.backgroundImage = `linear-gradient(to right,${toHex(r, g, 0)},${toHex(r, g, 255)})`;
  } else if (_ce.mode === 'hsl') {
    const [h, s, l] = _ce.hsl, sf = s / 100, lf = l / 100;
    const hStops = Array.from({ length: 13 }, (_, i) => `${toHex(...hslToRgb(i * 30, sf, lf))} ${Math.round(i / 12 * 100)}%`);
    R.h.style.backgroundImage = `linear-gradient(to right,${hStops.join(',')})`;
    R.s.style.backgroundImage = `linear-gradient(to right,${toHex(...hslToRgb(h, 0, lf))},${toHex(...hslToRgb(h, 1, lf))})`;
    R.l.style.backgroundImage = `linear-gradient(to right,${toHex(...hslToRgb(h, sf, 0))},${toHex(...hslToRgb(h, sf, 0.5))},${toHex(...hslToRgb(h, sf, 1))})`;
  } else if (_ce.mode === 'lum') {
    const [lm, s, h] = _ce.lum, sf = s / 100, lumT = lm / 1000;
    const lumStops = [0, 0.04, 0.18, 0.40, 0.65, 1.0].map(x => `${toHex(...hslToRgb(h, sf, findLightness(h, sf, x)))} ${Math.round(x * 100)}%`);
    R.clum.style.backgroundImage = `linear-gradient(to right,${lumStops.join(',')})`;
    R.csat.style.backgroundImage = `linear-gradient(to right,${toHex(...hslToRgb(h, 0, findLightness(h, 0, lumT)))},${toHex(...hslToRgb(h, 1, findLightness(h, 1, lumT)))})`;
    const hStops = Array.from({ length: 13 }, (_, i) => `${toHex(...hslToRgb(i * 30, sf, findLightness(i * 30, sf, lumT)))} ${Math.round(i / 12 * 100)}%`);
    R.chue.style.backgroundImage = `linear-gradient(to right,${hStops.join(',')})`;
  }
  // Gray uses the static black→white .custom-gray-slider gradient.
}

function chipEditorWriteThrough() {
  const hex = toHex(_ce.r, _ce.g, _ce.b).toLowerCase();
  if (_ceIdx != null && palette[_ceIdx]) {
    palette[_ceIdx].hex = hex;
    updateChipVisual(_ceIdx, hex);
    savePalette(); // saveToStorage is debounced, so per-tick calls are cheap
  }
}

function updateChipVisual(idx, hex) {
  const chipEl = paletteRail.querySelector(`.palette-chip[data-idx="${idx}"]`);
  if (!chipEl) return;
  const [r, g, b] = hexToRgb(hex);
  const lum = relativeLuminance(r, g, b);
  chipEl.style.background = hex;
  chipEl.style.color = lum > 0.179 ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.85)';
  const hx = chipEl.querySelector('.palette-chip-hex');
  if (hx) hx.textContent = formatHex(toHex(r, g, b));
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
  if (_ce.mode === 'rgb')      { set(R.r, n(V.r.value), 0, 255); set(R.g, n(V.g.value), 0, 255); set(R.b, n(V.b.value), 0, 255); }
  else if (_ce.mode === 'hsl') { set(R.h, n(V.h.value), 0, 359); set(R.s, n(V.s.value), 0, 100); set(R.l, n(V.l.value), 0, 100); }
  else if (_ce.mode === 'lum') { set(R.clum, n(V.clum.value) * 1000, 0, 1000); set(R.csat, n(V.csat.value), 0, 100); set(R.chue, n(V.chue.value), 0, 359); }
  else                         { set(R.gray, n(V.gray.value), 0, 255); }
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
  cv.addEventListener('pointerup',   () => { down = false; });
  cv.addEventListener('pointercancel', () => { down = false; });
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
    const img = ctx.createImageData(SZ, SZ), d = img.data;
    for (let y = 0; y < SZ; y++) {
      for (let x = 0; x < SZ; x++) {
        const dx = x - R + 0.5, dy = y - R + 0.5, dist = Math.hypot(dx, dy), idx = (y * SZ + x) * 4;
        if (dist > R) { d[idx + 3] = 0; continue; }
        let hue = Math.atan2(dy, dx) * 180 / Math.PI; if (hue < 0) hue += 360;
        const sat = Math.min(1, dist / R);
        const rgb = lumMode ? hslToRgb(hue, sat, findLightness(hue, sat, lumT)) : hslToRgb(hue, sat, L);
        d[idx] = rgb[0]; d[idx + 1] = rgb[1]; d[idx + 2] = rgb[2]; d[idx + 3] = 255;
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
  const a = mh * Math.PI / 180, dd = ms * R, scale = SZ / 132;
  ctx.beginPath();
  ctx.arc(R + Math.cos(a) * dd, R + Math.sin(a) * dd, 5 * scale, 0, Math.PI * 2);
  ctx.strokeStyle = relativeLuminance(_ce.r, _ce.g, _ce.b) > 0.35 ? '#000' : '#fff';
  ctx.lineWidth = 2 * scale;
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
  const editedHex = toHex(_ce.r, _ce.g, _ce.b);
  const list = partnerList();
  if (_cePartner >= Math.max(1, list.length)) _cePartner = 0;
  const partner = partnerHex();
  let bgHex, textHex, cmpRole;
  if (_ce.role === 'bg') { bgHex = editedHex; textHex = partner; cmpRole = 'Text'; }
  else                   { textHex = editedHex; bgHex = partner; cmpRole = 'BG'; }

  _ceRefs.tile.style.background = bgHex;
  _ceRefs.ag.style.color = textHex;
  _ceRefs.cmpBtn.style.color = textHex; // icon stroke = currentColor

  const ratio = contrastRatio(relativeLuminance(...hexToRgb(textHex)), relativeLuminance(...hexToRgb(bgHex)));
  _ceRefs.ratio.textContent = ratio.toFixed(2) + ':1';
  _ceRefs.cmpRole.textContent = cmpRole + (list.length ? '' : ' (picker)');
  _ceRefs.badges.innerHTML = '';
  for (const [lbl, thr] of [['AA', 4.5], ['AAA', 7]]) {
    const b = document.createElement('span');
    b.className = 'chip-editor-badge' + (ratio >= thr ? ' pass' : '');
    b.textContent = lbl;
    _ceRefs.badges.appendChild(b);
  }
}

function openChipEditor(idx) {
  if (_ceIdx === idx) { closeChipEditor(); return; } // toggle off
  if (_ceIdx !== null) closeChipEditor(true);
  if (!palette[idx]) return;
  if (!_ceEl) buildChipEditor();
  _ceIdx = idx;
  _cePartner = 0;
  _ceWheelCache = null;
  const entry = palette[idx];
  const [r, g, b] = hexToRgb(entry.hex);
  _ce = { role: entry.role, r, g, b, mode: 'rgb', hsl: [0, 0, 0], lum: [0, 0, 0], gray: 0 };
  reseedSubstates();
  applyChipEditorMode('rgb');
  syncChipEditorControls();
  chipEditorRenderPreview();
  const chipEl = paletteRail.querySelector(`.palette-chip[data-idx="${idx}"]`);
  if (chipEl) { chipEl.classList.add('editing'); chipEl.after(_ceEl); }
}

function closeChipEditor(skipRender) {
  if (_ceIdx === null) return;
  closeChipEditorDropdown();
  const idx = _ceIdx;
  _ceIdx = null;
  _ce = null;
  savePalette();
  if (_ceEl && _ceEl.parentNode) _ceEl.parentNode.removeChild(_ceEl);
  const chipEl = paletteRail.querySelector(`.palette-chip[data-idx="${idx}"]`);
  if (chipEl) chipEl.classList.remove('editing');
  if (!skipRender) renderPalette();
}

/** Re-attach the open editor after a renderPalette() rebuild (used as a safety
    net; structural edits close the editor outright). */
function reinsertChipEditor() {
  if (_ceIdx === null) return;
  const chipEl = paletteRail.querySelector(`.palette-chip[data-idx="${_ceIdx}"]`);
  if (chipEl && _ceEl) { chipEl.classList.add('editing'); chipEl.after(_ceEl); }
  else { _ceIdx = null; _ce = null; }
}

function renderPalette() {
  paletteToggleCount.hidden = palette.length === 0;
  paletteToggleCount.textContent = String(palette.length);
  paletteRail.innerHTML = '';

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
      if (role === 'fg') addToPalette(toHex(...selectedRgbBiased()), 'fg');
      else addToPalette(toHex(cR, cG, cB), 'bg');
    });
    head.append(title, add);

    const list = document.createElement('div');
    list.className = 'palette-group-list';
    group.append(head, list);

    entries.forEach(({ hex, flatIdx }, pos) => {
    const [r, g, b] = hexToRgb(hex);
    const lum = relativeLuminance(r, g, b);
    const display = formatHex(toHex(r, g, b));

    const chip = document.createElement('div');
    chip.className = 'palette-chip';
    chip.dataset.idx = String(flatIdx);
    chip.style.background = hex;
    chip.style.color = lum > 0.179 ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.85)';

    const rank = document.createElement('span');
    rank.className = 'palette-chip-rank';
    rank.textContent = paletteRankLabel(pos);
    rank.title = `${label} ${paletteRankLabel(pos).toLowerCase()} — used in export`;

    const hexLabel = document.createElement('span');
    hexLabel.className = 'palette-chip-hex';
    hexLabel.textContent = display;

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

    const remove = document.createElement('button');
    remove.className = 'palette-chip-remove';
    remove.textContent = '\u00d7';
    remove.title = 'Remove from palette';
    remove.addEventListener('click', () => removeFromPalette(flatIdx));

    attachChipDrag(chip, pos, role, list);

    chip.append(rank, hexLabel, edit, copy, remove);
    list.appendChild(chip);
    });

    paletteRail.appendChild(group);
  });

  reinsertChipEditor();
  renderPalettePreviews();
}

/** Mirror the saved palette into the two vs-Custom preview tiles as a compact
    strip, shown against each tile's own background. Text-role colors render as
    a small colored "Ag" glyph; background-role colors as a filled square — so
    the two kinds are distinguishable at a glance. */
function renderPalettePreviews() {
  const textColors = palette.filter(e => e.role === 'fg');
  const bgColors   = palette.filter(e => e.role === 'bg');
  for (const id of ['pa', 'pb']) {
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
      el.style.color = hex;
      el.title = `Text color ${formatHex(hex.toUpperCase())} — open palette`;
      host.appendChild(el);
    });
    bgColors.forEach(({ hex }) => {
      const el = document.createElement('span');
      el.className = 'preview-palette-bg';
      el.style.background = hex;
      el.title = `Background color ${formatHex(hex.toUpperCase())} — open palette`;
      host.appendChild(el);
    });
  }
}

// Clicking a preview strip opens the palette sidebar (the strips just mirror
// the saved colors; the sidebar is where you manage them). Delegated once —
// the host elements persist across renderPalettePreviews() rebuilds.
['pa-palette', 'pb-palette'].forEach(id => {
  const host = document.getElementById(id);
  if (host) host.addEventListener('click', () => setPaletteOpen(true));
});

document.getElementById('pin-selected').addEventListener('click', () => {
  addToPalette(toHex(...selectedRgbBiased()), 'fg');
});
document.getElementById('pin-custom').addEventListener('click', () => {
  addToPalette(toHex(cR, cG, cB), 'bg');
});
document.getElementById('palette-clear').addEventListener('click', () => {
  palette = [];
  savePalette();
  renderPalette();
});

// Restore: localStorage first, then share-URL override.
// Legacy entries (plain hex strings / unprefixed URL tokens) predate the
// fg/bg distinction; they were always edited in the custom picker, so 'bg'.
// Cap at four entries per role (legacy palettes could hold more).
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
    palette = capPaletteRoles(stored.map(item => {
      if (typeof item === 'string' && /^#[0-9a-f]{6}$/.test(item)) return { hex: item, role: 'bg' };
      if (item && typeof item === 'object' && typeof item.hex === 'string' && /^#[0-9a-f]{6}$/.test(item.hex))
        return { hex: item.hex, role: item.role === 'fg' ? 'fg' : 'bg' };
      return null;
    }).filter(Boolean));
  }
} catch (e) {}
try {
  const pp = new URLSearchParams(location.search).get('p');
  if (pp !== null) {
    const fromUrl = capPaletteRoles(pp.split(',').map(tok => {
      const t = tok.toLowerCase();
      if (/^[fb][0-9a-f]{6}$/.test(t)) return { hex: '#' + t.slice(1), role: t[0] === 'f' ? 'fg' : 'bg' };
      if (/^[0-9a-f]{6}$/.test(t)) return { hex: '#' + t, role: 'bg' };
      return null;
    }).filter(Boolean));
    if (fromUrl.length) { palette = fromUrl; savePalette(); }
  }
} catch (e) {}
renderPalette();
// Open state: explicit preference wins; otherwise open when colors exist
try {
  const po = localStorage.getItem('palette-open');
  paletteOpen = po !== null ? po === '1' : palette.length > 0;
} catch (e) { paletteOpen = palette.length > 0; }
applyPaletteOpen();
