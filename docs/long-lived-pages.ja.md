# 開いたままのページ

**English**: [long-lived-pages.md](./long-lived-pages.md)

シフトの始めに開いて開いたままのページ — サポート窓口、壁の画面のダッシュボード、チャット — は、数分で読み込んで閉じるページが出会わないものを通ります。この手引きはそれを挙げ、それぞれで wcstack が何をし、ページが自分で何をするかを書きます。継ぎ目アプリ `shift-desk` — シフトひとつ分を模擬して通したサポート窓口の画面 — から来ています（[seam-apps.ja.md](./seam-apps.ja.md)）。

## 開いたままのページに起きること

| 出来事 | ブラウザがすること |
|---|---|
| タブが隠れる | タイマーが間引かれる（Chromium: 5 分隠れた後は 1 分に 1 回まで）。`requestAnimationFrame` は止まる。 |
| ノートパソコンがスリープする | 何も動かない。復帰すると、期限の来たタイマーは 1 回だけ発火する — 逃した回数分ではない。接続は閉じられずに死んでいることがあり、ネットワークが変わっても `online` は来ないことがある。 |
| ページが凍結される | Chromium は裏のタブを凍結する（Page Lifecycle の `freeze` / `resume`）: 再開するまでタスクは 1 つも走らない。 |
| 別のページへ移って「戻る」で戻る | ページは back/forward cache から戻ることがある（`persisted` の `pageshow`）: 読み直しは無く、何も接続し直されない。 |
| タブが破棄される | メモリが足りないと、ブラウザはタブを捨て、表示されたときに読み直す（`document.wasDiscarded`）: 保存していないものは消える。 |
| タブが複製される | 新しいタブは履歴とセッションストレージの写しを持つ。 |
| 時間が経つ | 真夜中に日付が変わり、夏時間で時計が動き、トークンの期限が切れ、サーバーが配備し直され、ネットワークが途切れる。 |

## wcstack がすること

- **`$connectedCallback`** は `<wcs-state>` 要素が接続されたときに走る: 読み込みのときと、要素が外された後に戻されたとき。スリープからの復帰、凍結からの再開、back/forward cache からの復帰、可視になったときには**走らない** — [復帰のハンドラを 1 つ](#復帰のハンドラを-1-つ) を見てください。
- **`<wcs-timer>` の刻みは時間ではない。** 隠れたタブの刻みは間引かれ、スリープ中の刻みは失われる: 1 秒のタイマーは、1 時間のスリープの間に数回しか数えない。刻みは時計（`Date.now()`）を読むきっかけに使い、時刻を state に持つ。刻みを数えない。getter の中で `Date.now()` を読まない（lint の `wcs/getter-untracked-read`: getter は時間が経っても走り直さない）。
- **`<wcs-raf>`** は隠れたタブで止まり（`suspended` が `true`）、その後の最初のフレームで `dt = 0` を出す。`dt` と `elapsed` は*活動していた*時間を測る。壁の時計に沿って描くグラフには時計が要る: `dt` を積むと、隠れていた分だけ遅れる。タブが見えたままのスリープは可視性の変化ではないので、その後の 1 フレームがスリープ全体の `dt` を運ぶことがある。
- **`<wcs-wakelock>`** は、ページがまた見えたときにロックを取り直す（ブラウザは隠れたときに外す）。
- **`<wcs-sse>`** は、切断の後の再接続をブラウザに任せるが、HTTP のエラー（`CLOSED`）の後はしない — ページが開き直す。4.8 から、`stale-after` が閉じられずに死んだストリームに気づく。再接続の後の追いつき方は README に書いてある。
- **`<wcs-ws>`** は `auto-reconnect` でクローズの後につなぎ直す。4.8 から、`stale-after` が閉じられずに死んだ接続に気づき、要素はページが back/forward cache に入りうるときに閉じ、戻ったときにつなぎ直す。
- **ルートの中の I/O ノード。** `@wcstack/router` は、入るたびにルートの同じノードを戻す。4.8 から、ノードが接続のときに始める仕事は新しいルートの入力を使う（[timing-and-firing-contract.ja.md](./timing-and-firing-contract.ja.md) §23）。
- **`[wcs/command-not-ready]`** — 要素の準備が整っていないために拒んだコマンド（閉じたソケットへの `send`）の警告は、4.8 から要素ごとに 1 回ではなく、不調 1 回につき 1 回: ルートの要素は一日中生きている。
- **`<wcs-storage>`** は、保存したものを読み直しや破棄の後も保つ。複製したタブはセッションストレージを写す。

## ページがすること

### 復帰のハンドラを 1 つ

間の後に追いつく必要のあるページは、間が終わる知らせを聞き、1 か所で扱います。`visibilitychange`（可視へ）、`persisted` の `pageshow`、`resume`、`online` は、どれも「何かを逃したかもしれない」と言います。どれも変えなかったスリープの後は、時計の飛びがそう言います — 毎秒の刻みが、前の刻みから 1 秒よりずっと長く経ったのを見る。

```html
<wcs-timer interval="1000" data-wcs="tick: tick"></wcs-timer>
```

```js
let onWakeEvent = null; // リスナーは state ではない: モジュールに持つ

export default {
  tick: 0,
  now: Date.now(),
  $connectedCallback() {
    onWakeEvent = (e) => {
      if (e.type === "visibilitychange" && document.visibilityState !== "visible") return;
      if (e.type === "pageshow" && !e.persisted) return;
      this.onWake();
    };
    for (const type of ["visibilitychange", "resume"]) document.addEventListener(type, onWakeEvent);
    for (const type of ["pageshow", "online"]) window.addEventListener(type, onWakeEvent);
  },
  $disconnectedCallback() {
    for (const type of ["visibilitychange", "resume"]) document.removeEventListener(type, onWakeEvent);
    for (const type of ["pageshow", "online"]) window.removeEventListener(type, onWakeEvent);
  },
  $watch: {
    tick() {
      const now = Date.now();
      if (now - this.now > 15000) this.onWake(); // スリープ・凍結・間引き
      this.now = now;
    },
  },
  async onWake() {
    // まずトークンを更新し、それから: ストリームを自分の位置から開き直し、
    // 画面にあるものを読み直し、ポーリングしているものを取り、送信待ちを送り、
    // 通知を少しの間止める（下）
  },
};
```

ハンドラは何度呼ばれてもよいように書きます: 1 回の復帰の後に、これらの知らせのいくつかが一緒に来ます。また、トークンを先に更新しても、スリープ中に期限が来たタイマーは止められません: 復帰したとき、更新が返る前に古いトークンで動きます — 401 で失敗した要求は、更新が済んでから 1 回走らせ直します（[トークン](#トークン)）。

### ページの可視性を state に

ページの可視性を出力として出す要素はありません。イベントから書きます（上のハンドラの中か、単独で）: `this.pageHidden = document.visibilityState === "hidden"`。隠れている間だけ通知する、誰も見ていない仕事を止める、のに使います。

### 復帰の後の通知

スリープの間に届いたものは、復帰したときにまとめて届きます。イベントごとに通知するページは何十も出します。復帰の後は数秒通知を止め、要約を 1 つ出します（「緊急のチケットが 22 件」）。

### 伸びるものに上限を

8 時間ストリームが流し込む一覧は、すべてのイベントを持ちます。最後の N 件を残し（`this.events = [...this.events, e].slice(-200)`）、チャットの履歴とグラフの点にも上限を設け、すべての行ではなく意味のある行を描きます。

### かたまり

再接続の後の再送や、追いつくサーバーは、たくさんのイベントを一度に送ります。SSE のメッセージは 1 件ずつ別のタスクなので、1 件ずつ当てると 1 件ずつ描きます。ためて、50 ms ごとに 1 回の書き込みで当てます。

### トークン

シフトの間にトークンの期限が切れます。ストリームの URL のトークン（`EventSource` はヘッダを送れない）は、ストリームを開いたときのものです: 開き直す前に更新するか、ストリームを cookie で認証します。トークンの要る `<wcs-fetch>` がいくつもあるとき: 更新は 1 回 — 更新の promise を 1 つ共有する — にして、401 で失敗したものを走らせ直します。

### 下書き

記録に属する下書き（チケットへの返信）は、ローカルストレージに記録ごとのキーで置きます — 記録から記録へ利用者について回る固定のキーでも、複製したタブが写し、閉じたタブが失うセッションストレージでもなく。

### 版

一日開いたままのページと、配備の後に開いたページは、固定しない `latest` を読むと別の版で動き、ローカルストレージと broadcast のチャンネルを分け合います。版を固定してください（[sri.ja.md](./sri.ja.md)）。

## 開いたままのページを試す

- Playwright の時計（`page.clock.install()`、その後 `runFor` / `fastForward` / `pauseAt`）は、ページのタイマー・`Date`・`requestAnimationFrame` を動かす — ブラウザ自身のタイマー（`EventSource` の再接続、WebSocket）とサーバーの時計は動かさない。`runFor` は通るすべてのアニメーションフレームを走らせ、`fastForward` は期限の来たタイマーを 1 回ずつ発火する。
- Playwright は Chromium を `--disable-back-forward-cache` で起動する: 復元を試すには `ignoreDefaultArgs: ["--disable-back-forward-cache"]`（と `channel: "chromium"` — ヘッドレスシェルは復元しない）で起動し、復元されなかったら `performance.getEntriesByType("navigation")[0].notRestoredReasons` を読む。`Cache-Control: no-store` で配ったページも復元されない。
- ヘッドレスのページは隠れず、CDP の `Page.setWebLifecycleState` は見えているページを凍結しない: 隠すことと凍結はページの中で模擬し、そう書く。
- 死んだ接続は、書くのをやめて接続を開いたままにするサーバーで作る。
