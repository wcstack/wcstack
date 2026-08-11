# React の不変スナップショットと wc-bindable I/O 境界

- **作成日**: 2026-08-01
- **状態**: 設計判断記録（Phase 0 棚卸し・Phase 1 producer contract 完了。runtime 実装は未着手）
- **対象**: `wcBindable.properties` を公開する非同期 I/O ノード、`@wc-bindable/react`、
  将来の framework adapter / remote adapter
- **外部仕様スナップショット**:
  - wc-bindable-protocol: `5ec0deef212578a072b2f669d2a5554f254253e0`
  - `@wc-bindable/core@0.8.0`
  - `@wc-bindable/react@0.8.0`

## 結論

対応する価値はある。ただし、React 専用の deep-clone / deep-freeze パッチとして実施してはならない。

実施目的は、wc-bindable の観測面に混在している次の 3 種類を明確に分離することである。

1. **state** — ある時点の状態を表し、cached snapshot に保持できる値。
2. **event** — 同じ payload でも繰り返し発生し得る一過性の edge。
3. **handle** — `MediaStream` など、外部状態を持つ live resource。

React 固有の購読、React local state または外部 store の snapshot identity、SSR / hydration は React adapter が
吸収する。一方、公開後の値を producer 自身が変更しないこと、古い非同期結果を commit しないこと、
live resource の寿命は I/O ノードが保証する。汎用 adapter が値の型やプロパティ名から意味を推測できない箇所は、
wc-bindable declaration の optional metadata または sidecar contract で表現する。

本件は現行 React example を直ちに壊すリリースブロッカーではない。primitive、文字列、fresh JSON object を
中心とする通常利用は、現行 adapter でも概ね成立する。しかし「React と相互運用できる」という公開上の主張を
Concurrent Rendering を含む長期的な互換性主張にするなら、段階的に実施する価値がある。また、値の意味分類は
React だけでなく remote、DevTools、SSR、Signals adapter にも効く。

## 1. 問題を 3 軸に分ける

### 1.1 非同期 commit の正しさ

要求 A、B の順に開始して B、A の順に完了したとき、古い A が現在値を上書きしないことを指す。
これは React snapshot とは独立した問題であり、I/O ノードの generation / operation lane / terminal claim が
責任を持つ。`FetchCore` などは既にこの方向で堅牢化されている。

### 1.2 snapshot の不変性

React の `useSyncExternalStore` は、外部 store に変更がない間は `getSnapshot()` が同じ値を返し、変更時には
`Object.is` で異なる不変 snapshot を返すことを要求する。mutable store を読む場合は、変更時だけ新しい
snapshot を作り、それ以外は直前の snapshot をキャッシュして返す必要がある。

wc-bindable core は snapshot store ではなく、初期 property read と後続 event を `onUpdate(name, value)` へ
配送する observation protocol である。payload の clone / freeze、公開後の深い不変性、React 向けの
snapshot cache はコア契約に含まれない。

### 1.3 resource lifetime

snapshot のプロパティ値が同じでも、それが指す外部資源が producer により停止・破棄されれば、過去 snapshot の
意味は変わる。代表例は `MediaStream` の track と `blob:` URL である。これは object identity だけでは検出も
修復もできず、resource owner の寿命契約が必要になる。

この 3 軸を混ぜると、generation guard を持つから React-safe、または adapter が object spread をするから
resource-safe、という誤った結論になる。

## 2. 現状評価

### 2.1 React adapter は外部 store を直接読んでいない

`@wc-bindable/react@0.8.0` の `useWcBindable()` は `useSyncExternalStore` を使わず、`bind()` の callback を
React の local state へ写す。

```ts
const onUpdate = useCallback((name: string, value: unknown) => {
  setValues((prev) => ({ ...prev, [name]: value }));
}, []);
```

このため、外側の `values` object は update ごとに新しく、render 中に element property を再読しない。
現在の pagination example のような state-like output は実用上成立する。

ただし copy は shallow である。`value`、`error`、`message` 等の payload は同じ参照のまま React state に入る。
adapter は payload が plain data、live handle、一過性 event のどれかを区別しない。

### 2.2 wc-bindable は値の不変性を保証しない

固定コミットの wc-bindable core は declaration を live object として扱い、property event の値を clone / freeze
せず `onUpdate` へ渡す。wcstack の横断設計も「object の deep equality や immutable data model をすべての
binding に強制すること」を非目標としている。

従って、現在保証されるのは observation mechanics と producer state consistency であり、任意 payload の
immutable snapshot semantics ではない。

### 2.3 値ごとの評価

| 値の種類 | 現状 | React snapshot としての評価 |
| --- | --- | --- |
| primitive (`loading`、`status`、sensor reading) | 値渡し | 安全 |
| producer が公開後に変更しない fresh object / array | 参照渡し | consumer も read-only として扱えば実用上安全 |
| fetch JSON / upload response | 任意 object | producer は通常変更しないが、プロトコル保証はない |
| `ArrayBuffer` | mutable binary | clone なし。read-only ownership 契約が必要 |
| Worker / WebSocket / Broadcast message | 任意 payload | adapter が一律 clone すべきでない |
| `Error` / DOM `Event` / `Credential` | platform object | opaque value。serializable な projection を優先する |
| `MediaStream` | live handle | snapshot state に入れてはならない |
| managed `objectURL` | 文字列 + producer 所有資源 | 旧 URL の revoke 時期が過去 snapshot を無効化し得る |

## 3. 具体的な境界問題

### 3.1 camera `streamReady`

`CameraCore` は `MediaStream` を「reactive value ではない direct channel」と説明している。しかし
`streamReady` は `wcBindable.properties` に入り、custom getter が event detail の live `MediaStream` を返す。
wc-bindable core と現行 React adapter は全 `properties` を同じ方法で購読するため、汎用 consumer から見ると
通常の observable output と区別できない。

この問題を React adapter の型判定で回避してはならない。`MediaStream` を clone / freeze できず、将来別の
live handle が増えるたびに adapter 固有 allowlist が必要になる。producer declaration 側で `handle` と明示し、
state snapshot とは別経路へ流す必要がある。

### 3.2 fetch / recorder `objectURL`

`FetchCore` は新しい response を commit する直前に旧 object URL を revoke する。resource leak 防止としては
合理的だが、React が旧 snapshot の UI をまだ表示または concurrent render している期間まで URL の有効性を
保証しない。

adapter は文字列から resource owner や破棄方法を判断できない。選択肢は、Blob を immutable state として渡して
consumer lifecycle で URL を所有させる、明示的な retain / release 契約を設ける、または managed URL は
best-effort current value で過去 snapshot の有効性を保証しないと文書化する、のいずれかである。

### 3.3 event-token と level state

`ended`、`recorded`、`dataavailable` などは同じ detail で複数回発生し得る。これらを level snapshot の
同値比較で dedupe すると edge を失う。一方、毎回 outer snapshot を更新すると再renderは起こせるが、値だけを
読んでも「何回目の event か」は表現できない。

edge event は callback / event stream として扱い、current state と同じ名前空間へ無条件に格納しない方がよい。

## 4. 責務分界

判断規則は次のとおりとする。

> React の購読・snapshot identity は adapter 責務。値が wc-bindable event なしに変化する問題は producer 責務。
> 汎用 adapter が機械的に区別できない意味は protocol metadata の責務。

| 問題 | 主責務 | 理由 |
| --- | --- | --- |
| `useSyncExternalStore` の採否と実装 | React adapter | React 固有 API。現行 local-state 転写では必須ではない |
| stable `subscribe` / cleanup | React adapter | React の lifecycle |
| cached `getSnapshot()` | React adapter | store に変更がない間の identity 保持 |
| `getServerSnapshot()` / hydration | React adapter | SSR renderer 固有 |
| 複数 property update の snapshot 集約 | React adapter | event 列から React state への変換 |
| 公開済み state value を producer が変更しない | I/O node | producer が値を所有する |
| property read と event payload の論理的一致 | I/O node | wc-bindable producer invariant |
| stale async result の commit 抑止 | I/O node | operation ownership / lane |
| live handle の停止・交換 | I/O node | resource owner だけが判断可能 |
| `state` / `event` / `handle` の宣言 | protocol metadata / sidecar | adapter の推測を排除する |
| 任意 payload の deep clone | 原則どちらも行わない | コスト、clone 不能値、所有権の意味変更 |

consumer が受け取った state-like object を自ら変更しないことも必要である。ただし、consumer 規律を理由に
producer 自身の post-publication mutation や通知漏れを許容してはならない。

## 5. 推奨する段階導入

### Phase 0: observable inventory

全 `static wcBindable.properties` を次の 3 分類で棚卸しする。

```text
state  — current value。初期 property read があり、通知後も値が安定する。
event  — occurrence。初期値を持たないか、同じ値で反復し得る。
handle — live / opaque resource。外部状態と独自 lifecycle を持つ。
```

最初の成果物は分類表とし、runtime behavior は変えない。少なくとも camera、recorder、fetch、worker、
websocket、broadcast、clipboard、credential を個別確認する。

Phase 0 の固定スナップショットは
[wc-bindable observable 棚卸し](12-wc-bindable-observable-inventory.ja.md) に記録した。
固定231 propertyを `state` 210、`event` 20、`handle` 1へ分類し、動的 DCC は別枠の `state` family とした。

### Phase 1: producer snapshot contract

`docs/async-io-node-guidelines.ja.md` に state-like output の規範を追加する。

- producer は公開後の state value を変更してはならない。
- logical state が変わる場合は新しい object / array を割り当ててから通知する。
- arbitrary payload は clone を強制せず、producer が公開後に変更しない ownership transfer とする。
- live handle と event は state-like property と区別する。
- platform `Error` / `Event` を公開する場合、可能なら `errorInfo` のような serializable projection も提供する。

既存ノードは一括破壊変更せず、棚卸しで実 mutation が見つかったものから修正する。

Phase 1 の規範は [非同期 I/O ノード作成ガイドライン](../async-io-node-guidelines.ja.md)
§3.3.1 に追加した。新規ノード・新規 observable property は MUST、既存ノードは
[Phase 0 棚卸し](12-wc-bindable-observable-inventory.ja.md) から段階移行とする。

出力側の規範だけでは、consumer の reactive store が包んだ値が input 経由で producer に入り込む経路を塞げない。
その双対を同ガイドライン §3.3.2（input value contract）に置いた。本書の対象は producer → consumer の観測面なので、
入力側の詳細はガイドラインを正とする。

### Phase 2: additive semantics metadata

後方互換な optional metadata または manifest sidecar で分類を公開する。概念例は次のとおり。

```ts
{ name: "loading", event: "wcs-fetch:loading-changed", semantics: "state" }
{ name: "ended", event: "wcs-camera:ended", semantics: "event" }
{ name: "streamReady", event: "wcs-camera:stream-ready", semantics: "handle" }
```

配置は決定ゲート 1 で **declaration の additive optional field** に確定した（§8）。`/protocol/wc-bindable.ts` の
`IWcBindableProperty` に `semantics?: "state" | "event" | "handle"` を追加し、`scripts/sync-protocol-types.mjs` が
各パッケージへ配る形とした。`@wc-bindable/core@0.8.0` の descriptor 検証は `name` / `event` / `getter` のみを見て
未知 field を素通しするため、既存 adapter の observation semantics は変わらない。

実装済みの範囲は、棚卸しで `event` / `handle` に分類した 21 property（9 パッケージ）である。`state` は
決定ゲート 2 の互換優先方針により未注釈のままとした。runtime 挙動は変えていない。

### Phase 3: React adapter

`@wc-bindable/react` の現行方式は `bind()` callback を React local state へ転写しており、render 中に外部 store を
直接読まない。この方式を維持するなら、`useSyncExternalStore` への移行は不変 snapshot 対応の必須条件ではない。
outer `values` を update ごとに新規作成し、過去の outer object を変更しないことをテストで固定する。

複数 subscriber で単一 store を共有する、render 中に element state を直接読む、または external-store API を
公開する設計へ進む場合は、`useSyncExternalStore` と cached snapshot を採用する。その場合も element property を
毎回読んで新しい object を返してはならず、`bind()` callback から snapshot を構築する。

```ts
let snapshot = Object.freeze({ ...initialValues });

function onUpdate(name: string, value: unknown): void {
  snapshot = Object.freeze({ ...snapshot, [name]: value });
  notify();
}

const getSnapshot = () => snapshot;
```

この経路では stable な `subscribe` / `getSnapshot` を使う。freeze は開発時の outer object に限定できる。
payload の deep freeze / structured clone は行わない。現行 local-state 方式と external-store 方式のどちらが
明確な利益を持つかを、StrictMode、複数 subscriber、SSR のテストと bundle cost で比較してから移行を決める。

`state` は snapshot に格納し、`event` は callback / stream surface、`handle` は明示的な ref / callback surface に
分ける。metadata 未対応 peer に対する既定動作は、互換性維持のため現行どおり全 property を values に流す案が
安全だが、決定ゲートで確定する。

### Phase 4: resource lifetime

camera stream、recorder / fetch object URL について ownership と release point を個別設計する。この phase は
React adapter の完成条件とは分ける。opaque handle を snapshot から除外しても、命令的 consumer が必要とする
resource lifecycle は残るためである。

## 6. 検証条件

### React adapter

- update ごとに新しい outer `values` を公開し、過去の outer object を変更しない。
- render 中に element property を再読しない。
- initial sync、mount / unmount / remount、React StrictMode の二重 effect で listener が漏れない。
- SSR時に browser-only element を読まず、client hydration の初期 snapshot 方針が明示される。
- 同一 task 内の複数 property update が欠落せず、最終 snapshot にすべて反映される。
- 同じ payload の反復 event を、state の同値 dedupe により失わない。
- external-store 方式を採る場合、event がない間は `getSnapshot()` が `Object.is` で同一の値を返し、
  state event ごとに高々 1 個の新 snapshot を公開する。

### I/O node

- state-like object / array を通知後に producer が in-place mutation しない。
- stale success、error、progress が新 generation の state を上書きしない。
- property read と event getter が同じ logical state を表す。
- live handle は state inventory で明示され、snapshot-safe と誤表示されない。
- resource の supersede / dispose 時に、誰がいつ release するかを test と README が固定する。

## 7. 非目標

- 全 wc-bindable payload に deep equality、deep clone、deep freeze を強制すること。
- `MediaStream`、DOM node、`Event`、任意 class instance を serializable state に変換すること。
- React のために wc-bindable core の observation contract を破壊的に変更すること。
- immutable snapshot 対応だけで、外部副作用の exactly-once や cancellation を保証すること。
- 過去の全 snapshot が参照する外部資源を無期限に保持すること。

## 8. 決定ゲート

1. **分類の配置**: wc-bindable declaration の optional field、wcstack manifest、別 sidecar のどれに置くか。
   → **決定（2026-08-01）: declaration の additive optional field**。sidecar は
   [`wcstack.manifest.json` schema](../wcstack-manifest-schema.md) 自身の不変条件により
   「optional な情報を runtime correctness の必須入力に昇格させない」ものであり、tooling 用の artifact である。
   本件の目的は汎用 adapter が**実行時**に受け皿を選べるようにすることなので、sidecar は要件を満たさない。
   sidecar は将来 declaration の写しとして drift 検査に使う。
2. **legacy fallback**: semantics metadata がない property を `state` とみなすか、現行 raw update として扱うか。
   → **決定（2026-08-01）: 互換優先。未指定は「未指定」であり `state` ではない**。読み手は semantics を
   見つけられない場合、この field が存在しなかった時と同じ動作を維持しなければならない（dedupe・cache・
   serialize を推測で始めない）。明示された値だけが読み手の扱いを変える根拠になる。
3. **React architecture**: 現行の local-state 転写を維持するか、cached external store へ移行するか。
4. **resource lifetime**: managed object URL を producer 所有のままにするか、Blob を渡して consumer 所有へ寄せるか。
5. **規範の強さ**: producer snapshot contract を新規ノードの MUST とし、既存ノードは段階移行にするか。
6. **adapter API**: 現行 `[ref, values]` を維持するか、event / handle 用 surface を追加するか。

ゲート 1・2 は上記のとおり確定済み。残りの推奨は、ゲート 3 は現行方式をテストで固定して
external-store 化の利益を先に測定、ゲート 5 を「新規 MUST / 既存は棚卸し後に移行」、ゲート 6 を既存 API
維持から開始、とする。ゲート 4 は resource ごとに判断する。

ゲート 6 は当初 React API の設計判断として立てたが、Phase 0 の adapter 調査により複数 adapter に共通する要求で
あることが分かった（[棚卸し §5.6](12-wc-bindable-observable-inventory.ja.md)）。values から外した event / handle を
「利用者が要素のイベントを直接聴く」で代替する逃げ道は、コロンを含む wcstack のイベント名を束縛できない
framework では成立しない。したがってゲート 6 は、React 単独ではなく adapter 横断の surface 設計として上流へ
提示する。

## 9. 実施価値と優先度

| 観点 | 評価 |
| --- | --- |
| 現行 example の即時障害 | 低い |
| React 18+ / 19 の長期互換性 | 中〜高 |
| protocol / adapter 間の意味明確化 | 高い |
| remote / DevTools / SSR への波及価値 | 高い |
| 全 payload deep clone の費用対効果 | 低い（不採用） |
| inventory + producer contract の費用対効果 | 高い |

従って、次の architecture-hardening 項目として Phase 0 を実施する価値は高い。ただし Phase 0 の棚卸しで
post-publication mutation、live handle の誤分類、resource lifetime の実害が確認されるまでは、全ノード一括の
runtime 改修を約束しない。

## 参照

- [React `useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore)
- [`@wc-bindable/react@0.8.0` source（固定コミット）](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/packages/react/src/index.ts)
- [wc-bindable SPEC（固定コミット）](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/SPEC.md)
- [非同期実行と wc-bindable 境界](04-async-execution-and-wc-bindable.md)
- [横断修正設計](09-remediation-design.md)
- [非同期 I/O ノード作成ガイドライン](../async-io-node-guidelines.ja.md)
- [`FetchCore`](../../packages/fetch/src/core/FetchCore.ts)
- [`CameraCore`](../../packages/camera/src/core/CameraCore.ts)
