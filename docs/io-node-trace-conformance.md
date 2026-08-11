# wcstack I/O ノードのトレース意味論と適合契約 (I/O Node Trace Semantics and Conformance Contract)

- **対象**: `@wcstack` I/O ノードの実装者・レビュアー、共通 contract test の実装者、第三者 I/O ノード作者
- **状態**: 規範候補 `wcstack-io/0.1-draft`。「MUST / SHOULD / MAY」は採択後の契約強度を RFC 2119 の意味で示す。採択までは本書だけを理由に既存・新規ノードを不適合としてはならず、現行の正本は下記3文書とする。§6、§8、§12 の要求も採択後にのみ発効する。§9（導入段階）と §10（理論上の位置づけ）は採択後も informative
- **本書が変えないもの**:
  - wc-bindable-protocol、command-token、event-token の語彙・型・構文を変更しない
  - 既存 I/O ノードの公開 surface や実行時挙動を変更しない
  - `operationId`、timestamp、trace context を通常の data-plane payload に追加しない
  - DevTools trace の実装や、機械可読な適合ベクトル形式をこの版では要求しない
- **なぜ存在するか**: wcstack は I/O ノードの骨格、非同期レーン、発火タイミングを既に別々の正本で規範化している。しかし「どこまでを同じ入力に対して同じ結果になる単位と呼ぶか」と「その主張を第三者実装も含めてどう検証するか」は横断的に定義されていなかった。本書は I/O ノードを順序付き入力トレースから観測可能出力トレースへの因果的変換として定式化し、決定性の境界と適合ベクトルの共通形を与える
- **関連する正本**:
  - Core / Shell、observable、never-throw、lifecycle: [async-io-node-guidelines.ja.md](./async-io-node-guidelines.ja.md)
  - execution form、lane、commit、cancel、retry、timeout: [async-execution-model.ja.md](./async-execution-model.ja.md)
  - 同期 / microtask / task とノード別発火順: [timing-and-firing-contract.md](./timing-and-firing-contract.md)
  - lane の参照実装: [`io-core/operation-lane.ts`](../io-core/operation-lane.ts)
  - optional な診断 side channel: [devtools-hook-protocol.md](./devtools-hook-protocol.md)

---

## 0. TL;DR — 2つの主張

1. **決定性の単位**: 1つの Core instance は、初期状態と、application / lifecycle / platform / scheduler の同じ順序付き入力トレースに対して、意味的に同値な observable / platform-effect 出力トレースを生成する（MUST）。これは外部世界が決定的だという主張ではなく、**記録済みの外部入力に相対的な決定性**である
2. **適合性の単位**: ノードの契約は「初期条件＋入力トレース＋期待出力＋禁止出力」からなる**適合ベクトル**として検証できる。全ノード共通法則は共通 contract suite、API 固有の意味はノード固有ベクトルで検証する

この関係は一方向である。先に決定性境界を定義し、その観測可能な帰結を適合ベクトルにする。テスト実装の都合から公開意味論を逆算すると、仕様ではなくテスト実装が公開意味論を決めてしまうため、その順序は採らない。

---

## 1. 用語とモデル

### 1.1 node、owner、lane、operation

- **node**: 1つの I/O Core instance。Shell は Core の DOM adapter であり、決定性の中心は Core に置く
- **owner**: node の1回の有効な lifecycle 世界。`dispose()` は現在の owner generation を終わらせる
- **lane**: node 内の独立した排他単位。別 lane の開始・cancel・settle は互いの commit eligibility を変えない
- **operation**: lane が受理した1つの論理操作。retry の各 attempt と区別する
- **attempt**: 1つの operation を完了させる個々の試行。retry は同じ operation の新しい attempt を作る
- **commit**: platform 由来の結果を公開 property、event、command result へ反映すること
- **committing**: terminal outcome の claim 後、複数の観測面更新を行っている中間状態。claim 済みでも各更新の commit eligibility は保証されない
- **occurrence**: 同値か否かにかかわらず1回として意味を持つ event の発生
- **snapshot**: ある観測時点で property getter が返す最新の logical state

### 1.2 トレース

トレースは、1つの JavaScript agent 内で観測された record の有限または無限の順序列である。

```text
T = r0, r1, r2, ...
```

各 record は概念上、少なくとも次を持つ。

```text
record = <seq, kind, name, payload, phase?, frameId?, parentFrameId?, correlation?>
```

- `seq` は harness が観測した単調な順序番号である
- `kind` / `name` / `payload` は意味比較に使う
- `phase` は順序契約に必要な場合だけ `sync | microtask | task` 等を記録する
- `frameId` / `parentFrameId` は同期 call / dispatch の入れ子を表す。同期 event dispatch 中に到着した入力は、その event の dispatch frame を `parentFrameId` に持つ
- `correlation` は operation / attempt の識別が契約上必要な場合だけ使う
- wall-clock timestamp は診断情報であり、特記がない限り適合比較に使わない（MUST NOT）

`observable.event(A)` は同期 dispatch frame を開き、全 listener が戻った時点で閉じる。listener がその中で `app.command(B)` を呼んだ場合、`B.parentFrameId = A.frameId` として記録する。frame の入れ子を契約に含めるベクトルでは、harness は `frame.enter(A.frameId, causeRef)` と `frame.return(A.frameId)` を必須 record として残す（MUST）。これにより、次の2列を区別する。

```text
frame.enter(e1, event(A)) → event(A, frame=e1) → command(B, parent=e1) → frame.return(e1)  // 同期再入
frame.enter(e1, event(A)) → event(A, frame=e1) → frame.return(e1) → command(B)             // dispatch 後
```

非等間隔な callback、Promise settle、ユーザー入力を扱うため、本書の基本モデルは一様サンプリングを仮定する離散時間信号ではなく、**順序付きの離散事象トレース**である。`<wcs-raf>` の `dt` のように経過時間が意味を持つ値は platform input の payload として明示する。

### 1.3 意味的同値

2つの出力トレースは、公開契約に含まれる record の順序、回数、payload、および規定された同期 frame の親子関係が一致するとき意味的に同値である。

- 内部 `operationId`、object identity、診断 timestamp は、公開契約に含まれない限り比較から除外する
- state-like object / array は契約で定めた値比較または snapshot 比較を使う
- event は同値 payload でも occurrence の回数を比較する
- handle / managed resource は直列化せず、owner、参照同一性、交換、release point を比較する
- Error や platform object はノードが宣言した envelope / normalizer を通した結果を比較する
- permission、credential、位置情報、contacts、メディアを扱う適合ベクトルは合成値・fake handle だけを使う（MUST）。実測値、実資格情報、実連絡先、実ストリームの内容を repository や test report に含めてはならない（MUST NOT）

適合ベクトルは、比較から除外する field や normalizer を明示しなければならない（MUST）。「テストが不安定だから無視する」は適合理由にならない。

### 1.4 信頼境界

本書は、同一 JavaScript agent / realm 内の Core、Shell、test harness が協調して動く契約を定義する。record、frame、operationRef は認証・認可・改ざん検知の機構ではなく、悪意ある同一 realm code から秘密や整合性を守らない。cross-realm / remote adapter は transport 固有の認証、capability、serialization、順序保証を別途定義しなければならない。

適合ベクトルと report は公開されうる非機密 artifact として扱う。secret、token、credential、実位置、実連絡先、media content を trace payload、snapshot、preview、fixture に保存してはならない（MUST NOT）。

---

## 2. 入力と出力の alphabet

### 2.1 application input

利用者または binder から node へ入る操作。

```text
app.set(inputName, value)
app.command(commandName, args)
app.setBeforeUpgrade(propertyName, value)
```

属性変更は Shell が input setter へ正規化した後の `app.set` として扱う。`app.setBeforeUpgrade` は、custom element 定義前に作られた own property を `upgradeProperties()` が取り込む Shell 固有経路を表す。

### 2.2 lifecycle input

Core / Shell の所有世界を作り、終わらせる操作。

```text
lifecycle.observe(config?)
lifecycle.dispose
lifecycle.connect
lifecycle.disconnect
lifecycle.upgrade
```

Core の適合ベクトルは `observe` / `dispose`、Shell の適合ベクトルは `connect` / `disconnect` を主に使う。Shell は Core と意味が異なる独自の非同期状態機械を持ってはならない（MUST NOT）。

Shell の入力トレースでは、`app.setBeforeUpgrade` は対応する `lifecycle.upgrade` より前にだけ現れなければならず、upgrade 後の property 代入は `app.set` として記録する（MUST）。

### 2.3 platform input

ノード外の Web Platform または test double から届く非決定的入力。

```text
platform.resolve(operationRef, value)
platform.reject(operationRef, error)
platform.event(type, detail)
platform.revoked(type, detail)
platform.clockSample(value)
```

`operationRef` はテスト harness 内の相関名でよく、公開 `operationId` を要求しない。たとえば `requestA` / `requestB` を、test double が受けた1回目 / 2回目の呼び出しに割り当てられる。

### 2.4 scheduler input

順序そのものが契約に関わる場合、test harness は配送境界を明示する。

```text
scheduler.microtaskCheckpoint
scheduler.deliverTask(taskRef)
scheduler.advanceClock(duration)
```

`platform.clockSample(value)` は rAF timestamp や node が読む時刻源の観測値であり、それ自体は callback を配送しない。`scheduler.advanceClock(duration)` は fake scheduler の時刻を進め、期限に達した timer / rAF callback をベクトルが定めた順で配送する。両者を同期させるか、別の時計として扱うかは `initial` で宣言する（MUST）。

実ブラウザの全スケジューラを模倣する必要はない。既存の [timing-and-firing-contract.md](./timing-and-firing-contract.md) に記録された発火順と矛盾するベクトルを書いてはならない（MUST NOT）。採択後の規範上の保証は適合ベクトル自身が担い、参照ドキュメントから暗黙に導出しない。

### 2.5 observable output

利用者、binder、adapter が観測できる出力。

```text
observable.property(name, value, at=checkpointRef?)
observable.event(eventType, detail)
observable.commandResult(name, value)
observable.readySettled
observable.customState(name, on)
observable.attribute(name, valueOrNull)
```

`observable.commandResult` は Core method を直接呼んだときの同期値または Promise settle を表す。command-token は command を await せず、戻り値を observable として配送しない。`observable.customState` と `observable.attribute` は Shell contract test だけで使う。

`observable.event(eventType, detail)` の `eventType` は、system under test が公開する実際の event type を文字列で記録する。wc-bindable property の change event では `wcBindable.properties[].event` の値（例: `wcs-fetch:response`）を使い、property 名（例: `value`）を別名として使ってはならない（MUST NOT）。

`observable.property(name, value)` は property 変更時に生成される output record ではなく、ベクトルが指定した checkpoint で harness が getter を読んだ **snapshot assertion** である。checkpoint を省略した場合は `settleBoundary` を使う。property の変更通知に使う change event は `observable.event` として記録し、同じ logical state に property と event の2 record を自動生成してはならない（MUST NOT）。

property getter を読む行為は新しい occurrence を作らない。event は getter の現在値と同じ payload でも新しい occurrence になりうる。`allowAdditional` は system under test が生成する occurrence / effect に適用し、vector 自身が要求する snapshot assertion には適用しない。出力属性への reflect は `observable.attribute` として検証し、Core の決定性には含めない。

### 2.6 platform-effect output

node が外部世界へ要求した作用。test double が観測する。

```text
effect.call(apiName, args, operationRef?)
effect.cancel(operationRef)
effect.subscribe(source)
effect.unsubscribe(source)
effect.release(resourceRef)
```

適合性は observable output だけでなく、必要な platform call の回数、順序、resource release も対象にする。never-throw を満たしていても、二重購読や orphan resource を残す node は適合しない。

### 2.7 harness record

同期 call / dispatch の入れ子を検証する harness 固有 record。system under test の公開 output ではないが、適合トレースの core alphabet に含める。

```text
frame.enter(frameId, causeRef)
frame.return(frameId)
checkpoint.mark(checkpointRef)
```

`causeRef` は frame を開いた `observable.event` または同期 call を指す。`frame.enter` と `frame.return` は同じ `frameId` で対応し、入れ子は適切に閉じなければならない（MUST）。

`checkpoint.mark(checkpointRef)` は snapshot assertion を評価する位置を表す。vector の `input` 列へ runner directive として置けるが、node に届く `Tin` には含めない。直前までに列挙された input と scheduler 操作を処理した後、次の input へ進む前に getter を読む。marker 自体は microtask の drain や clock の前進を行わず、`checkpointRef` は vector 内で一意でなければならない（MUST）。

---

## 3. 決定性境界

### 3.1 トレース相対の決定性

node `N` の初期状態を `S0`、入力トレースを `Tin` とする。`S0` は Core の初期 field だけでなく、constructor 引数、node 設定、module-scope config の snapshot、test double と時計の初期状態を含む。入力トレースは次の直和である。

```text
Tin = interleave(Tapplication, Tlifecycle, Tplatform, Tscheduler)
```

`interleave` は kind で区別された4入力列を、実際の到着順と同期 frame の親子関係を保って1本へ合流する。集合和ではなく順序付きの merge である。

node の観測結果を次で表す。

```text
N(S0, Tin) = <Tobservable, Teffect, Sfinal>
```

同じ実装・設定の node に、意味的に同値な `S0` と `Tin` を与えた場合、`Tobservable` と `Teffect` も意味的に同値でなければならない（MUST）。

`Tin` には platform callback の**到着順**、scheduler checkpoint / clock advance、同期再入 frame、契約が使う payload（`dt`、status、permission state 等）を含む。実ネットワークの完了順、OS の許可判断、センサー値そのものを予測するという主張ではない。

### 3.2 因果性

入力トレースの同じ prefix に対し、node は同じ観測可能出力 prefix を生成しなければならない（MUST）。未来の platform input によって、既に発火した event や公開済み snapshot の意味が遡及的に変わってはならない。

同期 dispatch 中に受理された入力は、その dispatch frame が閉じる前の child record として置く（MUST）。dispatch 後の同じ名前・payload の入力と同一視してはならない（MUST NOT）。

この規則から次が導かれる。

- 公開済み state-like object / array を producer が後から mutate してはならない
- stale operation は新しい値だけでなく progress、error、loading 等も commit してはならない
- handle の有効期間を過去に遡って変更できないため、owner と release point を宣言する

### 3.3 決定性の階層

| 単位 | 規定するもの | 規定しないもの |
|---|---|---|
| Core instance | input trace から observable / effect trace への変換 | 外部世界の値や到着時刻 |
| owner generation | dispose 前後の commit 可否 | native 処理が物理的に停止したか |
| lane | operation の受理順・commit eligibility | 別 lane の順序 |
| binding graph | node 間の配送と state 更新 | remote system 全体の全順序 |
| application | domain rule を含む最終結果 | node 単体契約だけからの自動保証 |

「node が決定的」であることから「接続されたアプリ全体が決定的」とは導けない。後者には binding の flush 順、複数 source の合流規則、domain logic の契約も必要である。

### 3.4 commit 決定性

非同期 operation は、結果を受け取っただけでは commit できない。`owner generation`、terminal state、lane policy の eligibility をすべて満たした場合だけ commit できる（MUST）。参照実装は `OperationLane.canCommit()` / `claimTerminal()` でこの規則を実装する。

| policy | 受理と commit の規則 |
|---|---|
| `latest` | 最新の受理済み operation だけが commit eligible。置換された operation の settle は stale |
| `queue` | 受理順の active head だけが実行・commit eligible。terminal 後に次へ進む |
| `exhaust` | active 中の新規要求を受理しない。受理済み operation だけが commit eligible |
| `overlap` | 受理した各 operation が commit eligible。共有 observable は完了到着順に上書きされうる |
| `parallel` | 予約語。個別結果の公開モデルを別途定義するまで適合を主張できない |

terminal outcome の claim は operation ごとに高々1回でなければならない（MUST）。native abort と Promise settle が競合しても、複数の terminal outcome を公開してはならない。

claim は commit の**開始許可**であって、残りの更新すべての完了保証ではない。commit が複数の setter / event dispatch に分かれる場合、同期 listener はその途中で同じ lane を supersede または dispose できる。実装は各観測面更新の直前に eligibility を再検査しなければならず（MUST）、途中で失格した場合は以後の更新を書いてはならない（MUST NOT）。既に同期 dispatch 済みの出力は巻き戻さない。

§3.4 冒頭の「高々1回」は attempt 単位ではなく operation 単位に適用する。retry attempt ごとの中間 error / progress を公開するか、retry 中に loading を維持するかは node が宣言し（MUST）、適合ベクトルで各 attempt の観測列を固定する。

内部 outcome と観測面は同じ語彙ではない。次の写像に従う。

| lane 内部 outcome | 観測面への写像 |
|---|---|
| `success` | node 固有の value / completion event。必要なら stale error を規定どおり clear |
| `error` | `error` envelope。`cancelled` は立てない |
| `timeout` | `name: "TimeoutError"` の `error` envelope。`cancelled` は立てない |
| `aborted` | resource / control 上の中断。node が宣言した loading 等の後始末だけを行い、利用者による picker dismiss を表す場合を除き `cancelled` に写像しない |
| `stale` | supersede / owner 不一致で commit eligibility を失った結果。いかなる observable output にも写像しない |

`cancelled` は利用者都合の dismiss を表す公開軸であり、lane の `aborted` や `stale` の別名ではない。

### 3.5 lifecycle 決定性

- `dispose()` は全 lane の owner generation を無効化しなければならない（MUST）
- dispose 前に開始した非同期継続は、dispose 後に observable output を生成してはならない（MUST NOT）
- native cancel は resource 解放の手段であり、commit の正しさを単独で担ってはならない（MUST NOT）
- `dispose()` と `observe()` はそれぞれ冪等でなければならない（MUST）
- dispose → observe 後の新 owner は動作を再開でき、旧 owner の継続から影響を受けてはならない（MUST）
- `observe()` が owner generation を維持するか進めるかは node が宣言しなければならない（MUST）。target / options 変更時だけ進める場合も条件を列挙し、適合ベクトルの `initial` と lifecycle trace に含める

### 3.6 operation identity を公開する条件

内部 operation identity は commit guard、terminal CAS、resource 解放、診断に利用してよい。通常の property / event payload への公開は一律に要求しない。

- `latest` / `queue` / `exhaust` で共有観測面だけを公開する場合、内部 identity で十分
- `overlap` の結果を利用者が個別に相関する必要がある場合、node 固有の相関値を event detail に含めてよい（MAY）
- operation ごとの結果集合を公開する場合は `parallel` の公開モデルを先に設計しなければならない（MUST）
- 内部 operationId と、remote idempotency key / request ID / domain ID を同一視してはならない（MUST NOT）

---

## 4. 3レールの観測意味論

Web Platform の Promise、callback、EventTarget、Observer、再帰 scheduler、managed handle は、I/O ノード境界で次の3レールへ写像される。

| レール | 意味 | 時間上の性質 |
|---|---|---|
| property / value | 最新 logical state の snapshot | behavior-like。観測時点で現在値を読める |
| event | occurrence | 発生ごとに1件。同値 payload でも失われない |
| command / input | 外部から node へ入る要求 | operation または状態遷移の原因になる |

この表は古典 FRP の型へ完全準拠するという主張ではない。特に property は連続時間関数ではなく、イベント間で最後の値を保持する snapshot surface である。

### 4.1 property と event

- state semantics の property は同値ガードしなければならない（MUST）
- event semantics の occurrence は同値 payload でも毎回発火しなければならない（MUST）
- 同じ logical state を表す property getter と change event detail は、dispatch 時点で一致しなければならない（MUST）
- occurrence の履歴を property に暗黙蓄積してはならない。履歴化は consumer の fold または明示的な collection property の責務とする（MUST）

### 4.2 再標本化

`reobserve()` のような操作は「level を edge に変換する」一般演算子とは規定しない。node が platform へ再購読または再評価を要求し、その結果として現在状態に対応する新しい occurrence が届く**再標本化要求**として扱う。再標本化後に同値 occurrence を出すか否かは、各 node の timing 契約で規定する。

---

## 5. 適合ベクトル

### 5.1 最小構造

各適合ベクトルは、少なくとも次を記述する。

```text
id                   安定した識別子
contractVersion      対象とする本契約の正確な version
conformanceLevel     structural / trace
appliesTo            Core / Shell / lane / package
claim                検証する規範
initial              初期状態、設定、platform double
input                順序付き入力トレースと harness runner directive
expectedTrace        入力・出力を横断する必須の因果順（必要な場合）
expectedEffects      必須の platform-effect 出力
expectedObservations 必須の observable occurrence / snapshot assertion
forbidden            発生してはならない出力
normalization        payload の比較規則
settleBoundary       どこまで drain / clock advance して判定するか
allowAdditional      未列挙 occurrence / effect output を許すか（既定 false）
extensions           optional / required extension の宣言（任意）
```

機械可読形式は別途定める。この版では TypeScript test、表、擬似トレースのいずれでもよいが、上記フィールドに相当する情報を欠いてはならない（MUST NOT）。

機械可読化後、runner が未知の core record kind または必須 extension に遭遇した場合は、その vector を **unsupported** と報告し、pass として扱ってはならない（MUST NOT）。無視できる拡張 metadata は `x-` prefix と `required: false` を明示する。system under test が生成した未期待の公開 output は、vector が `allowAdditional` で許可しない限り黙って捨てない。

### 5.2 順序の表現

- 契約が全順序を要求する record は列として記述する
- 順不同を許す record は明示的な unordered group として記述する
- 同期再入を持つ record は `frameId` / `parentFrameId` に加えて、§2.7 の `frame.enter` / `frame.return` marker で入れ子を記述する
- 「最終値が合えばよい」として途中の禁止出力を無視してはならない（MUST NOT）
- microtask / task の違いが正しさに影響する場合、`settleBoundary` に checkpoint を含める（MUST）
- 中間 snapshot を検証する場合、直前に必要な scheduler 操作を列挙してから `checkpoint.mark` を置き、その一意な名前を `observable.property(..., at=checkpointRef)` から参照する
- 発生しないことを検証する場合、有限の観測境界を指定する（MUST）。無期限の「今後一切発生しない」をテスト結果だけから主張しない

以下の例は、各論点に関係するフィールドだけを示す説明用 fragment であり、そのまま適合 report には使わない。実行する vector では §5.1 の全フィールドを suite manifest の共通値を含めて展開し、`allowAdditional` も明示する。

### 5.3 例: fetch 型 latest の追い越し

```text
id: lane.latest.out-of-order-success
initial:
  policy = latest
  value = null
  status = 0
  objectURL = null
  loading event は送信ごとに発火する
input:
  app.command run(A)
  app.command run(B)
  platform.resolve(requestB, { value: valueB, status: 200, objectURL: null })
  platform.resolve(requestA, { value: valueA, status: 200, objectURL: null })
expectedObservations:
  observable.event("wcs-fetch:loading-changed", true)   // A 開始
  observable.event("wcs-fetch:loading-changed", true)   // B 開始
  observable.event("wcs-fetch:response", { value: valueB, status: 200, objectURL: null })
  observable.event("wcs-fetch:loading-changed", false)  // B settle
  observable.property(value, valueB, at=settleBoundary)
  observable.property(status, 200, at=settleBoundary)
  observable.property(objectURL, null, at=settleBoundary)
  observable.property(loading, false, at=settleBoundary)
forbidden:
  valueA を含む "wcs-fetch:response" event または settleBoundary での property snapshot
  A による loading(false) / error / progress の後着 commit
settleBoundary:
  全 Promise と microtask を drain
allowAdditional: false
```

### 5.4 例: dispose 後の stale settle

```text
id: lifecycle.dispose.drops-late-settle
input:
  lifecycle.observe
  app.command run(A)
  lifecycle.dispose
  platform.resolve(requestA, valueA)
expectedEffects:
  native cancel 手段があれば cancel / release
forbidden:
  dispose 後の value / error / loading / progress 変更
settleBoundary:
  requestA と全 microtask を settle
```

### 5.5 例: snapshot と occurrence の分離

```text
id: observable.equal-occurrences-are-preserved
initial:
  property active = false
  occurrence event type = "example:entry"
input:
  platform.event entry(true)
  platform.event entry(true)
expectedObservations:
  observable.event("example:entry", true)
  observable.event("example:entry", true)
  observable.property(active, true, at=settleBoundary)
```

### 5.6 例: overlap の後着上書き

```text
id: lane.overlap.completion-order-commits
initial:
  policy = overlap
  event mapping: value -> "example:value-changed"
input:
  app.command run(A)
  app.command run(B)
  platform.resolve(requestB, valueB)
  platform.resolve(requestA, valueA)
expectedObservations:
  observable.event("example:value-changed", valueB)
  observable.event("example:value-changed", valueA)
  observable.property(value, valueA, at=settleBoundary)
forbidden:
  A または B を stale として破棄すること
allowAdditional: false
```

### 5.7 例: timeout と遅着 success の terminal 競合

```text
id: terminal.timeout-wins-late-success
initial:
  observable surface = error + loading
  loading = false
  event mapping:
    error -> "example:error"
    loading -> "example:loading-changed"
input:
  app.command run(A)
  scheduler.advanceClock(timeout)
  platform.resolve(requestA, valueA)
expectedObservations:
  observable.event("example:loading-changed", true)
  observable.event("example:error", { name: "TimeoutError", ... })
  observable.event("example:loading-changed", false)
  observable.property(error, { name: "TimeoutError", ... }, at=settleBoundary)
  observable.property(loading, false, at=settleBoundary)
forbidden:
  valueA の commit
  timeout 後の success terminal
allowAdditional: false
```

### 5.8 例: retry attempt の観測規則

```text
id: retry.intermediate-error-hidden
initial:
  attemptError = hidden
  loadingAcrossRetry = true
  loading = false
  event mapping:
    error -> "example:error"
    loading -> "example:loading-changed"
    value -> "example:value-changed"
input:
  app.command run(A)
  platform.reject(requestA.attempt1, transientError)
  scheduler.microtaskCheckpoint
  checkpoint.mark(afterRetryScheduled)
  scheduler.advanceClock(retryInterval)
  platform.resolve(requestA.attempt2, valueA)
expectedObservations:
  observable.event("example:loading-changed", true)
  observable.property(loading, true, at=afterRetryScheduled)
  observable.event("example:value-changed", valueA)
  observable.event("example:loading-changed", false)
  observable.property(value, valueA, at=settleBoundary)
  observable.property(loading, false, at=settleBoundary)
forbidden:
  observable.event("example:error", transientError)
allowAdditional: false
```

### 5.9 例: 同期 event listener からの再入

```text
id: reentrancy.supersede-during-commit
initial:
  event mapping: value -> "example:value-changed"
  observable.event("example:value-changed") の listener は同じ dispatch frame 内で app.command run(B) を呼ぶ
input:
  platform.resolve(requestA, valueA)
expectedTrace:
  frame.enter(e1, observable.event("example:value-changed"))
  observable.event("example:value-changed", valueA, frame=e1)
  app.command run(B, parent=e1)
  frame.return(e1)
forbidden:
  B が A を supersede した後に、A の残りの error / loading / progress を commit すること
```

---

## 6. 共通適合法則

**以下は本書の採択後に発効する。** 新規 I/O ノードと、該当意味論を変更する既存ノードは、適用可能な次の法則を適合ベクトルまたは共通 contract suite で検証しなければならない（MUST）。

適用可否は自己申告だけで決めず、次の機械的な前提条件から決める。

| 法則群 | 適用条件 |
|---|---|
| §6.1 構造 | 全 I/O node。Shell 固有項目は Shell 適合を主張する場合 |
| §6.2 observable | 1つ以上の property / event / CustomStateSet / reflected attribute を公開する node。各項目は該当 semantics を宣言した surface |
| §6.3 error と settle | 公開操作、非同期 probe、`ready`、error / cancelled / timeout surface のいずれかを持つ node。各項目は該当 surface |
| §6.4 lifecycle と resource | 全 I/O node。resource release 項目は listener / timer / observer / handle 等を取得する node |
| §6.5 concurrency | 1つ以上の非同期 lane / operation を開始する node |
| §6.6 scheduler / reentrancy | microtask / task / clock / callback を使う node、または同期 dispatch listener から再入可能な node |

前提条件を満たさない場合、tag-design doc と適合 report に根拠を記録する（MUST）。前提条件を満たす法則を実装しない場合は「非該当」ではなく**逸脱**であり、その契約 version の該当適合レベルを主張してはならない（MUST NOT）。suite が surface から適用条件を判定できる場合は自動判定を優先し、reviewer / verifier は根拠不足の非該当宣言を reject できる。

### 6.1 構造

1. Core は headless に構築でき、`static wcBindable` の宣言と実 surface が一致する
2. Shell は input / attribute、lifecycle、observable を Core へ委譲し、独自の実行意味論を増やさない
3. property / input / command の名前と event mapping が descriptor と一致する
4. `wcBindable.inputs` に宣言した入力は、custom element upgrade 前の property 代入を `upgradeProperties()` により upgrade 後の setter へ取り込む
5. 属性連動 input の property setter は、宣言どおり属性へ reflect する

### 6.2 observable

1. state は同値更新を抑止する
2. event は同値 occurrence を失わない
3. property read と event payload は同じ logical state を表す
4. state-like object / array の過去 snapshot は後続更新で変化しない
5. handle は owner、交換、release point の契約を満たす
6. 対応環境の `observable.customState` は駆動 event の同期 dispatch 中に反映を完了する。constructor で反映 listener より後に登録された利用者 listener からは反映済み state が見える

### 6.3 error と settle

1. 公開操作は platform API 不在、同期 throw、Promise reject を未処理例外として外へ漏らさない
2. error、cancelled、timeout を [async-execution-model.ja.md](./async-execution-model.ja.md) の軸へ正規化する
3. terminal outcome は operation ごとに高々1回
4. `ready` / `connectedCallbackPromise` は success、error、unsupported の全経路で規定どおり settle する
5. retry を持つ node は、attempt error / progress と retry 中 loading の公開規則を宣言どおりに保つ

### 6.4 lifecycle と resource

1. `observe()` / `dispose()` は冪等
2. dispose 後の stale 継続は observable へ commit しない
3. dispose → observe で新 owner として復活できる
4. listener、timer、observer、stream、handle は owner 契約どおり release される
5. `observe()` の generation policy と target / options 変更時の stale 規則を宣言どおりに保つ

### 6.5 concurrency

1. 宣言した全 lane policy について、開始順と逆の settle 順を含むベクトルを持つ
2. success だけでなく error、timeout、retry timer、progress にも同じ commit guard を適用する
3. 別 lane の開始・cancel・dispose 以外の settle が互いを無効化しない
4. native cancel が効かない double でも commit 規則を満たす
5. multi-setter commit は同期再入後に eligibility を再検査し、失格後の残りの更新を止める
6. retry を持つ node は、operation と attempt の terminal / intermediate 規則を逆順 settle を含むベクトルで検証する

### 6.6 scheduler

1. sync / microtask / task の順序へ依存する場合、その依存を timing 契約とベクトルに記録する
2. coalesce は指定した窓の中だけで行い、異なる task の occurrence を暗黙に失わない
3. timer、rAF、retry は fake clock または制御可能な callback で有限に検証する
4. 同期 dispatch listener から input / command / lifecycle 操作へ再入できる node は、frame の入れ子と再入後の出力を固定するベクトルを持つ

---

## 7. 適合レベル

### 7.1 外部 prerequisite

[wc-bindable SPEC](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/SPEC.md) への適合は同 SPEC が定義する外部 prerequisite であり、本書は新しい `wc-bindable conformant` レベルを定義しない。wcstack I/O 適合を主張する Core / Shell は、対象とする wc-bindable SPEC version を report に記録し、その仕様への適合を先に満たさなければならない（MUST）。

### 7.2 wcstack I/O 適合レベル

| レベル | 必須法則 | 主張できること |
|---|---|---|
| **wcstack I/O structural** | §6.1〜§6.4 のうち適用条件を満たす全法則 | Core / Shell、observable、error / settle、lifecycle / resource の基礎契約に適合する |
| **wcstack I/O trace** | structural の全法則＋§6.5〜§6.6 の適用法則＋node 固有ベクトル | 宣言した execution form、lane、timing、再入を含むトレース契約に適合する |

下位レベルへの適合だけで上位レベルを名乗ってはならない（MUST NOT）。前提条件を満たす法則に逸脱がある場合、その法則を要求するレベルを主張できない。「公式認証」やロゴ利用条件は本書のスコープ外であり、現時点では test report、適用 / 非適用根拠、対象 version を併記する自己申告を想定する。自己申告は §6 の適用条件を上書きしない。

### 7.3 契約 version

本書の契約 version は、適合レベルごとに分岐しない単一系列とする。適合主張は正確な契約 version と、主張する level を別々に含める。

```text
contractVersion: wcstack-io/1.0
conformanceLevel: structural | trace
```

`trace` は同じ contract version の `structural` を包含する。したがって、§6.1〜§6.4 の変更を含む新 version は両 level に同時に適用され、互いに異なる structural / trace version を組み合わせてはならない（MUST NOT）。

- 誤字、リンク、意味を変えない明確化は patch を上げる
- optional field / optional vector の追加は minor を上げる
- 必須法則の追加、適用条件の拡大、既存法則の意味変更は既存実装を新たに不適合にしうるため major を上げる
- 過去の report は記載 version に対する結果として有効なままだが、新 version への適合を意味しない
- suite / report は契約 version と suite implementation version を別々に記録する

draft 期間中は `wcstack-io/0.x-draft` とし、どの level についても適合を正式に主張しない。

---

## 8. ノード設計・レビューへの適用

**本節は採択後に発効するレビュー運用規範である。** 新規 node の tag-design doc は、既存ガイドラインに加えて次を含める（MUST）。

1. input / output alphabet。特に platform callback と resource effect
2. execution form と lane 構成
3. observable ごとの state / event / handle semantics
4. commit eligibility と terminal outcome
5. trace normalization。Error、object、handle、timestamp の比較方法
6. 共通法則の適用条件、非適用根拠、逸脱の表
7. node 固有の適合ベクトル

公開挙動を変更する場合、対応する適合ベクトルと、現行挙動の参照記録である [timing-and-firing-contract.md](./timing-and-firing-contract.md) を同じ変更で更新しなければならない（MUST）。レビューは実装、規範ベクトル、参照記録、example の説明の drift を認めない。

レビューでは次の順で確認する。

```text
境界を列挙する
  → 入力・出力 alphabet を固定する
  → lane と commit 規則を固定する
  → 禁止 trace を固定する
  → 適合ベクトルを書く
  → 実装と test を照合する
```

---

## 9. 導入段階（informative）

本書の追加だけで既存全 node に新しい test file を要求しない。次の段階で移行する。

### Phase 0 — draft の検証と採択

- fetch（one-shot / latest）、intersection（monitor / occurrence）、raf（stream / clock）の3 archetype へ本書を試適用する
- 既存 test だけで表現できない law と、過剰に強い law を分ける
- input / output alphabet と vector の最小 field を確定する
- 採択時に本書を `wcstack-io/1.0` として normative へ変更し、`structural` / `trace` をその適合レベルとして確定したうえで、[async-io-node-guidelines.ja.md](./async-io-node-guidelines.ja.md) の設計・test・レビュー checklist へ必須項目を追加する

初回の対応確認では、3 archetype とも本書の基本モデルで既存 test を説明できる。

| archetype | 既存の検証根拠 | 本書で与える共通名 | draft 採択前の残差 |
|---|---|---|---|
| fetch | [`fetchCore.phase4.test.ts`](../packages/fetch/__tests__/fetchCore.phase4.test.ts) の timeout terminal CAS / 逆順 settle / stale success / stale error / commit 中再入 | `latest` commit vector、terminal / forbidden trace、reentrant frame | property・event・effect の完全な順序列を共通 recorder でまだ採取していない |
| intersection | [`intersectionCore.test.ts`](../packages/intersection/__tests__/intersectionCore.test.ts) の reobserve / stale callback / dispose→observe | resampling vector、lifecycle vector、occurrence semantics | 同値 entry 2回の occurrence と state-view dedupe を1つの共通 vector ではまだ表していない |
| raf | [`rafCore.test.ts`](../packages/raf/__tests__/rafCore.test.ts) の `dt` / stop→start / cancel 無効 scheduler / listener 内再入 | clock payload、scheduler input、stale frame 禁止、reentrant frame | fake scheduler の操作を共通 alphabet へ写す helper がまだない |

この表は「3 node が本書へ正式適合済み」という認証ではない。既存 test と提案モデルの対応を示す Phase 0 の出発点である。

### Phase 1 — 文書と既存テストの対応付け

- 既存 test を共通法則へ分類する
- 欠落している法則を package 単位で棚卸しする
- node 固有の適合ベクトルを tag-design doc または test comment に記録する

### Phase 2 — 共通 trace recorder

- Core の EventTarget 出力と platform double 呼び出しを順序付きで収集する test helper を作る
- payload normalizer、unordered group、forbidden matcher、settle boundary を提供する
- production runtime や wc-bindable protocol へ依存を追加しない

### Phase 3 — machine-readable vector

- 複数 package で同じ表現が安定してから serialization 形式を決める
- descriptor / manifest から構造ベクトルを生成する
- 意味論固有ベクトルは人が記述し、metadata から推測しない

### Phase 4 — 第三者 node 向け contract suite

- package 外から Core / Shell へ適用できる public harness を検討する
- report に契約 version、適合 level、suite version、node version、実行環境を記録する
- browser 固有差を core contract と integration profile へ分離する

---

## 10. 理論上の位置づけ（informative）

本モデルは、Web Platform の異種 API を次の共通境界へ正規化するものと説明できる。

> Web Platform の Promise、callback、EventTarget、Observer、scheduler、managed handle を、behavior-like な状態出力、occurrence 出力、command / input を持つ離散事象的な I/O 境界へ写像する。

これは次の理論と関係するが、どれかへの完全準拠を主張しない。

- FRP: behavior / event の区別と、値の伝播による構成
- DEVS: 外部入力、内部遷移、出力、非等間隔な事象
- Mealy machine / transducer: 入力列と内部状態から出力列を生成する見方
- Functional Core / Imperative Shell: 外部副作用を境界に閉じ込め、内側へ値として渡す分離

本書の規範はこれらの理論用語ではなく、Web Platform と現行実装に直接対応する trace、snapshot、occurrence、lane、commit、owner で記述する。理論との類似は設計理解を助けるが、規範の根拠は公開された観測可能挙動と適合ベクトルである。

---

## 11. 非目標

- Web Platform、ネットワーク、OS、利用者入力を決定的にすること
- wall-clock timestamp だけから分散した全順序を復元すること
- すべての event 履歴を state に保存すること
- native cancel によって外部副作用そのものを必ず取り消すこと
- operationId を全公開 payload へ追加すること
- tag 間の application workflow 全体を node 単体の lane で直列化すること
- test harness のために production data-plane へ trace 情報を混ぜること

---

## 12. レビュー収束チェックリスト

**本チェックリストは採択後に発効する。**

- [ ] node の application / lifecycle / platform / scheduler input を列挙した
- [ ] observable / platform-effect output を列挙した
- [ ] trace の意味比較と normalization を定義した
- [ ] 同期再入を frame / parent frame で表現し、再入ベクトルを用意した
- [ ] owner と全 lane の決定性境界を定義した
- [ ] `observe()` の generation policy を定義した
- [ ] lane policy ごとの commit / stale 規則を定義した
- [ ] operation / attempt / internal outcome / observable outcome の写像を定義した
- [ ] operation identity を内部に留めるか公開するかを理由付きで決めた
- [ ] state snapshot と event occurrence を区別した
- [ ] CustomStateSet と属性 reflect を含む Shell 出力を必要に応じて列挙した
- [ ] terminal outcome の高々1回と multi-setter の再検査を検証した
- [ ] dispose 後の stale settle を禁止 trace として検証した
- [ ] 逆順 settle を含む concurrency vector を用意した
- [ ] timing 依存を scheduler input と settle boundary で明示した
- [ ] 共通法則の適用条件を評価し、非適用項目には検証可能な根拠を記録した
- [ ] 適合主張と report に正確な契約 version と level を記録した
- [ ] node 固有ベクトルと timing 契約を実装変更と同時に更新した
