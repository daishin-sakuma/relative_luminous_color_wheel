# Relative Luminous Color Wheel

**Accessible color picker and WCAG 2.2 contrast checker with a contrast lock.** Every color on the wheel shares the same WCAG 2.2 relative luminance, so you can explore hue and saturation freely while the contrast against your background never breaks — and a target lock (WCAG 2.2 ratios, or an experimental APCA Lc target) keeps a color pair pinned to a threshold in real time. Meet WCAG 2.1/2.2 AA — the standard referenced by the ADA and the European Accessibility Act — *by construction*, not by after-the-fact auditing.

**Live:** https://relative-luminous-color-wheel.vercel.app/

![Relative Luminous Color Wheel — accessible color picker with WCAG 2.2 and APCA contrast lock](public/ogp.png)

## Why this exists

The usual workflow treats accessibility as an afterthought: pick a color, run it through a contrast checker, fail, adjust, repeat. This tool inverts the loop — **contrast is a constraint you set first, not something you verify afterwards.**

- **The wheel is luminance-locked.** Set a target relative luminance and the wheel redraws so every reachable hue/saturation renders at exactly that luminance. WCAG contrast ratios are computed from relative luminance alone, so an AA or AAA rating cannot break while you explore.
- **The target contrast lock goes further.** Hold a WCAG 2.2 threshold (3:1, 4.5:1, 7:1) or an APCA lightness-contrast target (Lc 45–90), move either color, and the other side re-pins itself to the boundary — landing on the first representable RGB at-or-beyond the target, every input tick.

## Features

- **Luminance-locked wheel** — rendered by a WebGL fragment shader (per-pixel lightness search), with a chunked 2D canvas fallback. In APCA mode every wheel (main, custom, and the palette re-edit picker) equalizes APCA screen luminance (Ys) instead of WCAG relative luminance, so exploration stays contrast-stable under whichever method is active
- **Target contrast lock** — `Off / WCAG 2 / APCA` modes; WCAG 2.2 thresholds where text ratings change (3:1 large text & UI, 4.5:1 normal AA, 7:1 AAA), or experimental APCA Lc 45/60/75/90 (a newer perceptual method — WCAG 2.2 remains the normative default)
- **Live contrast readouts** — WCAG 2.2 AA/AAA badges for normal text, large text, and UI components against white, black, and a custom color, with APCA Lc values alongside every ratio; saved palette swatches appear as a compact preview strip in every contrast tile. In APCA mode each tile switches to full APCA verdicts: the official usage ladder (SMALL BODY TEXT ONLY … SPOT & NON TEXT ONLY … INVISIBLE), a font-size/weight verdict against the official apca-w3 lookup table (with the required minimum size when it fails), and in-tile font size/weight selectors — judged from the continuous luminance pair, so hue/sat exploration never shakes the verdicts, and pinned to exactly the target while a contrast lock is met
- **Custom comparison color** — three modes: **Color** (RGB/HSL), **Lum** (relative luminance / saturation / hue), **Gray** (neutral grayscale)
- **Palette sidebar** — pin colors as text or background roles, each named by rank (Primary → Denary, up to 10 per role); re-edit any saved color in place with an inline RGB / HSL / Lum / Gray picker (mini wheel + sliders, defaulting to Lum), where the wheel's picker ring stays visible on any background and each numeric field selects-all on focus and steps with the arrow keys; smooth open/close transitions, automatic centering in the sidebar, and a live contrast preview against a selectable opposite-role color (each side labelled with its role and rank — e.g. "Text Primary on BG Primary" — rendered in the preview colors so the label itself is a contrast sample, with 3:1 / 4.5:1 / 7:1 pass indicators for large-text, normal-text, and AAA thresholds — or, in APCA mode, the APCA verdicts instead: Lc value, official usage level, and the chosen font-size/weight verdict with the required minimum size); tap outside the editor to save like Done, cancel editing to revert changes, save an identical color more than once and tune each copy afterwards, drag the sidebar right and release to close it on touch devices (with a smooth, iCloud Mail-style spring-back transition on cancel), and reorder saved colors by dragging each chip's grip handle — reliable across Android, iOS, and desktop — while the chip body still scrolls the list natively (including moves between Text and Background groups, with the group labels following the reordering); undo and redo any palette edit — add, delete, re-edit, reorder, or clear; the sidebar widens to give sliders more room (up to 480px, 90% of the viewport on small screens); persists locally and travels in share links
- **Export** — CSS custom properties, a Tailwind v4 `@theme` block, or W3C Design Tokens (DTCG 2025.10) JSON, in your choice of OKLCH, hex, or RGB (with an sRGB hex fallback in OKLCH and hex modes; RGB emits pure sRGB channels). The token file is DTCG-compliant — reverse-DNS `$extensions` and the `application/design-tokens+json` media type. Exports prioritize saved swatches while backing up active main picker colors inside JSON extensions and comments
- **Color vision simulation** — protanopia / deuteranopia / tritanopia (Machado et al. 2009 matrices, applied in linear-light space) rendered by the app itself: every canvas pixel, slider gradient, inline color, and theme variable is transformed, so the full-screen preview — theme, wheel, preferences, and palette sidebar included — is identical on iOS/Safari, Android, and desktop browsers (no CSS/SVG reference filters, which iOS WebKit does not propagate into composited layers).
- **Fit-to-screen desktop layout** — on PC the whole app continuously scales to use the entire window exactly, at any size or aspect ratio, with no scrolling: spare width grows the wheel and sliders instead of leaving dead space
- **Shareable links** — colors, palette, and UI theme travel in the URL, so recipients see exactly what you see (each part can be opted out in Preferences)
- **Copy-ready values** — click any hex, HSL, or RGB value to copy it
- **Appearance controls** — adjustable UI hue, saturation, and brightness with a dark/light theme toggle
- **Private by design** — no account, no upload; everything runs locally in your browser

## Tech stack

- [Vite](https://vite.dev) — build tooling; zero runtime dependencies (vanilla JavaScript & CSS)
- WebGL fragment shader renders the luminance-locked wheel; chunked 2D canvas fallback
- WCAG 2.2 relative luminance (`L = 0.2126R + 0.7152G + 0.0722B`) and contrast-ratio math
- APCA-W3 0.0.98G-4g lightness contrast (reference values and lock targets; WCAG 2.2 remains normative)
- OKLCH conversion (Björn Ottosson's OKLab transform) for exports; sRGB hex fallback retained
- Font: [NATS](https://www.figma.com/fonts/nats/)

## Contributing

The whole app is three files — `index.html`, `src/main.js`, `src/style.css` — with no runtime dependencies, which makes it an approachable codebase for first contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) to get started.

## License

[MIT](./LICENSE) © 2026 Daishin Sakuma
