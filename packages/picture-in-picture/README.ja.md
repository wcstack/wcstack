# @wcstack/picture-in-picture

`@wcstack/picture-in-picture` は wcstack エコシステム向けのヘッドレスな Picture-in-Picture コンポーネントです。

視覚的な UI ウィジェットではありません。
`@wcstack/fullscreen` が要素の全画面状態をリアクティブな state に変えるのと同じように、`<video>` 要素の Picture-in-Picture 状態をリアクティブな state に変える **非同期プリミティブノード** です。

`@wcstack/state` と組み合わせると、`<wcs-pip>` はパス契約で直接バインドできます:

- **入力サーフェス**: `target` — どの `<video>` 要素を操作するか
- **出力 state サーフェス**: `active`、`error`
- **コマンドサーフェス**: `requestPictureInPicture()`、`exitPictureInPicture()`

これにより、`document.pictureInPictureElement` を手動でポーリングしたりレイアウトを気にしたりせずに、「ポップアウト」ボタンを HTML 上で宣言的に表現できます。

`@wcstack/picture-in-picture` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core**（`PipCore`）が Picture-in-Picture API を解決し（呼び出し時、非キャッシュ）、対象 `<video>` の `enterpictureinpicture`/`leavepictureinpicture` を購読し、`active`/`error` を追跡
- **Shell**（`<wcs-pip>`）が DOM からどの `<video>` を操作するか解決し、display・ライフサイクル・宣言的コマンドを管理
- **Binding Contract**（`static wcBindable`）が観測可能な `properties`、書き込み可能な `inputs`、呼び出し可能な `commands` を宣言

## なぜ存在するか — そして自分自身を操作しない理由

`@wcstack/fullscreen` と同様、この Shell は非表示の**制御タグ**です。自分自身を Picture-in-Picture 化するのではなく、`target` で解決した要素に対して Picture-in-Picture API を実行します。典型的なユースケースは動画プレイヤーの「ポップアウト」ボタンです。

`@wcstack/picture-in-picture` は `target` 解決のアーキタイプを `@wcstack/fullscreen` / `@wcstack/intersection` と共有します（詳細な根拠は `docs/fullscreen-tag-design.md` §1 参照）— 同じ3モード `target` 解決、同じ `_safeQuery` never-throw ラッパー、同じ Core 単位1つの `_gen` 世代ガード、同じシンプルな `error` フィールド（permission のような4値state は無し、`docs/fullscreen-tag-design.md` §8 参照）。

## スコープ: 古典的な Picture-in-Picture API のみ（`<video>` 限定）

「Picture-in-Picture」という名前を持つ、互いに無関係な2つのWeb Platform提案が存在します:

- **古典的な Picture-in-Picture API**（`HTMLVideoElement.requestPictureInPicture()`）— `<video>` 限定で、広くサポートされています。**`<wcs-pip>` が包むのはこちらです。**
- **Document Picture-in-Picture API**（`documentPictureInPicture.requestWindow()`）— 動画に限らず任意のDOMサブツリーを別の常に最前面のウィンドウに浮かせられます。API 形状（別の `Window` を取得してそこへ DOM を移動する）が、本ノードが `fullscreen`/`pointer-lock` と共有する「target を解決し、document レベルの状態を監視する」というアーキタイプと根本的に異なります。

**`<wcs-pip>` は古典的な `<video>` 限定 API を対象とします。Document Picture-in-Picture API は v1 のスコープ外です**（`docs/picture-in-picture-tag-design.md` §4 参照）。将来的に別ノード（例: `<wcs-doc-pip>`）として切り出される可能性があります。

### `target` は `<video>` 要素に解決されなければならない

Fullscreen（任意の `Element` がサポート）と異なり、Picture-in-Picture は `HTMLVideoElement` にのみ定義されています。`target` が `<video>` 以外の要素に解決された場合、`<wcs-pip>` はこれを未解決の target と同じ扱いにします。`requestPictureInPicture()` は例外を投げず、即座に `error` を `{ message: "target must be a <video> element." }` にセットして resolve します。

## インストール

```bash
npm install @wcstack/picture-in-picture
```

## クイックスタート

### 1. 動画プレイヤーの「ポップアウト」ボタン

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/picture-in-picture/auto"></script>

<video id="player" src="/movie.mp4" controls></video>

<wcs-pip target="#player" data-wcs="active: pipActive"></wcs-pip>

<button command.click:$command.requestPictureInPicture>ポップアウト</button>
<button command.click:$command.exitPictureInPicture hidden@!pipActive>ページに戻す</button>
```

### 2. `<video>` を子要素としてラップする（セレクタ不要）

```html
<wcs-pip data-wcs="active: pipActive">
  <video src="/movie.mp4" controls></video>
</wcs-pip>
```

### 3. 失敗を報告する（gesture 制約による reject 等）

```html
<wcs-pip target="#player" data-wcs="active: pipActive; error: pipError"></wcs-pip>
<p hidden@!pipError>Picture-in-Picture に入れませんでした。</p>
```

## `target` 属性が操作対象を決める

| `target`          | 操作対象               | `display`   | ユースケース                |
|-------------------|-------------------------|-------------|------------------------------|
| 省略              | 最初の子要素             | `contents`  | `<video>` をインラインでラップ |
| `"#player"` / セレクタ | マッチした要素      | `none`      | 独立した制御タグ             |
| `"self"`          | 自分自身                 | `block`     | `<wcs-pip>` 自体が `<video>` を兼ねる（稀） |

`display:contents` は `<video>` 子要素をラップしても自身のボックスを注入しないことを意味します。明示的な `target="self"` のみがボックスを持ちます。`packages/intersection` の `_resolveTarget()` をそのまま流用しています（`docs/fullscreen-tag-design.md` §1）。

## 属性

| 属性     | 型     | デフォルト   | 説明 |
|----------|--------|--------------|------|
| `target` | string | *(省略)*     | どの `<video>` を操作するか: 省略 → 最初の子要素、セレクタ → マッチした要素、`self` → 自分自身。`<video>` 要素に解決される必要がある。 |

## 出力 state

| プロパティ | 型        | イベント          | 説明 |
|------------|-----------|-------------------|------|
| `active`   | `boolean` | `wcs-pip:change`  | 解決済みの `<video>` target が現在 document の Picture-in-Picture 要素かどうか。 |
| `error`    | `any`     | *(無し — getter 経由で読む)* | 直近のコマンド失敗（不正なタグ・非対応API・gesture 制約による reject）、または `null`。 |

`active` は、`enterpictureinpicture`/`leavepictureinpicture` が**その対象要素自身に**発火するたびに、`document.pictureInPictureElement` と解決済み `<video>` target を比較して導出されます（`document` レベルのイベントではありません — 詳細は下記「イベント購読」参照）。

## コマンド

| コマンド                      | 説明 |
|-------------------------------|------|
| `requestPictureInPicture()`   | `target` の `<video>` を解決し、Picture-in-Picture を要求する。例外を投げない: `<video>` でない target・非対応API・gesture 制約による reject（`NotAllowedError`）は全て `error` に集約される。 |
| `exitPictureInPicture()`      | Picture-in-Picture を終了する。何も PiP 中でなければ**silent no-op**（`@wcstack/fullscreen` の `exitFullscreen()` と同型 — `docs/fullscreen-tag-design.md` §7 参照）。 |

### ユーザージェスチャー要件

`requestPictureInPicture()` はユーザージェスチャー内（例: クリックハンドラ）から呼び出す必要があります。これはブラウザレベルの要件であり `<wcs-pip>` では回避できません — Fullscreen における同じ制約は `docs/fullscreen-tag-design.md` §3 を参照してください。command-token プロトコルでクリックへ直接配線することを推奨します:

```html
<button command.click:$command.requestPictureInPicture>ポップアウト</button>
```

`setTimeout` の中や `.then()` チェーンの奥から呼び出すと gesture 文脈が失われ、ブラウザがリクエストを拒否します — これは wcstack とは無関係な制約であり、このレイヤーでは修正できません。

## イベント購読先: `document` ではなく `<video>` 要素自身

Fullscreen の `fullscreenchange`（`document` に発火）と異なり、Picture-in-Picture の `enterpictureinpicture`/`leavepictureinpicture` は**`<video>` 要素自身に**発火します。`PipCore` はこれらのリスナーを解決済みの `<video>` に直接張り、`target` が再解決されるたび（例えば `target` 属性の変更）に旧要素から外し新要素に張り替えます。

これにより、複数の `<wcs-pip>` インスタンスは自然に自己フィルタされます。各インスタンスは自分の `<video>` target のイベントのみを受け取るため、あるインスタンスが Picture-in-Picture に入っても他のインスタンスの `active` が誤って `true` になることはありません（`docs/picture-in-picture-tag-design.md` §5 参照）。

## Binding Contract（`wcBindable`）

Core と Shell の両方が [wc-bindable](https://github.com/csbc-dev) プロトコルを宣言します。

```js
// PipCore（ヘッドレス）
PipCore.wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "active", event: "wcs-pip:change", getter: (e) => e.detail.active },
  ],
  commands: [
    { name: "requestPictureInPicture", async: true },
    { name: "exitPictureInPicture", async: true },
  ],
};
```

Shell（`<wcs-pip>`）は Core の `properties`/`commands` を継承し、`target` 入力を宣言します。

## Core 単体での利用

`PipCore` はフレームワーク非依存です。操作したい `<video>` 要素を解決して渡します（Shell はこの解決を代わりに行います）:

```js
import { PipCore } from "@wcstack/picture-in-picture";

const core = new PipCore();
core.addEventListener("wcs-pip:change", (e) => {
  console.log(e.detail.active);
});

const video = document.querySelector("video");
core.observe(video);            // enterpictureinpicture/leavepictureinpicture を購読
await core.requestPictureInPicture(video);

// 後で
await core.exitPictureInPicture();
core.dispose();                 // リスナーを外す
```

## 注意・制限

- **`<video>` 限定。** `target` は `HTMLVideoElement` に解決される必要があります。それ以外の要素は未解決扱いになり、`error` に `{ message: "target must be a <video> element." }` がセットされます（例外は投げません）。
- **Document Picture-in-Picture API はスコープ外。** 上記「スコープ」参照。
- **例外を投げない。** 非対応環境・不正なタグの target・gesture 制約による reject は全て `error` に集約されます。
- **`document.pictureInPictureElement` は document 全体で単一の値**です（`document.fullscreenElement` と同様）。複数の `<wcs-pip>` インスタンスは、自分の `<video>` target の `enterpictureinpicture`/`leavepictureinpicture` リスナーによって自己フィルタされます — 上記「イベント購読先」参照。
- **`desired`/`actual` の二相 state は無し** — 本ノードは単一の `active` boolean と `error` のみを公開し、`permission` より単純な `@wcstack/fullscreen` の state モデルと同型です。

## ライセンス

MIT
