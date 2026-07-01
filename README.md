# Relative Luminance Color Wheel

A color picker where every point on the wheel shares the same WCAG 2.2 relative luminance — making it easy to explore hue and saturation while keeping contrast ratios predictable.

## Features

- **Luminance-locked wheel** — rotate the target luminance slider and the entire wheel redraws so every selectable color satisfies it
- **Real-time contrast ratios** — instant WCAG AA / AAA pass/fail against white, black, and a custom reference color
- **HSL & RGB sliders** — fine-tune the selected color with linked HSL and RGB controls
- **Custom color picker** — set a second color to preview text/background contrast pairs
- **Grayscale reference** — quickly compare against a neutral gray at the same luminance
- **Appearance controls** — adjustable UI hue, saturation, and brightness with dark/light theme toggle
- **Copy-ready values** — click any hex or HSL value to copy it

## Tech stack

- [Vite](https://vite.dev) — build tooling
- Vanilla JavaScript & CSS — no runtime dependencies
- WCAG 2.2 relative luminance formula (`L = 0.2126R + 0.7152G + 0.0722B`)
- Fonts: [NATS](https://fonts.google.com/specimen/NATS) · [Zen Kaku Gothic New](https://fonts.google.com/specimen/Zen+Kaku+Gothic+New)

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

## Build

```bash
npm run build   # outputs to dist/
npm run preview # preview the production build locally
```

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

1. Push this folder to a GitHub repository
2. Import the repository in [Vercel](https://vercel.com)
3. Vercel auto-detects Vite — no additional configuration needed

## License

[MIT](./LICENSE) © 2026 Daishin Sakuma
