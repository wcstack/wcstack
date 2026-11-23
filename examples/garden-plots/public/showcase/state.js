// みどり市 共通部品 ショーケース — every part on its own, with sample data and controls that change what it is given.
// The parts' browser tests run here (tests/e2e/parts.spec.js).

const plot = (id, no, status, name = null, since = null) => ({
  id, no, size: 15, status, since, version: 1,
  tenant: name ? { id: 900 + id, name, phone: "010-0000-0000", postal: "100-0001", address: "みどり市中央一丁目" } : null,
});

const STATUS_CYCLE = ["free", "used", "renewal", "paused"];
const NAMES = ["佐藤 太郎", "鈴木 花子", "高橋 一郎", "田中 美咲", "伊藤 健太", "渡辺 陽子"];
const areaPlots = (base, n) => Array.from({ length: n }, (_, i) => {
  const status = STATUS_CYCLE[(i * 7 + base) % 4];
  const holds = status === "used" || status === "renewal";
  return plot(base + i, `${String.fromCharCode(65 + (base % 3))}-${String(i + 1).padStart(2, "0")}`, status, holds ? NAMES[i % NAMES.length] : null, holds ? "2024-04-01" : null);
});

const faqNode = (id, title, depth, questions) => ({
  id, title,
  questions: questions.map((q) => ({ q: `${q}は？`, a: `${q}については農政課へ。` })),
  children: depth > 1 ? [faqNode(id * 10 + 1, `${title}・詳細`, depth - 1, [`${title}の詳細`])] : [],
});

export default {
  // ── the parts themselves (<wcs-defined>) ──
  partsPending: ["garden-card", "area-block", "plot-tile", "tenant-editor", "faq-node", "midori-badge", "midori-toggle", "midori-pager", "midori-tabs", "midori-dialog", "midori-toast"],
  partsMissing: [],
  get partsBroken() { return this.partsMissing.length > 0; },
  get partsMissingText() { return this.partsBroken ? `部品を読み込めませんでした（${this.partsMissing.join("、")}）。` : ""; },

  // ── designers' parts ──
  badgeKind: "free",
  badgeText: "空き",
  /** @type {{ kind: string, label: string }[]} */
  badgeKinds: [
    { kind: "free", label: "空き" }, { kind: "used", label: "利用中" }, { kind: "renewal", label: "更新待ち" },
    { kind: "paused", label: "休止" }, { kind: "info", label: "お知らせ" }, { kind: "warn", label: "注意" },
  ],

  toggleOn: false,
  toggleDisabled: false,

  pagerTotal: 120,
  pagerPer: 20,
  pagerPage: 1,

  tabsSelected: "one",
  /** @type {{ id: string, label: string }[]} */
  tabsList: [{ id: "one", label: "一つ目" }, { id: "two", label: "二つ目" }, { id: "three", label: "三つ目" }],
  tabsNote: "パネルの中はページの markup",

  dialogOpen: false,
  dialogTitle: "見本のダイアログ",
  dialogName: "",
  dialogLog: [],

  toastKind: "info",
  toastText: "保存しました",
  toastSeconds: 3,
  $commandTokens: ["toast"],

  // ── developers' parts ──
  /** @type {{ id: number, no: string, size: number, status: string, since: string | null, version: number, tenant: { id: number, name: string, phone: string, postal: string, address: string } | null }} */
  tile: plot(1, "A-01", "used", "佐藤 太郎", "2024-04-01"),
  tileView: { filter: "all", selectedId: null, selectable: true },
  area: { id: 11, name: "見本エリア", plots: areaPlots(10, 12) },
  areaView: { filter: "all", selectedId: null, selectable: true },
  garden: { id: 1, name: "見本農園", address: "みどり市中央一丁目 1-1", areas: [{ id: 21, name: "北", plots: areaPlots(20, 8) }, { id: 22, name: "南", plots: areaPlots(30, 10) }] },
  gardenView: { filter: "all", selectedId: null, selectable: true },
  /** @type {{ name: string, phone: string, postal: string, address: string, saved: { name: string, phone: string, postal: string, address: string } | null, errors: { name?: string, phone?: string, postal?: string } }} */
  tenant: { name: "佐藤 太郎", phone: "010-1234-5678", postal: "100-0001", address: "みどり市中央一丁目 3-4",
    saved: { name: "佐藤 太郎", phone: "010-1234-5678", postal: "100-0001", address: "みどり市中央一丁目 3-4" }, errors: {} },
  faqQuery: "",
  faq: [faqNode(1, "申し込み", 6, ["申し込みの時期", "申し込みの方法"]), faqNode(2, "利用", 2, ["利用時間"])],

  // ── what the page reads back ──
  get tileSelected() { return this["tileView.selectedId"] === this["tile.id"]; },
  get areaFree() { return this["area.freeCount"] ?? "—"; },
  get gardenUsage() { return this["garden.usage"] ?? "—"; },
  get tenantJson() {
    return JSON.stringify({ name: this["tenant.name"], phone: this["tenant.phone"], postal: this["tenant.postal"], address: this["tenant.address"] });
  },
  get tenantDirty() { return String(this["tenant.dirty"] ?? "—"); },
  get tenantValid() { return String(this["tenant.valid"] ?? "—"); },
  get faqTotal() { return this.$getAll("faq.*.total", []).reduce((a, b) => a + (b ?? 0), 0); },
  get dialogLogText() { return this.dialogLog.join(" / "); },

  // ── controls ──
  openDialog() { this.dialogOpen = true; },
  dialogOk() { this.dialogLog = this.dialogLog.concat(`OK:${this.dialogName}`); this.dialogOpen = false; },
  showToast() { this.$command.toast.emit({ kind: this.toastKind, text: this.toastText, seconds: Number(this.toastSeconds) }); },
  showFive() { for (let i = 1; i <= 5; i++) this.$command.toast.emit({ kind: "info", text: `お知らせ ${i}`, seconds: 0 }); },
  cycleTile() {
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(this["tile.status"]) + 1) % 4];
    this["tile.status"] = next;
  },
  renameTenant() { this["tile.tenant"] = { id: 901, name: "鈴木 花子", phone: "", postal: "", address: "" }; },
  serverErrors() { this["tenant.errors"] = { name: "サーバー: 氏名が重複しています", phone: "サーバー: この番号は使えません" }; },
  markSaved() {
    this["tenant.saved"] = { name: this["tenant.name"], phone: this["tenant.phone"], postal: this["tenant.postal"], address: this["tenant.address"] };
  },
  addFaqChild() {
    this["faq.1.children"] = this["faq.1.children"].concat({ id: 99, title: "追加の項目", questions: [{ q: "追加の質問は？", a: "追加の答え。" }], children: [] });
  },

  $watch: {
    // log what the dialog reports back (open → false from Escape / × / outside)
    dialogOpen(open, before) { if (before === true && open === false) this.dialogLog = this.dialogLog.concat("closed"); },
  },
};
