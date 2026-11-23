// よくある質問 (/help) — the FAQ tree (a volume mounted at `faq`). Owner: the help pages.
import { api, failureText } from "../lib/api.js";

export default {
  /** @type {{ id: number, title: string, questions: { q: string, a: string }[], children: any[] }[]} */
  nodes: [],
  query: "",
  loaded: false,
  loading: false,
  loadError: "",
  // The question count of the whole FAQ: the sum of what each top <faq-node> exports (its `total`).
  get total() { return this.$getAll("nodes.*.total", []).reduce((a, b) => a + (b ?? 0), 0); },
  get matchTotal() { return this.$getAll("nodes.*.matchCount", []).reduce((a, b) => a + (b ?? 0), 0); },
  get searching() { return Boolean(this.query.trim()); },
  get resultText() {
    return this.searching ? `「${this.query.trim()}」に該当する質問 ${this.matchTotal} 件（全 ${this.total} 件）` : `質問 ${this.total} 件`;
  },
  async load() {
    if (this.loaded || this.loading) return { ok: true, quiet: true };
    this.loading = true;
    const r = await api("GET", "/api/faq");
    this.loading = false;
    if (!r.ok) { this.loadError = failureText(r, "よくある質問を読み込"); return { ok: false, kind: "error", text: this.loadError }; }
    this.loadError = "";
    this.nodes = r.data;
    this.loaded = true;
    return { ok: true, quiet: true };
  },
  clear() { this.query = ""; },
};
