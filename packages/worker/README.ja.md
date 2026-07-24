# @wcstack/worker

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/worker` は wcstack エコシステム向けのヘッドレスな Web Worker コンポーネントです。

これは視覚的な UI ウィジェットではありません。
`@wcstack/fetch` がネットワークリクエストをリアクティブな状態に変え、`@wcstack/websocket` がソケットをリアクティブな状態に変えるのと同じように、**Dedicated Worker をリアクティブな状態に変える非同期プリミティブノード**です。

`<wcs-worker>` はバックグラウンドスレッドを所有し、そのメッセージパッシング面を wc-bindable トークンプロトコルを通じて公開します。

- **post**（`state → element`）— command-token プロトコル経由（`command.post: $command.run`）
- **message**（`element → state`）— event-token プロトコル経由（`eventToken.message: onResult`）

`@wcstack/state` と組み合わせると、`<wcs-worker>` はパス契約を通じて直接バインドできます。

- **入力面**: `src`, `type`, `name`, `manual`, `keep-alive`, `restart-on-error`, `max-restarts`, `restart-interval`
- **コマンド面**: `start`, `post`, `terminate`
- **出力状態面**: `message`, `error`, `errorInfo`, `running`

つまり、worker スレッドへの処理のオフロードを HTML 上で宣言的に表現でき、UI 層に `new Worker()` / `postMessage()` / `onmessage` リスナ、後始末のグルーコードを書く必要がありません。

`@wcstack/worker` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います。

- **Core**（`WorkerCore`）が worker のライフサイクル、post、structured clone による受信、エラー処理、オプトインの restart-on-error を所有
- **Shell**（`<wcs-worker>`）がその状態を DOM 属性・ライフサイクル・宣言的コマンドに接続
- **Binding Contract**（`static wcBindable`）が観測可能な `properties`・書き込み可能な `inputs`・呼び出し可能な `commands` を宣言

## なぜ存在するのか

Worker は `fetch` や `WebSocket` と同様、値を非同期に生み出すソースですが、加えて**リソースを所有**します（バックグラウンドスレッド）。命令的に書くと、worker の構築・`message` / `messageerror` / `error` リスナの配線・解体時の terminate が必要になります。

`@wcstack/worker` はそのロジックを再利用可能なコンポーネントに押し込み、結果をバインド可能な状態として公開します。worker から返ってくる計算結果が命令的なコールバック配線ではなく、**状態遷移**になります。

> **バス型であって RPC ではない。** `post` は fire-and-forget で、結果は `message` に届きます。リクエスト/レスポンスの組み込みの相関付けはありません。返信を特定のリクエストに対応付けたい場合は、ペイロードに相関 id を含めて worker にエコーバックさせてください（あるいは、リクエストが 1 つだけ進行中なら次の値を `message` で待ってください）。

> **structured clone、JSON の往復は無い。** ペイロードはブラウザの structured clone に乗ります（`@wcstack/broadcast` と対称であり、テキストワイヤで送る `<wcs-ws>` とは意図的に異なります）。オブジェクトを直接 post すると、worker はコピーを受け取ります。クローン不可能なペイロード（関数、DOM ノード）は throw せず `error` プロパティを通じて `DataCloneError` を表面化します。

> **既定で ESM。** worker は `type="classic"` を設定しない限り `{ type: "module" }` で作成されます。

## インストール

```bash
npm install @wcstack/worker
```

## クイックスタート

### 1. ジョブを実行して結果を読む

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/worker/auto"></script>

<wcs-state>
  <script type="module">
    export default { result: null };
  </script>
</wcs-state>

<wcs-worker id="job" src="./compute.js" data-wcs="message: result"></wcs-worker>

<!-- 任意の DOM トリガ: クリックで解決したテキストを worker に post -->
<input id="n" value="42" />
<button data-worker-target="job" data-worker-from="#n">Run</button>

<p data-wcs="textContent: result"></p>
```

`data-worker-text` はリテラル文字列を post します。`data-worker-from` はセレクタにマッチした要素の `value`（なければ `textContent`）を post します。

### 2. post（command-token） + result（event-token）

1 つの要素に双対性が同居します。`post` は command-token から配線され、受信する `message` は event-token 経由で受け取ります。

```html
<wcs-state>
  <script type="module">
    export default {
      input: 10,
      output: null,
      $commandTokens: ["run"],
      $eventTokens: ["onResult"],
      compute() {
        this.$command.run.emit(this.input);   // state → worker
      },
      $on: {
        onResult: (state, event) => {          // worker → state
          state.output = event.detail;
        }
      }
    };
  </script>
</wcs-state>

<wcs-worker src="./compute.js" data-wcs="
  command.post:       $command.run;
  eventToken.message: onResult
"></wcs-worker>

<button data-wcs="onclick: compute">Compute</button>
<p data-wcs="textContent: output"></p>
```

## 属性 / 入力（Attributes / Inputs）

| 属性               | 型      | 既定値     | 説明                                                                        |
| ------------------ | ------- | ---------- | --------------------------------------------------------------------------- |
| `src`              | string  | `""`       | worker スクリプトの URL。変更すると古い worker を terminate して新しいスクリプトを spawn する。 |
| `type`             | string  | `"module"` | `"module"`（ESM）または `"classic"`。                                       |
| `name`             | string  | `""`       | 任意の worker 名。`Worker` コンストラクタの `name` オプションに渡される（DevTools / エラー識別に役立つ）。spawn 時に適用される — 後述の `type` の注記を参照。 |
| `manual`           | boolean | `false`    | 接続時や `src` 変更時に自動で spawn しない。代わりに `start()` を呼ぶ。      |
| `keep-alive`       | boolean | `false`    | 切断時に worker を terminate **しない** — 要素より長く生き残る。所有権はあなたに移る。スレッドを解放するには `terminate()` を呼ぶこと。 |
| `restart-on-error` | boolean | `false`    | worker スクリプト内の未捕捉エラー後に新しい worker を再 spawn する。        |
| `max-restarts`     | number  | `Infinity` | worker の生存期間にわたる自動再起動の**累積**回数の上限（連続クラッシュ数ではない — 安定稼働ではカウンタはリセットされない）。新しい `start()` / `src` 変更でのみリセットされる。 |
| `restart-interval` | number  | `0`        | 自動再起動前の遅延（ミリ秒）。                                              |

### DOM トリガ属性（autoTrigger、クリックで post）

| 属性                 | 付与先         | 説明                                                                  |
| -------------------- | -------------- | --------------------------------------------------------------------- |
| `data-worker-target` | トリガボタン   | 駆動する `<wcs-worker>` の id。                                       |
| `data-worker-text`   | トリガボタン   | post するリテラルテキスト（優先される。空文字列も有効）。             |
| `data-worker-from`   | トリガボタン   | CSS セレクタ。マッチした要素の `value`（なければ `textContent`）を post。 |

DOM トリガは**常に文字列を post します** — リテラルの `data-worker-text`、または解決された要素の `value` / `textContent`。これは単純なテキストペイロードのための利便機能であり、意図的に値のパース・型変換・構造化を行いません。structured clone データ（オブジェクト、typed array、transferable）を送るには、command-token プロトコル（`command.post: $command.run`）経由で `post` を起動するか、命令的に `element.post(data, transfer?)` を呼んでください。

> **autoTrigger は既定で有効。** 最初に接続した `<wcs-worker>` が document レベルの `click` リスナーを 1 つ設置します（`data-worker-target` 要素のクリックで参照先 worker に post し、`event.preventDefault()` を呼ぶ）。DOM ショートカットを使わないなら bootstrap エントリで無効化してください:
>
> ```js
> import { bootstrapWorker, getConfig } from "@wcstack/worker";
> bootstrapWorker({ autoTrigger: false });      // document クリックリスナーを設置しない
> bootstrapWorker({ triggerAttribute: "data-run" }); // トリガ属性名を変更（既定: data-worker-target）
> getConfig();                                   // 実効設定（deep-frozen）を読む
> ```
>
> `bootstrapWorker()` は要素が接続される前に呼んでください。（`setConfig` は内部用。設定は `bootstrapWorker` 経由で行います。）

## 観測可能なプロパティ（出力）

| プロパティ | イベント                      | 説明                                                                                 |
| --------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| `message` | `wcs-worker:message`          | worker が post し返した直近の値（structured clone のコピー）。値が変わらなくても、メッセージごとに再発火する。 |
| `error`   | `wcs-worker:error`            | 正規化された `{ name, message, filename?, lineno?, colno? }` — `DataCloneError`（クローン不可能な post）、`DataError`（worker メッセージをデシリアライズできなかった）、`InvalidStateError`（稼働中の worker が無い状態での post）、スクリプトの `Error`（worker 内の未捕捉エラー、位置情報付き）、または spawn 失敗（不正な URL / CSP / 非対応）。 |
| `errorInfo` | `wcs-worker:error-info-changed` | シリアライズ可能な失敗タクソノミ `WcsIoErrorInfo \| null`（安定した `code` / `phase` / `recoverable`）。`error` と同じ失敗から導出される。追加的で、`error` の形状は不変。 |
| `running` | `wcs-worker:running-changed`  | worker が spawn され、まだ terminate されていない間は `true`。                       |

## コマンド

| コマンド     | 説明                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------- |
| `start`     | `src` 属性から worker を spawn する（以前に spawn した worker は terminate する。同じ `src` では冪等）。 |
| `post`      | structured clone 可能な値を worker に post する（reject しない — 失敗は `error` へ）。ヘッドレスな `WorkerCore.post(data, transfer?)` は transfer リストも受け付ける。 |
| `terminate` | worker を terminate する（冪等）。                                                          |

状態からの起動には command-token プロトコルを使います。

```html
<wcs-worker src="./compute.js" data-wcs="command.post: $command.run"></wcs-worker>
```

## `:state()` による CSS スタイリング

`<wcs-worker>` は 2 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `running` | `wcs-worker:running-changed` が `true` で発火（`false` でクリア） |
| `error` | `wcs-worker:error` が非 `null` の detail で発火（`null` でクリア） |

```css
wcs-worker:state(running) ~ .busy-indicator { display: block; }
wcs-worker:state(running) ~ .busy-indicator { display: none; } /* デフォルト */

form:has(wcs-worker:state(error)) .banner { display: block; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-worker>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-worker:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["running"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-running` / `data-wcs-state-error` 属性にミラーします。
  Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-worker src="./compute.js" debug-states></wcs-worker>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## 注意点と制約

- **バス型メッセージモデル。** リクエスト/レスポンスの相関付けは組み込まれていません。`post` は fire-and-forget で、返信は `message` に届きます。命令的利用向けの RPC 風 `request(data): Promise` は将来追加され得ます。
- **「ready」シグナルは無い。** worker は即座に `postMessage` を受け付けます（プラットフォームはスクリプトが読み込まれるまでメッセージをキューします）。また標準の「スクリプト読み込み完了」イベントはありません。`running` は「spawn 済みかつ未 terminate」を意味し、「リクエストを処理できる準備ができた」ことを**意味しません**。本当の ready シグナルが必要なら、worker に起動時に ready メッセージを `post` させ、それを `message` で観測してください。
- **`keep-alive` は所有権を移す。** `keep-alive` が無ければ、worker は切断時に terminate されます（`<wcs-ws>` / `<wcs-broadcast>` の close と同様）。`keep-alive` があると、worker は切断後も生き残り、`terminate()` を呼ぶ責任があなたに移ります — さもなければスレッドがリークします。この所有権移転の帰結として、`keep-alive` と `restart-on-error` の両方がある場合、切断時に保留中の再起動（`restart-interval` タイマーをスケジュールしたエラー）は**キャンセルされず**、要素が DOM を離れた後に発火し、切り離された要素上で新しい worker を再 spawn します。これは意図的です — `keep-alive` は切断後もライフサイクルがあなたのものであることを意味するからです — が、`keep-alive` な worker を止める最もきれいな方法は明示的な `terminate()` であり、これは保留中の再起動もクリアします。
- **`restart-on-error` はオプトインかつ上限付き。** worker 内の未捕捉エラーはプラットフォーム上で自動 terminate しません。`restart-on-error` が設定されていると、`restart-interval` ミリ秒後に新しい worker が spawn され、最大 `max-restarts` 回まで行われます（`<wcs-ws>` の再接続上限と対応）。再起動カウンタは **worker の生存期間にわたる累積**です。最後の `start()` 以降の再起動総数をカウントし、安定稼働の期間で**リセットされません**。したがって `max-restarts` は連続クラッシュ数ではなく再起動総数を上限とします — 回復して後に再び失敗する worker も同じ予算を消費します。カウンタは新しい `start()`（または `start()` を呼ぶ `src` 変更）でのみリセットされます。予算を使い切ると、**同じ** `src` で再び `start()` を呼んでも冪等となり再 spawn しません — `terminate()` してから `start()`（または `src` 変更）してカウンタをリセットし、新たに spawn してください。**使うなら `max-restarts` を設定すること** — 既定値（`max-restarts="Infinity"`、`restart-interval="0"`）では、読み込み時に即座に throw する worker が密な `setTimeout(0)` ループで再 spawn し、`wcs-worker:error` / `wcs-worker:running-changed` を氾濫させてメインスレッドを飢餓状態にします。小さな正の `restart-interval` と有限の `max-restarts` が影響範囲を抑えます。
- **再起動は `post` 状態を再生しない。** 各再起動は `new Worker(src)` を呼び、以前のメッセージの記憶を持たない*新鮮な*プロセスを生みます。Core は以前の `post` を再送しません。worker が機能するために初期化状態（config メッセージ、転送されたポート）を必要とするなら、起動時に要求するか再構築しなければなりません（例: ready シグナルを `post` してページに返信させる）。restart-on-error はそれを再配信しないからです。
- **`src` は監視される。`type` / `name` は spawn 時に適用される。** 接続中（かつ非 `manual`）に `src` 属性を変更すると、古い worker を terminate して新しいスクリプトを spawn します。空でない新しい値だけが切り替えをトリガします。`type` と `name` は spawn 時に読み取られ、`observedAttributes` に**含まれません** — 稼働中の worker でそれらを変更しても、次回の spawn（`src` 変更、または `terminate()` + `start()`）まで効果はありません。同様に、同じ `src` で `start()` を再呼び出ししても冪等となり、変更されたオプションは無視されます。
- **transferable はエスケープハッチ。** `transfer`（ArrayBuffer の所有権、MessagePort）は `data-wcs` のデータ配線では表現できません。命令的な `element.post(data, transfer)`（または `WorkerCore.post(data, transfer)`）を使ってください。宣言的レイヤは structured clone データのみを運びます。
- **無言のエラー処理（ゼロログ）。** wcstack のゼロ依存主義に従い、`<wcs-worker>` は実行時の失敗に対して一切ログ出力も throw もしません。不正なスクリプト URL、CSP `worker-src` ブロック、クローン不可能な post、デシリアライズ失敗、worker 内の未捕捉エラーは `error` プロパティ / `wcs-worker:error` イベントを通じてのみ表面化します — `post()` は return し、決して reject しません。観測・対処するには `error` をバインドしてください。
- **`errorInfo` タクソノミ。** `error` に現れるのと同じ失敗を、シリアライズ可能な `WcsIoErrorInfo`（安定した `code` / `phase` / `recoverable`）に分類する**追加的な**バインド可能出力（`wcs-worker:error-info-changed`）です。`error` の形状は変えません。`Worker` コンストラクタの欠如（SSR / 非対応で `new Worker()` が `TypeError` / `ReferenceError` を投げる）は `capability-missing`（phase `probe`）、`src` を指定しない `start()` は `invalid-argument`（phase `start`）、その他の失敗——worker の未捕捉 `Error`、`DataError`（デシリアライズ失敗）、`DataCloneError` / `InvalidStateError`（post 失敗）、spawn 失敗——は `worker-error`（phase `execute`）です。worker の失敗はいずれも `recoverable: false`（自動リトライでは回復しません）。`errorInfo` は `error` と同期して遷移し（同じタイミングで、`error` と共にクリアされる）ます。共有の `WcsIoErrorInfo` 型と `WCS_WORKER_ERROR_CODE` 定数は export 済みです。
- **`src` はコードとして実行される — 信頼すること。** `src` の値は `new Worker(src)` にそのまま渡され、ページの権限でスクリプトを実行します。タグはオリジンの検証もサンドボックス化もしません。信頼するスクリプトにのみ `src` を向け（`<script src>` と同様に扱う）、worker をどこから読み込めるか制約するために明示的な `worker-src` 許可リストを持つ `Content-Security-Policy` を優先してください — 特に `src` がデータバインディングの影響を受け得る場合は。
- **Dedicated Worker のみ。** SharedWorker と Worklet はこのタグの対象外です。

## ヘッドレス利用（`WorkerCore`）

Core はグローバルな `Worker` 以外に DOM 依存を持たず、`@wc-bindable/core` の `bind()` と直接組み合わせて使えます。

```typescript
import { WorkerCore } from "@wcstack/worker";

const core = new WorkerCore();
core.addEventListener("wcs-worker:message", (e) => {
  console.log((e as CustomEvent).detail); // worker が post し返した値
});

core.start("./compute.js");
core.post({ task: "sum", values: [1, 2, 3] });
// ArrayBuffer を転送する（所有権が worker に移る）
const buf = new ArrayBuffer(1024);
core.post(buf, [buf]);
// ...後で
core.terminate();
```

## ライセンス

MIT
