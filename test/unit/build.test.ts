import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gitBuildSha, isSafeBuildSha } from "../../build.mjs";
import { BUILD_SHA, browserTarget, versionLabel } from "../../src/shared/build.ts";

test("only a plain commit sha is considered safe build metadata", () => {
  assert.equal(isSafeBuildSha("fad243e"), true);
  assert.equal(isSafeBuildSha("fad243ea11c0a9f367ffb09adec064bea4879b41"), true);
  assert.equal(isSafeBuildSha("unknown"), false);
  assert.equal(isSafeBuildSha("FAD243E"), false);
  assert.equal(isSafeBuildSha("fad243"), false);
  assert.equal(isSafeBuildSha("C:\\Users\\someone\\x-scanner"), false);
  assert.equal(isSafeBuildSha("fad243e-dirty"), false);
  assert.equal(isSafeBuildSha(""), false);
  assert.equal(isSafeBuildSha(undefined), false);
});

test("the repo sha is read from git and stays machine independent", () => {
  const sha = gitBuildSha();
  assert.match(sha, /^([0-9a-f]{7,40}|unknown)$/);
  if (sha !== "unknown") {
    assert.equal(sha.includes("/"), false);
    assert.equal(sha.includes("\\"), false);
    assert.equal(sha.includes(" "), false);
  }
});

test("a missing git checkout falls back instead of failing the build", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "xs-nogit-"));
  assert.equal(gitBuildSha(dir), "unknown");
  assert.equal(gitBuildSha(path.join(dir, "does-not-exist")), "unknown");
});

test("the bundled build id is either a sha or the documented fallback", () => {
  assert.match(BUILD_SHA, /^([0-9a-f]{7,40}|unknown)$/);
});

test("browser target is read back from the artifact manifest", () => {
  assert.equal(browserTarget({ background: { service_worker: "background.js" } }), "Chromium");
  assert.equal(browserTarget({ background: { scripts: ["background.js"] } }), "Firefox");
  assert.equal(browserTarget({}), "Firefox");
});

test("the quiet HUD label names the version and the build", () => {
  assert.equal(versionLabel("0.5.2"), "v0.5.2 \u00b7 " + BUILD_SHA);
  assert.match(versionLabel("0.5.2"), /^v0\.5\.2 \u00b7 ([0-9a-f]{7,40}|unknown)$/);
});

test("the quiet HUD label includes the active preset when provided", () => {
  assert.equal(versionLabel("0.6.2", "Signal v2"), "v0.6.2 \u00b7 " + BUILD_SHA + " \u00b7 Signal v2");
  assert.match(versionLabel("0.6.2", "Signal v2"), /^v0\.6\.2 \u00b7 ([0-9a-f]{7,40}|unknown) \u00b7 Signal v2$/);
});

