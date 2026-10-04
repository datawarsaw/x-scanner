# Signed unlisted Firefox install (operator flow)

How to obtain a signed unlisted build for permanent local installation in Firefox/Zen. Do not perform any account action in an automated run; every step below is a human operator action. Nothing has been submitted.

## Prerequisites

- The release revision is tagged and final (v0.6.3 smoke test passed, privacy review done, README final, screenshots final).
- Node 22 or newer, clean checkout, no local modifications.

## 1. Build and package the final artifact

```sh
npm ci
npm run build:firefox
npm run validate:artifacts
npm run package:firefox
```

Record the file name, size, version, extension id (`x-scanner@datawarsaw.com`), and build sha shown by the build. Keep the zip; it is the file you upload.

## 2. Mozilla Add-ons developer account

Sign in (or register) at addons.mozilla.org with the account that will own the listing. Enable two-factor authentication. This account owns the extension id from here on; do not change the id afterwards.

## 3. Submit as self-distributed / unlisted

1. Open the Add-on Developer Hub and submit a new add-on.
2. Choose the self-distribution (unlisted, not listed on AMO) path when the current hub workflow offers it.
3. Upload `x-scanner-<version>-firefox.zip`.
4. When asked for source, provide the public repository URL at the tagged revision, or upload a source archive plus AMO_REVIEW.md reproduction steps.
5. Fill the required metadata from `store/firefox-listing.md` and link the published PRIVACY.md.

## 4. Receive the signed XPI

Mozilla signs the approved build and makes a signed `.xpi` available in the hub. Download it from the approved version's page. Do not modify or re-zip it; any change invalidates the signature.

## 5. Install in Zen / Firefox

1. Open `about:addons`, open the gear menu, choose Install Add-on From File, and select the signed `.xpi`. Accept the permission prompt.
2. Alternatively distribute the signed file from the operator's own download page; Firefox installs it as long as the signature is valid.

## 6. Verify persistence and identity

1. Restart the browser. Confirm the extension is still installed and enabled (unlisted signed installs persist; temporary add-ons do not).
2. Open x-scanner settings, About: confirm version, build sha, and browser target Firefox.
3. Confirm the extension id is `x-scanner@datawarsaw.com`.
4. Scroll x.com with a test key and confirm analysis, caching, and the session panel behave as in ZEN_TEST.md.

## 7. Attach to the GitHub release

When the public GitHub release is cut, attach the exact signed `.xpi` (plus its sha256) to the release notes alongside the source zip, with a note that it is the Mozilla-signed unlisted build of the tagged revision. See docs/RELEASE_NOTES_TEMPLATE.md.
