# 非同期実行と wc-bindable 境界

- **状態**: 設計提案（未採択・未実装）
- **対象**: fetch、worker、storage、stream、remote adapter を含む非同期 I/O ノード
- **外部仕様スナップショット**: wc-bindable-protocol
  `5ec0deef212578a072b2f669d2a5554f254253e0`、`@wc-bindable/core@0.8.0`

## 問題

古い要求が新しい要求より後に完了すると、現在の入力と無関係な結果で state を巻き戻す。
`AbortController` は通信量を減らせても、既に完了した処理、キャンセル非対応 API、remote peer の副作用を
取り消せない。正しさには「どの結果が現在も commit 権を持つか」という明示的な順序契約が必要である。

## 現状の設計資産

- `docs/async-execution-model.md` は `latest`、`queue`、`exhaust`、`overlap` の execution lane と、
  world / operation generation を定義している。
- `docs/async-io-node-guidelines.md` は Core / Shell 分離、never-throw 境界、`_gen` による古い結果の抑止、
  `observe()` / `dispose()`、ready、SSR を推奨している。
- `io-core/operation-lane.ts` は本書 §1 / §2 の実行契約（`OperationTicket` / `OperationAttempt` /
  CommitGuard / terminal CAS、4 policy 全て）を型付き実装として持ち、`scripts/sync-io-core.mjs` が
  各ノードの `src/core/` へ複製配布している（`packages/fetch/src/core/operationLane.ts` が採用第一号）。
  **排他代数の実体は既に存在し、欠けているのは公開面である** — この事実は決定ゲート 1 の前提になる。
- これらは良い基礎だが、wc-bindable の property 観測、input 宣言、command 呼び出し、remote wire の
  どの意味に対応するかを混同しないための境界整理が必要である。

## wc-bindable との境界

| 面 | 最新仕様で保証されること | wcstack が追加で決めること |
| --- | --- | --- |
| コア `properties` | producer → consumer の初期同期と後続観測 | 結果を commit できる generation、lane |
| コア `inputs` / `commands` | 検証可能な宣言メタデータ | 実際の呼び出し方法、再入・競合ポリシー |
| Extension 1 | `set`、`setWithAck`、`invoke` の呼び出し面 | command ごとの lane、冪等性、業務上の再試行 |
| remote extension | channel 内順序、at-most-once、ack、timeout、AbortSignal、back-pressure | timeout 後の遅延副作用、再接続後の commit 権 |

wcstack の command-token はローカルのリアクティブ機構であり、それだけで wc-bindable Extension 1 の
`invoke` 意味論を満たすわけではない。両者を接続する adapter は、能力発見、引数・結果、エラー、timeout、
teardown を明示的に変換する。

## 推奨する実行契約

### 1. owner、lane、attempt を分ける

各開始要求に `operationId`、I/O Core の `ownerGeneration`、lane固有stateを割り当てる。retryの
`attempt` / `AbortSignal` はlogical operationとは別objectにする。BindingSession generationとI/O generation、
remote reconnectのconnection generationを共有しない。
結果の commit 条件は次のすべてを満たすこととする。

1. I/O owner lifecycle generation が一致する。
2. operation がterminal settle前である。
3. `latest`のepoch、`queue`のactive head、`exhaust`のactive ID、`overlap`のactive setをpolicy別に満たす。
4. remote 応答の場合、対応するconnection / request identityが一致する。

`latest` は同じ key の最新 generation だけ、`queue` は開始順、`exhaust` は実行中の追加要求を拒否または
集約する。`overlap` は各実行を置換せず、各完了が到着順に同じ観測面へ上書きする（後着勝ち）。
`operationId` と active set は terminal CAS、teardown、in-flight count、開発用 trace の内部 bookkeeping に限り、
operation ごとの結果を公開 observable として個別追跡しない。個別結果を公開する `parallel` は本設計の対象外である。
lane はタグの暗黙実装ではなく、宣言または binding 設定から選べるようにする。

### 2. cancel と commit guard を併用する

新しい要求または teardown 時に `AbortSignal` を伝播し、可能なら処理を停止する。ただしキャンセル成否に
かかわらず、完了時にowner generationとpolicy eligibilityを再検査する。成功・error・timeoutは
`pending → committing → terminal` のCASを高々一回claimし、古い成功・失敗・進捗をstateへcommitしない。
timeout errorはticketを先に失効させず、eligibleなtimeout outcomeがcommitした後にresourceをabort / releaseする。

### 3. 結果を状態機械として公開する

最低限 `idle | pending | success | error | cancelled | stale` を内部で区別する。通常の property 面には
現在の結果を公開し、operation identity、試行回数、開始・終了理由は開発用 side channel に送る。
エラーは Promise の未処理 rejection にせず、宣言された error property / event または ack 結果へ正規化する。

### 4. remote 固有の制約を保持する

- `set` は fire-and-forget なので、受理確認が必要な操作には使用しない。
- `setWithAck` のresolveはassignment適用のackであり、副作用完了や状態安定ではない。reject時は適用済みか不明である。
- `setWithAck` / `invoke` の timeout / AbortSignal はclient待機だけを解放し、peer側処理をcancelしない。再試行には
  idempotency key または業務上の重複許容が必要である。
- at-most-once は exactly-once ではなく、切断時には結果不明になり得る。
- ordinary wire payload は JSON 表現可能な値に制限し、関数、DOM node、任意の class instance を送らない。
  observable の top-level `undefined` は仕様の out-of-band 表現に従う。
- 宣言された capability、pending 上限、back-pressure 方針を接続前に検査する。

## 互換性と移行

既存 I/O タグには現在の挙動を表す既定 lane を割り当て、最初は内部 generation guard と診断だけを追加する。
lane や idempotency の宣言は追加 metadata とし、未認識 consumer は無視できるようにする。remote adapter は
wc-bindable の capability negotiation を使い、Extension 1 非対応 peer へ command を暗黙に模倣しない。

## 検証条件

- A、B の順に開始し B、A の順に完了するケースを全 lane で検証する。
- success だけでなく error、progress、retry timer も古い generation から commit されない。
- abort 非対応 Promise が teardown 後に完了しても状態を変更しない。
- remote の timeout、遅延 ack、切断、再接続、pending 上限到達を再現する。
- `set` と `setWithAck` の保証をテスト名と API 文書で明確に分ける。
- JSON 非互換 payload と capability 不足を接続時または送信前に診断する。

## 非目標

- すべての外部副作用を取り消すこと。
- at-most-once transport から exactly-once 業務処理を自動生成すること。
- コアの property 観測を command RPC として扱うこと。

## 決定ゲート

### 1. lane をどこで選択するか

選択肢は 4 つあり、排他ではない（複数を採用する場合は優先順位も決める必要がある）。

| 配置 | 形 | 効果 | 代償 |
| --- | --- | --- | --- |
| (a) I/O タグ宣言 | Core が `new OperationLane(key, policy)` を固定 | 現状。ノードの意味論が 1 箇所に閉じる | 利用者は選べない |
| (b) binding 属性 | `data-wcs="command.fetch#exhaust: $command.refetch"` 等 | 端点ごとに選べる | `data-wcs` は配線であって DSL ではないという既存方針（`feedback_data_wcs_wiring`）に抵触しうる |
| (c) タグ属性 | `<wcs-fetch lane="exhaust">` | HTML から見える。既存の属性入力と同型 | 入力面が増える。属性が実行意味論を変える初の例になる |
| (d) userland 宣言（`$on` / state 側） | `$on: { name: { lane, retry, handler } }` | **state が持つ再試行・ガードのロジックが規範に載る** | `$on` の非同期契約（下記）を先に決める必要がある |

**(d) を明示的な選択肢として立てる根拠。** `latest` / `exhaust` / `retry` は本書と
`async-execution-model.md` §5 / §8 が既に規範化した語彙であり、`io-core/operation-lane.ts` が
実装も持っている。しかしその語彙が届くのはノードの内側だけで、**ノードをまたぐ実行**（可視性エッジ →
fetch → 失敗 → 待つ → 再実行）を組む利用者は同じ意味論を毎回手書きしている。
`examples/state-intersect-scroll` はその実例で、`$on.sentinelChanged` の `!loading` ガードは
`exhaust` policy の手書き実装であり、その正しさは「microtask が task に先行する」という
スケジューラの性質に依存している（[timing-and-firing-contract.md](../timing-and-firing-contract.md) §3）。
同デモの `retryAttempt` / `maxRetries` / `<wcs-timer manual once>` は §8 の
`max` / `interval` / `resetOn` / `excludeWhen` を手で組んだものである。
手書きの代償も実測されている: 当初の実装は交差エッジからも「ついでの」再試行を撃っており、
これが**予算を一切消費しないリトライ経路**になっていた（エラー表示行の出現・消滅がレイアウトを変え、
センチネルが observer マージンを跨ぎ、それ自体が次のエッジを生む自己持続ループ。
`e2e/tests/state-intersect-scroll.spec.ts` のリクエスト列で失敗サイクルあたり 1 回として検出）。
「すべての再試行経路が予算に載っている」ことは lane が宣言で保証できる不変条件であり、
手書きでは経路が増えるたびに人手で守るしかない。
(d) はこれらを新語彙の発明ではなく**既存語彙の露出**として扱う案であり、
「良いとこ取り統合は禁句」（[state-redesign-council.md](../state-redesign-council.md)）にも抵触しない。

**(d) を採る場合に先に決めること（サブゲート）。**

1. `$on` ハンドラが Promise を返すことを認めるか。lane は非同期 operation の概念であり、
   同期ハンドラのままでは `latest` / `exhaust` が意味を持つ範囲が「同期実行中」に限られる。
   ただし command-token は「呼び出しを await しない」を規範化済み（`spec-proposal-command-token-arguments.md`）で、
   これを変えると protocol 側の非目標（本書冒頭の MUST NOT）に触れる。ハンドラの非同期化を
   **state ローカルの契約**に閉じ込められるか否かがこのサブゲートの本体。
2. lane の identity を何にするか。`$on` のトークン名で 1 レーンか、宣言側で `laneKey` を指定させるか。
   複数トークンが 1 レーンを共有する形（credential の `get`/`store` 先例）を認めるか。
3. `retry` の判定入力。fetch は既に `errorInfo: { code, phase, recoverable }` を additive property として
   露出しており（`WcsIoErrorInfo`）、`when: (info) => info.recoverable` を書ける。この taxonomy を
   全ノード必須にするか、任意のままにするか。
4. 待ち時間の供給元。`<wcs-timer>` を内部で使うのか、state ランタイムが独自にタイマーを持つのか。
   後者はノード体系の外に時間を持ち込むことになるため、「時間もノードである」という現行方針との整合を要する。

なお (d) は `$streams`（`docs/state-streams-design.md`）が作った宣言マップ + registry +
drain フック + `$streamStatus` / `$streamError` 名前空間 + ライフサイクル契約の雛形を再利用できる。
新規実装は lane の写像と宣言バリデーションが中心になる見込み。

### 2〜4

2. operation identity / idempotency key を公開 API にする範囲。
3. stale 結果を完全に破棄するか、診断履歴だけに残すか。
4. Extension 1 adapter の対応範囲と capability 不足時の失敗方法。

## 参照

- [wc-bindable SPEC（固定コミット）](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/SPEC.md)
- [wc-bindable Extensions（固定コミット）](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/SPEC-extensions.md)
- [wc-bindable remote README（固定コミット）](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/packages/remote/README.md)
- [非同期実行モデル](../async-execution-model.md)
- [非同期 I/O ノード指針](../async-io-node-guidelines.md)
- [8 論点を横断する修正設計](09-remediation-design.md)
- [発火タイミング契約](../timing-and-firing-contract.md) — 決定ゲート 1 (d) が置き換えたい「手書きガードの正しさの根拠」
- `examples/state-intersect-scroll` — ノードをまたぐ実行を userland で手書きした実例（決定ゲート 1 (d) の動機）
