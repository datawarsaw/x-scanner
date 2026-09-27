// Inspects built Chromium and Firefox artifacts. Does not rebuild.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const REQUIRED_FILES = [
  "manifest.json",
  "background.js",
  "content.js",
  "options.js",
  "options.html",
  "options.css",
  "content.css",
  "icons/16.png",
  "icons/32.png",
  "icons/48.png",
  "icons/128.png",
];

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function loadManifest(dir) {
  const p = path.join(dir, "manifest.json");
  if (!existsSync(p)) fail(`missing ${p}`);
  return JSON.parse(readFileSync(p, "utf8"));
}

function assertFiles(dir) {
  for (const rel of REQUIRED_FILES) {
    if (!existsSync(path.join(dir, rel))) fail(`missing ${dir}/${rel}`);
  }
}

function assertShared(manifest, dir) {
  if (manifest.manifest_version !== 3) fail(`${dir}: manifest_version is not 3`);
  const matches = manifest.content_scripts?.[0]?.matches ?? [];
  if (!matches.includes("https://x.com/*") || !matches.includes("https://twitter.com/*")) {
    fail(`${dir}: content_scripts must match x.com and twitter.com`);
  }
  const hosts = manifest.host_permissions ?? [];
  if (!hosts.includes("https://api.typesafe.ai/*")) fail(`${dir}: missing TypeSafe host permission`);
  if (hosts.includes("<all_urls>") || hosts.some((h) => h === "*://*/*")) {
    fail(`${dir}: article hosts must stay optional, not required`);
  }
  const optional = manifest.optional_host_permissions ?? [];
  if (!optional.includes("https://*/*")) fail(`${dir}: missing optional article host permission`);
  if (!(manifest.permissions ?? []).includes("storage")) fail(`${dir}: missing storage permission`);
  if (manifest.content_scripts?.[0]?.js?.[0] !== "content.js") fail(`${dir}: content script is not content.js`);
}

function assertChromium(manifest, dir) {
  if (manifest.background?.service_worker !== "background.js") {
    fail(`${dir}: Chromium background must use service_worker background.js`);
  }
  if (manifest.background?.scripts) fail(`${dir}: Chromium background should not use scripts`);
}

function assertFirefox(manifest, dir) {
  const scripts = manifest.background?.scripts;
  if (!Array.isArray(scripts) || !scripts.includes("background.js")) {
    fail(`${dir}: Firefox background must use scripts including background.js`);
  }
  if (manifest.background?.service_worker && !scripts) {
    fail(`${dir}: Firefox artifact relies solely on service_worker`);
  }
  if (manifest.background?.service_worker && !scripts?.length) {
    fail(`${dir}: Firefox artifact relies solely on service_worker`);
  }
  if (manifest.browser_specific_settings?.gecko?.id !== "x-scanner@whitegull.ai") {
    fail(`${dir}: missing stable gecko id x-scanner@whitegull.ai`);
  }
  const dcp = manifest.browser_specific_settings?.gecko?.data_collection_permissions;
  if (!dcp || !Array.isArray(dcp.required) || !dcp.required.includes("websiteContent") || !dcp.required.includes("authenticationInfo")) {
    fail(`${dir}: missing required data_collection_permissions [websiteContent, authenticationInfo]`);
  }
  if (dcp.optional !== undefined && (!Array.isArray(dcp.optional) || dcp.optional.includes("none"))) {
    fail(`${dir}: data_collection_permissions.optional must be omitted or hold real categories ("none" is not valid there)`);
  }
}

const chromiumDir = "dist-chromium";
const firefoxDir = "dist-firefox";
if (!existsSync(chromiumDir)) fail("missing dist-chromium/; run npm run build:chromium");
if (!existsSync(firefoxDir)) fail("missing dist-firefox/; run npm run build:firefox");

assertFiles(chromiumDir);
assertFiles(firefoxDir);
const chromium = loadManifest(chromiumDir);
const firefox = loadManifest(firefoxDir);
assertShared(chromium, chromiumDir);
assertShared(firefox, firefoxDir);
assertChromium(chromium, chromiumDir);
assertFirefox(firefox, firefoxDir);
// The version shown in the UI comes from the generated manifest, so these must agree.
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
for (const [name, manifest] of [[chromiumDir, chromium], [firefoxDir, firefox]]) {
  if (manifest.version !== pkg.version) fail(`${name}: manifest version ${manifest.version} != package.json ${pkg.version}`);
}
console.log("artifacts ok");
