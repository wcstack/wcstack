// 待機者 (/waiting) — the waiting list's state (a volume mounted at `waiting`). Owner: the waiting-list feature.
// $listKeys for `waiting.items` is declared on the root (a volume may not), so a reload keeps the open rows' DOM.
import { api, failureText } from "../lib/api.js";
import { editable, fieldErrors, isDirty, personOf } from "../../parts/lib/tenant-rules.js";

const GARDEN_NAMES = { 1: "みどり中央農園", 2: "北の丘農園", 3: "川沿い農園", 4: "さくら台農園" };
const EDIT_FIELDS = ["name", "phone", "postal", "address"];

export default {
  /** @type {{ id: number, name: string, phone: string, postal: string, address: string, gardenId: number, appliedAt: string, priority: number, saved: { name: string, phone: string, postal: string, address: string }, errors: { name?: string, phone?: string, postal?: string } }[]} */
  items: [],
  total: 0,
  page: 1,
  per: 20,
  /** "applied" | "priority" */
  sort: "applied",
  loading: false,
  loaded: false,
  loadError: "",
  /** ids of the rows whose editor is open */
  openIds: [],
  /** ids of rows with a request in flight */
  busyIds: [],
  /** @type {{ id: number, name: string }[]} */
  gardenOptions: Object.entries(GARDEN_NAMES).map(([id, name]) => ({ id: Number(id), name })),

  // 追加
  addOpen: false,
  /** @type {{ name: string, phone: string, postal: string, address: string, gardenId: number, errors: { name?: string, phone?: string, postal?: string, gardenId?: string } }} */
  draft: { name: "", phone: "", postal: "", address: "", gardenId: 0, errors: {} },
  adding: false,
  // 削除
  deleteOpen: false,
  /** @type {{ id: number, name: string } | null} */
  deleteTarget: null,

  get rows() { return this.items; },
  get "items.*.gardenName"() { return GARDEN_NAMES[this[".gardenId"]] ?? "—"; },
  get "items.*.isOpen"() { return this.openIds.includes(this[".id"]); },
  get "items.*.isBusy"() { return this.busyIds.includes(this[".id"]); },
  get "items.*.toggleLabel"() { return this[".isOpen"] ? "閉じる" : "編集"; },
  get "items.*.atTop"() { return this[".priority"] <= 1; },
  get "items.*.atBottom"() { return this[".priority"] >= this.total; },
  get sortedByPriority() { return this.sort === "priority"; },
  get sortedByApplied() { return this.sort !== "priority"; },
  get empty() { return this.loaded && this.items.length === 0; },
  get deleteText() { return this.deleteTarget ? `${this["deleteTarget.name"]} さんを待機者から削除します。よろしいですか？` : ""; },
  get draftGardenError() { return this["draft.errors.gardenId"] ?? ""; },

  /**
   * Load a page. Rows whose editor is open and holds unsaved typing keep what was typed; their `saved` copy becomes
   * the server's (so the mark still says "unsaved"). Rows not on the page any more close.
   */
  async load() {
    this.loading = true;
    const want = { page: this.page, sort: this.sort };
    const r = await api("GET", `/api/waiting?page=${want.page}&per=${this.per}&sort=${want.sort}`);
    if (want.page !== this.page || want.sort !== this.sort) return { ok: false, stale: true };
    this.loading = false;
    if (!r.ok) { this.loadError = failureText(r, "待機者を読み込"); return { ok: false, kind: "error", text: this.loadError }; }
    this.loadError = "";
    const local = new Map(this.items.map((it) => [it.id, it]));
    const open = new Set(this.openIds);
    this.items = r.data.items.map((w) => {
      const mine = local.get(w.id);
      const row = editable(w);
      if (mine && open.has(w.id) && isDirty(mine, mine.saved)) {
        for (const f of EDIT_FIELDS) row[f] = mine[f];
        row.errors = mine.errors ?? {};
      }
      return row;
    });
    this.total = r.data.total;
    if (r.data.page !== this.page) this.page = r.data.page;
    const ids = new Set(this.items.map((it) => it.id));
    this.openIds = this.openIds.filter((id) => ids.has(id));
    this.loaded = true;
    return { ok: true };
  },

  toggleRow(event, i) {
    const id = this.$resolve("items.*.id", [i]);
    this.openIds = this.openIds.includes(id) ? this.openIds.filter((x) => x !== id) : this.openIds.concat(id);
  },
  /** 取消: put the row back to its saved copy and close it. */
  revertRow(event, i) {
    const row = this.$resolve("items.*", [i]);
    this.$resolve("items.*", [i], { ...row, ...row.saved, errors: {} });
    this.openIds = this.openIds.filter((x) => x !== row.id);
  },

  async saveRow(i) {
    const row = this.$resolve("items.*", [i]);
    this.busyIds = this.busyIds.concat(row.id);
    const r = await api("PATCH", `/api/waiting/${row.id}`, personOf(row));
    this.busyIds = this.busyIds.filter((x) => x !== row.id);
    const at = this.items.findIndex((it) => it.id === row.id); // rows may have moved meanwhile
    if (r.ok) {
      if (at >= 0) this.$resolve("items.*", [at], editable({ ...this.items[at], ...r.data }));
      this.openIds = this.openIds.filter((x) => x !== row.id);
      return { ok: true, kind: "success", text: `${r.data.name} さんの情報を保存しました` };
    }
    if (r.status === 422 && at >= 0) {
      this.$resolve("items.*.errors", [at], fieldErrors(r.data?.errors));
      return { ok: false, kind: "error", text: "入力内容を確認してください" };
    }
    return { ok: false, kind: "error", text: failureText(r, "保存") };
  },

  async move(i, direction) {
    const row = this.$resolve("items.*", [i]);
    this.busyIds = this.busyIds.concat(row.id);
    const r = await api("POST", `/api/waiting/${row.id}/move`, { direction });
    this.busyIds = this.busyIds.filter((x) => x !== row.id);
    if (!r.ok) return { ok: false, kind: "error", text: failureText(r, "順番を変更") };
    const reload = await this.load();
    return reload.ok ? { ok: true, kind: "success", text: `${row.name} さんの優先順を${direction === "up" ? "上げ" : "下げ"}ました` } : reload;
  },

  askDelete(event, i) {
    const row = this.$resolve("items.*", [i]);
    this.deleteTarget = { id: row.id, name: row.saved?.name || row.name };
    this.deleteOpen = true;
  },
  cancelDelete() { this.deleteOpen = false; },
  async confirmDelete() {
    const target = this.deleteTarget;
    if (!target) return { ok: false };
    const r = await api("DELETE", `/api/waiting/${target.id}`);
    this.deleteOpen = false;
    if (!r.ok) return { ok: false, kind: "error", text: failureText(r, "削除") };
    this.openIds = this.openIds.filter((x) => x !== target.id);
    await this.load();
    return { ok: true, kind: "success", text: `${target.name} さんを削除しました` };
  },

  openAdd() {
    this.draft = { name: "", phone: "", postal: "", address: "", gardenId: 0, errors: {} };
    this.addOpen = true;
  },
  cancelAdd() { this.addOpen = false; },
  async add() {
    const d = this.draft;
    this.adding = true;
    const r = await api("POST", "/api/waiting", { ...personOf(d), gardenId: Number(d.gardenId) || 0 });
    this.adding = false;
    if (r.ok) {
      this.addOpen = false;
      await this.load();
      return { ok: true, kind: "success", text: `${r.data.name} さんを待機者に追加しました` };
    }
    if (r.status === 422) {
      const errors = fieldErrors(r.data?.errors);
      if (r.data?.errors?.gardenId) errors.gardenId = r.data.errors.gardenId;
      this["draft.errors"] = errors;
      return { ok: false, kind: "error", text: "入力内容を確認してください" };
    }
    return { ok: false, kind: "error", text: failureText(r, "追加") };
  },
};
