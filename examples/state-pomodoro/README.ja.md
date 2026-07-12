# state + timer + wakelock + notification デモ（ポモドーロ）

`@wcstack/state`・`@wcstack/timer`・`@wcstack/wakelock`・`@wcstack/notification` を組み合わせたポモドーロタイマーです。**集中セッション中だけ**画面をスリープさせず、セッション終了のデスクトップ通知がそのまま「次のセッションを開始する」ボタンになります。

## 起動方法

パッケージは CDN（[esm.run](https://esm.run)）からロードするため、バックエンドもビルドも不要です。`http://localhost`（または HTTPS）で配信できる静的サーバーなら何でも動きます。wake lock と通知には secure context が必要です。

```bash
npx serve examples/state-pomodoro
```

## 見どころ

- **宣言的なゲームクロック**: `<wcs-timer interval="1000" manual>` はただの 1 秒メトロノーム。`tick` イベント（detail は `{ count, elapsed }`）が event token で state に流れ込み、ポモドーロの状態機械は state 側の約 20 行に収まります。
- **意図に紐づく wake lock**: `<wcs-wakelock data-wcs="active: keepAwake; held: wakelockHeld">` — `active`（desired・入力）と `held`（actual・出力）は意図的に分離された一方向サーフェスです。一時停止でロック解放・再開で再取得。OS 側の解放も UI は `held` を読むので必ず見えます。
- **通知がコントロールになる**: セッション終了通知は `data.next` を载せ、クリックが `eventToken.clicked` で state に戻ります — 別タブにいてもクリックで次のセッションが始まります。
- **permission 監視内蔵**: `<wcs-notify>` は Permissions API を自前で監視します（`granted` / `prompt` / `denied` / `unsupported` 出力）。`<wcs-permission>` 要素は不要です。
- **デモ用の短い時間**: *6 sec / 3 sec (demo)* を選ぶと、集中 → 休憩 → 集中の 1 サイクルを数秒で確認できます。

## 配線のポイント

```html
<wcs-timer interval="1000" manual
  data-wcs="running: running; eventToken.tick: timerTick;
            command.start: $command.start; command.stop: $command.stop; ..."></wcs-timer>

<wcs-wakelock data-wcs="active: keepAwake; held: wakelockHeld"></wcs-wakelock>

<wcs-notify
  data-wcs="granted: notifGranted; ...;
            command.request: $command.askNotify; command.notify: $command.notify;
            eventToken.clicked: notifyClicked"></wcs-notify>
```

- セッション終了の判定は `timerTick` ハンドラにあります: `elapsed >= durationMs` になったらタイマーを stop / reset し、モードを反転して `$command.notify.emit(title, options)` を発火 — emit の引数はそのまま `notify(title, options)` に渡ります（command-token の引数素通し）。
- 次のセッションは自動開始しません。通知クリック（または Start ボタン）が明示的な開始ジェスチャです。
