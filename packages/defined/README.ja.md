# @wcstack/defined

`@wcstack/defined` は wcstack エコシステム向けのヘッドレスなカスタム要素 readiness コンポーネントです。

視覚的な UI ウィジェットではありません。
`@wcstack/permission` がブラウザの許可状態をリアクティブな state に変えるのと同じように、「これらのカスタム要素はもう登録されたか?」をリアクティブな state に変える **非同期プリミティブノード** です。

`@wcstack/state` と組み合わせると、`<wcs-defined>` はパス契約で直接バインドできます:

- **入力サーフェス**: `tags`、`mode`、`timeout`
- **出力 state サーフェス**: `defined`、`pending`、`missing`、`count`、`total`、`error`

これにより、readiness に応じた UI（ロードゲート・スケルトン・遅延ロード失敗フォールバック）を、UI 層で `customElements.whenDefined()` チェーンや timeout の配線を書かずに、HTML 上で宣言的に表現できます。

`@wcstack/defined` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core**（`DefinedCore`）が各タグの `whenDefined()` を待ち、`mode` で集約し、timeout を駆動
- **Shell**（`<wcs-defined>`）がその state を DOM 属性とライフサイクルに接続
- **Binding Contract**（`static wcBindable`）が観測可能な `properties` を宣言（そして意図的に **コマンドを持たない**）

## なぜ存在するか — そして CSS `:defined` で足りないのか

未定義要素の FOUC は、CSS が宣言的かつゼロ JS で既に解決しています:

```css
my-widget:not(:defined) { visibility: hidden; }
```

つまり、未アップグレード要素を隠すだけなら **CSS を使えばよく**、本パッケージは不要です。`<wcs-defined>` は `:defined` にできないことで存在価値を持ちます:

- **timeout による失敗検出。** 動的 import（例: `@wcstack/autoloader`）で読み込まれるカスタム要素のモジュールがロード失敗すると、`whenDefined()` は *永久に* 未解決のままになります。CSS は隠し続けることしかできません。`timeout` があれば当該タグは `missing` に落ち、ロード失敗が観測可能な state（`missing.length > 0`）になり、本物のエラー表示を出せます。
- **複数タグの集約。** *すべて*（`mode="all"`）または *いずれか*（`mode="any"`）を 1 要素で待てます。
- **readiness を reactive state として。** 条件レンダリング・ゲート・進捗（`count` / `total`）を駆動でき、スタイリングだけに留まりません。

`<wcs-defined>` は一方向の **要素 → state** 監視ノードです。登録を *観測する* だけで、何かを *定義する* ことはありません。`<wcs-permission>` と同様に **コマンドを一切持たず**、command-token は適用されず event-token のみが成立します。シグナルは **単調（monotonic）**（一度定義されたタグは定義済みのまま）で、state は終端的です。すべてのタグが解決するか、`timeout` が経過した時点で確定します。

> **autoloader のコンパニオン。** 実アプリでは監視対象タグは Import Map + `@wcstack/autoloader`（`@components/` プレフィックス）由来です。`<wcs-defined>` は、それら遅延 import されたコンポーネントがいつ準備できたか — そして timeout 経由で、いつ 1 つが届かなかったか — を知る手段です。

## インストール

```bash
npm install @wcstack/defined
```

## クイックスタート

### 1. readiness で UI をゲートする

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/defined/auto"></script>

<wcs-state>
  <script type="module">
    export default { ready: false };
  </script>
</wcs-state>

<wcs-defined tags="my-chart,my-grid" data-wcs="defined: ready"></wcs-defined>

<div data-wcs="hidden: ready">コンポーネントを読み込み中…</div>
<div data-wcs="hidden: ready|not"><my-chart></my-chart><my-grid></my-grid></div>
```

### 2. `timeout` でロード失敗を検出する

```html
<wcs-state>
  <script type="module">
    export default {
      ready: false,
      missing: [],
      get hasFailed() { return this.missing.length > 0; },
    };
  </script>
</wcs-state>

<!-- 5 秒以内に登録されなければ `missing` へ移る。 -->
<wcs-defined tags="my-chart" timeout="5000"
  data-wcs="defined: ready; missing: missing"></wcs-defined>

<div data-wcs="hidden: hasFailed">…スピナー / 本体…</div>
<div data-wcs="hidden: hasFailed|not">コンポーネントの読み込みに失敗しました。リロードしてください。</div>
```

### 3. `mode` と進捗

```html
<wcs-state>
  <script type="module">
    export default {
      anyReady: false, loaded: 0, total: 0,
      get progress() { return `${this.loaded} / ${this.total}`; },
    };
  </script>
</wcs-state>

<!-- mode="any": 最初のタグが登録された瞬間に defined が true になる。 -->
<wcs-defined tags="a-card,b-card,c-card" mode="any"
  data-wcs="defined: anyReady; count: loaded; total: total"></wcs-defined>

<span data-wcs="textContent: progress"></span>
```

完全なデモは `examples/state-defined-loader` を参照（readiness ゲート + timeout 失敗 + 遅延昇格）。

## 属性 / 入力

| 属性      | 型     | 既定           | 説明                                                                                       |
| --------- | ------ | -------------- | ------------------------------------------------------------------------------------------ |
| `tags`    | string | `""`           | 監視するカスタム要素タグ名（カンマ区切り）。必須 — 空だと `error = "no tags specified"` になる。 |
| `mode`    | string | `"all"`        | `"all"` → 全タグ登録で `defined` が true。`"any"` → 最初の 1 つで true。                      |
| `timeout` | number | `0`（無制限）  | ミリ秒。経過後、未解決タグは `missing`（ロード失敗）へ移る。`0`/未指定なら無限に待つ。         |

属性は接続時に読み取られ、監視はされません（後述）。

## 観測可能なプロパティ（出力）

| プロパティ | イベント            | 説明                                                                       |
| --------- | ------------------- | -------------------------------------------------------------------------- |
| `defined` | `wcs-defined:change` | `mode` に応じた集約 readiness（`all` なら `count === total`、`any` なら `count >= 1`）。 |
| `pending` | `wcs-defined:change` | まだ登録待ちのタグ（timeout 前）。                                          |
| `missing` | `wcs-defined:change` | timeout 切れ、または定義不能（不正名）のタグ = ロード失敗。                 |
| `count`   | `wcs-defined:change` | これまでに登録されたタグ数。                                               |
| `total`   | `wcs-defined:change` | 監視中のタグ総数。                                                         |
| `error`   | `wcs-defined:change` | 設定ミス / 不正名の人間可読メッセージ。無ければ `null`。                    |

6 つすべては単一の `wcs-defined:change` イベントから派生し、`detail` は完全なスナップショットです。各 dispatch 時に不変条件 **`total === count + pending.length + missing.length`** が成立します。`pending` と `missing` は未定義タグを timeout で分割した排他パーティションです。

## コマンド

**なし。** タグを「定義する」命令的操作は存在せず、観測のみです。`<wcs-defined>` は純粋な監視ノード（event-token のみ）です。

## 注意と制限

- **単調かつ終端的。** `whenDefined()` は揺れ戻りません。一度定義されたタグは定義済みのままです。state は全タグ解決か `timeout` 発火で確定します。timeout 後に *遅れて* 登録されたタグは `missing` から `count` へ昇格します（よって `defined` は後から true に転じうる）。
- **不正名はソフトに失敗する。** 有効なカスタム要素名でないタグ名（ハイフン無し等）は `whenDefined()` が reject され、`error` に記録され `missing` に入りますが、throw はされません。他の有効タグの監視は継続します（never-throw）。
- **属性は接続時に読み取られ、監視されない。** `<wcs-defined>` は `observedAttributes` / `attributeChangedCallback` を実装しません。`tags` / `mode` / `timeout` は接続時に固定されます。別のセットを監視するには別の要素を使う（または再接続する）。
- **再接続で再監視。** 要素を取り外して再挿入すると `connectedCallback` が再実行されます。切断時に実行中だった監視は無効化されるため、高速な切断→再接続で stale なコールバックが漏れることはありません。
- **SSR（`@wcstack/server`）。** `static hasConnectedCallbackPromise = true` を宣言し `connectedCallbackPromise` を公開するため、サーバレンダラはスナップショット前に readiness を待ちます。**SSR では `timeout` を指定すること** — 指定しないと未解決タグで promise が永久に未解決になります。永久未解決のリスクが最も顕在化するのは「SSR + autoloader 由来タグ + `timeout="0"`（または未指定）」の組合せです。この場合、起こらないかもしれない登録を待ってレンダーがハングします。SSR と autoloader タグを併用するときは必ず有限の `timeout` を付けてください。
- **配列ゲッターは毎回コピーを返す。** `pending` / `missing`（およびイベント `detail` の配列）は読み取り・dispatch のたびに新しい配列です。外部からの変更で内部状態が壊れない一方、読み取り間で参照が同一であることに依存しないでください（同一性ではなく内容で比較すること）。

## ヘッドレス利用（`DefinedCore`）

Core は DOM に依存せず、`@wc-bindable/core` の `bind()` で直接利用できます:

```typescript
import { DefinedCore } from "@wcstack/defined";

const gate = new DefinedCore(["my-chart", "my-grid"], "all", 3000);
gate.addEventListener("wcs-defined:change", (e) => {
  const snap = (e as CustomEvent).detail;
  console.log(snap.defined, snap.count, snap.total, snap.missing);
});

await gate.ready;        // 全タグ解決、または timeout 発火
console.log(gate.defined, gate.missing);

// 終了時:
gate.dispose();          // timeout をクリアし監視を停止
```

## ライセンス

MIT
