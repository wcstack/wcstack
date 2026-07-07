# @wcstack/broadcast

`@wcstack/broadcast` は wcstack エコシステム向けのヘッドレスなタブ間メッセージングコンポーネントです。

これは視覚的な UI ウィジェットではありません。
`@wcstack/fetch` がネットワークリクエストをリアクティブな状態に変え、`@wcstack/websocket` がソケットをリアクティブな状態に変えるのと同じように、**同一オリジンのコンテキスト間メッセージングをリアクティブな状態に変える非同期プリミティブノード**です。

`<wcs-broadcast>` は wc-bindable トークンプロトコルが**コンテキスト境界**をまたぐショーケースです。BroadcastChannel は、同じチャンネル名上の他のすべての同一オリジンコンテキスト（タブ・iframe・worker）にすべての post を配信しますが、送信者自身には決して配信しません。そのため、トークンプロトコルの両方向はタブを*またいで*はじめてループを閉じます。

- **post**（`state → element`）— command-token プロトコル経由（`command.post: $command.send`）
- **message**（`element → state`）— event-token プロトコル経由（`eventToken.message: onMessage`）

`@wcstack/state` と組み合わせると、`<wcs-broadcast>` はパス契約を通じて直接バインドできます。

- **入力面**: `name`, `manual`
- **コマンド面**: `open`, `post`, `close`
- **出力状態面**: `message`, `error`

つまり、タブ間の同期を HTML 上で宣言的に表現でき、UI 層に `new BroadcastChannel()` / `postMessage()` / `onmessage` リスナ、後始末のグルーコードを書く必要がありません。

`@wcstack/broadcast` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います。

- **Core**（`BroadcastCore`）がチャンネルのライフサイクル、post、structured clone による受信、エラー処理を担当
- **Shell**（`<wcs-broadcast>`）がその状態を DOM 属性・ライフサイクル・宣言的コマンドに接続
- **Binding Contract**（`static wcBindable`）が観測可能な `properties`・書き込み可能な `inputs`・呼び出し可能な `commands` を宣言

## なぜ存在するのか

BroadcastChannel API は `fetch` や `WebSocket` と同様、値を非同期に生み出すソースですが、**自己除外的**です。すなわち、あるコンテキストは自分自身の post を決して受信しません。命令的に書くと、チャンネルの構築・`message` / `messageerror` リスナの配線・解体時のクローズが必要になります。

`@wcstack/broadcast` はそのロジックを再利用可能なコンポーネントに押し込み、結果をバインド可能な状態として公開します。タブ間の通知が命令的なコールバック配線ではなく、**状態遷移**になります。

> **自己除外 — ページを 2 つのタブで開くこと。** あるコンテキストは自分自身の post を受信しないため、1 つのタブにある単一の `<wcs-broadcast>` は、自分の `post` が `message` に反映されるのを見ることはありません。往復は、**別の**コンテキスト（別のタブ、または同じチャンネル名の別の `<wcs-broadcast>`）が listen しているときにのみ閉じます。この README のデモは、ページが 2 つのタブで開かれていることを前提とします。

> **同一オリジンのみ、structured clone。** BroadcastChannel は 1 つのオリジン内で動作します。ペイロードはブラウザの structured clone に乗るため、オブジェクトはそのまま渡されます — **JSON の往復は無く**、文字列化も不要です。クローン不可能なペイロード（関数、DOM ノード）は throw せず `error` プロパティを通じて `DataCloneError` を表面化します。

## インストール

```bash
npm install @wcstack/broadcast
```

## クイックスタート

### 1. メッセージを送信（post）

post は DOM クリック（autoTrigger）または command-token から起動します。

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/broadcast/auto"></script>

<wcs-broadcast id="bc" name="room"></wcs-broadcast>

<!-- 任意の DOM トリガ: クリックでリテラルテキストを post -->
<input id="msg" value="hello" />
<button data-broadcast-target="bc" data-broadcast-from="#msg">Send</button>
<button data-broadcast-target="bc" data-broadcast-text="ping">Ping</button>
```

`data-broadcast-text` はリテラル文字列を post します。`data-broadcast-from` はセレクタにマッチした要素の `value`（なければ `textContent`）を post します。

### 2. タブ間カウンタ（command-token + event-token）

1 つの要素に双対性が同居します。`post` は command-token から配線され、受信する `message` は event-token 経由で受け取ります。これを 2 つのタブで開いて "Bump" をクリックすると、各タブのカウントが同期します。

```html
<wcs-state>
  <script type="module">
    export default {
      count: 0,
      $commandTokens: ["send"],
      $eventTokens: ["onMessage"],
      bump() {
        this.count = this.count + 1;
        this.$command.send.emit(this.count);   // state → element → 他のタブ
      },
      $on: {
        onMessage: (state, event) => {          // 他のタブ → element → state
          state.count = event.detail;
        }
      }
    };
  </script>
</wcs-state>

<wcs-broadcast name="counter" data-wcs="
  command.post:       $command.send;
  eventToken.message: onMessage
"></wcs-broadcast>

<button data-wcs="onclick: bump">Bump</button>
<p data-wcs="textContent: count"></p>
```

### 3. 受信した値を state にミラーする

最新のメッセージを*読む*だけなら event-token は不要です — `message` を直接バインドしてください。

```html
<wcs-state>
  <script type="module">
    export default { incoming: null };
  </script>
</wcs-state>

<wcs-broadcast name="room" data-wcs="message: incoming"></wcs-broadcast>
<p data-wcs="textContent: incoming"></p>
```

## 属性 / 入力（Attributes / Inputs）

| 属性      | 型      | 既定値  | 説明                                                                         |
| --------- | ------- | ------- | ---------------------------------------------------------------------------- |
| `name`    | string  | `""`    | 参加するチャンネル名。変更すると新しいチャンネルで開き直す。                  |
| `manual`  | boolean | `false` | 接続時や `name` 変更時にチャンネルを自動で開かない。代わりに `open()` を呼ぶ。接続時と各 `name` 変更時に評価される。`observedAttributes` に**含まれない**ため、既に接続済みの要素で `manual` をトグルしても即座の効果はない（*次回*の接続や `name` 変更時の挙動を変えるだけ）。 |

### DOM トリガ属性（autoTrigger、クリックで post）

| 属性                    | 付与先         | 説明                                                                    |
| ----------------------- | -------------- | ----------------------------------------------------------------------- |
| `data-broadcast-target` | トリガボタン   | 駆動する `<wcs-broadcast>` の id。                                      |
| `data-broadcast-text`   | トリガボタン   | post するリテラルテキスト（優先される。空文字列も有効）。               |
| `data-broadcast-from`   | トリガボタン   | CSS セレクタ。マッチした要素の `value`（なければ `textContent`）を post。 |

> DOM トリガによる `post` は fire-and-forget で、決して reject しません。post 失敗（例: クローン不可能なペイロード — 文字列しか post しない DOM トリガからは発生しない）は `error` プロパティを通じて現れます。

## 観測可能なプロパティ（出力）

| プロパティ | イベント                 | 説明                                                                                 |
| --------- | ------------------------ | ------------------------------------------------------------------------------------ |
| `message` | `wcs-broadcast:message`  | チャンネル上の他のコンテキストから受信した直近の値（structured clone のコピー）。このコンテキスト自身の post では決して設定されない。 |
| `error`   | `wcs-broadcast:error`    | 正規化された `{ name, message }` — `DataCloneError`（クローン不可能な post）、`DataError`（ピアのメッセージをデシリアライズできなかった）、`InvalidStateError`（開いているチャンネルが無い状態での post）、または `NotSupportedError`（BroadcastChannel が利用不可）。 |

## コマンド

| コマンド | 説明                                                                                    |
| ------- | --------------------------------------------------------------------------------------- |
| `open`  | `name` 属性で指定されたチャンネルに参加する（既に開いているチャンネルは閉じる）。       |
| `post`  | structured clone 可能な値を他のすべてのコンテキストに post する（reject しない — 失敗は `error` へ）。 |
| `close` | チャンネルから離脱する（冪等）。                                                        |

状態からの起動には command-token プロトコルを使います。

```html
<wcs-broadcast name="room" data-wcs="command.post: $command.send"></wcs-broadcast>
```

## 注意点と制約

- **自己除外は意図的。** あるコンテキストは自分自身の post を決して受信しません — これは BroadcastChannel の契約であり、バグではありません。往復を見るには、第 2 のコンテキスト（タブ/iframe/worker、または同じチャンネル名の第 2 の `<wcs-broadcast>`）を listen させてください。*同じ*タブ内の 2 つの `<wcs-broadcast name="x">` 要素は互いに受信します（別々のチャンネルオブジェクトだから）。単一の要素が自分自身に話しかける場合だけは受信しません。
- **`name` は監視される。** `<wcs-clipboard>` と異なり、`<wcs-broadcast>` は `name` に対して `observedAttributes` を実装します。接続中（かつ非 `manual`）に `name` 属性を変更すると、古いチャンネルを閉じて新しいチャンネルを開きます。`name` をクリアする（空文字列にする、または属性を削除する）のは close *ではありません*。別の `name` に切り替えるか、明示的に `close()` を呼ぶまで、以前開いたチャンネルは維持されます。空でない新しい値だけが切り替えをトリガします。
- **ワイヤエンコーディングは無い。** ペイロードは structured clone を使うため、JSON の stringify/parse ステップはありません（テキストワイヤで送る `<wcs-ws>` と異なります）。オブジェクトを直接 post すると、受信側はディープコピーを得ます。クローン不可能な値は `error` 経由で `DataCloneError` として失敗します。
- **接続状態は無い。** BroadcastChannel は構築された瞬間に「開いて」います — connecting/ハンドシェイク段階も、`readyState` も、再接続もありません（必要ないため）。Shell は接続時に同期的に開くので `connectedCallbackPromise` は即座に resolve する（解決済み promise）が、`hasConnectedCallbackPromise = true` として公開されており、state バインダ / SSR がスナップショット前に一様に readiness を await できます。
- **再接続で開き直す。** 要素を削除して再挿入すると `connectedCallback` が再度実行され、`name` 属性（真実の源）からチャンネルを開き直します。`disconnectedCallback` がそれを閉じます。
- **無言のエラー処理（ゼロログ）。** wcstack 全体のゼロ依存主義に従い、`<wcs-broadcast>` は実行時の失敗に対して一切ログ出力も throw もしません。BroadcastChannel コンストラクタの欠如、クローン不可能な post、デシリアライズ失敗は `error` プロパティ / `wcs-broadcast:error` イベントを通じてのみ表面化します — `post()` は resolve し、決して reject しません。観測・対処するには `error` をバインドしてください。

## ヘッドレス利用（`BroadcastCore`）

Core はグローバルな `BroadcastChannel` 以外に DOM 依存を持たず、`@wc-bindable/core` の `bind()` と直接組み合わせて使えます。

```typescript
import { BroadcastCore } from "@wcstack/broadcast";

const bus = new BroadcastCore();
bus.addEventListener("wcs-broadcast:message", (e) => {
  console.log((e as CustomEvent).detail); // 受信した値
});

bus.open("room");
bus.post({ type: "hello", at: Date.now() });
// ...後で
bus.close();
```

## ライセンス

MIT
