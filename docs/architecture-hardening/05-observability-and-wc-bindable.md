# 観測性・デバッグと wc-bindable 境界

- **状態**: 設計提案（未採択・未実装）
- **対象**: 複数タグ、binding、非同期 operation、remote peer にまたがる因果追跡
- **外部仕様スナップショット**: wc-bindable-protocol
  `5ec0deef212578a072b2f669d2a5554f254253e0`、`@wc-bindable/core@0.8.0`

## 問題

疎結合なタグでは、一つのユーザー操作が state、filter、I/O、remote adapter を横断する。
個々の property をログするだけでは「誰が、どの binding を経て、なぜこの値を確定したか」が分からない。
一方、デバッグ情報を通常 payload や wc-bindable の観測規則へ混ぜると、タグの交換可能性と互換性を壊す。

## 現状

`docs/devtools-hook-protocol.md` は `globalThis.__WCSTACK_DEVTOOLS_HOOK__` を使う v1 side channel を定義し、
timeline、binding、token emission、subscriber count を観測する。state 向け実装と DevTools overlay は
`@wcstack/state@1.20.0` / `@wcstack/devtools@1.20.0` として 2026-07-14 時点で公開済みである。
I/O、非同期 operation、remote peer を含む end-to-end 因果追跡は今後の範囲である。

## 原則

### 1. 計装をデータ面から分離する

wc-bindable の `properties`、初期同期、change event、teardown の意味は変更しない。計装は optional な
side channel とし、hook が存在しない場合の分岐コストとメモリ保持を最小化する。デバッグ consumer が
通常 binding の購読者数、初期値、順序へ影響してはならない。

### 2. 宣言と実行を別に観測する

- **宣言面**: protocol / version、properties、inputs、commands、extension capability、remote declaration fingerprint。
- **実行面**: binding attach / sync / detach、read / write / notify、command、operation、retry、commit / stale / error。

宣言面は wc-bindable の discovery 結果を読み取り専用で利用する。remote の fingerprint と capability は peer が
何を提供すると合意したかの識別に使い、実行 trace の代用にはしない。

### 3. 因果 context を最小単位にする

各 trace record は可能な範囲で次を持つ。

- DevTools source ID、source-local sequence、任意の `traceId` / `parentId`
- `nodeId`、`bindingId`、`operationId`、`generation`
- `phase`（snapshot / change / command / progress / commit / stale / teardown）
- 単調時計の timestamp と同一 node 内 sequence
- outcome、duration、値の型。payload / preview は opt-in
- local / remote、protocol version、capability / declaration fingerprint

data-plane の `transactionId` / `visitedEdges` はtrace IDと分離する。hookがない場合も因果制御は同じで、
hook接続時だけtraceへ投影する。通常eventがcontextを運べない場合も、binding runtimeは同期write receiptと
operation identityから可能な範囲で関連付け、推測した関係には `inferred: true` を付ける。

## 推奨する表示モデル

### Graph

タグと remote peer を node、property / input / command binding を edge として表示する。未定義参照、宣言にない
path、Extension 1 非対応 command、購読者のない producer、teardown 漏れを静的・動的診断として重ねる。

### Timeline

一つの trace を attach → snapshot → change → operation start → remote request → commit の順に並べる。
非同期追い越しは generation ごとの lane、古い結果は `stale`、エコー抑止は抑止した edge と理由を表示する。

### Snapshot

late attach した DevTools は `kind: state` / `kind: io` などsourceごとのsnapshot callbackから、
現在の graph、binding、購読数、進行中 operation の基準点を取得し、
以後の event を追記する。attach 前の完全履歴を復元できるとは主張しない。

## 安全性とコスト

- 値payloadとpreviewは既定で保存せず、型など値を保持しないmetadataだけを出す。previewは明示policyでopt-inにする。
- credential、header、storage 値、File / Blob の内容は既定で表示しない。
- data hot pathはbounded ring bufferへのappendだけを行い、subscriberはmicrotask / animation frameでdrainする。
- overflowはtraceだけをdropしてdrop数を記録する。無制限queueを作らない。
- remote trace context は明示的な capability がある場合だけ送る。相手に内部 DOM path や秘密値を漏らさない。
- hook callbackとopt-in serializerの例外、遅延、再入はbridgeで隔離し、通常処理へ伝播させない。
- serializerはdrain側で実行し、depth、byte数、時間を制限する。getter関数やlive handleを直列化しない。

## wc-bindable との整合

- コア宣言の `inputs` / `commands` はメタデータであり、trace 上の command 実行を証明しない。
- Extension 1 対応 surface の `set`、`setWithAck`、`invoke` は別種の span として記録する。
- remote channel の順序、request id、ack、timeout、AbortSignal、back-pressure を保持し、観測上の timestamp だけで
  分散した全順序を捏造しない。
- 未知の optional field / extension は表示できなくても binding 自体を拒否しない。
- デバッグ拡張がコアの `protocol` 識別子や値配送を変更してはならない。

## 互換性と移行

既存 v1 hook を維持し、record kind と optional field を追加する。I/O と binding runtime を段階的に instrument し、
未対応タグは graph 上で「opaque」と表示する。破壊的な hook schema 変更が必要な場合だけ hook version を上げ、
通常の wc-bindable version とは独立に交渉する。

## 検証条件

- hook の有無でアプリケーションの最終状態と通知順が変わらない。
- 初期 snapshot、後続 change、エコー抑止、stale commit 拒否を timeline で区別できる。
- A → state → I/O → remote → state → UI の因果系列を一つの trace として辿れる。
- late attach 時に基準 snapshot と「履歴欠落」を正しく表示する。
- ring buffer overflow、hook 例外、DevTools detach 後も通常処理が継続する。
- redact policy と remote capability 不足時に秘密値や trace context を送らない。

## 非目標

- 分散システム全体の厳密な全順序を提供すること。
- 過去の全 payload を本番環境で永続保存すること。
- DevTools のためにコア binding protocol の意味を変更すること。

## 決定ゲート

1. trace context をタグへ渡す opt-in API の範囲。
2. node / binding identity の安定性と DOM 再接続時の扱い。
3. preview / redact の既定値とユーザー設定面。
4. remote trace capability を wcstack adapter metadata と wc-bindable extension のどちらで宣言するか。

## 参照

- [wc-bindable SPEC（固定コミット）](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/SPEC.md)
- [wc-bindable Extensions（固定コミット）](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/SPEC-extensions.md)
- [wc-bindable remote README（固定コミット）](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/packages/remote/README.md)
- [DevTools hook protocol](../devtools-hook-protocol.md)
- [DevTools tag design](../devtools-tag-design.md)
- [非同期実行と wc-bindable 境界](04-async-execution-and-wc-bindable.md)
- [8 論点を横断する修正設計](09-remediation-design.md)
