# Relative Luminous Color Wheel

A color picker where every point on the wheel shares the same WCAG 2.2 relative luminance — making it easy to explore hue and saturation while keeping contrast ratios predictable.

**Live:** https://relative-luminous-color-wheel.vercel.app/

## Features

- **Luminance-locked wheel** — rotate the target luminance slider and the entire wheel redraws so every selectable color satisfies it
- **Real-time contrast ratios** — instant WCAG AA / AAA pass/fail against white, black, and a custom reference color
- **HSL & RGB sliders** — fine-tune the selected color with linked HSL and RGB controls
- **Custom color picker** — set a second color to preview text/background contrast pairs, in three modes: **Color** (RGB / HSL), **Lum** (relative luminance / saturation / hue), or **Gray** (neutral grayscale)
- **Copy-ready values** — click any hex or HSL value to copy it
- **Shareable links** — share buttons embed the selected colors and UI theme in the URL, so recipients see exactly what you see (each can be opted out in Preferences)
- **Palette rail** — pin colors while you explore; click a saved color to re-edit it, copy its hex, reorder by drag & drop, or remove it. Palettes persist and travel in share links
- **Export** — copy the current pair as CSS variables, a Tailwind `@theme` block, or design-tokens JSON
- **Color vision simulation** — preview the whole app under protanopia, deuteranopia, or tritanopia (Machado et al. 2009)
- **APCA Lc readout** — experimental APCA contrast values alongside WCAG ratios (enable Beta features in Preferences)
- **Appearance controls** — adjustable UI hue, saturation, and brightness with dark/light theme toggle

## Tech stack

- [Vite](https://vite.dev) — build tooling
- Vanilla JavaScript & CSS — no runtime dependencies
- WebGL fragment shader renders the luminance-locked wheel (per-pixel binary search), with a chunked 2D canvas fallback
- WCAG 2.2 relative luminance formula (`L = 0.2126R + 0.7152G + 0.0722B`)
- Font: [NATS](https://fonts.google.com/specimen/NATS)

## License

[MIT](./LICENSE) © 2026 Daishin Sakuma
