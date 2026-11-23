// 区画 (/plots/:id) — one plot's page (a volume mounted at `plot`). Owner: the map feature.
// Every method returns a result ({ ok, kind, text }) and the root turns it into a toast: a volume cannot reach the
// root's command tokens.
import { api, failureText } from "../lib/api.js";
import { editable, fieldErrors, isDirty, personOf } from "../../parts/lib/tenant-rules.js";
import { STATUS_LABEL } from "../../parts/lib/counts.js";

export default {
  id: null,
  /** "idle" | "loading" | "ready" | "notfound" | "error" */
  phase: "idle",
  loadError: "",
  /** @type {{ id: number, no: string, size: number, status: string, since: string | null, version: number, gardenId: number, areaId: number, gardenName: string, areaName: string, prevId: number | null, nextId: number | null, history: { at: string, what: string, who: string }[] } | null} */
  detail: null,
  /** The tenant as <tenant-editor> edits it: { name, phone, postal, address, saved, errors } (or null: no tenant). */
  /** @type {{ name: string, phone: string, postal: string, address: string, saved: { name: string, phone: string, postal: string, address: string } | null, errors: { name?: string, phone?: string, postal?: string } } | null} */
  tenant: null,
  saving: false,
  /** The server's plot when a save met a newer version (409), until the user chooses. */
  /** @type {{ version: number, status: string, tenant: { name: string } | null } | null} */
  conflict: null,
  /** Another member of staff changed this plot while it is open (a live event). */
  changedElsewhere: false,
  pausedView: false,

  // 利用開始
  assignOpen: false,
  /** @type {{ id: number, name: string, gardenId: number, priority: number, appliedAt: string, wishHere: boolean, value: string }[]} */
  candidates: [],
  candidatesLoading: false,
  chosen: "",
  // 返還
  returnOpen: false,

  get ready() { return this.phase === "ready"; },
  get notFound() { return this.phase === "notfound"; },
  get isLoading() { return this.phase === "loading"; },
  get title() { return this.detail ? `${this["detail.gardenName"]} ${this["detail.areaName"]} ${this["detail.no"]}` : "区画"; },
  get statusLabel() { return STATUS_LABEL[this["detail.status"]] ?? ""; },
  get canAssign() { return this["detail.status"] === "free" && !this.saving; },
  get canReturn() { return Boolean(this.tenant) && !this.saving; },
  get hasTenant() { return Boolean(this.tenant); },
  get prevHref() { return this["detail.prevId"] ? `/plots/${this["detail.prevId"]}` : null; },
  get nextHref() { return this["detail.nextId"] ? `/plots/${this["detail.nextId"]}` : null; },
  get history() { return this["detail.history"] ?? []; },
  // The editor derives "unsaved changes" and "valid"; read what it exports at its mount point (state README,
  // "Exported getters") instead of computing it again. `?? false`: the first read can come before it mounts.
  get dirty() { return this.hasTenant ? (this["tenant.dirty"] ?? false) : false; },
  /** For methods (the editor may not be mounted — another route): the same rule, computed. */
  hasDraft() { return Boolean(this.tenant) && isDirty(this.tenant, this.tenant.saved); },
  get canSave() { return this.hasTenant && !this.saving && this.dirty && (this["tenant.valid"] ?? true); },
  get conflictText() {
    const c = this.conflict;
    if (!c) return "";
    return `他の職員が先にこの区画を変更しました（状態: ${STATUS_LABEL[c.status] ?? c.status}、利用者: ${c.tenant?.name ?? "なし"}）。`;
  },
  get returnText() { return this.tenant ? `${this["tenant.saved.name"] || this["tenant.name"]} さんの区画 ${this["detail.no"]} を返還します。よろしいですか？` : ""; },
  get noCandidates() { return !this.candidatesLoading && this.candidates.length === 0; },


  /** Show what the server returned. Keeps the user's unsaved typing when `keepDraft` and the plot did not change. */
  take(detail, { keepDraft = false } = {}) {
    const draft = keepDraft && this.tenant && this.detail?.id === detail.id && this.detail?.version === detail.version && this.hasDraft()
      ? this.tenant : null;
    this.detail = detail;
    this.tenant = draft ?? editable(detail.tenant);
    this.pausedView = detail.status === "paused";
    this.conflict = null;
    this.changedElsewhere = false;
  },

  async load(id) {
    if (!Number.isInteger(id) || id <= 0) { this.phase = "notfound"; this.detail = null; return { ok: false }; }
    const again = this.id === id && this.detail;
    this.id = id;
    if (!again) this.phase = "loading";
    const r = await api("GET", `/api/plots/${id}`);
    if (this.id !== id) return { ok: false, stale: true };
    if (r.status === 404) { this.phase = "notfound"; this.detail = null; this.tenant = null; return { ok: false }; }
    if (!r.ok) { this.phase = "error"; this.loadError = failureText(r, "区画を読み込"); return { ok: false, kind: "error", text: this.loadError }; }
    this.take(r.data, { keepDraft: again });
    this.phase = "ready";
    return { ok: true };
  },

  /** 保存: send the tenant. 422 → messages at the fields; 409 → the conflict notice. */
  async save(force = false) {
    if (!this.detail || !this.tenant) return { ok: false };
    const version = force && this.conflict ? this.conflict.version : this["detail.version"];
    this.saving = true;
    const r = await api("PATCH", `/api/plots/${this.detail.id}`, { version, tenant: personOf(this.tenant) });
    this.saving = false;
    if (r.ok) {
      this.take(r.data);
      return { ok: true, plot: r.data, kind: "success", text: `区画 ${r.data.no} の利用者情報を保存しました` };
    }
    if (r.status === 422) {
      this["tenant.errors"] = fieldErrors(r.data?.errors, "tenant.");
      return { ok: false, kind: "error", text: "入力内容を確認してください" };
    }
    if (r.status === 409) {
      this.conflict = r.data?.plot ?? null;
      return { ok: false, kind: "warn", text: "他の職員が先に変更していました。内容を確認してください" };
    }
    return { ok: false, kind: "error", text: failureText(r, "保存") };
  },

  /** 409: throw my changes away and show the server's plot. */
  takeTheirs() {
    if (this.conflict) this.take({ ...this.detail, ...this.conflict });
  },

  /** A live event for this plot. */
  liveChange(plot) {
    if (!this.detail || plot.id !== this.detail.id || plot.version <= this["detail.version"]) return false;
    if (this.hasDraft() || this.assignOpen || this.returnOpen) {
      this.changedElsewhere = true; // keep what the user is doing; the notice offers to reload
      return true;
    }
    this.take({ ...this.detail, ...plot });
    return true;
  },

  async setPaused(paused) {
    if (!this.detail) return { ok: false };
    const want = paused ? "paused" : (this.tenant ? "used" : "free");
    if (want === this["detail.status"]) return { ok: true, quiet: true };
    this.saving = true;
    const r = await api("PATCH", `/api/plots/${this.detail.id}`, { version: this["detail.version"], status: want });
    this.saving = false;
    if (r.ok) {
      this.take(r.data, { keepDraft: false });
      return { ok: true, plot: r.data, kind: "success", text: paused ? `区画 ${r.data.no} を休止にしました` : `区画 ${r.data.no} の休止を解除しました` };
    }
    this.pausedView = this["detail.status"] === "paused";
    if (r.status === 409) { this.conflict = r.data?.plot ?? null; return { ok: false, kind: "warn", text: "他の職員が先に変更していました" }; }
    return { ok: false, kind: "error", text: failureText(r, "休止を変更") };
  },

  async openAssign() {
    this.chosen = "";
    this.assignOpen = true;
    this.candidatesLoading = true;
    const r = await api("GET", "/api/waiting?sort=priority&per=5&page=1");
    this.candidatesLoading = false;
    const gid = this["detail.gardenId"];
    this.candidates = r.ok
      ? r.data.items.map((w) => ({ id: w.id, name: w.name, gardenId: w.gardenId, priority: w.priority, appliedAt: w.appliedAt, wishHere: w.gardenId === gid, value: String(w.id) }))
      : [];
    if (!r.ok) return { ok: false, kind: "error", text: failureText(r, "待機者を読み込") };
    return { ok: true, quiet: true };
  },
  cancelAssign() { this.assignOpen = false; },

  async assign() {
    if (!this.chosen || !this.detail) return { ok: false, kind: "warn", text: "利用者を選んでください" };
    this.saving = true;
    const r = await api("POST", `/api/plots/${this.detail.id}/assign`, { version: this["detail.version"], applicantId: Number(this.chosen) });
    this.saving = false;
    if (r.ok) {
      this.assignOpen = false;
      this.take(r.data);
      return { ok: true, plot: r.data, kind: "success", text: `区画 ${r.data.no} の利用を開始しました（${r.data.tenant?.name}）` };
    }
    if (r.status === 409) { this.assignOpen = false; this.conflict = r.data?.plot ?? null; return { ok: false, kind: "warn", text: "他の職員が先に変更していました" }; }
    return { ok: false, kind: "error", text: r.status === 422 ? Object.values(r.data?.errors ?? {}).join(" ") || "利用を開始できませんでした" : failureText(r, "利用を開始") };
  },

  openReturn() { this.returnOpen = true; },
  cancelReturn() { this.returnOpen = false; },
  async doReturn() {
    if (!this.detail) return { ok: false };
    this.saving = true;
    const r = await api("POST", `/api/plots/${this.detail.id}/return`, { version: this["detail.version"] });
    this.saving = false;
    this.returnOpen = false;
    if (r.ok) {
      this.take(r.data);
      return { ok: true, plot: r.data, kind: "success", text: `区画 ${r.data.no} を返還しました` };
    }
    if (r.status === 409) { this.conflict = r.data?.plot ?? null; return { ok: false, kind: "warn", text: "他の職員が先に変更していました" }; }
    return { ok: false, kind: "error", text: failureText(r, "返還") };
  },
};
