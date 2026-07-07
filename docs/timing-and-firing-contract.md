# wcstack タイミングと発火の契約 (Timing & Firing Contract)

- **対象**: `@wcstack/state` の binder と、wc-bindable 準拠の非同期プリミティブタグ群（`@wcstack/fetch` / `@wcstack/intersection` ほか）を組み合わせて使うアプリ・example 作者
- **状態**: 参照ドキュメント（リファレンス）。各項目は現行の参照実装の挙動を記述する。挙動を変える場合はこの文書も更新すること
- **なぜ存在するか**: examples（特に [`state-search`](../examples/state-search) / [`state-intersect-scroll`](../examples/state-intersect-scroll)）は、各 README の API 表には載っていない「いつ・何回イベントが出るか」「何が同期で何が microtask か」「どの操作が冪等か」に依存して正しさを成立させている。これらが暗黙のままだとデモの長文コメントが文書不在の応急処置になり、利用者は内部実装を読まないと再現できない。本書はその契約を一枚に集約する
- **TL;DR**: ① `loading-changed(true)` は「送信ごとに1回・await 前・無条件」。② auto-fetch は **microtask に遅延＋同一 url を de-dup**、明示トリガーは **即時・無条件（de-dup 迂回）**。③ `IntersectionObserver` のコールバックは **task**、`page` 前進が予約する auto-fetch は **microtask** なので前者は必ず後。④ `observe()` は同一 target+options で**冪等（新コールバックを出さない）**、強制再観測は `reobserve()`。⑤ data-wcs の初期バインド適用は別 microtask（`getBindingsReady()` で待てる）

---

## 0. 前提: 同期 / microtask / task

ブラウザのイベントループで、本書が区別する3層:

| 層 | 例 | 順序保証 |
|---|---|---|
| **同期** | setter 内で即座に走る処理（`trigger=true` → `fetch()` 開始） | その場で完了 |
| **microtask** | `queueMicrotask` / Promise の `.then` / `await` 直後 | 現在のタスク終了後、**次の task より前**にすべて排出 |
| **task** | `IntersectionObserver` コールバック、`setTimeout`、ユーザー入力 | microtask 排出後 |

**鍵となる不変条件**: 「現在の task 中に積まれた microtask は、次の task が走る前に必ず全部終わる」。本書のいくつかの正しさ（特に §3 のページスキップ防止）はこの一点に立つ。

---

## 1. @wcstack/fetch — 発火と実行の契約

参照: [`packages/fetch/src/components/Fetch.ts`](../packages/fetch/src/components/Fetch.ts)、[`README`](../packages/fetch/README.md)

### 1.1 `loading-changed` は「送信ごとに1回・await 前・無条件」
`FetchCore.fetch()` はリクエスト開始時、**最初の `await` より前に** `wcs-fetch:loading-changed(true)` を発火する。値 de-dup はしない（同一 url を続けて送っても毎回出る）。新しいリクエストが旧リクエストを abort した場合、**abort 側は response を出さない**が `loading-changed(true)` は既に出ている。

→ **帰結**: 「実際に送ったリクエスト数」を数えるなら `loading` の false→true エッジを数える（`response`/`value` を数えると abort 分を取りこぼす）。`state-search` の `requestCount` がこれ。

### 1.2 auto-fetch は microtask に遅延し、同一 url を de-dup（v1.13〜）
`url` 変化（属性経由）と connect 時の自動 fetch は `queueMicrotask` に集約される（`_scheduleAutoFetch`）。

- **同一 tick の複数入力は最終状態で1回に集約**: spread が `url` の次に `manual` を書いても、microtask 時点の最終状態で判定するので順序由来の誤 fetch が起きない
- **same-value ガード**: `url === _lastFetchedUrl` の auto-fetch はスキップ。`"abc"→""→"abc"` は再 fetch される（直前値 `""` と異なるため）が、`"abc"→"abc"` はスキップ

### 1.3 明示トリガーは即時・無条件（de-dup を迂回）
`fetch()` 呼び出し / `trigger=true` / `fetch` コマンド / `data-fetchtarget` クリックは **同期で即実行**し、`_lastFetchedUrl` の同値ガードを**通らない**。

→ **帰結**: 「同じ url をもう一度実行する」は auto-fetch では表現できず（de-dup される）、**明示 fetch でしか表現できない**。`state-intersect-scroll` のエラーリトライ（失敗ページの url は不変なので `command.fetch` で再実行）がこれに依存する。

### 1.4 `response` はエラーでも発火する / `value` はエラーで null
`wcs-fetch:response`（= `value` プロパティのイベント）は **HTTP/ネットワークエラーでも発火**する（`value=null`、`status` にエラーコード、network エラーは `status=0`）。成功判定は必ず `status` を見る（2xx 判定）。`error` は HTTP 非2xx・network throw の両方で埋まり、abort/supersede のときだけ null。

→ **帰結**: `eventToken.value` ＋ `$on` で蓄積する設計（両 infinite-scroll example）は、ハンドラ先頭で status を弾かないと `null` を append して壊れる。

### 1.5 `trigger` は url 空なら無言で無視
`url` が空のときの `trigger=true` は **何もせず**（fetch 走らず・イベント無し・フラグは false のまま）。url を入れてから再度 `true` を書けば実行される。

### 1.6 `body` は `fetch()` ごとに null へリセット / `method="HEAD"` は body 読まない
（補足。詳細は fetch README「Design Notes」）

---

## 2. @wcstack/intersection — 観測と発火の契約

参照: [`packages/intersection/src/core/IntersectionCore.ts`](../packages/intersection/src/core/IntersectionCore.ts)、[`README`](../packages/intersection/README.md)

### 2.1 `IntersectionObserver` のコールバックは task（レイアウト後）
可視性の通知はレイアウト後の task として届く。**microtask ではない**。§3 はこの事実に立つ。

### 2.2 `observe()` は同一 target+options で冪等（新コールバックを出さない）
`observe(el, opts)` は「同じ要素・同じオプション」なら early-return し、observer の作り直しも初回コールバックの再送も**しない**（autoloader の upgrade で起きる create→observe→disconnect のチャーンを避けるための意図的設計）。

→ **帰結**: 可視性が**変化していない**のに「いま見えているか」を再評価したい（= edge-driven 消費者の再武装）場合、`observe()` の呼び直しは **no-op** で効かない。

### 2.3 `reobserve()` は強制再観測（teardown→observe）
`reobserve(el, opts)` は observer を一度 teardown してから observe し直すので、**新しい `IntersectionObserver` が現在の可視性で初回コールバックを出す**。成功時 `observing` は true のまま（false ブリップなし）。

→ **帰結**: ショートページ後の自己修復（追記でレイアウトは変わったが可視性遷移は起きていない）は `reobserve()` で表現する。`state-intersect-scroll` の `command.reobserve` がこれ。`<wcs-infinite-scroll>`（高レベルタグ）はこのコマンドを持たないため自己修復できない。

### 2.4 `change` はイベント性（同値ガードなし、毎回発火）
`wcs-intersect:change` はコールバックごとに必ず発火する（同値ガードしない）。`intersecting` / `ratio` はこのイベントから読む派生 getter。`visible` はラッチ（初回交差で true、`reset()` でのみ解除）。

---

## 3. 横断契約: microtask が task に先行する（ページスキップ防止）

`state-intersect-scroll`（full-auto）の `page` 前進ガード `!loading` の正しさの根拠。

1. `sentinelChanged`（task: IntersectionObserver コールバック）で `page++`
2. `page` 変化 → url バインド → 属性変化 → auto-fetch を **microtask に予約**（§1.2）
3. その microtask が `loading=true` を立てる
4. **次の** `sentinelChanged`（task）が走るより前に、3 の microtask は必ず排出済み（§0 の不変条件）

→ よって急な2回目の enter は `loading=true` を見て弾かれ、`page` を二度進めて**ページを飛ばすことはない**。守っているのは「microtask < task」の順序であって、サーバ冪等性や `observe()` 冪等性ではない（混同しない）。

同型の初期ロード: connect 時 auto-fetch（microtask）が `loading=true` を立ててから、最初の `sentinelChanged`（task）が走るので、page 1 も二重前進しない。

---

## 4. @wcstack/state — バインド適用のタイミング

参照: [`packages/state/src/buildBindings.ts`](../packages/state/src/buildBindings.ts)、[`stateElementByName.ts`](../packages/state/src/stateElementByName.ts)

### 4.1 data-wcs の初期バインド適用は別 microtask（`$connectedCallback` と順序保証なし）
`<wcs-state>` の `connectedCallback` は ① state ロード → `initializePromise` 解決 → ② `$connectedCallback` 実行、の順。一方 data-wcs バインドの**初期値適用は `buildBindings`（別 microtask）**で、`initializePromise` を待ってから走る。つまり **`$connectedCallback` 実行時点で「url が要素に乗っているか」「command トークンが結線済みか」は保証されない**。

→ **帰結**: `$connectedCallback` でバインド済みを前提に要素を叩く（コマンド emit・要素プロパティ読み）なら、`getBindingsReady()` を待つ:

```js
async $connectedCallback() {
  await customElements.get("wcs-state").getBindingsReady(document);
  // ここでは url 適用・command 結線が完了している
}
```

未登録 rootNode では `Promise.resolve()` を返すのでハングしない。

### 4.2 `undefined` 書き込みはスキップ（明示クリアは `null`）
binder は `undefined` を properties/inputs に書かない（書き込み自体をスキップ）。詳細と SPEC 提案は [spec-proposal-undefined-write-skip.md](./spec-proposal-undefined-write-skip.md)。

---

## 5. example → 依存している契約（トレーサビリティ）

| example | 依存する契約 |
|---|---|
| [`state-search`](../examples/state-search) | §1.1（loading エッジで送信数を計数）/ §1.2（debounced url 変化で auto-fetch）/ §1.4（abort 時は response 無し → stale 防止） |
| [`state-fetch`](../examples/state-fetch) | §1.3（`refreshList` command で再取得）/ §1.4（response はエラーでも発火 → status で成功判定）/ §1.5（空 url の detail 抑止） |
| [`state-infinite-scroll`](../examples/state-infinite-scroll) | §1.2/§1.4（append は status 判定）/ §2.1（センチネルは box 必須・初回 task で発火） |
| [`state-intersect-scroll`](../examples/state-intersect-scroll) | §1.2+§1.3（happy path は auto、エラーは明示 fetch）/ §2.2+§2.3（reobserve で自己修復）/ §3（page-skip 防止） |

---

## 6. メンテナンス指針

- これらの契約を**変える**変更（発火回数・タイミング・冪等規則）は破壊的になり得る。本書と各 README、依存 example を同時に更新する
- 新しい非同期プリミティブタグを足すときは、§1/§2 と同じ粒度で「いつ・何回・何が同期か」をこの文書に1節追加する
- example の長文コメントで内部挙動を説明したくなったら、まずこの文書に項目があるか確認し、無ければ追記してからコメントはそこへリンクする

---

## 7. @wcstack/screen-orientation — 監視と lock() の発火契約

参照: [`packages/screen-orientation/src/core/ScreenOrientationCore.ts`](../packages/screen-orientation/src/core/ScreenOrientationCore.ts)、[`README`](../packages/screen-orientation/README.md)

### 7.1 初回スナップショットは同期発火し、遅れて購読した相手には再送されない
`observe()` は購読と同時に現在の `screen.orientation` を同期的に読み、既定値と異なれば即座に `wcs-orientation:change` を dispatch する。一方 `@wcstack/state` の data-wcs バインドはリスナー取り付けが `initializePromise` 解決後の別 microtask（§4.1）なので、Shell の `connectedCallback` 中に飛ぶこの初回 dispatch にはまだ誰も購読しておらず、届かない。以降のバインドは**次の** `change`（実機の向き変化）からしか値を得られない。

→ **帰結**: 初期値（`portrait`/`landscape`/`type`/`angle`）が重要なら、`$connectedCallback` で `customElements.whenDefined` を待って要素のプロパティを直接 pull する（README Quick Start の例1参照）。これは screen-orientation 固有の癖ではなく、全ての monitor 系ノードが共有する wc-bindable イベント契約の性質。

### 7.2 `lock()` は `_gen` 世代で後勝ち（監視パスとは独立）
`lock()` は呼び出しごとに `_gen` をインクリメントして捕捉し、`await` 後に世代が変わっていれば（＝その間に別の `lock()`/`unlock()`/`dispose()` が起きていれば）resolve/reject の結果を破棄して何もしない。監視パス（`observe()`/`change` リスナー）は完全同期なので `_gen` を一切消費・参照しない — この非対称性（監視: `_gen` 不要／コマンド: `_gen` 必須）が本ノードの設計上の特徴。

→ **帰結**: 連続する `lock("landscape")` → `lock("portrait")` は、後発の呼び出しが確立した `error` を先発の遅延 resolve/reject が上書きしない。「最後に呼んだ `lock()` が勝つ」が常に成り立つ。

### 7.3 `unlock()` / `dispose()` は進行中の `lock()` を世代無効化する
`unlock()` は処理本体より先に `_gen++` する。`dispose()` はリスナーを外し、`_gen++` で in-flight の `lock()` を無効化する（`dispose()` は完全同期ブロックで、stale な `lock()` の解決は必ず microtask 以降に起きるため、ブロック内での `_gen++` の位置は観測可能な差を生まない）。どちらも in-flight の `lock()` を stale 化するので、その `lock()` が後から resolve/reject しても `unlock()`/`dispose()` が確立した状態を書き換えない。

→ **帰結**: 「`lock()` 呼び出し中に `unlock()` する」「`lock()` 呼び出し中に disconnect する」のどちらも、古い `lock()` の結果に上書きされる心配なく安全に行える。

### 7.4 `error` は同値ガード（`===` 参照比較）— `"unsupported"` は共有定数で dedup する
`_setError` は `this._error === error` のときは再 dispatch しない。API 不在時の失敗ごとに新しいオブジェクトリテラルを作ると参照が毎回変わりガードが効かなくなるため、`"unsupported"` はモジュールスコープの共有定数を毎回同じ参照で渡す。

→ **帰結**: 非対応環境で `lock()`/`unlock()` を連続呼び出しても `wcs-orientation:error` は初回のみ発火する。一方、実際の失敗オブジェクト（例えば reject された `NotSupportedError`）は呼び出しごとに新規オブジェクトなので同値ガードには掛からず、失敗のたびに発火する。

---

## 8. @wcstack/tilt — `requestPermission()` と `change` の発火契約

参照: [`packages/tilt/src/core/TiltCore.ts`](../packages/tilt/src/core/TiltCore.ts)、[`README`](../packages/tilt/README.md)、[device-orientation-tag-design.md](./device-orientation-tag-design.md)

### 8.1 `connectedCallback` は購読しない — screen-orientation §7.1 の「初回スナップショット消失」はここでは起きない
`observe()` は `_ready`（`Promise.resolve()` 固定）を返すだけの同期 no-op で、`deviceorientation` の購読も現在値の読み出しもしない（§6 決定 4）。`screen.orientation` と異なり Device Orientation には同期的に読める「現在値」がそもそも存在しない（値はイベント経由でしか手に入らない）ため、screen-orientation §7.1 が抱える「`connectedCallback` 中の同期 dispatch が、まだ張られていない data-wcs リスナーに届かず消える」という問題は構造的に発生しない。`start()` を呼ぶまで `wcs-tilt:change` は一切飛ばない。

→ **帰結**: 初期値を気にする必要が無い。`start()` は必ず `requestPermission()` の後（多くは利用者の gesture ハンドラの中）で呼ばれるため、その頃には `@wcstack/state` の data-wcs バインドは（§4.1 の別 microtask を経て）確立済みなのが通常のフローであり、screen-orientation の README Quick Start（§7.1）のような `$connectedCallback` 経由の pull 対応は不要（tilt 自身の README にこのパターンは存在しない）。

### 8.2 `requestPermission()` の post-await 書き込みは benign — `_gen` を持たない
`requestPermission()` は async（`await Ctor.requestPermission()`）だが、`start`/`stop` と異なり `_gen`/`AbortController` を一切使わない。post-await の書き込み先は `permissionState`/`error` という単純なプロパティ設定＋dispatch のみで、購読やコールバック登録のような「生存管理が必要なリソース」を作らない。要素が disconnect 済みでも、この書き込みは新しい購読を復活させたり二重登録を起こしたりしない——誰も購読していなければ `dispatchEvent` は無害に空振りするだけである（`<wcs-idle>` の `requestPermission()` と同型、[idle-detection-tag-design.md](./idle-detection-tag-design.md) §4.1）。

→ **帰結**: `requestPermission()` を連続で呼んだ場合（通常は gesture 制約で起こりにくいが）、`_gen` によるスーパーシードが無いため「呼び出し順」ではなく「resolve した順」で `permissionState`/`error` が確定する。ブラウザの許可ダイアログは初回以降キャッシュされた結果を即座に返すため、実務上この順序の入れ替わりが可視化されることはほぼ無い。

### 8.3 `wcs-tilt:change` は同値ガード（`alpha`/`beta`/`gamma`/`absolute` の4フィールド一致判定）
`_apply` は新しい `deviceorientation` イベントの4フィールドすべてが直前のスナップショットと一致する場合は dispatch をスキップする（§3.3 MUST）。一致判定は `===`（`null` 同士も一致）。

→ **帰結**: デバイスが静止している間、ネイティブの `deviceorientation` は高頻度で発火し続けてもプラットフォームによっては同一値が続くことがあるが、`wcs-tilt:change` は値が実際に変わったときだけ届く。

### 8.4 `wcs-tilt:error` は同値ガード（`===` 参照比較）— 成功 settle は必ず `null` にクリア
`_setError` は `this._error === error` のときは再 dispatch しない。`requestPermission()` の reject（gesture 文脈外呼び出し等）は catch のたびに新しいオブジェクトリテラル（`{ error: e }`）を作るため参照が毎回変わり、失敗のたびに発火する。一方、例外なく settle した呼び出し（granted / 素の denied / 非 gating 環境の即時 granted）は catch を経ないため、`_setError(null)` を無条件に先に呼ぶ——直前が非 null なら `wcs-tilt:error(null)` が飛び、直前がすでに null ならガードに掛かり dispatch しない。

→ **帰結**: `error` に古い失敗が残ったまま `permissionState` だけ更新される、という不整合は起きない——settle 成功は必ず先に `error` をクリアしてから `permissionState` を更新する（`TiltCore.requestPermission()` 内の呼び出し順）。

---

## 9. Generic Sensor 4兄弟（accelerometer / gyroscope / magnetometer / ambient-light-sensor）— `reading` と `error` の発火契約

参照: [`packages/accelerometer/src/core/AccelerometerCore.ts`](../packages/accelerometer/src/core/AccelerometerCore.ts)（4兄弟は同型。gyroscope / magnetometer / ambient-light-sensor も同じ契約）、[sensor-tag-design.md](./sensor-tag-design.md)

4兄弟は Core / Shell とも同一形状で、契約も完全に共有する。差分は観測値の形（x/y/z の3軸 vs ambient-light-sensor の `illuminance` 単一スカラー）のみ。

### 9.1 connect では何も始まらない — `start` コマンドを発火するまで完全に不活性
Shell の `connectedCallback` は `observe()` を呼ばない（`display: none` の設定と SSR 用 promise の張り替えのみ、sensor-tag-design.md §1.3）。バインドしただけでは `x`/`y`/`z`（`illuminance`）は初期値 `null` のままで、`wcs-*:reading` は一切飛ばない。screen-orientation §7.1 の「初回スナップショット消失」は構造的に発生しない（connect 時に dispatch するものが無い）。`disconnectedCallback` は `dispose()`（= `stop()`）を呼ぶため、**要素の reparent はセンサー停止を意味し、自動再開はない**——再度 `start` を発火するまで値は最終サンプルで凍結する。

→ **帰結**: tilt §8.1 と同じ理由で `$connectedCallback` 経由の pull 対応は不要。`start` は通常 `requestPermission` 系の gesture フローの後に発火されるため、その時点で data-wcs バインドは確立済み。

### 9.2 `reading` は同値ガード**なし**（毎サンプル発火）/ `error` は同値ガード**あり**（name＋message 複合キー）
`reading` はイベント性（毎回新しいサンプル）であり、値がたまたま同一でも**毎回** dispatch する（sensor-tag-design.md §1.1）。`x`/`y`/`z` は単一の `wcs-*:reading` イベントからの派生 getter（1回のネイティブ `reading` で全軸が同時更新）。一方 `error` は状態性であり、`_setError` は「`error`（name）と `message` の**両方**が直前と一致」する場合のみ再 dispatch を抑止する——name だけ違う・message だけ違う場合はどちらも再 dispatch される。

### 9.3 `error` は sticky — 成功した (再)start / reading 受信ではクリアされない
screen-orientation の `lock()` が成功時に `_setError(null)` するのと異なり、監視系センサー4兄弟は成功パスで `error` を**書き換えない**。失敗（`unsupported` / コンストラクタの `SecurityError` 等）→ リトライ成功のあとも直前の `error` は残り続ける（各 README「注意・制限」）。クリア・再解釈は利用側 state の責務。

### 9.4 `_gen` 無し・全パス同期・never-throw の3点セット
`start()`/`stop()` は同期的な購読/購読解除のトグルで、非同期 probe が存在しないため `_gen` 世代ガードは不要（sensor-tag-design.md §1.5、network §5 と同根拠）。never-throw の担い方は3経路: ① API 不在 → `{ error: "unsupported", ... }`、② コンストラクタの同期例外（権限拒否・Permissions-Policy ブロック）→ catch して `error` へ、③ 非準拠実装の `sensor.start()` 同期 throw → catch して **teardown**（失敗インスタンスの listener を外し `_sensor` を null 復帰）した上で `error` へ——teardown により次の `start()` は新しいセンサーで再試行できる。`start()` は稼働中は冪等（二重生成しない）で、`frequency` は `start()` 時にのみ読まれる。

### 9.5 `error` イベントの message フォールバックは定数 `"Sensor error"`
ネイティブ `error` イベントが `error` フィールドを持たない場合、`{ error: "error", message: "Sensor error" }` に正規化する（`String(undefined)` 由来の文字列 `"undefined"` を格納しない）。4兄弟で同一文言。

---

## 10. @wcstack/network — 監視の発火契約

参照: [`packages/network/src/core/NetworkCore.ts`](../packages/network/src/core/NetworkCore.ts)、[`README`](../packages/network/README.md)、[network-tag-design.md](./network-tag-design.md)

### 10.1 初回スナップショットは connect 中に同期発火し、data-wcs バインドには届かない（screen-orientation §7.1 と同型）
Shell の `connectedCallback` は `observe()` を呼び、`observe()` は購読と同時に `navigator.connection` を同期的に読んで、既定スナップショット（全フィールド null / `supported: false`）と異なれば即座に `wcs-network:change` を dispatch する。対応環境では `supported` が false→true になるため**必ず**この初回 dispatch が起きるが、§4.1 の通り data-wcs のリスナー取り付けは別 microtask なので誰にも届かない。

→ **帰結**: 初期値が重要なら `$connectedCallback` で `customElements.whenDefined` を待って要素プロパティを直接 pull する（README の全例が採用する公式 idiom、§7.1 と同じ）。

### 10.2 非対応環境（Firefox/Safari）では `change` は一度も飛ばない
`navigator.connection` 不在時、`observe()` の初回読み取りは既定と同一参照の `UNSUPPORTED_SNAPSHOT` を返し、同値ガードに掛かって dispatch されない。以降も購読対象が無いため `wcs-network:change` は一切発火しない——`supported` の判定はイベント待ちではなくプロパティ pull で行う（10.1 の idiom がここでも効く）。

### 10.3 `change` は5フィールド全一致の同値ガード付き / `observe()` は冪等 / `_gen` 無し
`_apply` は `effectiveType`/`downlink`/`rtt`/`saveData`/`supported` の5フィールドを個別比較し、全一致なら dispatch しない（ネイティブ `change` の二重発火に対する多層防御）。`observe()` は `_subscribed` フラグで冪等（二重リスナー無し）、`dispose()` がフラグを戻すので dispose→observe で復活する（復活時は再読み取りが走る）。購読は完全同期のため `_gen` は持たない（network-tag-design.md §5）。pure monitor（`commands: []`）でコマンド面は存在しない。

---

## 11. @wcstack/permission — 監視の発火契約

参照: [`packages/permission/src/core/PermissionCore.ts`](../packages/permission/src/core/PermissionCore.ts)、[`README`](../packages/permission/README.md)

### 11.1 pure monitor（`commands: []`）— 観測面は `state` 1本、他4値は同一イベントからの派生 getter
`granted` / `denied` / `prompt` / `unsupported` はすべて単一の `wcs-permission:change` イベントからの派生 getter（detail は `state` の生値）。`_setState` は同値ガード付きで、`state` が実際に変わったときだけ1回 dispatch する — 派生4値は `state` とロックステップで変わるため、これで全プロパティの通知が揃う。

### 11.2 対応環境の初回確定は `query()` の resolve 時（非同期）/ unsupported の一部だけが connect 中の同期 dispatch
対応環境では `observe(descriptor)` が `navigator.permissions.query()` を発行し、初回の `change` は query の resolve 時に飛ぶ（connect 中の同期 dispatch ではない。ただし resolve と data-wcs バインド確立（§4.1 の別 microtask）の順序自体は保証されない）。一方 **API 不在または descriptor `name` 欠落**のときは、初期値 `"prompt"` → `"unsupported"` の遷移が `connectedCallback` 中に**同期**で dispatch され、§7.1 と同型で data-wcs には届かない（query の reject 由来の `"unsupported"` は resolve 時＝非同期）。

→ **帰結**: `unsupported` の判定はイベント待ちではなくプロパティ pull で行う（network §10.2 と同じ。`$connectedCallback`＋`whenDefined` idiom）。

### 11.3 `observe()` は購読中 no-op — descriptor を差し替えても再クエリしない
購読確立後の `observe()` は保存 descriptor を更新するだけで、**別の `name` を渡しても再クエリしない**（v1 の Shell は connect 時の descriptor で固定）。permission を切り替えるには `dispose()` してから新しい descriptor で `observe()` する。

### 11.4 `_permGen` — query ごと＋`dispose()` で bump（stale query は listener を張らない）
in-flight の query は捕捉した世代が古くなっていたら resolve 時に bail する（listener を張らず状態も書かない）。高速 disconnect→reconnect で先行 query が後から resolve しても、現行購読だけが listener を持つ。購読中はライブの `PermissionStatus` の `change`（ブラウザ設定での grant 切替）が流れ込み続ける。

---

## 12. @wcstack/resize — 観測と発火の契約

参照: [`packages/resize/src/core/ResizeCore.ts`](../packages/resize/src/core/ResizeCore.ts)、[`README`](../packages/resize/README.md)

### 12.1 観測はコマンド駆動（connect 時は非 `manual` なら auto-observe）/ 初回サイズは observer の初回エントリとして届く
`observe` コマンドが Shell の `target` を解決して `ResizeObserver.observe()` を張る。connect 中に Core が同期 dispatch する値は無く、初回サイズは観測開始に伴って ResizeObserver 自身が配信する初回エントリとして届く（実ブラウザではレイアウト後 — data-wcs バインド確立（§4.1）より後になるのが通常で、§7.1 の初回スナップショット消失は実務上問題にならない）。

### 12.2 `change` は同値ガード無し（毎コールバック発火）/ `observing` は同値ガード有り
`entry` / `width` / `height` は単一の `wcs-resize:change` からの派生 getter（intersection §2.4 と同型のイベント性）。同サイズの再通知もそのまま流れる。`observing` は状態性で同値ガード付き。

### 12.3 `observe()` は同一 element＋同一 options で冪等 / 変更は teardown→再構築で初回エントリを再配信
intersection §2.2 と同じ churn 対策。element か options（`box` / `round`）が変わると observer を作り直し、**再 observe は初期サイズを再配信する**（`round` 切替が新しい丸めで再発火するのはこの仕組み）。冪等判定は「要求した options」で行う（`box` fallback 後も再 observe が毎回作り直し＋再 fallback にならない）。

### 12.4 `_gen` 無し / unsupported・失敗は silent no-op（error 面が無い）
購読確立は同期で、stale コールバックは `disconnect()` の observer teardown 自体が止めるため世代ガードは不要。`ResizeObserver` 不在（SSR）は silent no-op で `observing` は false のまま。未対応の `box` は `content-box` で1回だけリトライし、それでも失敗なら `observing` false のまま諦める — 本ノードは `error` プロパティ自体を持たない。

---

## 13. @wcstack/geolocation — 取得と監視の発火契約

参照: [`packages/geolocation/src/core/GeolocationCore.ts`](../packages/geolocation/src/core/GeolocationCore.ts)、[`README`](../packages/geolocation/README.md)

### 13.1 世代カウンタは3系統 — one-shot は capture-only、watch は bump
- `_permGen`: permission query 用。query ごと＋`dispose()` で bump（§11.4 と同じ形）
- `_acqGen`: one-shot 用。**bump するのは `dispose()` のみ**で、`getCurrentPosition()` は捕捉するだけ — 並行 one-shot が互いの成功を握りつぶさない（share / contacts の capture-only と同じ判断）。Geolocation API に AbortController が無いため、in-flight one-shot の無効化は世代ガードが唯一の手段
- `_watchGen`: `watch()` / `clearWatch()` / `dispose()` で bump。clearWatch→watch の再起動後に届く旧 watch のコールバックは `_watchId` の null チェックでは弾けない（新 watch が再設定するため）ので、世代比較で弾く

### 13.2 `position` は同値ガード無し（毎 fix 発火）/ 成功 fix は error をクリア
`latitude` / `longitude` / `accuracy` / `coords` / `timestamp` は単一の `wcs-geo:position` からの派生 getter で、fix は毎回 dispatch。watch 経路でも成功 fix のたびに `_setError(null)` する（一過性 TIMEOUT の残留防止。同値ガードにより error が既に null なら無音）。`watching` / `loading` / `permission` は同値ガード、`error` は参照ガード＋失敗は毎回 fresh オブジェクト。

### 13.3 watch のエラーは watch を解除しない
watchPosition のエラーコールバックは `error` を立てるだけで `watching` は true のまま（watchId は生きており、teardown は `clearWatch()` の責務）。PERMISSION_DENIED のような terminal エラーで止めたい場合は、利用側が `error` に反応して `clearWatch` を発火する。

### 13.4 `dispose()` は `_loading` を silent リセットする
`dispose()` は3世代を全部 bump し、`_loading` は **dispatch せず** false に戻す。bail した in-flight コールバックはもう loading をクリアしないため、放置すると reconnect 後の次の取得で loading=true エッジが同値ガードに食われる — それを防ぐための無音リセット。

### 13.5 permission probe はコンストラクタ開始 / `getCurrentPosition()` は never-reject（全パス resolve）
初回 permission probe は Core のコンストラクタで開始する（connect 前）。`getCurrentPosition()` は stale・成功・失敗の全パスで resolve する（SSR の connectedCallbackPromise を hang させない）。非 `manual` の connect は `watch` 属性の有無で watchPosition() / getCurrentPosition() のどちらかを自動起動する。

---

## 14. @wcstack/idle — `start()` と `change` の発火契約

参照: [`packages/idle/src/core/IdleCore.ts`](../packages/idle/src/core/IdleCore.ts)、[`README`](../packages/idle/README.md)、[idle-detection-tag-design.md](./idle-detection-tag-design.md)

### 14.1 connect では何も始まらない（auto-start 無し）
`observe()` は同期 no-op。permission が gesture-gated なので connect 時の自動 start は必ず失敗するため、設計として持たない（idle-detection-tag-design.md §6）。tilt §8.1 / sensor §9.1 と同じ理由で初回スナップショット消失は構造的に起きず、`$connectedCallback` pull idiom も不要。

### 14.2 `start()` は「stop→新世代」の supersede 型 / 成功時に初期状態を dispatch
`start()` は冒頭で `stop()`（旧セッションの abort＋listener 除去＋`_gen` bump）してから新世代を capture する — fetch と同じ「新規呼び出しが旧を追い越す」型で、share / contacts の capture-only とは**逆**。`await detector.start()` 成功後に `_setError(null)` → `_setState(detector.userState, detector.screenState)` するため、**初期の idle 状態は start() 成功時に届く**（gesture フロー後なので data-wcs バインドは確立済みが通常）。失敗時は失敗セッションの listener / controller を teardown してから `error` へ流す（残置すると同一インスタンスの後続 `change` が、直前に記録した error と矛盾する状態を書くため）。

### 14.3 stop 由来の AbortError は個別判定不要（`_gen` が先に進む）
`stop()` は `abort()` より**先に** `_gen++` するので、stop 起因の AbortError は catch 到達時点で必ず stale 判定に掛かる。signal は非公開のため他起源の AbortError は存在しない — catch 内に AbortError 分岐が無いのはこのため。

### 14.4 `change` は複合同値ガード / `requestPermission()` は `_gen` 無し
`wcs-idle:change` は `userState` と `screenState` の**両方**が直前と一致するときだけ抑止される（片方でも違えば発火）。`requestPermission()` は tilt §8.2 と同型の benign な post-await 書き込み（`_gen` 不使用）で、settle 成功（granted / 素の denied）は `_setError(null)`、reject は fresh な `{ error }` で毎回発火する。

---

## 15. @wcstack/wakelock — desired / actual と再取得の発火契約

参照: [`packages/wakelock/src/core/WakeLockCore.ts`](../packages/wakelock/src/core/WakeLockCore.ts)、[`README`](../packages/wakelock/README.md)

### 15.1 desired（`active`）と actual（`held`）の二相 — 公開されるのは `held` だけ
OS は可視性喪失などで lock を勝手に release するため、「欲しい」（`_active`）と「持っている」（`held`）は乖離する。bindable なのは `held` / `error` のみで、desired は非 bindable の plain getter（OS auto-release では変わらない値なので観測対象にしない）。`held-changed` は同値ガード付き。connect 時は `active` 属性＋非 `manual` のときだけ自動 request する。

### 15.2 再取得は2経路 — visibilitychange 復帰と、可視のままの release（lease renewal）
hidden→visible 復帰時（desired かつ未 held なら再取得）に加え、**可視のままの** OS release（battery-low / power-saver 等。`visibilitychange` を伴わない）は sentinel の `release` イベント経由で held=false を反映した直後に再取得を試みる。再取得の失敗は `error` を記録して止まる（listener を張らないので `release` 再入も起きず、ループしない）。

### 15.3 `error` の同値ガードは族で唯一の**値比較**（name＋message）
denied 環境では visibility 復帰のたびの再取得 reject が**毎回 fresh な Error** を作るため、参照比較ではガードにならない。`name`＋`message` の値比較により、恒久 denied 環境で hidden→visible をトグルしても `wcs-wakelock:error` は初回のみ発火する。null を経由する遷移（成功でクリア→再失敗）は必ず再発火する。

### 15.4 `_gen`＋in-flight フラグの二段 — supersede されたら coalesced retry を1回だけ
`_gen` は `release()` と各取得開始で bump。`_acquiring` フラグが並行 `request()`（急速な visibilitychange 二連発や release→request の overlap）の二重 platform call を防ぎ、await 中に supersede された取得は sentinel を drop した上で「まだ desired・未 held・可視」なら**1回だけ**再試行する。retry の連鎖は外部の overlap 回数でしか伸びない有界設計。

---

## 16. fullscreen / pointer-lock / picture-in-picture（target 参照系トリオ）— `active` と `error` の発火契約

参照: [`packages/fullscreen/src/core/FullscreenCore.ts`](../packages/fullscreen/src/core/FullscreenCore.ts)、[`packages/pointer-lock/src/core/PointerLockCore.ts`](../packages/pointer-lock/src/core/PointerLockCore.ts)、[`packages/picture-in-picture/src/core/PipCore.ts`](../packages/picture-in-picture/src/core/PipCore.ts)、[fullscreen-tag-design.md](./fullscreen-tag-design.md)（アーキタイプ。他2ノードはその差分）

### 16.1 `active` は「document 全域値 === 自分の resolved target」の自己フィルタ導出（同値ガード付き）
bindable なのは `active`（`wcs-fullscreen:change` / `wcs-pointer-lock:change` / `wcs-pip:change`）のみ。各インスタンスは「何かが fullscreen / lock / PiP 中か」ではなく「**自分の** resolved target がそれか」を判定するため、複数インスタンス並存でも正しく分かれる（fullscreen-tag-design.md §2.1）。detail 形状は fullscreen / PiP が `{ active }`＋getter、pointer-lock は素の boolean（既知の族設計差）。

### 16.2 `error` は非 bindable（専用イベント無し・pull-only）— 3ノード共通の意図的設計
`_setError` は代入のみで dispatch せず、`wcBindable.properties` にも宣言されない。コマンドの promise settle 後に `element.error` を命令的に読む（3ノードとも README に明記）。error を event 化する族多数派に対する既知の例外3件で、揃える場合は3ノード同時＋README 更新のセットで行うこと（本書は現状の契約を記述する）。

### 16.3 購読場所: fullscreen / pointer-lock は document、PiP は `<video>` 自身
fullscreen は `fullscreenchange`（webkit fallback あり）、pointer-lock は `pointerlockchange`（同）を document に張る。PiP は `enterpictureinpicture` / `leavepictureinpicture` を resolved `<video>` に張り、target 変更時に re-wire する。PiP は `requestPictureInPicture()` 自体も呼び出し時に `observe(element)` で re-wire する（connect 時に未解決だった後発 `<video>` でも `active` が追従する）。

### 16.4 connect 時の初回発火は「既に active な状態で（再）接続した場合」だけ起きる
connect 時の `observe()` / target 解決は `active` を再導出するが、通常は false→false で同値ガードに掛かり dispatch は無い。既に fullscreen / lock / PiP 中の要素を指した状態で（再）接続した場合に限り connect 中の同期 dispatch が起き、§7.1 と同じ理由で data-wcs には届かない。request 系 API が user gesture 必須のため、実務でこの状況になるのは主に reparent 時。

### 16.5 async コマンドは `_gen` 後勝ち / exit 系の no-op チェックは bump より先 / pointer-lock の exit は同期
`requestFullscreen()` / `requestPictureInPicture()` は呼び出しごとに `_gen` を bump＋capture する（screen-orientation §7.2 と同じ後勝ち。`dispose()` も bump）。`exitFullscreen()` / `exitPictureInPicture()` は「既に非 active」「API 不在」の silent no-op 判定を **`_gen` bump より先**に行う — 何もしない呼び出しが in-flight の request を stale 化してその error / active 更新を握りつぶさないため。pointer-lock の `exitPointerLock()` は同期 platform API（`void` 返し）なので `_gen` を持たず、防御的 try/catch のみ。

> **残課題**: monitor 系ノードの契約節は §7〜§16 で全て執筆済み（2026-07-06）。新しい非同期プリミティブタグを足すときは §6 の指針どおり、実装を読み直した上で本書に1節追加すること（実装で確認できない断定を書かない）。
