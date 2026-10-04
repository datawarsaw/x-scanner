# Public AMO listing path (later)

Separate from the signed unlisted install (docs/FIREFOX_SIGNING.md). Public listing happens only after all of these are true:

- Final v0.6.3 smoke test passed on a clean build.
- Privacy review re-done against the shipped build (PRIVACY.md matches behavior, TypeSafe statements still accurate).
- Final screenshots regenerated from the fixture after any UI change (store/SCREENSHOT_PLAN.md).
- README, store/firefox-listing.md, and AMO_REVIEW.md match the shipped revision.
- A signed unlisted install has been verified persistent across browser restarts.

## Then

1. In the Developer Hub, move the add-on from unlisted to listed (or submit a listed version, per the current hub workflow).
2. Complete the listing, screenshots, category, language, support and source URLs, and the data and privacy disclosures from store/firefox-listing.md.
3. Submit for full review. Reviews for extensions touching a major site can take days; expect questions about why x.com access is needed and answer from the single-purpose statement.
4. Do not claim store availability in the README or listing until the listing is actually public.

Do not submit in this run.
