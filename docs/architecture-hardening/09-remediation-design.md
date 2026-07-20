# 8 論点を横断する修正設計

- **作成日**: 2026-07-14
- **状態**: 統合設計提案（未採択・未実装）
- **対象**: `@wcstack/state`、I/O Core / Shell、DevTools、VS Code 拡張、wc-bindable adapter
- **前提**: [論点 1〜8](README.md#論点一覧) と既存の実装済み対策を置き換えず、段階的に統合する

## 1. 結論

修正の中心は、新しい巨大な公開プロトコルではなく、次の五つの小さな責務を導入することである。

| 責務 | 役割 | 主に解決する論点 |
| --- | --- | --- |
| `BindableDeclarationReader` | wc-bindable 宣言を一か所で検証・解釈する | 1、6、8 |
| `BindingSession` | definition、attach、初期同期、teardown を binding 単位で所有する | 1、2、3 |
| `PropagationContext` | 双方向伝播の原因、通過 edge、write receipt を追跡する | 3、5 |
| `OperationTicket` | 非同期操作の lane、世代、commit 権を管理する | 4、5 |
| sidecar manifest / application schema | 型、非同期 policy、platform capability を tooling 向けに公開する | 4、6、7、8 |

これらの実行状況を既存の DevTools hook へ side channel として送る。通常の property 値、event detail、
command 引数、wc-bindable コアの初期同期意味論は変更しない。

設計を三つの面に分ける。

| 面 | 構成 | 不変条件 |
| --- | --- | --- |
| データ面 | `BindingSession`、`PropagationContext`、`OperationTicket` | 値と副作用の正しさを hook や timeout に依存させない |
| 契約面 | wc-bindable 宣言 reader、sidecar、capability probe | 未知の optional 情報を無視し、必要能力だけを明示的に検査する |
| 観測面 | DevTools hook、validator diagnostics | データ面の順序、購読数、payload を変えない |

## 2. 最初に直す境界: `BindableDeclarationReader`

現在の state runtime は、two-way、event-token、spread、command、attribute mirror の各経路で
`protocol === 'wc-bindable' && version === 1` を個別に判定している。これを単一 reader へ集約する。
ただし、reader が wc-bindable の discovery 規則を独自に作り直してはならない。

```ts
interface ReadBindableResult {
  readonly target: WcBindableElement;
  readonly liveDeclaration: WcBindableDeclaration;
  knownProperties: ReadonlyMap<string, IWcBindableProperty>;
  declaredInputs: ReadonlyMap<string, IWcBindableInput>;
  declaredCommands: ReadonlyMap<string, IWcBindableCommand>;
}

function readBindableDeclaration(target: unknown): ReadBindableResult | null;
```

runtime reader は repository 内の canonical source から各公開 package へ生成または bundle した conformance mirror を
validation gate として使う。mirror は固定した upstream conformance vector に一致させ、独自仕様として分岐させない。
公式 `getWcBindableDeclaration(target)` は開発時と conformance test の参照実装（oracle）として使い、公開 artifact に
外部 runtime import を残さない。現行の `protocol/wc-bindable.ts` は型の canonical source だけなので、runtime reader の
canonical 実装と生成・同期検査を追加する。

これにより次を保証する。

1. discovery path は `target.constructor.wcBindable` の一つだけで、instance override や registry fallback を足さない。
2. consumer-side target に `addEventListener` / `removeEventListener` があることを検査し、`dispatchEvent` は要求しない。
3. `version` は 1 以上の整数をすべて受理し、未知の optional field を無視する。
4. `properties` だけでなく `inputs` / `commands` を含む宣言全体の schema と名前重複を検査する。
5. discovery 中の property access が throw しても外へ投げず、invalid declaration とする。
6. 戻り値は live declaration であり、clone、freeze、正規化 snapshot とは扱わない。

`inputs` / `commands` は宣言 interface metadata であり、存在だけから Extension 1 の `set` / `setWithAck` / `invoke`
意味論を推測しない。local Shell への通常 assignment と、明示的に Extension-1-capable な remote / automation surface は
別の invocation resolver で分岐する。

構造化 diagnostic は validation gate の結果を上書きしない開発時 analyzer とする。静的に確定できるのは descriptor の
shape、名前、event 文字列、getter の型までであり、「event が実際に発火する」「getter が正しい値を返す」は
conformance test の責務である。analyzer は再度 executable metadata へアクセスし得るため、明示的な開発モードだけで動かす。

共有型の `version: 1` は `version: number` へ緩和し、runtime reader が整数・下限を検査する。
破壊的な binding contract は高い version を拒否して扱うのではなく、別 protocol identifier または
明示 extension とする。

`wcBindable` は inert JSON ではなく、getter 関数と discovery 時の property access を含む trusted executable metadata である。
validation は sandbox ではなく、読み込んだ component code と同じ trust boundary に置く。

## 3. `BindingSession`: binding に所有者を与える

### 3.1 現状から変える点

現在は、two-way listener、event-token、spread、初期 apply がそれぞれ別に `whenDefined()` を登録する。
この方式では、同じ binding の phase と teardown 所有者が一つに定まらない。また、upgrade 時の
`connectedCallback()` が発火した初期イベントは、定義後に listener を付けるまでに失われ得る。

`initializeBindings()` の公開 facade は維持し、その内部で reactive root ごとの `BindingSession` と、
Document / ShadowRoot / structural `Content` ごとの `BindingOwner` を作る。
既存の `scheduleDeferredApply`、deferred spread、各 handler の定義待ちは、段階的に session へ集約する。

### 3.2 状態機械

```text
discovered
  ├─ custom tag 未定義 ─> waiting-definition
  └─ 定義済み ─────────> ready-to-attach

waiting-definition ─> ready-to-attach ─> attaching ─> synchronizing ─> active
                                           ├─ init=none ────────────> active

全 phase ── contract error ─> failed
全非終端 phase ── teardown ─> disposed
```

| phase | 実行すること | phase を抜ける条件 |
| --- | --- | --- |
| `discovered` | path、対象 node、明示 modifier を仮 record 化 | binding record 登録完了 |
| `waiting-definition` | tag 単位の共有 `whenDefined()` を待つ | 定義、dispose、構造エラー |
| `ready-to-attach` | 宣言を読み、方向・初期 authority を確定して同じ turn の cohort に集める | cohort の attach sweep 開始 |
| `attaching` | cohort 内の producer → state listener をすべて先に登録 | cohort 全 record の listener 所有権確立 |
| `synchronizing` | authority に従い snapshot または state 値を一度同期 | 初期同期完了 |
| `active` | 後続 event / state update を伝播 | teardown または fatal contract error |
| `failed` | 構造化 diagnostic を残して所有 resource を破棄 | 終端 |
| `disposed` | listener、address、保留 callback、receipt を無効化 | 終端 |

binding record は公開 `IBindingInfo` を変更せず、`WeakMap` に保持する。

```ts
type BindingPhase =
  | 'discovered' | 'waiting-definition' | 'ready-to-attach' | 'attaching'
  | 'synchronizing' | 'active' | 'failed' | 'disposed';

type InitialAuthority = 'state' | 'element' | 'auto' | 'none';
type ObservationPhase = 'not-applicable' | 'pending' | 'awaiting-connection' | 'synced';

interface BindingRecord {
  readonly id: number;
  readonly info: IBindingInfo;
  readonly generation: number;
  phase: BindingPhase;
  initialAuthority: InitialAuthority;
  syncOn: 'call' | 'connect';
  observationPhase: ObservationPhase;
  initialAttempt: number;
  eventSequence: number;
  readonly teardowns: Set<() => void>;
}
```

`phase` は binding の ownership、`observationPhase` は producer 初期観測の完了状態であり、直積として扱う。
たとえば listener が稼働する `active` binding が `syncOn=connect` の snapshot だけを待つ状態を表現できる。

`disposed` record は再利用しない。再接続・再発見時は単調増加する新しい `generation` の record を作る。
すべての Promise continuation は捕捉した generation、期待 phase、`initialAttempt` と
`BindingOwner.isAlive(record)` を再検査する。一致した一つの continuation だけが phase を進める。
`isConnected` だけを生存条件にすると、mount 前の `DocumentFragment` を誤って dispose するため使わない。

### 3.3 definition の待機

session 内の `DefinitionCoordinator` は registry と tag の組ごとに `whenDefined()` を一度だけ登録し、待機 record を集合で
管理する。record の dispose 時には集合から削除するため、永久に定義されない tag が DOM node を保持しない。
現在は global registry adapter を使い、scoped custom-element registry を導入するときも coordinator の key と
`get` / `whenDefined` / `upgrade` 呼び出しだけを差し替えられるようにする。

definition 完了時、owner が保持する node がまだ disconnected subtree にある場合は、利用可能なら registry の
`upgrade(node)` を呼んでから宣言を読み、listener を attach する。接続済みかどうかと instance が upgrade 済みかを
同一視しない。`initializeBindingsByFragment()` は transient owner handle を内部結果へ含め、生成された `Content` が引き取る。
mount 前は valid、`Content.unmount()` / dispose 後は invalid と判定する。

`<wcs-defined>` は引き続き、アプリケーションが複数タグの registration readiness、進捗、timeout を
観測するために使う。state runtime の正しさを DOM 上の `<wcs-defined>` の有無には依存させない。
両者は同じ platform signal を異なる責務で使う。

- `<wcs-defined>`: アプリケーション向けの集合 readiness。
- `DefinitionCoordinator`: binding runtime 内部の個別 activation。

`<wcs-defined>` の `hidden` / `display:none` は表示だけを隠し、監視対象 node の接続、`connectedCallback()`、
binding、I/O 副作用を遅延しない。処理そのものを gate する場合は、command / effect の実行条件を
`defined` state に依存させる。`DefinitionCoordinator` は `<wcs-defined>` の timeout / missing とは独立して待ち、
後から tag が定義された場合も該当 binding を activation する。

### 3.4 attach-first と初期 snapshot

定義済み record を一つずつ attach → sync せず、同じ microtask までに ready になった record を cohort として
二段階で処理する。未定義 tag のために root 全体を待つことはしない。

1. cohort 全 record を `readBindableDeclaration()` で検査する。
2. **attach sweep** で producer listener をすべて登録する。handler は同期的に `eventSequence` を増やし、
   getter で抽出した値を binding 単位の ordered inbox へ積む。
3. **producer sync sweep** で `syncOn` に従い初期 property read を inbox へ配送するか、connection 待ちを arm する。
4. **authority sync sweep** で解決済み authority に従う。
   - `state`: 最新 state 値を同期 scope の `WriteReceipt` 付きで local input へ適用する。
   - `element`: producer inbox の初期 snapshot を state commit 候補にする。
   - `none`: 初期候補を外部 state へ commit しない。
5. `settleInitial(expectedPhase, initialAttempt)` の compare-and-set に成功した record だけを active にする。

この cohort barrier により、A の初期 setter が B の event を同期発火しても、同じ ready cohort の B は既に購読済みである。
後から定義された cohort については current property の snapshot で level state を回収する。

BindingSession は cohort と authority を扱うため upstream `bind()` をそのまま呼ばず、Level 1O の observer lifecycle を
内部 inbox に対して実装する。初期 read は custom getter を呼ばず、`name in target` で存在を判定し、明示的な
`undefined` も配送する。upstream conformance vector をそのまま adapter test として実行する。

listener 登録、初期 read、connection observer の install 中に record が throw した場合は、その record が既に登録した
cleanup を逆順にすべて実行して `failed` にする。他 record の cohort 処理は継続する。cleanup の一件が throw しても
残りを best-effort で続け、secondary error は diagnostic にだけ残す。初期 read 途中まで inbox へ配送済みの値は
rollback しないという upstream の partial-delivery 契約も維持する。

### 3.5 producer snapshot の `syncOn`

初期 authority は「最終的に state と element のどちらを採るか」、wc-bindable の `syncOn` は「producer の
初期 property read をいつ inbox へ配送するか」であり、別軸にする。

| `syncOn` | snapshot 時点 | snapshot 前の event と競合した場合 |
| --- | --- | --- |
| `call`（既定） | listener attach と同じ同期 session drain | event payload を最終候補にする |
| `connect` | unconnected `HTMLElement` が最初に接続された時 | 先行 event の後に property read を配送し、snapshot を最終候補にする |

`call` では `seq0 → property read → seq1` とし、read 中の同期 event で sequence が変われば snapshot を最終候補にせず、
event payload を残す。`connect` では接続前 event も到着順に inbox へ配送し、接続時 snapshot をその後へ enqueue する。
connection observer と dispose は `initialAttempt` の CAS で競合させ、snapshot は高々一回にする。

`syncOn=connect` は unconnected DOM element にだけ適用し、headless target、remote proxy、DOM API のない環境、未知の値は
upstream と同じく `call` へ fallback する。wcstack では `#sync=connect` modifier を consumer option として表現し、
wc-bindable declaration へ書き込まない。structural `Content` の明示 mount と登録済み Document / ShadowRoot observer を
connection signal として使い、binding ごとの document-wide observer は作らない。

`hasConnectedCallbackPromise` / `connectedCallbackPromise` はこの契約ではないため暗黙には待たない。
特に `<wcs-defined>` の Promise は監視対象の完了待ちであり、timeout なしでは永久 pending になり得る。
既定 `syncOn=call` なら 6 個の出力 property を直ちに read でき、binding は監視完了を待たない。

producer 初期値は authority 判定前に internal inbox へ配送する。`init=state` ではその候補を診断可能なまま state へは
commit せず、state input write を最終値とする。`init=element` では候補を state へ commit する。これにより observer の
初期配送を消さずに、上位 binding policy として初期競合を解決する。

初期 state setter が同期通知を返した場合、同値は receipt confirmation として抑止し、異なる値は element による
正規化結果として queue へ積む。独立した外部 event と正規化結果は初期 write より後の変更として優先する。

upgrade 中に初期イベントを取り逃しても、event 後の current property を snapshot できれば復元できる。
イベント自体が離散的意味を持ち current property を持たない場合は replay しない。event-token / command-token は
従来どおり離散イベントであり、定義前の空撃ちを自動再生しない。

### 3.6 初期 authority を明示する

> **実装ステータス（2026-07-16）**: 本節の方向認識初期同期は `enableDirectionalInitialSync`
> として実装され、**既定 `true`**（恒久 opt-out フラグは残置）。output-only member の element
> authority 初期読取、`#init=` / `#sync=` modifier を含む。詳細と残作業は
> [10-defaulting-rollout-status.md](10-defaulting-rollout-status.md) を参照。
>
> **修正（2026-07-21）**: 初期実装は resolvedAuthority を定常 apply のゲートにも使い、
> element / none authority の binding で state→element を**恒久**抑止していた（本節の
> 「双方向 member の modifier は初期同期を支配する」に対する乖離。双方向 member への
> `init=element` が実質 one-way 化し、`<wcs-storage>` 型の load-before-bind を修飾子で
> 解決できなかった）。`shouldApplyState` を二相化し、初回相談（初期 sweep / 初回 render /
> deferred initial apply の選別）だけ authority で答え、定常は output-only member の契約と
> `sync=connect` の接続 snapshot 未解決の間のみブロックするよう修正済み
> （10 §D 8 件目、`bindings.initialSyncPolicy.test.ts` / `integration.initialAuthority.test.ts`）。

初期値の競合は timing だけでは解決できない。まず wc-bindable の member direction から既定値を決め、
双方向 member だけを主対象として binding modifier で上書きする。

direction resolver は宣言 metadata と target kind を分けて扱う。local Core / Shell の `inputs` は通常の JS assignment
surface を表すが、その assignment に Extension 1 の ack、順序、error mapping は仮定しない。remote / relay target では
`inputs` の存在だけで代入せず、明示的な Extension-1-capable surface を経由する。

| 宣言上の member | 既定 authority | 許可する明示指定 |
| --- | --- | --- |
| `properties` のみ（observable output） | `element` | `element`、`none` |
| local assignment surface の `inputs` のみ | `state` | `state`、`none` |
| local assignment surface の `properties` と `inputs` の両方 | 互換性のため `state` | `state`、`element`、`auto`、`none` |
| Extension-1-capable surface | resolver が公開する input / output 方向 | capability の範囲内 |
| event-token / command-token | `none` | replay しない |
| native / manifest のない legacy element | 現行の方向推論 | `state`、`element`、`auto`、`none` |

宣言済み custom element で member がどの面にも存在しない場合、または output-only へ `init=state` を指定した場合は
contract error にする。これにより `<wcs-defined>` の `defined` / `pending` / `count` などは modifier なしで
element authority となり、接続直後の値を必ず state へ pull できる。

双方向 member の modifier は次の意味を持つ。

| 指定 | 初期同期 | 用途 |
| --- | --- | --- |
| `init=state` | state の最新値を element へ書く | store を正とする通常の form |
| `init=element` | listener 登録後の property snapshot を state へ入れる | SSR、declarative default、遅延 upgrade |
| `init=auto` | state slot が未初期化なら element、それ以外は state | 段階移行用 |
| `init=none` | 初期同期せず、次の変更から扱う | 離散入力、外部 ownership |

```html
<x-input data-wcs='value#init=state: form.name'></x-input>
<x-clock data-wcs='value#init=element: clock.now'></x-clock>
<wcs-defined tags='x-chart' data-wcs='defined: ready; pending: pendingTags'></wcs-defined>
```

`auto` は単なる `value !== undefined` ではなく、state slot の initialized bit で判断する。明示的に commit された
`undefined` と未初期化を区別できる state address status API を先に導入し、未初期化なら element、それ以外は state を選ぶ。
この API がない runtime では `auto` を有効化しない。

表記は wcstack の既存 path grammar の modifier とし、wc-bindable コア宣言には追加しない。
現行 parser は `#` 以降を modifier slot へ分離するため、`#init=state` を別 path としては解釈しない。
ただし既存 modifier は flag 形式だけで、古い runtime は未知の `key=value` を黙って無視する。`key=value` の意味解釈と
parser test を追加し、validator が必要な最低 runtime version を診断して silent ignore を防ぐ。

### 3.7 teardown

`BindingSession.dispose()` は次を同じ record の所有物として破棄する。

- DOM listener と state address 登録。
- definition / `syncOn=connect` の接続待ち continuation。Promise や observer 自体を取消せない場合も generation で無効化する。
- 保留中の deferred apply、write receipt、trace handle。
- DevTools へ公開した active record。

`OperationTicket` は binding ではなく各 I/O node の operation owner が dispose する。binding の削除だけで、
同じ node が別 consumer 向けに実行中の I/O を暗黙 cancel しない。

wcstack 自身の構造更新では、node の置換・削除時に owner が明示的に dispose する。外部 DOM 変更に対しては
Document / ShadowRoot ごとに一つの `MutationObserver` を持ち、mutation batch 完了後に owner から外れた subtree を
dispose する。root 内 move は最終的な包含関係を見て維持し、登録済み root 間の move は旧 record を終端して新 generation へ
adopt する。未知の追加 node を自動 discover する機能とは分ける。

observer を使わない実装を選ぶなら、同等に pending record の強参照を解放できる ownership mechanism と、外部変更時に
呼ぶ明示 API が必須である。`isConnected` の遅延検査だけでは、永久に定義されない tag の Promise が node を保持するため
代替にならない。SSR / 非ブラウザ環境では owner の明示 lifecycle を使い、browser global を module 評価時に参照しない。

## 4. `PropagationContext`: エコーではなく因果を追う

> **実装ステータス（2026-07-16）**: 本節の因果伝播は `enablePropagationContext` として実装され、
> **既定 `true`**（恒久 opt-out フラグは残置）。zero-copy 最適化（echo しうる双方向 wire のみ
> provenance bookkeeping、一方向バインドは zero-cost）で write-path overhead ≤5% を達成してから
> 既定化した。詳細は [10-defaulting-rollout-status.md](10-defaulting-rollout-status.md) を参照。

単純な値比較だけでは、正規化された値、object の同一参照、diamond graph を区別できない。
一方、イベントを一律に無視すると element 側の正規化結果まで失う。そこで updater の内部 queue を
address だけでなく、値と次の context を持つ update record に変える。

```ts
interface PropagationContext {
  readonly transactionId: number;
  readonly originBindingId: number;
  readonly visitedEdges: ReadonlySet<number>;
  readonly hop: number;
}

interface WriteReceipt {
  readonly bindingId: number;
  readonly bindingGeneration: number;
  readonly member: string;
  readonly transactionId: number;
  readonly synchronousScopeId: number;
  readonly writtenValue: unknown;
}
```

transaction / edge ID は session 内で一意とし、edge ID には binding generation と方向を含めて再利用しない。
外部表示時は DevTools source ID、session ID、sequence の組へ投影する。伝播時の規則は次のとおり。

1. 外部 event / API update ごとに transaction を開始する。
2. 同じ transaction が同じ edge を再度通ろうとした場合だけ、その伝播を抑止する。
3. element へ書く直前に member と binding generation 付きの `WriteReceipt` を同期 dynamic scope に置く。
4. 同じ setter call stack 内で同じ member から `Object.is` 同値の通知が戻った場合だけ confirmation として再伝播を抑止する。
5. element が値を正規化して異なる値を返した場合は、新しい edge を通る変更として継続する。
6. transaction の hop 上限を超えた場合は、その transaction の未処理 record だけを quarantine し、既に適用した値は戻さない。
   updater から例外は投げず、構造化 diagnostic と trace を残す。

値比較は補助最適化に留め、loop 判定の根拠を edge provenance にする。primitive の `Object.is` は
不要な setter / event を減らすため維持するが、object の深い比較を runtime の既定動作にはしない。

receipt は `try/finally` で setter の同期 scope 終了時に必ず破棄する。非同期に届く event を、古い receipt と値が
似ているだけで confirmation にしてはならない。すべての property event は internal inbox へ配送し、receipt は
state から同じ edge へ戻すかの判断だけに使う。event-token の同 payload の複数 occurrence は一度も dedupe しない。

同じ object を in-place 変更して通知する component では、reference 比較だけで confirmation と正規化を識別できない。
また setter 後の別 task で fresh object を返す component は、core event だけでは元の write との因果を復元できない。
その場合は component が「意味的同値なら通知しない」契約を守るか、member revision / cause token / equality を提供する
明示的な behavioral extension が必要である。時間窓だけの pending receipt は正当な user event を誤抑止するため採用しない。

### 4.1 queue の coalescing

同じ address の queue が last-write-wins なら、値と correctness 用 context は最後の update の組をそのまま採用する。
`visitedEdges` の積集合・和集合、新しい synthetic transaction への置換は、winner の通過履歴を失うため行わない。

coalesce で落ちた transaction ID は、hook が有効な場合だけ bounded な trace metadata として winner に関連付ける。
上限超過数は `truncatedParentCount` に集約し、data-plane の `PropagationContext` へ trace 用配列を持たせない。
値を計算で merge する reducer は、入力 context を個別に保持するか、当該 address の coalescing を無効にする。

context は wc-bindable の event detail や property 値へ混入させず state runtime 内部で運ぶ。非同期 operation の完了は
開始時 transaction の `visitedEdges` を復元せず、新しい transaction として始め、開始原因は trace parent にだけ残す。
remote 境界を越える trace context は将来の optional extension とし、未対応 peer でも値の意味が変わらないようにする。

## 5. `OperationTicket`: 非同期結果に commit 権を持たせる

`AbortController` だけでは、取消不能な Promise や、abort と同時に完了した結果の commit を防げない。
非同期 I/O を lane 単位で管理し、開始時に次の ticket を発行する。

```ts
type LanePolicy = 'latest' | 'queue' | 'exhaust' | 'overlap';
type TerminalOutcome = 'success' | 'error' | 'timeout' | 'aborted' | 'stale';

interface OperationTicket {
  readonly operationId: number;
  readonly ownerGeneration: number;
  readonly laneKey: string;
  readonly policy: LanePolicy;
  readonly supersedeEpoch?: number;
}

interface OperationAttempt {
  readonly operationId: number;
  readonly attempt: number;
  readonly signal?: AbortSignal;
}

interface LaneState {
  readonly policy: LanePolicy;
  latestEpoch: number;
  activeOperationId?: number;
  readonly activeOperationIds: Set<number>;
  readonly queue: OperationTicket[];
  inFlightCount: number;
}
```

| policy | 新しい要求が来たとき | commit 条件 |
| --- | --- | --- |
| `latest` | `latestEpoch` を進め、旧 ticket を stale にし、可能なら abort | 最新 epoch の active operation だけ |
| `queue` | ticket を FIFO に積み、先頭だけ開始 | lane 先頭の active operation だけ |
| `exhaust` | 実行中なら新要求を ticket 化せず拒否または既存結果へ合流 | 唯一の active operation だけ |
| `overlap` | active set へ追加して並行実行 | active set 内の各 operation |

`overlap` の active set は commit eligibility、terminal CAS、teardown、in-flight count のための内部 bookkeeping であり、
operation ごとの observable を公開する `parallel` を意味しない。外部意味論は既存規範どおり、各完了が到着順に
同じ観測面へ上書きする後着勝ちとする。世代は capture-only で、dispose または明示 cancel だけが無効化する。

`ownerGeneration` は各 I/O Core の observe / reconnect / dispose lifecycle を表し、BindingSession generation とは
共有しない。remote proxy の reconnect / pending response はさらに別の connection generation で管理する。
retry は同じ `operationId` に新しい `OperationAttempt` を作り、attempt number と resource 用 signal だけを更新する。
`overlap` の loading は単一 boolean setter ではなく `inFlightCount > 0` から導出し、複数完了の途中で false にしない。

### 5.1 commit guard

非同期結果から外部に見える setter、state update、event dispatch を行う直前に、共通の
`CommitGuard` が次を検査する。判定は policy 別であり、すべてに latest の epoch 一致を要求しない。

1. I/O owner lifecycle generation が一致する。
2. operation が terminal settle 前である。
3. `latest` は current epoch、`queue` は active head、`exhaust` は active ID、`overlap` は active set membership を満たす。

browser capability は通常は開始前 precondition であり、汎用 guard に含めない。permission epoch などが実行中の妥当性を
本当に変える node だけが、node 固有の追加 guard を登録する。binding generation も state adapter 側の別 guard である。

各 operation は `pending → committing → TerminalOutcome` の一回限りの terminal CAS を持つ。成功・error・timeout の
いずれかが `committing` を claim したものだけが公開 output を書ける。timeout は「先に失効してから error を書く」のではなく、
eligible な ticket が timeout outcome を claim し、guard 付きで `TimeoutError` を commit してから native abort と lane 解放を行う。
supersede / dispose は原則として公開 error を追加せず、`stale-drop` / `aborted` trace だけを残す。

setter が同期 event を発火し、それが同じ lane を supersede することがあるため、guard は各 setter の直前と直後に検査する。
直後の失効では既に発生した副作用を巻き戻さず、その operation の残りの state / event commit を止める。
resource の節約には `AbortSignal`、正しさには owner generation・policy eligibility・terminal CAS を使う。

非同期完了が state update を起こすときは新しい `PropagationContext` を開始する。開始時 transaction は ticket の
trace parent にだけ保存し、古い `visitedEdges` は commit 側へ持ち越さない。

最初の実装対象は fetch 系 node の `latest` policy に絞る。共通 abstraction が安定するまでは全 I/O package の
必須依存にせず、各 node が小さな helper を使う。wc-bindable remote の順序、at-most-once、ack、timeout、
backpressure は transport 境界の保証であり、UI 操作 lane の `latest` とは別レイヤーとして合成する。

### 5.2 wc-bindable remote との境界

- `set` は fire-and-forget の at-most-once であり、reconnect 時に自動 replay しない。
- `setWithAck` の resolve は assignment が適用された ack であり、副作用完了や状態安定の保証ではない。reject 時は
  server 適用済みで ack だけ失われた可能性がある。
- `invoke` は Extension-1-capable surface の command 呼出しである。応答喪失時の自動再送で at-least-once に変えず、
  再試行が必要な非冪等 command は application の idempotency token で重複排除する。
- 単一 logical channel の caller order / FIFO と local lane policy は別であり、remote FIFO だけで stale UI commit は防げない。
- timeout / `AbortSignal` は client の pending wait を解放するだけで、server side effect を停止しない。遅い response は
  connection generation と pending map で drop する。
- pre-open、pre-sync、pending invocation、sync update の各 buffer は独立に上限と overflow policy を持つ。
- ordinary wire value は `JsonValue` に限定する。top-level observable `undefined` は capability-gated な out-of-band 表現を使い、
  nested `undefined` は送らない。
- `sync.capabilities` は connection ごとの remote behavioral capability で、declaration の `inputs` / `commands`、
  browser API capability、sidecar extension と同一視しない。
- declaration fingerprint は interface identity / resync 用であり、trace ID、認可、署名には使わない。

## 6. DevTools trace は side channel にする

既存 DevTools hook を拡張し、少なくとも次の構造化 record を送る。

| category | 主な event |
| --- | --- |
| binding lifecycle | `binding:discovered`、`binding:attached`、`binding:snapshot`、`binding:disposed` |
| propagation | `propagation:applied`、`propagation:coalesced`、`propagation:suppressed`、`propagation:hop-limit` |
| async I/O | `io:operation-started`、`io:operation-retried`、`io:operation-settled`、`io:stale-dropped` |
| contract | `contract:manifest-read`、`contract:unsupported-extension`、`platform:capability-missing` |

全 record は monotonic timestamp、DevTools source ID、source-local sequence を持つ。該当時だけ trace / parent ID、
root / session / binding / edge ID、operation ID、lane を付ける。data-plane の transaction / visited edge と
trace ID は別に採番し、hook 接続状態で correctness context の形を変えない。command-token が同期的に起こす update は
call scope の trace parent を継承し、非同期完了は新しい data transaction と既存 operation の trace parent を使う。

既定では property 値、event detail、command 引数、URL、header、response body を保存しない。
必要な場合だけ利用者が redactor / serializer を明示登録する。serializer は hot path ではなく trace drain 側で実行し、
例外、depth、出力 byte 数、実行時間を制限する。getter 関数本体や live handle は直列化しない。

data hot path は subscriber を同期呼出しせず、bounded ring buffer への append と drain schedule だけを行う。
consumer drain は microtask または animation frame へ分離し、各 callback 例外を bridge で隔離する。buffer overflow は
trace record だけを drop し、drop count を次の record に載せる。hook subscriber がない hot path では trace record object を
生成しない。

DevTools を後から接続したときは、`kind: state` / `kind: io` など additive な source ごとの snapshot callback から、
既存 session、binding phase、active operation の baseline を一度送り、以降を差分にする。operation controller は active な間だけ
列挙 registry へ登録し、settle / dispose 時に解除する。古い consumer は未知 source kind と event namespace を無視する。
subscriber の例外、遅延、再入、切断がデータ面の順序や結果を変えてはならない。

この trace により、複数 node にまたがる一つの操作を、原因 → binding edge → I/O ticket → commit / stale-drop の
一本の timeline として表示できる。remote peer との分散 trace はコア payload へ独自 field を混ぜず、将来の
optional extension が双方で合意された場合だけ接続する。

## 7. `wcstack.manifest.json`: 静的契約を sidecar に置く

wc-bindable の `static wcBindable` は browser runtime が読む実行時の事実として維持する。型、lane policy、
必要 browser API までコア宣言へ詰め込まず、optional sidecar に置く。用語は次の四つに分離する。

- behavioral extension: 公式 wc-bindable Extension 1 / 2。
- manifest extension: sidecar 内の `wcstack.*` namespace。
- remote capability: connection の `sync.capabilities`。
- platform capability: browser / runtime API とその利用条件。

package component contract と application state schema は同じ envelope version を共有できるが、別 artifact にする。
次は package 側の例である。

```json
{
  "schemaVersion": 1,
  "kind": "package",
  "bindingProtocol": {
    "protocol": "wc-bindable",
    "minimumVersion": 1
  },
  "behavioralRequirements": {
    "required": [],
    "optional": ["wc-bindable/extension-1"]
  },
  "manifestExtensions": {
    "wcstack.types": {
      "version": 1,
      "components": {
        "wcs-fetch": {
          "observables": {
            "response": {
              "event": "wcs-fetch:response",
              "schema": { "type": ["object", "null"] }
            }
          },
          "inputs": {
            "url": { "schema": { "type": "string" } }
          },
          "commands": {
            "fetch": {
              "args": { "type": "array" },
              "result": {}
            }
          }
        }
      }
    },
    "wcstack.async": {
      "version": 1,
      "components": {
        "wcs-fetch": {
          "operations": {
            "fetch": { "lane": "request", "policy": "latest" }
          }
        }
      }
    },
    "wcstack.platformCapabilities": {
      "version": 1,
      "components": {
        "wcs-fetch": {
          "required": ["web.fetch"],
          "optional": ["web.abort-controller"]
        }
      }
    }
  }
}
```

application artifact は `kind: application` とし、root `stateSchema`、filter の input / output、list context を持つ。
package と application を同じ file へ merge せず、validator が package contract を解決して application binding と照合する。

型表現は arbitrary TypeScript 文字列ではなく、JSON Schema の明示 subset に限定する。最初は `type`、`properties`、
`required`、`items`、`enum`、`const`、`anyOf`、`$defs` と local `$ref` を対象とし、external `$ref` は禁止する。
resolver は cycle を検出し、未知 keyword は runtime で推測せず、IDE / CI で unsupported diagnostic にする。

literal path、array wildcard、nested list context、filter chain、command arguments / result を schema で照合し、
動的に構築された path は `unknown` へ落として runtime の動作を妨げない。sidecar に member があるのに実行時宣言にない、
または event 名が異なる場合は CI で drift error にする。実行時の live declaration を sidecar が上書きすることはない。
同様に `wcstack.async` は tooling 向けの記述であり、実際の lane policy と commit guard は I/O Core のコードを正とする。
sidecar がない、または古いことを理由に runtime の競合防止を無効化しない。
`behavioralRequirements` も必要 extension を記述するだけで、target を Extension-1-capable に変えない。runtime discovery と
capability negotiation の結果を validator / adapter が別途照合する。

package が TypeScript 型を authoring source にする場合も、公開 artifact は deterministic generator が出力した同じ JSON schema とし、
CI で再生成差分を検査する。application artifact の探索、package 解決、同名 tag / filter の衝突、override 禁止／許可を
schema 文書で固定し、暗黙の last-file-wins merge は行わない。

### 7.1 validator を一つにする

`packages/vscode-wcs/src/service` から、DOM に依存しない parser・path resolver・schema checker を pure library として
切り出す。同じ validator core を次から呼ぶ。

- VS Code: 編集中の diagnostic、completion、hover。
- CI CLI: repository 全体の path、modifier、manifest drift 検査。
- development runtime: 実際に読み込まれた宣言との optional 検査。

diagnostic は安定した code、source range、severity、関連する tag / member / state path を持つ。
未知の型と動的 path は warning または情報、確実な型不一致、存在しない member、壊れた manifest は error とする。
これにより IDE だけが知る規則と runtime だけが知る規則の分岐を防ぐ。

### 7.2 capability の判定

sidecar は必要能力を静的に列挙するが、実際の可否は User-Agent ではなく利用直前の feature detection で決める。

```ts
interface PlatformAssessment {
  readonly availability: ReadonlyMap<string, 'available' | 'missing' | 'unknown'>;
  readonly permission: 'granted' | 'denied' | 'prompt' | 'not-applicable' | 'unknown';
  readonly readiness: 'idle' | 'ready' | 'degraded';
  readonly activity: 'inactive' | 'active';
  readonly preconditions: {
    readonly secureContext: 'satisfied' | 'required' | 'not-applicable';
    readonly userActivation: 'present' | 'required' | 'not-applicable';
  };
  readonly epoch: number;
  readonly lastError?: WcsIoErrorInfo;
}

interface WcsIoErrorInfo {
  readonly code: string;
  readonly phase: 'probe' | 'start' | 'execute' | 'decode' | 'commit' | 'dispose';
  readonly recoverable: boolean;
  readonly capabilityId?: string;
  readonly message: string;
}
```

availability、permission、readiness、activity、operation error を一つの `ready / unsupported / error` enum に畳まない。
required API が欠ける場合は操作を開始せず、optional API が欠ける場合は宣言済み fallback に切り替えて readiness を
`degraded` にする。permission / policy 拒否、network、timeout、abort、decode、内部 contract violation は別 code にする。

platform capability ID は built-in の `web.fetch` のような安定 namespace とし、third-party は reverse-DNS namespace を使う。
registry は ID ごとに side-effect-free presence probe、必要なら secure-context / activation / permission 条件、browser compatibility
dataset key を対応付ける。`web.fetch` の文字列をそのまま global property path として eval しない。

probe は module 評価時には行わない。activation 時に baseline を取り、各 operation の直前に利用条件を再検査する。
permission change、device removal、visibility / BFCache など platform notification がある場合は observer で epoch を更新し、
dispose 時に解除する。実行中 validity を変える node だけがこの epoch を node 固有の commit guard に使う。

runtime の `WcsIoError` は上の serializable info と non-cloneable な `cause` を分け、DevTools / remote へは info だけを投影する。
初期移行では既存 error property / event の値 shape を変更せず、taxonomy は DevTools と opt-in `errorInfo` へ出す。
既存 output を `WcsIoError` に置換する場合は package ごとに互換性を判定し、必要なら major change とする。

### 7.3 version 軸を混同しない

| 軸 | 役割 | 互換規則 |
| --- | --- | --- |
| npm SemVer | package の配布・API | package ごとの SemVer |
| wc-bindable `version` | コア宣言形式 | 整数 1 以上を受理し、未知 optional field を無視 |
| behavioral extension / remote capability | command execution と wire behavior | extension contract と connection capability bit で検査 |
| manifest extension `version` | `wcstack.types` 等の sidecar 語彙 | namespace ごとに対応 range を検査 |
| sidecar `schemaVersion` | manifest envelope | reader が対応 major を明示 |

必須 behavioral extension が未対応なら、その機能だけを activation error にする。optional behavioral / manifest extension は
無視してコア property binding を継続する。破壊的なコア意味変更は高い整数 version の推測で扱わず、
新しい protocol identifier を使う。
release test では「新 reader × 旧宣言」「旧 reader × 新 optional field」「対応／未対応 extension」の
互換 matrix を固定 fixture として持つ。

## 8. 段階導入

一度に runtime 全体を書き換えず、各 phase を release checkpoint にする。ただし後続 phase は先行 foundation に依存するため、
rollback は原則として末尾 phase から行い、後続を残したまま phase 0 / 1 だけを戻さない。

| phase | 実装 | 完了条件 |
| --- | --- | --- |
| 0. foundation | repository-local discovery mirror / 公式 helper を oracle とする conformance fixture、最小 platform guard、version 型 | 現行 v1 が不変で、version 2＋未知 optional field、SSR import、公開 ESM の外部 runtime import なしが通る |
| 1. lifecycle ownership | `BindingSession`、`DefinitionCoordinator`、record / teardown。同期順序はまだ現行互換 | listener / address の重複がなく、未定義中の削除・再接続 test が通る |
| 2. 初期同期 | ready cohort、`syncOn`、direction 決定表、`init` modifier | upstream observer vectors と `wcs-defined` を含む race test が決定的に通る |
| 3. 因果伝播 | update record、`PropagationContext`、`WriteReceipt` | echo、正規化、diamond、coalescing test が通る |
| 4. 非同期・trace | 全 policy の lane unit、fetch `latest` PoC、terminal CAS、非同期 trace queue | stale commit 0、hook off の性能 gate 合格 |
| 5a. 静的契約 | sidecar schema、validator core、VS Code / CI integration | IDE と CI の diagnostic code / range が一致 |
| 5b. 開発時照合 | opt-in runtime analyzer と manifest drift trace | 無効時の runtime 挙動・cost が不変 |
| 6. capability | probe / report / error taxonomy を I/O package へ順次適用 | 対象 browser matrix と SSR import test が通る |

phase 1 では既存 `initializeBindings()` と `initializeBindingsByFragment()` の signature を facade として維持する。
phase 2 の output-only initial read と新 modifier は feature flag 下で既存 example / SSR snapshot を比較してから既定化する。
phase 3 までは primitive same-value guard を残し、provenance と結果が一致することを shadow diagnostic で確認する。
phase 4 の lane policy は fetch 系から始め、node ごとの固有 cancellation / retry 契約を一括変換しない。
phase 0 の最小 platform guard は global の存在確認と owner adapter だけを提供し、phase 6 の capability taxonomy と混同しない。

> **既定化・横展開ステータス（2026-07-17 更新）**: phase 0-6 の PoC 実装は完了済み。既定化・横展開も
> ほぼ完了 — phase 2/3 は既定 `true` に反転、phase 4 lane は 6 operation ノード、phase 6 errorInfo は
> 27/35 ノード適用（defer 3・非該当 5）、5a は CI 必須ゲート化済み、5b は explicit opt-in を正式仕様として
> 確定。残作業（リリース時 dist rebuild / defer ノード判断 / lane trace ブリッジ）は
> [10-defaulting-rollout-status.md](10-defaulting-rollout-status.md) が追跡する living document。

各 phase の旧経路と新経路を同じ binding に二重適用してはならない。session 単位で ownership を切り替え、
rollback 時も listener、address、operation ticket の所有者が常に一つになるようにする。依存順は
`foundation → lifecycle → initial sync → propagation` と、`foundation → operation / trace → sidecar / capability` の二系統である。

## 9. 主な変更箇所

| 領域 | 現在の入口 | 設計上の変更 |
| --- | --- | --- |
| 宣言解釈 | `packages/state/src/protocol/wcBindable.ts` と各判定箇所 | repository-local conformance mirror を runtime gate、公式 helper を test oracle とし、型と dev analyzer を追加 |
| binding lifecycle | `bindings/initializeBindings.ts`、`collectNodesAndBindingInfos.ts` | facade の内側に session、owner、record、cohort drain を置く |
| 遅延定義 | `apply/scheduleDeferredApply.ts`、deferred spread、`event/twowayHandler.ts` | 個別 `whenDefined()` を coordinator へ移し、attach / sync の所有権を一本化 |
| update pipeline | `updater/updater.ts`、`proxy/apis/postUpdate.ts`、`proxy/methods/setByAddress.ts` | address queue を context 付き update record へ拡張 |
| DOM apply | `apply/applyChangeToProperty.ts` ほか | receipt、binding generation、propagation context を apply context へ渡す |
| DevTools | `state/src/devtools/{types,sink,bridge}.ts` と `packages/devtools` | lifecycle / propagation / operation record と baseline snapshot を追加 |
| async PoC | `packages/fetch/src/core/FetchCore.ts` | request lane に `latest` ticket と commit guard を導入 |
| static validation | `packages/vscode-wcs/src/service` | pure validator core を分離し VS Code / CI / dev runtime から共有 |
| browser variance | 各 I/O Core / Shell | platform assessment と互換な `WcsIoErrorInfo` 投影を package ごとに移行 |

`IBindingInfo` は収集結果として維持し、session 固有の可変状態を追加しない。公開 component API、wc-bindable の
property event payload、command 引数はこの変更箇所表の対象外とし、既存利用者の wire contract を保つ。

## 10. 検証設計

順序問題は wall-clock sleep で検証せず、制御可能な custom-element registry、Promise、microtask drain、
fake transport を使う。`BindingSession` の reducer / transition は model-based test にし、define、event、state write、
dispose、reconnect の並びを生成して次の不変条件を検査する。

1. 一つの record / generation につき listener、address、初期同期は高々一回。
2. active / failed / disposed 以外で settle した初期 attempt は存在しない。
3. disposed generation から DOM / state への commit はない。
4. 同じ transaction / edge は二度適用されず、異なる正規化値は失われない。
5. commit 権のない async ticket は外部可視状態を変更しない。
6. install 途中の throw でも、その record が登録済みの全 resource が best-effort で解除される。
7. trace subscriber の throw、遅延、overflow は data-plane の結果を変えない。

### 10.1 論点別の必須ケース

| 論点 | 必須回帰 test |
| --- | --- |
| 1. 定義順序 | registry + tag ごとの待機一回、invalid tag、define 前 expando、複数 root、待機中削除、root dispose 後 define、fragment upgrade / adopt |
| 2. 初期配送 | upstream observer vectors、`syncOn=call/connect`、connect 前 dispose / reconnect、明示 `undefined`、read 中 event、partial read throw、A setter → B event |
| 3. エコー | 同期 confirmation、正規化差分、同一 object 制約、delayed fresh-object echo の extension 要求、同 payload occurrence、diamond、last-wins coalescing |
| 4. 非同期競合 | `latest/queue/exhaust/overlap`、overlap の後着勝ち、per-operation observable なし、in-flight count、abort 無視、追い越し、setter 中 supersede、terminal CAS、retry、timeout 後成功、dispose 中完了 |
| 5. デバッグ | parent chain、late baseline、detach、ring overflow / drop count、serializer throw / limit、未知 source、remote trace capability なし、hook 例外隔離 |
| 6. path 型 | nested / array wildcard / list context、filter chain、command arity、readonly、reserved / inherited name、dynamic path、malformed `$ref`、artifact merge / drift |
| 7. browser 差 | API 一部欠如、insecure context、user activation、permission 変更、device busy / removal、visibility / BFCache、late callback、SSR、error info cloneability |
| 8. 互換性 | version 1 / 2 / 0 / 負数 / 非整数 / NaN、old/new reader × declaration、local / remote、Extension 1 不可、reconnect / fingerprint 変更、別 protocol ID |

### 10.2 `<wcs-defined>` を使う統合ケース

- 全対象 tag が定義済みで、binding attach 前に初期 `change` が出ても `defined` / `count` を即時 snapshot できる。
- 未定義 tag、`timeout=0` で `connectedCallbackPromise` が pending のままでも、`pending` を pull して session は active になる。
- timeout 後の遅延 define で `missing → count` が一回だけ反映され、古い continuation は no-op になる。
- output-only direction が自動的に element authority となり、既定 `syncOn=call` が監視完了 Promise を待たない。
- 明示 `syncOn=connect` は DOM connection だけを待ち、connect 前 event → snapshot の順序と connect 前 dispose を保証する。
- `init=state` setter の同期 event は receipt で confirmation / normalization に分類される。
- `hidden` な `<wcs-defined>` も接続・binding 済みであり、実行 gate ではない。

### 10.3 性能・保持 gate

採択前に現行 main の benchmark を固定し、少なくとも次を gate にする。割合は初回 baseline 計測後に確定するが、
暫定上限は初期化時間・steady-state update とも p95 で 10% regression とする。

- DevTools hook がない場合、trace record / payload serialization の allocation は 0。
- 同一 session / tag の platform `whenDefined()` 登録は 1。
- 10,000 binding の collect → attach → sync と、10,000 update の drain を別々に測る。
- 100 回の attach / dispose 後、record、node、listener、receipt、ticket が到達不能になることを heap test で確認する。
- root observer と同等 ownership 実装を比較し、外部 mutation なしの steady-state cost、大量削除、root 間 move を測る。
- active operation source registry が terminal / dispose 後に空になり、late attach baseline のためだけに Core を保持しない。
- provenance 無効化を逃げ道にせず、必要なら compact ID、copy-on-write edge set、record pooling で overhead を下げる。

## 11. 実装前の decision gate

| 判断 | 推奨初期値 | 決定時点 |
| --- | --- | --- |
| `init` / `syncOn` modifier の最終 syntax | `#init=state` / `#sync=connect`。現行 `#` slot と構文衝突はなく、`key=value` 解釈と最低 runtime version 診断を追加 | phase 2 着手前 |
| output-only の producer initial read | 採択。既定は`syncOn=call`、明示時だけ`connect` | phase 2 |
| 双方向 member の既定 authority | 現行互換の `state`。`auto` は明示 opt-in | phase 2 |
| 正規化差分 | element の確定値として受理し、receipt confirmation とは分ける | phase 3 |
| 非同期・same-reference echo | core だけでは完全識別不能。実例が必要なら revision / cause extension を別設計 | phase 3 |
| 外部 DOM mutation の teardown | root observer を既定候補とし、採らない場合も同等の強参照解放 mechanism を必須化 | phase 1 終了時 |
| component 固有 readiness 拡張 | 初期 release では実装せず、公式 `syncOn` で扱えない実例が揃ってから設計 | phase 2 後 |
| sidecar の探索・merge 規則 | package artifact と app artifact を分離し、衝突を schema 文書で固定 | phase 5a 着手前 |
| error taxonomy の公開面 | 既存 error shape を維持し、まず DevTools / opt-in `errorInfo` | phase 6 |
| trace buffer | bounded ring、payload なしを既定。上限は browser memory benchmark で決定 | phase 4 |

特に component readiness を `connectedCallbackPromise` の存在だけで自動有効化しないことは、decision ではなく不変条件とする。
また sidecar の optional 情報を runtime correctness の必須入力に格上げしない。

## 12. 非目標

- listener 登録前に発生した離散 event / command を永続ログから replay すること。
- revision / cause を持たない非同期 property event を、正当な user 変更と programmatic echo へ完全分類すること。
- DOM、worker、remote peer をまたぐ exactly-once 分散 transaction を提供すること。
- object の deep equality や immutable data model をすべての binding に強制すること。
- `<wcs-defined>` を autoloader、DOM 接続 barrier、binding scheduler に変えること。
- browser API の不足を全 package で polyfill すること。
- TypeScript 固有の型式を browser runtime に必須化すること。
- 一回の release で全 I/O node の cancellation / retry policy を統一すること。
- wc-bindable コアへ wcstack 固有の trace、型、lane field を追加すること。

## 13. 参照

- [論点一覧](README.md#論点一覧)
- [タグ定義とバインディング確立の順序](01-binding-initialization-order.md)
- [接続直後の初期状態配送](02-initial-state-delivery.md)
- [双方向バインディングのエコー制御](03-two-way-echo-control.md)
- [非同期実行と wc-bindable 境界](04-async-execution-and-wc-bindable.md)
- [観測性・デバッグと wc-bindable 境界](05-observability-and-wc-bindable.md)
- [パス文字列の型安全性](06-path-type-safety.md)
- [ブラウザ capability 差の吸収](07-browser-capability-variance.md)
- [プロトコル進化と互換性](08-protocol-evolution.md)
- [`<wcs-defined>` 設計メモ](../defined-tag-design.md)
- [DevTools hook protocol](../devtools-hook-protocol.md)
- [wc-bindable SPEC（2026-07-14 確認・固定コミット）](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/SPEC.md)
- [wc-bindable Extensions（同固定コミット）](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/SPEC-extensions.md)
- [wc-bindable remote README（同固定コミット）](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/packages/remote/README.md)
