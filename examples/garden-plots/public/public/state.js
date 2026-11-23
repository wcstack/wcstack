// みどり市 市民農園 — the citizens' page state: the gardens and how many plots are free. Read-only: no tenant data
// (the public API has none), tiles cannot be selected, nothing is sent to the server.
import { countStatuses, STATUSES } from "../parts/lib/counts.js";

export default {
  /** @type {{ id: number, name: string, address: string, usage?: number, freeCount?: number, areas: { id: number, name: string, plots: { id: number, no: string, size: number, status: string, since: string | null }[] }[] }[]} */
  gardens: [],
  loaded: false,
  loadError: "",
  view: { filter: "all", selectedId: null, selectable: false },
  tab: "vacancy",
  tabs: [{ id: "vacancy", label: "空き状況" }, { id: "guide", label: "ご利用案内" }],
  /** @type {{ key: string, label: string }[]} */
  legend: STATUSES.map((s) => ({ key: s.key, label: s.label })),
  /** What the staff app saved on this computer (theme, density): read, never written here. */
  /** @type {{ theme?: string, density?: string } | null} */
  savedSettings: null,

  partsPending: ["garden-card", "area-block", "plot-tile", "midori-badge", "midori-tabs"],
  partsMissing: [],
  get partsBroken() { return this.partsMissing.length > 0; },
  get partsMissingText() { return this.partsBroken ? `表示の部品を読み込めませんでした（${this.partsMissing.join("、")}）。ページを再読み込みしてください。` : ""; },
  get counts() { return countStatuses(this.$getAll("gardens.*.areas.*.plots.*.status", [])); },
  get freeText() { return this.loaded ? String(this.counts.free) : "—"; },

  async $connectedCallback() {
    try {
      const res = await fetch("/api/public/gardens");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.gardens = await res.json();
      this.loaded = true;
    } catch (e) {
      this.loadError = "空き状況を読み込めませんでした。時間をおいてもう一度お試しください。";
    }
    this.applySettings();
  },
  applySettings() {
    const s = this.savedSettings ?? {};
    document.documentElement.dataset.theme = ["light", "dark", "contrast"].includes(s.theme) ? s.theme : "light";
    document.documentElement.dataset.density = s.density === "compact" ? "compact" : "normal";
  },
  // The theme follows the staff settings saved on this computer, in this tab and from another one.
  $watch: { savedSettings() { this.applySettings(); } },
};
