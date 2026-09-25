/**
 * Conformance scenarios: HTML + initial state + steps. The golden output is recorded from
 * the current @wcstack/state (3.3.0 dist) and state-next must reproduce it exactly, unless
 * a scenario states an intended difference.
 *
 * Constraints of the test DOM (happy-dom): no <template> directly inside table parts — its
 * parser hoists it out of <tbody>, so both engines would see a broken tree.
 */

export interface Api {
  /** Runs fn with a writable state proxy (element.createState("writable", fn)). */
  write(fn: (s: any) => void): void;
  click(selector: string): void;
  /** Sets .value and dispatches `input`. */
  input(selector: string, value: string): void;
  /** Lets `apply` change the control, then dispatches `change`. */
  change(selector: string, apply: (el: HTMLInputElement) => void): void;
  /** Calls a method of the element (a fixture custom element acting as the user / the network). */
  call(selector: string, method: string, ...args: unknown[]): unknown;
  /** Re-sets the whole state (setInitialState on the initialized element). */
  reset(state: Record<string, any>): void;
}

export interface Scenario {
  name: string;
  html: string;
  state: () => Record<string, any>;
  steps?: { label: string; run: (api: Api) => void | Promise<void> }[];
  /**
   * An intended difference from the current engine: the DOM state-next must show instead,
   * by step label (`initial` for the first snapshot). The golden must still differ there,
   * so a later fix of the current engine is noticed.
   */
  differs?: { reason: string; dom: Record<string, string> };
}

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `item ${i + 1}` }));

export const scenarios: Scenario[] = [
  {
    name: "空のリストだけをたどる $getAll の getter も、最初の行に追従する",
    html: `<wcs-state></wcs-state><p>{{ sum }}</p><p>{{ count }}</p>`,
    state: () => ({
      groups: [{ items: [] }, { items: [] }],
      get sum() { return (this as any).$getAll("groups.*.items.*.v", []).reduce((a: number, b: number) => a + b, 0); },
      get count() { return (this as any).$getAll("groups.*.items.*.v", [1]).length; },
    }),
    steps: [
      { label: "2 つ目の組に行を足す", run: (a) => a.write((s) => { s["groups.1.items"] = [{ v: 3 }, { v: 4 }]; }) },
      { label: "1 つ目の組に行を足す", run: (a) => a.write((s) => { s["groups.0.items"] = [{ v: 10 }]; }) },
    ],
  },
  {
    name: "再帰パス: ** の getter の族・全深さの $getAll・深い書き込み・枝の追加・一斉書き込み",
    html: `<wcs-state></wcs-state><p class="t">{{ treeTotal }}</p><p class="v">{{ values }}</p><p class="r">{{ roots }}</p><p class="s">{{ selectedCount }}</p><ul><template data-wcs="for: nodes"><li>{{ .value }}:{{ .total }}</li></template></ul>`,
    state: () => ({
      nodes: [
        { value: 1, children: [{ value: 10, children: [{ value: 100, children: [] }] }, { value: 20, children: [] }] },
        { value: 2, children: [] },
      ],
      $recursion: { "nodes.*": "children.*" },
      get "nodes.**.total"() {
        const self = this as any;
        return self["nodes.**.value"] + self.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
      },
      get "nodes.**.root"() { return (this as any).$1; },
      get treeTotal() { return (this as any).$getAll("nodes.*.total", []).reduce((a: number, b: number) => a + b, 0); },
      get values() { return (this as any).$getAll("nodes.**.value", []).join(","); },
      get roots() { return (this as any).$getAll("nodes.**.root", []).join(","); },
      get selectedCount() { return (this as any).$getAll("nodes.**.selected", []).filter(Boolean).length; },
    }),
    steps: [
      { label: "深い葉を書く", run: (a) => a.write((s) => { s["nodes.0.children.0.children.0.value"] = 1000; }) },
      { label: "空の枝に子を足す", run: (a) => a.write((s) => { s["nodes.1.children"] = [{ value: 5, children: [] }]; }) },
      { label: "全ノードに一斉に書く", run: (a) => a.write((s) => { s.$setAll("nodes.**.selected", [], true); }) },
      { label: "根を並べ替える", run: (a) => a.write((s) => { s.nodes = s.nodes.toReversed(); }) },
    ],
  },
  {
    name: "再帰パス: 誤り（読み取り専用の展開・文脈の無い **・一斉書き込みの形・構造への書き込み）",
    html: `<wcs-state></wcs-state><p>{{ log }}</p>`,
    state: () => ({
      log: "",
      nodes: [{ value: 1, children: [{ value: 2, children: [] }] }],
      $recursion: { "nodes.*": "children.*" },
      get "nodes.**.total"() { return (this as any)["nodes.**.value"]; },
    }),
    steps: [
      {
        label: "それぞれ試す",
        run: (a) => a.write((s) => {
          const codes: string[] = [];
          const attempt = (fn: () => void) => {
            try { fn(); codes.push("ok"); } catch (e) { codes.push(/\[wcs\/[\w-]+\]/.exec(String((e as Error).message))?.[0] ?? "error"); }
          };
          attempt(() => { s["nodes.0.total"] = 9; });
          attempt(() => s["nodes.**.value"]);
          attempt(() => s.$setAll("nodes.**.value", [0], 1));
          attempt(() => s.$setAll("nodes.**.children", [], []));
          attempt(() => s.$setAll("nodes.**.total", [], 1));
          attempt(() => s.$getAll("nodes.**.value", [0]));
          attempt(() => s.$getAll("nodes.**.value", []));
          s.log = codes.join(" ");
        }),
      },
    ],
    differs: {
      reason: "3.3.0 は for で描いていないリスト（nodes）の行のパスへの書き込みを \"ListIndex not found: nodes\" で投げ、展開の読み取り専用の検査に届かない（#319 と同系統）。新エンジンは契約どおり [wcs/recursion-readonly] で拒む",
      dom: {
        "それぞれ試す": "<p>[wcs/recursion-readonly] [wcs/recursion-context] [wcs/recursion-setall-form] [wcs/recursion-structural-write] [wcs/recursion-readonly] [wcs/recursion-getall-form] ok|</p>",
      },
    },
  },
  {
    name: "再帰パス: 自己参照するコンポーネントで木を描く",
    html: `<wcs-state></wcs-state><p>{{ treeTotal }}</p><template data-wcs="for: nodes"><conf-tree data-wcs="state: ."></conf-tree></template>`,
    state: () => ({
      nodes: [
        { value: 1, children: [{ value: 10, children: [{ value: 100, children: [] }] }, { value: 20, children: [] }] },
        { value: 2, children: [] },
      ],
      $recursion: { "nodes.*": "children.*" },
      get "nodes.**.total"() {
        const self = this as any;
        return self["nodes.**.value"] + self.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
      },
      get treeTotal() { return (this as any).$getAll("nodes.*.total", []).reduce((a: number, b: number) => a + b, 0); },
    }),
    steps: [
      { label: "深い葉を書く", run: (a) => a.write((s) => { s["nodes.0.children.0.children.0.value"] = 1000; }) },
      { label: "葉に子を足す", run: (a) => a.write((s) => { s["nodes.0.children.1.children"] = [{ value: 7, children: [] }]; }) },
    ],
  },
  {
    name: "コンポーネントの mount: 丸ごと、getter、私有キー、双方向、element.state",
    html: `<wcs-state></wcs-state><p>{{ user.name }}</p><conf-card data-wcs="state: user"></conf-card>`,
    state: () => ({ user: { name: "Alice", mode: "tree" } }),
    steps: [
      { label: "ホストが書く", run: (a) => a.write((s) => { s["user.name"] = "Bob"; }) },
      { label: "中の入力", run: (a) => { a.call("conf-card", "type", "Eve"); } },
      { label: "中のメソッドが私有キーを書く", run: (a) => { a.call("conf-card", "press"); } },
      { label: "ホストが丸ごと置き換える", run: (a) => a.write((s) => { s.user = { name: "Dana", mode: "x" }; }) },
      { label: "element.state に書く", run: (a) => { a.call("conf-card", "setName", "Zed"); } },
    ],
    differs: {
      reason: "3.3.0 の不具合（#321）: コンポーネントのメソッドが私有キーを書いても、その回には描き直さない（次の変更のときに反映される）。新エンジンは書いた回に描く",
      dom: {
        "中のメソッドが私有キーを書く": "<p>Eve|</p><conf-card><#shadow><span class=\"name\">Eve|</span><span class=\"display\">Eve!|</span><span class=\"mode\">edit|</span><input :value=\"Eve\"></input><button>t|</button></#shadow></conf-card>",
      },
    },
  },
  {
    name: "行の中のコンポーネント: $1・$getAll・イベントの添字はコンポーネントの範囲",
    html: `<wcs-state></wcs-state><p class="sum">{{ sum }}</p><template data-wcs="for: groups"><section><h3>{{ .title }}</h3><conf-list data-wcs="state.items: .items"></conf-list></section></template>`,
    state: () => ({
      groups: [{ title: "A", items: [{ v: 1 }, { v: 2 }] }, { title: "B", items: [{ v: 3 }, { v: 4 }, { v: 5 }] }],
      get sum() { return (this as any).$getAll("groups.*.items.*.v", []).reduce((a: number, b: number) => a + b, 0); },
    }),
    steps: [
      { label: "2 つ目の組の 2 行目を押す", run: (a) => { a.call("section:nth-of-type(2) conf-list", "clickRow", 1); } },
      { label: "ホストが行の値を書く", run: (a) => a.write((s) => { s["groups.1.items.2.v"] = 50; }) },
      { label: "コンポーネントが行の値を書く", run: (a) => { a.call("section:nth-of-type(1) conf-list", "bump"); } },
      { label: "組を入れ替える", run: (a) => a.write((s) => { s.groups = s.groups.toReversed(); }) },
      { label: "行を足す", run: (a) => a.write((s) => { s["groups.0.items"] = s["groups.0.items"].concat({ v: 9 }); }) },
    ],
    differs: {
      reason: "3.3.0 の不具合 3 つ（行の中のコンポーネント）: getter の中の $getAll(\"items.*.v\", []) が失敗して空になる（#322。README はコンポーネントの語彙でホストの行の添字を前に付けると約束する）／押した行の添字で書いた私有キーがその回に描かれない（#321）／this[\"items.0.v\"] に書くと \"Partial wildcard type is not supported yet\" で投げる（#323）。新エンジンは README どおりに動く（$1 がコンポーネントの範囲で数えるのは同じ）",
      dom: {
        "initial": "<p class=\"sum\">15|</p><section><h3>A|</h3><conf-list><#shadow><ul><li>0|:|1|</li><li>1|:|2|</li></ul><p class=\"total\">3|</p><p class=\"picked\">-1|</p></#shadow></conf-list></section><section><h3>B|</h3><conf-list><#shadow><ul><li>0|:|3|</li><li>1|:|4|</li><li>2|:|5|</li></ul><p class=\"total\">12|</p><p class=\"picked\">-1|</p></#shadow></conf-list></section>",
        "2 つ目の組の 2 行目を押す": "<p class=\"sum\">15|</p><section><h3>A|</h3><conf-list><#shadow><ul><li>0|:|1|</li><li>1|:|2|</li></ul><p class=\"total\">3|</p><p class=\"picked\">-1|</p></#shadow></conf-list></section><section><h3>B|</h3><conf-list><#shadow><ul><li>0|:|3|</li><li>1|:|4|</li><li>2|:|5|</li></ul><p class=\"total\">12|</p><p class=\"picked\">1|</p></#shadow></conf-list></section>",
        "ホストが行の値を書く": "<p class=\"sum\">60|</p><section><h3>A|</h3><conf-list><#shadow><ul><li>0|:|1|</li><li>1|:|2|</li></ul><p class=\"total\">3|</p><p class=\"picked\">-1|</p></#shadow></conf-list></section><section><h3>B|</h3><conf-list><#shadow><ul><li>0|:|3|</li><li>1|:|4|</li><li>2|:|50|</li></ul><p class=\"total\">57|</p><p class=\"picked\">1|</p></#shadow></conf-list></section>",
        "コンポーネントが行の値を書く": "<p class=\"sum\">70|</p><section><h3>A|</h3><conf-list><#shadow><ul><li>0|:|11|</li><li>1|:|2|</li></ul><p class=\"total\">13|</p><p class=\"picked\">-1|</p></#shadow></conf-list></section><section><h3>B|</h3><conf-list><#shadow><ul><li>0|:|3|</li><li>1|:|4|</li><li>2|:|50|</li></ul><p class=\"total\">57|</p><p class=\"picked\">1|</p></#shadow></conf-list></section>",
        "組を入れ替える": "<p class=\"sum\">70|</p><section><h3>B|</h3><conf-list><#shadow><ul><li>0|:|3|</li><li>1|:|4|</li><li>2|:|50|</li></ul><p class=\"total\">57|</p><p class=\"picked\">1|</p></#shadow></conf-list></section><section><h3>A|</h3><conf-list><#shadow><ul><li>0|:|11|</li><li>1|:|2|</li></ul><p class=\"total\">13|</p><p class=\"picked\">-1|</p></#shadow></conf-list></section>",
        "行を足す": "<p class=\"sum\">79|</p><section><h3>B|</h3><conf-list><#shadow><ul><li>0|:|3|</li><li>1|:|4|</li><li>2|:|50|</li><li>3|:|9|</li></ul><p class=\"total\">66|</p><p class=\"picked\">1|</p></#shadow></conf-list></section><section><h3>A|</h3><conf-list><#shadow><ul><li>0|:|11|</li><li>1|:|2|</li></ul><p class=\"total\">13|</p><p class=\"picked\">-1|</p></#shadow></conf-list></section>",
      },
    },
  },
  {
    name: "Light DOM のコンポーネント（単独と行）",
    html: `<wcs-state></wcs-state><conf-light data-wcs="state: user"></conf-light><div><template data-wcs="for: rows"><conf-light data-wcs="state: ."></conf-light></template></div>`,
    state: () => ({ user: { name: "Al" }, rows: [{ name: "r1" }, { name: "r2" }] }),
    steps: [
      { label: "単独のマウント先を書く", run: (a) => a.write((s) => { s["user.name"] = "Bo"; }) },
      { label: "行の値を書く", run: (a) => a.write((s) => { s["rows.1.name"] = "R2"; }) },
      { label: "行を入れ替える", run: (a) => a.write((s) => { s.rows = s.rows.toReversed(); }) },
    ],
  },
  {
    name: "結線の無い Shadow のコンポーネントは独立した木（凍結した状態は書けるようにする）",
    html: `<wcs-state></wcs-state><conf-solo></conf-solo>`,
    state: () => ({}),
    steps: [
      { label: "element.state に書く", run: (a) => { a.call("conf-solo", "say", "yo"); } },
    ],
  },
  {
    name: "配列を読む getter と、行の値への書き込み（上向きには無効化しない）",
    html: `<wcs-state></wcs-state><p>{{ total }}</p><ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul><ul class="big"><template data-wcs="for: big"><li>{{ .v }}</li></template></ul>`,
    state: () => ({
      items: [{ v: 1 }, { v: 2 }, { v: 3 }],
      get total() { return (this as any).items.reduce((a: number, x: any) => a + x.v, 0); },
      get big() { return (this as any).items.filter((x: any) => x.v >= 2); },
    }),
    steps: [
      { label: "行の値を書き換える", run: (a) => a.write((s) => { s["items.0.v"] = 5; }) },
      { label: "配列を置き換える", run: (a) => a.write((s) => { s.items = s.items.concat({ v: 4 }); }) },
    ],
  },
  {
    name: "行の getter のリスト（入れ子の for）が依存の変化に追従する",
    html: `<wcs-state></wcs-state><template data-wcs="for: groups"><section><h2>{{ .name }}</h2><ul><template data-wcs="for: .big"><li>{{ .v }}</li></template></ul></section></template>`,
    state: () => ({
      groups: [{ name: "a", min: 2, items: [{ v: 1 }, { v: 2 }, { v: 3 }] }, { name: "b", min: 5, items: [{ v: 4 }, { v: 6 }] }],
      get "groups.*.big"() { const self = this as any; return self["groups.*.items"].filter((x: any) => x.v >= self["groups.*.min"]); },
    }),
    steps: [
      { label: "a の下限を上げる", run: (a) => a.write((s) => { s["groups.0.min"] = 3; }) },
      { label: "b に行を足す", run: (a) => a.write((s) => { s["groups.1.items"] = s["groups.1.items"].concat({ v: 9 }); }) },
      { label: "a の行の値を書き換える", run: (a) => a.write((s) => { s["groups.0.items.0.v"] = 7; }) },
    ],
    differs: {
      reason: "3.3.0 の不具合（#319・$watch の行の監視と同系統）: for で描いていないリスト（groups.*.items）の行のパスへの書き込みが \"ListIndex not found\" で投げる。新エンジンは書き込み、配列を読む getter は上向きには無効化しない（最上位のリストでの 3.3.0 と同じ意味。上のシナリオで確認）",
      dom: {
        "a の行の値を書き換える": "<section><h2>a|</h2><ul><li>3|</li></ul></section><section><h2>b|</h2><ul><li>6|</li><li>9|</li></ul></section>",
      },
    },
  },
  {
    name: "getter のリストが投げても他は描かれ、依存を直すと戻る",
    html: `<wcs-state></wcs-state><p>{{ mode }}</p><ul><template data-wcs="for: view"><li>{{ . }}</li></template></ul>`,
    state: () => ({
      mode: "ok", src: ["x", "y"],
      get view() { const self = this as any; if (self.mode === "bad") throw new Error("boom"); return self.src.map((v: string) => v + "!"); },
      $errorCallback() {},
    }),
    steps: [
      { label: "投げる", run: (a) => a.write((s) => { s.src = ["z"]; s.mode = "bad"; }) },
      { label: "戻す", run: (a) => a.write((s) => { s.mode = "ok"; }) },
    ],
    differs: {
      reason: "3.3.0 は for のリストの getter の失敗を書き込み元へ投げる（その後の書き込みは落ちる）。新エンジンは他のバインディングと同じく、その for の失敗として $errorCallback に報告し、書き込みは入り、一覧は前の行を保つ",
      dom: {
        "投げる": "<p>bad|</p><ul><li>x!|</li><li>y!|</li></ul>",
      },
    },
  },
  {
    name: "getter のリストを if の中で描き、元のオブジェクトの値を差し替える",
    html: `<wcs-state></wcs-state><p>{{ hits }}</p><template data-wcs="if: hasResults"><ul><template data-wcs="for: results"><li>{{ .name }}</li></template></ul></template>`,
    state: () => ({
      fetch: { value: null as any },
      get results() { return (this as any)["fetch.value"] ?? []; },
      get hits() { return (this as any).results.length; },
      get hasResults() { return (this as any).hits > 0; },
    }),
    steps: [
      { label: "5 件", run: (a) => a.write((s) => { s["fetch.value"] = items(5); }) },
      { label: "1 件", run: (a) => a.write((s) => { s["fetch.value"] = items(1); }) },
      { label: "0 件", run: (a) => a.write((s) => { s["fetch.value"] = []; }) },
      { label: "3 件", run: (a) => a.write((s) => { s["fetch.value"] = items(3); }) },
    ],
  },
  {
    name: "<wcs-state> の中に書いたマークアップも束ねる",
    html: `<wcs-state><p id="in">{{ msg }}</p><ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul><button data-wcs="onclick: add">add</button></wcs-state><p id="out">{{ msg }}</p>`,
    state: () => ({ msg: "hi", items: items(2), add(this: any) { this.items = this.items.concat({ id: 9, name: "added" }); } }),
    steps: [
      { label: "msg を書き換える", run: (a) => a.write((s) => { s.msg = "bye"; }) },
      { label: "中のボタンで行を足す", run: (a) => a.click("button") },
    ],
  },
  {
    name: "text: textContent と mustache",
    html: `<wcs-state></wcs-state><p data-wcs="textContent: msg"></p><div>{{ msg }} / {{ count }}</div>`,
    state: () => ({ msg: "hello", count: 1 }),
    steps: [
      { label: "msg を書き換える", run: (a) => a.write((s) => { s.msg = "bye"; }) },
      { label: "count を増やす", run: (a) => a.write((s) => { s.count += 1; }) },
    ],
  },
  {
    name: "list: 置き換え・追加・削除・入れ替え・全消去",
    html: `<wcs-state></wcs-state><ul><template data-wcs="for: items"><li data-wcs="attr.data-id: .id">{{ .name }}</li></template></ul>`,
    state: () => ({ items: items(3) }),
    steps: [
      { label: "追加", run: (a) => a.write((s) => { s.items = s.items.concat({ id: 4, name: "item 4" }); }) },
      { label: "先頭を削除", run: (a) => a.write((s) => { s.items = s.items.toSpliced(0, 1); }) },
      { label: "入れ替え", run: (a) => a.write((s) => { const d = s.items.slice(); [d[0], d[2]] = [d[2], d[0]]; s.items = d; }) },
      { label: "並べ替え（逆順）", run: (a) => a.write((s) => { s.items = s.items.toReversed(); }) },
      { label: "全置き換え", run: (a) => a.write((s) => { s.items = items(2); }) },
      { label: "全消去", run: (a) => a.write((s) => { s.items = []; }) },
      { label: "再作成", run: (a) => a.write((s) => { s.items = items(2); }) },
    ],
  },
  {
    name: "list: 添字付きパスへの書き込み",
    html: `<wcs-state></wcs-state><ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul>`,
    state: () => ({ items: items(4) }),
    steps: [
      { label: "items.1.name", run: (a) => a.write((s) => { s["items.1.name"] = "second"; }) },
      { label: "偶数行に追記", run: (a) => a.write((s) => { for (let i = 0; i < s.items.length; i += 2) s[`items.${i}.name`] += "!"; }) },
    ],
  },
  {
    name: "getter: 行の getter と連鎖",
    html: `<wcs-state></wcs-state><ul><template data-wcs="for: items"><li>{{ .label }}</li></template></ul><p>{{ total }}</p><p>{{ summary }}</p>`,
    state: () => ({
      items: [{ n: 1 }, { n: 2 }, { n: 3 }],
      unit: "pt",
      get "items.*.label"() { return `${(this as any)["items.*.n"]}${(this as any).unit}`; },
      get total() { return (this as any).items.reduce((t: number, x: any) => t + x.n, 0); },
      get summary() { return `total=${(this as any).total}`; },
    }),
    steps: [
      { label: "unit（全行が読む）", run: (a) => a.write((s) => { s.unit = "px"; }) },
      { label: "items.2.n（その行だけ）", run: (a) => a.write((s) => { s["items.2.n"] = 30; }) },
      { label: "items を置き換え（total と summary）", run: (a) => a.write((s) => { s.items = [...s.items, { n: 4 }]; }) },
    ],
  },
  {
    name: "select: 普通の getter と $1",
    html: `<wcs-state></wcs-state><ul><template data-wcs="for: items"><li data-wcs="class.selected: .selected; onclick: onSelect">{{ .name }}</li></template></ul>`,
    state: () => ({
      items: items(5),
      selectedIndex: null as number | null,
      get "items.*.selected"() { return (this as any).$1 === (this as any).selectedIndex; },
      onSelect(this: any, _e: Event, i: number) { this.selectedIndex = i; },
    }),
    steps: [
      { label: "3 行目をクリック", run: (a) => a.click("li:nth-of-type(3)") },
      { label: "1 行目をクリック", run: (a) => a.click("li:nth-of-type(1)") },
      { label: "先頭を削除（添字の選択が詰まる）", run: (a) => a.write((s) => { s.items = s.items.toSpliced(0, 1); }) },
    ],
  },
  {
    name: "select: $eqIndex",
    html: `<wcs-state></wcs-state><ul><template data-wcs="for: items"><li data-wcs="class.selected: .selected; onclick: onSelect">{{ .name }}</li></template></ul>`,
    state: () => ({
      items: items(5),
      selectedIndex: null as number | null,
      get "items.*.selected"() { return (this as any).$eqIndex("selectedIndex"); },
      onSelect(this: any, _e: Event, i: number) { this.selectedIndex = i; },
    }),
    steps: [
      { label: "2 行目をクリック", run: (a) => a.click("li:nth-of-type(2)") },
      { label: "5 行目をクリック", run: (a) => a.click("li:nth-of-type(5)") },
      { label: "2 行目を削除", run: (a) => a.write((s) => { s.items = s.items.toSpliced(1, 1); }) },
    ],
  },
  {
    name: "list: 入れ子と親の行を読むバインディング",
    html: `<wcs-state></wcs-state><div><template data-wcs="for: groups"><section><h2>{{ .title }}</h2><template data-wcs="for: .items"><i>{{ groups.*.title }}:{{ .v }}</i></template></section></template></div>`,
    state: () => ({ groups: [{ title: "a", items: [{ v: 1 }, { v: 2 }] }, { title: "b", items: [{ v: 3 }] }] }),
    steps: [
      { label: "groups.0.title", run: (a) => a.write((s) => { s["groups.0.title"] = "A"; }) },
      { label: "groups.1.items に追加", run: (a) => a.write((s) => { s["groups.1.items"] = [...s["groups.1.items"], { v: 4 }]; }) },
      { label: "groups を入れ替え", run: (a) => a.write((s) => { s.groups = s.groups.toReversed(); }) },
    ],
  },
  {
    name: "attr / class / style",
    html: `<wcs-state></wcs-state><div id="t" data-wcs="attr.title: title; class.on: on; style.color: color"></div>`,
    state: () => ({ title: "t1", on: false, color: "red" }),
    steps: [
      { label: "すべて変える", run: (a) => a.write((s) => { s.title = "t2"; s.on = true; s.color = "blue"; }) },
      { label: "null を入れる", run: (a) => a.write((s) => { s.title = null; s.on = false; s.color = null; }) },
    ],
  },
  {
    name: "event: 引数に $1 を受け取るメソッド",
    html: `<wcs-state></wcs-state><p>{{ log }}</p><ul><template data-wcs="for: items"><li><button data-wcs="onclick: hit">{{ .name }}</button></li></template></ul>`,
    state: () => ({
      log: "",
      items: items(3),
      hit(this: any, _e: Event, i: number) { this.log = `${this.log}${i};`; },
    }),
    steps: [
      { label: "2 行目", run: (a) => a.click("li:nth-of-type(2) button") },
      { label: "3 行目", run: (a) => a.click("li:nth-of-type(3) button") },
    ],
  },
  {
    name: "要素の書き込み（その位置の値を置き換える）",
    html: `<wcs-state></wcs-state><ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul>`,
    state: () => ({ items: items(3) }),
    steps: [
      { label: "items.1 を新しい値に", run: (a) => a.write((s) => { s["items.1"] = { id: 9, name: "nine" }; }) },
    ],
  },
  // ---------------------------------------------------------------- stage 1
  {
    name: "$getAll: ルートの集計と、行の文脈での省略",
    html: `<wcs-state></wcs-state><p>{{ total }}</p><ul><template data-wcs="for: regions"><li>{{ .name }}={{ .sum }}</li></template></ul>`,
    state: () => ({
      regions: [{ name: "a", towns: [{ pop: 1 }, { pop: 2 }] }, { name: "b", towns: [{ pop: 10 }] }],
      get "regions.*.sum"() { return (this as any).$getAll("regions.*.towns.*.pop").reduce((x: number, y: number) => x + y, 0); },
      get total() { return (this as any).$getAll("regions.*.sum", []).reduce((x: number, y: number) => x + y, 0); },
    }),
    steps: [
      { label: "regions.0.towns.1.pop", run: (a) => a.write((s) => { s["regions.0.towns.1.pop"] = 20; }) },
      { label: "regions.1.towns に追加", run: (a) => a.write((s) => { s["regions.1.towns"] = [...s["regions.1.towns"], { pop: 5 }]; }) },
    ],
  },
  {
    name: "$setAll: 全部に同じ値・マッパー・配る",
    html: `<wcs-state></wcs-state><ul><template data-wcs="for: users"><li data-wcs="class.on: .selected">{{ .score }}</li></template></ul>`,
    state: () => ({ users: [{ selected: false, score: 1 }, { selected: false, score: 2 }, { selected: true, score: 3 }] }),
    steps: [
      { label: "broadcast true", run: (a) => a.write((s) => { s.$setAll("users.*.selected", [], true); }) },
      { label: "mapper で反転", run: (a) => a.write((s) => { s.$setAll("users.*.selected", [], (cur: boolean) => !cur); }) },
      { label: "mapper で先頭 2 行だけ倍", run: (a) => a.write((s) => { s.$setAll("users.*.score", [], (cur: number, i: number) => (i < 2 ? cur * 2 : undefined)); }) },
      { label: "spread", run: (a) => a.write((s) => { s.$setAll("users.*.score", [], [7, 8, 9], { spread: true }); }) },
    ],
  },
  {
    name: "$resolve: 明示の添字で読み書き",
    html: `<wcs-state></wcs-state><p>{{ picked }}</p><ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`,
    state: () => ({ items: ["A", "B", "C"], picked: "" }),
    steps: [
      { label: "items.* [2] を読む", run: (a) => a.write((s) => { s.picked = s.$resolve("items.*", [2]); }) },
      { label: "items.* [0] に書く", run: (a) => a.write((s) => { s.$resolve("items.*", [0], "Z"); }) },
    ],
  },
  {
    name: "lifecycle: $connectedCallback が初期値を書く",
    html: `<wcs-state></wcs-state><p>{{ status }}</p>`,
    state: () => ({ status: "idle", async $connectedCallback(this: any) { await Promise.resolve(); this.status = "ready"; } }),
  },
  {
    name: "errorCallback: getter が投げても他のバインディングは反映される",
    html: `<wcs-state></wcs-state><p class="a">{{ title }}</p><p class="b">{{ n }}</p><p class="c">{{ failed }}</p>`,
    state: () => ({
      user: null as any, n: 1, failed: "",
      get title() { return (this as any).user.profile.name; },
      $errorCallback(this: any, _e: unknown, info: { path: string }) { this.failed = `${this.failed}${info.path};`; },
    }),
    steps: [
      { label: "n を変える（title はまだ失敗）", run: (a) => a.write((s) => { s.n = 2; }) },
      { label: "user を入れて直す", run: (a) => a.write((s) => { s.user = { profile: { name: "Ann" } }; }) },
    ],
  },
  {
    name: "getter の中での書き込みは失敗する",
    html: `<wcs-state></wcs-state><p>{{ bad }}</p><p>{{ count }}</p><p>{{ failed }}</p>`,
    state: () => ({
      count: 0, failed: "",
      get bad() { (this as any).count = 5; return "x"; },
      $errorCallback(this: any, _e: unknown, info: { path: string }) { this.failed = `${this.failed}${info.path};`; },
    }),
  },
  {
    name: "getter の循環は失敗として報告される",
    html: `<wcs-state></wcs-state><p>{{ a }}</p><p>{{ ok }}</p><p>{{ failed }}</p>`,
    state: () => ({
      ok: "ok", failed: "",
      get a() { return (this as any).b; },
      get b() { return (this as any).a; },
      $errorCallback(this: any, _e: unknown, info: { path: string }) { this.failed = `${this.failed}${info.path};`; },
    }),
  },
  // ---------------------------------------------------------------- stage 2
  {
    name: "if / elseif / else: ルートの連鎖",
    html: `<wcs-state></wcs-state><div><template data-wcs="if: pos"><p>positive {{ count }}</p></template><template data-wcs="elseif: neg"><p>negative</p></template><template data-wcs="else:"><p>zero</p></template></div>`,
    state: () => ({
      count: 0,
      get pos() { return (this as any).count > 0; },
      get neg() { return (this as any).count < 0; },
    }),
    steps: [
      { label: "1", run: (a) => a.write((s) => { s.count = 1; }) },
      { label: "2（同じ枝のまま中身だけ）", run: (a) => a.write((s) => { s.count = 2; }) },
      { label: "-1", run: (a) => a.write((s) => { s.count = -1; }) },
      { label: "0", run: (a) => a.write((s) => { s.count = 0; }) },
    ],
  },
  {
    name: "if: 真偽でない値（JavaScript の真偽性）",
    html: `<wcs-state></wcs-state><div><template data-wcs="if: v"><b>yes</b></template><template data-wcs="else:"><i>no</i></template></div>`,
    state: () => ({ v: 0 as unknown }),
    steps: [
      { label: "1", run: (a) => a.write((s) => { s.v = 1; }) },
      { label: "空文字", run: (a) => a.write((s) => { s.v = ""; }) },
      { label: "非空文字", run: (a) => a.write((s) => { s.v = "x"; }) },
      { label: "null", run: (a) => a.write((s) => { s.v = null; }) },
      { label: "オブジェクト", run: (a) => a.write((s) => { s.v = {}; }) },
      { label: "undefined", run: (a) => a.write((s) => { s.v = undefined; }) },
    ],
  },
  {
    name: "if: 行の中の条件と、行の値を読む中身",
    html: `<wcs-state></wcs-state><ul><template data-wcs="for: items"><li><template data-wcs="if: .done"><s>{{ .name }}</s></template><template data-wcs="else:"><span>{{ .name }}</span></template></li></template></ul>`,
    state: () => ({ items: [{ name: "a", done: false }, { name: "b", done: true }, { name: "c", done: false }] }),
    steps: [
      { label: "items.0.done", run: (a) => a.write((s) => { s["items.0.done"] = true; }) },
      { label: "items.0.name（枝の中身だけ）", run: (a) => a.write((s) => { s["items.0.name"] = "A"; }) },
      { label: "items.1.done を戻す", run: (a) => a.write((s) => { s["items.1.done"] = false; }) },
      { label: "先頭を削除", run: (a) => a.write((s) => { s.items = s.items.toSpliced(0, 1); }) },
      { label: "並べ替え", run: (a) => a.write((s) => { s.items = s.items.toReversed(); }) },
    ],
  },
  {
    name: "if の中の for と、for の中の if の入れ子",
    html: `<wcs-state></wcs-state><div><template data-wcs="if: show"><ul><template data-wcs="for: items"><li>{{ .n }}<template data-wcs="if: .big"><em>!</em></template></li></template></ul></template></div>`,
    state: () => ({
      show: false,
      items: [{ n: 1 }, { n: 20 }],
      get "items.*.big"() { return (this as any)["items.*.n"] > 10; },
    }),
    steps: [
      { label: "表示する", run: (a) => a.write((s) => { s.show = true; }) },
      { label: "items.0.n を大きく", run: (a) => a.write((s) => { s["items.0.n"] = 30; }) },
      { label: "隠す", run: (a) => a.write((s) => { s.show = false; }) },
      { label: "隠している間に追加", run: (a) => a.write((s) => { s.items = [...s.items, { n: 50 }]; }) },
      { label: "再表示", run: (a) => a.write((s) => { s.show = true; }) },
    ],
  },
  // ---------------------------------------------------------------- stage 3c
  {
    name: "two-way: input / textarea / select",
    html: `<wcs-state></wcs-state><input id="i" data-wcs="value: name"><textarea id="t" data-wcs="value: note"></textarea><select id="s" data-wcs="value: pick"><option value="a">A</option><option value="b">B</option></select><p>{{ name }}|{{ note }}|{{ pick }}</p>`,
    state: () => ({ name: "ann", note: "n", pick: "a" }),
    steps: [
      { label: "input に入力", run: (a) => a.input("#i", "bob") },
      { label: "textarea に入力", run: (a) => a.input("#t", "hello") },
      { label: "select を変更", run: (a) => a.change("#s", (el) => { (el as any).value = "b"; }) },
      { label: "状態から書く", run: (a) => a.write((s) => { s.name = "carl"; s.pick = "a"; }) },
    ],
  },
  {
    name: "two-way: #ro と #onchange",
    html: `<wcs-state></wcs-state><input id="ro" data-wcs="value#ro: a"><input id="oc" data-wcs="value#onchange: b"><p>{{ a }}|{{ b }}</p>`,
    state: () => ({ a: "a0", b: "b0" }),
    steps: [
      { label: "#ro に入力（書き戻さない）", run: (a) => a.input("#ro", "x") },
      { label: "#onchange に input（書き戻さない）", run: (a) => a.input("#oc", "y") },
      { label: "#onchange に change", run: (a) => a.change("#oc", (el) => { el.value = "z"; }) },
    ],
  },
  {
    name: "radio: グループ",
    html: `<wcs-state></wcs-state><input type="radio" id="r1" value="red" data-wcs="radio: color"><input type="radio" id="r2" value="blue" data-wcs="radio: color"><p>{{ color }}</p>`,
    state: () => ({ color: "red" }),
    steps: [
      { label: "blue を選ぶ", run: (a) => a.click("#r2") },
      { label: "状態から red", run: (a) => a.write((s) => { s.color = "red"; }) },
      { label: "どれでもない値", run: (a) => a.write((s) => { s.color = "green"; }) },
    ],
  },
  {
    name: "radio: for の中で value: .",
    html: `<wcs-state></wcs-state><div><template data-wcs="for: branches"><label><input type="radio" data-wcs="value: .; radio: current">{{ . }}</label></template></div><p>{{ current }}</p>`,
    state: () => ({ branches: ["main", "dev", "feat"], current: "dev" }),
    steps: [
      { label: "3 つ目を選ぶ", run: (a) => a.click("label:nth-of-type(3) input") },
    ],
  },
  {
    name: "checkbox: 配列へのグループと checked",
    html: `<wcs-state></wcs-state><input type="checkbox" id="c1" value="apple" data-wcs="checkbox: fruits"><input type="checkbox" id="c2" value="banana" data-wcs="checkbox: fruits"><input type="checkbox" id="d" data-wcs="checked: done"><p>{{ joined }}|{{ done }}</p>`,
    state: () => ({ fruits: ["banana"], done: false, get joined() { return (this as any).fruits.join(","); } }),
    steps: [
      { label: "apple を付ける", run: (a) => a.click("#c1") },
      { label: "banana を外す", run: (a) => a.click("#c2") },
      { label: "done を付ける", run: (a) => a.click("#d") },
      { label: "状態から置き換え", run: (a) => a.write((s) => { s.fruits = ["banana", "apple"]; s.done = false; }) },
    ],
  },
  {
    name: "html と text:",
    differs: {
      reason: "README は text を textContent の別名、html を innerHTML と定めるが、3.3.0 はどちらも素のプロパティとして書く（何も表示されない）。新エンジンは README に従う",
      dom: {
        initial: '<div id="h"><b>bold|</b></div><p>m|</p>',
        "書き換え": '<div id="h"><i>it|</i></div><p>n|</p>',
      },
    },
    html: `<wcs-state></wcs-state><div id="h" data-wcs="html: markup"></div><p data-wcs="text: msg"></p>`,
    state: () => ({ markup: "<b>bold</b>", msg: "m" }),
    steps: [
      { label: "書き換え", run: (a) => a.write((s) => { s.markup = "<i>it</i>"; s.msg = "n"; }) },
      { label: "null", run: (a) => a.write((s) => { s.markup = null; s.msg = null; }) },
    ],
  },
  {
    name: "空値の約束（B8）: 表示系と要素の入力",
    html: `<wcs-state></wcs-state><p id="t" data-wcs="textContent: v">x</p><p id="a" data-wcs="attr.title: v; style.color: v"></p><input id="i" data-wcs="value: v"><span>{{ v }}</span>`,
    state: () => ({ v: "red" as unknown }),
    steps: [
      { label: "undefined", run: (a) => a.write((s) => { s.v = undefined; }) },
      { label: "値に戻す", run: (a) => a.write((s) => { s.v = "blue"; }) },
      { label: "null", run: (a) => a.write((s) => { s.v = null; }) },
    ],
  },
  {
    name: "class: 真偽でない値は失敗として報告される",
    html: `<wcs-state></wcs-state><p id="c" data-wcs="class.on: v"></p><p>{{ failed }}</p>`,
    state: () => ({
      v: true as unknown, failed: "",
      $errorCallback(this: any, _e: unknown, info: { path: string }) { this.failed = `${this.failed}${info.path};`; },
    }),
    steps: [
      { label: "null（外す）", run: (a) => a.write((s) => { s.v = null; }) },
      { label: "数値（失敗）", run: (a) => a.write((s) => { s.v = 1; }) },
    ],
  },
  {
    name: "明示的なプロパティ .title と #prevent",
    html: `<wcs-state></wcs-state><div id="d" data-wcs=".title: t"></div><a id="a" href="#x" data-wcs="onclick#prevent: hit">go</a><p>{{ log }}</p>`,
    state: () => ({ t: "tt", log: "", hit(this: any, e: Event) { this.log = String(e.defaultPrevented); } }),
    steps: [
      { label: "クリック", run: (a) => a.click("#a") },
      { label: "title を変える", run: (a) => a.write((s) => { s.t = "uu"; }) },
    ],
  },
  // ---------------------------------------------------------------- stage 4: wc-bindable
  {
    name: "wc-bindable: 双方向のメンバー（初期は状態が勝つ・要素→状態・属性への反映）",
    html: `<wcs-state></wcs-state><conf-counter id="c" data-wcs="value: count"></conf-counter><p>{{ count }}</p>`,
    state: () => ({ count: 5 }),
    steps: [
      { label: "要素側で値が変わる", run: (a) => { a.call("#c", "userSet", 9); } },
      { label: "状態から書く", run: (a) => a.write((s) => { s.count = 12; }) },
      { label: "null", run: (a) => a.write((s) => { s.count = null; }) },
    ],
  },
  {
    name: "wc-bindable: 出力専用（要素の値が初期値になり、状態からは書かない）",
    html: `<wcs-state></wcs-state><conf-output id="o" data-wcs="status: st"></conf-output><p>{{ st }}</p>`,
    state: () => ({ st: "seed" }),
    steps: [
      { label: "要素がイベントを出す", run: (a) => { a.call("#o", "emitStatus", "busy"); } },
      { label: "状態から書く（要素には届かない）", run: (a) => a.write((s) => { s.st = "forced"; }) },
    ],
  },
  {
    name: "wc-bindable: 入力専用と属性への反映",
    html: `<wcs-state></wcs-state><conf-label id="l" data-wcs="labelText: title; data: payload"></conf-label>`,
    state: () => ({ title: "hello", payload: { id: 1 } }),
    steps: [
      { label: "書き換え", run: (a) => a.write((s) => { s.title = "bye"; s.payload = [1, 2]; }) },
      { label: "null で属性を外す", run: (a) => a.write((s) => { s.title = null; s.payload = null; }) },
    ],
  },
  {
    name: "wc-bindable: #init=element と #init=none",
    html: `<wcs-state></wcs-state><conf-output id="o" data-wcs="status#init=none: st"></conf-output><conf-counter id="c" data-wcs="value#init=element: count"></conf-counter><p>{{ st }}|{{ count }}</p>`,
    state: () => ({ st: "seed", count: 7 }),
    steps: [
      { label: "両方の要素がイベントを出す", run: (a) => { a.call("#o", "emitStatus", "x"); a.call("#c", "userSet", 3); } },
      { label: "状態から count", run: (a) => a.write((s) => { s.count = 40; }) },
    ],
  },
  {
    name: "command token: 状態から emit・DOM イベントから emit・複数の要素へ配る",
    html: `<wcs-state></wcs-state><conf-counter id="a" data-wcs="value: a; command.increment: $command.inc"></conf-counter><conf-counter id="b" data-wcs="value: b; command.increment: $command.inc; command.reset: $command.clear"></conf-counter><button id="btn" data-wcs="onclick: $command.clear">clear</button><p>{{ a }}|{{ b }}</p>`,
    state: () => ({
      a: 1, b: 10,
      $commandTokens: ["inc", "clear"],
      bump(this: any) { this.$command.inc.emit(2); },
    }),
    steps: [
      { label: "状態から inc(2)", run: (a) => a.write((s) => { s.bump(); }) },
      { label: "ボタンから clear", run: (a) => a.click("#btn") },
    ],
  },
  {
    name: "event token: $on で受ける（行の中は添字付き）",
    html: `<wcs-state></wcs-state><conf-notifier id="n" data-wcs="eventToken.created: made"></conf-notifier><ul><template data-wcs="for: rows"><li><conf-notifier data-wcs="eventToken.created: rowMade"></conf-notifier>{{ .name }}</li></template></ul><p>{{ log }}</p>`,
    state: () => ({
      log: "", rows: [{ name: "r0" }, { name: "r1" }],
      $eventTokens: ["made", "rowMade"],
      $on: {
        made(state: any, e: CustomEvent) { state.log = `${state.log}made:${e.detail};`; },
        rowMade(state: any, e: CustomEvent, i: number) { state.log = `${state.log}row${i}:${e.detail};`; },
      },
    }),
    steps: [
      { label: "ルートの要素が出す", run: (a) => { a.call("#n", "fire", "x"); } },
      { label: "2 行目の要素が出す", run: (a) => { a.call("li:nth-of-type(2) conf-notifier", "fire", "y"); } },
    ],
  },
  {
    name: "spread: 宣言されたプロパティと入力を一度に（後の明示バインディングが勝つ）",
    html: `<wcs-state></wcs-state><conf-fetch id="f" data-wcs="...: users; command.load: $command.load"></conf-fetch><conf-fetch id="g" data-wcs="...: users; url: altUrl"></conf-fetch><p>{{ users.value }}|{{ users.loading }}</p>`,
    state: () => ({
      users: { url: "/api/users", value: null, loading: false },
      altUrl: "/api/alt",
      $commandTokens: ["load"],
      go(this: any) { this.$command.load.emit(); },
    }),
    steps: [
      { label: "load", run: (a) => a.write((s) => { s.go(); }) },
      { label: "g も load（url は altUrl）", run: (a) => { a.call("#g", "load"); } },
    ],
  },
  // ---------------------------------------------------------------- stage 3 (filters) / stage 5 ($eq)
  {
    name: "$eqPath: id による選択は並べ替えと削除に追従する",
    html: `<wcs-state></wcs-state><ul><template data-wcs="for: items"><li data-wcs="class.sel: .selected; onclick: pick">{{ .id }}</li></template></ul><p>{{ selectedId }}</p>`,
    state: () => ({
      items: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
      selectedId: null as number | null,
      get "items.*.selected"() { return (this as any).$eqPath("selectedId", "items.*.id"); },
      pick(this: any, _e: Event, i: number) { this.selectedId = this[`items.${i}.id`]; },
    }),
    steps: [
      { label: "id 3 を選ぶ", run: (a) => a.click("li:nth-of-type(3)") },
      { label: "逆順", run: (a) => a.write((s) => { s.items = s.items.toReversed(); }) },
      { label: "先頭（id 4）を削除", run: (a) => a.write((s) => { s.items = s.items.toSpliced(0, 1); }) },
      { label: "id 1 を選ぶ", run: (a) => a.write((s) => { s.selectedId = 1; }) },
    ],
  },
  {
    name: "$eq: トップレベルの getter と、親オブジェクトの置き換え",
    html: `<wcs-state></wcs-state><div><template data-wcs="if: isAdmin"><b>admin</b></template></div><ul><template data-wcs="for: items"><li data-wcs="class.cur: .current">{{ .id }}</li></template></ul>`,
    state: () => ({
      role: "user",
      sel: { id: 2 },
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      get isAdmin() { return (this as any).$eq("role", "admin"); },
      get "items.*.current"() { return (this as any).$eq("sel.id", (this as any)["items.*.id"]); },
    }),
    steps: [
      { label: "role = admin", run: (a) => a.write((s) => { s.role = "admin"; }) },
      { label: "sel を置き換え", run: (a) => a.write((s) => { s.sel = { id: 3 }; }) },
      { label: "sel.id を書く", run: (a) => a.write((s) => { s["sel.id"] = 1; }) },
    ],
  },
  {
    name: "フィルタ: 左辺の入力フィルタと型付きリテラル",
    html: `<wcs-state></wcs-state><input id="i" data-wcs="value|int: n"><p>{{ n|add(1) }}|{{ kind }}|{{ done|eq(true) }}|{{ label|eq('true') }}</p><input type="radio" id="r" value="2" data-wcs="radio|int: pick"><p>{{ pick }}</p>`,
    state: () => ({ n: 1, done: true, label: "true", pick: 0, get kind() { return typeof (this as any).n; } }),
    steps: [
      { label: "42 を入力", run: (a) => a.input("#i", "42") },
      { label: "radio を選ぶ", run: (a) => a.click("#r") },
    ],
  },
  {
    name: "フィルタ: 書式系と空値",
    html: `<wcs-state></wcs-state><p id="t" data-wcs="attr.title: x|trim">{{ x|upper }}</p><p>{{ tags|join(', ') }}|{{ v|coalesce(0)|toFixed(1) }}|{{ name|defaults('anon')|capitalize }}</p>`,
    state: () => ({ x: " hi ", tags: ["a", "b"], v: 2.25, name: "" }),
    steps: [
      { label: "x = undefined, v = null", run: (a) => a.write((s) => { s.x = undefined; s.v = null; }) },
      { label: "name を入れる", run: (a) => a.write((s) => { s.name = "bob"; s.tags = ["x"]; }) },
    ],
  },
  {
    name: "list: 同じリストを 2 つの for で描く（先の方は if の中）",
    html: `<wcs-state></wcs-state><div><template data-wcs="if: showA"><ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul></template></div><ol><template data-wcs="for: items"><li>{{ .id }}:{{ .name }}</li></template></ol>`,
    state: () => ({ showA: true, items: items(2) }),
    steps: [
      { label: "追加", run: (a) => a.write((s) => { s.items = s.items.concat({ id: 3, name: "item 3" }); }) },
      { label: "items.1.name", run: (a) => a.write((s) => { s["items.1.name"] = "B"; }) },
      { label: "先の for を消す", run: (a) => a.write((s) => { s.showA = false; }) },
      { label: "消えた後で items.0.name", run: (a) => a.write((s) => { s["items.0.name"] = "A"; }) },
      { label: "消えた後で追加", run: (a) => a.write((s) => { s.items = s.items.concat({ id: 4, name: "item 4" }); }) },
      { label: "先の for を戻す", run: (a) => a.write((s) => { s.showA = true; }) },
      { label: "戻した後で items.2.name", run: (a) => a.write((s) => { s["items.2.name"] = "C"; }) },
      { label: "逆順", run: (a) => a.write((s) => { s.items = s.items.toReversed(); }) },
      { label: "全消去", run: (a) => a.write((s) => { s.items = []; }) },
      { label: "再作成", run: (a) => a.write((s) => { s.items = items(2); }) },
    ],
    differs: {
      reason: "3.3.0 の不具合（#320）: 同じリストを別の for も描いているとき、if で消して戻した for は、消えている間に増えた行を描かず、その後の並べ替えにも追従しない（Chromium でも同じ。for が 1 つだけなら起きない）。新エンジンは戻したときの一覧を描き、以後も追従する",
      dom: {
        "先の for を戻す": "<div><ul><li>A|</li><li>B|</li><li>item 3|</li><li>item 4|</li></ul></div><ol><li>1|:|A|</li><li>2|:|B|</li><li>3|:|item 3|</li><li>4|:|item 4|</li></ol>",
        "戻した後で items.2.name": "<div><ul><li>A|</li><li>B|</li><li>C|</li><li>item 4|</li></ul></div><ol><li>1|:|A|</li><li>2|:|B|</li><li>3|:|C|</li><li>4|:|item 4|</li></ol>",
        "逆順": "<div><ul><li>item 4|</li><li>C|</li><li>B|</li><li>A|</li></ul></div><ol><li>4|:|item 4|</li><li>3|:|C|</li><li>2|:|B|</li><li>1|:|A|</li></ol>",
      },
    },
  },
  {
    name: "wc-bindable: 行の中の双方向メンバー",
    html: `<wcs-state></wcs-state><ul><template data-wcs="for: rows"><li><conf-counter data-wcs="value: .n"></conf-counter>{{ .n }}</li></template></ul>`,
    state: () => ({ rows: [{ n: 1 }, { n: 2 }] }),
    steps: [
      { label: "状態から rows.1.n", run: (a) => a.write((s) => { s["rows.1.n"] = 20; }) },
      { label: "1 行目の要素側で値が変わる", run: (a) => { a.call("li:nth-of-type(1) conf-counter", "userSet", 9); } },
      { label: "1 行目を削除", run: (a) => a.write((s) => { s.rows = s.rows.toSpliced(0, 1); }) },
      { label: "残った行に状態から書く", run: (a) => a.write((s) => { s["rows.0.n"] = 7; }) },
    ],
  },
  {
    name: "wc-bindable: 行の中の出力専用メンバー",
    html: `<wcs-state></wcs-state><ul><template data-wcs="for: rows"><li><conf-output data-wcs="status: .st"></conf-output>{{ .st }}</li></template></ul>`,
    state: () => ({ rows: [{ st: "seed" }, { st: "s2" }] }),
    steps: [
      { label: "状態から rows.0.st（要素には届かない）", run: (a) => a.write((s) => { s["rows.0.st"] = "forced"; }) },
      { label: "2 行目の要素がイベントを出す", run: (a) => { a.call("li:nth-of-type(2) conf-output", "emitStatus", "busy"); } },
      { label: "1 行目を削除", run: (a) => a.write((s) => { s.rows = s.rows.toSpliced(0, 1); }) },
      { label: "残った行に状態から書く", run: (a) => a.write((s) => { s["rows.0.st"] = "again"; }) },
    ],
    differs: {
      reason: "3.3.0 の不具合（#319）: 行の中の出力専用メンバーの初期同期を、文書に入る前の断片の上で行って状態の木を見つけられず、for ごと描画に失敗する（Chromium でも同じ・\"No state tree found on this root for initial binding sync.\"）。新エンジンは出力専用の約束どおり、要素の値を初期値にし、状態からは書かない",
      dom: {
        initial: '<ul><li><conf-output :status="ready"></conf-output>ready|</li><li><conf-output :status="ready"></conf-output>ready|</li></ul>',
        "状態から rows.0.st（要素には届かない）": '<ul><li><conf-output :status="ready"></conf-output>forced|</li><li><conf-output :status="ready"></conf-output>ready|</li></ul>',
        "2 行目の要素がイベントを出す": '<ul><li><conf-output :status="ready"></conf-output>forced|</li><li><conf-output :status="busy"></conf-output>busy|</li></ul>',
        "1 行目を削除": '<ul><li><conf-output :status="busy"></conf-output>busy|</li></ul>',
        "残った行に状態から書く": '<ul><li><conf-output :status="busy"></conf-output>again|</li></ul>',
      },
    },
  },
  {
    name: "event: 行の中の入れ子・#stop・if の中・先頭要素が複数の行・外側の要素",
    html: `<wcs-state></wcs-state><ul data-wcs="onclick: outer"><template data-wcs="for: items"><li data-wcs="onclick: onLi"><b data-wcs="onclick: onB">{{ .name }}</b><template data-wcs="if: .flag"><i data-wcs="onclick: onI">i</i></template><em data-wcs="onclick#stop: onEm">stop</em></li><span data-wcs="onclick: onSpan">{{ .name }}-s</span></template></ul><p>{{ log }}</p>`,
    state: () => ({
      log: "",
      items: [{ name: "a", flag: true }, { name: "b", flag: false }],
      outer(this: any) { this.log += "outer;"; },
      onLi(this: any, _e: Event, i: number) { this.log += `li${i};`; },
      onB(this: any, _e: Event, i: number) { this.log += `b${i};`; },
      onI(this: any, _e: Event, i: number) { this.log += `i${i};`; },
      onEm(this: any, _e: Event, i: number) { this.log += `em${i};`; },
      onSpan(this: any, _e: Event, i: number) { this.log += `span${i};`; },
    }),
    steps: [
      { label: "1 行目の b", run: (a) => a.click("li:nth-of-type(1) b") },
      { label: "1 行目の if の中の i", run: (a) => a.click("li:nth-of-type(1) i") },
      { label: "2 行目の em（#stop）", run: (a) => a.click("li:nth-of-type(2) em") },
      { label: "2 行目の span（行の 2 つ目の先頭要素）", run: (a) => a.click("span:nth-of-type(2)") },
      { label: "2 行目の flag を立てる", run: (a) => a.write((s) => { s["items.1.flag"] = true; }) },
      { label: "2 行目の if の中の i", run: (a) => a.click("li:nth-of-type(2) i") },
      { label: "先頭行を削除して新しい 1 行目の b", run: (a) => { a.write((s) => { s.items = s.items.toSpliced(0, 1); }); } },
      { label: "削除後の 1 行目の b", run: (a) => a.click("li:nth-of-type(1) b") },
    ],
  },
  {
    name: "re-set: 状態を丸ごと差し替え、確立済みのバインディングを反映し直す",
    html: `<wcs-state></wcs-state><p id="t" data-wcs="class.on: on">{{ msg }}|{{ total }}</p><ul><template data-wcs="for: items"><li data-wcs="class.sel: .sel">{{ .name }}</li></template></ul><div><template data-wcs="if: show"><b>shown {{ msg }}</b></template><template data-wcs="else:"><i>hidden</i></template></div>`,
    state: () => ({
      msg: "a", on: false, show: true, pick: 0, items: items(2),
      get total() { return (this as any).items.length; },
      get "items.*.sel"() { return (this as any).$1 === (this as any).pick; },
    }),
    steps: [
      {
        label: "新しい状態へ差し替え（getter も別物）",
        run: (a) => a.reset({
          msg: "b", on: true, show: false, pick: 2, items: items(3),
          get total() { return `n=${(this as any).items.length}`; },
          get "items.*.sel"() { return (this as any).$1 === (this as any).pick; },
        }),
      },
      { label: "差し替え後の書き込み（依存は新しい getter から）", run: (a) => a.write((s) => { s.pick = 0; s.show = true; }) },
      { label: "差し替え後に一覧を置き換え", run: (a) => a.write((s) => { s.items = s.items.concat({ id: 9, name: "nine" }); }) },
    ],
  },
  (() => {
    // the same array instance handed to the re-set (rows are kept)
    let shared: any[] = [];
    const scenario: Scenario = {
      name: "re-set: 同じ配列のまま差し替える（行は保たれ、値は新しい状態から）",
      html: `<wcs-state></wcs-state><ul><template data-wcs="for: items"><li>{{ .name }}:{{ suffix }}</li></template></ul>`,
      state: () => {
        shared = items(3);
        return { items: shared, suffix: "x" };
      },
      steps: [
        { label: "同じ配列で suffix を変えて差し替え", run: (a) => a.reset({ items: shared, suffix: "y" }) },
        { label: "差し替え後に 1 行を書く", run: (a) => a.write((s) => { s["items.1.name"] = "two"; }) },
      ],
    };
    return scenario;
  })(),
  {
    name: "re-set: command token の購読と $on は新しい状態へ",
    html: `<wcs-state></wcs-state><conf-counter id="c" data-wcs="value: n; command.increment: $command.inc"></conf-counter><conf-notifier id="e" data-wcs="eventToken.created: made"></conf-notifier><p>{{ n }}|{{ log }}</p>`,
    state: () => ({
      n: 1, log: "",
      $commandTokens: ["inc"], $eventTokens: ["made"],
      $on: { made(state: any, e: CustomEvent) { state.log = `old:${e.detail}`; } },
      bump(this: any) { this.$command.inc.emit(1); },
    }),
    steps: [
      {
        label: "差し替え",
        run: (a) => a.reset({
          n: 10, log: "",
          $commandTokens: ["inc"], $eventTokens: ["made"],
          $on: { made(state: any, e: CustomEvent) { state.log = `new:${e.detail}`; } },
          bump(this: any) { this.$command.inc.emit(5); },
        }),
      },
      { label: "差し替え後に状態から command を出す", run: (a) => a.write((s) => { s.bump(); }) },
      { label: "差し替え後に要素が event token を出す", run: (a) => { a.call("#e", "fire", "z"); } },
    ],
  },
  {
    name: "re-set: 新しい状態に無いパス",
    html: `<wcs-state></wcs-state><p>{{ user.name }}|{{ count }}</p>`,
    state: () => ({ user: { name: "ann" }, count: 1 }),
    steps: [
      { label: "user の無い状態へ", run: (a) => a.reset({ count: 2 }) },
      { label: "user を書き足す", run: (a) => a.write((s) => { s.user = { name: "bob" }; }) },
    ],
    differs: {
      reason: "3.3.0 は新しい状態に無いパスの読みを失敗（`wcs/binding-path-missing`）として報告し、表示は古い値のまま残す。新エンジンのコアは無いパスを undefined として読み、空値の約束（B8）で空にする（表示と状態が食い違わない）。パスの欠落の診断は後付けの「診断」に入る（scope-classification の決定）",
      dom: {
        "user の無い状態へ": "<p>||2|</p>",
      },
    },
  },
  {
    name: "binding-path-missing: トップレベルの打ち間違いと、後からの書き足し",
    html: `<wcs-state></wcs-state><p>{{ cout }}|{{ count }}</p><ul><template data-wcs="for: itemz"><li>{{ . }}</li></template></ul>`,
    state: () => ({ count: 1 }),
    steps: [
      { label: "cout を書き足す", run: (a) => a.write((s) => { s.cout = 5; }) },
      { label: "itemz を書き足す", run: (a) => a.write((s) => { s.itemz = ["a", "b"]; }) },
    ],
    differs: {
      reason: "3.3.0 は状態に無いトップレベルのキーへの書き込みも失敗にする（書く前に旧値を読むため。README が約束するのは読みの失敗だけ）。新エンジンは読みを現行どおり失敗にし、書き込みではキーを作れる",
      dom: {
        "cout を書き足す": "<p>5|||1|</p><ul></ul>",
        "itemz を書き足す": "<p>5|||1|</p><ul><li>a|</li><li>b|</li></ul>",
      },
    },
  },
  {
    name: "$watch: スカラー・入れ子・同じ回の書き込み・同じ値",
    html: `<wcs-state></wcs-state><p>{{ log }}</p>`,
    state: () => ({
      flag: false, user: { name: "a" }, log: "",
      $watch: {
        flag(this: any, cur: unknown, prev: unknown) { this.log = `${this.log}flag:${prev}->${cur};`; },
        "user.name"(this: any, cur: unknown, prev: unknown) { this.log = `${this.log}name:${prev}->${cur};`; },
      },
    }),
    steps: [
      { label: "flag を立てる", run: (a) => a.write((s) => { s.flag = true; }) },
      { label: "user.name", run: (a) => a.write((s) => { s["user.name"] = "b"; }) },
      { label: "同じ値（発火しない）", run: (a) => a.write((s) => { s.flag = true; }) },
      { label: "同じ回に false → true（1 回だけ・prev は回の最初）", run: (a) => a.write((s) => { s.flag = false; s.flag = true; }) },
    ],
  },
  {
    name: "$watch: 行（for あり）の書き込みと要素の書き込み",
    html: `<wcs-state></wcs-state><ul><template data-wcs="for: items"><li>{{ .price }}</li></template></ul><p>{{ log }}</p>`,
    state: () => ({
      items: [{ price: 1 }, { price: 2 }], log: "",
      $watch: {
        "items.*.price"(this: any, cur: unknown, prev: unknown, i: number) { this.log = `${this.log}${i}:${prev}->${cur};`; },
      },
    }),
    steps: [
      { label: "items.1.price", run: (a) => a.write((s) => { s["items.1.price"] = 20; }) },
      { label: "要素の書き込み items.0", run: (a) => a.write((s) => { s["items.0"] = { price: 9 }; }) },
    ],
  },
  {
    name: "$watch: getter（先行評価）と連鎖",
    html: `<wcs-state></wcs-state><p>{{ log }}|{{ second }}</p>`,
    state: () => ({
      count: 1, second: 0, log: "",
      get double() { return (this as any).count * 2; },
      $watch: {
        double(this: any, cur: unknown, prev: unknown) { this.log = `${this.log}double:${prev}->${cur};`; this.second = cur; },
        second(this: any, cur: unknown, prev: unknown) { this.log = `${this.log}second:${prev}->${cur};`; },
      },
    }),
    steps: [
      { label: "count を 2 に", run: (a) => a.write((s) => { s.count = 2; }) },
      { label: "count を 5 に", run: (a) => a.write((s) => { s.count = 5; }) },
    ],
    differs: {
      reason: "3.3.0 は $watch のハンドラの中で書いたプリミティブの prev を落とす（second:undefined->4）。README の約束（その回の最初の書き込みの前の値、プリミティブを書いたとき）どおり、新エンジンは 0 を渡す",
      dom: {
        "count を 2 に": "<p>double:2->4;second:0->4;|||4|</p>",
        "count を 5 に": "<p>double:2->4;second:0->4;double:4->10;second:4->10;|||10|</p>",
      },
    },
  },
  {
    name: "$stream: fold・状態・依存での再開",
    html: `<wcs-state></wcs-state><p>{{ tokens }}|{{ $streamStatus.tokens }}</p>`,
    state: () => ({
      prompt: "a",
      $stream: {
        tokens: {
          args: (s: any) => s.prompt,
          source: async function* (p: string) { yield `${p}1`; yield `${p}2`; },
          fold: (acc: string, c: string) => acc + c,
          initial: "",
        },
      },
    }),
    steps: [
      { label: "prompt を変えて再開", run: (a) => a.write((s) => { s.prompt = "b"; }) },
    ],
  },
  {
    name: "$stream: ReadableStream と最新値・失敗",
    html: `<wcs-state></wcs-state><p>{{ ticker }}|{{ $streamStatus.ticker }}</p><p>{{ bad }}|{{ $streamStatus.bad }}</p>`,
    state: () => ({
      $stream: {
        ticker: {
          source: () => new ReadableStream({ start(c) { c.enqueue(1); c.enqueue(2); c.enqueue(3); c.close(); } }),
        },
        bad: {
          source: async function* () { yield "x"; throw new Error("boom"); },
          initial: "-",
        },
      },
    }),
  },
  {
    name: "$watch: 配列の置き換え（for あり）",
    html: `<wcs-state></wcs-state><ul><template data-wcs="for: items"><li>{{ .price }}</li></template></ul><p>{{ log }}</p>`,
    state: () => ({
      items: [{ price: 1 }, { price: 2 }], log: "",
      $watch: { "items.*.price"(this: any, cur: unknown, prev: unknown, i: number) { this.log = `${this.log}${i}:${prev}->${cur};`; } },
    }),
    steps: [
      { label: "1 行足した配列に置き換え", run: (a) => a.write((s) => { s.items = s.items.concat({ price: 3 }); }) },
    ],
  },
  {
    name: "$watch: for の無い行の監視",
    html: `<wcs-state></wcs-state><p>{{ log }}</p>`,
    state: () => ({
      items: [{ price: 1 }, { price: 2 }], log: "",
      $watch: { "items.*.price"(this: any, cur: unknown, prev: unknown, i: number) { this.log = `${this.log}${i}:${prev}->${cur};`; } },
    }),
    steps: [
      { label: "items.1.price", run: (a) => a.write((s) => { s["items.1.price"] = 20; }) },
      { label: "1 行足した配列に置き換え", run: (a) => a.write((s) => { s.items = s.items.concat({ price: 3 }); }) },
    ],
    differs: {
      reason: "3.3.0 は for も $listKeys も無いリストの添字付きパスへ書けず（ListIndex not found）、行の $watch も発火しない（README の「行の監視には $listKeys が要る」）。新エンジンの行の監視は自分でリストを同期するので、書き込みも発火も働く（承認済みの簡素化）",
      dom: {
        "items.1.price": "<p>1:2->20;|</p>",
        "1 行足した配列に置き換え": "<p>1:2->20;2:undefined->3;|</p>",
      },
    },
  },
  {
    name: "$listKeys: 取り直した配列で行を保ち、変わったフィールドだけ書く",
    html: `<wcs-state></wcs-state><ul><template data-wcs="for: items"><li>{{ .name }}|{{ .qty }}</li></template></ul><p>{{ log }}</p>`,
    state: () => ({
      items: [{ id: 1, name: "a", qty: 1 }, { id: 2, name: "b", qty: 2 }], log: "",
      $listKeys: { items: "id" },
      $watch: { "items.*.qty"(this: any, cur: unknown, prev: unknown, i: number) { this.log = `${this.log}${i}:${prev}->${cur};`; } },
    }),
    steps: [
      { label: "同じ値の取り直し（何も起きない）", run: (a) => a.write((s) => { s.items = [{ id: 1, name: "a", qty: 1 }, { id: 2, name: "b", qty: 2 }]; }) },
      { label: "id 2 の qty が変わり、id 3 が増える", run: (a) => a.write((s) => { s.items = [{ id: 1, name: "a", qty: 1 }, { id: 2, name: "b", qty: 5 }, { id: 3, name: "c", qty: 1 }]; }) },
      { label: "id 1 の name が落ちる", run: (a) => a.write((s) => { s.items = [{ id: 1, qty: 1 }, { id: 2, name: "b", qty: 5 }, { id: 3, name: "c", qty: 1 }]; }) },
      { label: "逆順で取り直す", run: (a) => a.write((s) => { s.items = [{ id: 3, name: "c", qty: 1 }, { id: 2, name: "b", qty: 5 }, { id: 1, qty: 1 }]; }) },
    ],
  },
  {
    name: "volume: データの接ぎ木と、根の getter からの読み",
    html: `<wcs-state></wcs-state><wcs-state mount="i18n" json='{"lang":"en","t":{"title":"Hello"}}'></wcs-state><h1>{{ i18n.t.title }}</h1><p>{{ i18n.lang }}|{{ label }}</p>`,
    state: () => ({ count: 1, get label() { return `${(this as any).count} ${(this as any)["i18n.lang"]}`; } }),
    steps: [
      { label: "i18n.lang を書く", run: (a) => a.write((s) => { s["i18n.lang"] = "ja"; }) },
      { label: "i18n.t を置き換える", run: (a) => a.write((s) => { s["i18n.t"] = { title: "こんにちは" }; }) },
      { label: "count を書く", run: (a) => a.write((s) => { s.count = 2; }) },
    ],
  },
  {
    name: "volume: 深いマウントパス",
    html: `<wcs-state></wcs-state><wcs-state mount="settings.cart" json='{"tax":10}'></wcs-state><p>{{ settings.cart.tax }}|{{ settings.theme }}</p>`,
    state: () => ({ settings: { theme: "dark" } }),
    steps: [
      { label: "settings.cart.tax を書く", run: (a) => a.write((s) => { s["settings.cart.tax"] = 8; }) },
    ],
  },
];
