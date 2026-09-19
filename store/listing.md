# Chrome Web Store listing

Copy for the developer dashboard. Fields in the order the dashboard asks for them.

## Store listing

**Name**: x-scanner

**Summary** (132 chars max):
Typed Jev labels on the posts you scroll past on X, plus on-demand article analysis and a session summary. Your own TypeSafe key.

**Description**:

x-scanner runs a behavioral read on every post you scroll past on X, judged by Jev, TypeSafe's System
One model, and shows you exactly what it cost.

Each post is sent to Jev with six typed questions in one request as it comes near your viewport. The
answer comes back in about 150 ms as numbers, not prose, and lands in a small chip under the post: a
green check when nothing crossed a threshold, or a flag with its value when something did. Click the
chip for every value. A panel in the corner counts posts analyzed, dollars spent to four decimals, the
last call's latency and judgments per second.

The six dimensions, all editable:
• fact-dense: how much specific, verifiable content the post has
• engagement bait: does it end by asking for replies, reposts, likes, follows or bookmarks
• promo: is it pushing a product, course, newsletter, community or paid offer
• secondhand: does it only relay someone else's view without adding its own argument
• filler: how much of it is filler relative to the information it carries
• jevpilled: is the post about Jev or TypeSafe

Bring your own TypeSafe API key. Typical cost is about $0.00004 per post; a thousand posts is under
four cents. Results are cached by post id so scrolling back, reloading or returning tomorrow re-bills
nothing. Promoted posts and posts without text are never sent.

Four analysis presets - Default, Signal, AI / Tech and Article - let you switch which typed questions
run without editing anything by hand. Results are cached per preset, so switching never reuses one
preset's answers for another.

When a post links to an article, a subtle Analyze article action appears. Nothing is fetched or billed
until you press it, and the readable text is capped, cached by canonical URL and never re-fetched. On a
post's own page the Signal and AI / Tech presets can attach the quoted post, the direct parent, or a
couple of preceding posts, so a reply is judged against what it answers.

Click session in the corner panel for a local summary: posts analyzed, cache hits, what the session cost,
average latency, flagged counts, which dimensions showed up, and the top-scoring posts and articles. It
costs no extra API calls.

No server, no analytics. Only the post text goes to api.typesafe.ai. Your key stays in this browser's
extension storage. Open source: https://github.com/oso95/x-scanner

**Category**: Social & Communication

**Language**: English

## Privacy practices

**Single purpose**: Analyze the text of posts on X with the Jev API and label them in place.

**Permission justifications**

- `storage`: stores the user's TypeSafe API key, settings, a per-post result cache and lifetime counters
  locally so posts are not re-analyzed and re-billed.
- Host permission `https://api.typesafe.ai/*`: the only API the extension calls, to analyze post text
  with the user's own key from the service worker.
- Optional host permissions `https://*/*` and `http://*/*`: fetch the readable text of a linked article,
  and only after the user presses Analyze article on that post. This permission is optional, is not
  requested at install, can be revoked in settings, and is never used for any other purpose.
- Content script on `https://x.com/*` and `https://twitter.com/*`: reads the text of posts on screen
  and inserts the result chip and the corner panel.

**Remote code**: none. All code ships in the package.

**Data usage disclosures**

- Website content (post text): collected, transmitted to TypeSafe for the extension's single purpose.
  Not sold, not used for advertising, not used for creditworthiness or lending, not transferred for
  unrelated purposes.
- Website content (article text), only when the user presses Analyze article on a post that links out:
  the readable body text of that page is sent to TypeSafe. Fetched without the user's cookies.
- Authentication information (the user's TypeSafe API key): stored locally, transmitted only to
  TypeSafe as the authorization header.
- Not collected: personally identifiable information, health, financial, location, web history, user
  activity, personal communications.

**Privacy policy URL**: https://github.com/oso95/x-scanner/blob/main/PRIVACY.md

## Assets

- Icon: `icons/128.png` (also inside the package).
- Screenshots (1280×800): `store/screenshot-1.png` timeline with flags and the panel,
  `store/screenshot-2.png` the detail card, `store/screenshot-3.png` settings. Regenerate with
  `npm run screenshots`. They are captured on the test fixture, which mimics X's markup, so no real
  user's posts appear in the listing.
- Promo tiles are optional; none are provided.

## Publishing steps

1. Register at https://chrome.google.com/webstore/devconsole with a Google account (one-time $5 fee).
2. `npm run package` produces `x-scanner-<version>.zip`. Upload it as a new item.
3. Fill the store listing and privacy practices tabs from this file, upload the three screenshots,
   set the privacy policy URL, pick "Public" visibility.
4. Submit for review. Reviews for extensions with host permissions on a major site usually take a few
   days; expect a question about why the extension needs x.com if the single purpose text is unclear.
5. Every later release: bump `version` in `src/manifest.json` and `package.json`, `npm run package`,
   upload the new zip. Installed users update automatically.
