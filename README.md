# x-scanner

Browser extension for X that adds typed Jev judgments, Signal v2, article analysis and local session intelligence. Firefox/Zen and Chromium.

x-scanner analyzes X posts in place using Jev, TypeSafe's System One model, and adds a compact metadata row under each post. You bring your own TypeSafe API key; the extension has no server, no analytics, and shows exactly what each session cost.

## What it does

As a post comes near the viewport it is sent to Jev with a set of typed questions in one request. The answer comes back as numbers, not prose, and lands in a small row under the post. Click the row for a detail card with every value, plus the token count, cost and latency of that call.

## What you see

**Under each post**, a row styled like X's own metadata line:

- `✓ clean` when nothing crossed a threshold, followed by the other values in gray.
- `⚑ engagement bait 97%` in orange when something did, followed by the rest in gray.
- `no text to analyze` or `promoted, not analyzed` for posts that are skipped.
- Click the row for a card with a bar per dimension, token count, cost and latency.

**Bottom right**, a small panel: posts analyzed this session, dollars spent to four decimals, the last call's latency, and judgments per second. The dollar figure is exact, not estimated: Jev returns `usage.input_tokens` with every answer.

### Signal v2 row

Signal v2 is an experimental preset that keeps three questions apart instead of blending them into one number:

- **Topic** — what the post is about. One of ten categories (AI, Data / BI, Software Engineering, Business / Strategy, Tech Industry, Productivity / Tools, Science, Politics / Society, Personal / Lifestyle, Other). Categorical and descriptive only, never a quality judgment.
- **Signal** — how much useful information it carries. Four ordered rubrics scored 0 to 3: information density, original insight, evidence, actionable.
- **Filters** — is it pushing something or fishing for engagement? Promo and engagement bait, each a probability.

The row leads with the topic, then puts all six components on one shared 0-100 display range. Three things are worth knowing about that range: a score's 0-100 is a normalized rubric level, not a percentage; a noul's 0-100 is the probability that it is true; they share a display range and nothing else. **There is no overall Signal Score.** Components are shown separately, no weights are invented, and session ranking under Signal v2 names the one component it sorts by (information density).

## Firefox / Zen

Firefox and Zen run the `dist-firefox/` build. During development it loads as a temporary add-on from `about:debugging#/runtime/this-firefox`; that install disappears when the browser restarts. A signed unlisted build installs permanently and is covered in `docs/FIREFOX_SIGNING.md`. There is no public AMO listing yet; do not expect to find this extension in the store.

Firefox uses an MV3 event-page background script (`background.scripts`) because Firefox does not run `background.service_worker` for this extension. Application code is shared with Chromium; only the generated manifest differs. The Firefox manifest carries a stable extension id (`x-scanner@whitegull.ai`), `strict_min_version` 128.0, and a `data_collection_permissions` declaration (see PRIVACY.md).

## Chromium

Chromium runs the `dist-chromium/` build with a background service worker. Load it unpacked from `chrome://extensions` with Developer mode on. It needs Chrome 120 or newer.

## Three installation modes

1. **Temporary development install** (`about:debugging#/runtime/this-firefox` then Load Temporary Add-on, choosing `dist-firefox/manifest.json`). Disappears after a browser restart. Good for development and smoke tests.
2. **Signed unlisted install.** A build signed by Mozilla, distributed by the operator, not publicly listed. Permanent across restarts. See `docs/FIREFOX_SIGNING.md`. Not yet published.
3. **Public AMO install.** Normal store installation with automatic updates. Planned for later; see `docs/AMO_PUBLIC_PATH.md`. Not yet available.

After reloading a temporary add-on, **reload the X page** before testing: already-injected content scripts in an open tab are not guaranteed to be replaced by the reload, so stale code can otherwise look like a failed fix.

## Presets

| preset | what it judges |
| --- | --- |
| Default | the original six dimensions (fact-dense, engagement bait, promo, secondhand, filler, jevpilled); user editable |
| Signal (legacy) | density, actionability, originality, evidence, promo, bait |
| Signal v2 | topic, information density, original insight, evidence, actionable, promo, bait (experimental) |
| AI / Tech | technical depth, benchmark support, novelty, speculation, implementation use, hype |
| Article | density, evidence, sourcing, originality, depth, promo, speculation, action (used for article analysis) |

Default is the default. Signal v2 is experimental, is never selected for you, and leaves Default's questions and behavior untouched until you switch. Results are cached per preset, so switching never reuses one preset's answers for another and never bills the same preset twice. Non-Default presets are read-only and their thresholds are first-pass defaults, not values calibrated against a labelled set.

## Articles

- **External articles.** When a post links out, an Analyze article action appears. Nothing is fetched or billed until you press it. The page is fetched without your cookies, reduced to its readable body (scripts, navigation and chrome dropped), capped at the configured character limit (8000 by default, adjustable 1000-40000), and cached under its canonical URL so it is never re-fetched.
- **Native X Articles.** When X renders a long-form article inside a post, an Analyze X article action appears next to it. The text is read out of the page already on screen — title, lead and body paragraphs — so it needs no extra permission and no extra request. It is judged under the Article preset while the post above keeps its own result, with its own cache entry.
- Truncation is marked: when the body exceeds the cap, the card says what was sent and what was cut.

## Replies and status pages

**Analyze replies/comments** is off by default. While it is off, posts X marks as replies are never sent to Jev: no cost, no row. On an individual status page the route decides instead: only the post whose own status ID matches the URL (the focal post) is analyzed, and the other top-level articles there — direct comments and recommendations alike — are filtered, because X does not always render a Replying to row for them. Text quoted inside a post is not a reply and is always included.

## Session intelligence

Click session in the corner panel for a local summary: posts analyzed, cache hits, session cost, average latency, flagged counts, which dimensions showed up, and the top-scoring posts and articles. Under Signal v2 it also shows the topic distribution and the average of each component. It costs no extra Jev calls. It is a local aggregate of what you already analyzed, not a recommendation engine.

## Cost and privacy

- Bring your own TypeSafe API key. Paste it in settings, test the connection, save. Typical cost is about $0.00004 per post at current pricing; a thousand posts is under four cents.
- The key lives in the browser's extension storage and nowhere else. Only the background script reads it, and it is sent only as the Authorization header to the configured TypeSafe base URL.
- Post text (plus quoted text, reply flag, and thread context where the preset asks for it) and, only when you press the button, article text go to `api.typesafe.ai`. Nothing else about the post goes: no author name, handle, post id, media, or engagement numbers — except that a native X Article's own x.com URL carries the author's handle.
- There is no project-owned backend and no analytics or telemetry. Cost and usage counters are computed locally and never leave the device.
- The dollar figure is exact where the API returns usage data: Jev returns `usage.input_tokens` with every answer.
- Full details, including retention boundaries and TypeSafe's own handling of requests, are in PRIVACY.md.

## Install from source

Node 22 or newer is needed to build.

Firefox / Zen:

```sh
git clone <this-repo-url>
cd x-scanner
npm install
npm run build:firefox
```

1. Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, choose `dist-firefox/manifest.json`.
2. Click the x-scanner icon. Paste your TypeSafe API key, click **Test connection**, then **Save**. Never paste a real key into docs, tickets, screenshots, or chat.
3. Open x.com and scroll. See ZEN_TEST.md for the full smoke-test checklist.

Chromium:

```sh
npm run build:chromium
```

1. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, choose `dist-chromium/`.
2. Same key setup as above, then open x.com and scroll.

## Development

```sh
npm run build            # Chromium development build
npm run build:chromium   # same as npm run build
npm run build:firefox    # Firefox/Zen development build
npm run package          # build and zip dist-chromium/
npm run package:firefox  # build and zip dist-firefox/
npm run watch            # rebuild dist-chromium/ on change
npm test                 # unit tests
npm run test:e2e         # real extension plus fake Jev in Chromium
npm run calibrate        # real Jev calls over samples (needs TYPESAFE_API_KEY)
npm run screenshots      # 1280x800 store screenshots from the fixture
npm run typecheck
npm run validate:artifacts  # checks both generated manifests
```

The end-to-end test starts a fake Jev server, scrolls the fixture like a reader, and checks flags, cost math, caching, scope and account filters, the settings round trip, focal-post behavior on status pages, and native article billing. It needs a Chromium or Chrome for Testing binary. Branded Google Chrome no longer accepts `--load-extension`.

## Architecture

```
src/background.ts    service worker / event page: key, Jev calls, totals
src/shared/          questions, presets, article text, context, client, settings
src/content/         selectors, observers, extraction, queue, caches, rendering
src/options/         settings page
test/unit|fixture|e2e  pure-module tests, X-like fixture, Playwright runs
scripts/             packaging, validation, calibration, screenshots
```

A MutationObserver picks up each `article` X mounts; an IntersectionObserver with an 800 px look-ahead fires as a post nears the viewport. At most 6 requests are in flight; the rest queue, and a post that scrolls away before its turn is dropped. Results cache by post id in extension storage. Promoted posts and posts with no text are never sent.

## Limits

- X's DOM may change. Selectors live in `src/content/selectors.ts`; if X changes its markup, that is the file to fix. Tests run against the fixture, not live X.
- Typed judgments are model outputs, not ground truth. Jev reads literally; a post written to argue for its own classification can move an answer, which is why thresholds default high.
- Prompts are calibrated on English. Run `npm run calibrate` on your own samples before trusting the defaults in another language; post text itself goes in as written, in whatever language.
- A temporary add-on keeps running the code it was loaded with. Rebuilding does not update the running instance, and About reports the running build's own version — always remove and re-add the temporary add-on, then reload the X page, before testing new content-script behavior.
- Native X Article detection is conservative by design: it matches semantics (route status ID, heading roles, prose blocks, X's own container names), never generated class names or screen position. Unrecognized markup leaves the action hidden rather than guessing.
- Article bodies are capped (8000 characters by default) and pages that render entirely in client-side JavaScript, or hide behind a paywall or consent wall, yield little or no text. The card says so rather than sending page chrome.
- Replies by the original author that form a thread are skipped while replies are off, because X does not mark that distinction. Author-thread detection is intentionally deferred.
- Promoted posts are recognized by the Ad label in a handful of UI languages. Add yours to `selectors.ts` if X shows something else.

## Differences from upstream

Short version: Firefox / Zen support with generated browser-specific manifests, Signal v2 with topic classification, reply filtering and route-aware focal-post behavior, external and native X Article analysis, session intelligence with topic distribution, per-preset caches, and expanded tests. Details: docs/DIFFERENCES_FROM_UPSTREAM.md.

## Origin and attribution

Originally based on oso95/x-scanner. This fork adds Firefox/Zen support, Signal v2, article analysis, session intelligence, and additional cross-browser tooling. Upstream authors do not endorse this fork. See LICENSE for the MIT license text.

## License

MIT. See LICENSE.
