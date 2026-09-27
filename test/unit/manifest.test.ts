import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  FIREFOX_GECKO_ID,
  FIREFOX_STRICT_MIN_VERSION,
  manifestForTarget,
  outdirFor,
  parseBuildArgs,
} from "../../build.mjs";

const shipped = JSON.parse(readFileSync(path.join(import.meta.dirname, "../../src/manifest.json"), "utf8")) as {
  version: string;
  permissions: string[];
  host_permissions: string[];
  optional_host_permissions: string[];
  content_scripts: { matches: string[]; js: string[]; css: string[] }[];
  background: { service_worker?: string; scripts?: string[] };
};

const source = {
  manifest_version: 3,
  permissions: ["storage"],
  host_permissions: ["https://api.typesafe.ai/*"],
  optional_host_permissions: ["https://*/*", "http://*/*"],
  background: { service_worker: "background.js" },
  content_scripts: [
    {
      matches: ["https://x.com/*", "https://twitter.com/*"],
      js: ["content.js"],
      css: ["content.css"],
    },
  ],
};

test("parseBuildArgs defaults to chromium and maps output dirs", () => {
  assert.deepEqual(parseBuildArgs([]), { watch: false, e2e: false, target: "chromium" });
  assert.equal(parseBuildArgs(["--target", "firefox"]).target, "firefox");
  assert.equal(parseBuildArgs(["--target=firefox"]).target, "firefox");
  assert.equal(outdirFor({ target: "chromium", e2e: false }), "dist-chromium");
  assert.equal(outdirFor({ target: "firefox", e2e: false }), "dist-firefox");
  assert.equal(outdirFor({ target: "chromium", e2e: true }), "dist-e2e");
  assert.throws(() => parseBuildArgs(["--target", "safari"]), /unknown --target/);
  assert.throws(() => parseBuildArgs(["--e2e", "--target", "firefox"]), /Chromium-only/);
});

test("Chromium manifest keeps the service worker and shared permissions", () => {
  const m = manifestForTarget(source, { target: "chromium", e2e: false });
  assert.equal(m.manifest_version, 3);
  assert.equal(m.background.service_worker, "background.js");
  assert.equal(m.background.scripts, undefined);
  assert.equal(m.browser_specific_settings, undefined);
  assert.deepEqual(m.content_scripts[0].matches, ["https://x.com/*", "https://twitter.com/*"]);
  assert.deepEqual(m.host_permissions, ["https://api.typesafe.ai/*"]);
  assert.deepEqual(m.permissions, ["storage"]);
});

test("Firefox manifest uses background.scripts and a stable gecko id", () => {
  const m = manifestForTarget(source, { target: "firefox", e2e: false });
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.background, { scripts: ["background.js"] });
  assert.equal(m.background.service_worker, undefined);
  assert.equal(m.browser_specific_settings.gecko.id, FIREFOX_GECKO_ID);
  assert.equal(m.browser_specific_settings.gecko.strict_min_version, FIREFOX_STRICT_MIN_VERSION);
  assert.deepEqual(m.browser_specific_settings.gecko.data_collection_permissions.required.sort(), ["authenticationInfo", "websiteContent"].sort());
  assert.equal(m.browser_specific_settings.gecko.data_collection_permissions.optional, undefined);
  assert.deepEqual(m.content_scripts[0].matches, ["https://x.com/*", "https://twitter.com/*"]);
  assert.deepEqual(m.host_permissions, ["https://api.typesafe.ai/*"]);
  assert.deepEqual(m.permissions, ["storage"]);
});

test("e2e Chromium manifest adds the fixture origin without changing the worker", () => {
  const m = manifestForTarget(source, { target: "chromium", e2e: true });
  assert.equal(m.background.service_worker, "background.js");
  assert.ok(m.content_scripts[0].matches.includes("http://127.0.0.1/*"));
  assert.ok(m.host_permissions.includes("http://127.0.0.1/*"));
});

test("article hosts stay optional in both targets", () => {
  for (const target of ["chromium", "firefox"] as const) {
    const m = manifestForTarget(source, { target, e2e: false });
    assert.deepEqual(m.optional_host_permissions, ["https://*/*", "http://*/*"]);
    assert.equal(m.host_permissions.includes("*://*/*"), false);
    assert.equal(m.host_permissions.includes("<all_urls>"), false);
    assert.deepEqual(m.host_permissions, ["https://api.typesafe.ai/*"]);
  }
});

// The shipped manifest itself, not just the generator: native X Article reading must not have added
// a permission. It runs on the x.com content script's existing DOM access, so this list stays short.
test("the shipped manifest asks for storage, TypeSafe, and optional article hosts only", () => {
  assert.deepEqual(shipped.permissions, ["storage"]);
  assert.deepEqual(shipped.host_permissions, ["https://api.typesafe.ai/*"]);
  assert.deepEqual(shipped.optional_host_permissions, ["https://*/*", "http://*/*"]);
  assert.deepEqual(shipped.content_scripts[0]!.matches, ["https://x.com/*", "https://twitter.com/*"]);
  assert.deepEqual(shipped.content_scripts[0]!.js, ["content.js"]);
  assert.deepEqual(shipped.content_scripts[0]!.css, ["content.css"]);
  assert.equal(shipped.background.service_worker, "background.js");
});

test("the shipped manifest version tracks package.json", () => {
  const pkg = JSON.parse(readFileSync(path.join(import.meta.dirname, "../../package.json"), "utf8")) as { version: string };
  assert.equal(shipped.version, pkg.version);
});
