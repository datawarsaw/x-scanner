# AMO reviewer notes

Instructions to reproduce the Firefox artifact from source. This is not a claim of compliance; nothing here has been reviewed by Mozilla and the extension has not been submitted.

## Environment

- Node 22 or newer (CI uses Node 24). No other toolchain is required.
- No native modules. No network access during the build besides npm install.

## Reproduce

```sh
npm ci
npm run build:firefox     # dist-firefox/
npm run validate:artifacts # checks both generated manifests and required files
npm run package:firefox   # x-scanner-<version>-firefox.zip
```

The submitted file is `x-scanner-<version>-firefox.zip`, named per the `version` in `package.json`. Unzip it: `manifest.json` sits at the archive root, alongside `background.js`, `content.js`, `options.js`, the stylesheets, the settings page, and `icons/`.

## What the build does

- Plain TypeScript under `src/`. The only build step is esbuild via `build.mjs` (bundle, iife format, chrome120 target). No minification beyond bundling, no obfuscation, no remote code, no runtime download.
- `build.mjs` generates the manifest per target from `src/manifest.json`: Chromium keeps `background.service_worker`; Firefox swaps to `background.scripts` and adds `browser_specific_settings.gecko` (id `x-scanner@whitegull.ai`, `strict_min_version` 128.0, `data_collection_permissions` required [websiteContent, authenticationInfo] with no optional declaration). `optional` is omitted deliberately: the schema accepts only data categories there, and nothing is collected optionally.
- Build identity: the short HEAD sha is substituted as `__XS_BUILD_SHA__` and shown read-only in settings About and the corner panel. Only a plain hex sha is ever accepted; anything else renders as `unknown`. Nothing machine-specific reaches the artifact. Verify with `test/unit/build.test.ts`.
- Byte-for-byte reproducibility is not claimed: esbuild output is deterministic for the same inputs, but timestamps and environment differences may vary the zip. What is claimed: a clean `npm ci && npm run package:firefox` from the tagged revision produces an equivalent artifact with the same file list, manifest, version, and extension id.

## Tests

```sh
npm run typecheck
npm test                # unit tests (node:test plus jsdom)
npm run test:e2e         # Playwright against a local fixture with a fake Jev server
```

The e2e suite needs a Chromium or Chrome for Testing binary and covers flags, cost math, caching, scope and account filters, the settings round trip, focal-post behavior, and native article billing. Record the results for the submitted revision.

## Remote code statement

All code ships in the package. No script is fetched remotely. No `eval`, no `new Function` with remote input, no remote JavaScript is executed. The only network calls are: POST analysis requests to the configured TypeSafe base URL (default `https://api.typesafe.ai/v1/systemone`), and, only after an explicit Analyze article click, a cookieless fetch of the linked article's HTML (rejected when not HTML or over 1.5 MB). A native X Article is read from the DOM of the open x.com page; it makes no network request of its own.

## Permissions summary

Required: `storage`, host `https://api.typesafe.ai/*`. Optional: `https://*/*`, `http://*/*` for user-triggered article fetch only. Content scripts match `https://x.com/*` and `https://twitter.com/*` only. The validator (`scripts/validate-artifacts.mjs`) fails the build if a required broad host pattern ever appears.

## Privacy and listing

- Privacy policy: `PRIVACY.md` (also the published URL pasted into the listing).
- Firefox listing copy: `store/firefox-listing.md`. Screenshots: `store/screenshot-*.png`, regenerated from the fixture with `npm run screenshots`; see `store/SCREENSHOT_PLAN.md`.
- Re-check PRIVACY.md against the shipped build before submission, including that any statement about TypeSafe's handling of requests is still accurate.
