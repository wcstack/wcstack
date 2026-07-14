# 接続直後の初期状態配送

- **状態**: 設計提案（未採択・未実装）
- **対象**: producer から consumer への初期同期と、state から要素への初回 apply

## 問題

「接続後に最初の change イベントが来る」と仮定すると、listener 登録より前に発火した通知を失う。
反対に、listener 登録後の初期 read を無条件に適用すると、その間に届いた新しい値を古い
スナップショットで上書きし得る。初期状態は一度きりのイベントではなく、購読確立と一体の
スナップショット取得として定義する必要がある。

## 二つの方向を区別する

### producer → consumer（観測）

最新 wc-bindable コア仕様は、listener を先に登録してから初期値を読む。property の存在判定は
`name in target` であり、property が明示的に存在すれば値が `undefined` でも consumer へ配送する。
これは「現在値が undefined である」という観測結果である。producer snapshot の時点は consumer option の
`syncOn: "call" | "connect"` で決まり、既定は `call` である。

### state / consumer → element（入力の apply）

wcstack では、state の未ロードを表す初期 `undefined` を要素の既定値へ書かず、接続時に要素値を
pull する既存イディオムがある。この `undefined` write-skip は入力方向のポリシーであり、上記の
観測方向に適用してはならない。

## 推奨する対策

### 1. listener-first snapshot を共通化する

1. teardown 可能な listener を全て登録し、event を ordered inbox へ配送する。
2. `syncOn: "call"` では同じ同期 frame で `name in target` を確認し、property を直接読む。
3. read 中の同期 event は event payload を最終候補にし、custom getter は初期 read へ使わない。
4. `syncOn: "connect"` では listener を動かしたまま最初の DOM 接続まで read を延期する。
5. 接続前 event は到着順に配送し、その後の接続時 property snapshot を最終候補として配送する。

`syncOn` は初期 authority とは別軸である。`BindingSession` は producer の初期配送を internal inbox で受けた後、
`init=state | element | auto | none` の policy に従って state / element のどちらを最終値にするか決める。
`connectedCallbackPromise` は wc-bindable の snapshot timing 契約ではないため暗黙に待たない。

listener install または初期 read が throw した場合は、その binding が既に登録した cleanup を全て best-effort で実行する。
初期 read 途中まで配送済みの property は rollback しない。詳細な状態機械は
[8 論点を横断する修正設計](09-remediation-design.md) を正とする。

### 2. 初期値と変更通知を診断上区別する

配送エンベロープまたは開発用 side channel に `phase: "snapshot" | "change"` と binding id を残す。
通常の consumer API を変更しない場合でも、デバッグ時に初期同期か後続変更か判別できるようにする。

### 3. `undefined` の意味を宣言する

- 観測可能 property が存在し値が `undefined`: 有効な初期スナップショット。
- 入力ソースが未初期化の `undefined`: apply を保留できる。
- property 自体が存在しない: 宣言不整合として診断する。

将来メタデータ化する場合は、`undefined` 一値に「未ロード」「消去」「有効値」を重ねず、明示的な
presence / readiness を追加する。

## 互換性と移行

既存イベント名と property 値は変えない。まず binding ランタイムの接続アルゴリズムと診断情報を
変更し、入力方向の `undefined` write-skip は既存互換として維持する。新しい presence 表現を導入する
場合は opt-in 宣言とし、旧 consumer には従来値だけを渡す。

## 検証条件

- upstream observer conformance vectors を同じ adapter test として実行する。
- `syncOn=call` の read 中 event は payload、`syncOn=connect` の接続前 event は接続時 snapshot が最後になる。
- connect 前の dispose、connect → disconnect race、ShadowRoot / structural Content の接続を検証する。
- 明示的に存在する `undefined` property が producer → consumer へ一度配送される。
- 未ロード state の `undefined` が state → element の既定値を消さない。
- 同一値の初期通知が重複しても、無限伝播や二重副作用を起こさない。
- 一つの bind generation では初期 snapshot が高々一回で、再 bind 時だけ新 generation になる。

## 非目標

- 初期値が必ず非 `undefined` であると保証すること。
- すべての producer に永続ログやグローバル時計を要求すること。
- 初期スナップショットを業務上の「初回イベント」として数えること。

## 決定ゲート

1. binding grammar の `syncOn` / `init` modifier 表記。
2. state slot の initialized bit をどの内部 API で公開するか。
3. snapshot / change の区別を公開 API ではなく開発用計装に限定するか。

## 参照

- [wc-bindable SPEC（固定コミット）](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/SPEC.md)
- [タグ定義とバインディング確立の順序](01-binding-initialization-order.md)
- [8 論点を横断する修正設計](09-remediation-design.md)
- [既存の初期化競合分析](../state-binding-init-races.md)
