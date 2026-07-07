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
const BUF_SZ    = CSS_SZ * DPR;
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
 * Return a foreground color (near-black or near-white) that contrasts with bgLum.
 * Threshold ≈ 0.179 is where black and white have equal contrast ratio.
 */
function getForeground(bgLum) {
  return bgLum > 0.179 ? '#111111' : '#eeeeee';
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

  const CATEGORIES = [
    { label: 'Normal',     thresholds: [['AA', 4.5], ['AAA', 7]]   },
    { label: 'Large · UI', thresholds: [['AA', 3],   ['AAA', 4.5]] },
  ];

  const cats = [], badges = [];
  for (const { label, thresholds } of CATEGORIES) {
    const row = document.createElement('div');
    row.className = 'preview-wcag-row';

    const catEl = document.createElement('span');
    catEl.className   = 'preview-wcag-cat';
    catEl.textContent = label;
    row.appendChild(catEl);
    cats.push(catEl);

    for (const [badge, threshold] of thresholds) {
      const b = document.createElement('span');
      b.className = 'preview-badge';
      b.textContent = badge;
      row.appendChild(b);
      badges.push({ el: b, threshold });
    }

    rowsEl.appendChild(row);
  }

  el.appendChild(rowsEl);
  const dom = {
    ratioEl: document.getElementById(el.id.replace('-wcag', '-ratio')),
    cats,
    badges,
  };
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
 */
function renderPreviewWcag(el, l1, l2, bgLum) {
  const dom = _wcagDom.get(el) || buildPreviewWcag(el);
  const ratio   = contrastRatio(l1, l2);
  const isLight = bgLum > 0.179;
  const dim     = isLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)';

  if (dom.ratioEl) {
    dom.ratioEl.textContent = ratio.toFixed(2) + ':1';
    dom.ratioEl.style.color = dim;
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
  );
}

// ─── Main UI update ───────────────────────────────────────────────────────────

function updateUI() {
  const l         = findLightness(selHue, selSat, targetLum);
  const [r, g, b] = hslToRgb(selHue, selSat, l);
  const selLum    = relativeLuminance(r, g, b);
  const selHex    = toHex(r, g, b);
  const hsl       = rgbToHsl(r, g, b);

  // Swatch + accent
  document.getElementById('swatch').style.background = selHex;
  const swatchHexEl = /** @type {HTMLElement} */ (document.getElementById('swatch-hex'));
  swatchHexEl.textContent = formatHex(selHex);
  swatchHexEl.style.color = selLum > 0.179 ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.75)';
  swatchHexEl.style.setProperty('--icon-clr', selLum > 0.179 ? '#000' : '#fff');
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
let betaFeatures = false;

// Contrast lock (Beta): 0 = off, 4.5 = AA, 7 = AAA
let contrastLockTarget = 0;
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

function _renderFrame() {
  _rafId = null;
  const wheelChanged  = _pendingWheelDraw;
  const customChanged = _pendingCustomSync;
  if (_pendingWheelDraw)  { drawWheel(targetLum); _pendingWheelDraw  = false; }
  if (_pendingCustomSync) { syncCustomUI();        _pendingCustomSync = false; }
  updateUI();
  // Contrast lock (Beta): adjust the side the user did NOT touch. Renders
  // scheduled by the enforcement itself are skipped to prevent ping-ponging.
  if (_skipEnforceOnce) { _skipEnforceOnce = false; }
  else if (customChanged) enforceContrastLock('bg');
  else if (wheelChanged)  enforceContrastLock('fg');
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

// ─── Contrast lock (Beta) ─────────────────────────────────────────────────────
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

function setContrastLockError(msg) {
  const el = document.getElementById('contrast-lock-error');
  if (el) el.textContent = msg;
}

function enforceContrastLock(changed) {
  if (!betaFeatures || !contrastLockTarget) return;
  const R = contrastLockTarget;
  // Use the luminances of the actual rendered colors (RGB-quantized)
  const l = findLightness(selHue, selSat, targetLum);
  const fgLum = relativeLuminance(...hslToRgb(selHue, selSat, l));
  const bgLum = relativeLuminance(cR, cG, cB);
  const fixedLum = changed === 'fg' ? fgLum : bgLum;
  const freeLum  = changed === 'fg' ? bgLum : fgLum;

  const solved = solveContrastLum(fixedLum, R);
  if (solved === null) {
    setContrastLockError(changed === 'fg'
      ? `${R}:1 is unreachable against this luminance — no background can satisfy it.`
      : `${R}:1 is unreachable against this luminance — no wheel color can satisfy it.`);
    return;
  }

  // The free side is always pinned to the boundary (exactly the target ratio),
  // overshot slightly away from the fixed side so integer-RGB rounding can't
  // land just below target.
  const EPS = 0.004;
  const desired = Math.max(0, Math.min(1, solved + (solved > fixedLum ? EPS : -EPS)));

  // Already pinned (within rounding) and satisfying → nothing to do
  if (Math.abs(freeLum - desired) <= 0.008 && contrastRatio(fgLum, bgLum) >= R) {
    setContrastLockError('');
    return;
  }

  _skipEnforceOnce = true;
  if (changed === 'fg') {
    if (customMode === 'lum') {
      setCustomFromLumHueSat(desired, cuHue, cuSat);
    } else if (customMode === 'gray') {
      const v = Math.round(findLightness(0, 0, desired) * 255);
      setCustomFromRgb(v, v, v);
    } else {
      setCustomFromHsl(cH, cS, findLightness(cH, cS, desired));
    }
  } else {
    targetLum = desired;
    lumSlider.value = String(Math.round(targetLum * 1000));
    if (document.activeElement !== lumValEl) lumValEl.value = targetLum.toFixed(3);
    saveToStorage('sel-lum', String(targetLum));
    scheduleRender(true);
  }
  setContrastLockError('');
}

// ─── Custom color wheel ───────────────────────────────────────────────────────

const CW_CSS = 148;
const CW_DPR = Math.min(window.devicePixelRatio || 1, 2);
const CW_BUF = CW_CSS * CW_DPR;

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
  /** @type {HTMLElement} */ (document.getElementById('custom-swatch-display')).style.background = customColor;

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
  const l = findLightness(cuHue, cuSat, cuLum);
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
  const betaCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('beta-checkbox'));
  const lockRow  = /** @type {HTMLElement} */ (document.getElementById('contrast-lock-row'));
  const lockBtns = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('.contrast-lock-btn')]);

  function storedLockTarget() {
    const t = parseFloat(localStorage.getItem('contrast-lock-target') ?? '0');
    return t === 4.5 || t === 7 ? t : 0;
  }

  function setLockTarget(target, persist) {
    contrastLockTarget = target;
    lockBtns.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.target) === target));
    setContrastLockError('');
    if (persist) { try { localStorage.setItem('contrast-lock-target', String(target)); } catch(e) {} }
    // The side the user touched last stays put; the other one gets adjusted
    if (target > 0) enforceContrastLock(_lastTouchedSide);
  }

  try {
    betaFeatures = localStorage.getItem('pref-beta') === '1';
    betaCheckbox.checked = betaFeatures;
    if (betaFeatures) {
      const t = storedLockTarget();
      contrastLockTarget = t;
      lockBtns.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.target) === t));
    }
  } catch(e) {}
  lockRow.hidden = !betaFeatures;

  betaCheckbox.addEventListener('change', () => {
    betaFeatures = betaCheckbox.checked;
    try { localStorage.setItem('pref-beta', betaFeatures ? '1' : '0'); } catch(e) {}
    lockRow.hidden = !betaFeatures;
    if (betaFeatures) {
      setLockTarget(storedLockTarget(), false);
    } else {
      // Deactivate without forgetting the stored target
      contrastLockTarget = 0;
      setContrastLockError('');
    }
  });

  lockBtns.forEach(btn => btn.addEventListener('click', () => {
    setLockTarget(parseFloat(/** @type {HTMLElement} */ (btn).dataset.target), true);
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
  const _l = findLightness(cuHue, cuSat, cuLum);
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
      const _l = findLightness(cuHue, cuSat, cuLum);
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
if (betaFeatures && contrastLockTarget) enforceContrastLock(_lastTouchedSide);

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
