# Screenshot plan (public GitHub and AMO)

Tooling: `npm run screenshots` builds `dist-e2e/` and captures 1280x800 PNGs from the fixture pages with a fake Jev server into `store/screenshot-{1..5}.png` (see `scripts/store-screenshots.ts`). Fixture-based: no real user's posts ever appear. Current set, all with the Signal v2 preset selected: Signal v2 timeline, Signal v2 detail card, settings preset section, session intelligence panel, native X Article card.

Recommended public set (5):

1. Signal v2 on a timeline (topic-first row with density/insight/evidence/actionable/promo/bait).
2. Detail card (bars, raw semantics, token count, cost, latency).
3. Settings / preset selector (Default selected, Signal v2 visible, replies off).
4. Session intelligence panel (counts, cost, topic distribution under Signal v2).
5. Article analysis card (external or native X Article result with truncation note where applicable).

Status: the five screenshots were regenerated 2026-10-04 against v0.6.3 with the Signal v2 preset selected, and each PNG was reviewed for fixture-only content (no API keys, no real user posts). Re-run `npm run screenshots` after any UI change that reaches the timeline row, the detail card, settings, the session panel, or the article card.

AMO notes: screenshots must show the shipped revision's UI. Firefox screenshots may be captured from the temporary add-on on the same fixture pages; record the revision and build sha with the files.
