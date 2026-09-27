# Firefox Add-ons listing

Copy for the addons.mozilla.org developer hub. Firefox only; do not reuse for the Chrome Web Store. Not yet submitted; do not claim availability.

## Listing

**Name**: x-scanner

**Summary** (132 chars max):
Typed Jev labels on the posts you scroll past on X, plus on-demand article analysis and a session summary. Your own TypeSafe key.

**Description**:

x-scanner analyzes X posts in place using Jev, TypeSafe's System One model, and shows you exactly what it cost.

Each post is sent to Jev with a set of typed questions in one request as it comes near your viewport. The answer comes back as numbers, not prose, and lands in a small row under the post: a green check when nothing crossed a threshold, or a flag with its value when something did. Click the row for every value. A panel in the corner counts posts analyzed, dollars spent to four decimals, the last call's latency and judgments per second.

Five analysis presets — Default, Signal (legacy), Signal v2, AI / Tech and Article — let you switch which typed questions run without editing anything by hand. Results are cached per preset, so switching never reuses one preset's answers for another and never bills the same preset twice. Default is the default; Signal v2 is experimental and is never selected for you.

Signal v2 keeps three questions apart: what the post is about (one of ten topics), how much useful signal it carries (information density, original insight, evidence, actionable), and whether it is selling something or fishing for engagement (promo, bait). The values share a 0-100 display range. Scores are normalized rubric levels, nouls are probabilities, and there is deliberately no single signal score.

Replies and comments are skipped by default. On a post's own page only the focal post is analyzed while replies are off.

When a post links to an article, a subtle Analyze article action appears. Nothing is fetched or billed until you press it, and the readable text is capped, cached by canonical URL and never re-fetched. When X renders a long-form article inside a post, an Analyze X article action appears next to it; that text is read straight out of the page you are already on, so it needs no extra permission and no extra request.

Click session in the corner panel for a local summary: posts analyzed, cache hits, cost, average latency, flagged counts, which dimensions showed up, and the top-scoring posts and articles. Under Signal v2 it also shows the topic distribution and the average of each component. It costs no extra API calls.

Bring your own TypeSafe API key. Typical cost is about $0.00004 per post; a thousand posts is under four cents. No server, no analytics. Only post and article text go to api.typesafe.ai. Your key stays in this browser's extension storage.

Origin: originally based on oso95/x-scanner; this fork adds Firefox/Zen support, Signal v2, article analysis, session intelligence and cross-browser tooling. Upstream authors do not endorse this fork.

**Category suggestion**: Social & Communication

**Primary language**: English

## Single purpose

Analyze the text of posts on X with the Jev API and label them in place.

## Permission justifications

- `storage`: stores the user's TypeSafe API key, settings, per-post and per-article result caches, and lifetime counters locally so posts are not re-analyzed and re-billed.
- Host permission `https://api.typesafe.ai/*`: the only API the extension calls, to analyze text with the user's own key from the background script.
- Optional host permissions `https://*/*` and `http://*/*`: fetch the readable text of a linked article, and only after the user presses Analyze article on that post. Optional, never requested at install, revocable in settings, never used for any other purpose. Native X Articles need no host permission: the text is read from the x.com page the content script already runs on.
- Content script on `https://x.com/*` and `https://twitter.com/*`: reads the text of posts on screen and inserts the result row and the corner panel.

## Data usage disclosure

- Website content (post text, quoted text, reply flag, thread context where the preset asks): sent to TypeSafe when a post is analyzed. Required for the single purpose. Not sold, not used for advertising, not used for creditworthiness or lending, not transferred for unrelated purposes.
- Website content (article text), only when the user presses Analyze article or Analyze X article: the readable body text of that page is sent to TypeSafe. External pages are fetched without the user's cookies.
- Authentication information (the user's TypeSafe API key): stored locally, sent only to TypeSafe as the Authorization header.
- Manifest declaration: `data_collection_permissions` required [websiteContent, authenticationInfo], with no optional declaration (nothing is collected optionally). Counters, caches and settings never leave the device; no telemetry exists.
- Not collected: personally identifiable information, health, financial, location, web history, user activity beyond the analyzed text, personal communications.

## Links

- **Privacy policy URL**: <repo-url>/blob/main/PRIVACY.md (publish the repository first, then paste the exact URL here)
- **Support URL**: <repo-url>/issues
- **Source code URL**: <repo-url> (same revision as the submitted build; see AMO_REVIEW.md for reproduction)
- **Homepage**: <repo-url>

## Release notes template

See docs/RELEASE_NOTES_TEMPLATE.md. Paste the filled-in notes here per release.
