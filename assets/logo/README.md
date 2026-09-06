# wcstack logo

Three exports of the same mark (three stacked layers, the top one in wcstack blue `#3B82F6`).

| File | Size | Background | Use it for |
|---|---|---|---|
| `wcstack-icon-black-512.png` | 512 × 512 | black | dark surfaces: GitHub dark theme, VS Code Marketplace icon, social previews on dark |
| `wcstack-icon-white-512.png` | 512 × 512 | white | light surfaces: GitHub light theme, npm, slides |
| `wcstack-mark-transparent.png` | 320 × 300 | transparent | overlays on a known background. The two lower layers are dark grey, so it reads well on light or mid-tone backgrounds but disappears on black — prefer the black-background icon there |

## Theme-aware embed (GitHub Markdown)

GitHub honours `<picture>` with `prefers-color-scheme`, so a README can swap the two padded icons and keep the same layout in both themes:

```html
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/wcstack-icon-black-512.png">
    <img src="assets/logo/wcstack-icon-white-512.png" alt="wcstack" width="128" height="128">
  </picture>
</p>
```

Outside this repository (npm READMEs, the project site, docs on other hosts) use the absolute URL:

```
https://raw.githubusercontent.com/wcstack/wcstack/main/assets/logo/wcstack-icon-white-512.png
```

## Where the files are consumed

- `README.md` / `README.ja.md` (repository root) — theme-aware header via the snippet above.
- `packages/vscode-wcs/icon.png` — a copy of `wcstack-icon-black-512.png`, referenced by the extension's `package.json` `icon` field. Keep the copy in sync; vsce cannot reach outside the package directory.

The directory is not part of any published npm package.
