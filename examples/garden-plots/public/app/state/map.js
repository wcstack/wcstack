// 区画マップ — the map's state (a volume mounted at `map`). Owner: the map feature.
// Holds the gardens as the API gives them, the view every tile shares, and the selected plot.
// What a volume may not declare ($watch, $listKeys, tokens, $on) lives in app/state/app.js, marked "map".
import { api, failureText } from "../lib/api.js";
import { STATUSES, STATUS_LABEL } from "../../parts/lib/counts.js";

const FILTERS = ["all", ...STATUSES.map((s) => s.key)];

export default {
  // usage / freeCount / matchCount are not in the API data: each <garden-card> mounted on a garden exports them
  // (state README "Exported getters"). The lint reads them from the part (since 4.29), so the type does not name them.
  /** @type {{ id: number, name: string, address: string, areas: { id: number, name: string, plots: { id: number, no: string, size: number, status: string, tenant: { id: number, name: string, phone: string, postal: string, address: string } | null, since: string | null, version: number }[] }[] }[]} */
  gardens: [],
  loaded: false,
  loading: false,
  loadError: "",
  // Handed to every <garden-card> → <area-block> → <plot-tile> as `state.view`.
  view: { filter: "all", selectedId: null, selectable: true },

  /** plot id → [garden index, area index, plot index] */
  get index() {
    const idx = {};
    this.gardens.forEach((g, gi) => g.areas.forEach((a, ai) => a.plots.forEach((p, pi) => { idx[p.id] = [gi, ai, pi]; })));
    return idx;
  },
  /** @returns {{ id: number, no: string, size: number, status: string, tenant: { name: string } | null, since: string | null, version: number, gardenName: string, areaName: string } | null} */
  get selectedPlot() {
    const at = this.index[this["view.selectedId"]];
    if (!at) return null;
    const [gi, ai, pi] = at;
    // Read by path, so a live change of this plot (written by path) re-runs the getter (skill §6: only path
    // reads through `this` are tracked).
    const plot = this[`gardens.${gi}.areas.${ai}.plots.${pi}`];
    return { ...plot, gardenName: this[`gardens.${gi}.name`], areaName: this[`gardens.${gi}.areas.${ai}.name`] };
  },
  get selectedHref() { return this.selectedPlot ? `/plots/${this.selectedPlot.id}` : "/"; },
  get selectedStatusLabel() { return STATUS_LABEL[this.selectedPlot?.status] ?? ""; },
  get selectedTenant() { return this.selectedPlot?.tenant?.name ?? "—"; },
  get selectedSince() { return this.selectedPlot?.since ?? "—"; },

  async load() {
    this.loading = true;
    const r = await api("GET", "/api/gardens");
    this.loading = false;
    if (!r.ok) {
      this.loadError = failureText(r, "区画を読み込");
      return false;
    }
    this.loadError = "";
    this.gardens = r.data;
    this.loaded = true;
    return true;
  },

  /** A plot changed (the server says so): put the new object where the old one was. */
  applyPlot(plot) {
    const at = this.index[plot?.id];
    if (!at) return false;
    const current = this.$resolve("gardens.*.areas.*.plots.*", at);
    if (current && current.version > plot.version) return false; // an older event arriving late
    const { history, gardenId, areaId, gardenName, areaName, prevId, nextId, ...bare } = plot;
    this.$resolve("gardens.*.areas.*.plots.*", at, bare);
    return true;
  },

  setFilter(status) {
    this["view.filter"] = FILTERS.includes(status) ? status : "all";
  },

  // The root calls load() (app.js $connectedCallback): every route needs the gardens.
};
