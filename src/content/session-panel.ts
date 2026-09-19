import type { SessionSnapshot } from "./stats.ts";
import { PRESETS } from "../shared/presets.ts";

export function renderSessionPanel(s: SessionSnapshot, presetLabel: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "xs-session";
  const avg = s.latencies.length ? Math.round(s.latencies.reduce((a, b) => a + b, 0) / s.latencies.length) : null;
  const hits = Object.entries(s.dimHits).sort((a, b) => b[1] - a[1]);
  const noise = hits.filter(([id]) => /bait|promo|hype|speculat|padding|filler/.test(id));
  const useful = hits.filter(([id]) => !/bait|promo|hype|speculat|padding|filler/.test(id));
  const topPost = s.topPosts.filter((t) => t.kind === "post").slice(0, 3);
  const topArt = s.topPosts.filter((t) => t.kind === "article").slice(0, 3);
  const dimName = (id: string) => PRESETS.flatMap((p) => p.dimensions).find((d) => d.id === id)?.label ?? id;
  root.innerHTML = `
    <div class="xs-session-h">session · ${esc(presetLabel)}</div>
    <div class="xs-session-grid">
      <div><b>${s.analyzed}</b><span>analyzed</span></div>
      <div><b>${s.cacheHits}</b><span>cached</span></div>
      <div><b>$${s.costUsd.toFixed(4)}</b><span>spent</span></div>
      <div><b>${avg === null ? "–" : avg + " ms"}</b><span>avg latency</span></div>
      <div><b>${s.flagged}</b><span>flagged</span></div>
      <div><b>${s.articles}</b><span>articles</span></div>
    </div>
    ${row("useful", useful.slice(0, 4).map(([id, n]) => dimName(id) + " " + n).join(" · ") || "–")}
    ${row("noise", noise.slice(0, 4).map(([id, n]) => dimName(id) + " " + n).join(" · ") || "–")}
    ${row("top posts", topPost.map((t) => (t.title ?? t.id) + " " + t.score.toFixed(2)).join(" · ") || "–")}
    ${row("top articles", topArt.map((t) => (t.title ?? t.id) + " " + t.score.toFixed(2)).join(" · ") || "–")}
    <div class="xs-session-note">Scores are local weighted sums of typed answers. No extra Jev call.</div>
  `;
  return root;
}

function row(k: string, v: string): string {
  return `<div class="xs-session-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

