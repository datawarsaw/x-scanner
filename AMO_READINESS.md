# AMO readiness

Preparation notes for a future addons.mozilla.org submission. **This is not a claim of compliance.** Nothing here has been
reviewed by Mozilla, and the extension has not been submitted. Status below is stated as observed on the date shown.

Last reviewed: 2026-09-20 against v0.5.4 of this repository.

## Permissions

| permission | kind | why |
| --- | --- | --- |
| storage | required | holds the API key, settings, the post and article result caches, and lifetime counters |
| https://api.typesafe.ai/* | required host | the only endpoint the extension calls to analyze text |
| https://*/*, http://*/* | **optional** host | fetching a linked article's HTML when the reader presses Analyze article |

An article X renders itself is a separate, permission-free path: pressing Analyze X article reads the long-form text out
of the x.com page the content script is already running on. It makes no network request of its own and needs no host
permission, so it adds nothing to the table above.

Anything beyond api.typesafe.ai is optional and starts ungranted. There is no all_urls entry, and no required host permission
outside TypeSafe. The artifact validator fails the build if a required broad host pattern ever appears in a generated manifest.

### Why article hosts are optional rather than required

Article analysis needs to read HTML from an arbitrary publisher domain. The alternatives were a required broad host
permission, granted at install before the user has ever asked for an article, or an optional one granted on demand. The
optional route is used because it keeps the install-time permission set to one endpoint and makes the broader access a
visible, revocable decision.

The background requests the **specific origin** of the link, for example https://publisher.example/*, when the reader presses
Analyze article. Chromium only allows a permission request during a user gesture, and a message from a content script does not
reliably carry that gesture into a service worker, so the request can be refused. When that happens the card says article
access is not granted, and the reader can grant it deliberately from the settings page with Grant article access. That path is
a click on an extension page, which every supported browser accepts. Revoke sits next to it.

## External endpoints

- https://api.typesafe.ai/v1/systemone - the analysis call. The base URL is configurable in settings.
- Whatever origin a post links to - fetched only after an explicit Analyze article click, and only once per canonical URL.

A native X Article is not fetched from anywhere. Its text is read from the DOM of the x.com page that is already open,
only after an explicit Analyze X article click.

No other host is contacted. There is no backend, no CDN, no remote configuration, and no update ping of our own.

## Data sent to TypeSafe

Per analyzed post:

- the post text, as written;
- the quoted post's text, when there is one;
- a boolean for whether the post is a reply;
- and, when the selected preset asks for thread context, the direct parent text and up to two preceding post texts.

Per analyzed article: the extracted title, the lead or standfirst when the source renders one, the canonical URL, the
domain, the readable body text (capped, and truncated with a marker when it is), and the character count. For a native X
Article the canonical URL is the post's own x.com address, so it carries the author's handle; no other author information
is in the request.

Never sent: author name or handle, post id, media or alt text, engagement counts, timestamps, follower data, cookies, direct
messages, browsing history, or any identifier for the reader.

## API key handling

Stored in extension local storage under the settings object. It is read only by the background script and sent only as the
Authorization Bearer header to the configured base URL. It never reaches the content script, the settings page source,
generated manifests, build artifacts, or logs, and it is not committed anywhere in this repository. The settings field is a
password input with an explicit show/hide toggle.

## Article fetching behaviour

- Manual and per-post. Nothing is fetched while scrolling.
- Credentials are omitted, so no cookies are attached to the publisher request.
- Redirects are followed; the canonical URL from the page's own metadata is what gets cached.
- The response is rejected when it is not HTML, or when it exceeds 1.5 MB.
- Script, style, nav, footer, aside, form, iframe and SVG content is dropped before analysis, and the body is capped at the
  configured character limit, 8000 by default.

## Telemetry

None. No analytics, crash reporting, remote logging, or first-party network calls of any kind. Cost and usage counters are
computed locally and never leave the device.

## Build and source relationship

    npm ci
    npm run build:firefox     # dist-firefox/
    npm run package:firefox   # x-scanner-0.5.4-firefox.zip

The shipped artifact contains only background.js, content.js, options.js, the two stylesheets, the settings page, icons, and a
generated manifest.json. Sources are plain TypeScript under src/; the only build step is esbuild via build.mjs, with no
runtime download and no remote code. The Firefox build swaps the background entry to background.scripts and adds a stable
gecko id.

Run npm run validate:artifacts to check both generated manifests and the required files.

## Manifest metadata

- manifest_version 3
- browser_specific_settings.gecko.id is x-scanner@local, a development identity; the permanent id is a release decision
- strict_min_version 128.0, the first Firefox that understands optional_host_permissions, which article access uses
- homepage_url points at the upstream repository

Firefox 139 and later show a notice that browser_specific_settings.gecko.data_collection_permissions is missing. It is not
required for temporary loading, and it is deliberately left unset in v0.5 rather than declaring a consent surface that has not
been designed or tested. It must be resolved before submission.

## Still required before submission

1. Decide and declare data_collection_permissions. A truthful declaration is that technical and interaction data goes to a
   third party only when the user analyzes something, and the wording must be checked against the current schema.
2. Replace the development gecko id with the permanent one issued at submission.
3. Sign the artifact and verify the signed build loads from a normal profile.
4. Publish a public source URL for the reviewer package, or ship the sources as the submitted package.
5. Re-check PRIVACY.md against the shipped build, including that the TypeSafe statement quoted in it is still accurate.
6. Confirm the listing copy under store/ matches v0.5 behaviour, including article analysis.
7. Re-run the full validation matrix and record the results for the submitted revision.

## Not claimed

No Mozilla review, and no policy compliance beyond what web-ext lint reports, is asserted by this document.
