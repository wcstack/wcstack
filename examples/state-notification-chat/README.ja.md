# チャット通知 デモ

`@wcstack/state` + `@wcstack/notification`（`<wcs-notify>`）+ `@wcstack/permission`（`<wcs-permission>`）。state からデスクトップ通知を駆動する例。表示は command-token、クリックは event-token —— 双方向が 1 つのタグで完結する。

## はじめに

`index.html` をブラウザで開くだけ（静的サーバ、または `localhost`）。ビルド不要で、すべて `esm.run` から読み込まれる。通知は secure context が必要: `localhost` か `https://` で動作し、`file://` ではプロンプトが出ないことがある。まず **Allow notifications** をクリックし、次に **Simulate new message** を押す。OS 通知をクリックすると「Last opened」が更新される。

## 機能

- **`notify` command-token（state → 要素）**: `this.$command.notify.emit("New message #1", { body, tag, data })`。位置引数はそのまま `notify(title, options)` へ素通しされる（`<wcs-speak>`/`<wcs-fetch>` と同じ引数転送契約）。
- **`clicked` event-token（要素 → state）**: OS 通知のクリックが `$on.opened(state, event)` に流れ込む。`event.detail` は `{ tag, data, action }`。デモは `data.room` を読んでどのメッセージが開かれたか表示する。
- **`request` command-token**: `<wcs-notify>` は自己完結 —— `Notification.requestPermission()` を自分で所有する。`request()` 標準を持たない `<wcs-permission>`（`request` 無し）と違い、Notifications API には request 標準があるので command-token が成立する。
- **`<wcs-permission name="notifications">` バナー**: `hidden@granted` で許可された瞬間にプロンプトを消す。live `change` 追従つき。

## ポイント

- **1 つのタグで双方向**。`<wcs-notify>` は command-token（表示）と event-token（クリック）が同居する @wcstack 初のノード。隣の `<wcs-permission>` は純粋な監視ノード（event-token のみ）のまま。
- **`notify` と `notice`**。デモは命令的な `notify` コマンド（毎回発火）を使う。「束縛した値が変化したら表示」したい場合は reactive な `notice` 入力をバインドする（same-value ガードつき）。変化のたびに自動発火すると通知スパムの危険があるため、`debounce` フィルタを噛ませるとよい。
- **バックエンドとモバイル**。`mode="auto"`（既定）はデスクトップでは `Notification` コンストラクタ、`new Notification()` が使えないモバイルでは Service Worker にフォールバックする。SW 経路では `@wcstack/notification/sw` の `wireNotificationClicks()` を Service Worker に import すると、クリックがページへ中継される。
