# X-Scanner — Mozilla reviewer build instructions

## Extension
X-Scanner 0.6.3

## Source revision
01176ee0cfebac8853cedcfaa9e48c6c95d9fb46

## Environment
- Tested OS: Windows 11 (build uses only Node + esbuild, no OS-specific steps)
- Tested Node: v24.19.0
- Tested npm: 12.0.2
- No global tools required besides Node/npm. All build dependencies come from package-lock.json.

## Install dependencies
npm ci

## Build Firefox version
npm run build:firefox

This is the exact command the repository uses (it runs `node build.mjs --target firefox`).

## Validate
- `npm run typecheck` — TypeScript check (tsc --noEmit)
- `npm test` — unit tests (no network, no browser needed)
- `npm run build:chromium && npm run build:firefox && node scripts/validate-artifacts.mjs` — artifact validation (checks both targets, manifest identity, permissions, background forms, version agreement)
- `node scripts/package.mjs firefox` — recreates the shippable .zip from dist-firefox/ (entries rooted at the extension root, manifest.json at zip top level)

There is no bundled Firefox linter in this repo; no `lint` script exists.

## Output
The Firefox build output directory is `dist-firefox/`.

It is generated and therefore intentionally excluded from this source archive.
After `npm run build:firefox` it contains:
`manifest.json`, `background.js`, `content.js`, `options.js`, `options.html`, `options.css`, `content.css`, `icons/16.png`, `icons/32.png`, `icons/48.png`, `icons/128.png`.

## Build identity
The build embeds version 0.6.3 (taken from `src/manifest.json` via the generated `dist-firefox/manifest.json`) and build SHA `01176ee`.
The SHA is resolved at bundle time by `gitBuildSha()` in `build.mjs` via `git rev-parse --short HEAD` and substituted as `__XS_BUILD_SHA__` by esbuild.
It is display-only (settings/footer version label) and falls back to `"unknown"` when built from a plain source export without `.git` history; runtime behavior is otherwise identical.

## Notes
TypeScript sources in `src/` are bundled/transpiled with esbuild (`npm run build:firefox`) into the final extension JavaScript.
The files in `dist-firefox/` are generated output, not original source.
Firefox-specific manifest fields (event-page `background.scripts`, `browser_specific_settings.gecko` with id `x-scanner@datawarsaw.com`, `strict_min_version` 128.0, data-collection permissions) are derived at build time by `manifestForTarget()` in `build.mjs` from the shared `src/manifest.json`.


