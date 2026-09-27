/**
 * Build identity. The version always comes from the running manifest, never from a literal in the
 * source, so a stale build cannot report a version it does not have.
 */
declare const __XS_BUILD_SHA__: string;

/** Substituted at bundle time by build.mjs. Under node the global is absent and this is "unknown". */
export const BUILD_SHA: string =
  typeof __XS_BUILD_SHA__ === "string" && /^[0-9a-f]{7,40}$/.test(__XS_BUILD_SHA__) ? __XS_BUILD_SHA__ : "unknown";

export interface BuildManifest {
  version?: string;
  background?: { service_worker?: string; scripts?: string[] };
}

/** Which background model the running artifact declares, read back from its own manifest. */
export function browserTarget(manifest: BuildManifest): "Chromium" | "Firefox" {
  return manifest.background?.service_worker ? "Chromium" : "Firefox";
}

/** Quiet one-line identity, e.g. "v0.5.3 · 8e2e65c". */
export function versionLabel(version: string, presetLabel?: string): string {
  const base = "v" + version + " · " + BUILD_SHA;
  return presetLabel ? base + " · " + presetLabel : base;
}

