# Release notes template (first public release candidate)

Do not finalize the version until the v0.6.1 hardening work is merged. Fill in, then paste into the GitHub release and (later) the AMO version notes. No unverified claims.

## Highlights

- <one or two sentences: what this release is>

## Firefox / Zen

- Temporary development install from `dist-firefox/`; signed unlisted XPI attached when available (see docs/FIREFOX_SIGNING.md). No public AMO listing yet.
- Extension id `x-scanner@whitegull.ai`, strict_min_version 128.0.

## Signal v2

- Experimental preset: topic plus density, insight, evidence, actionable, promo, bait. No overall score. Never auto-selected; Default unchanged.

## Articles

- Manual Analyze article (external, optional permission, cached by canonical URL) and Analyze X article (native, permission-free, own cache). Bodies capped at the configured limit.

## Privacy

- BYO TypeSafe key in local extension storage. Post/article text sent to TypeSafe only when analyzed. No backend, no telemetry. Details: PRIVACY.md. Manifest declares data_collection_permissions required [websiteContent, authenticationInfo], with no optional declaration.

## Known limitations

- X markup may change; thresholds default high; English prompt calibration; temporary add-on needs page reload after re-adding; native article detection is conservative; article bodies truncated at the cap.

## Install

- Firefox/Zen temporary: `about:debugging#/runtime/this-firefox` then Load Temporary Add-on with `dist-firefox/manifest.json`. Signed unlisted: install the attached signed XPI. Chromium: load `dist-chromium/` unpacked. Full steps: README.

## Attribution

- Originally based on oso95/x-scanner. This fork adds Firefox/Zen support, Signal v2, article analysis, session intelligence and cross-browser tooling. Upstream authors do not endorse this fork. License: MIT.
