# @wcstack/media-query

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/media-query` は wcstack エコシステム向けのヘッドレスな `matchMedia` コンポーネントです。

視覚的な UI ウィジェットではありません。
`@wcstack/network` が回線品質シグナルをリアクティブな state に変えるのと同じように、CSS メディアクエリの真偽をリアクティブな state に変える **非同期プリミティブノード** です。

`@wcstack/state` と組み合わせると、`<wcs-media-query>` はパス契約で直接バインドできます:

- **入力サーフェス**: `query` — `query` 属性にミラーされるメディアクエリ文字列
- **出力 state サーフェス**: `matched`、`media`、`supported`

これにより「ダークモードか」「reduced-motion を望んでいるか」「ビューポートが 600px 未満か」が state 上の素の boolean になり、`data-wcs` の条件分岐・computed getter・他の I/O ノードから、UI 層で `matchMedia` や `change` リスナーの配線を書かずに使えます。

`@wcstack/media-query` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core**（`MediaQueryCore`）が `matchMedia(query)` を呼び、リストの live な `change` イベントを追従
- **Shell**（`<wcs-media-query>`）がその state を DOM ライフサイクルに接続し、`query` 変更時に購読を張り替える
- **Binding Contract**（`static wcBindable`）が観測可能な `properties` と 1 つの `input`（`query`）を宣言（**コマンドは持たない**）

## なぜ存在するか — CSS には `@media` があるが、state には無い

*スタイル*だけを切り替えるメディアクエリはスタイルシートに書くべきです。このノードは、答えが**ロジック**に届く必要がある場面のためにあります: テーマの既定値を決める、`prefers-reduced-motion` で `<wcs-raf>` のループを止める、ブレークポイント未満でテーブルをカードリストに差し替える、`(display-mode: standalone)` で PWA としてのインストールを検知する。いずれも手書きなら 4 行の命令的配線（`matchMedia` → `addEventListener("change")` → 初期同期 → 後始末）が要りますが、ここでは他の wcstack I/O ノードと同じ骨格を持つ 1 タグです。

> **`matches` ではなく `matched`。** プラットフォームのプロパティは `MediaQueryList.matches` ですが、`Element.prototype.matches(selector)` が全要素に既に存在し、wc-bindable のプロパティは Shell から直接読まれるため、DOM メソッドを潰さないよう出力名を `matched` にしています。`docs/media-query-tag-design.md` §2.1 参照。

> **secure context 不要・権限不要。** `matchMedia` はあらゆるページで使えます。

## インストール

```bash
npm install @wcstack/media-query
```

CDN（バージョン固定）: `https://esm.run/@wcstack/media-query@2.1.1/auto`

## クイックスタート

### 1. テーマのダークモード既定値

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/media-query/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      isDark: false,
      get theme() {
        return this.isDark ? "dark" : "light";
      },
    };
  </script>
</wcs-state>

<wcs-media-query query="(prefers-color-scheme: dark)" data-wcs="matched: isDark"></wcs-media-query>

<main data-wcs="attr.data-theme: theme">…</main>
```

このページの全例に共通するタイミング規則が 1 つあります: `<wcs-media-query>` はスナップショットを `wcs-media-query:change` イベントで公開しますが、*初回*のスナップショットは接続時に同期発火するため、`@wcstack/state` がバインドリスナーを張るより先に流れてしまいます。それでも初期値が届くのは、`<wcs-media-query>` の観測可能プロパティがすべて output-only（`properties` にのみ宣言され `inputs` に無い）だからです — 既定の binding authority が `element` になり、バインド確立時に**イベントを待たずプロパティを直接読みます**（directional initial sync、v1.21.0 以降は既定 ON）。手動 pull は不要です（「注意・制限」参照）。

### 2. `<wcs-raf>` のループで `prefers-reduced-motion` を尊重する

```html
<wcs-state>
  <script type="module">
    export default {
      reduceMotion: false,
      frame: 0,
    };
  </script>
</wcs-state>

<wcs-media-query query="(prefers-reduced-motion: reduce)" data-wcs="matched: reduceMotion"></wcs-media-query>
<wcs-raf data-wcs="tick: frame; command.pause: reduceMotion|truthy; command.resume: reduceMotion|not" manual></wcs-raf>
```

（`<wcs-raf>` にはまさにこの用途の `reduced-motion="pause"` 属性もあります。この例は一般形 — 任意の I/O ノードのコマンドをメディアクエリから駆動できる — を示すものです。）

### 3. ブレークポイントでのレイアウト切り替え

```html
<wcs-state>
  <script type="module">
    export default {
      narrow: false,
      rows: [],
    };
  </script>
</wcs-state>

<wcs-media-query query="(max-width: 600px)" data-wcs="matched: narrow"></wcs-media-query>

<template data-wcs="if: narrow">
  <ul data-wcs="for: rows"><li data-wcs="textContent: rows.*.name"></li></ul>
</template>
<template data-wcs="if: narrow|not">
  <table>…</table>
</template>
```

バインドする state パスは必ず事前に宣言してください — 未宣言パスへのバインドは初期化時に例外になります。`matched` は厳密な boolean（`null` になり得ない）なので `|not` が安全です。

## 属性 / 入力

| 属性     | プロパティ | 説明 |
| -------- | ---------- | ---- |
| `query`  | `query`    | `matchMedia()` に渡すメディアクエリ文字列。接続中に変更すると旧 `MediaQueryList` の購読を解除して新しいリストを購読します。属性を除去すると「何も監視しない」となり `matched` は `false` に落ちます。不正なクエリでも throw しません（ブラウザは `media: "not all"`、`matched: false` を報告）。 |

`query` は唯一の入力で、`wcBindable.inputs` に `attribute: "query"` で宣言されています。upgrade 前のプロパティ代入は接続時に取り込まれます（property upgrade）。

## 観測可能プロパティ（出力）

| プロパティ   | イベント                  | semantics | 説明 |
| ------------ | ------------------------- | --------- | ---- |
| `matched`    | `wcs-media-query:change`  | `state`   | `MediaQueryList.matches`。live なリストが無いとき（非対応・空 `query`・`matchMedia` が throw）は `false`。 |
| `media`      | `wcs-media-query:change`  | `state`   | ブラウザが正規化した `MediaQueryList.media` 文字列（不正クエリは `"not all"`）。リストが無ければ `""`。 |
| `supported`  | `wcs-media-query:change`  | `state`   | この環境で `matchMedia` が関数なら `true`。購読のたびに解決（コンストラクタでキャッシュしない）。 |

3 つすべては単一の `wcs-media-query:change` イベント（スナップショット全体 `{ matched, media, supported }`）から派生します。query 変更で `media` と `matched` が同時に変わる場合も、1 つの整合した更新として届きます。値はプリミティブのみで、解放すべきライブハンドルや所有オブジェクトはありません。

## コマンド

**無し。** `MediaQueryList` には呼ぶべきアクションがありません。`<wcs-media-query>` は純粋なモニタです。

## 注意・制限

- **1 タグ 1 クエリ。** 複数のクエリは `<wcs-media-query>` を並べてください。`queries` 配列は全ノード共通の「1 イベント＋派生 getter」の形を崩します。
- **初回スナップショットの*イベント*はバインドに届きませんが、値は届きます。** 最初の `wcs-media-query:change` は `connectedCallback` 中に同期発火し、`@wcstack/state` のバインドリスナー確立はそれより後です。イベントは後から購読した相手に再送されません。それでも初期値が失われないのは、本ノードの観測可能プロパティがすべて output-only で既定の binding authority が `element` になるためです: バインドは確立時にプロパティを直接読みます（directional initial sync）。`enableDirectionalInitialSync: false` に倒した構成でのみ `$connectedCallback` + `whenDefined` の手動 pull が必要です。
- **世代ガード。** 購読自体は同期ですが、query の変更は購読を*置き換え*ます。各購読の `change` リスナーは世代を捕捉し、新しい購読ができた後のイベントを無視するため、`removeEventListener` が効かない `MediaQueryList` でも古い query の値が新しい query の値を上書きすることはありません。`docs/media-query-tag-design.md` §6。
- **旧 Safari。** リストに `addEventListener` が無ければ非推奨の `addListener` / `removeListener` ペアを使い、どちらも無ければ購読時点のスナップショットだけを報告します。
- **再接続で再購読。** 要素を取り外すとリスナーを解除し、再挿入時に（その時点の `query` で）再確立します。
- **SSR（`@wcstack/server`）。** `static hasConnectedCallbackPromise = true` を宣言し `connectedCallbackPromise` を公開しますが、`observe()` が同期的なため常に即座に settle します。`matchMedia` の無い環境（Node）では `supported` と `matched` は `false`、`media` は `""` です。
- **同値ガード。** フィールド単位の比較で冗長な dispatch を抑止します — 旧 `addListener` の二重発火や、ブラウザが同じ `media` に正規化する等価クエリへの再購読など。

## `:state()` による CSS スタイリング

`<wcs-media-query>` は 2 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `matched` | `wcs-media-query:change` が `matched === true` で発火 |
| `supported` | `wcs-media-query:change` が `supported === true` で発火 |

`media` は文字列なので反映されません。

```css
/* JS 配線なしの兄弟要素駆動テーマ */
wcs-media-query:state(matched) ~ main { color-scheme: dark; }
body:has(wcs-media-query:not(:state(supported))) .needs-js-media { display: none; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-media-query>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-media-query:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["matched", "supported"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-matched` / `data-wcs-state-supported` 属性にミラーします。
  Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-media-query query="(max-width: 600px)" debug-states></wcs-media-query>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## ヘッドレス利用（`MediaQueryCore`）

Core は DOM 非依存で、`@wc-bindable/core` の `bind()` と直接使えます:

```typescript
import { MediaQueryCore } from "@wcstack/media-query";

const mq = new MediaQueryCore();
mq.addEventListener("wcs-media-query:change", (e) => {
  console.log((e as CustomEvent).detail); // { matched, media, supported }
});

mq.observe("(prefers-color-scheme: dark)"); // 同期的 — データ取得に promise を待つ必要は無い
console.log(mq.matched);

mq.observe("(max-width: 600px)");            // query 切替: 旧リストを解放し新リストを購読

// 後始末:
mq.dispose();                                 // live な `change` リスナーを外す
```

コンストラクタ: `new MediaQueryCore(target?, { matchMedia? })`。`target` はイベントの dispatch 先 `EventTarget`（省略時は Core 自身）、`matchMedia` は `globalThis.matchMedia` を呼び出し時に解決する代わりに使う関数の注入（テストや window の無いホスト向け）。ライフサイクルは手動です: `observe(query)` / `dispose()`。

Core の構造サーフェスは wcstack I/O ノード横断の規範です([async-io-node-guidelines §3.9](../../docs/async-io-node-guidelines.ja.md))。要素なしで signals に束縛するには [@wcstack/signals — Core を直接束縛する](../signals/README.ja.md#core-を直接束縛する要素なし) を参照。

## ライセンス

MIT
