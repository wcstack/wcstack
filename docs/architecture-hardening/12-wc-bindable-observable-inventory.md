# wc-bindable observable 棚卸し

- **作成日**: 2026-08-01
- **状態**: Phase 0 完了（分類スナップショット）／ Phase 2 の宣言追加まで実施済み（§6.1）。runtime behavior は未変更
- **基準 commit**: wcstack `6eea3a5b52ef032d2ed6f2d7824bb45e6c000935`
- **親設計**: [React の不変スナップショットと wc-bindable I/O 境界](11-react-immutable-snapshot-boundary.md)
- **外部仕様スナップショット**: `@wc-bindable/core@0.8.0`。adapter 実装の参照は §5.6 に記す

## 1. 目的と範囲

`static wcBindable.properties` に同じ形で並んでいる observable を、adapter が値の型や property 名から
推測せず扱えるよう、次の意味へ分類する。

- **state** — current value。初期 property read が成立し、次の通知まで producer 側の意味が安定する。
- **event** — occurrence。同じ payload でも複数回の発生を区別する必要がある。
- **handle** — live / opaque resource。外部状態と producer 固有の lifecycle を持つ。

本棚卸しは意味分類であり、payload の deep immutability を保証するものではない。`state` に分類した object / array も、
現行 protocol が保証するのは property read と event 配送であって deep clone / deep freeze ではない。

分類の動機は親設計の React 不変スナップショットだが、成果物は adapter-neutral である。`@wc-bindable` は
core と remote を除いて18個の framework / reactive-store adapter を公開しており、同じ `properties` 配列を
それぞれ別の受け皿（React local state、Vue `reactive`、TC39 `Signal.State`、RxJS `BehaviorSubject`、
Qwik `useStore` ほか）へ写す。§5.6 のとおり、この分類が無いと state / event / handle の取り違えは
React だけでなく複数 adapter で同時に別々の壊れ方をする。

調査対象は次のとおりである。

1. `packages/vscode-wcs/src/service/generated/builtinTags.generated.ts` に収録された組み込み41タグ。
2. 上記カタログ外で static declaration を持つ `wcs-route`、`wcs-router`、`RenderCore`。
3. `@wcstack/state` が `$bindables` から実行時生成する DCC declaration（固定件数の集計外）。

生成カタログには observable を持たない `wcs-fetch-header`、`wcs-fetch-body`、`wcs-infinite-scroll` も含まれる。
固定 observable を持つ surface は41、property は合計231である。

## 2. 分類判断

- getter が最新値を返しても、実装が同一 payload の反復通知を明示的に保証する場合は `event` を優先した。
- `error` / `errorInfo` は現在または最後の失敗を getter から読めるため `state` とした。失敗発生そのものを扱う
  event surface が将来必要かは別問題とする。
- Shell の `trigger` / `send` といった input echo は現在値を持つため `state` とした。
- `objectURL` は文字列なので `state` としたが、producer が backing resource を revoke するため
  resource-lifetime risk を別途明記した。
- platform object でも、それ自体を producer が停止・交換する live capability でなければ `state` とした。
  serializability と remote transport 対応は別軸である。

分類結果は `state` 210、`event` 20、`handle` 1、合計231である。

> **追補（2026-08-03・@wcstack/audio 追加時）**: 新規の `@wcstack/audio` は 11 タグを持つが、`handle` を **1件も増やさない**。ライブな `AudioNode` のグラフを内部に抱えながら、公開するのは `state`（context 状態・発音数・warnings・error）と `event`（noteOn / noteOff / analyser frame）だけで、ハンドルは Core が所有・破棄する。worker / websocket / broadcast と同じ形であり、§5.6 の adapter 別失敗モード（signals の同値 dedupe・RxJS の replay による資源保持・Qwik の serialize）を1つも新規に持ち込まない。判断の経緯は [ADR-14](14-handle-graph-wiring.md) G2。
これは Phase 2 の metadata schema を採択する決定ではなく、配置・fallback・公開 API は後続の決定ゲートで確定する。

## 3. 全 surface の分類

| package / surface | state | event | handle | 主な注意点 |
| --- | --- | --- | --- | --- |
| accelerometer / `wcs-accelerometer` | `x`, `y`, `z`, `error`, `errorInfo` | — | — | primitive sensor snapshot。 |
| ambient-light-sensor / `wcs-ambient-light-sensor` | `illuminance`, `error`, `errorInfo` | — | — | primitive sensor snapshot。 |
| broadcast / `wcs-broadcast` | `error`, `errorInfo` | `message` | — | `message` は同一 payload でも毎回 dispatch。`BroadcastChannel` 自体は非公開。 |
| camera / `wcs-camera` | `active`, `permission`, `audioPermission`, `deviceId`, `devices`, `error`, `errorInfo` | `ended` | `streamReady` | `streamReady` は live `MediaStream`。現行 declaration では通常 property と区別不能。 |
| camera / `wcs-recorder` | `recording`, `paused`, `duration`, `mimeType`, `blob`, `objectURL`, `error`, `errorInfo` | `recorded`, `dataavailable` | — | `Blob` は settled value。`objectURL` は次回 record / dispose で revoke。 |
| clipboard / `wcs-clipboard` | `loading`, `error`, `readPermission`, `writePermission`, `monitoring`, `errorInfo` | `text`, `items`, `copied`, `cut`, `pasted` | — | `text` / `items` は最新 getter も持つが、同じ内容の再読を別 occurrence とするため互換性 hotspot。 |
| contacts / `wcs-contacts` | `value`, `loading`, `error`, `cancelled`, `errorInfo` | — | — | `value` は取得済み contact data。 |
| credential / `wcs-credential` | `value`, `loading`, `error`, `cancelled`, `errorInfo` | — | — | `value` は opaque `Credential`。snapshot には保持可能だが serializable とは限らない。 |
| debounce / `wcs-debounce` | `value`, `pending` | `fired` | — | `fired` は coalesced signal occurrence。 |
| debounce / `wcs-throttle` | `value`, `pending` | `fired` | — | debounce と同じ意味で event prefix のみ異なる。 |
| defined / `wcs-defined` | `defined`, `pending`, `missing`, `count`, `total`, `error` | — | — | array getter は copy、event detail は fresh snapshot。 |
| eyedropper / `wcs-eyedropper` | `value`, `loading`, `error`, `cancelled`, `errorInfo` | — | — | `value` は選択済み色文字列。 |
| fetch / `wcs-fetch` | `value`, `loading`, `error`, `status`, `objectURL`, `errorInfo`, `trigger` | — | — | `value` は任意 payload を参照渡し。`objectURL` は次回 response / dispose で revoke。 |
| fullscreen / `wcs-fullscreen` | `active`, `error`, `errorInfo` | — | — | live fullscreen element 自体は公開しない。 |
| geolocation / `wcs-geo` | `position`, `latitude`, `longitude`, `accuracy`, `coords`, `timestamp`, `watching`, `loading`, `error`, `permission`, `errorInfo`, `trigger` | — | — | browser object を plain snapshot へ normalize 済み。 |
| gyroscope / `wcs-gyroscope` | `x`, `y`, `z`, `error`, `errorInfo` | — | — | primitive sensor snapshot。 |
| idle / `wcs-idle` | `userState`, `screenState`, `active`, `error`, `errorInfo` | — | — | current idle state。 |
| intersection / `wcs-intersect` | `entry`, `intersecting`, `ratio`, `visible`, `observing`, `trigger` | — | — | `IntersectionObserverEntry` を plain snapshot へ normalize 済み。 |
| magnetometer / `wcs-magnetometer` | `x`, `y`, `z`, `error`, `errorInfo` | — | — | primitive sensor snapshot。 |
| network / `wcs-network` | `effectiveType`, `downlink`, `rtt`, `saveData`, `supported` | — | — | current connection snapshot。 |
| notification / `wcs-notify` | `permission`, `granted`, `denied`, `prompt`, `unsupported`, `error`, `errorInfo` | `clicked`, `closed`, `shown` | — | notification lifecycle edge を同値 dedupe してはならない。 |
| permission / `wcs-permission` | `state`, `granted`, `denied`, `prompt`, `unsupported` | — | — | current permission state。 |
| picture-in-picture / `wcs-pip` | `active`, `error`, `errorInfo` | — | — | PiP window handle 自体は公開しない。 |
| pointer-lock / `wcs-pointer-lock` | `active`, `error`, `errorInfo` | — | — | locked element 自体は公開しない。 |
| raf / `wcs-raf` | `tick`, `elapsed`, `dt`, `running`, `suspended`, `trigger` | — | — | 各 frame の current counter / timing snapshot。 |
| resize / `wcs-resize` | `entry`, `width`, `height`, `observing`, `trigger` | — | — | `ResizeObserverEntry` を plain snapshot へ normalize 済み。 |
| screen-orientation / `wcs-screen-orientation` | `type`, `angle`, `portrait`, `landscape`, `error`, `errorInfo` | — | — | current orientation snapshot。 |
| share / `wcs-share` | `value`, `loading`, `error`, `cancelled`, `errorInfo` | — | — | `value` は最後の完了結果。 |
| speech / `wcs-speak` | `voices`, `speaking`, `paused`, `pending`, `error`, `errorInfo`, `unsupported` | `charIndex`, `spokenWord` | — | boundary pair は発生順に意味がある。voice は plain `SpeechVoiceInfo` へ normalize 済み。 |
| speech / `wcs-listen` | `interimTranscript`, `finalTranscript`, `listening`, `permission`, `error`, `errorInfo`, `unsupported`, `trigger` | `result` | — | `result` は guard なしで毎回 dispatch される recognition occurrence。 |
| sse / `wcs-sse` | `connected`, `loading`, `error`, `errorInfo`, `readyState`, `trigger` | `message` | — | `message` は同一 payload でも別 occurrence。`EventSource` 自体は非公開。 |
| storage / `wcs-storage` | `value`, `loading`, `error`, `errorInfo`, `trigger` | — | — | object value は参照保持。producer は公開後に変更しないが ownership 契約は未規範。 |
| tilt / `wcs-tilt` | `alpha`, `beta`, `gamma`, `absolute`, `permissionState`, `error`, `errorInfo` | — | — | primitive orientation snapshot。 |
| timer / `wcs-timer` | `tick`, `elapsed`, `running`, `trigger` | — | — | current counter / elapsed snapshot。 |
| upload / `wcs-upload` | `value`, `loading`, `progress`, `error`, `status`, `errorInfo`, `trigger`, `files` | — | — | `value` は任意 response、`files` は opaque `File` の配列。 |
| wakelock / `wcs-wakelock` | `held`, `error`, `errorInfo` | — | — | `WakeLockSentinel` 自体は非公開。 |
| websocket / `wcs-ws` | `connected`, `loading`, `error`, `errorInfo`, `readyState`, `trigger`, `send` | `message` | — | `message` は同一 payload でも別 occurrence。`WebSocket` 自体は非公開。 |
| worker / `wcs-worker` | `error`, `errorInfo`, `running` | `message` | — | `message` は同一 payload でも別 occurrence。`Worker` 自体は非公開。 |
| router / `wcs-route` | `params`, `typedParams`, `active` | — | — | match ごとに fresh params object を割り当てる。 |
| router / `wcs-router` | `navigateUrl`, `path` | — | — | current navigation state。 |
| server / `RenderCore` | `html`, `loading`, `error` | — | — | headless server surface。Custom Element tag ではない。 |

### 動的 DCC

`packages/state/src/dcc/wcBindable.ts` は `$bindables` の各 member から property と
`${tagName}:${propName}-changed` event を動的生成する。固定 property 数には含めない。DCC member は getter / setter を持つ
current value なので、既定分類は `state` とする。将来 DCC が event / handle を公開する場合は、`$bindables` とは別の
明示宣言が必要である。

## 4. 優先8領域の実装監査

| 領域 | 公開後 mutation / stale commit | resource ownership | Phase 1 以降の課題 |
| --- | --- | --- | --- |
| camera | `devices` は fresh array を再割当て。stream acquisition は generation guard 付き。 | `CameraCore` が `MediaStream` を所有し stop / dispose。 | `streamReady` を `handle` と機械判定できる宣言が必要。 |
| recorder | `Blob` と event detail は完了ごとに新規。chunk buffer は公開しない。 | `RecorderCore` が managed URL を次回記録前と dispose 時に revoke。 | 過去 snapshot の URL 有効期間を決定する。 |
| fetch | response は guarded terminal commit。任意 `value` は参照保持するが producer は後から変更しない。 | `FetchCore` が managed URL を次回 response 前と dispose 時に revoke。 | arbitrary payload の ownership transfer と URL lifetime を規範化する。 |
| worker | generation guard が stale message / restart timer を抑止。message は platform structured clone 結果。 | `WorkerCore` が内部 `Worker` を terminate。handle は非公開。 | `message` を `event` と宣言する。 |
| websocket | generation / connection ownership で stale socket callback を抑止。message は occurrence。 | `WebSocketCore` が内部 socket を close。handle は非公開。 | `message` を `event` と宣言する。 |
| broadcast | generation guard が close 後の message を抑止。message は platform structured clone 結果。 | `BroadcastCore` が内部 channel を close。handle は非公開。 | `message` を `event` と宣言する。 |
| clipboard | read result は毎回 fresh detail。permission query と read/write は generation guard 付き。 | permission listener と DOM monitor listener を Core が dispose。 | `text` / `items` の current-value 利用と occurrence 利用を分離する。 |
| credential | `latest` operation lane が stale completion を抑止。`Credential` 参照を producer は変更しない。 | live resource は公開しない。 | opaque / non-serializable state の adapter・remote 方針を明記する。 |

優先領域では、公開済み state object / array を producer 自身が in-place mutation する実装は確認されなかった。
ただし fetch response、storage value、upload response のような任意 payload について、参照を受け取った consumer を含む
ownership 規律は protocol 上まだ明文化されていない。

## 5. Phase 0 で判明した互換性 hotspot

### 5.1 metadata 不在（Phase 2 で解消）

> **更新（2026-08-01）**: 本 hotspot は Phase 2 で解消した。`IWcBindableProperty` に
> `semantics?: "state" | "event" | "handle"` を追加し、下記 20 event + 1 handle に注釈を付与済み。
> 以下は決定当時の記述として残す。

棚卸し時点の `IWcBindableProperty` は `name`、`event`、optional `getter` だけを持つ。20個の event と1個の handle を
汎用 adapter が state から区別できない。型判定や property-name allowlist ではなく、additive metadata または
sidecar が必要である。

これは「あると良い」ではなく、公開済み adapter が既に別々の壊れ方をしている問題である。`@wc-bindable/signals` は
`Signal.State.prototype.set` をそのまま呼ぶため、既定の `Object.is` 等値で**同値の occurrence が消える**。
`@wc-bindable/rxjs` は property ごとに `BehaviorSubject` を持つため、遅延購読者に**過去の occurrence を replay** し、
かつ last value を無期限に保持する。前者は event を state として扱った場合の取りこぼし、後者は逆向きの誤発火であり、
どちらも adapter 側の実装品質ではなく分類情報の不在に起因する。§3 で `event` に分類した20 property が
そのまま影響範囲になる。

### 5.2 `streamReady` の宣言と説明の不一致

camera は stream を「reactive value ではない direct channel」と説明する一方、`streamReady` を通常の
`properties` 配列へ置く。現行 observer にとっては state と同じ購読面なので、最初の metadata PoC 候補とする。

### 5.3 event の current-value 互換性

event に分類した property も、多くは getter に最後の payload を保持する。特に clipboard の `text` / `items` は
React values としての現在値利用と、同じ内容の再読を失わない occurrence 利用を同じ property が兼ねる。
将来 adapter が event を values から除外する場合、callback / stream surface を追加してから段階移行する必要がある。

現在値利用と occurrence 利用の分岐は adapter ごとに逆向きになる。値ベースの store（signals、VanJS）は同値を
落とすので occurrence 利用が壊れ、replay ベースの store（RxJS `BehaviorSubject`）は現在値利用に寄せた結果として
過去の occurrence を再配送する。React の local-state 転写は payload が毎回 fresh object であるかぎり両立するため、
React だけを見ていると本 hotspot は顕在化しない。

### 5.4 managed URL

fetch / recorder の `objectURL` は primitive string でも、次の commit で古い URL の意味が失われる。
snapshot identity だけでは解決しない。Blob の consumer ownership、retain / release、best-effort current value の
いずれを採るかを node ごとに決める必要がある。

adapter によっては、これは陳腐化ではなくリークとして現れる。`@wc-bindable/rxjs` の `BehaviorSubject` は
last value を購読の有無に関わらず保持し続けるため、producer が revoke 済みの URL 文字列と、`blob` property が
参照する `Blob` 実体を unbind まで抱え込む。親設計 §1.3 が「object identity だけでは検出も修復もできない」と
述べた資源寿命問題の、最も観測しやすい実例である。

### 5.5 opaque state

`Credential`、`File`、任意 fetch / upload response などは state として保持できても serializable とは限らない。
React local state には流せるが、SSR、DevTools、remote adapter では projection または capability failure が必要になる。

resumability を前提とする adapter ではこれが即時の failure になる。`@wc-bindable/qwik` は全 property を
`useStore` へ書き込むが、Qwik の state は serializable であることが要件である。非 serializable 値をそのまま
置くと serialization が失敗し、`noSerialize()` で明示した場合は resume 後に `undefined` になる。
`streamReady`（handle）、`error`（platform `Error`）、
`blob`、`value`（`Credential` / `File` / 任意 response）が該当する。`errorInfo` のような serializable projection を
用意する既存方針は、React ではなくこの経路で最も効く。

### 5.6 adapter 別の失敗モード

次表は、同じ `properties` 配列を各 adapter がどの受け皿へ写すかと、分類が無い場合に何が壊れるかをまとめる。
`@wc-bindable/react` と `@wc-bindable/vue` は npm 0.8.0 の配布物、それ以外は upstream `main` の実装を読んだ結果であり、
親設計が固定した commit とは版がずれ得る。

| adapter | 受け皿 | 分類不在時の失敗 |
| --- | --- | --- |
| react | `useState` へ callback 転写。update ごとに新しい outer object | payload が毎回 fresh なら state / event が偶然両立する。同値 payload を deps 比較する consumer では event が落ちる |
| vue | `reactive({...})` を1個作り property を代入 | outer identity 問題は構造的に発生しない。plain object / array は読み出し時に proxy 化され identity が変わる（platform object は対象外） |
| signals | property ごとに `Signal.State` | `set()` の既定 `Object.is` 等値で同値 occurrence が消える |
| rxjs | property ごとに `BehaviorSubject` | 遅延購読者へ過去 occurrence を replay。last value を無期限保持し handle / managed URL を抱え込む |
| qwik | `useStore` | serializable 要件により handle / opaque state が resume 後 `undefined` になる |
| angular | `{ name, value }` を `EventEmitter` で配送 | 集約は consumer 側。分類情報が届かないため state / event の判断を利用者コードが毎回やり直す |
| solid / preact / svelte ほか | 新しい outer object または利用者定義の store | React と同型か、受け皿が userland 依存になり保証が消える |

metadata が無い間、どの adapter も既定動作を選べない。分類が届けば、signals は event に等値比較を外す、rxjs は
`Subject` を選ぶ、qwik は `noSerialize()` を付ける、vue は `shallowRef` / `markRaw` を選ぶ、といった対応が
adapter 側の実装だけで成立する。

なお `event` / `handle` を values から外して別 surface へ移す場合、その surface を「利用者が要素のイベントを
直接聴く」で代替できない framework がある。wcstack のイベント名はコロンを含むため、Angular テンプレートでは
`target:event` と解釈され束縛できない。したがって親設計の決定ゲート6（event / handle 用 surface の追加）は
React API の設計判断ではなく、複数 adapter に共通する要求である。この制約自体は値の意味分類ではなく
バインド成立可否の問題なので、[framework adapter のバインド成立制約](13-framework-adapter-binding-constraints.md)
で扱う。

## 6. Phase 1 完了と次の作業

Phase 1 として producer snapshot contract を
[非同期 I/O ノード作成ガイドライン](../async-io-node-guidelines.md)
§3.3.1 へ追加した。runtime の一括変更は行わず、次を新規ノード・新規 observable property の規範とした。

1. producer は公開済み state value を in-place mutation しない。
2. logical state が変わる場合は fresh object / array を割り当ててから通知する。
3. arbitrary payload は clone を強制せず、公開後に producer が変更しない ownership transfer とする。
4. event と handle を state-like property と区別する。
5. property read と event payload は同じ logical state を表す。

あわせて、同ガイドライン §3.3.2 に入力側の契約を追加した。producer が出力を変更しない規範だけでは、
consumer 側の reactive store が包んだ値（Vue `reactive`、Svelte `$state`、Qwik `useStore` などの Proxy）が
input 経由で producer に入り込む経路を塞げないためである。Core 側に framework 固有の unwrap は持ち込まず、
structured clone 境界での失敗は never-throw で `error` に落とし、raw 化は利用者の責務として README に明記する。

## 6.1 Phase 2 の着地（2026-08-01）

配置は decision gate 1 のとおり **declaration の additive optional field** に確定した。sidecar は
[`wcstack.manifest.json` schema](../wcstack-manifest-schema.md) 自身の不変条件により runtime correctness の
必須入力になれず、「adapter が実行時に受け皿を選ぶ」という本件の目的を満たさないためである。

実施した内容は次のとおり。

1. `/protocol/wc-bindable.ts`（SSOT）の `IWcBindableProperty` に
   `semantics?: "state" | "event" | "handle"` と `WcBindableSemantics` 型を追加し、
   `scripts/sync-protocol-types.mjs` で 38 個の生成コピーへ配布した（CI の `--check` ゲートが既存）。
2. §3 で `event` / `handle` に分類した 21 property（9 パッケージ）へ注釈を付与した。
   broadcast / sse / websocket / worker の `message`、camera の `ended` と `streamReady`（handle）、
   recorder の `recorded` / `dataavailable`、clipboard の 5 property、debounce・throttle の `fired`、
   notification の 3 property、speech の `charIndex` / `spokenWord` / `result`。
3. 各パッケージに `__tests__/wcBindableSemantics.test.ts` を追加し、`event` / `handle` の集合を固定した。
4. ガイドライン §3.3 と §3.3.1 を更新し、新規ノードの `event` / `handle` 宣言を MUST とした。

`state` は decision gate 2（互換優先）に従い未注釈のままとした。未指定は「未指定」であって `state` ではなく、
読み手は field が無かったときと同じ動作を維持する。runtime 挙動と protocol version は変更していない。

### 残る作業

1. ~~`@wcstack/state` の同値ガードを `semantics: "event"` で迂回する~~ → 実施済み（§6.2）。
2. `state` を含む全 231 property の明示注釈（DevTools / remote / SSR 向け。互換性への影響は無い）。
3. React adapter の現行 local-state 転写を characterization test で固定する（上流リポジトリ）。
4. event / handle の追加 surface を設計し、既存 `[ref, values]` API を壊さず試す（上流リポジトリ）。
5. managed URL の lifetime は adapter 変更と分離して node ごとに決める。

## 6.2 最初の consumer は `@wcstack/state` 自身

Phase 2 の注釈を最初に消費すべきは外部 adapter ではなく wcstack 自身である。`@wcstack/state` は
`config.sameValueGuard`（既定 ON）により、**primitive 値が `Object.is` 同値なら set / 依存伝播 / DOM 適用を
まるごとスキップする**（`packages/state/src/proxy/methods/setByAddress.ts`）。参照型は素通しなので、
JSON payload の `message` は毎回 fresh object で影響を受けないが、同じ文字列の再受信、`charIndex` の同値、
`copied` / `fired` のような primitive occurrence は現状**取りこぼす**。

これは §5.1 で signals adapter について指摘したのと同じ失敗であり、wcstack 内で再現・修正・回帰テストまで
完結できる。

**実施済み（2026-08-01）**。ガードは `setByAddress` の汎用パスにあるため、書き込みの出所を伝える経路として
`packages/state/src/proxy/occurrenceWrite.ts` の one-shot トークンを置いた。`twowayHandler` が occurrence
property の commit を `beginOccurrenceWrite()` / `endOccurrenceWrite()` で挟み、`setByAddress` が先頭で
`consumeOccurrenceWrite()` して fast path・一般パス双方のガード判定に使う。

one-shot にしたのは、フラグを書き込みの呼び出しスタック全体へ張ると、その内側で走る `$updatedCallback` や
依存伝播が行う無関係な同値書き込みまでガードを失うためである。トークンは最初のガード評価で消費されるので、
影響は目的の 1 write に閉じる。

config フラグは追加していない。`semantics` は本 Phase で導入した宣言であり、既存の declaration は 1 つも
`event` を宣言していなかったため、挙動が変わるのは新たに宣言した property だけで、構造的に opt-in になる。

## 7. Phase 0 完了条件

- [x] 固定 `static wcBindable.properties` の全 surface を列挙した。
- [x] `state` / `event` / `handle` を property 単位で分類した。
- [x] camera、recorder、fetch、worker、websocket、broadcast、clipboard、credential を実装まで確認した。
- [x] post-publication mutation、stale commit、resource owner の観点を記録した。
- [x] runtime behavior と protocol typeを変更していない。

## 参照

- [React の不変スナップショットと wc-bindable I/O 境界](11-react-immutable-snapshot-boundary.md)
- [framework adapter のバインド成立制約](13-framework-adapter-binding-constraints.md)
- [非同期 I/O ノード作成ガイドライン §3.3.1](../async-io-node-guidelines.md)
- [`@wc-bindable/signals`](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/packages/signals/src/index.ts)
- [`@wc-bindable/rxjs`](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/packages/rxjs/src/index.ts)
- [`@wc-bindable/qwik`](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/packages/qwik/src/index.ts)
- [Qwik — State（serialization と `noSerialize()`）](https://qwik.dev/docs/components/state/)
