# @wcstack/pointer-lock

`@wcstack/pointer-lock` は wcstack エコシステム向けのヘッドレスな Pointer Lock API コンポーネントです。

視覚的な UI ウィジェットではありません。
`@wcstack/fullscreen` が Fullscreen API のアクティブ状態をリアクティブな state に変えるのと同じように、Pointer Lock API のロック状態をリアクティブな state に変える **非同期プリミティブノード** です。

`@wcstack/state` と組み合わせると、`<wcs-pointer-lock>` はパス契約で直接バインドできます:

- **入力サーフェス**: `target`
- **出力 state サーフェス**: `active`、`error`
- **コマンド**: `requestPointerLock`、`exitPointerLock`

`@wcstack/pointer-lock` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core**（`PointerLockCore`）が `Element.requestPointerLock()` / `document.exitPointerLock()` / `document.pointerLockElement` をラップし、`document`単位で発火する `pointerlockchange` イベントを自身が解決した target と自己判定でフィルタする
- **Shell**（`<wcs-pointer-lock target="...">`）がDOMから「どの要素を操作するか」を解決し、display とライフサイクルを管理
- **Binding Contract**（`static wcBindable`）が観測可能な `active` プロパティと `requestPointerLock`/`exitPointerLock` コマンドを宣言

## 用途が限定的なノード — 使う前に必ず読んでください

他の大半の wcstack IO ノードと異なり、`<wcs-pointer-lock>` は本プロジェクトの主眼である**宣言的な SPA UI 構築**を主たる対象としていません。Pointer Lock API の実際の用途はほぼ排他的に、マウスの**相対移動量**（`movementX`/`movementY`）を必要とする**ゲームや canvas/WebGL 描画 UI**（FPS視点操作、お絵描きツールのパン操作等）に限られます。こうした利用者は多くの場合すでに命令的な `requestAnimationFrame` ループを回しており、動画プレイヤーが `<wcs-fullscreen>` を使う場合ほど、入力を宣言的なバインディング層経由にする動機は強くありません。

このノードは「ロックのON/OFFを切り替える宣言的なスイッチ」（例: command-token プロトコル経由の「マウスルック有効化」ボタン）が欲しい場合に使ってください。`movementX`/`movementY` の取得源としては使えません（後述）。

## `movementX`/`movementY` はスコープ外（v1）

ポインタロック中に発火する `mousemove` イベントは `movementX`/`movementY`（相対移動量）を持ちますが、**本Coreは現時点のいかなるバージョンでもこれを公開しません。** これらは高頻度データ（環境によっては毎秒数百イベントに達しうる）であり、本プロトコルが前提とする同値ガード付きの宣言的 `properties` モデルに馴染みません。そのまま `wc-bindable` に流すと、バインドされた state を毎フレーム単位の更新で溢れさせるリスクがあります。

将来のバージョンで追加する場合の設計意図（`docs/pointer-lock-tag-design.md` §3 参照）は、明示的な opt-in の背後に置き、`@wcstack/debounce`/`@wcstack/throttle` と組み合わせてレート制限することです。これにより、opt-in していないインスタンスには「無制限のファイアホースを流さない」という性質を保てます。現時点で生の `movementX`/`movementY` が必要な場合は、本ノードの `active` state と並行して、自前の命令的コードで `mousemove` を直接読んでください。

## `target` 属性がロック対象を決める

`@wcstack/fullscreen` と同様、この Shell は**自分自身をロックしません** — `target` 属性で指し示した**参照先の要素**を操作する非表示の制御タグであり、`@wcstack/intersection` と同じ3モード解決を使います:

| `target`         | 操作対象                  | `display`   |
|------------------|--------------------------|-------------|
| 省略             | 先頭の子要素              | `contents`  |
| `"#selector"`    | 一致した要素               | `none`      |
| `"self"`         | 自分自身                  | `block`     |

## インストール

```bash
npm install @wcstack/pointer-lock
```

## クイックスタート

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/pointer-lock/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["lockPointer", "unlockPointer"],
      locked: false,
    };
  </script>
</wcs-state>

<canvas id="scene" width="640" height="480"></canvas>
<wcs-pointer-lock target="#scene"
  data-wcs="active: locked; command.requestPointerLock: $command.lockPointer; command.exitPointerLock: $command.unlockPointer">
</wcs-pointer-lock>

<button data-wcs="onclick: $command.lockPointer">マウスルックを有効化</button>
<button data-wcs="hidden: locked|not; onclick: $command.unlockPointer">解除</button>
```

ボタンは`<wcs-pointer-lock>`に直接触れません。クリックが`lockPointer`/`unlockPointer`コマンドトークンを発行し、`<wcs-pointer-lock>`が`command.requestPointerLock: $command.lockPointer` / `command.exitPointerLock: $command.unlockPointer`でそれを購読します（[command-tokenプロトコル](../state/) — commandメソッドを持つ要素が*購読者*であり、発行者ではありません）。

バインドするstateパスは事前にすべて宣言する必要があります — ここでは`locked: false`。未宣言パスをバインドすると初期化時に例外になります。`data-wcs`パス内の否定は先頭`!`ではなく`|not`フィルタ（`locked|not`）で行います — パスはプレフィックス演算子をサポートしません。

`requestPointerLock()` は **user gesture 文脈を必須とします** — 後述。

## user gesture 制約

`Element.requestPointerLock()` はuser gesture文脈（同期的なクリックハンドラ等）の外から呼ばれると `NotAllowedError` で reject します。本ノードは自らgestureを生成できません。**実際のuser gesture内から`requestPointerLock`を呼ぶ責務は呼び出し元にあります。** command-token プロトコル（`<wcs-pointer-lock>`上の`command.requestPointerLock: $command.<token>`、ボタンの`onclick: $command.<token>`が発行する）を配線してください — `setTimeout`内や`.then()`チェーンの奥から呼ぶとgesture文脈を失い呼び出しがrejectされますが、例外は伝播しません（never-throw、`error`に格納されます）。

## 観測可能プロパティ（出力）

| プロパティ | イベント                    | 説明 |
| ---------- | ---------------------------- | ------------ |
| `active`   | `wcs-pointer-lock:change`    | `document.pointerLockElement` がこのインスタンスの解決済み target と一致していれば `true`、それ以外は `false`。 |

`error`（後述コマンド参照）は単純な getter として公開され、`wcBindable` の property ではありません — コマンド呼び出しの副作用としてのみ変化します（`@wcstack/fullscreen` と同型）。直近の失敗は次のいずれか: rejectされたPromise（gesture外呼び出しなら`NotAllowedError`等）、プラットフォームAPI非対応なら`{ message: "Pointer Lock API is not supported." }`、`target`が要素へ未解決なら`{ message: "Pointer Lock target could not be resolved." }`。直近の呼び出しが成功済み・まだ何も失敗していない場合は`null`。

## コマンド

| コマンド              | Async | 説明 |
| --------------------- | ----- | ------------ |
| `requestPointerLock`  | あり  | `target`を解決し、それに対して`requestPointerLock()`を呼びます。never-throw: 失敗（targetが未解決、gesture不在の`NotAllowedError`、非対応API等）は例外でなく `error` に格納されます。 |
| `exitPointerLock`     | **無し** | `document.exitPointerLock()` を呼びます。**同期API** — `@wcstack/fullscreen`の`exitFullscreen()`（Promiseベース）と異なり、`exitPointerLock()`は`void`を返します。何もロックされていない、またはAPI非対応時はsilent no-opです。 |

## 属性 / 入力

| 属性      | 説明 |
| --------- | ------------ |
| `target`  | ロック対象の要素を指すセレクタ（または`"self"`）。上記「`target`属性がロック対象を決める」を参照。省略時は先頭の子要素。 |

## `:state()` による CSS スタイリング

`<wcs-pointer-lock>` は `active` 出力を
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `active` | `wcs-pointer-lock:change` が `true` で発火（`false` でクリア） |

```css
wcs-pointer-lock:state(active) ~ .crosshair { display: block; }
wcs-pointer-lock:state(active) ~ .crosshair { display: none; } /* デフォルト */
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。`error` はあえて反映していません — 上記「観測可能プロパティ」参照。
単純な getter として公開されるのみで、`wcBindable` の property ではありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-pointer-lock>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-pointer-lock:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["active"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-active` 属性にミラーします。
  Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-pointer-lock target="#scene" debug-states></wcs-pointer-lock>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## 複数インスタンス — 「documentがロック中か」ではなくインスタンスごとに`active`を見る

`document.pointerLockElement` はdocument全体で単一の値しか持ちません（同時にロックできる要素は高々1つ）。複数の`<wcs-pointer-lock>`インスタンス（例: `target="#a"`と`target="#b"`）が同時に存在する場合、各インスタンスは`document.pointerLockElement`を**自分自身の**解決済みtargetと比較します（単に「documentがロック中か」ではありません）。`#a`をロックすると、`target="#a"`のインスタンスは`active: true`、`target="#b"`のインスタンスは`active: false`を報告します — document全体では何か（`#a`）がロックされているにもかかわらずです。

## ベンダープレフィックス

一部の古いWebKit実装は標準名の代わりに`webkitRequestPointerLock`/`webkitExitPointerLock`/`webkitPointerLockElement`/`webkitpointerlockchange`イベントを公開します。API解決は**呼び出し時**（キャッシュしない）に行われ、標準名を優先し、無ければレガシー名にフォールバックします — これにより非対応環境（どちらの名前も存在しない）を正しく検出でき、テストがAPIを自由にinstall/removeできます。

## 注意・制限

- **user gesture が必須。** 上記参照 — プラットフォームの制約であり、本ノードで回避する手段はありません。
- **`exitPointerLock()`は同期API**、`@wcstack/fullscreen`のPromiseベースの`exitFullscreen()`とは異なります。単独の`_gen`世代ガードは持ちません（非同期の`requestPointerLock()`のみがガードを必要とします）。それでも非準拠実装が例外を投げないよう防御的に`try/catch`で包んでいます。
- **`movementX`/`movementY`はv1ではスコープ外。** 上記参照。
- **autoTriggerなし。** `requestPointerLock()`はuser gesture文脈を必要とするため、主な起動経路は`data-*target`のクリックショートカットではなくcommand-tokenプロトコル（`<wcs-pointer-lock>`上の`command.requestPointerLock: $command.<token>`）です。
- **SSR（`@wcstack/server`）。** `static hasConnectedCallbackPromise = true`を宣言し`connectedCallbackPromise`を公開します。`observe()`が同期的なため、このpromiseは常に即座にsettleします。

## ヘッドレス利用（`PointerLockCore`）

CoreはDOM非依存（Pointer Lockプラットフォーム APIの呼び出しを除く）で、`@wc-bindable/core`の`bind()`と直接使えます:

```typescript
import { PointerLockCore } from "@wcstack/pointer-lock";

const lock = new PointerLockCore();
lock.addEventListener("wcs-pointer-lock:change", (e) => {
  console.log((e as CustomEvent).detail); // boolean —新しい active 値そのもの
});

const canvas = document.querySelector("#scene")!;
lock.observe(canvas);              // document の pointerlockchange を購読し、canvas に対して自己判定
await lock.requestPointerLock(canvas); // user gesture 内から呼ぶ必要がある
console.log(lock.active, lock.error);

// 後始末:
lock.exitPointerLock();  // 同期的
lock.dispose();          // document リスナーを外す
```

## ライセンス

MIT
