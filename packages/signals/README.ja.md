# @wcstack/signals

`@wcstack/signals` は **signals ベースのきめ細かい(fine-grained)リアクティブコア**です。ランタイム依存ゼロ・buildless・標準ファースト。設計の背景は [`docs/signals-state-design.md`](../../docs/signals-state-design.md) を参照してください。

[`@wcstack/state`](../state/README.ja.md) が UI と状態を HTML のパス文字列で接続する(あなたのコードにリアクティブプリミティブは現れない)のに対し、`@wcstack/signals` はそれを望むケースのために逆の立場をとります。すなわち **リアクティブプリミティブを直接露出**します。DSL も `data-wcs` も無く、JavaScript で `signal()` / `computed()` / `effect()` を呼びます。両者は競合ではなく**補完関係**です — 同じエコシステムの、結合点の違いです。

公開 API は [TC39 Signals proposal](https://github.com/tc39/proposal-signals)(State / Computed / effect)の形に倣っています。実装は自前かつ極小で、将来ネイティブ実装や polyfill へ呼び出し側を変えずに差し替えられるようにしてあります。

## 同梱物

| モジュール | エントリ | 提供するもの |
|---|---|---|
| **リアクティブコア** | `@wcstack/signals` | `signal` / `computed` / `effect` / `createRoot` / `onCleanup` / `flushSync` |
| **非同期リソース** | `@wcstack/signals` | `resource` — 非同期プロデューサを `{ value, loading, error }` の三つ組リアクティブ値に(switchMap 的な cancel/restart) |
| **ストリームリソース** | `@wcstack/signals` | `streamResource` — 連続フロー(async iterable / `ReadableStream`)を 1 つのリアクティブ値に fold |
| **wc-bindable アダプタ** | `@wcstack/signals` | `bindNode`(properties→signal・`on` で event-token ストリーム・`bindInput` で入力書き戻し・`bindCommand` で command-token)＋ `nodeSource`(`resource` 向けのノード cancel ブリッジ) |
| **DOM レイヤ** | `@wcstack/signals/dom` | `h` / `render` / `Fragment` / `For` / `Index` / `SignalsElement`(コアも再エクスポート) |

## 設計を一息で

- **pull 検証型の三色マーキング**(Reactively / Solid 由来)。書き込みは直接の観測者を DIRTY、推移的な観測者を CHECK にし、effect は coalesce されたマイクロタスクで走ります。computed が**等しい**値に再計算された場合は伝播せず、下流の処理がスキップされます(equality short-circuit)。
- **きめ細かい `h`、VDOM なし。** `h(tag, props, ...children)` は**実 DOM を一度だけ**構築します。関数/signal として渡した prop や child は対象を絞った `effect` に配線され、そのバインディングだけが更新されます。**VDOM reconciler** は同梱しません。keyed list は `For` / `Index`(行を再利用・移動する配列 diff であって VDOM ではない)が担います。
- **所有権 = ライフサイクル。** `createRoot` や effect は、その実行中に生成されたすべての破棄処理(disposer)を集約します。サブツリーを破棄すれば、その effect・リスナ・リソースも破棄されます — リークしません。
- **IO はノード、リアクティビティはコア。** `bindNode` は wc-bindable な要素(例: `<wcs-fetch>`)を signal に変換します。要素側はバインディングの背後に signal がいることを一切知りません。

## インストール

```bash
npm install @wcstack/signals
```

または import map で buildless 利用(両エントリは 1 つのリアクティブコア chunk を共有 — [Buildless](#buildlessimport-map)参照):

```html
<script type="importmap">
{ "imports": {
    "@wcstack/signals": "https://esm.run/@wcstack/signals",
    "@wcstack/signals/dom": "https://esm.run/@wcstack/signals/dom"
} }
</script>
```

## クイックスタート

### 1. signal・computed・effect

```typescript
import { signal, computed, effect } from "@wcstack/signals";

const count = signal(0);
const doubled = computed(() => count.get() * 2);

effect(() => {
  console.log(`count=${count.peek()}, doubled=${doubled.get()}`);
});
// → "count=0, doubled=0" を出力

count.set(1); // 次のマイクロタスクで effect が再実行 → "count=1, doubled=2"
```

- `get()` は**読み取り + 追跡**(現在の effect/computed を依存として登録)。
- `peek()` は**追跡なしの読み取り**(依存エッジを作らない)。
- `effect` の再実行はマイクロタスクに coalesce されます。同期的に適用したい場合(例: テストで DOM を読み戻す)は `flushSync()` を呼びます。

### 2. リアクティブなカスタム要素

```typescript
import { signal, computed, h, SignalsElement } from "@wcstack/signals/dom";

class SignalCounter extends SignalsElement {
  count = signal(0);
  doubled = computed(() => this.count.get() * 2);

  render() {
    return h("div", { class: "counter" },
      h("button", { onClick: () => this.count.set(this.count.peek() - 1) }, "−"),
      h("output", null, () => String(this.count.get())),
      h("button", { onClick: () => this.count.set(this.count.peek() + 1) }, "+"),
      // `doubled` は computed: 2倍した「値」が変わったときだけ再描画される。
      h("span", { class: "muted" }, () => `×2 = ${this.doubled.get()}`),
    );
  }
}
customElements.define("signal-counter", SignalCounter);
```

`connectedCallback` が所有権ルートの下で `render()` をマウントし、`disconnectedCallback` がそこで生成された全 effect を破棄しマウント先をクリアします。サブクラスは `render()` だけを実装します。Shadow root を使うなら `getMountPoint()` をオーバーライドします。

### 3. 実 IO ノードを駆動する — signals ↔ `<wcs-fetch>`

```typescript
import { signal, computed, effect, createRoot, bindNode, NodeShape, h, render, For } from "@wcstack/signals/dom";

await customElements.whenDefined("wcs-fetch");
const fetchEl = document.getElementById("search-fetch");

// 任意: ノードのリアクティブサーフェスを型付けすると signals / set / command が型付く。
interface FetchShape extends NodeShape {
  signals: { value: Person[]; loading: boolean };
  inputs:  { url: string };
}
const bound = bindNode<FetchShape>(fetchEl); // descriptor は fetchEl.constructor.wcBindable から読む

const query  = signal("");
const people = computed(() => bound.signals.value.get() ?? []); // value: ReadSignal<Person[]> で型付き

createRoot(() => {
  // query → url: <wcs-fetch> は url 変化で自動 fetch しイベントを再 dispatch、
  // アダプタがそれを bound.signals.* に fold し戻す。高速入力すると進行中の
  // リクエストは abort される(FetchCore が古い方をキャンセル)。
  effect(() => {
    const q = query.get().trim();
    bound.set("url", q ? `/api/people?q=${encodeURIComponent(q)}` : "/api/people");
  });

  render(
    h("div", null,
      h("input", { type: "search", onInput: (e) => query.set(e.target.value) }),
      h("p", null, () => bound.signals.loading.get() ? "Loading…" : `${people.get().length} 件`),
      // keyed リスト: id ごとに安定した <li> を保ち、その場で reconcile(§6)。
      h("ul", null, For(() => people.get(), (p) => h("li", null, p.name), { key: (p) => p.id })),
    ),
    document.getElementById("search-app"),
  );
});
```

動作する完全版は [`examples/signals-live-search`](../../examples/signals-live-search/README.ja.md) にあります。

### 6. keyed リスト — `For` / `Index`

素のリアクティブ child(`() => items.map(render)`)は変更のたびにサブツリーを丸ごと再生成します。リストには `For`(値/同一性キー)か `Index`(位置キー)を使ってください。各行は安定した DOM 行として保たれ、その場で reconcile されるので、並び替えは行の再生成ではなく移動になります(行ごとの DOM・focus・入力状態を保持)。各行は自身の所有権スコープで走るため、削除された行はその effect だけを破棄します。

```typescript
import { signal, h, For, Index } from "@wcstack/signals/dom";

const todos = signal([{ id: 1, text: "a" }, { id: 2, text: "b" }]);

// For — `id` でキーイング。並び替えで行を再利用/移動。`each` は item と
// index アクセサ(行が移動するとインデックスが変わる)を受け取る。
h("ul", null,
  For(todos, (t, index) => h("li", null, () => `${index()}: ${t.text}`), { key: (t) => t.id }),
);

// Index — 位置でキーイング(プリミティブ配列向け)。`each` は item を
// アクセサ(スロットの値が変わる・スロット自体は不変)、index を固定値で受け取る。
const nums = signal([10, 20, 30]);
h("ul", null,
  Index(nums, (n) => h("li", null, () => String(n() * 2))),
);
```

- `For` のキー既定は値の同一性(`===`)。オブジェクトは `{ key }` を渡す。キーは一意必須(重複は throw)。位置が安定なプリミティブ配列には `Index`。
- `each` は**単一**の Node を返すこと(1 行 = 1 ノード)。

### 4. 非同期リソース(switchMap)

```typescript
import { signal, resource } from "@wcstack/signals";

const id = signal(1);
const user = resource(
  async (userId, signal) => (await fetch(`/api/users/${userId}`, { signal })).json(),
  { args: () => id.get() }, // ここで id を読むことで「変化したら再起動」が配線される
);

// user.value / user.loading / user.error は読み取り専用 signal。
id.set(2); // 進行中のリクエストを abort して新しく開始。
```

### 5. ストリームリソース(フローを fold)

```typescript
import { streamResource } from "@wcstack/signals";

// latest(デフォルト): value は最後のチャンクになる。
const latest = streamResource((args, signal) => openEventStream(signal));

// reduce: 蓄積する。`initial` は必須で、再起動時に value がリセットされる値。
const log = streamResource((args, signal) => openLogStream(signal), {
  fold: (acc, chunk) => [...(acc ?? []), chunk],
  initial: [],
});
// log.value / log.status ("idle"|"active"|"done"|"error") / log.error
```

## API リファレンス

### リアクティブコア(`@wcstack/signals`)

| エクスポート | シグネチャ | 備考 |
|---|---|---|
| `signal<T>` | `(initial: T, equals?) => WriteSignal<T>` | `get`(追跡あり) / `peek`(追跡なし) / `set`。既定の等価判定は `Object.is`。 |
| `computed<T>` | `(fn: () => T, equals?) => ReadSignal<T>` | 遅延・メモ化・equality short-circuit。実行毎に依存を再追跡(条件分岐の依存は剪定)。自分自身を読むと明示的な「循環依存」エラーを投げる。 |
| `effect` | `(fn: () => Cleanup \| void) => EffectHandle` | 初回は即時実行、以降は coalesce されたマイクロタスクで実行。cleanup を返すと再実行前と破棄時に走る。`handle.dispose()` で停止。 |
| `createRoot<T>` | `(fn: (dispose) => T) => T` | 新しい所有権スコープ。内部で生成された全てが `dispose` で破棄される。ルートは独立(囲みオーナーに自動破棄されない)。`fn` が throw した場合、途中まで構築したスコープを破棄してからエラーを伝播。 |
| `onCleanup` | `(fn: () => void) => void` | 現在のオーナーに破棄処理を登録。オーナーが無ければ no-op。 |
| `flushSync` | `() => void` | キュー済みの effect を今すぐ同期実行。 |

### DOM レイヤ(`@wcstack/signals/dom`)

| エクスポート | シグネチャ | 備考 |
|---|---|---|
| `h` | `(tag, props?, ...children) => Node` | `tag` はタグ文字列・`Component`・`Fragment`。関数/signal の prop と child はリアクティブ。`onXxx` prop はイベントリスナ。 |
| `render` | `(child, container) => Node` | child(fragment/配列/リアクティブを解決)を container に追加。 |
| `Fragment` | `symbol` | `h(Fragment, null, ...children)` でラッパ要素なしにグループ化。 |
| `For<T>` | `(list, each, options?) => ListView` | keyed リスト。`list` は signal または `() => T[]`、`each(item, index: () => number)` は単一 Node を返す、`options.key(item, i)` 既定は値の同一性。キーで行を再利用/移動し、削除行を dispose。 |
| `Index<T>` | `(list, each) => ListView` | 位置キーのリスト。`each(item: () => T, index: number)` は単一 Node を返す。スロット単位で行を再利用(スロットの値は signal で更新)し、末尾で grow/shrink。 |
| `SignalsElement` | `abstract` 基底(遅延 `extends HTMLElement`) | ライフサイクル基底。`render()` を実装、必要なら `getMountPoint()` を上書き。`HTMLElement` は遅延解決され、`./dom` モジュールは非 DOM 環境でも評価可能 — [SSR / 非DOM](#ssr--非dom-dom-エントリは-dom-無しで読み込める)参照。 |
| `createSignalsElement` | `() => SignalsElementClass` | `SignalsElement` 基底を(memoize して)呼び出し時に構築。DOM が無ければ分かりやすい Error を投げる。SSR セーフな基底取得手段。 |

`setProp` のルール: `style` は文字列またはオブジェクト(camelCase / kebab-case / `--custom` キー)を受け付ける。`class` / `className` は `class` **属性**として設定(SVG でも動く・`null`/`false` でクリア)。書き込み可能な DOM プロパティに解決するキーはプロパティ代入(`null`/`undefined` は `""` に正規化され、`id`/`src` 等の文字列プロパティがリテラル `"null"` ではなくクリアされる)、それ以外は属性(`true` → 空属性、`null`/`false` → 削除)。

### リソース(`@wcstack/signals`)

| エクスポート | 形 |
|---|---|
| `resource<T, A>(source, options?)` | `{ value, loading, error, dispose }` — `source(args, signal) => Promise<T> \| T` |
| `streamResource<T, C, A>(source, options?)` | `{ value, status, error, dispose }` — `source(args, signal) => AsyncIterable<C> \| ReadableStream<C> \| Promise<…>` |

両者共通: `options.args` はリアクティブな getter(そこで signal を読むと「変化したら再起動」が switchMap 方式で配線され、前のリクエストは `source` に渡される `AbortSignal` 経由で abort される)。`options.initial` は `value` の初期値。古いリクエストの遅延レスポンスは破棄される(`signal.aborted` で判定)。オーナー内で生成すれば、破棄時にリソースも自動 dispose される。

### wc-bindable アダプタ(`@wcstack/signals`)

```typescript
const bound = bindNode(target, descriptor?);

// element → signal
bound.signals.<propName>.get();          // 出力 properties を読み取り専用 signal(最新値)として
bound.on("propName", { fold?, initial? }); // event-token ストリーム: emit 毎に fold(既定 latest)

// signal → element
bound.set("inputName", value);           // 宣言済み input への書き込み(命令的)
bound.bindInput("inputName", someSignal); // リアクティブ書き戻し: signal を input に反映
bound.command("cmdName", ...args);       // 宣言済み command の呼び出し(命令的)
bound.bindCommand("cmdName", trigger, mapArgs?); // command-token: `trigger` が変化したら起動

bound.dispose();                         // 全リスナ/effect を detach
```

`descriptor` を省略すると `target.constructor.wcBindable` から読みます。アダプタは wc-bindable の4マッピングを担います: `signals[name]` は property の**状態ビュー**(等価ガードあり — 同値なら更新なし)、`on(name)` は同じイベントの**発生ビュー**(ストリーム — 同値でも*毎回*更新)で既定 latest fold。`bindInput` は signal を input に反映し、same-value ガード(`node[name] !== v`)で「書き込み→イベント再発火→書き込み」のループを断ちます。`bindCommand` は trigger が**変化**したとき command を起動(初期値では発火しない)、`mapArgs` で引数を整形。`set`/`bindInput` は未宣言 input を、`command`/`bindCommand` は未宣言(または非関数)command を拒否。`error` signal の初期値は `null` です。`dispose` 後はアダプタが**不活性(inert)**(signal/ストリーム停止・メソッドは例外)で、`dispose` は冪等。`bindInput`/`bindCommand` は binding ごとの disposer も返します。

#### 型付きサーフェス — `bindNode<NodeShape>`

`target` はプレーンな `EventTarget` です(indexing 用の内部キャストは公開シグネチャに**出さない** — 利用側の要素型を消さない)。オプションの `NodeShape` 型引数を渡すと結果全体が型付きになります。省略時は従来どおり全 `unknown` の後方互換形です。

```typescript
import { bindNode, NodeShape } from "@wcstack/signals";

interface FetchShape extends NodeShape {
  signals:  { value: Person[]; loading: boolean };       // propName → スナップショット値型
  inputs:   { url: string };                             // inputName → 設定可能な値型
  commands: { fetch: (url: string) => Promise<Person[]>; abort: () => void }; // commandName → シグネチャ
}

const bound = bindNode<FetchShape>(fetchEl, FetchCore.wcBindable);

bound.signals.value.get();        // ReadSignal<Person[]> — キー存在・値型が型チェックされる
bound.set("url", "/api/people");  // string が enforce(bound.set("url", 123) は型エラー)
bound.command("fetch", "/api");   // 引数/戻りが推論される(未知の command 名は型エラー)
```

型は**実行時に消去**されます — アダプタは従来どおり descriptor で名前を検証し挙動は不変で、型引数は呼び出し側を締めるだけです。

#### `nodeSource` — `resource` 向け cancel ブリッジ

`nodeSource(bound, run, { abort? })` は wc-bindable ノードから `resource` の source を生成します: resource の `AbortSignal` をノードの cancel コマンド(既定 `"abort"`)へ橋渡してから `run` に委譲。`resource({ args })` で包めば、abort コマンドを宣言する任意のノードが switchMap な cancel/restart を得ます — `args` 変化で進行中の呼び出しを abort(ノードの実 `AbortController` をキャンセル)して次を開始。ノード自身の value/loading/error は `bound.signals` のままです。

```typescript
import { signal, resource } from "@wcstack/signals";

const bound = bindNode(fetchEl);
const id = signal(1);
const r = resource(
  nodeSource(bound, (b, userId) => b.command("fetch", `/api/${userId}`)),
  { args: () => id.get() },
);
id.set(2); // ノードの abort コマンド経由で進行中の fetch を abort し、再 fetch
```

## JSX を使う(opt-in)

`h` は古典的な JSX ファクトリの形なので、JSX は**使えるが同梱しない** — オプトインは利用者の選択であり、buildless 経路を抜けることを意味します(JSX はトランスパイル必須)。パッケージが出荷するのは土台(`h` + `Fragment`)のみで、`.tsx` も `jsx-runtime` 型も含みません。

最小設定 — 自分の `tsconfig.json` で**classic** runtime を `h`/`Fragment` に向けます:

```jsonc
{
  "compilerOptions": {
    "jsx": "react",
    "jsxFactory": "h",
    "jsxFragmentFactory": "Fragment"
  }
}
```

各 `.tsx` ファイルで両方を import し(ファクトリがスコープに無いといけない)、JSX を書きます:

```tsx
import { h, Fragment, signal, render } from "@wcstack/signals/dom";

const count = signal(0);
const view = (
  <button onClick={() => count.set(count.peek() + 1)}>
    count: {() => count.get()}
  </button>
);
render(view, document.body);
```

引き継がれるもの / 引き継がれ**ない**ものに注意:

- **リアクティブ部分は依然として thunk/signal。** `{() => count.get()}`(または signal を渡す)が対象を絞った effect を配線します — 素の `{count.get()}` は一度読むだけで更新されません。JSX は構文を変えるだけで、リアクティビティモデルは変えません。
- **classic runtime のみ。** automatic runtime(`"jsx": "react-jsx"` + `jsxImportSource`)は**非対応**です — `./jsx-runtime` の export は存在しません(将来用に構想された未出荷の seam)。上記2つのファクトリオプション付きの `"jsx": "react"` を使ってください。
- **大半の JSX セマンティクスは contract に無い。** `ref`・`context`・controlled input は**未実装**で、JSX の `key` 属性もありません — `{items.map(...)}` は JSX 無しと同様に丸ごと再生成します。keyed リストには [`For`/`Index`](#6-keyed-リスト--for--index)を直接呼んでください(JSX 内でも同様に動きます)。

esbuild / tsc / Vite の設定例・検証用 `.tsx` 例・トラブルシュートを含む手順書は [`docs/signals-jsx-setup.md`](../../docs/signals-jsx-setup.md) にあります。

## Buildless(import map)

両エントリは**1 つの共有リアクティブコア chunk** を import する production の code-split バンドルとして出荷されます。よって buildless ページでも、ヘッドレスコアを `@wcstack/signals` から、DOM レイヤを `@wcstack/signals/dom` から import して**単一**のリアクティブインスタンス(1 つの追跡コンテキスト)を得られます。両 specifier をマップしてください。共有 `core-*.esm.js` chunk は相対パスで解決されるので `dist/` 全体を配信(または対応 CDN を使用)してください。バンドラ利用者はモジュールグラフで重複排除されるためどちらのエントリでも構いません。

## 安定性(Stability)

パッケージのバージョンは **1.x** ですが、公開サーフェスは **安定(stable)** なコアと **発展中 / 実験的(evolving / experimental)** なエッジに分かれています。破壊的変更は実験的な側に集中しており、安定サーフェスは semver に従います。

| API グループ | エクスポート | 安定度 |
|---|---|---|
| **リアクティブコア** | `signal` / `computed` / `effect` / `createRoot` / `onCleanup` / `flushSync` | **Stable** — semver 保護。TC39 Signals proposal の形に倣う。 |
| **エラー契約** | `DisposedError` / `isDisposedError` | **Stable** — ブランドベース・realm セーフ。 |
| **リソース** | `resource` / `streamResource` | **Stable**(概ね)。形は確定済み。ただし `streamResource` の協調キャンセル契約に注意(`source` は `AbortSignal` を必ず honor すること — [注意・制限](#注意制限)参照)。 |
| **wc-bindable アダプタ** | `bindNode` / `nodeSource` | **Evolving / experimental** — 実行時挙動は安定だが、**型サーフェス**(`bindNode<NodeShape>`・`NodeShape`)はまだ調整余地あり。 |
| **DOM レイヤ** | `h` / `render` / `Fragment` / `For` / `Index` / `setProp` / `SignalsElement` / `createSignalsElement` / `ListView` | **Evolving / experimental** — 今すぐ使えるが、安定昇格までにシグネチャや要素ファクトリの形が変わりうる。 |
| **開発モード** | `globalThis.__WCS_DEV__` と各警告コード | **Experimental** — 診断専用。警告の集合や文言はいつでも変わりうる。本番では一切動かない。 |

**deprecation ポリシー。** **1.x** の系列内では、**安定**な API は後方互換を維持します: 非互換な変更は、導入の最低 1 マイナーリリース前に deprecation として告知します。**evolving / experimental** とマークされた API は、マイナーリリースで変わりうる(シグネチャ・型の形・警告文言)ので、現在の形に依存する場合は厳密なバージョンを pin してください。

## 注意・制限

- **JSX は形だけで同梱しない。** `h` は古典的な JSX ファクトリです。JSX を使いたい利用者は自分の tsconfig で `jsxFactory: "h"` + `jsxFragmentFactory: "Fragment"` を設定します(ビルドステップへのオプトイン)。buildless 経路は `h` を直接呼ぶことです。
- **リストは素のリアクティブ child でなく `For`/`Index` を。** 関数/signal の child は*挿入点*で、実行のたびに以前生成した全ノードを除去し新ノードを挿入します。条件描画や小さい動的領域には十分ですが、リスト(`() => items.map(render)`)では任意の変更でサブツリー全体を再生成し、DOM 再生成コストはサイズに比例、行ごとの状態(focus・編集中の `<input>`/`<select>`・scroll・selection)が失われます。keyed 再利用には [`For`/`Index`](#6-keyed-リスト--for--index)を使ってください。各行は単一 Node です。
- **backpressure なし(stream)。** fold の結果が*そのまま*バッファです — 需要はプロデューサに伝わりません。無限ストリームには fold を有界に(latest / count / window)してください。無制限の蓄積は罠です。
- **協調的キャンセル — `source` は `AbortSignal` を必ず honor すること(強い契約)。** これが switchMap の restart/dispose を駆動します。`ReadableStream` は abort 時に `reader.cancel()` で**完全に**巻き戻されます(park した `read()` も強制解決)。プレーンな `AsyncIterable` / async generator は**部分的に**救済されます: abort 時にアダプタが iterator の `return()` を呼び `finally`/クリーンアップを起動しますが、park した `await`(`signal` を*無視*して次の `yield` 前で停止)は外から強制巻き戻しできず、`return()` は generator が次に再開したときに初めて効きます。永久に park して `signal` を一切観測しない generator は `consume()` タスクをリークさせます。**必ず `source` 内で `signal` を観測**してください(例: `signal.aborted` で reject/break)。
- **`setProp` は主要な属性↔プロパティのケースをカバー(全てではない)。** 小さなリマップ表で `for`→`htmlFor`・`tabindex`→`tabIndex`・`colspan`/`rowspan` 等を処理し、read-only な DOM メンバーは `setAttribute` に退避、SVG タグは SVG 名前空間で生成し `class` は常に属性として設定(SVG でも動く)します。`style` オブジェクトは camelCase・kebab-case・CSS カスタムプロパティ(`--x`)を受け付けます。DOM プロパティへの `null`/`undefined` は `""` に正規化(`id`/`src` 等が `"null"` でなくクリア)されますが、`false` はそのまま据え置きます — boolean プロパティ(`disabled = false`)では正しいので、*文字列*プロパティにリアクティブな `false` が流れると `"false"` になります。この `""` 正規化は**オブジェクト/配列を取るカスタム要素プロパティ**にも及びます — リアクティブな `null` は `null` でなく `""` になるので、クリアするには空配列/空オブジェクトを渡してください。`""` を渡すか thunk でガードを。`class` は特別扱い済み(`false` → `""`)。
- **依存する値を(毎回変えながら)書き込む effect はループする。** 暴走フラッシュは反復回数の上限で打ち切られ、ハングせずに throw します。
- **v1 スコープ外。** SSR/hydration(マークアップでなく JS から初期化)・深い/proxy リアクティビティ(パスベースの深い追跡は `@wcstack/state` を使用)・ストリーム backpressure は意図的に非対応です — 設計ドキュメント参照。

## ヘッドレス利用

リアクティブコアは DOM 非依存です — `signal` / `computed` / `effect` / `resource` / `streamResource` / `bindNode` / `nodeSource` はすべてプレーンな JS(Node・worker・テスト)で動きます。`document` に触れるのは `/dom` エントリ(`h` / `For` / `Index` / `SignalsElement`)だけです。

### SSR / 非DOM: `./dom` エントリは DOM 無しで読み込める

2 つのエントリは**評価時**の要件が異なります:

- **`.` エントリ(`@wcstack/signals`)** — 完全に非 DOM。SSR・Node・Web Worker で DOM グローバル無しに評価・実行できます。
- **`./dom` エントリ(`@wcstack/signals/dom`)** — DOM 無しでも**評価**できます: SSR 前処理(や worker)でヘッドレス再エクスポート目的に import しても `ReferenceError: HTMLElement is not defined` で落ちません。DOM に触れる*サーフェス* — `h` / `render` / `For` / `Index` と `SignalsElement` 基底 — は実際に**使用**する時点で DOM グローバルを**要求**します。

`SignalsElement` は `HTMLElement` を遅延解決します: 基底クラスはモジュールロード時ではなく初回のサブクラス化/使用時に構築されます。よってブラウザでは `class X extends SignalsElement {}` が従来どおり動き、非 DOM 文脈での `import "@wcstack/signals/dom"` も安全です。両環境で動くコードでは基底を明示取得する `createSignalsElement()` を使ってください — 呼び出し時に(memoize して)基底を構築し、`HTMLElement` が無ければ生の `ReferenceError` ではなく**分かりやすい Error** を投げます:

```typescript
import { createSignalsElement } from "@wcstack/signals/dom";

const Base = createSignalsElement();          // DOM が無ければ分かりやすい Error
class MyEl extends Base { protected render() { /* … */ } }
```

## 対応ブラウザ / ランタイム

- **言語ターゲット: ES2022。** 出荷バンドルはモダン構文(private class field・`??`・top-level `const`/`class`)とランタイム機能を使います: `queueMicrotask`(effect スケジューリング)・`AbortController` / `AbortSignal`(`resource` / `streamResource` のキャンセル)・`WeakMap` / `WeakSet`(`bindNode` / DOM キャッシュ)、そして `streamResource` のみ `ReadableStream` + async iteration。
- **最低ブラウザ(evergreen):** Chrome / Edge **94+**・Firefox **90+**・**Safari 16.4+**(現実的な下限 — `ReadableStream` の async iteration・Custom Elements・private field 対応がこのあたりで揃う)。Custom Elements(`SignalsElement`)には実 DOM が必要ですが、それ以外は DOM 無しで動きます。
- **2 エントリ・2 環境。** `.` エントリ(`@wcstack/signals`: コア / `resource` / `streamResource` / `bindNode` / `nodeSource`)は**非 DOM** — SSR・Node・Web Worker で動きます。`./dom` エントリ(`@wcstack/signals/dom`: `h` / `render` / `For` / `Index` / `SignalsElement`)も DOM 無しで**評価**できるようになりました(SSR 前処理での import で落ちない)が、DOM に触れるサーフェスは使用時に DOM グローバル(`document`・`HTMLElement`)を要求します。[SSR / 非DOM](#ssr--非dom-dom-エントリは-dom-無しで読み込める)参照。

## バンドルサイズ

ランタイム依存ゼロ。minify 済みバンドルの gzip 実測値:

| エントリ | gzip |
|---|---|
| 共有リアクティブコア chunk(`core-*.esm.min.js`) | **≈ 2.5 KB** |
| `./dom` レイヤ chunk(`dom.esm.min.js`・共有コアの上乗せ分) | **≈ 2.1 KB** |

公開される両エントリは**1 つ**の共有コア chunk を import する([Buildless](#buildlessimport-map)参照)ので、両方使うページでもコアの分は一度だけです。`package.json` は `"sideEffects": false` を宣言するので、import しないものはバンドラが tree-shake で除去します。

## 開発モード(診断)

一部の故障は**本番では黙って壊れます** — 画面が静かに更新停止する、effect がリークする、など。**opt-in の開発モード**でこれらを `console.warn` 診断として可視化できます。**デフォルト無効**で本番コストはゼロ(各警告は実行時ガードの背後にあり、モジュールトップレベルで重い初期化をしません)。`"sideEffects": false` なのでバンドラが tree-shake で落とせます。

診断したいコードが走る**前**にグローバルフラグを立てて有効化します:

```html
<script>globalThis.__WCS_DEV__ = true;</script>
```

フラグは呼び出し時に参照されるので、リビルドなしにデバッグセッション中だけ有効化できます。同一警告は**一度だけ**出力(dedupe)し、コンソールの洪水を防ぎます。

警告一覧:

| コード | 発生条件 | 意味 |
| --- | --- | --- |
| `DUPLICATE_KEY` | `For` に同一キーの item が 2 つ。 | レンダリングが**throw**し(本番挙動は不変)リストが更新停止。dev 警告は重複キーと index を示し、静かな「更新停止」症状を診断可能にします。 |
| `NON_PRIMITIVE_KEY` | `For` を `key` 未指定で使い、item がオブジェクト/関数。 | item の参照同一性がキーになるがレンダ毎に変わる — 全行が作り直され行ごとの状態が失われます。`{ key: item => item.id }` を渡してください。 |
| `NULLISH_KEY` | `For` のキーが `null` / `undefined` / `NaN`。 | `SameValueZero` で衝突し、該当行が静かにマージ/脱落します。安定した一意キーを与えてください。 |
| `UNOWNED_EFFECT` | owner なしで `effect(...)` を生成。 | 誰にも dispose されず、購読ごとリークします。`createRoot(dispose => …)` か `SignalsElement` の `render()` 配下で使ってください。 |
| `UNOWNED_INSERT` | owner なしで reactive child(`h("div", null, () => …)`)を挿入。 | 更新 effect が dispose されずリークしうる。`createRoot` / `SignalsElement` 配下でマウントしてください。 |
| `ORPHAN_CLEANUP` | owner 外で `onCleanup(...)` を呼ぶ。 | no-op になり cleanup が実行されません。effect / `createRoot` / `SignalsElement` の `render()` 内で呼んでください。 |
| `REACTIVE_CYCLE` | 暴走サイクルガード(`MAX_FLUSH_ITERATIONS`)が発火。 | dev 時は throw する `Error` メッセージに、最終パスで再実行され続けた effect 群とその生成スタックを付加し、サイクルの原因 effect を特定できます。 |

## エラーハンドリング契約

- **effect / computed の例外は隔離され、伝播しない。** `effect` 本体(または flush 中に再計算される `computed`)からの throw は、存在すれば `globalThis.reportError` に渡され(window の `error` イベント dispatch / ログ出力をタスクを止めずに行う)、無ければ `console.error` にフォールバックします。**再 throw されません**(ドレインを中断し兄弟 effect を取りこぼすため)し、**黙って握りつぶしません**(バグを隠すため)。ノードは `CLEAN` に落ちるので、一時的な throw で DIRTY 固着せず、次の依存変化で再実行されます。
- **flush から唯一エスケープする throw** は暴走サイクルガードです: 依存する signal を毎回別値で書き換える effect は反復上限(`MAX_FLUSH_ITERATIONS`)で打ち切られ、超過時はキューを破棄して `Error` を throw します — ページがハングする代わりにバグを表面化させます。
- **直接の `get()` / `peek()`**(flush 外)は依然として*その*呼び出し元に throw します — 隔離はスケジュールされたドレインに対してのみで、自分で行う同期読みには適用されません。
- **`DisposedError` / `isDisposedError`。** `BoundNode` の変更系メソッド(`on` / `set` / `bindInput` / `command` / `bindCommand`)は `dispose()` 後に `DisposedError` を throw するので、use-after-dispose は黙らず気付けます。`instanceof` より `isDisposedError(err)` を推奨します(ブランドベースなので、バンドラがクラスを realm 間で複製しても正しく判定できる)。teardown 順の競合を頑健にするのに使えます — dispose 由来の throw だけ握りつぶし、他のエラーは表面化させます:

  ```typescript
  import { isDisposedError } from "@wcstack/signals";

  try {
    bound.command("abort");
  } catch (err) {
    if (!isDisposedError(err)) throw err; // teardown 中は想定内。無視する
  }
  ```

## 開発

```bash
npm run build            # clean → tsc → rollup(index + dom の 2 エントリ)
npm test                 # vitest run
npm run test:coverage    # カバレッジ(閾値 100/100/100/100)
npm run lint             # eslint src
```

## ライセンス

MIT
