# Relative Luminous Color Wheel — Figma plugin

The same accessibility-first color workspace as the web app, running inside Figma with
document integration:

- **Text → selection / BG → selection** — fill the selected layers with the current
  TEXT or BG color (opacity included).
- **Import as Text / Import as BG** — read the selected layer's solid fill into the TEXT
  or BG picker and check its WCAG / APCA contrast on the spot.
- **Create variables** — turn the generated luminance-keyed tonal scale (50–950) and
  light/dark themes into Figma variable collections:
  - **… · Primitives** — primitive tokens (`50`–`950` + `base/white`, `base/black`).
  - **… · Semantic** — semantic roles (`bg`, `surface`, `border`, `text`, `muted`, `accent`,
    `accent-foreground`) with **Light** and **Dark** modes, each aliasing the primitives.
    On plans limited to one mode per collection, these ship as separate **… · Semantic (Light)**
    and **… · Semantic (Dark)** collections instead.

The window is **resizable** — drag the bottom-right corner. Widening it past the desktop
breakpoint switches the app to its two-column fit-to-window layout. Preferences, the palette,
and the last window size all persist across sessions via `figma.clientStorage`.

## Architecture

One codebase, three thin plugin files — the UI *is* the web app:

| File | Role |
|---|---|
| `manifest.json` | Plugin manifest (`editorType: figma`, `networkAccess: none`). |
| `code.js` | Main thread (Figma sandbox): persistence, fills, selection import, variables. |
| `ui-shim.js` | UI-side shim injected before the app: `localStorage` → `clientStorage`, the postMessage bridge, and the action bar. |
| `build.mjs` | Builds the web app and inlines everything (CSS, JS, the NATS font) into one `ui.html`, injecting the shim. |

The app exposes a small bridge (`window.__rlcw`, in `src/main.js`, active only when
`window.__RLCW_PLUGIN__` is set) so the shim reads/drives it without DOM scraping. The web
build is completely unaffected.

## Build

```bash
npm run build:figma      # → figma/dist/ui.html + figma/dist/code.js
```

`figma/dist/` is a build artifact (git-ignored); rebuild after any change to the app or
the plugin files.

## Load & test in Figma

1. Figma **desktop** app → **Plugins → Development → Import plugin from manifest…**
2. Select `figma/manifest.json`.
3. Run it from **Plugins → Development → Relative Luminous Color Wheel**.
4. Iterate: after `npm run build:figma`, use the plugin's **⟳ / Rerun** to reload.

## Publish to the Figma Community

1. Replace the placeholder `id` in `manifest.json` — Figma assigns the real one when you
   first choose **Publish** from the plugin's dev menu.
2. Prepare community assets: 128×128 icon, cover art, description, tags.
3. Publish; Figma reviews it. The plugin is fully self-contained (`networkAccess: none`),
   which keeps review straightforward.

## Notes / limitations

- Variables are created in a **design** file (not FigJam); the local Variables API needs no
  special plan.
- The **share-via-URL** feature is inert in the plugin (no URL context); everything else —
  wheel, contrast lock, APCA, opacity, palette, scale/theme generation — works as on the web.
- If a Figma runtime ever blocks overriding `localStorage`, the app still runs but preferences
  persist only within the session; the core features are unaffected.
