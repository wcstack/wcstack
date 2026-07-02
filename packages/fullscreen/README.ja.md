# @wcstack/fullscreen

`@wcstack/fullscreen` は wcstack エコシステム向けのヘッドレスな Fullscreen API コンポーネントです。

視覚的な UI ウィジェットではありません。
**制御ノード**です。大半の wcstack IO ノードは自分自身を操作対象としますが、`<wcs-fullscreen>` は `@wcstack/intersection` が自分自身ではなく参照先の要素を観測するのと同じように、`target` で指し示した**参照先の要素**に対して `requestFullscreen()` / `exitFullscreen()` を実行します。

`@wcstack/state` と組み合わせると、`<wcs-fullscreen>` はパス契約で直接バインドできます:

- **入力サーフェス**: `target`（操作対象の要素。下記参照）
- **出力 state サーフェス**: `active`、`error`
- **コマンド**: `requestFullscreen()`、`exitFullscreen()`

`@wcstack/fullscreen` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core**（`FullscreenCore`）が Fullscreen API を操作し、`document` の `fullscreenchange` イベントを追従
- **Shell**（`<wcs-fullscreen target="...">`）が `target` を DOM 要素へ解決し、Core の state を DOM ライフサイクルに接続
- **Binding Contract**（`static wcBindable`）が観測可能な `active` プロパティと `requestFullscreen`/`exitFullscreen` コマンドを宣言

## なぜ存在するか — 操作対象は「タグ自身」ではなく「参照先」

`Element.requestFullscreen()` はfullscreen化したい要素（画像・動画・カードUIなど）に対するメソッドであり、`<wcs-fullscreen>` 自身に対するものではありません。そのため本タグは非表示の制御要素（既定で `display:none`）として存在し、`<wcs-intersect>` と全く同じ規則で `target` 属性を介して別の要素を指し示します:

| `target`             | 操作対象                  | display     | 典型的な用途                |
| --------------------- | -------------------------- | ------------ | ---------------------------- |
| 省略                  | 最初の子要素                | `contents`   | ギャラリー画像/動画をラップ  |
| `"#hero"` / セレクタ | マッチした要素              | `none`       | 離れた要素を指し示す          |
| `"self"`              | 自分自身                    | `block`      | ラッパー自体をfullscreen化   |

## インストール

```bash
npm install @wcstack/fullscreen
```

## クイックスタート

### 1. ボタンクリックで画像をfullscreen化

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/fullscreen/auto"></script>

<wcs-state>
  <script type="module">
    export default {};
  </script>
</wcs-state>

<wcs-fullscreen target="#hero" id="fs"></wcs-fullscreen>
<img id="hero" src="/photo.jpg">
<button command.click:$command.requestFullscreen $for="fs">Fullscreen</button>
```

### 2. 動画をラップし、fullscreen中のみ終了ボタンを表示

```html
<wcs-fullscreen data-wcs="active: isFullscreen">
  <video src="/movie.mp4" controls></video>
</wcs-fullscreen>
<button data-wcs="hidden: !isFullscreen" command.click:$command.exitFullscreen>終了</button>
```

## 観測可能プロパティ（出力）

| プロパティ | イベント                | 説明 |
| ----------- | ------------------------ | ---- |
| `active`    | `wcs-fullscreen:change`  | `document.fullscreenElement` が**このインスタンスが解決したtarget**と一致している間 `true`、それ以外は `false`。 |
| `error`     | *（無し — 単純なgetter）* | 直近の失敗（rejectされたPromise、または非対応APIの場合は `{ message }`）、直近の呼び出しが成功済み・まだ何も失敗していない場合は `null`。 |

## コマンド

| コマンド               | 非同期 | 説明 |
| ----------------------- | ------ | ---- |
| `requestFullscreen()`   | あり  | `target` を解決し、その要素に対して `requestFullscreen()` を呼ぶ。 |
| `exitFullscreen()`      | あり  | `document.exitFullscreen()` を呼ぶ。何もfullscreenでなければ何もせず終了する（silent no-op）。 |

## 属性 / 入力

| 属性      | 説明 |
| ---------- | ---- |
| `target`   | `@wcstack/intersection` の `target` と同じ3モード解決: `"self"`、CSSセレクタ、または省略（最初の子要素）。 |

## 注意・制限

- **user gesture制約。** `requestFullscreen()` は実際のuser gesture（クリックハンドラ等）内から同期的に呼ばれた場合のみ成功します。本ノードはgestureを生成できません — command-tokenプロトコル経由（`command.click:$command.requestFullscreen`）で呼び出す場合は、**起動元のイベント自体**が本物のuser gestureであることを確認してください。`setTimeout` の中やPromiseチェーンの奥深くから呼び出すと、呼び出し方法に関わらず `NotAllowedError` でrejectされます — これはブラウザレベルの制約であり、wcstack側で回避する手段はありません。
- **ベンダープレフィックス。** 一部の古いSafariバージョンは `webkitRequestFullscreen` / `webkitExitFullscreen` / `webkitFullscreenElement` / `webkitfullscreenchange` のみを実装しています。Coreは標準名を優先的にプローブし、**呼び出しの都度**（非キャッシュ）レガシー名にフォールバックするため、両方とも透過的にサポートされます。
- **複数インスタンス。** `document.fullscreenElement` はdocument全体で単一の値です。異なるtargetを指す複数の `<wcs-fullscreen>` インスタンスが存在する場合、`target` が `document.fullscreenElement` と一致するインスタンスのみが `active: true` を報告し、他は正しく `false` を報告します。各インスタンスは内部で**自分自身が解決したtarget**を追跡しており、単純に「何かがfullscreenかどうか」をミラーしているわけではありません。
- **`exitFullscreen()` は安全なno-op。** 何もfullscreenでない状態（またはAPI非対応）で呼び出してもエラーなくresolveします — 失敗しうる事前条件チェックではなく、べき等な「fullscreenでないことを保証する」コマンドとして扱われます。
- **`error` に専用イベントは無い。** 大半のwcstack IOノードと異なり、`error` は専用の `wcs-fullscreen:error` イベントを持たない単純なgetterです — コマンドがsettleした後に読み取ってください（または直接バインドすれば、コマンド完了のたびに `active` と一緒に変化します）。
- **`_gen` 世代ガード。** `dispose()` 後（または後続の呼び出しに追い越された後）にsettleした進行中の `requestFullscreen()`/`exitFullscreen()` 呼び出しは、破棄済みの状態を書き換えません。
- **SSR（`@wcstack/server`）。** `static hasConnectedCallbackPromise = true` を宣言し `connectedCallbackPromise` を公開しますが、`fullscreenchange` の購読が同期的なため、この promise は常に即座に settle します。

## ヘッドレス利用（`FullscreenCore`）

CoreはDOM依存が `document` と明示的に渡された対象 `Element` のみで、セレクタの解決自体は一切行いません:

```typescript
import { FullscreenCore } from "@wcstack/fullscreen";

const core = new FullscreenCore();
core.addEventListener("wcs-fullscreen:change", (e) => {
  console.log((e as CustomEvent).detail); // { active: true | false }
});

await core.observe();                    // document の fullscreenchange を購読
await core.requestFullscreen(myElement); // user gesture 内から呼ぶ必要がある
console.log(core.active);                // fullscreenchange で確認されると true

await core.exitFullscreen();
core.dispose();                          // fullscreenchange リスナーを外す
```

## ライセンス

MIT
