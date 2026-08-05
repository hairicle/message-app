# Static assets

Everything in this folder is served from the site root — `public/logo.png` is reachable at
`/logo.png`. No import or config needed.

## Company logo

The logo lives here as **`logo.png`**:

```
apps/web/public/logo.png
```

`BrandLogo` picks it up automatically and it appears in two places: the top of the desktop nav
rail and the login page header. If the file is missing or fails to load, `BrandLogo` falls back to
a built-in messenger glyph on an accent tile, so nothing looks broken.

Notes:

- **Transparent padding is trimmed automatically.** `BrandLogo` measures the non-transparent
  bounding box at runtime and lays out against that, so a logo exported onto a large empty canvas
  still fills its slot. You do not need to crop the export yourself.
- The logo is drawn on the app background with no tile behind it, so it needs to read on **both**
  the light and dark themes. A logo with dark-only colours will be hard to see in dark mode.
- To use a different filename or format, change `LOGO_SRC` at the top of
  `src/components/BrandLogo.tsx`.
- Wide lockups are supported — the nav rail slot is 52×30 and the login header is 260×72, and the
  artwork is fitted inside. Very wide artwork will simply render small in the rail.
