# Differences from upstream

x-scanner here originated from oso95/x-scanner. Public-facing summary of what this fork adds or changes. Not a changelog; behavior details live in the README.

- **Firefox / Zen support.** Generated browser-specific manifests from one source: Chromium keeps `background.service_worker`; Firefox uses `background.scripts` with a stable extension id, `strict_min_version` 128.0, and a `data_collection_permissions` declaration. Development, packaging, and validation commands exist per target.
- **Signal v2 (experimental).** Topic classification plus information density, original insight, evidence, actionable, promo, and bait as separate components on one shared display range. No overall score. Never auto-selected.
- **Topic classification.** Ten-category taxonomy shown descriptively, never as a quality judgment.
- **Reply filtering and focal-post behavior.** Replies/comments off by default; on status pages only the focal post is analyzed while replies are off.
- **External article analysis.** Manual Analyze article action, cookieless fetch, readable-body extraction, character cap, canonical-URL cache. Optional host permissions granted on demand.
- **Native X Article analysis.** Manual Analyze X article action reading the rendered long-form text from the open page. No fetch, no extra permission, own cache entry.
- **Session intelligence.** Local aggregate panel with cost, latency, flags, top posts and articles, plus topic distribution and component averages under Signal v2. No extra API calls.
- **Caches and schema.** Per-preset post caches, article cache keyed by canonical URL, native-article cache keyed by status id plus text hash, versioned settings with normalization.
- **Cost transparency.** Exact accounting from API usage tokens, HUD and About build identity (version plus short sha plus browser target).
- **Tests and packaging.** Unit, fixture, and Playwright e2e coverage including status-page and native-article cases; deterministic packaging and artifact validation for both targets.

Upstream authors do not endorse this fork.
