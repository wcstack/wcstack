# React snapshot 向け wc-bindable observable 棚卸し

- **作成日**: 2026-08-01
- **状態**: Phase 0 完了（分類スナップショット。runtime behavior は未変更）
- **基準 commit**: wcstack `6eea3a5b52ef032d2ed6f2d7824bb45e6c000935`
- **親設計**: [React の不変スナップショットと wc-bindable I/O 境界](11-react-immutable-snapshot-boundary.md)

## 1. 目的と範囲

`static wcBindable.properties` に同じ形で並んでいる observable を、React adapter が値の型や property 名から
推測せず扱えるよう、次の意味へ分類する。

- **state** — current value。初期 property read が成立し、次の通知まで producer 側の意味が安定する。
- **event** — occurrence。同じ payload でも複数回の発生を区別する必要がある。
- **handle** — live / opaque resource。外部状態と producer 固有の lifecycle を持つ。

本棚卸しは意味分類であり、payload の deep immutability を保証するものではない。`state` に分類した object / array も、
現行 protocol が保証するのは property read と event 配送であって deep clone / deep freeze ではない。

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

### 5.1 metadata 不在

現行 `IWcBindableProperty` は `name`、`event`、optional `getter` だけを持つ。20個の event と1個の handle を
汎用 adapter が state から区別できない。型判定や property-name allowlist ではなく、additive metadata または
sidecar が必要である。

### 5.2 `streamReady` の宣言と説明の不一致

camera は stream を「reactive value ではない direct channel」と説明する一方、`streamReady` を通常の
`properties` 配列へ置く。現行 observer にとっては state と同じ購読面なので、最初の metadata PoC 候補とする。

### 5.3 event の current-value 互換性

event に分類した property も、多くは getter に最後の payload を保持する。特に clipboard の `text` / `items` は
React values としての現在値利用と、同じ内容の再読を失わない occurrence 利用を同じ property が兼ねる。
将来 adapter が event を values から除外する場合、callback / stream surface を追加してから段階移行する必要がある。

### 5.4 managed URL

fetch / recorder の `objectURL` は primitive string でも、次の commit で古い URL の意味が失われる。
snapshot identity だけでは解決しない。Blob の consumer ownership、retain / release、best-effort current value の
いずれを採るかを node ごとに決める必要がある。

### 5.5 opaque state

`Credential`、`File`、任意 fetch / upload response などは state として保持できても serializable とは限らない。
React local state には流せるが、SSR、DevTools、remote adapter では projection または capability failure が必要になる。

## 6. 次の作業

Phase 1 は runtime の一括変更ではなく、先に producer snapshot contract を
`docs/async-io-node-guidelines.md` へ追加する。

1. producer は公開済み state value を in-place mutation しない。
2. logical state が変わる場合は fresh object / array を割り当ててから通知する。
3. arbitrary payload は clone を強制せず、公開後に producer が変更しない ownership transfer とする。
4. event と handle を state-like property と区別する。
5. property read と event payload は同じ logical state を表す。

その後、次の順で小さな PoC を行う。

1. `streamReady: handle` と `message: event` を表現できる additive metadata / sidecar の配置を決める。
2. metadata 未対応 peer は現行どおり全 property を配送する互換 fallback を固定する。
3. React adapter の現行 local-state 転写を characterization test で固定する。
4. event / handle の追加 surface を設計し、既存 `[ref, values]` API を壊さず試す。
5. managed URL の lifetime は adapter 変更と分離して node ごとに決める。

## 7. Phase 0 完了条件

- [x] 固定 `static wcBindable.properties` の全 surface を列挙した。
- [x] `state` / `event` / `handle` を property 単位で分類した。
- [x] camera、recorder、fetch、worker、websocket、broadcast、clipboard、credential を実装まで確認した。
- [x] post-publication mutation、stale commit、resource owner の観点を記録した。
- [x] runtime behavior と protocol typeを変更していない。
