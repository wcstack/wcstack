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
