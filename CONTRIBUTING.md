# Contributing

Thank you for your interest in contributing!

## Getting started

```bash
npm install
npm run dev      # Vite dev server with HMR
npm run build    # production build → dist/
```

## Project layout

The app is intentionally small — three files, no runtime dependencies:

- `index.html` — all markup (single page), SEO metadata, structured data
- `src/main.js` — all application logic: wheel rendering (WebGL + 2D fallback), WCAG 2.2 / APCA contrast math, the target contrast lock, palette, share links, export
- `src/style.css` — all styles: CSS custom properties, dark/light themes, responsive width tiers and height-compression tiers for no-scroll desktop layouts
- `public/` — static assets (icons, OGP image, manifest)

## Guidelines

- **Keep it dependency-free** — this project intentionally uses no runtime libraries
- **Match the existing code style** — vanilla JS, CSS custom properties, comments explain constraints rather than restate code
- **The math is the product** — WCAG 2.2 relative luminance / contrast ratio and APCA-W3 formulas must stay correct; when touching them, cite the spec or source in a comment
- **Test before submitting** — both light and dark themes, a short desktop viewport (≤720px tall), and a mobile width

## Reporting issues

Please open a GitHub issue with:

- A clear description of the problem
- Steps to reproduce
- Browser and OS version (rendering issues often depend on `devicePixelRatio` — mention display scaling or browser zoom if any)
