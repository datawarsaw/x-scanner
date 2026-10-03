// Options page. Reads settings into the form, writes the form back on Save.
import type { AnalyzeReply, Dimension, Settings } from "../shared/types.ts";
import { loadSettings, loadStats, normalizeSettings, notifySettingsChanged, saveSettings, settingsSnapshotKey, STATS_KEY } from "../shared/settings.ts";
import { DEFAULT_DIMENSIONS, validateDimension } from "../shared/questions.ts";
import { answerValue } from "../content/labels.ts";
import { PRESETS, PRESET_BY_ID } from "../shared/presets.ts";
import { BUILD_SHA, browserTarget, type BuildManifest } from "../shared/build.ts";

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

let dimList: HTMLElement;
let template: HTMLTemplateElement;

let lastSavedSettingsKey = "";
let lastSavedPreset: Settings["selectedPreset"] = "default";

function initDomRefs(): void {
  dimList = $("#dimList");
  template = $<HTMLTemplateElement>("#dimTemplate");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function formatDimName(d: Dimension): string {
  const raw = d.short ?? d.label;
  if (!raw) return d.id;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

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
  lastSavedSettingsKey = settingsSnapshotKey(s);
  lastSavedPreset = s.selectedPreset;
  renderPreset();
  updateDirtyState(false);
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

export function renderPresetSummary(selectedId: Settings["selectedPreset"], isSaved: boolean): void {
  const p = PRESET_BY_ID[selectedId];
  if (!p) return;
  const nameEl = $<HTMLElement>("#presetSummaryName");
  const badgeEl = $<HTMLElement>("#presetSummaryBadge");
  const descEl = $<HTMLElement>("#presetSummaryDesc");
  const dimsEl = $<HTMLElement>("#presetSummaryDims");
  const activeLabelEl = $<HTMLElement>("#presetSummaryActiveLabel");

  nameEl.textContent = p.label;
  if (selectedId === "default") {
    badgeEl.textContent = "6 editable dimensions";
    descEl.textContent = "The original six dimensions. Editable in the Dimensions section below.";
    const currentDims = readDims().dims;
    const dimsToShow = currentDims.length ? currentDims : DEFAULT_DIMENSIONS;
    dimsEl.innerHTML = dimsToShow
      .map((d) => `<span class="preset-dim-chip">${escapeHtml(formatDimName(d))}</span>`)
      .join("");
  } else {
    badgeEl.textContent = `${p.dimensions.length} fixed dimensions`;
    descEl.textContent = p.description;
    dimsEl.innerHTML = p.dimensions
      .map((d) => `<span class="preset-dim-chip">${escapeHtml(formatDimName(d))}</span>`)
      .join("");
  }

  if (isSaved) {
    activeLabelEl.textContent = "Active (Saved)";
    activeLabelEl.className = "preset-runtime-badge active";
  } else {
    activeLabelEl.textContent = "Selected (Unsaved)";
    activeLabelEl.className = "preset-runtime-badge unsaved";
  }
}

export function updateDirtyState(isDirty: boolean, problems = 0): void {
  const statusEl = $<HTMLElement>("#saveStatus");
  const topStatusEl = $<HTMLElement>("#saveTopStatus");
  if (problems > 0) {
    const text = "Unsaved changes (" + problems + " error" + (problems === 1 ? "" : "s") + ")";
    statusEl.textContent = text;
    statusEl.className = "save-status-badge err";
    topStatusEl.textContent = text;
    topStatusEl.className = "save-status-badge err";
  } else if (isDirty) {
    statusEl.textContent = "Unsaved changes";
    statusEl.className = "save-status-badge dirty";
    topStatusEl.textContent = "Unsaved changes";
    topStatusEl.className = "save-status-badge dirty";
  } else {
    statusEl.textContent = "Saved";
    statusEl.className = "save-status-badge ok";
    topStatusEl.textContent = "Saved";
    topStatusEl.className = "save-status-badge ok";
  }
}

export function updatePresetState(currentPreset: Settings["selectedPreset"]): void {
  const selectedLabel = PRESET_BY_ID[currentPreset]?.label ?? currentPreset;
  const savedLabel = PRESET_BY_ID[lastSavedPreset]?.label ?? lastSavedPreset;
  $<HTMLElement>("#selectedPresetState").textContent = selectedLabel;
  $<HTMLElement>("#savedPresetState").textContent = savedLabel;

  const { settings } = readForm();
  const isSaved = currentPreset === lastSavedPreset && settingsSnapshotKey(settings) === lastSavedSettingsKey;
  renderPresetSummary(currentPreset, isSaved);
}

export function checkDirty(): void {
  const { settings, problems } = readForm();
  const currentKey = settingsSnapshotKey(settings);
  const isDirty = currentKey !== lastSavedSettingsKey;
  updateDirtyState(isDirty, problems);
  updatePresetState(settings.selectedPreset);
}

function toggleDefaultDims(): void {
  const defaultEditor = $<HTMLElement>("#defaultDimEditor");
  const btn = $<HTMLButtonElement>("#toggleDefaultDims");
  if (defaultEditor.classList.contains("collapsed")) {
    defaultEditor.classList.remove("collapsed");
    btn.textContent = "Hide Default preset dimensions";
  } else {
    defaultEditor.classList.add("collapsed");
    btn.textContent = "Show Default preset dimensions";
  }
}

/** Keeps the preset description and the dimension-count note in sync with the selector. */
export function renderPreset(): void {
  const id = $<HTMLSelectElement>("#preset").value as keyof typeof PRESET_BY_ID;
  const p = PRESET_BY_ID[id];
  $("#presetNote").textContent = p ? `${p.description} (${p.dimensions.length} dimensions)` : "";
  const note = $("#dimNote");
  const defaultNotice = $<HTMLElement>("#defaultDimNotice");
  const defaultEditor = $<HTMLElement>("#defaultDimEditor");
  const badge = $<HTMLElement>("#dimensionsPresetBadge");

  if (id === "default") {
    note.textContent = "These are the dimensions currently in use.";
    defaultNotice.style.display = "none";
    defaultEditor.classList.remove("collapsed");
    badge.textContent = "Active for Default preset";
    badge.className = "preset-badge active";
  } else {
    note.textContent = `The ${p?.label ?? id} preset is in use. These dimensions are kept for the Default preset and are used again when you switch back.`;
    defaultNotice.style.display = "block";
    defaultEditor.classList.add("collapsed");
    $<HTMLButtonElement>("#toggleDefaultDims").textContent = "Show Default preset dimensions";
    badge.textContent = "Inactive (Default only)";
    badge.className = "preset-badge inactive";
  }
  updatePresetState(id);
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
  $(".d-remove", card).addEventListener("click", () => {
    card.remove();
    checkDirty();
  });
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

export function readDims(): { dims: Dimension[]; problems: number } {
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

export function readForm(): { settings: Settings; problems: number } {
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

export async function performSave(): Promise<boolean> {
  const { settings, problems } = readForm();
  if (problems) {
    const msg = "fix " + problems + " problem" + (problems === 1 ? "" : "s") + " above";
    flash($("#saveOut"), msg, "err");
    flash($("#saveTopOut"), msg, "err");
    updateDirtyState(true, problems);
    return false;
  }
  try {
    await saveSettings(settings);
    lastSavedSettingsKey = settingsSnapshotKey(settings);
    lastSavedPreset = settings.selectedPreset;
    updateDirtyState(false);
    updatePresetState(settings.selectedPreset);
    flash($("#saveOut"), "saved", "ok");
    flash($("#saveTopOut"), "saved", "ok");
    setTimeout(() => {
      if ($("#saveOut").textContent === "saved") flash($("#saveOut"), "", "muted");
      if ($("#saveTopOut").textContent === "saved") flash($("#saveTopOut"), "", "muted");
    }, 2000);
    notifySettingsChanged();
    return true;
  } catch (err) {
    const msg = "failed: " + (err as Error).message;
    flash($("#saveOut"), msg, "err");
    flash($("#saveTopOut"), msg, "err");
    $<HTMLElement>("#saveStatus").textContent = "Save failed";
    $<HTMLElement>("#saveStatus").className = "save-status-badge err";
    $<HTMLElement>("#saveTopStatus").textContent = "Save failed";
    $<HTMLElement>("#saveTopStatus").className = "save-status-badge err";
    return false;
  }
}

export async function initOptions(): Promise<void> {
  initDomRefs();
  renderPresetOptions();
  fillForm(await loadSettings());
  await renderStats();
  renderAbout();

  $("#preset").addEventListener("change", () => {
    renderPreset();
    checkDirty();
  });
  $("#analyzeReplies").addEventListener("change", () => {
    renderReplyState();
    checkDirty();
  });
  $("#toggleDefaultDims").addEventListener("click", () => toggleDefaultDims());
  const wrap = $("#wrap");
  wrap.addEventListener("input", () => checkDirty());
  wrap.addEventListener("change", () => checkDirty());

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
    checkDirty();
  });

  $("#resetDims").addEventListener("click", () => {
    renderDims(DEFAULT_DIMENSIONS);
    checkDirty();
  });

  $("#save").addEventListener("click", () => void performSave());
  $("#saveTop").addEventListener("click", () => void performSave());

  $("#test").addEventListener("click", async () => {
    const out = $("#testOut");
    const { settings, problems } = readForm();
    if (problems) {
      flash(out, "fix the dimension problems first", "err");
      return;
    }
    await saveSettings(settings);
    flash(out, "calling Jev…", "muted");
    notifySettingsChanged();
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

if (typeof document !== "undefined") {
  void initOptions();
}
