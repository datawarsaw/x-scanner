# X-Scanner 0.6.4 release notes

Notes for the 0.6.4 release candidate. Paste into the GitHub release and (later) the AMO version notes. No unverified claims.

## Highlights

- Post annotations redesigned as a subtle left rail, so the timeline stays quiet.
- The analysis HUD is hidden by default, with a Show analysis HUD setting that applies live.
- The Signal v2 detail panel layers correctly over images, videos, and quote cards.

## Signal v2 row (B2 subtle left rail)

- Annotations render as editorial marginalia: a 1.5 px left rail with the values beside it, replacing chips.
- Promo and engagement-bait values below 40 are omitted from the compact row; 40-69 stays a neutral value.
- A promo or bait filter at 70 or more turns the rail and that value amber.

## Analysis HUD

- The HUD is hidden by default.
- A new Show analysis HUD setting turns it on or off.
- Toggling the setting applies live, without reloading the page.

## Detail panel

- The Signal v2 detail panel is portal-rendered into a fixed overlay root, so it stays above images, videos, and video players on X media and quote cards, and beneath the HUD.

## Unchanged in 0.6.4

- No Signal v2 scoring changes.
- No API, cache, or billing changes.
- No permission changes.

## Attribution

- Originally based on oso95/x-scanner. Upstream authors do not endorse this fork.
