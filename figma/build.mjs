// ─── Figma plugin build ───────────────────────────────────────────────────────
// Builds the web app with Vite, inlines everything (CSS, JS, the NATS woff2 font) into a
// single ui.html, injects the plugin UI shim + the clientStorage-init placeholder before
// the app, and assembles figma/dist/ (ui.html + code.js). Zero extra dependencies — the
// inlining is done here in Node. Run: `node figma/build.mjs` from the repo root.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'dist');
const out = join(here, 'dist');

// The plugin is versioned independently of the web app (which lives at 2.x). This is the
// version shown in the plugin UI; bump it on each published plugin release.
const PLUGIN_VERSION = '1.8.1';

// 1. Build the web app (single JS chunk, single CSS). Force the font to inline as a data
//    URI by raising the asset inline limit for this build (it's ~95 KB).
console.log('▸ vite build (font inlined)…');
execFileSync('node', [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build',
  '--assetsInlineLimit', '4000000'], { cwd: root, stdio: 'inherit' });

// 2. Read the built HTML + assets.
let html = readFileSync(join(dist, 'index.html'), 'utf8');
const assetsDir = join(dist, 'assets');
const assets = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
const cssFile = assets.find(f => f.endsWith('.css'));
const jsFile = assets.find(f => f.endsWith('.js'));
if (!cssFile || !jsFile) throw new Error('Built CSS/JS not found in dist/assets — is the build config unchanged?');
let css = readFileSync(join(assetsDir, cssFile), 'utf8');
const js = readFileSync(join(assetsDir, jsFile), 'utf8');

// 3. Inline any remaining font asset that Vite left as a URL (belt-and-braces).
for (const f of assets.filter(a => /\.(woff2?|ttf)$/.test(a))) {
  const b64 = readFileSync(join(assetsDir, f)).toString('base64');
  const mime = f.endsWith('.woff2') ? 'font/woff2' : f.endsWith('.woff') ? 'font/woff' : 'font/ttf';
  const uri = `data:${mime};base64,${b64}`;
  css = css.split('/assets/' + f).join(uri).split('assets/' + f).join(uri);
}

// 4. Assemble ui.html: strip the built <link>/<script> asset tags, inline CSS + JS, and
//    inject the init placeholder + the plugin shim BEFORE the app module (a plain <script>
//    runs before the deferred module, so the shim's localStorage polyfill is in place).
const shim = readFileSync(join(here, 'ui-shim.js'), 'utf8');
// Use FUNCTION replacements: a string replacement interprets `$&`, `$\``, `$'`, `$1`… — and
// minified JS/CSS routinely contains such sequences, which would corrupt the inlined output
// (e.g. re-inject the matched <script> tag and prematurely close the inline script). A function
// return value is inserted verbatim.
html = html
  .replace(/<link[^>]+rel="stylesheet"[^>]*>/i, () => `<style>${css}</style>`)
  .replace(/<script[^>]+type="module"[^>]*><\/script>/i, () => `<script type="module">\n${js}\n</script>`)
  .replace(/<head>/i, () => `<head>\n<!--__RLCW_INIT__-->\n<script>\n${shim}\n</script>`);

// 4b. Stamp the plugin's own version (the web app's version stays in index.html untouched):
//     the visible "ver. …" line and the JSON-LD softwareVersion.
html = html
  .replace(/(<span class="app-version">)[^<]*(<\/span>)/i, `$1ver. ${PLUGIN_VERSION}$2`)
  .replace(/("softwareVersion":\s*")[^"]*(")/i, `$1${PLUGIN_VERSION}$2`);

// 5. Write figma/dist/.
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'ui.html'), html);
writeFileSync(join(out, 'code.js'), readFileSync(join(here, 'code.js')));

const kb = n => (n / 1024).toFixed(0) + ' KB';
console.log(`✓ figma/dist/ui.html  (${kb(Buffer.byteLength(html))})`);
console.log('✓ figma/dist/code.js');
console.log('\nLoad in Figma → Plugins → Development → Import plugin from manifest… → figma/manifest.json');
