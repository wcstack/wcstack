# @wcstack/notification

`@wcstack/notification` は wcstack エコシステム向けのヘッドレスなデスクトップ通知コンポーネントです。

ビジュアルな UI ウィジェットではありません。
Notifications API をリアクティブな state と state 駆動のコマンドに変換する**非同期プリミティブノード**です —— `@wcstack/geolocation` がデバイスの位置をリアクティブな state に変えるのと同じ発想です。

`@wcstack/state` と組み合わせると、`<wcs-notify>` はパス契約で直接バインドできます:

- **command サーフェス**: `request`, `notify`, `close`, `closeAll`
- **input サーフェス**: `notice`（reactive な表示）, `mode`, `body`, `icon`, `badge`, `tag`, `lang`, `dir`, `require-interaction`, `silent`, `renotify`, `manual`
- **output state サーフェス**: `permission`, `granted`, `denied`, `prompt`, `unsupported`, `error`, `clicked`, `closed`, `shown`

`@wcstack/notification` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core**（`NotificationCore`）が権限・表示（コンストラクタ or Service Worker）・クリック中継を担う
- **Shell**（`<wcs-notify>`）がそれを DOM 属性・reactive な `notice` 入力・ライフサイクルに接続する
- **Binding Contract**（`static wcBindable`）が observable な `properties`・`inputs`・`commands` を宣言する

## なぜ存在するか —— 双方向が 1 つのタグで完結

多くの wcstack IO ノードは片方向に寄っています: `<wcs-permission>` は*監視*のみ（Permissions API に `request()` が無いのでコマンドが無い）、`<wcs-speak>`/`<wcs-listen>` は双対を 2 タグに分割します。Notifications API は違い、**1 つの API で本当に双方向**です:

- **表示**はコマンド（state → 要素）: `notify(title, options)`。
- **クリック / クローズ / 表示**はイベント（要素 → state）: ユーザーが OS 通知を操作する。

つまり `<wcs-notify>` は **command-token**（表示）と **event-token**（クリック）が 1 つのタグに同居する wcstack 初のノードです。さらに `<wcs-permission>` と違い Notifications API には `Notification.requestPermission()` があるため、このノードは**自己完結**します —— 権限の要求/監視と通知の表示を両方担います。

> **secure context が必要。** Notifications API は secure context（HTTPS か `localhost`）でのみ動作します。利用できない環境では `<wcs-notify>` は throw せず `permission = "unsupported"` を報告します。権限要求と表示は通常ユーザージェスチャを要するため、タイマーから `notify` を撃っても何も表示されないことがあります。

## インストール

```bash
npm install @wcstack/notification
```

## クイックスタート

### 1. 要求してから表示する —— state から

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/notification/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["request", "notify"],
      $eventTokens: ["opened"],
      ask()  { this.$command.request.emit(); },
      send() { this.$command.notify.emit("New message", { body: "Tap to open", tag: "chat", data: { room: 7 } }); },
      $on: {
        opened: (state, event) => { console.log("clicked", event.detail); }, // { tag, data, action }
      },
    };
  </script>
</wcs-state>

<wcs-notify data-wcs="
  command.request: $command.request;
  command.notify:  $command.notify;
  eventToken.clicked: opened
"></wcs-notify>

<button data-wcs="onclick: ask">Allow notifications</button>
<button data-wcs="onclick: send">New message</button>
```

`notify.emit(title, options)` の位置引数はそのまま `notify(title, options)` へ素通しされます —— `<wcs-speak>`/`<wcs-fetch>` と同じ引数転送契約です。

### 2. reactive な `notice` と 命令的な `notify`

```html
<!-- reactive: 束縛値が「変化」したときに表示（same-value ガードつき）。 -->
<wcs-notify data-wcs="notice: statusMessage | debounce(1000)"></wcs-notify>
```

`notice` は `notify` の宣言的カウンターパートです: 変化した値を書くと表示し、同値の書き込みは抑制します。命令的な `notify` コマンドは毎回（同じテキストでも）発火します。state 変化のたびに自動発火すると通知スパムの危険があるため、束縛元を debounce し、`tag` を付けて OS 側で de-dup させるとよいです。

### 3. 権限をバインド可能な state として

```html
<wcs-notify data-wcs="permission: notifyPerm; granted: canNotify"></wcs-notify>

<!-- ブール 1 つでノードから直接 -->
<div data-wcs="hidden: canNotify">通知を許可してアラートを受け取ってください。</div>
```

`permission` は `"prompt"` / `"granted"` / `"denied"` / `"unsupported"`。Notifications API 自身の `"default"` は `"prompt"` に正規化され、`@wcstack/permission` / `@wcstack/geolocation` と同じ 4 値サーフェスを共有します。

### 4. クリックを読む

```html
<wcs-notify data-wcs="command.notify: $command.notify; eventToken.clicked: opened"></wcs-notify>
```

`clicked` / `closed` / `shown` は `{ tag, data, action }` を運びます。`tag` は通知の識別子（あなたの `options.tag`、省略時は生成された `wcs-<n>`）、`data` は `options.data` に渡した値、`action` は Service Worker のアクションボタン id（コンストラクタ経路では常に `""`）です。

完全なデモは `examples/state-notification-chat` を参照。

## Service Worker / モバイル

`new Notification()` はデスクトップでのみ動作します。Android Chrome では throw し、`ServiceWorkerRegistration.showNotification()` が必須です。`<wcs-notify>` は `mode` で経路を選びます:

| `mode`        | 挙動                                                                              |
| ------------- | --------------------------------------------------------------------------------- |
| `auto`（既定）| `Notification` コンストラクタを試し、`TypeError`（モバイル）なら SW にフォールバック。 |
| `constructor` | コンストラクタのみ。`TypeError` は `error` として表面化（フォールバック無し）。    |
| `sw`          | 常に `ServiceWorkerRegistration.showNotification()`。                             |

SW の `notificationclick` は**あなたの** Service Worker 内で発火し、本パッケージはそこにコードを注入できません。1 行のヘルパを import してクリックをページへ中継してください:

```js
// あなたの sw.js
import { wireNotificationClicks } from "@wcstack/notification/sw";
wireNotificationClicks();
```

各クリックを `BroadcastChannel("wcs-notify")`（主）と `clients.postMessage`（フォールバック）で中継し、ページの `NotificationCore` が 2 経路を de-dup して `wcs-notify:click` を発火します。

## 属性 / Inputs

| 属性                  | 型      | 既定    | 説明                                                                        |
| --------------------- | ------- | ------- | --------------------------------------------------------------------------- |
| `mode`                | string  | `auto`  | 表示経路: `auto` / `sw` / `constructor`。                                   |
| `body`                | string  | `""`    | 通知の本文。                                                                |
| `icon`                | string  | `""`    | アイコン URL。                                                              |
| `badge`               | string  | `""`    | バッジ URL（モノクロ・モバイル）。                                          |
| `tag`                 | string  | `""`    | 通知タグ（同一タグの通知は OS が置換する）。                                |
| `lang`                | string  | `""`    | 言語タグ。                                                                  |
| `dir`                 | string  | `""`    | 文字方向: `auto` / `ltr` / `rtl`。                                          |
| `require-interaction` | boolean | `false` | ユーザーが閉じるまで表示し続ける。                                          |
| `silent`              | boolean | `false` | 音/バイブを抑制。                                                           |
| `renotify`            | boolean | `false` | 同一タグ通知の置換時に再アラート。                                          |
| `manual`              | boolean | `false` | reactive な `notice` 経路をミュート（`notify` コマンドは有効なまま）。      |

`notice` は reactive な入力（属性なし）: 変化した値を書くと通知を表示します。`notify(title, options)` の per-call オプションはこれら属性既定値にキー単位で優先します。

## Observable プロパティ（出力）

| プロパティ    | イベント                       | 説明                                                              |
| ------------- | ------------------------------ | ----------------------------------------------------------------- |
| `permission`  | `wcs-notify:permission-change` | `"prompt"` / `"granted"` / `"denied"` / `"unsupported"`、live。    |
| `granted` / `denied` / `prompt` / `unsupported` | `wcs-notify:permission-change` | `permission` から派生する便宜ブール。 |
| `error`       | `wcs-notify:error`             | 失敗時の `{ error, message }`（never-throw）、無ければ `null`。    |
| `clicked`     | `wcs-notify:click`             | 直近クリックの `{ tag, data, action }`（event-token 源）。        |
| `closed`      | `wcs-notify:close`             | 直近クローズの `{ tag, data, action }`。                          |
| `shown`       | `wcs-notify:show`              | 直近表示の `{ tag, data, action }`。                              |

## コマンド

| コマンド     | 説明                                                                              |
| ------------ | --------------------------------------------------------------------------------- |
| `request()`  | `Notification.requestPermission()`。正規化した権限状態を解決する。                |
| `notify(title, options?)` | 通知を表示し、識別タグを返す。                                       |
| `close(tag)` | `tag` の通知を閉じる。                                                            |
| `closeAll()` | この要素が表示した全通知を閉じる。                                                |

## `:state()` による CSS スタイリング

`<wcs-notify>` は 5 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `granted` | `wcs-notify:permission-change` が `"granted"` で発火 |
| `denied` | `wcs-notify:permission-change` が `"denied"` で発火 |
| `prompt` | `wcs-notify:permission-change` が `"prompt"` で発火 |
| `unsupported` | `wcs-notify:permission-change` が `"unsupported"` で発火 |
| `error` | `wcs-notify:error` が非 `null` の detail で発火（`null` でクリア） |

`granted` / `denied` / `prompt` / `unsupported` は**相互排他群**です:
`permission-change` イベント 1 回につき 4 つのうち 1 つだけが on になり、
残り 3 つは同じパスで off にクリアされます。

```css
wcs-notify:state(denied) ~ .fallback { display: block; }
wcs-notify:state(unsupported) ~ .fallback { display: block; }

form:has(wcs-notify:state(error)) .banner { display: block; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-notify>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-notify:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["granted"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-granted` / `data-wcs-state-denied` /
  `data-wcs-state-prompt` / `data-wcs-state-unsupported` /
  `data-wcs-state-error` 属性にミラーします。
  Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-notify debug-states></wcs-notify>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## 注意・制限

- **通知はページより長生きする。** `<wcs-notify>` の切断（または Core の `dispose()`）は購読を解除しますが、開いている通知は**閉じません** —— 通知はページの終了後も残ることが意図です。閉じるには `close` / `closeAll` を使ってください。
- **`mode` は接続時に固定される。** バックエンドは要素の接続時（`observe(mode)`）に一度だけ選択され、`mode` の `observedAttributes` エントリはありません。接続済みの要素で `mode` 属性を変更しても、要素を再接続（削除して再挿入）するまで効果はありません。
- **SW バックエンドは `close` を中継しない。** `@wcstack/notification/sw` ヘルパは `notificationclick` のみを配線し、`notificationclose` は配線しません。そのため `sw` バックエンドでは `closed` / `wcs-notify:close` は発火しません（close 用のワーカー越え中継がない）。`clicked` はクリック中継で動作しますが、`closed` は constructor バックエンド限定の信号です。
- **Push API はスコープ外。** 本パッケージは Notifications API（ローカル通知）をラップします。サーバ起点の Push は別の関心事です。
- **サイレント失敗（zero-log）。** wcstack のゼロ依存哲学に沿い、`<wcs-notify>` は決してログ出力も throw もしません。API 不在 → `permission = "unsupported"`、未許可や表示失敗 → `error` プロパティ。`error` / `permission` をバインドして反応してください。
- **SSR（`@wcstack/server`）。** `static hasConnectedCallbackPromise = true` を宣言し `connectedCallbackPromise` を公開するため、サーバレンダラは接続時の権限プローブが解決するまで待ってからスナップショットします。

## 設定

`<wcs-notify>` はクリック **autoTrigger** を同梱しており、**既定で有効**です。有効な場合、最初に接続した `<wcs-notify>` が document レベルの `click` リスナーを 1 つ設置します。トリガ属性（`data-notifytarget="<id>"`）を持つ要素をクリックすると、その `id` の `<wcs-notify>` の `notify()` が呼ばれます:

```html
<wcs-notify id="app-notify"></wcs-notify>
<button data-notifytarget="app-notify" data-notifybody="新着メッセージが1件あります">
  通知する
</button>
```

- タイトルは `data-notifytitle` があればそれ、無ければトリガ要素の trim 済み `textContent`。body は任意の `data-notifybody`。
- **document 全域**のクリックリスナーが既定で設置されるため、ショートカットを使わないなら無効化してください。設定は `bootstrapNotification(userConfig?)`（要素登録と設定適用を 1 回で行う）で適用し、`getConfig()` で実効設定（deep-frozen）を読み取れます:

```js
import { bootstrapNotification, getConfig } from "@wcstack/notification";

// <wcs-notify> を登録しつつ document クリックリスナーを無効化:
bootstrapNotification({ autoTrigger: false });
// あるいはトリガ属性名を変更:
bootstrapNotification({ triggerAttribute: "data-notify" });

getConfig(); // deep-frozen の実効設定を読む
```

| 設定キー           | 型        | 既定                | 説明                                                               |
| ------------------ | --------- | ------------------- | ------------------------------------------------------------------ |
| `autoTrigger`      | `boolean` | `true`              | `data-notifytarget` 用の document レベルクリックリスナーを設置。   |
| `triggerAttribute` | `string`  | `data-notifytarget` | クリック要素が `<wcs-notify>` を id で指すのに使う属性。            |
| `tagNames.notify`  | `string`  | `wcs-notify`        | 登録するカスタム要素タグ名。                                        |

`bootstrapNotification()` は要素が接続される**前に**呼ぶと変更が反映されます。

## ヘッドレス利用（`NotificationCore`）

Core は DOM 依存が無く、`@wc-bindable/core` の `bind()` と直接使えます:

```typescript
import { NotificationCore } from "@wcstack/notification";

const notify = new NotificationCore();
await notify.observe();          // 権限 + クリック中継の監視を開始
await notify.request();          // ユーザーに要求

notify.addEventListener("wcs-notify:click", (e) => {
  console.log((e as CustomEvent).detail); // { tag, data, action }
});

const tag = notify.notify("Hello", { body: "world", data: { room: 1 } });
// あとで:
notify.close(tag);
notify.dispose();                // 購読を解除（開いている通知は残る）
```

## ライセンス

MIT
