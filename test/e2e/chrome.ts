import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Branded Google Chrome dropped --load-extension in version 137, so prefer a Chrome for Testing or
 * Chromium build. Playwright's browser cache is the usual place to find one; CHROME_PATH overrides.
 * Only the full browser can load an extension, so the chromium_headless_shell-<revision> entries in
 * the same cache are deliberately skipped.
 */

/** Playwright's cache root per platform: macOS, Linux, then Windows. */
function cacheRoots(): string[] {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  return [
    path.join(home, "Library/Caches/ms-playwright"),
    path.join(home, ".cache/ms-playwright"),
    path.join(localAppData, "ms-playwright"),
  ];
}

/** Where each platform keeps the executable inside chromium-<revision>/. */
const BROWSER_RELATIVE_PATHS = [
  "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chrome-linux/chrome",
  "chrome-linux64/chrome",
  "chrome-win64/chrome.exe",
  "chrome-win/chrome.exe",
];

/** Standalone installs, used only when the Playwright cache has nothing. */
function standaloneCandidates(): string[] {
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  return [
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    path.join(programFiles, "Chromium", "Application", "chrome.exe"),
  ];
}

export function chromePath(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const found: { n: number; p: string }[] = [];
  for (const cache of cacheRoots()) {
    if (!existsSync(cache)) continue;
    for (const dir of readdirSync(cache)) {
      const m = /^chromium-(\d+)$/.exec(dir);
      if (!m) continue;
      for (const rel of BROWSER_RELATIVE_PATHS) {
        const p = path.join(cache, dir, rel);
        if (existsSync(p)) found.push({ n: Number(m[1]), p });
      }
    }
  }
  found.sort((a, b) => b.n - a.n);
  if (found[0]) return found[0].p;
  for (const p of standaloneCandidates()) if (existsSync(p)) return p;
  throw new Error("no Chromium or Chrome for Testing found; run `npx playwright-core install chromium` or set CHROME_PATH");
}
