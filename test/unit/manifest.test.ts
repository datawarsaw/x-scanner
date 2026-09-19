import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIREFOX_GECKO_ID,
  FIREFOX_STRICT_MIN_VERSION,
  manifestForTarget,
  outdirFor,
  parseBuildArgs,
} from "../../build.mjs";

const source = {
  manifest_version: 3,
  permissions: ["storage"],
  host_permissions: ["https://api.typesafe.ai/*"],
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

