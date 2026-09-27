# Screenshot plan (public GitHub and AMO)

Tooling: `npm run screenshots` builds `dist-e2e/` and captures 1280x800 PNGs from the fixture timeline with a fake Jev server into `store/screenshot-{1,2,3}.png` (see `scripts/store-screenshots.ts`). Fixture-based: no real user's posts ever appear. Current set: timeline with flags and panel, detail card, settings.

Recommended public set (5):

1. Signal v2 on a timeline (topic-first row with density/insight/evidence/actionable/promo/bait).
2. Detail card (bars, raw semantics, token count, cost, latency).
3. Settings / preset selector (Default selected, Signal v2 visible, replies off).
4. Session intelligence panel (counts, cost, topic distribution under Signal v2).
5. Article analysis card (external or native X Article result with truncation note where applicable).

Status: the current three screenshots predate Signal v2 as the showcase row and were captured before the v0.6.1 hardening work finished. Do not treat them as final. Regenerate after the final smoke test with `npm run screenshots` (extend `scripts/store-screenshots.ts` for panels 4-5 if the in-flight UI changes them), then review each PNG for fixture-only content before publishing.

AMO notes: screenshots must show the shipped revision's UI. Firefox screenshots may be captured from the temporary add-on on the same fixture pages; record the revision and build sha with the files.
