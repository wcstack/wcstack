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
];
