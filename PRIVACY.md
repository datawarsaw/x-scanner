# Privacy policy for x-scanner

Last updated 2026-09-20.

x-scanner is a browser extension that sends the text of posts you scroll past on X to TypeSafe's Jev
API and shows the answers next to the post. It has no server of its own and no analytics.

## What leaves your browser

- **Post text.** The text of a post, the text of a quoted post if there is one, and whether the post is
  a reply, are sent to `api.typesafe.ai` when the post comes near your viewport. Nothing else about the
  post is sent: no author name, handle, post id, media, or engagement numbers.
- **Replies and comments stay behind by default.** Posts X marks as replies are not sent anywhere at all
  unless you turn on Analyze replies/comments in settings.
- **Thread context, when the preset asks for it.** On a post's own page, the Signal and AI / Tech presets
  also send the quoted post, the direct parent post, and up to two preceding posts, so a reply can be
  judged against what it answers. The Default preset sends the quoted post only, exactly as before.
- **Article text, only when you ask.** Pressing *Analyze article* on a linked post fetches that page,
  reduces it to its readable body, drops scripts and navigation, and sends the title, canonical URL,
  domain and that body text - capped at the configured character limit - to TypeSafe. No article is
  fetched or sent unless you press the button.
- **Your TypeSafe API key**, as the authorization header on those requests.

Article pages are fetched without your cookies, and only from the origin the post links to. TypeSafe's
handling of requests is described in
[TypeSafe's privacy policy](https://docs.typesafe.ai/legal); as of this writing TypeSafe states it does
not train on customer requests.

## What stays in your browser

Stored in Chrome's extension storage on your device, never synced or transmitted by the extension:

- your API key and settings,
- a cache of results keyed by post id, and article results keyed by canonical URL, so something you
  have already analyzed is not sent again,
- lifetime counters (posts analyzed, tokens, cost).

You can clear the post cache, the article cache and the counters from the settings page, and removing
the extension deletes all of it.

## What the extension does not do

- It does not collect, store, or transmit your identity, browsing history, or which posts you read, to
  anyone, including the authors of the extension.
- It does not read or send X cookies or direct messages. It reads the posts on screen, and it reads a
  linked article's page only when you press *Analyze article* on that post.
- It does not sell or share data with third parties. The only third party is TypeSafe, and only the
  post text and, when you ask for one, the article text goes there, only because you asked the extension
  to analyze something with your own key.

## Contact

Open an issue at https://github.com/oso95/x-scanner/issues.
