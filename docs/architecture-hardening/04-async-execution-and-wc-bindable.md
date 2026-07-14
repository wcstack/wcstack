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

1. lane を I/O タグ宣言、binding 属性、両者のどこで選択するか。
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
