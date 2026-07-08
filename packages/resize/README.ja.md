# @wcstack/resize

`@wcstack/resize` は wcstack エコシステム向けのヘッドレスな ResizeObserver コンポーネントです。

これは視覚的な UI ウィジェットではありません。
要素の*サイズ*をリアクティブな状態に変換する**非同期プリミティブノード**です。`@wcstack/fetch` がネットワークリクエストを、`@wcstack/intersection` が要素の可視状態をリアクティブな状態に変換するのと同じ位置づけです。

`@wcstack/state` と組み合わせると、`<wcs-resize>` はパス契約を通じて直接バインドできます。

- **入力 / コマンド面**: `target`、`box`、`round`、`once`、`manual`、`trigger`
- **出力状態面**: `entry`、`width`、`height`、`observing`

これにより、サイズ依存のロジック（canvas の再描画、仮想リスト、画像解像度の選択、幅しきい値でのレイアウトモード切替など）を、UI 層で `new ResizeObserver()`・`observe()`・`disconnect()`・後始末を書かずに、HTML 上で宣言的に表現できます。

`@wcstack/resize` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います。

- **Core**（`ResizeCore`）はオブザーバ、entry の正規化、box 追従のサイズ導出、監視ライフサイクルを所有
- **Shell**（`<wcs-resize>`）は*何を*監視するかを DOM から解決し、display・ライフサイクル・宣言的コマンドを管理
- **Binding Contract**（`static wcBindable`）は監視可能な `properties`、書き込み可能な `inputs`、呼び出し可能な `commands` を宣言

## いつ使うか（そして使わないか）

コンテナのサイズに依存した**スタイリング**には、CSS の [`@container` クエリ](https://developer.mozilla.org/ja/docs/Web/CSS/CSS_containment/Container_queries)を使ってください。それがまさにそのために存在し、JavaScript を経由しません。

`@wcstack/resize` は CSS では表現できないケース、すなわち**サイズ依存のロジック**のためのものです。要素のピクセルサイズで `<canvas>` を再描画する、仮想リストの行数を計算する、取得する画像解像度を選ぶ、幅しきい値を越えた非スタイルの状態フラグを切り替える、など。要素のサイズ変化が、命令的なコールバック配線ではなく**状態遷移**になります。これは読み取り専用のプロデューサです。要素/レイアウトは状態に値を供給するだけで（`element/layout → state`）、戻る経路はありません。

## `target` 属性がすべてを決める

`target` は*何を*監視するかを選ぶ唯一のツマミであり、それに伴って `<wcs-resize>` の描画方法も決めます。明示的に要求しない限り layout box を注入しません。

| `target`          | 監視対象            | `display`   | 用途                   |
|-------------------|---------------------|-------------|------------------------|
| *省略*            | 最初の子要素        | `contents`  | 包んだ子のサイズ計測   |
| `"#panel"` / セレクタ | マッチした要素   | `none`      | 既存ノードのサイズ計測 |
| `"self"`          | 自分自身            | `block`     | コンテナ幅プローブ      |

`display:contents` は包んだ子に自前の box を注入しません（`<wcs-resize><div></wcs-resize>` は flex/grid の親を乱しません）。`display:none` の要素は **box を生成しない**ため、セレクタポインタの `<wcs-resize>` は自分自身ではなく参照先ノード（box を持つ）を正しく監視します。

> **`target="self"` はコンテナプローブ。** `self` の `<wcs-resize>` は `display:block` のゼロ高要素として描画されるため、親の利用可能な inline サイズいっぱいに広がります。`width` をバインドすると*親コンテナの*幅を追跡します — CSS コンテナクエリの JS 版です。（`display:contents` / `display:none` の要素は box を持たず発火しないため、`self` は `block` box を取ります。）

> **最初の子要素。** `target` 省略時は*最初の子要素*を監視します。target は `observe()` のたびに再解決されるため（connect 時と監視対象属性の変更ごとに実行）、connect 後に最初の子を追加/削除すると次の再 observe で監視対象が切り替わります。解決時点で子要素がなければ自分自身の監視（`display:block`）にフォールバックします。複数対象の同時監視は意図的に対象外です — 対象ごとに `<wcs-resize>` で包んでください。

## インストール

```bash
npm install @wcstack/resize
```

## クイックスタート

### 1. コンテナ幅プローブ（`self`）

`width` を状態値にバインドし、状態ロジック側で*親コンテナの*サイズに反応します。

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/resize/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      width: 0,
      get layout() {
        return this.width < 480 ? "stack" : "columns";
      }
    };
  </script>
</wcs-state>

<div class="panel">
  <wcs-resize target="self" round data-wcs="width: width"></wcs-resize>
  <!-- `layout` を class や属性などにバインド -->
</div>
```

`round` は `width` を整数に丸めるため、サブピクセルのレイアウト変化でバインド先の状態が揺れません。

### 2. 包んだ子のサイズ計測（canvas 再描画）

`target` を省略すると box を注入せず最初の子を監視します。`width` / `height` を再描画コマンドにバインドします。

```html
<wcs-resize round data-wcs="width: canvasWidth; height: canvasHeight">
  <canvas data-wcs="..."></canvas>
</wcs-resize>
```

### 3. 一度だけ計測（`once`）

`ResizeObserver` は監視開始時に必ず初期サイズを通知するため、`once` は `<wcs-resize>` を一度きりの計測にします。

```html
<wcs-resize target="#card" once data-wcs="width: cardWidth"></wcs-resize>
```

## リサイズループの回避

コールバックが監視対象のサイズを変える `ResizeObserver` は自分自身を駆動しえます（*サイズ → 状態 → DOM サイズ → サイズ*）。ブラウザには組み込みのループブレーカがあり（同一フレーム内の再通知を次フレームへ延期するのでハングしません）、`@wcstack/state` の同値ガードも一周で収束するバインディングを止めます。残る危険は**サブピクセルの振動**です（幅が `99.99` と `100.01` を永遠に往復）。

優先順に2つの防御策があります。

1. **サイズ出力をサイズ入力に配線しない。** `width` / `height` はレイアウトの駆動源ではなく、*ロジック*のための読み取り専用センサとして扱う。
2. **シグナルを量子化する。** `round` で整数にスナップするか、`@wcstack/debounce` の `<wcs-throttle>` と合成して状態更新をレート制限する。

```html
<!-- 連続するリサイズを 100ms ごとに 1 回の状態更新へまとめる -->
<wcs-resize target="self" data-wcs="width: rawWidth"></wcs-resize>
<wcs-throttle wait="100" data-wcs="source: rawWidth; value: settledWidth"></wcs-throttle>
```

## 属性

| 属性      | 型      | 既定           | 説明 |
|-----------|---------|----------------|------|
| `target`  | string  | *(省略)*       | 監視対象: 省略 → 最初の子、セレクタ → その要素、`self` → 自分自身。 |
| `box`     | string  | `content-box`  | 報告する box: `content-box`、`border-box`、`device-pixel-content-box`。未知の値は `content-box` にフォールバック。 |
| `round`   | boolean | `false`        | `width` / `height` を整数に丸める（サブピクセルの揺れを吸収）。 |
| `once`    | boolean | `false`        | 初回計測後に切断（一度きり計測）。 |
| `manual`  | boolean | `false`        | connect 時に自動監視せず、コマンドで駆動する。 |

> **`trigger`** には*属性がありません* — `@wcstack/state` 配線専用の momentary なコマンドプロパティです。`false → true` の書き込みで `observe()` を再実行し、即 `false` に戻ります（一度きりの確認応答。実際の成否は `observing` を読む）。状態駆動の監視には、この boolean よりコマンドトークンプロトコル（`command.observe: …`）を推奨します。

## 出力状態

| プロパティ  | 型                       | 説明 |
|-------------|--------------------------|------|
| `entry`     | `WcsResizeEntry \| null` | 最新 `ResizeObserverEntry` の plain スナップショット（`contentRect` と box-size 断片を plain な数値に正規化）と live な `target` ノード。 |
| `width`     | `number`                 | 監視中の `box` から得た代表 width（`contentRect` にフォールバック）。`round` 指定時は丸める。 |
| `height`    | `number`                 | 代表 height。規則は `width` と同じ。 |
| `observing` | `boolean`                | 監視が現在アクティブか。 |

> **`width` は `box` に追従。** `box="border-box"` なら border-box 幅、`device-pixel-content-box` ならデバイスピクセル幅、それ以外は content-box 幅です。生の `inlineSize` / `blockSize` 断片を `width` / `height` にマップし（横書きで正しい）、丸めていない値も `entry` で参照できます。

## コマンド

| コマンド       | 説明 |
|----------------|------|
| `observe()`    | `target` を DOM から再解決して監視を（再）開始。 |
| `unobserve()`  | 現在の対象の監視を停止。 |
| `disconnect()` | すべての監視を停止。 |

## `:state()` による CSS スタイリング

`<wcs-resize>` は 1 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `observing` | `wcs-resize:observing-changed` が `true` で発火（`false` でクリア） |

`width` / `height` / `entry` は反映**しません** — これらは boolean 出力ではなく
連続値だからです（[設計ドキュメント](../../docs/custom-state-reflection-design.md) §3.2 参照）。

```css
wcs-resize:state(observing) ~ .measuring-badge { display: block; }
wcs-resize:state(observing) ~ .measuring-badge { display: none; } /* デフォルト */
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-resize>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-resize:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["observing"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-observing` 属性にミラーします。
  Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-resize target="self" debug-states></wcs-resize>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## Binding Contract（`wcBindable`）

Core と Shell の両方が [wc-bindable](https://github.com/csbc-dev) プロトコルを宣言します。

```js
// ResizeCore（ヘッドレス）
ResizeCore.wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "entry", event: "wcs-resize:change" },
    { name: "width", event: "wcs-resize:change", getter: (e) => e.detail.width },
    { name: "height", event: "wcs-resize:change", getter: (e) => e.detail.height },
    { name: "observing", event: "wcs-resize:observing-changed" },
  ],
  commands: [
    { name: "observe" }, { name: "unobserve" }, { name: "disconnect" },
  ],
};
```

Shell（`<wcs-resize>`）は Core の `properties` / `commands` を継承し、momentary な `trigger` プロパティを追加し、DOM 駆動の `inputs`（`target`、`box`、`round`、`once`、`manual`、`trigger`）を宣言します。

## Core を単体で使う

`ResizeCore` はフレームワーク非依存で、カスタム要素なしでも使えます。監視する要素を渡します（Shell がこの解決を代行します）。

```js
import { ResizeCore } from "@wcstack/resize";

const core = new ResizeCore();
core.addEventListener("wcs-resize:change", (e) => {
  console.log(e.detail.width, e.detail.height);
});
core.observe(document.querySelector("#panel"), { box: "border-box", round: true });
// 後で
core.disconnect();
```

## 注意・制限

- **単一対象。** 各 `<wcs-resize>` は厳密に 1 要素を監視し、状態は単一の値面にマップされます。多数の対象には多数の要素を使ってください。
- **決して throw しない。** 非対応環境（`ResizeObserver` なし）は静かな no-op です。有効だが非対応の `box`（例: 対応していないエンジンでの `device-pixel-content-box`）は `content-box` で 1 回再試行し、それも失敗すれば throw せず `observing` を `false` のままにします。
- **スタイリングには CSS `@container` を優先。** 本コンポーネントはサイズ依存の*スタイル*ではなく、サイズ依存の*ロジック*のためのものです。

## ライセンス

MIT
