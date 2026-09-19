export const TARGETS: readonly ["chromium", "firefox"];
export const FIREFOX_GECKO_ID: string;
export const FIREFOX_STRICT_MIN_VERSION: string;

export function parseBuildArgs(argv?: string[]): {
  watch: boolean;
  e2e: boolean;
  target: "chromium" | "firefox";
};

export function outdirFor(opts: { target: "chromium" | "firefox"; e2e: boolean }): string;

export function manifestForTarget(
  source: any,
  opts: { target: "chromium" | "firefox"; e2e: boolean },
): any;

export function buildExtension(opts: {
  target: "chromium" | "firefox";
  e2e: boolean;
  watch: boolean;
}): Promise<void>;
