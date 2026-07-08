# @wcstack/share

`@wcstack/share` は wcstack エコシステム向けのヘッドレスな Web Share コンポーネントです。

視覚的な UI ウィジェットではありません。
`@wcstack/notification` が `Notification` をリアクティブな state と `notify` コマンドに変えるのと同じように、`navigator.share(data)`（クリック→ネイティブ共有シート→resolve/reject）を単一の宣言的コマンドに変える **command 専用の非同期プリミティブノード** です。

`@wcstack/state` と組み合わせると、`<wcs-share>` はパス契約で直接バインドできます:

- **command サーフェス**: `share(data)` — 単一の async command。`command.share: $command.doShare` として起動する
- **出力 state サーフェス**: `value`、`loading`、`error`、`cancelled`

これにより「記事を共有」ボタンを HTML 上で宣言的に表現できます — 成功・失敗・ユーザーがネイティブ共有シートを単に閉じただけ、という3つの異なる結果をそれぞれバインド可能な形で区別しつつ、UI 層で `navigator.share()` / `try`/`catch` の配線を書く必要がありません。

`@wcstack/share` は wcstack の Core/Shell アーキテクチャに従います:

- **Core**（`ShareCore`）が `navigator.share(data)` を単一の `_gen` 世代ガード・同値ガード付き `loading`/`error`/`cancelled` setter（`value` は対象外 — 成功のたびに発火する完了シグナル）・never-throw の `try`/`catch` で包む
- **Shell**（`<wcs-share>`）がそのコマンドを DOM ライフサイクルに接続し、`canShare(data)` を素の同期メソッドとして公開する
- **Binding Contract**（`static wcBindable`）が観測可能な `properties` と単一の `share` コマンドを宣言（そして意図的に **`inputs` も `abort` コマンドも持たない**）

## なぜ存在するか — command 専用ノードであり、キャンセルはエラーではない

他の wcstack IO ノードは、継続的な状態を監視する（`network`、`permission`）か、事前に何かを設定してその変化を観測する（`fetch` の `url`、`geolocation` の `enableHighAccuracy`）かのどちらかです。`navigator.share()` はどちらとも異なり、「呼ぶ→ネイティブ共有シート→resolve/reject」の一撃で完結するアクションであり、設定・監視すべき継続的な状態が存在しません。さらに（`fetch` と異なり）**進行中の呼び出しを中断する手段がありません** — `AbortSignal` オプションが無く、プラットフォームは同時に1つの共有シートしか許可しないため、`fetch` が必要とする「新規呼び出しが旧呼び出しを追い越して中断する」という配線自体が不要になります。

もう一つの重要な決定は **`cancelled` を `error` から分離する** ことです。ユーザーが単にネイティブ共有シートを閉じると、`navigator.share()` は `AbortError` で reject します — `<dialog>` を閉じるのと同じような操作です。これを `error` に含めてしまうと、`error` を条件にしたバインディング（例: 真の失敗時にのみ「共有に失敗しました」バナーを表示する）が、日常的で無害なユーザーキャンセルにも反応してしまい、UX 上の不具合になります。`<wcs-share>` は `cancelled` を独立した boolean/event として持つことで、`error` が **真のプラットフォーム障害だけ**（`NotAllowedError`、`TypeError` 等）を反映するようにしています。

> 設計の全経緯は [`docs/web-share-tag-design.md`](https://github.com/wcstack/wcstack/blob/main/docs/web-share-tag-design.md) を参照してください。

## インストール

```bash
npm install @wcstack/share
```

## クイックスタート

### 1. 記事を共有する（キャンセルは失敗と区別して扱う）

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/share/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["doShare"],
      loading: false,
      error: null,
      cancelled: false,
      onShareClick() {
        this.$command.doShare.emit({
          title: document.title,
          url: location.href,
        });
      },
    };
  </script>
</wcs-state>

<wcs-share
  data-wcs="command.share: $command.doShare; loading: loading; error: error; cancelled: cancelled"
></wcs-share>

<button data-wcs="onclick: onShareClick; disabled: loading">共有</button>
<template data-wcs="if: error">
  <p>共有に失敗しました: <span data-wcs="textContent: error.message"></span></p>
</template>
```

`share()` は実際のユーザー操作（クリックハンドラ）内から呼ばれる必要があるため、ボタンのクリックハンドラが直接 `$command.doShare.emit(...)` を呼びます — `<wcs-share>` 自身は `autoTrigger` のショートカットを持ちません（[注意・制限](#注意・制限)を参照）。

### 2. `canShare(data)` — 事前に実行可能性を確認する

```html
<script type="module">
  const shareEl = document.querySelector("wcs-share");
  if (shareEl.canShare({ url: location.href })) {
    // 共有ボタンを表示する
  }
</script>
```

## 観測可能プロパティ（出力）

| プロパティ   | イベント                        | 説明 |
| ----------- | ------------------------------- | ---- |
| `value`     | `wcs-share:complete`            | 直前に成功した `share()` 呼び出しへ渡された `data` オブジェクトのエコーバックで、「この共有は成功した」という合図（`navigator.share()` 自体はペイロードを持たない `Promise<void>` を返す）。成功した共有が一度も無ければ `null`。 |
| `loading`   | `wcs-share:loading-changed`     | `share()` 呼び出しが進行中なら `true`。 |
| `error`     | `wcs-share:error`               | 真のプラットフォーム障害（ユーザーが共有シートをキャンセルした場合を**除く**すべて）。まだ失敗が無い場合、または次の `share()` 呼び出しでリセットされた後は `null`。 |
| `cancelled` | `wcs-share:cancelled-changed`   | ユーザーがネイティブ共有シートを閉じた（`AbortError`）場合に `true`。`error` を条件にしたバインディングが日常的なキャンセルに反応しないよう、`error` とは独立している。 |

`cancelled` と `error` はどちらも、実際に `navigator.share()` を呼び出す `share()` 呼び出しの **開始時** にリセットされる（`false` / `null`）ため、前回の呼び出しの古い結果がその呼び出しの結果に残り続けることはありません。唯一の例外が unsupported 早期リターン（`navigator.share` が存在しない場合。後述）です — このリセットが走る前に return するため、前回呼び出しの `cancelled` が `true` のまま残り、新たに設定された unsupported の `error` と同時に立つことがあります。`navigator.share` がセッション途中で消失するのは非現実的なため、これは限定的なエッジケースです。

## コマンド

| コマンド | 非同期 | 説明 |
| ------- | ----- | ---- |
| `share` | あり  | `{ title?, text?, url?, files? }` というオプションオブジェクト1個を位置引数として渡し `navigator.share(data)` を呼び出す。 |

**`abort` コマンドはありません** — Web Share API には呼び出し元が進行中の `share()` 呼び出しを中断する手段が存在しません。

## `canShare(data)` — `wcBindable` に属さない素の同期メソッド

`navigator.canShare(data)` は同期・副作用無しの述語関数です。wc-bindable の `properties`（引数無しで観測する形）にも `commands`（起動してイベント経由で結果を受け取る形）にも合わないため、素のインスタンスメソッドとして直接公開されています:

```typescript
const canShare: boolean = shareEl.canShare({ url: "https://example.com" });
```

`navigator.canShare` が存在しない場合は例外を投げず `false` を返します。

## 属性 / 入力

**無し。** `share(data)` の `data` は呼び出しごとに変わる値であり、属性としてあらかじめ要素に貼っておく設定値ではなく、コマンド引数です。

## `:state()` による CSS スタイリング

`<wcs-share>` は 3 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `loading` | `wcs-share:loading-changed` が `true` で発火（`false` でクリア） |
| `cancelled` | `wcs-share:cancelled-changed` が `true` で発火（`false` でクリア） |
| `error` | `wcs-share:error` が非 `null` の detail で発火（`null` でクリア） |

```css
wcs-share:state(loading) ~ .spinner { display: block; }
wcs-share:state(loading) ~ .spinner { display: none; } /* デフォルト */

wcs-share:state(cancelled) ~ .hint { display: block; }
form:has(wcs-share:state(error)) .banner { display: block; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-share>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-share:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["loading"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-loading` / `data-wcs-state-cancelled` /
  `data-wcs-state-error` 属性にミラーします。
  Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-share debug-states></wcs-share>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## 注意・制限

- **`autoTrigger` を持たない。** `navigator.share()` は実際のユーザー操作の文脈内から呼び出す必要があります。ノード側が自動トリガーを提供しても、そのトリガー自体がジェスチャー文脈を継承しないため、`@wcstack/fullscreen` と同様にこのノードは自動トリガーを持ちません。クリックハンドラを直接 `$command.doShare.emit(...)` に配線してください。
- **`abort` コマンドを持たない。** 進行中の `navigator.share()` 呼び出しを中断するプラットフォーム機構が存在しません。
- **`cancelled` は `error` と独立している。** `AbortError`（ユーザーが共有シートを閉じた）は `cancelled` のみを設定し、`error` には触れません。それ以外の reject はすべて `error` のみを設定し、`cancelled` には触れません。
- **`unsupported` 専用フラグは持たない。** `navigator.share` が関数でない状態で `share()` を呼ぶと、即座に `error` が `{ message: "Web Share API is not supported in this browser." }` になり `null` で解決します — 非同期処理を開始しないため `_gen` は消費されません。事前に UI を隠したい場合は `canShare` または `typeof navigator.share` を確認してください。
- **SSR（`@wcstack/server`）。** `static hasConnectedCallbackPromise = true` を宣言し `connectedCallbackPromise` を公開します。非同期 probe が無いため、この promise は常に即座に settle します（`ready` は `Promise.resolve()` 固定）。
- **同値ガードは `loading`/`error`/`cancelled` に適用され、`value` には適用されない。** これら3つの setter は idempotent state であるため、値が実際に変化したとき（参照等価 `===`）のみ発火します。`value` は異なり、**成功完了シグナル**であって `wcs-share:complete` が唯一の成功通知であるため、成功した `share()` の**たびに**発火します（同値ガード無し）。したがって、`data` 引数無しの `share()`（`value` が既に `null` のときに `null` を echo）でも `wcs-share:complete` を発火し、**同一のオブジェクト参照**を `data` として渡す2回連続の成功した `share()` は `wcs-share:complete` を**2回**発火します（完了ごとに1回）。これは `@wcstack/clipboard`（`read`）や `@wcstack/broadcast`（`message`）が結果/イベント値を扱う方針と同じです — 完了は「発生」であって idempotent state ではありません。

## ヘッドレス利用（`ShareCore`）

Core は DOM 非依存で、直接利用できます:

```typescript
import { ShareCore } from "@wcstack/share";

const share = new ShareCore();
share.addEventListener("wcs-share:complete", (e) => {
  console.log((e as CustomEvent).detail.value); // エコーバックされた data
});
share.addEventListener("wcs-share:cancelled-changed", (e) => {
  console.log("cancelled:", (e as CustomEvent).detail);
});

await share.share({ title: "Article", url: location.href });

// 後始末:
share.dispose(); // 進行中の share() を無効化し、stale な resolve を破棄する
```

## ライセンス

MIT
