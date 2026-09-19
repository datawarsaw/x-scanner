# Zen / Firefox smoke test

Development-only. Do not publish this build to AMO. Do not put a TypeSafe API key in this file, in source, or in build output.

Chromium uses a background service worker. Firefox and Zen use an MV3 event-page background script (`background.scripts`) because Firefox does not run `background.service_worker` for this extension. The Firefox manifest also sets `browser_specific_settings.gecko.id` to `x-scanner@local` so reloading the temporary add-on keeps the same extension identity (settings and cache).

## 1. Build

From the repository root:

```sh
npm install
npm run build:firefox
```

The loadable artifact is `dist-firefox/`. Optional zip:

```sh
npm run package:firefox
```

## 2. Installation

1. Open Zen.
2. Go to `about:debugging#/runtime/this-firefox`.
3. Under **This Firefox**, click **Load Temporary Add-on**.
4. Select `dist-firefox/manifest.json`.
5. Confirm x-scanner appears and the background script is running (Inspect / status shows it loaded). Temporary add-ons do not require AMO signing.

If you reload the add-on after rebuilding, load the same `dist-firefox/manifest.json` again.

## 3. Settings

Never paste a real key into docs, tickets, or screenshots.

1. Open x-scanner settings (toolbar icon, or the HUD settings link).
2. Enter your TypeSafe API key by hand.
3. Click **Test connection**. Expect a success line with the Jev model, latency, and token count.
4. Click **Save**.
5. Reload the settings page and confirm the key and options are still there.

## 4. Real x.com

Stay authenticated on x.com. Check home, a profile, a thread/replies, and search if convenient. Scroll far enough that the timeline virtualizes.

Confirm:

- HUD appears in the corner
- posts receive x-scanner slots
- analyses arrive
- normal posts render judgments
- promoted posts are skipped (`promoted, not analyzed`)
- text-less posts are skipped (`no text to analyze`)
- quoted posts include quoted content in the request/detail
- replies are classified as replies
- fast scrolling does not bill queued posts that leave the active area
- concurrency stays bounded (default 6 in flight)
- scrolling back uses cache (no new Jev calls for already analyzed visible posts)
- page reload uses cache
- settings link works
- detail card works
- no obvious console errors on the page or in the extension inspector

## 5. Real Jev / TypeSafe

Confirm:

- TypeSafe connection succeeds
- real requests reach Jev (`POST /v1/systemone`)
- response model is displayed
- token usage is returned
- HUD cost changes
- no unexpected destinations receive network traffic (only `api.typesafe.ai` besides X itself)

## 6. Firefox / Zen background lifecycle

1. Analyze several posts.
2. Leave the browser idle long enough for the background event page to become inactive if Firefox/Zen suspends it. In `about:debugging`, the background may show as stopped.
3. Resume scrolling on x.com.
4. Verify new analyses still work after the background wakes.

## 7. Cache

Separately:

1. Analyze visible posts.
2. Scroll away and back: previously analyzed posts should re-render from cache with no new Jev calls.
3. Reload x.com: the first screen should still come from cache.

Do not claim browser-restart persistence unless you tested a non-temporary installation. Temporary add-ons are removed when Zen/Firefox exits.

## Record

Mark each as VERIFIED or FAILED when you run this list. Automated CI does not replace this checklist.

