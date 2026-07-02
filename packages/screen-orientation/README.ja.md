# @wcstack/screen-orientation

`@wcstack/screen-orientation` は wcstack エコシステム向けのヘッドレスな Screen Orientation コンポーネントです。

視覚的な UI ウィジェットではありません。`screen.orientation` をリアクティブな state に変え、`lock()`/`unlock()` を宣言的コマンドとして公開する**非同期プリミティブノード**です。

`@wcstack/state` と組み合わせると、`<wcs-screen-orientation>` はパス契約で直接バインドできます:

- **入力サーフェス**: 無し — `screen.orientation` は設定すべきものを持たない単一のグローバル
- **出力 state サーフェス**: `type`、`angle`、`portrait`、`landscape`、`error`

## なぜ存在するか — このバッチで唯一のmonitor/command非対称性

`@wcstack/network`（純粋なmonitor）と異なり、本ノードは**双方向**です: orientationを監視しつつ`lock()`/`unlock()`コマンドも公開します。これにより内部に顕著な非対称性が生じます:

- **監視には`_gen`世代ガードが不要。** `screen.orientation`の`change`イベント購読は完全に同期的——`dispose()`とレースしうる非同期probeの解決が存在しません（`@wcstack/network`と同じ理由）。
- **`lock()`には必要。** 非同期・in-flightであり、古い`lock()`呼び出しの解決が、より新しい`lock()`/`unlock()`呼び出しが確立した状態を上書きしてはなりません。このガードは監視パスとは完全に独立しています。

> **`lock()`はbest-effort。** 多くのデスクトップブラウザはモバイル/フルスクリーン文脈以外で`NotSupportedError`をrejectします。never-throw: 失敗は呼び出し元から見てrejectされたpromiseとしてではなく、`error`に着地します。

## インストール

```bash
npm install @wcstack/screen-orientation
```

## クイックスタート

### 1. 向きをライブ表示

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/screen-orientation/auto"></script>

<wcs-state>
  <script type="module">
    export default { portrait: true };
  </script>
</wcs-state>

<wcs-screen-orientation data-wcs="portrait: portrait"></wcs-screen-orientation>
<template data-wcs="if: !portrait">
  <p>デバイスを縦向きにしてください。</p>
</template>
```

### 2. コマンドで向きをロックする

```html
<wcs-screen-orientation data-wcs="command.lock: $command.lockLandscape; error: lockError"></wcs-screen-orientation>
<button data-wcs="onclick: lockLandscape">横向きに固定</button>
```

```js
export default {
  lockError: null,
  lockLandscape() {
    this.$command.lock.emit("landscape");
  },
};
```

## 観測可能プロパティ（出力）

| プロパティ  | イベント                  | 説明 |
| ----------- | -------------------------- | ---- |
| `type`      | `wcs-orientation:change`   | `screen.orientation.type`（例: `"portrait-primary"`）、非対応環境では`null`。 |
| `angle`     | `wcs-orientation:change`   | `screen.orientation.angle`、非対応環境では`null`。 |
| `portrait`  | `wcs-orientation:change`   | `type`が`"portrait"`で始まれば`true`。 |
| `landscape` | `wcs-orientation:change`   | `type`が`"landscape"`で始まれば`true`。 |
| `error`     | `wcs-orientation:error`    | 直近の`lock()`/`unlock()`の失敗、無ければ`null`。 |

`type`/`angle`/`portrait`/`landscape`は全て単一の`wcs-orientation:change`イベントから派生します。

## コマンド

| コマンド | 非同期 | 説明 |
| -------- | ------ | ---- |
| `lock`   | はい   | 特定の向きへのロックを要求（例: `"landscape"`、`"portrait-primary"`）。値は素通し——never-throw、未知の文字列や非対応環境は`error`へ。 |
| `unlock` | いいえ | 直前のロックを解除。プラットフォームAPIと同じく同期的。 |

## 属性 / 入力

**無し。** `screen.orientation`は単一のグローバルであり、インスタンスごとに設定すべきものがありません。

## 注意・制限

- 監視に**secure-context制約は無し**（`@wcstack/geolocation`/`@wcstack/permission`とは異なる）。
- **`lock()`の対応状況はブラウザによって大きく異なります** — 多くのデスクトップブラウザはモバイル/フルスクリーン文脈以外でrejectします。best-effortであることを前提にUIを設計してください。
- **SSR（`@wcstack/server`）。** `static hasConnectedCallbackPromise = true`を宣言。監視が同期的なため`connectedCallbackPromise`は常に即座にsettleします。

## ヘッドレス利用（`ScreenOrientationCore`）

```typescript
import { ScreenOrientationCore } from "@wcstack/screen-orientation";

const core = new ScreenOrientationCore();
core.addEventListener("wcs-orientation:change", (e) => {
  console.log((e as CustomEvent).detail); // { type, angle }
});

core.observe();
await core.lock("landscape");
console.log(core.error);

// 後始末:
core.dispose();
```

## ライセンス

MIT
