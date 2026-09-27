// Bundles the three entry points and copies static files into a browser-specific output directory.
// Chromium (default) → dist-chromium/. Firefox/Zen → dist-firefox/. --e2e → dist-e2e/ with
// http://127.0.0.1 matches so the fixture timeline can be tested in Chromium.
import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TARGETS = ["chromium", "firefox"];
/**
 * Permanent Firefox identity for signing and long-term installs.
 *
 * Chosen as a project-owned email-style id so the same identity survives
 * temporary loading, signed unlisted installs, and a later public AMO listing.
 * Do not change this after the first signed build: changing it creates a new
 * extension identity and drops existing settings and caches.
 * Verify control of the whitegull.ai domain before submission; if it is not
 * controlled, replace with a GUID-style id before the first signed build.
 */
export const FIREFOX_GECKO_ID = "x-scanner@whitegull.ai";
/** 128 is the first Firefox that understands optional_host_permissions, which article analysis needs. */
export const FIREFOX_STRICT_MIN_VERSION = "128.0";
/**
 * AMO data-collection declaration for the Firefox target.
 *
 * Rationale (checked against current MDN for
 * browser_specific_settings.gecko.data_collection_permissions):
 * - websiteContent (required): post text, quoted text, thread context, and
 *   article text are sent to TypeSafe only when the user analyzes something.
 *   The extension cannot function without this.
 * - authenticationInfo (required): the user-provided TypeSafe API key is sent
 *   as the Authorization header on those same analysis calls.
 * - no "optional" declaration — session counters, cache, and settings never
 *   leave the device and there is no telemetry, so nothing is collected
 *   optionally (the schema forbids "none" in "optional"; omitting the key
 *   is the correct way to declare that).
 * Unknown keys are ignored by Firefox older than the schema version, so this
 * stays safe under strict_min_version 128.0.
 */
// Note: "optional" is deliberately omitted. The linter schema for
// OptionalDataCollectionPermission accepts only data categories plus
// "technicalAndInteraction" — "none" is not a valid optional value (it is
// exclusive to "required"). Omitting "optional" defaults to no optional
// collection, which is the truthful statement here.
export const FIREFOX_DATA_COLLECTION_PERMISSIONS = {
  required: ["websiteContent", "authenticationInfo"],
};

/** Only a plain commit sha is allowed through to the UI; nothing machine specific ever reaches it. */
export function isSafeBuildSha(value) {
  return typeof value === "string" && /^[0-9a-f]{7,40}$/.test(value);
}

/**
 * Short HEAD sha for the build identity. Never fails the build: any problem, including a missing git,
 * a detached checkout without git, or unparseable output, yields "unknown".
 */
export function gitBuildSha(cwd = fileURLToPath(new URL(".", import.meta.url))) {
  try {
    const out = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    return isSafeBuildSha(out) ? out : "unknown";
  } catch {
    return "unknown";
  }
}

export function parseBuildArgs(argv = process.argv.slice(2)) {
  const watch = argv.includes("--watch");
  const e2e = argv.includes("--e2e");
  const eq = argv.find((a) => a.startsWith("--target="));
  const i = argv.indexOf("--target");
  const raw = eq ? eq.slice("--target=".length) : i !== -1 ? argv[i + 1] : "chromium";
  if (!raw || !TARGETS.includes(raw)) {
    throw new Error(`unknown --target ${raw ?? "(missing)"}; expected chromium or firefox`);
  }
  if (e2e && raw !== "chromium") throw new Error("--e2e is Chromium-only");
  return { watch, e2e, target: raw };
}

export function outdirFor({ target, e2e }) {
  if (e2e) return "dist-e2e";
  return target === "firefox" ? "dist-firefox" : "dist-chromium";
}

export function manifestForTarget(source, { target, e2e }) {
  const manifest = structuredClone(source);
  if (e2e) {
    manifest.content_scripts[0].matches.push("http://127.0.0.1/*");
    manifest.host_permissions.push("http://127.0.0.1/*");
  }
  if (target === "firefox") {
    // Firefox MV3 does not run background.service_worker; event pages use background.scripts.
    manifest.background = { scripts: ["background.js"] };
    manifest.browser_specific_settings = {
      gecko: {
        id: FIREFOX_GECKO_ID,
        strict_min_version: FIREFOX_STRICT_MIN_VERSION,
        data_collection_permissions: structuredClone(FIREFOX_DATA_COLLECTION_PERMISSIONS),
      },
    };
  }
  return manifest;
}

function copyStatic(outdir, opts) {
  const source = JSON.parse(readFileSync("src/manifest.json", "utf8"));
  const manifest = manifestForTarget(source, opts);
  writeFileSync(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2));
  cpSync("src/options/options.html", `${outdir}/options.html`);
  cpSync("src/options/options.css", `${outdir}/options.css`);
  cpSync("src/content/content.css", `${outdir}/content.css`);
  cpSync("icons", `${outdir}/icons`, { recursive: true });
}

export async function buildExtension(opts) {
  const { watch } = opts;
  const outdir = outdirFor(opts);
  const buildSha = gitBuildSha();
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });

  const ctx = await esbuild.context({
    entryPoints: {
      content: "src/content/index.ts",
      background: "src/background.ts",
      options: "src/options/options.ts",
    },
    bundle: true,
    format: "iife",
    target: "chrome120",
    outdir,
    // Substituted into src/shared/build.ts so the UI can name the running revision.
    define: { __XS_BUILD_SHA__: JSON.stringify(buildSha) },
    sourcemap: watch ? "inline" : false,
    logLevel: "info",
    plugins: [{ name: "static", setup: (b) => b.onEnd(() => copyStatic(outdir, opts)) }],
  });

  if (watch) {
    await ctx.watch();
    console.log(`watching ${opts.target}, output in ${outdir}/`);
    return;
  }
  await ctx.rebuild();
  await ctx.dispose();
  console.log(`built ${opts.target} → ${outdir}/`);
  console.log("build " + buildSha);
}

function isMain() {
  const self = fileURLToPath(import.meta.url);
  const invoked = process.argv[1] && path.resolve(process.argv[1]);
  return Boolean(invoked) && pathToFileURL(path.normalize(invoked)).href === pathToFileURL(path.normalize(self)).href;
}

if (isMain()) {
  try {
    await buildExtension(parseBuildArgs());
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
