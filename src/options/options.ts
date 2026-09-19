// Options page. Reads settings into the form, writes the form back on Save.
import type { AnalyzeReply, Dimension, Settings } from "../shared/types.ts";
import { loadSettings, loadStats, normalizeSettings, saveSettings, STATS_KEY } from "../shared/settings.ts";
import { DEFAULT_DIMENSIONS, validateDimension } from "../shared/questions.ts";
import { answerValue } from "../content/labels.ts";
import { PRESETS, PRESET_BY_ID } from "../shared/presets.ts";
import { BUILD_SHA, browserTarget, type BuildManifest } from "../shared/build.ts";

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

const dimList = $("#dimList");
const template = $<HTMLTemplateElement>("#dimTemplate");

function fillForm(s: Settings): void {
  $<HTMLInputElement>("#apiKey").value = s.apiKey;
  $<HTMLInputElement>("#model").value = s.model;
  $<HTMLInputElement>("#pricePerMtok").value = String(s.pricePerMtok);
  $<HTMLInputElement>("#baseUrl").value = s.baseUrl;
  $<HTMLInputElement>("#concurrency").value = String(s.concurrency);
  $<HTMLInputElement>("#dwellMs").value = String(s.dwellMs);
  $<HTMLInputElement>("#lookaheadPx").value = String(s.lookaheadPx);
  $<HTMLInputElement>("#cacheMax").value = String(s.cacheMax);
  $<HTMLInputElement>("#enabled").checked = s.enabled;
  $<HTMLSelectElement>("#scope").value = s.scope;
  $<HTMLInputElement>("#accountHandle").value = s.accountHandle;
  $<HTMLInputElement>("#analyzeReplies").checked = s.analyzeReplies;
  $<HTMLSelectElement>("#preset").value = s.selectedPreset;
  $<HTMLSelectElement>("#threadContextMode").value = s.threadContextMode;
  $<HTMLInputElement>("#articleAnalysisEnabled").checked = s.articleAnalysisEnabled;
  $<HTMLInputElement>("#maxArticleChars").value = String(s.maxArticleChars);
  $<HTMLInputElement>("#articleCacheMax").value = String(s.articleCacheMax);
  renderDims(s.dimensions);
  renderPreset();
  renderReplyState();
  void renderArticleAccess();
}

function renderPresetOptions(): void {
  const sel = $<HTMLSelectElement>("#preset");
  sel.textContent = "";
  for (const p of PRESETS) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.label;
    sel.appendChild(o);
  }
}

/** Keeps the preset description and the dimension-count note in sync with the selector. */
function renderPreset(): void {
  const id = $<HTMLSelectElement>("#preset").value as keyof typeof PRESET_BY_ID;
  const p = PRESET_BY_ID[id];
  $("#presetNote").textContent = p ? `${p.description} (${p.dimensions.length} dimensions)` : "";
  const note = $("#dimNote");
  if (id === "default") {
    note.textContent = "These are the dimensions currently in use.";
  } else {
    note.textContent = `The ${p?.label ?? id} preset is in use. These dimensions are kept for the Default preset and are used again when you switch back.`;
  }
}

async function renderArticleAccess(): Promise<void> {
  const out = $("#articleAccessOut");
  try {
    const granted = await chrome.permissions.contains({ origins: ["https://*/*", "http://*/*"] });
    out.textContent = granted ? "article access granted" : "not granted";
  } catch {
    out.textContent = "unavailable";
  }
}

function renderDims(dims: Dimension[]): void {
  dimList.textContent = "";
  for (const d of dims) dimList.appendChild(dimCard(d));
}

function dimCard(d: Dimension): HTMLElement {
  const frag = template.content.cloneNode(true) as DocumentFragment;
  const card = $(".dim", frag);
  card.dataset.type = d.type;
  $<HTMLInputElement>(".d-enabled", card).checked = d.enabled;
  $<HTMLInputElement>(".d-label", card).value = d.label;
  $<HTMLInputElement>(".d-id", card).value = d.id;
  $<HTMLSelectElement>(".d-type", card).value = d.type;
  $<HTMLTextAreaElement>(".d-instructions", card).value = d.instructions;
  $<HTMLTextAreaElement>(".d-levels", card).value = (d.levels ?? []).join("\n");
  $<HTMLTextAreaElement>(".d-true", card).value = d.criteria?.true ?? "";
  $<HTMLTextAreaElement>(".d-false", card).value = d.criteria?.false ?? "";
  $<HTMLSelectElement>(".d-direction", card).value = d.direction;
  $<HTMLInputElement>(".d-threshold", card).value = String(d.threshold);
  $<HTMLInputElement>(".d-color", card).value = d.color ?? DEFAULT_FLAG_COLOR;
  const refreshHint = () => {
    const type = $<HTMLSelectElement>(".d-type", card).value;
    card.dataset.type = type;
    const th = $<HTMLInputElement>(".d-threshold", card);
    if (type === "noul") {
      th.min = "0";
      th.max = "1";
      th.step = "0.05";
      $(".d-hint", card).textContent = "probability of yes, 0 to 1";
    } else {
      const n = levelsOf(card).length;
      th.min = "0";
      th.max = String(Math.max(1, n - 1));
      th.step = "0.1";
      $(".d-hint", card).textContent = `level index, 0 to ${Math.max(1, n - 1)}`;
    }
  };
  $(".d-type", card).addEventListener("change", refreshHint);
  $(".d-levels", card).addEventListener("input", refreshHint);
  $(".d-remove", card).addEventListener("click", () => card.remove());
  refreshHint();
  return card;
}

/** Default orange lives in CSS; only a changed color is stored. */
const DEFAULT_FLAG_COLOR = "#ff7a00";

function colorOf(card: HTMLElement): string | undefined {
  const v = $<HTMLInputElement>(".d-color", card).value.toLowerCase();
  return v === DEFAULT_FLAG_COLOR ? undefined : v;
}

function levelsOf(card: HTMLElement): string[] {
  return $<HTMLTextAreaElement>(".d-levels", card)
    .value.split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function readDims(): { dims: Dimension[]; problems: number } {
  const dims: Dimension[] = [];
  let problems = 0;
  const seen = new Set<string>();
  for (const card of Array.from(dimList.querySelectorAll<HTMLElement>(".dim"))) {
    const type = $<HTMLSelectElement>(".d-type", card).value === "noul" ? "noul" : "score";
    const d: Dimension = {
      id: $<HTMLInputElement>(".d-id", card).value.trim(),
      label: $<HTMLInputElement>(".d-label", card).value.trim(),
      type,
      instructions: $<HTMLTextAreaElement>(".d-instructions", card).value.trim(),
      levels: type === "score" ? levelsOf(card) : undefined,
      criteria:
        type === "noul"
          ? { true: $<HTMLTextAreaElement>(".d-true", card).value.trim(), false: $<HTMLTextAreaElement>(".d-false", card).value.trim() }
          : undefined,
      threshold: Number($<HTMLInputElement>(".d-threshold", card).value),
      direction: $<HTMLSelectElement>(".d-direction", card).value === "below" ? "below" : "above",
      enabled: $<HTMLInputElement>(".d-enabled", card).checked,
      color: colorOf(card),
    };
    const errs = validateDimension(d);
    if (seen.has(d.id)) errs.push("duplicate id");
    seen.add(d.id);
    $(".d-problems", card).textContent = errs.join(" · ");
    problems += errs.length;
    dims.push(d);
  }
  return { dims, problems };
}

function readForm(): { settings: Settings; problems: number } {
  const { dims, problems } = readDims();
  const settings = normalizeSettings({
    apiKey: $<HTMLInputElement>("#apiKey").value,
    model: $<HTMLInputElement>("#model").value,
    pricePerMtok: Number($<HTMLInputElement>("#pricePerMtok").value),
    baseUrl: $<HTMLInputElement>("#baseUrl").value,
    concurrency: Number($<HTMLInputElement>("#concurrency").value),
    dwellMs: Number($<HTMLInputElement>("#dwellMs").value),
    lookaheadPx: Number($<HTMLInputElement>("#lookaheadPx").value),
    cacheMax: Number($<HTMLInputElement>("#cacheMax").value),
    enabled: $<HTMLInputElement>("#enabled").checked,
    scope: $<HTMLSelectElement>("#scope").value,
    accountHandle: $<HTMLInputElement>("#accountHandle").value,
    analyzeReplies: $<HTMLInputElement>("#analyzeReplies").checked,
    selectedPreset: $<HTMLSelectElement>("#preset").value as Settings["selectedPreset"],
    threadContextMode: $<HTMLSelectElement>("#threadContextMode").value as Settings["threadContextMode"],
    articleAnalysisEnabled: $<HTMLInputElement>("#articleAnalysisEnabled").checked,
    maxArticleChars: Number($<HTMLInputElement>("#maxArticleChars").value),
    articleCacheMax: Number($<HTMLInputElement>("#articleCacheMax").value),
    dimensions: dims,
  });
  return { settings, problems };
}

async function renderStats(): Promise<void> {
  const s = await loadStats();
  const got = (await chrome.storage.local.get("cache")) as { cache?: { entries?: unknown[] } };
  const cached = got.cache?.entries?.length ?? 0;
  const gotArticles = (await chrome.storage.local.get("articleCache")) as { articleCache?: { entries?: unknown[] } };
  const cachedArticles = gotArticles.articleCache?.entries?.length ?? 0;
  $("#statsOut").innerHTML = [
    ["posts analyzed", s.analyzed.toLocaleString()],
    ["spent", `$${s.costUsd.toFixed(4)}`],
    ["input tokens", s.inputTokens.toLocaleString()],
    ["cached results", cached.toLocaleString()],
    ["cached articles", cachedArticles.toLocaleString()],
  ]
    .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`)
    .join("");
}

function flash(el: HTMLElement, text: string, cls: "ok" | "err" | "muted"): void {
  el.textContent = text;
  el.className = cls;
}

/** Mirrors the checkbox so the current value is readable at a glance, not only by its tick. */
function renderReplyState(): void {
  const on = $<HTMLInputElement>("#analyzeReplies").checked;
  $("#replyState").textContent = on ? "ON \u00b7 replies and comments are analyzed" : "OFF \u00b7 main posts only (default)";
}

/** Version comes from the running manifest; build and target describe the artifact that is actually loaded. */
function renderAbout(): void {
  const manifest = chrome.runtime.getManifest() as BuildManifest;
  $("#aboutVersion").textContent = manifest.version ?? "unknown";
  $("#aboutBuild").textContent = BUILD_SHA;
  $("#aboutTarget").textContent = browserTarget(manifest);
}

async function main(): Promise<void> {
  renderPresetOptions();
  fillForm(await loadSettings());
  await renderStats();
  renderAbout();

  $("#preset").addEventListener("change", () => renderPreset());
  $("#analyzeReplies").addEventListener("change", () => renderReplyState());

  $("#grantArticle").addEventListener("click", async () => {
    const out = $("#articleAccessOut");
    try {
      const ok = await chrome.permissions.request({ origins: ["https://*/*", "http://*/*"] });
      flash(out, ok ? "article access granted" : "not granted", ok ? "ok" : "err");
    } catch (e) {
      flash(out, `failed: ${(e as Error).message}`, "err");
    }
  });

  $("#revokeArticle").addEventListener("click", async () => {
    const out = $("#articleAccessOut");
    try {
      await chrome.permissions.remove({ origins: ["https://*/*", "http://*/*"] });
      flash(out, "article access revoked", "muted");
    } catch {
      flash(out, "not granted", "muted");
    }
  });

  $("#clearArticleCache").addEventListener("click", async () => {
    await chrome.storage.local.remove("articleCache");
    await renderStats();
  });

  $("#toggleKey").addEventListener("click", () => {
    const k = $<HTMLInputElement>("#apiKey");
    k.type = k.type === "password" ? "text" : "password";
    $("#toggleKey").textContent = k.type === "password" ? "show" : "hide";
  });

  $("#addDim").addEventListener("click", () => {
    const n = dimList.querySelectorAll(".dim").length + 1;
    dimList.appendChild(
      dimCard({
        id: `dimension_${n}`,
        label: "",
        type: "noul",
        instructions: "",
        criteria: { true: "", false: "" },
        threshold: 0.75,
        direction: "above",
        enabled: true,
      }),
    );
  });

  $("#resetDims").addEventListener("click", () => renderDims(DEFAULT_DIMENSIONS));

  $("#save").addEventListener("click", async () => {
    const { settings, problems } = readForm();
    if (problems) {
      flash($("#saveOut"), `fix ${problems} problem${problems === 1 ? "" : "s"} above`, "err");
      return;
    }
    await saveSettings(settings);
    flash($("#saveOut"), "saved", "ok");
    setTimeout(() => flash($("#saveOut"), "", "muted"), 2000);
  });

  $("#test").addEventListener("click", async () => {
    const out = $("#testOut");
    const { settings, problems } = readForm();
    if (problems) {
      flash(out, "fix the dimension problems first", "err");
      return;
    }
    await saveSettings(settings);
    flash(out, "calling Jev…", "muted");
    const reply = (await chrome.runtime.sendMessage({ type: "testConnection" })) as AnalyzeReply;
    if (!reply.ok) {
      flash(out, `failed: ${reply.error}`, "err");
      return;
    }
    const vals = Object.entries(reply.answers)
      .map(([k, a]) => `${k} ${answerValue(a).toFixed(2)}`)
      .join(", ");
    flash(out, `${reply.model} · ${reply.latencyMs} ms · ${reply.usage.input_tokens} tokens · $${reply.costUsd.toFixed(6)} · ${vals}`, "ok");
    await renderStats();
  });

  $("#resetStats").addEventListener("click", async () => {
    await chrome.storage.local.set({ [STATS_KEY]: { analyzed: 0, inputTokens: 0, costUsd: 0 } });
    await renderStats();
  });

  $("#clearCache").addEventListener("click", async () => {
    await chrome.storage.local.remove("cache");
    await renderStats();
  });
}

void main();
