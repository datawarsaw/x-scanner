# Security

Lightweight policy for a small extension with no backend.

- Report vulnerabilities by opening a private channel with the maintainers (see the repository contact) rather than filing a public issue with exploit details.
- Never commit API keys, tokens, or credentials. The only secret the extension handles is the user's own TypeSafe key, which lives in local extension storage and is never logged or committed. `npm run calibrate` reads it from `TYPESAFE_API_KEY` in the environment.
- Scope: content-script DOM access on x.com/twitter.com, one required API host (`https://api.typesafe.ai/*`), optional article hosts granted on demand, local storage only. No backend, no sync, no telemetry.
- Out of scope for this policy: X itself, TypeSafe's API and its handling of submitted content (see TypeSafe's own terms and privacy policy).
