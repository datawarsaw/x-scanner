# Zen / Firefox smoke test

Development-only. Do not publish this build to AMO. Do not put a TypeSafe API key in this file, in source, or in build output.

Chromium uses a background service worker. Firefox and Zen use an MV3 event-page background script because Firefox does not
run background.service_worker for this extension. The Firefox manifest sets browser_specific_settings.gecko.id to
x-scanner@local so reloading the temporary add-on keeps the same extension identity, and therefore your settings and cache.

## 1. Build

From the repository root:

    npm install
    npm run build:firefox

The loadable artifact is dist-firefox/. Optional zip:

    npm run package:firefox

## 2. Installation

1. Open Zen.
2. Go to about:debugging#/runtime/this-firefox
3. Under This Firefox, click Load Temporary Add-on.
4. Select dist-firefox/manifest.json
5. Confirm x-scanner appears with id x-scanner@local and the background script is running. Temporary add-ons need no signing.

If you reload the add-on after rebuilding, load the same dist-firefox/manifest.json again.

### 2.1 Confirm which build is actually running, before anything else

A temporary add-on keeps running the code it was loaded with. Rebuilding dist-firefox does **not** prove that the
running instance has the new code, and About:debugging will happily show the old one. Check identity first, and do not
continue into reply testing until these three values are right.

1. Open x-scanner settings and scroll to the About section.
2. Confirm it reads Version: 0.5.4
3. Confirm Build: shows the short sha of the commit you built (the build prints it, for example "build fad243e"). If
   it reads unknown, the artifact was built outside a git checkout.
4. Confirm Browser target: Firefox
5. Confirm Analyze replies/comments is unchecked and its Current value line says OFF.
6. If any of these disagree, remove and re-add the temporary add-on from dist-firefox/manifest.json, then check again.
7. The HUD in the corner repeats the same identity quietly as v0.5.4 · <sha>, so you can confirm it on x.com itself
   without opening about:debugging.

## 3. Settings

Never paste a real key into docs, tickets, screenshots, or chat.

1. Open x-scanner settings.
2. Enter your TypeSafe API key by hand.
3. Click Test connection. Expect the Jev model, latency, token count and cost.
4. Click Save, then reload the settings page and confirm everything stayed.
5. Confirm Analyze replies/comments exists and is unchecked, which is the default.

## 4. Presets

1. Confirm the preset selector lists Default, Signal, AI / Tech and Article, and that Default is selected.
2. On x.com, note the chips under a few posts with Default.
3. Switch to Signal, save, reload x.com, and scroll. The chips should now show Signal dimensions (informative, actionable,
   original, evidence, promo, engagement bait) instead of the Default ones.
4. Confirm the HUD title shows the active preset name.
5. Switch back to Default and confirm the original chips return.

Switching presets re-asks posts, because the cache is keyed by preset. That is expected and is the point of the check.

## 5. Articles

Article access is a separate, optional permission, so this is the one step that asks for something at runtime. This
section is the linked-page path; articles X renders itself are section 6.

1. In settings, under Articles, click Grant article access and accept the prompt. The status line should read granted.
2. On x.com, find a post that links to an external article. A subtle "Analyze article" button should sit under the post.
3. Confirm that nothing is fetched while you merely scroll. In the network inspector, no publisher request should appear
   until you press the button.
4. Press Analyze article. The card should show the flagged dimensions, token count, cost and, when the page was long, a
   truncated marker.
5. Press it again. It should come straight from cache with no new request to TypeSafe.
6. Reload the page and press it again. Still no new request.
7. Pick a client-rendered or paywalled page and confirm the card reports that there was no readable text instead of
   sending page chrome.
8. Click Revoke in settings and confirm a fresh article reports that article access is needed.

## 6. Native X Articles

Long-form articles that X renders itself on a post's own page. Unlike section 5 this asks for no permission and makes
no network request: the text is read out of the page x-scanner is already running on. The action is manual, exactly
like the linked-article one, and it uses the same Article preset, article cache, cost accounting and session counters.

1. Open a post that X renders as a long-form article, for example
   `https://x.com/akshay_pachaar/status/2035341800739877091`
2. Confirm an *Analyze X article* button sits under the post, alongside any *Analyze article* buttons for links in
   the body.
3. Confirm nothing happens on its own: no request in the network inspector, and the HUD cost figure does not move,
   until you click.
4. Click *Analyze X article*. The card should read X ARTICLE with the flagged dimensions, the token count, the cost,
   and a truncated marker when the body was longer than the character cap.
5. Confirm the analyzed text is the long-form body and not the post's own text. The post keeps its own chip from the
   selected post preset; the article is judged separately under the Article preset (density, evidence, sourcing,
   originality, depth, promo, speculation, action).
6. Confirm the HUD's analyzed count grew by one and that the session panel's articles count grew by one, not its post
   count.
7. Click it again, then reload the page and click it again. Neither should reach Jev.
8. Confirm the comments under the article still show no chip and add nothing to the cost while Analyze
   replies/comments is OFF.

### 6.1 Record the live reader DOM markers

Detection is deliberately conservative - a miss is preferred to a wrong answer - so record what the live page really
renders. That is what a later version would be hardened against, and it is a finding to report rather than something
to work around on the page.

1. In the page console, read what x-scanner decided for the focal post:

       [...document.querySelectorAll("article[data-testid='tweet']")].map(a => { const s = a.querySelector(".xs-slot"); return [s?.dataset.tweetId, s?.dataset.xsNativeArticle, s?.dataset.xsNativeArticleEvidence] })

   The focal post must show its own status ID and data-xs-native-article="true". The evidence value names the layer
   that matched: "heading+body", "container:<data-testid>", or "longform". A null or a missing attribute means
   nothing matched and the button will not be offered.

2. Record the reader's own structure, so the markers can be compared with what detection expects:

       (() => { const a = document.querySelector("article[data-testid='tweet']"); return { testids: [...new Set([...a.querySelectorAll("[data-testid]")].map(e => e.getAttribute("data-testid")))], headings: [...a.querySelectorAll("h1,h2,h3,[role='heading']")].map(h => (h.textContent || "").slice(0, 60)) }; })()

3. Note both results with VERIFIED or FAILED, and whether the text analyzed in step 5 above was the article body, the
   post's own text, or nothing. The automated tests run against the fixture, so this step is the only evidence about
   the live page.

## 7. Thread context

Thread context only applies to posts that are analyzed, and replies are off by default. Turn on Analyze
replies/comments in settings before running this section, and make sure the parent post is rendered on
the same page.

1. Switch to Signal and open a post with replies on its own URL.
2. Confirm replies are analyzed and chips render under the right post.
3. With a parent visible above the reply, confirm the reply's request carries parent context. The detail card shows token
   usage, which should be higher for a context-carrying call.
4. Switch thread context to Current post only and confirm replies are analyzed again with a smaller token count, because
   the payload changed.
5. Switch to AI / Tech on a technical thread and confirm a couple of preceding posts are attached.

## 8. Session panel

1. Click session in the HUD.
2. Confirm posts analyzed, cached, spent, average latency, flagged and articles are consistent with what you just did.
3. Confirm useful and noisy dimensions are listed, and top posts and articles are ranked.
4. Confirm opening the panel did not produce any extra Jev call in the network inspector.
5. Click session again to close it.

## 9. Real x.com, basic behaviour (v0.1 regression)

Scroll a logged-in x.com home timeline, then a profile, a thread, and search, with Analyze replies/comments
left off. Confirm:

- replies and comments show no chip at all, and add nothing to the analyzed count or the cost figure
- the post whose own /status/ URL you opened is analyzed, and so is a post that quotes another post. On a conversation
  page every other top-level article is filtered while replies are off, which is section 10's check
- the HUD appears and posts receive slots
- judgments arrive, ordinary posts render clean or flagged
- promoted posts are skipped, text-less posts are skipped
- quoted posts include quoted content
- with Analyze replies/comments on, replies are classified as replies
- fast scrolling does not bill queued posts that leave the active area
- concurrency stays bounded (default 6 in flight)
- scrolling back and reloading use cache
- the settings link and the detail card work
- no obvious console errors, in the page or the extension inspector

## 10. Replies and comments

Analyze replies/comments is off by default. This is the check that the filter is real and reversible.

Do step 2.1 first, with these three values on screen before anything below means anything:

    Version: 0.5.4
    Build: <the sha printed by the build you loaded>
    Analyze replies/comments: OFF

On an individual post page the rule is focal post only. With Analyze replies/comments OFF, x-scanner analyzes exactly the
one top-level article whose own status ID is the ID in the URL, and filters every other top-level article on that page.
That is deliberate: X does not always render a "Replying to" row for direct comments, so reply text is not a reliable
signal there, and anything else X mounts below the focal post on a conversation page, comments and recommendations alike,
is out of scope for main-posts-only mode. On home, profiles, search and lists the old markup rule still decides.

1. Open one individual post (its own /<handle>/status/<id> URL) that has several replies under it.
2. The focal post must get a chip, and its status ID must equal the ID in the address bar. Every other top-level article
   on the page must get no chip at all, and scrolling past them must leave the HUD analyzed count and the cost figure
   unchanged.
3. In the page console, read what the filter decided for each post:

       [...document.querySelectorAll("article[data-testid='tweet']")].map(a => { const s = a.querySelector(".xs-slot"); return [s?.dataset.tweetId, s?.dataset.xsReply, s?.dataset.xsFilterReason, (a.textContent || "").slice(0, 40)] })

   The focal post must show its own status ID, data-xs-reply false, and no filter reason. Every other article must show
   data-xs-filter-reason="status-page-non-root". data-xs-reply is the older markup classifier and may well read false for a
   direct comment: that miss is exactly what v0.5.3 fixes, so the filter reason, not the reply flag, is the value to read
   on this page. A missing attribute on any slot means the running build predates the diagnostics and step 2.1 was not
   satisfied.
4. Open the extension inspector and confirm no request was made for the comment text.
5. Turn Analyze replies/comments on and save, then reload x.com and open the same post. Replies should now be analyzed
   exactly as they were in v0.5, with thread context attaching the parent.
6. Turn it back off. The comment chips must disappear again, including any built from cached results, and no further
   comment requests may be made.
7. Check one timeline surface with replies still off: home, a profile, or search. There, a post X marks with a "Replying
   to" row must still be skipped and show no chip, and an ordinary post must still be analyzed. The focal-post rule
   applies to individual /status/ pages only.

## 11. Real Jev / TypeSafe

Confirm TypeSafe connection succeeds, real requests reach Jev, the response model is shown, token usage is returned, and the
HUD cost changes. In the network inspector, confirm the only external destinations are api.typesafe.ai and the article
origins you explicitly asked to analyze.

## 12. Firefox / Zen lifecycle

1. Analyze several posts.
2. Leave the browser idle long enough for the background event page to become inactive if Zen suspends it.
3. Resume scrolling on x.com.
4. Verify new analyses still work after the background wakes.

## 13. Cache

1. Analyze visible posts, then scroll far away and back. Cached judgments should reappear with no new calls.
2. Reload x.com. The first screen should still come from cache.
3. Repeat for a linked article, and for a native X Article.

Do not claim browser-restart persistence unless you tested a non-temporary installation. Temporary add-ons are removed when
Zen exits.

## Record

Mark each step VERIFIED or FAILED as you run it. Automated tests do not replace this checklist.
