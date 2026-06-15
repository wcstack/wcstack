# @wcstack/signals

> **ステータス: PoC (v0.0.0・未公開)。** このパッケージは wcstack に対する別系統のリアクティビティを検証するものです。デモとテストスイートを駆動できる程度に API は固まっていますが、まだ npm には公開していません。設計の背景は [`docs/signals-state-design.md`](../../docs/signals-state-design.md) を参照してください。

`@wcstack/signals` は **signals ベースのきめ細かい(fine-grained)リアクティブコア**です。ランタイム依存ゼロ・buildless・標準ファースト。

[`@wcstack/state`](../state/README.ja.md) が UI と状態を HTML のパス文字列で接続する(あなたのコードにリアクティブプリミティブは現れない)のに対し、`@wcstack/signals` はそれを望むケースのために逆の立場をとります。すなわち **リアクティブプリミティブを直接露出**します。DSL も `data-wcs` も無く、JavaScript で `signal()` / `computed()` / `effect()` を呼びます。両者は競合ではなく**補完関係**です — 同じエコシステムの、結合点の違いです。

公開 API は [TC39 Signals proposal](https://github.com/tc39/proposal-signals)(State / Computed / effect)の形に倣っています。実装は自前かつ極小で、将来ネイティブ実装や polyfill へ呼び出し側を変えずに差し替えられるようにしてあります。

## 同梱物

| モジュール | エントリ | 提供するもの |
|---|---|---|
| **リアクティブコア** | `@wcstack/signals` | `signal` / `computed` / `effect` / `createRoot` / `onCleanup` / `flushSync` |
| **非同期リソース** | `@wcstack/signals` | `resource` — 非同期プロデューサを `{ value, loading, error }` の三つ組リアクティブ値に(switchMap 的な cancel/restart) |
| **ストリームリソース** | `@wcstack/signals` | `streamResource` — 連続フロー(async iterable / `ReadableStream`)を 1 つのリアクティブ値に fold |
| **wc-bindable アダプタ** | `@wcstack/signals` | `bindNode` — 任意の wc-bindable IO ノードの properties を signal 化 |
| **DOM レイヤ** | `@wcstack/signals/dom` | `h` / `render` / `Fragment` / `SignalsElement`(コアも再エクスポート) |

## 設計を一息で

- **pull 検証型の三色マーキング**(Reactively / Solid 由来)。書き込みは直接の観測者を DIRTY、推移的な観測者を CHECK にし、effect は coalesce されたマイクロタスクで走ります。computed が**等しい**値に再計算された場合は伝播せず、下流の処理がスキップされます(equality short-circuit)。
- **きめ細かい `h`、VDOM なし。** `h(tag, props, ...children)` は**実 DOM を一度だけ**構築します。関数/signal として渡した prop や child は対象を絞った `effect` に配線され、そのバインディングだけが更新されます。**VDOM reconciler** は同梱しません — これは keyed list プリミティブが無いという意味では*ありません*(下の list 制約を参照)。key で行を再利用する `For(items, keyFn, render)` は配列 diff であって VDOM ではなく、本エントリへの追加を予定しています。
- **所有権 = ライフサイクル。** `createRoot` や effect は、その実行中に生成されたすべての破棄処理(disposer)を集約します。サブツリーを破棄すれば、その effect・リスナ・リソースも破棄されます — リークしません。
- **IO はノード、リアクティビティはコア。** `bindNode` は wc-bindable な要素(例: `<wcs-fetch>`)を signal に変換します。要素側はバインディングの背後に signal がいることを一切知りません。

## インストール

```bash
# 未公開のためローカルでビルド:
cd packages/signals && npm install && npm run build
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
import { signal, computed, effect, createRoot, bindNode, h, render } from "@wcstack/signals/dom";

await customElements.whenDefined("wcs-fetch");
const fetchEl = document.getElementById("search-fetch");
const bound = bindNode(fetchEl); // descriptor は fetchEl.constructor.wcBindable から読む

const query  = signal("");
const people = computed(() => bound.signals.value.get() ?? []);

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
      h("ul", null, () => people.get().map((p) => h("li", null, p.name))),
    ),
    document.getElementById("search-app"),
  );
});
```

動作する完全版は [`examples/signals-live-search`](../../examples/signals-live-search/README.ja.md) にあります。

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
| `SignalsElement` | `abstract class extends HTMLElement` | ライフサイクル基底。`render()` を実装、必要なら `getMountPoint()` を上書き。 |

`setProp` のルール: `style` は文字列またはオブジェクトを受け付ける。`class` / `className` は `className` にマップ(`null`/`false` でクリア)。DOM プロパティとして存在するキーはプロパティ代入(`null`/`undefined` は `""` に正規化され、`id`/`src` 等の文字列プロパティがリテラル `"null"` ではなくクリアされる)、それ以外は属性(`true` → 空属性、`null`/`false` → 削除)。

### リソース(`@wcstack/signals`)

| エクスポート | 形 |
|---|---|
| `resource<T, A>(source, options?)` | `{ value, loading, error, dispose }` — `source(args, signal) => Promise<T> \| T` |
| `streamResource<T, C, A>(source, options?)` | `{ value, status, error, dispose }` — `source(args, signal) => AsyncIterable<C> \| ReadableStream<C> \| Promise<…>` |

両者共通: `options.args` はリアクティブな getter(そこで signal を読むと「変化したら再起動」が switchMap 方式で配線され、前のリクエストは `source` に渡される `AbortSignal` 経由で abort される)。`options.initial` は `value` の初期値。古いリクエストの遅延レスポンスは破棄される(`signal.aborted` で判定)。オーナー内で生成すれば、破棄時にリソースも自動 dispose される。

### wc-bindable アダプタ(`@wcstack/signals`)

```typescript
const bound = bindNode(target, descriptor?);
bound.signals.<propName>.get(); // 出力 properties を読み取り専用 signal として
bound.set("inputName", value);  // 宣言済み input への書き込み
bound.command("cmdName", ...args); // 宣言済み command の呼び出し
bound.dispose();                // 全 property リスナを detach
```

`descriptor` を省略すると `target.constructor.wcBindable` から読みます。`set` は未宣言の input を、`command` は未宣言(または非関数)の command を拒否します。`dispose` 後はアダプタが**不活性(inert)**になります: property signal の更新が止まり、`set`/`command` は例外を投げます(use-after-dispose)— 未宣言名の拒否と一貫した挙動です。`dispose` は冪等です。

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
- **大半の JSX セマンティクスは contract に無い。** `key`・`ref`・`context`・controlled input は**未実装**です。特に keyed list 再利用は無い(下の list 制限を参照)ので、`{items.map(...)}` は JSX 無しと同様に丸ごと再生成します。

esbuild / tsc / Vite の設定例・検証用 `.tsx` 例・トラブルシュートを含む手順書は [`docs/signals-jsx-setup.md`](../../docs/signals-jsx-setup.md) にあります。

## 注意・制限(PoC)

- **buildless の単一エントリ規則。** buildless ページ(import map)では**すべて**を 1 つのエントリから import してください — `@wcstack/signals/dom` はコアを再エクスポートします。`@wcstack/signals` と `@wcstack/signals/dom` の**両方**のバンドルを読み込むと、リアクティブコアが**2 つ**生成され(追跡コンテキスト等のモジュールグローバルはバンドル単位)、境界をまたいだリアクティビティが静かに壊れます。バンドラ利用者はモジュールグラフで重複排除されるためどちらのエントリでも構いません。
- **JSX は形だけで同梱しない。** `h` は古典的な JSX ファクトリです。JSX を使いたい利用者は自分の tsconfig で `jsxFactory: "h"` + `jsxFragmentFactory: "Fragment"` を設定します(ビルドステップへのオプトイン)。buildless 経路は `h` を直接呼ぶことです。
- **backpressure なし(stream)。** fold の結果が*そのまま*バッファです — 需要はプロデューサに伝わりません。無限ストリームには fold を有界に(latest / count / window)してください。無制限の蓄積は罠です。
- **協調的キャンセル。** `ReadableStream` は abort 時に `reader.cancel()` で強制的に巻き戻されます。`AbortSignal` を無視して park する(次の `yield` の前で停止する)プレーンな async iterable は強制巻き戻しできません — `source` 内で signal を honor してください。
- **`setProp` は完全な属性↔プロパティの型テーブルを持たない。** DOM プロパティへの `null`/`undefined` は `""` に正規化されます(`id`/`src` 等の文字列プロパティが `"null"` ではなくクリアされる)が、`false` はそのまま据え置きます — boolean プロパティ(`disabled = false`)では正しいので、*文字列*プロパティにリアクティブな `false` が流れると `"false"` になります。その場合は `""` を渡すか thunk でガードしてください。`class` は特別扱い済み(`false` → `""`)です。
- **リアクティブ children は丸ごと再生成 — まだ keyed 再利用は無い。** 関数/signal の child は*挿入点*です: 実行のたびに以前生成した**全**ノードを除去し、新たに解決したノードを挿入します。リスト(`() => items.get().map(render)`)ではこれが任意の変更で `<ul>` 本体全体を再生成することを意味し、DOM 再生成コストはリストサイズに比例し、行ごとの UI 状態(編集中のインライン `<input>`/`<select>`、focus、scroll、selection、transition)は失われます。条件描画や小さい動的領域には十分ですが、**大きい/インタラクティブなリストの production 解ではありません**。key で diff して行を再利用/移動(focus と入力状態を保持)する keyed `For(items, keyFn, render)` を追加予定です。それまではリアクティブなリストを小さく/安定に保つか、揮発する部分が再生成サブツリーの内側に入らないよう分割してください。
- **依存する値を(毎回変えながら)書き込む effect はループする。** 暴走フラッシュは反復回数の上限で打ち切られ、ハングせずに throw します。

## ヘッドレス利用

リアクティブコアは DOM 非依存です — `signal` / `computed` / `effect` / `resource` / `streamResource` / `bindNode` はすべてプレーンな JS(Node・worker・テスト)で動きます。`document` に触れるのは `/dom` エントリだけです。

## 開発

```bash
npm run build            # clean → tsc → rollup(index + dom の 2 エントリ)
npm test                 # vitest run
npm run test:coverage    # カバレッジ(閾値 100/97/100/100)
npm run lint             # eslint src
```

## ライセンス

MIT
