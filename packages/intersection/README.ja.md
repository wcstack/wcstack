# @wcstack/intersection

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/intersection` は wcstack エコシステム向けのヘッドレスな IntersectionObserver コンポーネントです。

これは視覚的な UI ウィジェットではありません。
`@wcstack/fetch` がネットワークリクエストをリアクティブな状態に変え、`@wcstack/geolocation` がデバイスの位置情報をリアクティブな状態に変えるのと同じように、**要素の*可視性*をリアクティブな状態に変える非同期プリミティブノード**です。

`@wcstack/state` と組み合わせると、`<wcs-intersect>` はパス契約を通じて直接バインドできます。

- **入力 / コマンド面**: `target`, `root`, `root-margin`, `threshold`, `once`, `manual`, `trigger`
- **出力状態面**: `entry`, `intersecting`, `ratio`, `visible`, `observing`

つまり、可視性を意識した処理 — 遅延読み込み、無限スクロール、スクロールスパイ — を HTML 上で宣言的に表現でき、UI 層に `new IntersectionObserver()` / `observe()` / `disconnect()`、後始末のグルーコードを書く必要がありません。

`@wcstack/intersection` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います。

- **Core**（`IntersectionCore`）が observer、entry の正規化、`visible` ラッチ、観測のライフサイクルを所有
- **Shell**（`<wcs-intersect>`）が*何を*観測するかを DOM から解決し、display・ライフサイクル・宣言的コマンドを管理
- **Binding Contract**（`static wcBindable`）が観測可能な `properties`・書き込み可能な `inputs`・呼び出し可能な `commands` を宣言

## なぜ存在するのか

IntersectionObserver は他のすべての @wcstack センサと異なります。観測対象がヘッドレスなリソースではなく、**DOM 要素**だからです。命令的に配線するには、observer を作成し、ターゲットノードを解決し、entry コールバックを処理し、切断時にすべてを解体する必要があります。

`@wcstack/intersection` はそのロジックを再利用可能なコンポーネントに押し込み、結果をバインド可能な状態として公開します。要素がビューにスクロールインすることが命令的なコールバック配線ではなく、**状態遷移**になります。これは読み取り専用のプロデューサです。element/layout は state のために値を生み出すだけで（`element/layout → state`）、逆向きの経路はありません。

## `target` 属性がすべてを決める

`target` は*何を*観測するかを選ぶ唯一のツマミであり、それに伴って `<wcs-intersect>` がどうレンダリングされるかも決めます。明示的に要求しない限り、layout box を決して注入しません。

| `target`          | 観測対象              | `display`   | ユースケース         |
|-------------------|-----------------------|-------------|----------------------|
| *省略*            | 最初の要素の子        | `contents`  | 遅延読み込みラッパー |
| `"#hero"` / sel.  | マッチした要素        | `none`      | スクロールスパイ（単一） |
| `"self"`          | 要素自身              | `block`     | 無限スクロールの端   |

`display:contents` は、子をラップしても自身の box を注入しないことを意味します — そのため `<wcs-intersect><img></wcs-intersect>` は flex/grid の親を乱しません。明示的な `target="self"` センチネルだけが box を取ります。

> **最初の要素の子。** `target` が省略されると、*最初の要素の子*が観測されます。ターゲットは毎回の `observe()`（接続時と各 observed-attribute 変更時に実行）で再解決されるため、接続後に最初の子を追加・削除すると、次回の再観測で観測要素が切り替わります。解決時点で要素の子が無い場合は、自身を観測することにフォールバックします（`display:block`）。複数のターゲットを同時に観測することは意図的に対象外です — 各ターゲットをそれぞれ独自の `<wcs-intersect>` でラップしてください。

## インストール

```bash
npm install @wcstack/intersection
```

## クイックスタート

### 1. 画像を遅延読み込み（`visible` ラッチ）

`visible` はターゲットが初めて交差したときに `true` に切り替わり、その後 `true` の**ままになります**。画像の `src` をこれにバインドすると、画像はビューにスクロールインしたときに一度だけ読み込まれます。

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/intersection/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      shown: false,
      get src() {
        return this.shown ? "/photo.jpg" : "";
      }
    };
  </script>
</wcs-state>

<wcs-intersect once data-wcs="visible: shown">
  <img data-wcs="src: src" alt="lazy">
</wcs-intersect>
```

`once` は最初の交差後に observer を切断します — 一度きりの遅延読み込みに最適です。

### 2. 無限スクロール（センチネル）

リストの末尾に空の `target="self"` マーカーを置き、`intersecting` を「さらに読み込む」をトリガする state フラグにバインドします。

```html
<ul data-wcs="for: items">
  <li data-wcs="textContent: items.*.name"></li>
</ul>

<wcs-intersect target="self" data-wcs="intersecting: atEnd"></wcs-intersect>
```

```js
export default {
  items: [],
  atEnd: false,
  get _loadMore() {
    // atEnd が true になることに反応する computed/effect
    return this.atEnd ? fetchNextPage() : null;
  }
};
```

### 3. スクロールスパイ（単一セクション）

ドキュメント内の別の場所にあるセクションに `target` を向け、`intersecting` をバインドして対応するナビ項目をハイライトします。

```html
<nav>
  <a href="#features" data-wcs="class.active: featuresVisible">Features</a>
</nav>

<section id="features">…</section>

<wcs-intersect target="#features" threshold="0.5"
  data-wcs="intersecting: featuresVisible"></wcs-intersect>
```

## 属性

| 属性           | 型      | 既定値     | 説明 |
|----------------|---------|------------|-------------|
| `target`       | string  | *(省略)*   | 何を観測するか: 省略 → 最初の子、セレクタ → その要素、`self` → この要素。 |
| `root`         | string  | *(viewport)* | スクロールルートのセレクタ。 |
| `root-margin`  | string  | `0px`      | ルート周りのマージン（CSS の margin 構文）。 |
| `threshold`    | string  | `0`        | 単一の比率（`0.5`）またはカンマ区切りリスト（`0,0.5,1`）の `0..1` の閾値。不正 / 範囲外の値は捨てられる。 |
| `once`         | boolean | `false`    | 最初の交差した観測の後に切断する。 |
| `manual`       | boolean | `false`    | 接続時に自動観測しない。代わりにコマンドで駆動する。 |

> **`trigger`** には*属性がありません* — `@wcstack/state` の配線専用の瞬間的なコマンドプロパティです。`false → true` への書き込みは `observe()` を再実行し、プロパティは自動的に `false` にリセットされます（一度きりの確認応答。実際の結果は `observing` を読んでください）。状態駆動の観測には、この boolean より command-token プロトコル（`command.observe: …`）を優先してください。

## 出力状態

| プロパティ     | 型                         | 説明 |
|----------------|----------------------------|-------------|
| `entry`        | `WcsIntersectEntry \| null`| 直近の `IntersectionObserverEntry` のプレーンなスナップショット（rect はプレーンな数値に正規化）に、ライブの `target` ノードを加えたもの。 |
| `intersecting` | `boolean`                  | ターゲットが現在ルートと交差しているか。 |
| `ratio`        | `number`                   | 直近の `intersectionRatio`。 |
| `visible`      | `boolean`                  | ラッチ: ターゲットが一度交差すると `true`。`reset()` でのみクリアされる。 |
| `observing`    | `boolean`                  | 現在観測がアクティブか。 |

## コマンド

| コマンド       | 説明 |
|---------------|-------------|
| `observe()`   | DOM から `target` / `root` を再解決し、観測を（再）開始する。冪等: ターゲット + オプションが不変なら no-op（新しいコールバックは発火しない）。 |
| `reobserve()` | ターゲット / オプションが不変でも強制的に新規観測を行う — オブザーバを破棄して作り直すため、*現在の*可視状態に対して新しい初回コールバックが発火する。可視状態の遷移を伴わずレイアウトが変化した後（例: 無限スクロールで短いページが追加された）にエッジ駆動のコンシューマを再武装するのに使う。再武装成功中も `observing` は `true` のまま（誤った瞬断が起きない）。 |
| `unobserve()` | 現在のターゲットの観測を停止する。 |
| `disconnect()`| すべての観測を停止する。 |
| `reset()`     | `visible` ラッチをクリアし、後の交差が再びそれを設定できるようにする。 |

## `:state()` による CSS スタイリング

`<wcs-intersect>` は 3 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `visible` | `wcs-intersect:visible-changed` が `true` で発火（ラッチ — `reset()` が `false` でイベントを発火したときのみクリア） |
| `observing` | `wcs-intersect:observing-changed` が `true` で発火（`false` でクリア） |
| `intersecting` | `wcs-intersect:change` が `isIntersecting` が `true` の detail で発火（`false` のときクリア） |

`ratio` と `entry` は反映されません（連続値・データ値のため）。

```css
wcs-intersect:state(intersecting) ~ .marker { opacity: 1; }
wcs-intersect:state(visible) img { display: block; } /* 遅延読み込みの表示 */
wcs-intersect:not(:state(observing)) ~ .paused-badge { display: block; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-intersect>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-intersect:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["observing", "intersecting"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-visible` / `data-wcs-state-observing` / `data-wcs-state-intersecting`
  属性にミラーします。Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-intersect target="#hero" debug-states></wcs-intersect>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## Binding Contract（`wcBindable`）

Core と Shell の両方が [wc-bindable](https://github.com/csbc-dev) プロトコルを宣言します。

```js
// IntersectionCore (headless)
IntersectionCore.wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "entry", event: "wcs-intersect:change" },
    { name: "intersecting", event: "wcs-intersect:change", getter: (e) => e.detail.isIntersecting },
    { name: "ratio", event: "wcs-intersect:change", getter: (e) => e.detail.intersectionRatio },
    { name: "visible", event: "wcs-intersect:visible-changed" },
    { name: "observing", event: "wcs-intersect:observing-changed" },
  ],
  commands: [
    { name: "observe" }, { name: "reobserve" }, { name: "unobserve" }, { name: "disconnect" }, { name: "reset" },
  ],
};
```

Shell（`<wcs-intersect>`）は Core の `properties` / `commands` を継承し、瞬間的な `trigger` プロパティを追加し、DOM 駆動の `inputs`（`target`, `root`, `rootMargin`, `threshold`, `once`, `manual`, `trigger`）を宣言します。

## Core を単体で使う

`IntersectionCore` はフレームワーク非依存で、カスタム要素なしで使えます。観測する要素を渡します（Shell はこの解決をあなたの代わりに行います）。

```js
import { IntersectionCore } from "@wcstack/intersection";

const core = new IntersectionCore();
core.addEventListener("wcs-intersect:change", (e) => {
  console.log(e.detail.isIntersecting, e.detail.intersectionRatio);
});
core.observe(document.querySelector("#hero"), { threshold: [0, 0.5, 1] });
// 後で
core.disconnect();
```

## 注意点と制約

- **単一ターゲット。** 各 `<wcs-intersect>` はちょうど 1 つの要素を観測するので、状態は単一の値面にマップします。多数のターゲットには多数の要素を使ってください。
- **決して throw しない。** 非対応環境（`IntersectionObserver` が無い）や不正なオプション（例: 不正な形式の `root-margin`）は無言の no-op です。throw せず `observing` が `false` のままになります。
- **パーミッションゲート / セキュアコンテキスト要件は無い**（`@wcstack/geolocation` と異なります）。

## ライセンス

MIT
