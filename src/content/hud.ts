import type { SessionSnapshot } from "./stats.ts";
import { versionLabel } from "../shared/build.ts";

const COLLAPSE_KEY = "xs-hud-collapsed";

/** The fixed panel in the corner. The only technical evidence on screen. */
export class Hud {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private msg: HTMLElement;
  private v: Record<string, HTMLElement> = {};

  constructor(
    onOpenSettings: () => void,
    private onOpenSession: () => void = () => {},
  ) {
    this.root = el("div", "xs-hud");
    const title = el("div", "xs-hud-title");
    title.innerHTML = `<span>x-scanner <em class="xs-hud-preset"></em></span><span class="xs-hud-tog" aria-label="collapse">–</span>`;
    title.addEventListener("click", () => this.toggle());
    this.root.appendChild(title);

    this.msg = el("div", "xs-hud-msg");
    this.msg.hidden = true;
    this.root.appendChild(this.msg);

    this.body = el("div", "xs-hud-body");
    for (const [key, label] of [
      ["analyzed", "analyzed"],
      ["cost", "spent"],
      ["latency", "last call"],
      ["rate", "rate"],
    ] as const) {
      const row = el("div", "xs-hud-row");
      const k = el("span", "xs-hud-k");
      k.textContent = label;
      const v = el("span", "xs-hud-v");
      v.textContent = "–";
      row.append(k, v);
      this.body.appendChild(row);
      this.v[key] = v;
    }
    const foot = el("div", "xs-hud-foot");
    this.v.foot = foot;
    this.body.appendChild(foot);
    const gear = el("a", "xs-hud-gear");
    gear.textContent = "settings";
    gear.addEventListener("click", (e) => {
      e.preventDefault();
      onOpenSettings();
    });
    this.body.appendChild(gear);
    const sess = el("a", "xs-hud-gear");
    sess.textContent = "session";
    sess.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onOpenSession();
    });
    this.body.appendChild(sess);
    // Diagnostic only: tells the tester which revision is actually running without about:debugging.
    const ver = el("div", "xs-hud-ver");
    ver.textContent = versionLabel(chrome.runtime.getManifest().version);
    this.body.appendChild(ver);
    this.root.appendChild(this.body);

    let collapsed = false;
    try {
      collapsed = localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      /* ignore */
    }
    if (collapsed) this.root.classList.add("xs-collapsed");
  }

  mount(): void {
    if (!this.root.isConnected) document.documentElement.appendChild(this.root);
  }

  destroy(): void {
    this.root.remove();
  }

  /** Replace the counters with a one line status, e.g. missing key or paused by scope. */
  message(html: string | null): void {
    if (html === null) {
      this.msg.hidden = true;
      this.body.hidden = false;
      return;
    }
    this.msg.innerHTML = html;
    this.msg.hidden = false;
    this.body.hidden = true;
  }

  update(s: SessionSnapshot): void {
    this.v.analyzed!.textContent = String(s.analyzed);
    this.v.cost!.textContent = `$${s.costUsd.toFixed(4)}`;
    this.v.latency!.textContent = s.lastLatencyMs === null ? "–" : `${s.lastLatencyMs} ms`;
    this.v.rate!.textContent = `${s.judgmentsPerSec.toFixed(1)} judgments/s`;
    const bits = [`queue ${s.pending}`, `in flight ${s.inflight}`, `cached ${s.cacheHits}`];
    if (s.errors) bits.push(`errors ${s.errors}`);
    this.v.foot!.textContent = bits.join(" · ");
    this.v.foot!.title = s.lastError ?? "";
  }

  setPreset(label: string): void {
    const em = this.root.querySelector(".xs-hud-preset");
    if (em) em.textContent = label ? `· ${label}` : "";
  }

  private toggle(): void {
    const c = this.root.classList.toggle("xs-collapsed");
    try {
      localStorage.setItem(COLLAPSE_KEY, c ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
