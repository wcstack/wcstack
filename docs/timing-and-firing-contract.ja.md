# wcstack タイミングと発火の契約 (Timing & Firing Contract)

- **対象**: `@wcstack/state` の binder / `$stream` と、wc-bindable 準拠の非同期プリミティブタグ群（`@wcstack/fetch` / `@wcstack/intersection` ほか）を組み合わせて使うアプリ・example 作者
- **状態**: 参照ドキュメント（リファレンス）。各項目は現行の参照実装の挙動を記述する。挙動を変える場合はこの文書も更新すること
- **なぜ存在するか**: examples（特に [`state-search`](../examples/state-search) / [`state-intersect-scroll`](../examples/state-intersect-scroll)）は、各 README の API 表には載っていない「いつ・何回イベントが出るか」「何が同期で何が microtask か」「どの操作が冪等か」に依存して正しさを成立させている。これらが暗黙のままだとデモの長文コメントが文書不在の応急処置になり、利用者は内部実装を読まないと再現できない。本書はその契約を一枚に集約する
- **関連**: 本書の発火順を test input / settle boundary として適合ベクトルへ写像する横断検証層の提案は [io-node-trace-conformance.md](./io-node-trace-conformance.md)。I/O ノードの実行形・lane・commit 規則は [async-execution-model.ja.md](./async-execution-model.ja.md)
- **English**: [timing-and-firing-contract.md](./timing-and-firing-contract.md)
- **TL;DR**: ① `loading-changed(true)` は「送信ごとに1回・await 前・無条件」。② auto-fetch は **microtask に遅延＋同一 url を de-dup**、明示トリガーは **即時・無条件（de-dup 迂回）**。③ `$stream` のエントリの `args` の依存変更は、drain の終わりに旧 run を abort して再起動する（switchMap 型）。④ `observe()` は同一 target+options で**冪等（新コールバックを出さない）**、強制再観測は `reobserve()`。⑤ data-wcs の初期バインド適用は `$connectedCallback` の前に終わる（`getBindingsReady()` はその時点で解決する）。まだ定義されていないカスタム要素への束縛は、定義された時点で付く

---

## 0. 前提: 同期 / microtask / task

ブラウザのイベントループで、本書が区別する3層:

| 層 | 例 | 順序保証 |
|---|---|---|
| **同期** | setter 内で即座に走る処理（`trigger=true` → `fetch()` 開始） | その場で完了 |
| **microtask** | `queueMicrotask` / Promise の `.then` / `await` 直後 | 現在のタスク終了後、**次の task より前**にすべて排出 |
| **task** | `IntersectionObserver` コールバック、`setTimeout`、ユーザー入力 | microtask 排出後 |

**鍵となる不変条件**: 「現在の task 中に積まれた microtask は、次の task が走る前に必ず全部終わる」。auto-fetch と binding 初期化の発火順を読むときは、この順序を前提にする。

---

## 1. @wcstack/fetch — 発火と実行の契約

参照: [`packages/fetch/src/components/Fetch.ts`](../packages/fetch/src/components/Fetch.ts)、[`README`](../packages/fetch/README.md)

### 1.1 `loading-changed` は「送信ごとに1回・await 前・無条件」
`FetchCore.fetch()` はリクエスト開始時、**最初の `await` より前に** `wcs-fetch:loading-changed(true)` を発火する。値 de-dup はしない（同一 url を続けて送っても毎回出る）。新しいリクエストが旧リクエストを abort した場合、**abort 側は response を出さない**が `loading-changed(true)` は既に出ている。

→ **帰結**: 「実際に送ったリクエスト数」を数えるなら `loading` の false→true エッジを数える（`response`/`value` を数えると abort 分を取りこぼす）。`state-search` の `requestCount` がこれ。

### 1.2 auto-fetch は microtask に遅延し、同一 url を de-dup（v1.13〜）
`url` 変化（属性経由）と connect 時の自動 fetch は `queueMicrotask` に集約される（`_scheduleAutoFetch`）。

- **同一 tick の複数入力は最終状態で1回に集約**: spread が `url` の次に `manual` を書いても、microtask 時点の最終状態で判定するので順序由来の誤 fetch が起きない
- **same-value ガード**: `url === _lastFetchedUrl` の auto-fetch はスキップ。`_lastFetchedUrl` が覚えているのは「直前の url」ではなく**最後に実際に fetch した url**（`fetch()` 内で書かれ、disconnect で null に戻る）。4.2 までは間に挟まる空の url がこれを更新しなかったので、`"abc"→""→"abc"` も `"abc"→"abc"` と同じく**スキップされた**。4.3 からは、空の url を見た auto-fetch の判定がこれを null に戻すので、`"abc"→""→"abc"` はもう一度 fetch する（同じ tick の中の空の url と同じ url は、変化なしに集約される）。間に何も挟まずに同じ url をもう一度取りたい場合は明示トリガー（§1.3 の `fetch()` / `trigger=true` / `fetch` コマンド）か、`_lastFetchedUrl` を null に戻す再マウントが要る

### 1.3 明示トリガーは即時・無条件（de-dup を迂回）
`fetch()` 呼び出し / `trigger=true` / `fetch` コマンド / `data-fetchtarget` クリックは **同期で即実行**し、`_lastFetchedUrl` の同値ガードを**通らない**。

→ **帰結**: `<wcs-fetch>` で「同じ url をもう一度実行する」は auto-fetch では表現できず（de-dup される）、**明示 fetch でしか表現できない**。

### 1.4 `response` はエラーでも発火する / `value` はエラーで null
`wcs-fetch:response`（= `value` プロパティのイベント）は **HTTP/ネットワークエラーでも発火**する（`value=null`、`status` にエラーコード、network エラーは `status=0`）。成功判定は必ず `status` を見る（2xx 判定）。`error` は HTTP 非2xx・network throw の両方で埋まり、abort/supersede のときだけ null。

→ **帰結**: `eventToken.value` ＋ `$on` で蓄積する設計（`packages/fetch/examples/infinite-scroll`）は、ハンドラ先頭で status を弾かないと `null` を append して壊れる。

### 1.5 `trigger` は url 空なら無視（4.5 からは警告付き）
`url` が空のときの `trigger=true` は **何もせず**（fetch 走らず・イベント無し・フラグは false のまま）。url を入れてから再度 `true` を書けば実行される。4.4 までは無言だった。4.5 からは要素ごとに 1 回警告する（`[wcs/command-not-ready]`）。よくある原因は、1 つの `data-wcs` で `trigger` を `url` より前に書くこと（束縛は書いた順に当たる）。走った trigger は、その時点で要素が持つ `url`・`method`・`body` と補助要素を送る。更新では、`@wcstack/state` は束縛をパスを書いた順に当てる（§4.4）。

### 1.6 `body` は `fetch()` ごとに null へリセット / `method="HEAD"` は body 読まない
（補足。詳細は fetch README「Design Notes」）

### 1.7 `fetch(url, init)`: url でないものは要素自身の要求になり、4.26 からは警告する
`fetch(url, init)`（4.24 から。コマンドトークンが運ぶもの）は、`url` を空でない文字列、または 4.26 から `URL`（`String(url)`）として受け取る。その位置にそれ以外のものがあれば要素自身の要求を実行し（その `url`。無ければ何もせず、`error` が `url attribute is required.` と言う）、`init` も無視する。`on…: $command.x` のバインディングが先頭に渡すイベント、`undefined`、`null`、`""` は黙ってそうする。それ以外の値 —— 数やオブジェクト: 継ぎ目アプリ `lending-desk` は url の位置に行の id を emit した（[seam-apps.ja.md](./seam-apps.ja.md)）—— は、要素ごと・値の種類（`typeof`、配列は別）ごとに 1 回、渡されたものを名指しして警告もする: `[wcs/fetch-url-argument]`。4.25 までは何も言わなかった。

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

→ **帰結**: ショートページ後の自己修復（追記でレイアウトは変わったが可視性遷移は起きていない）は `reobserve()` で表現する。`state-intersect-scroll` の `command.reobserve` がこれ。`<wcs-infinite-scroll>`（高レベルタグ）はこのコマンドを持たない。4.24 からは自分でもう一度見る（§26）。4.23 までは自己修復できなかった。

### 2.4 `change` はイベント性（同値ガードなし、毎回発火）
`wcs-intersect:change` はコールバックごとに必ず発火する（同値ガードしない）。`intersecting` / `ratio` はこのイベントから読む派生 getter。`visible` はラッチ（初回交差で true、`reset()` でのみ解除）。

---

## 3. 横断契約: `$stream` restart と同値 page 選択（ページスキップ防止）

`state-intersect-scroll` は `$stream` の switchMap 型 restart を使う。ここで交差 edge ごとに
`page++` すると、page N の in-flight run を後発 edge が abort し、N+1 へ飛ばすため誤りである。
デモは次の組み合わせで ordered append を守る。

1. `sentinelChanged`（IntersectionObserver task）は `page = floor(feed.items.length / pageSize) + 1` とする
2. page N の実行中／失敗後は `feed.items.length` が不変なので N を再代入するだけ。既定 ON の primitive same-value guard が enqueue 自体を no-op にし、stream は restart しない
3. 成功 chunk の着地を `$watch.pageResult` が `feed.items` へ畳み、次のバッチの `$watch.feed` が `reobserve()` する。commit は `done` ではなく成功 chunk の着地で、同じ page の再着地はハンドラの page キーが捨てる
4. 新しい可視性 callback では式が N+1 を返す。`page` 更新を当てる drain の終わりに、`$stream` のエントリの `args` の依存 hit が旧 run を abort し、新しい args で run を開始する

→ `!loading` / `!error` の手書き exhaust guard は不要で、通常の交差 edge は失敗ページの予算外 retry にもならない。
同じ page を意図的に retry する操作は、別依存 `retryNonce` を更新する。これは occurrence（同じ引数でもう一度）を
value 差分へ符号化する現行 `$stream` restart API の境界である。ボタンに加え、既存 item がある error 状態では、
「error 確定時から scrollY が動いた」証拠を伴う sentinel edge が `retryNonce` を更新する。証拠は2系統あり、
scrollY が動いた `leave` は後続 `enter` を1回 arm し、scrollY が動いた `enter` はそれ自体で成立する。
後者は、error UI の layout shift 自体が sentinel を band 外へ押し出した場合の救済である — その leave は
scrollY 不変のまま発火して arm できず、以後ユーザーが離れても新しい leave edge は出ない（IntersectionObserver は
遷移でしか発火しない）ため、arm だけを資格にすると戻りの一往復が黙って無効化される。前者は、戻りの enter が
ちょうど `errorScrollY` へ着地する場合（clamp された最下部への fling 等）の救済である。layout 起因の edge は
scrollY が動かないためどちらの資格も満たさず、error 描画だけで retry が予約されることはない。

error 時に `reobserve()` してはならない。sentinel が可視のままだと新 observer の初回 callback が即 retry し、
再び予算を使い切るたびに同じ循環を起こす layout 駆動の無限 retry になる。したがって「error でも rearm」は不採用とし、
実際の `leave → enter` または Retry ボタンを recovery edge とする。空 feed は scroll 不能なのでボタンだけが残る。
依存が変わった場合の cancel / restart / stale-drop 契約は
[`packages/state/docs/streams.md`](../packages/state/docs/streams.md) が規範である。

---

## 4. @wcstack/state — バインド適用のタイミング

参照（4.0）: `packages/state/src` の `element.ts`（`WcsState.start`・`getBindingsReady`）、`dom/mount.ts`、`dom/wc.ts`（`whenDefined`）、`engine.ts`（`drain`・`report`）

### 4.1 data-wcs の初期バインド適用は `$connectedCallback` の前に終わる（まだ定義されていないカスタム要素は、定義された時点で束ねる）
`<wcs-state>` の `connectedCallback` は ① state ロード（分割 auto では、その `$features` が挙げる機能の読み込みも）→ ② ページを束ねる: ルートの下のすべての `data-wcs` / `{{ }}` の束縛を作り、初期値を当てる（同期）→ ③ `initializePromise` と `getBindingsReady()` を解決 → ④ `$connectedCallback` 実行 → `connectedCallbackPromise` を解決、の順。つまり **`$connectedCallback` の実行時点で、定義済みの要素には url が乗っており、command トークンも結線済み**。

例外は、クラスがまだ定義されていないカスタム要素。そのプロパティ・`command.`・`eventToken.`・スプレッドの束縛は `customElements.whenDefined()` を待って、その時点で付く。`getBindingsReady()` はそれを待たない。ネイティブ要素と、ほかの種類の束縛（`attr.`・`class.`・`style.`・テキスト・`on*:`）はすぐに束ねる。

→ **帰結**: `$connectedCallback` から定義済みの要素を叩く（コマンド emit・要素プロパティ読み）のに、待ちは要らない。パッケージが後から読み込まれうる要素は、その定義を待つ。state は同じ定義への自分の反応（先に登録してある）で要素の束縛を付けるので、`await` から戻った時点で束縛はそろっている:

```js
async $connectedCallback() {
  await customElements.whenDefined("wcs-fetch");
  // ここでは url 適用・command 結線が完了している
}
```

`<wcs-state>` の無い root では `getBindingsReady()` はすぐに解決するのでハングしない。

なお **monitor 系ノードの初回スナップショットを読むのに待ちは要らない**。それは directional initial sync（既定 ON）が構造的に解決しており、バインド確立時のプロパティ読み取りで届く（§7.1・§10.1）。

3.x: 初期適用は `buildBindings`（`initializePromise` の後の別 microtask）で走ったので、`$connectedCallback` の実行時点では何も保証されず、要素を叩く前に `await customElements.get("wcs-state").getBindingsReady(document)` が要った。この待ちは 4.0 でもそのまま動く（すでに決着している）。

### 4.2 `undefined` 書き込みはスキップ（明示クリアは `null`）
`@wcstack/state` は `undefined` を properties/inputs に書かない（書き込み自体をスキップ）。前にそのパスが値を持っていても同じ。これは state 自身の規則で、wc-bindable 0.10.0 の applier プロファイル（A2）は値の後の `undefined` を書いて要素を初期状態に戻させる。state はこのプロファイルを宣言しない。ほかの書き手（React 19、`@wcstack/signals` の `bindInput`、直接の代入）は `undefined` を届けるので、I/O ノードは引き続き `undefined` を扱う（producer ガイダンス P1）。詳細、SPEC 提案と上流の回答は [spec-proposal-undefined-write-skip.md](./spec-proposal-undefined-write-skip.md)。


### 4.3 `<wcs-view-transition>` があると drain は microtask ではなくフレームで着地する
drain（`Engine.drain`）は通常、キューされた microtask の中で、パスごとのバインディングを同期的に適用する。パスごとの DOM の変更は transition-runner プロトコルを通る: `@wcstack/view-transition` の arbiter が install され、かつ **`state` 参加者を受け付けている**とき（`for=` に `state` が含まれる。既定）、arbiter が `run()` で受け取り、view transition を始めるときは、その遷移の更新コールバックの中で（後のフレームで）適用する。

→ **帰結 1**: state に書いてから `await Promise.resolve()` で DOM を読むコードは古い DOM を見る。遷移を待つか、`$renderedCallback` を使うこと —— こちらは更新コールバックの中、預けたバインディングの適用の直後に発火する（バインディングの失敗もそこで `$errorCallback` に届く）ので*位置*は変わらない（ただし適用ごと 1 フレーム後ろへずれる）。

→ **帰結 2 —— 機構間の順序は変わらない（4.10 から）**。drain の終わりの順序は固定: バインディングの適用 → `$renderedCallback` → バインディングの失敗（`$errorCallback`、無ければコンソール）→ `$watch` ハンドラ → `$stream` の再開。arbiter がパスを預かっている間、drain の後に続くもの —— `$watch`・`$stream` の再開・diagnostics の検査 —— は、預けた最後のパスが適用されるまで待つので、順序はタグが無いときと同じで、1 フレーム遅れるだけ。それらが書いたもの —— `$watch` が state に写した一覧、書き戻し、`$renderedCallback` の書き込み —— はその場でドレインし、同じトランジションの中で当てる。タグが無ければ同じフレームで当たるのと同じで、読み込み中の表示が消えたのに行は前のまま、というフレームは無い（docs/seam-apps.ja.md、router-admin。4.10 の取りまとめで見つけた）。4.9 までは `$watch` と `$stream` の再開が元の microtask に留まり、順序は `$watch` → `$stream` restart → `$renderedCallback` になっていた: ログインの後に画面を移す `$watch` が `<wcs-storage>` のセッションの保存より先に走り、`localStorage` を読むルートのガードが読み手をログインのフォームへ戻した（docs/seam-apps.ja.md、city-library）。フォーカスを動かす `$watch` は、欄が invalid になる前に動かしていた。

arbiter が預からない —— `run()` の中で同期的に適用し、順序が宣言どおりのままになる —— のは、ブラウザに `document.startViewTransition` が無い、タブが非表示、`reduced-motion="animate"` なしで `prefers-reduced-motion: reduce` が効いている、タグが `disabled`、サーバーで描画中（`data-wcs-server`）、`mode="exhaust"` で走行中の遷移がすでに更新コールバックを過ぎている、のどれかのとき（[view-transition の README](../packages/view-transition/README.ja.md)）。

預けた適用が同期的に書いたもの —— 要素の書き戻し、同期の `$renderedCallback` —— は、変更を預けた drain の描画の連鎖（100 回の drain の上限）の続きに数えるので、arbiter を挟む更新のループも打ち切られる。async の `$renderedCallback` が `await` の後で書いたものは新しい連鎖を始めるので、そのループは遷移 1 回につき 1 周ずつ進み、打ち切られない。

**変わらない**もの: 初期レンダリングは決して包まれない（包むのは drain だけ）。描くものがキューに無い drain は arbiter に何も渡さないので、headless なパス（`$watch` 専用・`$stream` の内部状態）への書き込みはアニメーションも遅延も起こさない。arbiter が居ない場合、あるいは `for="router"` の場合、変更は drain の中で同期的に適用される。

3.x: drain の適用（`Updater._applyChange`）を 1 つのまとまりとして arbiter に渡し、SSR では state 自身が同期パスへ短絡した（`inSsr()`。4.0 は arbiter に任せる）。宣言どおりの順序 `$updatedCallback` → `$scan` → `$watch` → `$streams` restart が、`$scan` → `$watch` → `$streams` restart → `$updatedCallback` になった。

規範記述: [view-transition-design.ja.md](./view-transition-design.ja.md) §7.2。

### 4.4 1 回の更新の中では、束縛はパスを書いた順に当たる
書き込みは、そのパスの束縛をその場でキューに積み、それを読む getter をたどって、その束縛をすぐ後に積む（dirty 戦略、`strategy/dirty.ts`）。drain はそのキューを積んだ順に当てる（`Engine.drain`）。だから 1 回の更新 —— 1 つのハンドラ、1 つのタスク —— の書き込みは、パスを書いた順に当たる。要素をまたいでも同じで、ある要素の束縛と別の要素の束縛は、ページの中の要素の順ではなく書き込みの順に従う。もう積まれている束縛は、そのパスがまた書かれても位置を変えない。getter の束縛は、それが読む最初のパスを書いたところに積まれる。各パスで先に来るものが 2 つある: 行を作ったり動かしたりする一覧と、`if` / `elseif` の条件（閉じる枝が自分の束縛を連れて行くように）。ページの最初の束縛では、1 つの `data-wcs` の束縛はそこに書いた順に当たる（§1.5）。

→ **帰結**: ある入力が書かれたときに動く要素は、ほかの入力をその時点の値で使う。`<wcs-fetch>` の `trigger` は、trigger が当たった時点で持っている `url`・`method`・`body` と、子の `<wcs-fetch-header>` / `<wcs-fetch-body>` を送り（§1.5）、`<wcs-upload>` の `trigger` は `url` と `files` を読む。`Authorization` ヘッダを `session.token` の getter に束ねたログアウトのハンドラ `this.logoutTrigger = true; this.session = null;` はヘッダ付きでログアウトを送る。`this.session = null; this.logoutTrigger = true;` は先にヘッダを外し、ヘッダなしで送る —— サーバーはセッションを終わらせられず、何も言わない（継ぎ目アプリ `homeroom`、4.2.0 と 4.10.1。`examples/router-auth` は trigger を先に書く）。ハンドラが書くもの —— `body`、`url` —— が要る要求は、それを trigger より先に書く。

---

## 5. example → 依存している契約（トレーサビリティ）

| example | 依存する契約 |
|---|---|
| [`state-search`](../examples/state-search) | §1.1（loading エッジで送信数を計数）/ §1.2（debounced url 変化で auto-fetch）/ §1.4（abort 時は response 無し → stale 防止） |
| [`users-crud`](../packages/fetch/examples/users-crud) | §1.3（`refreshList` command で再取得）/ §1.4（response はエラーでも発火 → status で成功判定）/ §1.5（空 url の detail 抑止） |
| [`infinite-scroll`](../packages/fetch/examples/infinite-scroll) | §1.2/§1.4（append は status 判定）/ §2.1（センチネルは box 必須・初回 task で発火） |
| [`state-intersect-scroll`](../examples/state-intersect-scroll) | §2.2+§2.3（reobserve で自己修復）/ §3（`$stream` restart と同値 page 選択で page-skip 防止） |
| [`router-auth`](../examples/router-auth) | §4.4（ログアウトの `trigger` をセッションを消すより先に書くので、要求が `Authorization` ヘッダを運ぶ） |

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

→ **帰結**: *イベント*は届かないが**値は届く**。本ノードの観測可能プロパティはすべて output-only（`properties` のみ・`inputs` に無い）なので、既定の binding authority が `element` になり、バインドは確立時にプロパティを直接読む（directional initial sync、v1.21.0 で既定 ON。`BindingSession.readProducerSnapshot` / `initialSync.ts` の `hasOutput && !hasInput ? "element" : "state"`）。したがって初期値（`portrait`/`landscape`/`type`/`angle`）は手動 pull なしで初回描画から正しい。これは screen-orientation 固有ではなく全 monitor 系ノード共通。実ブラウザ回帰は `e2e/tests/monitor-initial-snapshot.spec.ts`。

`enableDirectionalInitialSync: false` に倒した構成でのみ、旧 idiom（`$connectedCallback` + `customElements.whenDefined` + プロパティ pull）が再び必要になる。

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

## 8. @wcstack/tilt — `requestPermission()`・`change`・`heading` の発火契約

参照: [`packages/tilt/src/core/TiltCore.ts`](../packages/tilt/src/core/TiltCore.ts)、[`README`](../packages/tilt/README.md)、[device-orientation-tag-design.md](./device-orientation-tag-design.md)

### 8.1 `connectedCallback` は購読しない — screen-orientation §7.1 の「初回スナップショット消失」はここでは起きない
`observe()` は `_ready`（`Promise.resolve()` 固定）を返し、何も購読しない——`deviceorientation` も `deviceorientationabsolute` も——し、現在値の読み出しもしない（§6 決定 4）。4.25 からすることは 1 つだけ: `supported` が最後に dispatch した値（初めは `false`）と違うとき、同期的に `wcs-tilt:supported-changed` を dispatch する。後から張られる data-wcs バインドはこのイベントを取りこぼし、代わりにプロパティを読む（§7.1）。`supported` は読まれるたびに計算する（§8.6）。`screen.orientation` と異なり Device Orientation には同期的に読める「現在値」がそもそも存在しない（値はイベント経由でしか手に入らない）ため、screen-orientation §7.1 が抱える「`connectedCallback` 中の同期 dispatch が、まだ張られていない data-wcs リスナーに届かず消える」という問題は構造的に発生しない。`start()` を呼ぶまで `wcs-tilt:change` は一切飛ばない。

→ **帰結**: 初期値を気にする必要が無い。`start()` は必ず `requestPermission()` の後（多くは利用者の gesture ハンドラの中）で呼ばれるため、その頃には `@wcstack/state` の data-wcs バインドは（§4.1 の別 microtask を経て）確立済みなのが通常のフローであり、screen-orientation の README Quick Start（§7.1）のような `$connectedCallback` 経由の pull 対応は不要（tilt 自身の README にこのパターンは存在しない）。

### 8.2 `requestPermission()` の post-await 書き込みは benign — `_gen` を持たない
`requestPermission()` は async（`await Ctor.requestPermission()`）だが、`start`/`stop` と異なり `_gen`/`AbortController` を一切使わない。post-await の書き込み先は `permissionState`/`error` という単純なプロパティ設定＋dispatch のみで、購読やコールバック登録のような「生存管理が必要なリソース」を作らない。要素が disconnect 済みでも、この書き込みは新しい購読を復活させたり二重登録を起こしたりしない——誰も購読していなければ `dispatchEvent` は無害に空振りするだけである（`<wcs-idle>` の `requestPermission()` と同型、[idle-detection-tag-design.md](./idle-detection-tag-design.md) §4.1）。4.25 から、reject が書くのは `error` だけである: `permissionState` は promise が resolve したときにだけ書かれ（`"granted"`、それ以外の値は `"denied"`）、コマンドはその時点の `permissionState` で resolve する（§8.4）。

→ **帰結**: `requestPermission()` を連続で呼んだ場合（通常は gesture 制約で起こりにくいが）、`_gen` によるスーパーシードが無いため「呼び出し順」ではなく「resolve した順」で `permissionState`/`error` が確定する。ブラウザの許可ダイアログは初回以降キャッシュされた結果を即座に返すため、実務上この順序の入れ替わりが可視化されることはほぼ無い。

### 8.3 `wcs-tilt:change` は同値ガード（`alpha`/`beta`/`gamma`/`absolute` の4フィールド一致判定）
`_apply` は新しい `deviceorientation` イベントの4フィールドすべてが直前のスナップショットと一致する場合は dispatch をスキップする（§3.3 MUST）。一致判定は `===`（`null` 同士も一致）。

→ **帰結**: デバイスが静止している間、ネイティブの `deviceorientation` は高頻度で発火し続けてもプラットフォームによっては同一値が続くことがあるが、`wcs-tilt:change` は値が実際に変わったときだけ届く。

### 8.4 `wcs-tilt:error` は同値ガード（`===` 参照比較）— 成功 settle は必ず `null` にクリア
`_setError` は `this._error === error` のときは再 dispatch しない。`requestPermission()` の reject（gesture 文脈外呼び出し等）は catch のたびに新しいオブジェクトリテラル（`{ error: e }`）を作るため参照が毎回変わり、失敗のたびに発火する。例外は、`DeviceOrientationEvent` そのものが無いブラウザのための合成の失敗である（4.25、§8.6）: `requestPermission()` と `start()` はモジュールスコープの定数 1 つ（`{ error: { name: "unsupported", message } }`、`errorInfo.code: "capability-missing"`）を渡すので、何度呼んでも発火は 1 回だけになる——§7.4 と同じ形。一方、例外なく settle した呼び出し（granted / 素の denied / 非 gating 環境の即時 granted）は catch を経ないため、`_setError(null)` を無条件に先に呼ぶ——直前が非 null なら `wcs-tilt:error(null)` が飛び、直前がすでに null ならガードに掛かり dispatch しない。

→ **帰結**: `error` に古い失敗が残ったまま `permissionState` だけ更新される、という不整合は起きない——settle 成功は必ず先に `error` をクリアしてから `permissionState` を更新する（`TiltCore.requestPermission()` 内の呼び出し順）。4.25 からは逆も起きない: reject は `permissionState` を変えない。iOS はタップの外からの呼び出しを、質問を出さずに `NotAllowedError` で reject する。これは質問を出せなかったのであって、利用者の拒否ではない（`errorInfo`: `not-allowed`、`recoverable: true`——タップからの呼び出しなら許可されうる）。したがって `permissionState: "denied"` は、必ずブラウザがそう答えたことを意味する。4.24 までは reject が `"denied"` にしていたため、ページは、聞かれてもいない利用者に「拒否しました」と告げていた（継ぎ目アプリ `stamp-rally` が見つけた、2026-11-17、[seam-apps.ja.md](./seam-apps.ja.md)）。

### 8.5 `wcs-tilt:heading-changed` は独立したイベントで、同値ガードあり（4.25）
`heading`——端末の上端が向いている方角を北からの時計回りの度数で表した値、分かるまでは `null`——は、ネイティブイベントごとに次の順で書かれる: 有限の数の `webkitCompassHeading` を持つ `deviceorientation` イベント（iOS Safari。そこでは `alpha` は相対値）→ その数。`deviceorientationabsolute` イベント（Android Chrome。そこでは `deviceorientation` は相対値）、または `absolute === true` の `deviceorientation` イベントで、`alpha` が有限の数 → `(360 - alpha) % 360`。それ以外のイベントは `heading` を変えない。`start()` は `"ondeviceorientationabsolute" in window` のとき `deviceorientationabsolute` も購読し、`stop()` / `dispose()` は両方の listener を外す。absolute のイベントが書くのは `heading` だけで——`alpha`/`beta`/`gamma`/`absolute` は決して書かない——`wcs-tilt:change` も dispatch しない。`deviceorientation` イベントでは `wcs-tilt:change`、次に `wcs-tilt:heading-changed` の順になる。`_setHeading` は値が直前と `===` のとき dispatch をスキップする。

→ **帰結**: 北を運ぶイベントが新しい角度を運ぶとは限らず、逆も同じなので、2 つの出力は 2 つのイベントを持ち、`heading` のバインドは傾きが変わるたびに再評価されない。`stop()` と disconnect は `heading` とスナップショットを最後の値のまま残すので、§22 が publish するものは無い。要素は `heading` を画面の回転についても傾きについても補正しない（tilt README「コンパス」）。

### 8.6 `DeviceOrientationEvent` が無いことは「granted」ではない — そして `supported`（4.25）
`typeof DeviceOrientationEvent !== "function"` の環境（一部のデスクトップブラウザ、Windows 上の Playwright の WebKit）では、`start()` は共有の `unsupported` エラー（§8.4。`errorInfo`: `capability-missing`、phase `probe`、recoverable でない）をセットし、何も購読せず、再開可能なままにする——後の `start()` はもう一度判定する。そこでの `requestPermission()` は同じエラーをセットし、変わっていない `permissionState` で resolve する。4.24 までは、そこで `"granted"` と答え、`start()` は来るはずのないイベントをエラーも無く待っていた。クラスはあるが `requestPermission` が無い環境（Android、デスクトップ）が即 `"granted"` になるのは変わらない。`start()` は `permissionState` を確かめず、`error` もクリアしない。

`supported` は、`typeof DeviceOrientationEvent === "function"` で、かつ `featureUnavailable("accelerometer")` も `featureUnavailable("gyroscope")` も理由を返さない（安全でないコンテキスト、または Chromium が `deviceorientation` を送らなくなる Permissions-Policy）ことである。読まれるたびに計算し、キャッシュしない。`publishSupported()`——`observe()` が呼ぶので connect 時に走る——は、値が最後に dispatch したものと違うときだけ `wcs-tilt:supported-changed` を dispatch する。

→ **帰結**: `supported: false` は、値が決して来ず、タップしても変わらないことを意味する。`supported: true` は端末にセンサーがあるとは言わない: PC には API があってセンサーが無く（そこでの Chromium は角度が `null` のイベントを 1 回出し、その後は何も出さない）、ページがそれを知る方法は待つことだけである。

---

## 9. Generic Sensor 4兄弟（accelerometer / gyroscope / magnetometer / ambient-light-sensor）— `reading` と `error` の発火契約

参照: [`packages/accelerometer/src/core/AccelerometerCore.ts`](../packages/accelerometer/src/core/AccelerometerCore.ts)（4兄弟は同型。gyroscope / magnetometer / ambient-light-sensor も同じ契約）、[sensor-tag-design.md](./sensor-tag-design.md)

4兄弟は `Sensor` の経路を Core / Shell とも完全に共有する。そこでの差分は観測値の形（x/y/z の3軸 vs ambient-light-sensor の `illuminance` 単一スカラー）のみ。4.25 から、accelerometer と gyroscope にはそれに加えて `devicemotion` のフォールバック（§9.6）と、`requestPermission()` コマンド・`permissionState` 出力（§9.7）がある。magnetometer と ambient-light-sensor には無い。`supported`（§9.8）は4兄弟すべてが持つ。

### 9.1 connect では何も始まらない — `start` コマンドを発火するまで完全に不活性
Shell の `connectedCallback` は `observe()` を呼ばない（`display: none` の設定、SSR 用 promise の張り替え、そして 4.25 から `publishSupported()` の呼び出し。sensor-tag-design.md §1.3）。バインドしただけでは `x`/`y`/`z`（`illuminance`）は初期値 `null` のままで、`wcs-*:reading` は一切飛ばない。screen-orientation §7.1 の「初回スナップショット消失」は読み取りについては発生しない（connect 時に dispatch する読み取りが無い）。connect が dispatch しうるイベントは `wcs-*:supported-changed` だけで、後から張られるバインドはプロパティを読んでそれを補う（§9.8）。`disconnectedCallback` は `dispose()`（= `stop()`。フォールバックでは `devicemotion` の購読解除）を呼ぶため、**要素の reparent はセンサー停止を意味し、自動再開はない**——再度 `start` を発火するまで値は最終サンプルで凍結する。

→ **帰結**: tilt §8.1 と同じ理由で `$connectedCallback` 経由の pull 対応は不要。`start` は通常 `requestPermission` 系の gesture フローの後に発火されるため、その時点で data-wcs バインドは確立済み。

### 9.2 `reading` は同値ガード**なし**（毎サンプル発火）/ `error` は同値ガード**あり**（name＋message 複合キー）
`reading` はイベント性（毎回新しいサンプル）であり、値がたまたま同一でも**毎回** dispatch する（sensor-tag-design.md §1.1）。`x`/`y`/`z` は単一の `wcs-*:reading` イベントからの派生 getter（1回のネイティブ `reading` で全軸が同時更新）。一方 `error` は状態性であり、`_setError` は「`error`（name）と `message` の**両方**が直前と一致」する場合のみ再 dispatch を抑止する——name だけ違う・message だけ違う場合はどちらも再 dispatch される。`devicemotion` のフォールバック（§9.6）では、値を持ち `frequency` の間引きを通ったイベントごとに `wcs-*:reading` が飛ぶ——こちらも同値ガードは無い。

### 9.3 `error` は sticky — 成功した (再)start / reading 受信ではクリアされない
screen-orientation の `lock()` が成功時に `_setError(null)` するのと異なり、監視系センサー4兄弟は `start()` の成功パスで `error` を**書き換えない**。失敗（`unsupported` / コンストラクタの `SecurityError` 等）→ リトライ成功のあとも直前の `error` は残り続ける（各 README「注意・制限」）。クリア・再解釈は利用側 state の責務。4.25 から、`null` を書く経路が 1 つだけある（accelerometer と gyroscope のみ）: `requestPermission()` は、ブラウザが答えたとき（granted / denied / 聞くことの無い環境の即時 granted）に `_setError(null)` を呼ぶ（tilt §8.4 と同じ）——質問を出せなかったことの `error` が、許可されたタップの後まで残らないようにするためである。reject は `error` をセットし、`permissionState` は変えない（§9.7）。`start()` と reading がクリアしないことは変わらない。

### 9.4 `_gen` 無し・全パス同期・never-throw の3点セット
`start()`/`stop()` は同期的な購読/購読解除のトグルで、非同期 probe が存在しないため `_gen` 世代ガードは不要（sensor-tag-design.md §1.5、network §5 と同根拠）。await する呼び出しは accelerometer / gyroscope の `requestPermission()` だけで（4.25）、その post-await 書き込みは §8.2 と同じ benign な値設定であり、そこにも `_gen` は無い。never-throw の担い方は4経路: ① API 不在——クラスが無く、accelerometer / gyroscope では `DeviceMotionEvent` も無い——→ `{ error: "unsupported", ... }`、② コンストラクタの同期例外（権限拒否・Permissions-Policy ブロック）→ catch して `error` へ、③ 非準拠実装の `sensor.start()` 同期 throw → catch して **teardown**（失敗インスタンスの listener を外し `_sensor` を null 復帰）した上で `error` へ——teardown により次の `start()` は新しいセンサーで再試行できる、④ 4.25 から、センサー自身の `error` イベント: `_onError` は `error` を publish する**前に**同じ teardown を行うので、次の `start()`——`wcs-*:error` の listener の中から呼ばれたものも——は新しいセンサーを作る。4.24 までは失敗したセンサーが `_sensor` に残り、`start()` は `stop()` を呼ぶまで no-op で、それを知らせるものも無かった。teardown が `_sensor` をクリアするのは、それがまだそのセンサーであるときだけである: 非準拠実装の `sensor.start()` がまだ走っている間に、`error` の listener が新しいセンサーを開始していることがありうる。`start()` は稼働中は冪等（二重生成しない）で、`frequency` は `start()` 時にのみ読まれる。4.25 から、`frequency` 属性があり、空白でなく、正の有限数でもないとき、Shell は `start()` で要素ごとに 1 回警告する（`[wcs/frequency-invalid]`）。開始はブラウザの既定の頻度で続く（これまでは何も言わずにそうしていた）。

### 9.5 `error` イベントの message フォールバックは定数 `"Sensor error"`
ネイティブ `error` イベントが `error` フィールドを持たない場合、`{ error: "error", message: "Sensor error" }` に正規化する（`String(undefined)` 由来の文字列 `"undefined"` を格納しない）。4兄弟で同一文言。

### 9.6 accelerometer / gyroscope: `devicemotion` のフォールバックは `start()` のたびに選ぶ（4.25）
iPhone / iPad の Safari には Generic Sensor のクラスが無く、同じデータが `devicemotion` として存在する。`start()` は毎回判定する: クラス（`Accelerometer` / `Gyroscope`）が関数ならそれ——上記の経路そのまま。そうでなく `DeviceMotionEvent` が関数なら `window` の `devicemotion`。どちらでもなければ `unsupported` エラー。判定はキャッシュしない: `stop()` の後の `start()` はもう一度判定する。フォールバックでも `start()` は冪等で、`stop()` / `dispose()` は購読を外す。

フォールバックでの読み取りは、同じ `wcs-*:reading` イベントで publish される: accelerometer はイベントの `accelerationIncludingGravity`（`x`/`y`/`z`、m/s²）、gyroscope は `rotationRate` を度/秒から換算したもの（`x = beta·π/180`、`y = gamma·π/180`、`z = alpha·π/180`。端末の x / y / z 軸まわりの rad/s）。オブジェクトが `null` のイベント、または 3 つの値のどれかが有限の数でないイベントは読み飛ばす——センサーの無い PC がそういうイベントを出す。`devicemotion` の頻度はブラウザのものなので、`frequency` は頻度を決める代わりに間引く: 正の `frequency` があるとき、最後に **publish した**イベントから `timeStamp` で `1000 / frequency` ms 経たないイベントは落とす。読み飛ばしたイベントはその基準を動かさず、`start()` のたびに基準は新しくなる。`frequency` が無ければ、値のあるイベントはすべて publish する。

→ **帰結**: フォールバックに失敗の経路は無い——`devicemotion` はエラーを知らせず、センサーの無い端末は何も送らないだけ——ので、そこでの `error` は `requestPermission()`（§9.7）からしか来ない。`unsupported` を「センサーが無い」と読んでいたページは、`DeviceMotionEvent` があってセンサーの無いブラウザ（デスクトップの Firefox）ではそれを受け取らなくなる: 何も届かず、何も知らされない。フォールバックでの各軸の符号は実機で確かめていない（README にその旨を書いている）。

### 9.7 accelerometer / gyroscope: `requestPermission()` が `permissionState` を書くのは、ブラウザが答えたときだけ（4.25）
`permissionState` は `"granted"` / `"denied"` / `"unknown"`（初期値 `"unknown"`）で、`wcs-accelerometer:permission-changed` / `wcs-gyroscope:permission-changed` で publish され、同値ガードされる。これは iOS の `DeviceMotionEvent.requestPermission()` への答えであり、それ以外の何でもない: この答えを知らせる Permissions API のエントリは無く、Generic Sensor 自身の許可は `<wcs-permission name="accelerometer">` / `"gyroscope"` の担当のままである。`requestPermission()` は async で、reject しない。呼び出しの後の `permissionState` で resolve する。結果は次のとおり:

| どこで | すること | `permissionState` | `error` |
|---|---|---|---|
| 要素がフォールバックを使い、`DeviceMotionEvent.requestPermission` が関数（iPhone / iPad の Safari）——promise が `"granted"` で resolve | それを呼ぶ | `"granted"` | `null` にクリア |
| 同上——それ以外の値で resolve | それを呼ぶ | `"denied"` | `null` にクリア |
| 同上——reject（iOS は、呼び出しがタップの中でないとき、質問を出さずに `NotAllowedError` で reject する） | それを呼ぶ | 変えない | `{ error: <name>, message }`。`errorInfo`: `not-allowed`、phase `start`、`recoverable: true` |
| Generic Sensor のクラスがある、または `DeviceMotionEvent` はあるが `requestPermission` が無い（Chromium、Android の Firefox） | 何も呼ばない——質問が無い | 同期的に即 `"granted"` | `null` にクリア |
| どちらの API も無い | 何も呼ばない | 変えない | `{ error: "unsupported", ... }`。`errorInfo`: `capability-missing` |

それ以外の name の reject は、いつもどおり兄弟共通の taxonomy を通る——通常は `sensor-error`（phase `execute`、recoverable でない）。`start()` は `permissionState` を確かめない: すぐに購読し、iOS では利用者が許可してから読み取りが届き始める。tilt（§8.2）と同じく、post-await 書き込みは `_gen` を持たない単純な値設定なので、連続で呼ぶと resolve した順に確定する。

→ **帰結**: `permissionState: "denied"` は、利用者（または利用者に代わってブラウザ）がそう答えたことを意味する。質問を出せなかった場合は元の値のままで、`recoverable: true` と言う——同じ呼び出しをタップから行えば許可されうるからである。`<wcs-tilt>` の質問（`DeviceOrientationEvent.requestPermission()`）は別のメソッドなので、両方の要素を使うページは 1 つのタップのハンドラの中で両方のコマンドを呼ぶ。ページの読み込みをまたいで覚えるものは無い: 再読み込みの後、`permissionState` はまた `"unknown"` である。

### 9.8 `supported` は読まれるたびに計算し、connect で publish する（4.25）
`supported` は、このページでその機能を使える——API があり、ページがその使用を禁じられていない——ことを表し、4兄弟すべてが持つ: accelerometer は（`Accelerometer` か `DeviceMotionEvent` が関数）かつ `featureUnavailable("accelerometer") === null`、gyroscope は（`Gyroscope` か `DeviceMotionEvent`）かつ `"gyroscope"`、magnetometer は `Magnetometer` かつ `"magnetometer"`、ambient-light-sensor は `AmbientLightSensor` かつ `"ambient-light-sensor"`。`featureUnavailable` が理由を返すのは、安全でないコンテキストと、機能を切る Permissions-Policy（ページが自分のポリシーを読めるブラウザで）である。getter はキャッシュしない。Shell の `connectedCallback` が呼ぶ `publishSupported()` は、値が最後に dispatch したもの（初めは `false`）と違うときだけ `wcs-*:supported-changed` を dispatch する。

→ **帰結**: バインドは張られた時点で正しい値を読み（§7.1）、再接続は値が変わっていなければ何も dispatch しない。`supported: true` は、センサーがあることも、利用者が許可することも言わない。magnetometer と ambient-light-sensor にはフォールバックが無いので、iPhone では `supported: false` である。

---

## 10. @wcstack/network — 監視の発火契約

参照: [`packages/network/src/core/NetworkCore.ts`](../packages/network/src/core/NetworkCore.ts)、[`README`](../packages/network/README.md)、[network-tag-design.md](./network-tag-design.md)

### 10.1 初回スナップショットは connect 中に同期発火し、data-wcs バインドには届かない（screen-orientation §7.1 と同型）
Shell の `connectedCallback` は `observe()` を呼び、`observe()` は購読と同時に `navigator.connection` を同期的に読んで、既定スナップショット（全フィールド null / `supported: false`）と異なれば即座に `wcs-network:change` を dispatch する。対応環境では `supported` が false→true になるため**必ず**この初回 dispatch が起きるが、§4.1 の通り data-wcs のリスナー取り付けは別 microtask なので誰にも届かない。

→ **帰結**: *イベント*は届かないが**値は届く**。observable プロパティが全て output-only なので既定 authority は `element` で、バインドは確立時にプロパティを直接読む（§7.1 と同じ機序）。手動 pull は不要。

### 10.2 非対応環境（Firefox/Safari）では `change` は一度も飛ばない
`navigator.connection` 不在時、`observe()` の初回読み取りは既定と同一参照の `UNSUPPORTED_SNAPSHOT` を返し、同値ガードに掛かって dispatch されない。以降も購読対象が無いため `wcs-network:change` は一切発火しない——`supported` の判定はイベント待ちではなく**バインド確立時のプロパティ読み取り**が担う（10.1 と同じ機序）。対応環境でも `supported` は connect 時に一度確定したきり再発火しないため、このプロパティ読み取りが唯一の到達経路になる（回帰: `e2e/tests/monitor-initial-snapshot.spec.ts`）。

### 10.3 `change` は5フィールド全一致の同値ガード付き / `observe()` は冪等 / `_gen` 無し
`_apply` は `effectiveType`/`downlink`/`rtt`/`saveData`/`supported` の5フィールドを個別比較し、全一致なら dispatch しない（ネイティブ `change` の二重発火に対する多層防御）。`observe()` は `_subscribed` フラグで冪等（二重リスナー無し）、`dispose()` がフラグを戻すので dispose→observe で復活する（復活時は再読み取りが走る）。購読は完全同期のため `_gen` は持たない（network-tag-design.md §5）。pure monitor（`commands: []`）でコマンド面は存在しない。

---

## 11. @wcstack/permission — 監視の発火契約

参照: [`packages/permission/src/core/PermissionCore.ts`](../packages/permission/src/core/PermissionCore.ts)、[`README`](../packages/permission/README.md)

### 11.1 pure monitor（`commands: []`）— `state` と、そのイベントからの派生 getter 4値。`unsupportedReason` は専用のイベントを持つ
`granted` / `denied` / `prompt` / `unsupported` はすべて単一の `wcs-permission:change` イベントからの派生 getter（detail は `state` の生値）。`_setState` は同値ガード付きで、`state` が実際に変わったときだけ1回 dispatch する — 派生4値は `state` とロックステップで変わるため、これでこの5つのプロパティの通知が揃う。4.25 からは6つ目の出力 `unsupportedReason` があり、`state` が `"unsupported"` である理由を言う。専用のイベントを持つので、理由だけが変わったときに `state` のバインドは再評価されない（§11.5）。

### 11.2 対応環境の初回確定は `query()` の resolve 時（非同期）/ unsupported の一部だけが connect 中の同期 dispatch
対応環境では `observe(descriptor)` が `navigator.permissions.query()` を発行し、初回の `change` は query の resolve 時に飛ぶ（connect 中の同期 dispatch ではない。ただし resolve と data-wcs バインド確立（§4.1 の別 microtask）の順序自体は保証されない）。一方 **API 不在または descriptor `name` 欠落**のときは、初期値 `"prompt"` → `"unsupported"` の遷移が `connectedCallback` 中に**同期**で dispatch され、§7.1 と同型で data-wcs には届かない（query の reject 由来の `"unsupported"` は resolve 時＝非同期）。

→ **帰結**: `unsupported` の判定はイベント待ちではなく**バインド確立時のプロパティ読み取り**が担う（network §10.2 と同じ機序。`state` / `granted` / `denied` / `prompt` / `unsupported` はすべて output-only なので既定 authority が `element`）。

### 11.3 `observe()` は購読中 no-op — descriptor を差し替えても再クエリしない
購読確立後の `observe()` は保存 descriptor を更新するだけで、**別の `name` を渡しても再クエリしない**（v1 の Shell は connect 時の descriptor で固定）。permission を切り替えるには `dispose()` してから新しい descriptor で `observe()` する。

### 11.4 `_permGen` — query ごと＋`dispose()` で bump（stale query は listener を張らない）
in-flight の query は捕捉した世代が古くなっていたら resolve 時に bail する（listener を張らず状態も書かない）。高速 disconnect→reconnect で先行 query が後から resolve しても、現行購読だけが listener を持つ。購読中はライブの `PermissionStatus` の `change`（ブラウザ設定での grant 切替）が流れ込み続ける。

### 11.5 `unsupportedReason` は先に出て、その時点で両方の値が揃っている（4.25）
継ぎ目アプリ `stamp-rally` が必要を見つけた（2026-11-17、[seam-apps.ja.md](./seam-apps.ja.md)）。`"unsupported"` は 4 つの状況を畳んでいる — Permissions-Policy がこのページでその機能を切っている（`"policy-blocked"`）、コンテキストが安全でない（`"insecure-context"`）、ブラウザに `navigator.permissions.query` が無い（`"no-permissions-api"`）、ブラウザが名前を拒否した・または `name` が空（`"unknown-name"`） — が、ページはそのどれなのかを利用者に伝えられなかった。`unsupportedReason` は、`state` が `"unsupported"` の間はこの 4 つのどれかで、それ以外では `null` である。`_setState(state, reason)` は何かを dispatch する前に両方のフィールドを書き、その後で `wcs-permission:unsupported-reason-changed`（detail は理由。理由が変わったとき）、続けて `wcs-permission:change`（state が変わったとき）を dispatch する。同値ガードはそれぞれにある。state が `"unsupported"` のまま理由だけが変わったとき（空の `name` での `observe()` の後、ポリシーに切られた名前での `observe()`）は、理由のイベントだけが出る。stale な query（§11.4）はどちらも書かない。

→ **帰結**: どちらのイベントのハンドラも、どちらの出力のバインドも、つじつまの合った組を読む — 理由が `null` の `"unsupported"` も、`"granted"` の横に残った理由も見えない。ほかの 5 つと同じく `unsupportedReason` は output-only なので、バインドは確立時にプロパティを読む（§11.2）。`"no-permissions-api"` と `"unknown-name"` は「ブラウザが答えられない」であって、機能が無いという意味ではない。ページのポリシーに聞いてもログは出ない: ブラウザのポリシーが挙げていない名前（`features()`）は聞かない — 聞けば Chromium は `Unrecognized feature` を出す。単体テストは、両方のイベントの時点での順序と組を確かめる（`packages/permission/__tests__/permissionCore.test.ts`）。実ブラウザでは `e2e/tests/io-screen-sensors.spec.ts` が、Chromium・Firefox・WebKit で `unknown-name` を読む。

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

### 13.4 `dispose()` は `_loading` を戻す（4.5 からはイベント付き）
`dispose()` は3世代を全部 bump し、`_loading` を false に戻す。bail した in-flight コールバックはもう loading をクリアしないため、放置すると reconnect 後の次の取得で loading=true エッジが同値ガードに食われる — それを防ぐためのリセット。4.4 までは **dispatch しない**無音のリセットで、ルートが戻ってきたページの state に `loading: true` が残った。4.5 からは知らせる（§22）。

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
`active` は `wcs-fullscreen:change` / `wcs-pointer-lock:change` / `wcs-pip:change` で知らせる。各インスタンスは「何かが fullscreen / lock / PiP 中か」ではなく「**自分の** resolved target がそれか」を判定するため、複数インスタンス並存でも正しく分かれる（fullscreen-tag-design.md §2.1）。detail 形状は fullscreen / PiP が `{ active }`＋getter、pointer-lock は素の boolean（既知の族設計差）。

### 16.2 `error` / `errorInfo` は bindable（イベント付き・参照で同値ガード）— 3ノード共通
どちらも `wcBindable.properties` に宣言されている（`semantics: "state"`）: `wcs-fullscreen:error` / `wcs-fullscreen:error-info-changed`、`wcs-pointer-lock:error` / `wcs-pointer-lock:error-info-changed`、`wcs-pip:error` / `wcs-pip:error-info-changed`。`_setError` は参照でガードする（失敗は毎回新しいオブジェクト、クリアはリテラルの `null` を渡すので、落ちるのは余分な `null` → `null` だけ）。`errorInfo` を確定して `…:error-info-changed` を先に、続いて `…:error` を dispatch する。成功した request / exit は両方を `null` に戻す。バインドしてもよく（`error: fsError; errorInfo: fsErrorInfo`）、コマンドの promise settle 後に要素から読んでもよい — ただしイベントで届く拒否（§16.7）は、その後に届く。（本節は 2026-11-17 まで「`error` は pull-only でイベント無し」と書いていた。コードと3ノードの README は、すでに両方を bindable にしていた。）

### 16.3 購読場所: fullscreen / pointer-lock は document、PiP は `<video>` 自身
fullscreen は `fullscreenchange`（webkit fallback あり）、pointer-lock は `pointerlockchange`（同）を document に張る。PiP は `enterpictureinpicture` / `leavepictureinpicture` を resolved `<video>` に張り、target 変更時に re-wire する。PiP は `requestPictureInPicture()` 自体も呼び出し時に `observe(element)` で re-wire する（connect 時に未解決だった後発 `<video>` でも `active` が追従する）。

### 16.4 connect 時の初回発火は「既に active な状態で（再）接続した場合」だけ起きる
connect 時の `observe()` / target 解決は `active` を再導出するが、通常は false→false で同値ガードに掛かり dispatch は無い。既に fullscreen / lock / PiP 中の要素を指した状態で（再）接続した場合に限り connect 中の同期 dispatch が起き、§7.1 と同じ理由で data-wcs には届かない。request 系 API が user gesture 必須のため、実務でこの状況になるのは主に reparent 時。4.25 からは、active 中に切断した後の普通の経路になる（§16.6）。state がすでにバインドしていて戻ってきた要素（ルートのノード、移動された要素）は、その `true` をイベントで届ける。初めてバインドされる要素は、バインド時に読まれる。

### 16.5 async コマンドは `_gen` 後勝ち / exit 系の no-op チェックは bump より先 / pointer-lock の exit は同期
`requestFullscreen()` / `requestPictureInPicture()` は呼び出しごとに `_gen` を bump＋capture する（screen-orientation §7.2 と同じ後勝ち。`dispose()` も bump）。`exitFullscreen()` / `exitPictureInPicture()` は「既に非 active」「API 不在」の silent no-op 判定を **`_gen` bump より先**に行う — 何もしない呼び出しが in-flight の request を stale 化してその error / active 更新を握りつぶさないため。pointer-lock の `exitPointerLock()` は同期 platform API（`void` 返し）なので `_gen` を持たず、防御的 try/catch のみ。4.25 から、promise を返さない呼び出しで出した request（Firefox の `requestPointerLock()`、接頭辞付きの fullscreen API）は await しない。呼び出しの中で同期的に `error` をクリアして `active` を再導出し、その後は document のイベントを待つ（§16.7）。実際に走った `exitFullscreen()`（no-op でないもの）は、pending の promise を stale にするのと同じく、待っている request も捨てる。

### 16.6 切断は `active: false` を知らせ、再接続は本当の値を読む（4.25）
継ぎ目アプリ `stamp-rally` が見つけた（2026-11-17、[seam-apps.ja.md](./seam-apps.ja.md)）。`dispose()` はリスナー（fullscreen / pointer-lock は document、PiP は `<video>`）を外し、その後で通常の setter を通して `active` を `false` にする。`true` だったときは変化のイベントが出る。文書の外にある要素には何も聞こえず、その値をもう保証できないからである。これまでは、target が要素と一緒に去ってブラウザが fullscreen や lock を終わらせても、誰もそれを知らせず、state は `true` のままだった。切断は何も exit しない。`connectedCallback` は target を解決し直して `active` を再導出し、target がまだ active なら `true` を知らせる。移動された要素（ここには `connectedMoveCallback` が無い。target は要素のある場所で決まる）は `false`、`true` の順に知らせる。active でないときの切断は何も出さない。

### 16.7 イベントで届く拒否は `error` を立てる — promise の無い request に限る（4.25）
購読中、fullscreen は `fullscreenerror`（`onfullscreenerror` が無ければ `webkitfullscreenerror`）を、pointer-lock は `pointerlockerror`（同じく `webkitpointerlockerror`）を聞く。request は、platform の呼び出しが promise を返したかを覚えておく。返したものには、その promise だけが答える。Chromium と WebKit は同じ拒否についてイベントも発火し、WebKit は非同期に断るとき reject より先に発火する（`WrongDocumentError: Pointer lock requires the window to have focus.`）。理由を持っているのは reject の例外のほうである。何も返さなかったもの — Firefox の `requestPointerLock()`、接頭辞付きの fullscreen API — は document を待つ。インスタンスを active にする change イベントが待ちを終わらせ、error イベントは `error` を `new DOMException("The browser refused the … request.", "NotAllowedError")` にする（`not-allowed`、`recoverable: true`。イベントは理由を運ばない）。こうして 1 つの拒否は、どのブラウザでも 1 回だけ報告される。このインスタンスの request が待っていないときの error イベントは別のインスタンスのもので、無視する。後から出した request、`dispose()`、（fullscreen では）実際に走った exit は、待っている request を捨てる。この error はコマンドの promise が settle した後に届く。PiP にはこのイベントが無い。

### 16.8 `supported` は読むたびに計算し、connect 時に知らせる（4.25）
`supported`（`wcs-fullscreen:supported-changed` / `wcs-pointer-lock:supported-changed` / `wcs-pip:supported-changed`、`detail` は boolean そのもの）は、読むたびにブラウザを調べる getter である。`observe()` は、最後に dispatch した値（初期値 `false`）と違うときにイベントを dispatch する。fullscreen: Permissions-Policy が禁じておらず、`document.fullscreenEnabled ?? document.webkitFullscreenEnabled` が `true` で、`Element.prototype` に `requestFullscreen` / `webkitRequestFullscreen` がある。PiP: ポリシーが禁じておらず、`document.pictureInPictureEnabled === true` で、`HTMLVideoElement.prototype.requestPictureInPicture` がある。pointer-lock: `Element.prototype` に `requestPointerLock` / `webkitRequestPointerLock` がある（これを扱うポリシーは無い）。ブラウザがポリシーを公開している場合（Chromium）は、`fullscreenEnabled` / `pictureInPictureEnabled` を読む前にポリシーに聞く。WebKit と Firefox は公開しておらず、WebKit は禁じられたフレームで `fullscreenEnabled` を読むたびにコンソールへエラーを出す。fullscreen も Picture-in-Picture も安全なコンテキストを要らないので、安全でないコンテキストであることだけでは `false` にならない。

## 17. 横断契約: カスタム状態（CustomStateSet / `:state()`）は「最後に発火したイベントの同期写像」

対象: 全 I/O ノード。正本設計は `custom-state-reflection-design.ja.md` §3.5、実装規約は guidelines §4.5。

### 17.1 反映は当該イベントの dispatch 中に同期実行される
Shell は constructor（= upgrade 時）で自分自身の `*-changed` / `:error` イベントに反映リスナーを登録し、以後解除しない。登録は **Core 生成（`new Core(this)`）より前**に行う — Core が constructor 内で同期 dispatch する初回イベント（例: speak/listen の `unsupported-changed`）を取りこぼさないため。upgrade 後に `addEventListener` した利用者リスナーからは**常に反映済みの states が見える**（リスナー登録順による）。upgrade 前に登録されたリスナーは反映前に走り得る — この順序は保証しない。

### 17.2 states はプロパティでなくイベントの写像である
同値ガードの有無は各イベント側の契約に従う（例: fetch §1.1 の `loading-changed` は無条件発火だが、`add`/`delete` は冪等なので観測可能な差異はない）。初期状態は全オフ。disconnect / `dispose()` で states は消えない — dispose が状態リセットのイベントを発火するノードでは states も自動追従する。

### 17.3 反映不能環境では静かに無効化される
`attachInternals` 不在（テスト環境 happy-dom を含む）・非ダッシュ状態名を拒む旧 Chromium（<125）では、取得時 probe により反映系全体が no-op になる。機能・イベント・プロパティは一切影響を受けない。`debug-states` 属性ミラー（`data-wcs-state-*`）も同時に無効になる（states の表示であって代替サーフェスではない）。

> **残課題**: monitor 系ノードの契約節は §7〜§16 で全て執筆済み（2026-07-06）。新しい非同期プリミティブタグを足すときは §6 の指針どおり、実装を読み直した上で本書に1節追加すること（実装で確認できない断定を書かない）。

---

## 18. @wcstack/raf — フレーム配送と描画反映の契約（2026-07-10・一部は実測）

対象: `RafCore.start()` のフレームループ、`dt` の正規化、`suspended` 二相、および「rAF 源にすると描画に揃うのか」の実測結果。設計は `raf-tag-design.md`（G1/G2/G3 決定済み）。

### 18.1 `tick` は rAF コールバックで毎フレーム発火（同値ガード無し・reading 型）
時刻源はコールバック引数の `DOMHighResTimeStamp` のみ（`performance.now()` は混ぜない）。detail は `{ count, elapsed, dt, timestamp }` で、`tick`/`elapsed`/`dt` は同一イベントからの派生 getter（guidelines §4.2）。`reset()` の通知 tick は フレームではないため `timestamp = 0`。`running`/`suspended` は同値ガード付き。

### 18.2 `dt` は「連続稼働中のフレーム間隔」のみを表す（G3）
`start()` / `resume()` / `visibilitychange`（両エッジ）で `_lastTs` を破棄し、次に届いたフレームの `dt` は 0。**中断を跨いだ差分は観測者に届かない**。上限クランプはしない — 遅いフレームの扱いは利用側のドメイン判断（迷路デモは `Math.min(dt, 40)` を物理側に置く）。`elapsed` は Σdt なので、この正規化により自動的に「アクティブ時間」になる（segment 簿記は存在しない）。

### 18.3 `running` / `suspended` は desired / actual の二相（§15 wakelock と同型）
非表示タブで rAF は**完全停止**する（setInterval の ~1Hz スロットルと異なる）。`running` は start 済みの意図で、非表示中も true のまま。`suspended` は「running かつ hidden」の導出で、`observe()`（Shell の connect）が購読する `visibilitychange` が駆動する。observe() 前・document 不在環境では常に false。stop/pause は意図が消えるので suspended も即 false。実ブラウザ検証済み: 合成 visibilitychange で `suspended` true/false・`:state(suspended)` の CSS マッチまで確認（headless Chromium）。

### 18.4 【実測】tick 由来の state 書き込みの DOM 反映は「次フレームまで」— ちょうど 1 フレームの描画遅延
測定（headless Chromium・`<wcs-raf>` → `eventToken.tick` → `$on` で counter を加算 → `textContent` バインド）:
- tick の dispatch と同一タスク内（microtask ドレイン後の `setTimeout(0)` 時点）では DOM は**前フレームの値**（100 回中 100 回）。
- 次フレームの rAF コールバック時点では反映済み（100 回中 ≥99）。

つまり `wcs-raf` の tick は vsync に揃うが、`@wcstack/state` の event → `$on` → updater パイプラインを通った描画反映は**ちょうど 1 フレーム遅れる**。updater 自体は `queueMicrotask`（§4 の通り）だが、上流のどこかにタスク境界が存在することを意味する（未特定 — state 側の調査候補。同一フレーム flush にできれば全 I/O ノードのイベント駆動更新から 1 フレームの視覚遅延が消える）。

帰結: (1) これは raf 固有ではなく、event-token / two-way 経由の書き込み一般の特性（旧 `<wcs-timer interval="16">` ループでも同じだった＝raf 移行による退行ではない）。(2) dt ベースの物理・ロジックの正しさには影響しない。視覚遅延 +1 フレーム（~16.7ms）のみ。(3) 検証方法: examples の迷路デモに対する Playwright プローブ（tick リスナーから `setTimeout(0)` で DOM を読む／次フレームで読む）。

---

## 19. @wcstack/audio — 適用時刻と再構築の契約（2026-08-03）

対象: `<wcs-audio>` の値適用がいつ可聴になるか、どの DOM 変更がグラフ再構築を誘発するか。設計は [audio-tag-design.md](./audio-tag-design.md)、根拠は [ADR-14](./architecture-hardening/14-handle-graph-wiring.ja.md)（G4/G5 採択済み）。

### 19.1 外部クロックを持つノードは desired のみ公開し、適用時刻を規定しない（横断契約）

**この節は audio 固有ではなく、独自クロック（オーディオスレッド等）を持つ全ノードに適用する。**

> 入力プロパティへの書き込みは同期に受理され、getter は直ちに新しい値を返す（desired）。**その値が可聴（ないし実効）になる時刻は当該 API のレンダー単位と出力レイテンシに依存し、本契約では規定しない。** 実効値（actual）は公開しない。

§18.4 の raf は「ちょうど 1 フレーム」と実測で固定できたが、audio のレンダークォンタム（128 サンプル）＋ `outputLatency` はハードウェア依存で固定値にできない。したがって「規定しない」ことを契約とする。

帰結:
- 同値ガードは **desired 値**で行う（`param.value` を読み戻さない）。
- パラメータ更新は `setTargetAtTime(v, currentTime, 0.02)` で平滑化する。**この 20ms はクリック音防止のための契約の一部**であり、実装詳細ではない。
- §15 wakelock の desired/actual 二相の**片側だけ**を公開する形（wakelock は actual 側の `held` を公開した。ここは逆）。

### 19.2 rebuild を誘発する DOM 変更は列挙されたものだけ（MUST NOT 拡大）

| 変更 | 反応 |
|---|---|
| 数値属性 / プロパティ（`frequency` `gain` `attack` …） | **live 更新**。発音中のボイスを含む全インスタンスへ適用 |
| 構造属性（`id` `out` `param` `note` `master` `poly`） | **rebuild** |
| audio タグの追加 / 削除 / 移動 | **rebuild** |
| それ以外の DOM 変更 | **何もしない（MUST NOT rebuild）** |

最後の行は装飾ではない。ルートの `MutationObserver` は `subtree: true` で張るが、**変異したノードが audio 要素かどうかで絞り込む**。絞り込まないと、コントロール用の `<div>` を1つ足しただけで発音中の音が切れる（原型 `wcs-synth.js` の実挙動）。

### 19.3 rebuild は可聴な断絶を伴う

グラフ再構築は発音中の全ボイスを破棄する。これは実装上の都合ではなく**契約として明示する**副作用であり、「構造は宣言するものであってアニメーションさせるものではない」という設計意図の裏返しである。

### 19.4 rebuild は microtask で coalesce し、`setPatch` は冪等

- 連続した DOM 編集は1回の再構築に束ねる。task ではなく microtask（§3 の横断契約）。
- `setPatch()` は**トポロジだけを直列化した構造ハッシュ**で rebuild と live 更新を自動判別する。数値はハッシュに含めない。したがって呼び出し側は変更の種類を分類せずいつでもパッチ全体を再投入してよく、変化の無い再投入はコストゼロ（§12.2 resize の冪等 `observe()` と同型）。
- 実際に `setPatch` が呼ばれる経路は2つある（各要素の `connectedCallback` と `MutationObserver` の配送）。構造ハッシュが一致する2回目以降は rebuild しないので、**ノードが作り直されるのは1度だけ**。

### 19.5 `dispose()` は終端ではない

`dispose()` はグラフを破棄し共有 context の `statechange` 購読も外すが、その後の `observe()` / `setPatch()` は作り直す。要素が DOM 内で移動しただけで二度と鳴らなくなるのは受け入れられないため（§11.3 permission の `dispose()` → `observe()` 再開と同型）。

### 19.6 ボイス回収は audio クロック基準（タイマー非依存）

解放済みボイスは `freeAt = noteOff + release * 3 + 0.3`（audio クロック）を過ぎたときにだけ回収する。**wall-clock タイマーは使わない**: バックグラウンドタブでは `setTimeout` が約1分間隔まで絞られる一方オーディオは鳴り続けるため、タイマー方式だと押鍵ごとにボイスが漏れる。

---

## 20. @wcstack/router — route commit 後のフォーカス・告知（2026-08-28）

参照: [`packages/router/src/a11yPolicies.ts`](../packages/router/src/a11yPolicies.ts)、[a11y-design.md](./a11y-design.md) §3-4

### 20.1 オプトインのポリシーは commit 後・mutation の外で走る

`focus="heading"` と `announce="title"` は `applyRoute` の committed 判定直後（guard 通過・mutation 適用済み・`router.path` 更新後）に適用される。告知の書き込みは `mutate()` の外のプレーンな DOM 更新であり、view transition には決して含まれない。guard 拒否されたナビゲーションはどちらのポリシーにも到達しない（a11y-design D4）。

### 20.2 最初のルート適用ではフォーカスも告知もしない

`lastRoutes.length === 0` で両ポリシーをスキップする — view-transition の「初回は決して包まない」（§4.3）と同じ述語・同じ理由: ページロードはブラウザの担当。

### 20.3 告知は commit 時点の `document.title` のスナップショット

`<wcs-head>` の静的 title 差し替えは `mutate()` 内で同期に完了するため、スナップショットは必ず新ルートの静的 title を読む。バインド title（`<title data-wcs>`）は commit 時点で古いことがあり（binder キューの遅延窓）、ナビゲーション外の title 変化（ロケール切替など）は再読み上げされない。どちらもバグではなく明記された制限（a11y-design D2）。

### 20.4 §4.3（view-transition のフレーム着地）との相互作用

ポリシーが走るのは `applyRoute` が await する遷移 promise の解決時 — つまり **mutation 適用時**であり、アニメーション完了時ではない（transition-runner の契約）。`router` を受け入れる arbiter の下では、フォーカスと告知はルート内容が差し替わったフレームに着地し、アニメーションはまだ再生中でありうる。「アニメーション完了後」は現プロトコルでは表現できず、非目標である（a11y-design D3 / §10）。

## 22. 横断契約: 切断は、変えたものを知らせる（2026-10-19）

対象: すべての I/O ノード。継ぎ目アプリ `state-field-report` が見つけた（[seam-apps.ja.md](./seam-apps.ja.md)）。`@wcstack/router` は離れたルートのノードを文書から外し、次に入るときに同じノードを戻す（[router の README](../packages/router/README.ja.md)）。`@wcstack/state` はその束縛を残し、出力の値を出力のイベントでしか知らない。だから、切断がイベントなしに変えた出力は、戻ってきた後も state の中で古いままになる。`<wcs-camera>` は `active` をそうやって `false` にしていた。ページはカメラが動いていると表示し、`active` の間は押せない開始ボタンも押せないままだった。洗ったところ、13 のパッケージが、出力をイベントなしに戻すか、出力を変えるはずの完了を（世代の守りで）捨てていた。

### 22.1 切断が変える state の出力は、すべてその場で知らせる
`disconnectedCallback` — `dispose()` と、シェルがその前に呼ぶもの — は、値を変える `semantics: "state"` の出力すべてについて、ほかの変化と同じ setter と同値ガードを通して変化のイベントを出す。戻すこと自体は残す。§13.4 の理由（次の操作の `true` のエッジを同値ガードに食わせない）はそのまま成り立ち、なくなるのは無言だけ。

### 22.2 切断が打ち切る操作は、終わったと知らせる
操作の完了を世代の守り（`_gen`、または operation lane の owner generation）が捨てるとき、`dispose()` が操作を自分で終わらせる。`loading`、`speaking` / `pending` / `paused`、`listening`、`recording` / `paused`、`connected` / `readyState` を戻し、イベントで知らせる。操作が生むはずだったもの（値、エラー）は、これまでどおり書かない — 守りはそのためにある。例外が 1 つあり、著者が決めた: `<wcs-recorder>` は録画中の分を残す。録画を止め、ストリームのトラックが終わったときと同じく、ブラウザが渡したときにクリップを `wcs-recorder:recorded` で渡す（camera の README）。

### 22.3 切断が変えないものは残り、何も出さない
`dispose()` が触らない出力は値を保つ。位置、認識した文、取得済みの値、アップロードが止まったところの `progress`（ほかの中断と同じ）。付け替えた要素が最後の状態を保つのはこれまでどおり。`dispose()` が消すエラー（`<wcs-broadcast>`・`<wcs-worker>`）は `null` として知らせる。これまでは、次に開いたときの `null` が同値ガードに食われ、state に古いエラーが残っていた。

### 22.4 これで変わったノード（4.5）

| パッケージ | 切断で知らせる出力 |
|---|---|
| camera | `<wcs-camera>` の `active`、`<wcs-recorder>` の `recording`・`paused`（とクリップ、§22.2） |
| clipboard | `loading` |
| geolocation | `loading` |
| speech | `<wcs-speak>` の `speaking`・`paused`・`pending`（発話中のものは最後まで話す。speechSynthesis はページ全体で 1 つ）、`<wcs-listen>` の `listening` |
| broadcast、worker | `error`・`errorInfo`（`null`） |
| websocket | `connected`・`loading`・`readyState`（`CLOSED`）— ソケット自身の `close` は古いものとして捨てる |
| contacts、credential、eyedropper、share | `loading` |
| upload | `loading` |
| audio（4.17） | `voices`（0）、`state` / `running` / `suspended`（`"unsupported"` でなければ `"suspended"`）— 外したルートは context を持たないので、最初の操作の前と同じに読める。入れ直しの `setPatch()` が context の状態を知らせ直す |
| midi（4.17） | `devices`（`[]`。`close()` も）— `connected` は以前から |
| fullscreen、pointer-lock、picture-in-picture（4.25） | `active`（`false`）— 要素は聞くのをやめるので、その値をもう保証できない。何も exit しない。入れ直しの target 解決が、target がまだ active なら `true` を知らせ直す（§16.6） |

ほかのノードは、切断で変えるものをすでにすべて知らせていたか、切断で何も変えない。audio と midi もそうだと思われていたが、継ぎ目アプリ `music-room` が、`voices`・`running`・`devices` が残るのを見つけた（4.17、[seam-apps.ja.md](./seam-apps.ja.md)）。

### 22.5 テスト
各ノードに、操作の途中で切断し、イベントを確かめるテストがある。当てはまるものでは、再接続の後の次の操作がまだ `true` のエッジを出すことも確かめる。

## 23. 横断契約: 接続時の仕事は、次のマイクロタスクの入力で決める（2026-10-25）

対象: 接続されたときに仕事を始めるすべての I/O ノード。継ぎ目アプリ `shift-desk` が見つけた（[seam-apps.ja.md](./seam-apps.ja.md)）。パラメータだけの遷移では、`@wcstack/router` は新しい params を出してから、ルートの中身を外して同じノードを戻す（[router の README](../packages/router/README.ja.md)）。それに依存するもの — 要素の `url`・`key`・`name`・`src`、`manual` のような門 — を `@wcstack/state` が書くのは、中身が戻る前に積まれたマイクロタスクの中（§4）。`connectedCallback` の中で仕事を始めたノードは、前のルートの入力で動いた: `<wcs-ws>` は前のチケットのチャットへつないでから閉じた。ファミリーを洗ったところ、17 のパッケージが同じだった — 前のカメラのデバイス、前の権限、state が書く直前の `manual` に逆らって始まるタイマー。`<wcs-fetch>` はマイクロタスクで決めているので起きなかった（§1）。

### 23.1 判断は 1 つのマイクロタスクで、そのときの入力で行う
`connectedCallback` は、入力を読まない手順（プロパティの取り込み直し、要素を隠す、自動トリガの登録）をその場で行い、判断を積む: 始めるか（`manual`・`autostart`・`auto`・`monitor`・`active`）、何で始めるか。マイクロタスクはそのときの入力を読み、その間に要素が文書から外れていれば何もしない。同じタスクの入力の変化 — `url` の後に `manual` を書く spread、upgrade の `attributeChangedCallback` と `connectedCallback` — は同じ判断にまとまり、仕事は 1 回だけ走る。

### 23.2 同じタスクで結果を使う最初の接続は、その場のまま
`<wcs-storage>` の読み込み、`<wcs-broadcast>` のチャンネル、`<wcs-worker>` の起動は、最初の接続ではその場で行う: 同じタスクで付いた束縛（中身を入れた直後に `@wcstack/state` に渡されるルートの中身）は `<wcs-storage>` の `value`（`#init=element`）を引いて読み込み済みであることを当てにし、同じタスクの post はチャンネルや worker に届くものとされている。入れ直し — 上の場合 — はマイクロタスクで決める。

### 23.3 明示のコマンドは判断を引き取る
マイクロタスクより前に呼ばれた開始の側のコマンド（`connect()`・`trigger`・`start()`・`open()`・`observe()`）は、その時点の入力で仕事をし、待っている判断は捨てる — 仕事は 1 回だけ。停止の側のコマンド（`close()`・`stop()`・`reset()`・`release()`・`stopMonitor()`・`terminate()`・`unobserve()`・`disconnect()`）も判断を捨てるので、同じタスクで付けて止めた要素は、開始が同期だった頃と同じく止まったまま。`pause()`（`<wcs-timer>`・`<wcs-raf>`）はその場で判断してから一時停止するので、一時停止した、再開できる状態になる。

### 23.4 `connectedCallbackPromise`
promise が接続時の仕事を表していたところ（`<wcs-permission>` の問い合わせ、`<wcs-defined>` の見張り）では、`connectedCallback` で用意し、マイクロタスクが始めた仕事とともに決まる。要素が外れていればその場で決まる。`disconnectedCallback` も決めるので、待ち続けることはない。すぐ解決する ready だったところは、そのまま。

### 23.5 これで変わったノード（4.8）

| パッケージ | マイクロタスクを待つもの |
|---|---|
| websocket | 接続（`url`・`manual`）。その後の `url` の変化による再接続もマイクロタスクで。4.26 から、クリアした `url` はそこで閉じる（§30.1） |
| sse | 接続（`url`・`manual`）。4.26 から、クリアした `url` はそこで閉じる（§30.1） |
| storage | 入れ直しの読み込み（`key`・`manual`）。最初の接続はその場で読む（§23.2） |
| broadcast | 入れ直しの open（`name`・`manual`）。最初の接続はその場で開く |
| worker | 入れ直しの起動（`src`・`manual`）。最初の接続はその場で起動する |
| camera | `<wcs-camera>` の自動開始（`autostart`）と、取得に使う制約（`device-id`・`facing-mode`・`audio`・`width`・`height`） |
| speech | `<wcs-listen>` の自動開始（`manual`）と認識のオプション（`lang`・`continuous`・`interim`・`max-restarts`） |
| geolocation | 取得か watch（`manual`・`watch`・`high-accuracy`・`timeout`・`maximum-age`） |
| midi | アクセスの要求（`auto`・`sysex`）。4.17 からは、最後の `request()` が取ったアクセスの取り直し（まだ granted のとき）も — Permissions API の答えが `granted` でなければ `permission` に知らせる |
| permission | 問い合わせ（`name`・`user-visible-only`・`sysex`） |
| timer | 自動開始（`manual`・`interval`・`repeat`・`once`・`immediate`） |
| clipboard | 監視（`monitor`） |
| wakelock | 自動取得（`manual`・`active`）。その後の `active` の変化はその場のまま |
| raf | 自動開始（`manual`・`repeat`・`once`） |
| intersection、resize | 観測（`manual`・`target` とオプション）。その後のオプションの変化もマイクロタスクで観測し直す |
| defined | 見張り（`tags`・`mode`・`timeout`）。その後の変化の後も |

### 23.6 そのままにしたもの
直る前に何も観測できないノード: `<wcs-fullscreen>`・`<wcs-pip>`・`<wcs-pointer-lock>` は `target` の変化で解決し直し、`<wcs-media-query>` は新しいクエリを評価し（古いものは同値ガードに隠れる）、`<wcs-audio>` は 20 ms ほどで新しい値へゲインを寄せる。`<wcs-fetch>` は以前からマイクロタスクで決めていた。センサー（`<wcs-accelerometer>` ほか）はコマンドでだけ始まり、切断で止まり（§22）、入れ直しでは始め直さない — [seam-apps.ja.md](./seam-apps.ja.md) に記録した。

### 23.7 テスト
各ノードに次のテストがある: 先に積まれたマイクロタスクが入力を変える入れ直し（仕事は新しい入力だけを使う）、マイクロタスクより前に外した要素（仕事をしない）、付けたのと同じタスクで書いた門、同じタスクの停止の側のコマンド。

## 24. 横断契約: パッケージの 2 つ目のコピーは警告する（2026-10-31）

対象: カスタム要素を定義するすべてのパッケージ — I/O ノード、`@wcstack/router`、`@wcstack/autoloader`、`@wcstack/view-transition`、`@wcstack/devtools`、`@wcstack/state` の完全版の入口。継ぎ目アプリ `homeroom` が見つけた（[seam-apps.ja.md](./seam-apps.ja.md)）。4.2.0 から 4.10.1 へ上げたアプリが、古い `<script type="module" src=".../@wcstack/state@4.2.0/auto">` を 1 つ新しいものの前に残し、4.2.0 のエンジンで動いていた: ページが先に評価したコピーがタグを定義し、2 つ目は定義済みのタグを見て何もしなかった — 何も言わずに。どのパッケージもその形でタグを登録していた（`if (!registry.get(tag)) registry.define(tag, Cls)`）。

### 24.1 定義したクラスはパッケージと版を名乗る
パッケージが定義するクラスは、`Symbol.for("wcstack.package")` に `"<パッケージ>@<版>"`（`"@wcstack/fetch@4.11.0"`）を持つ。サブクラスはそれを継ぐ。版はパッケージの `package.json` のもので、ビルドのときに埋め込む。この規則より前の古いコピーは持たず、印を付けない入口で読み込んだコピーも持たない（§24.4）。

### 24.2 自分のタグが別のコピーに定義されていたら、両方の版を名指しして 1 回警告する
パッケージのタグの 1 つが、このコピーのクラスでもそのサブクラスでもなく、このコピーのパッケージと版も持たないクラスで定義済みなら、コピーはそのタグに何も定義せず、パッケージごと・レジストリごとに 1 回（タグごとではない）警告する:

```
[@wcstack/fetch] [wcs/package-twice] <wcs-fetch> is already defined by @wcstack/fetch@4.2.0; this copy, @wcstack/fetch@4.11.0, does nothing. Load each package once.
```

相手のクラスが版を持たなければ、版がいくつであってもパッケージの名前だけで呼ぶ — `another copy of @wcstack/fetch that does not name its version`。古いコピーか、`/core` や `dist/split/auto.js` で読み込んだコピー（§24.4）。

### 24.3 何も言わないもの
- このコピーが同じレジストリにもう一度登録すること、利用者がこのコピーのクラスのサブクラスを意図してそのタグに定義したこと。
- 同じパッケージの同じ版の別のコピー: 害が無い — 同じリリースの `wcstack/auto` のバンドルと `@wcstack/state/auto` を並べたとき。
- 版の違う別々のパッケージ（state 4.2 と router 4.10）: 組み合わせられる。警告するのは同じパッケージの 2 つ目のコピーだけ。
- 新しいコピーの後に評価された、この規則より前の古いコピー: 警告するコードを持たない。新しいコピーが動く。

### 24.4 `@wcstack/state`: core ではなく完全版の入口
`<wcs-state>` と `<wcs-ssr>` は、core の `define()` を包む `/auto` と `.` の `bootstrapState` が確かめる: core はこの確認を持たない（gzip 20 KiB の予算）。`<wcs-state>` はエンジンの `WcsState` と比べる。`/core`（`@wcstack/state/core` の `bootstrapState`）と `dist/split/auto.js` はこれまでどおりタグを定義し、印を付けず、何も言わない: それで読み込んだコピーは、後から読み込まれた完全版の入口から `another copy of @wcstack/state that does not name its version` と呼ばれる。確認の重さは完全版の入口で gzip 約 250 B。`dist/split/auto.js` では約 400 B で、そのファイルのゲートを超える。

### 24.5 実装
ヘルパーは 1 つ、`/protocol/define-element.ts`（`defineElements(registry, pkg, [[tag, Class], …])`・`warnIfAnotherCopy`・`stampPackage`）で、`scripts/sync-protocol-types.mjs` が各パッケージへ写す。各パッケージの `registerComponents()` は、自分の `package.json` から読んだ `` `${pkg.name}@${pkg.version}` `` で `defineElements` を呼ぶ。共有の rollup の設定（`config-templates/rollup.config.js`）がその 2 つの値を埋め込むので、`dist/auto.min.js` は自己完結のまま。

### 24.6 テスト
各パッケージは、ヘルパーの共有テストと、自分の `registerComponents()` に対する共有の登録テストを走らせる（`__tests__/protocol.defineElement*.test.ts`）: 別のコピーのクラスが先にある（版あり・なし）、同じ版は何も言わない、利用者のサブクラスは何も言わない、警告はレジストリごとに 1 回。`@wcstack/state` は包みを `__tests__/twice.test.ts` で確かめる。

## 25. 横断契約: 移動は切断ではない（2026-11-14）

対象: 文書のどこに置かれているかに仕事がよらない I/O ノード（§25.3）。継ぎ目アプリ `ekiden-entry` が見つけた（[seam-apps.ja.md](./seam-apps.ja.md)）。リストの行の中の `<wcs-upload>` は、行を並べ替えるとアップロードを失い — `loading` は false、`status` は 0、エラーなし — `<wcs-fetch>` は要求を中断した。どのブラウザでも起きた: `@wcstack/state` が行を `moveBefore()` で動かすところ（4.14 から、Chromium 133 以降と Firefox 144 以降）でも。クラスに `connectedMoveCallback` の無いカスタム要素は、移動のたびに `disconnectedCallback`、続けて `connectedCallback` を受け、切断は後始末をする（§22）。

### 25.1 周りを読まないノードは `connectedMoveCallback` を定義し、そこでは何もしない
ブラウザが要素を `moveBefore()` で動かすとき、クラスが `connectedMoveCallback` を定義していれば、切断と接続の組の代わりにそれが走る。`connectedCallback` が自分の属性・プロパティ・子だけを読むノードにとって、移動は仕事の元になるものを何も変えない: 進行中の要求、開いた接続、動いているタイマー、取得したロックやストリームは続き、出力は変わらず、イベントは出ない。4.23 から。

### 25.2 そうでないもの
- 要素を取り出して入れ直す移動（`insertBefore`・`append`）は対象でない: `moveBefore()` の無いブラウザ（2026-11 時点の Safari）と、そう動かすコードすべて。それは今までどおり切断と接続で、§22 の知らせと §23 の判断が起きる。仕事を続けたい I/O ノードを持つ行を並べ替えるページは、仕事の間は並べ替えないか、ノードを行の外に置く（[forms.ja.md](./forms.ja.md)）。
- どの行が動くかの約束ではない: `@wcstack/state` は動かす行をできるだけ少なくし、どれを動かすかは自分で選ぶ。

### 25.3 ノード
コールバックを持つもの: `<wcs-accelerometer>`・`<wcs-ambient-light-sensor>`・`<wcs-broadcast>`・`<wcs-camera>`・`<wcs-recorder>`・`<wcs-clipboard>`・`<wcs-contacts>`・`<wcs-credential>`・`<wcs-debounce>` / `<wcs-throttle>`・`<wcs-defined>`・`<wcs-eyedropper>`・`<wcs-fetch>`・`<wcs-geo>`・`<wcs-gyroscope>`・`<wcs-idle>`・`<wcs-magnetometer>`・`<wcs-media-query>`・`<wcs-midi>`・`<wcs-network>`・`<wcs-notify>`・`<wcs-permission>`・`<wcs-raf>`・`<wcs-screen-orientation>`・`<wcs-share>`・`<wcs-listen>`・`<wcs-speak>`・`<wcs-sse>`・`<wcs-storage>`・`<wcs-tilt>`・`<wcs-timer>`・`<wcs-upload>`・`<wcs-wakelock>`・`<wcs-ws>`・`<wcs-worker>`。

持たないもの — することが置かれた場所によるので、移動は切断と接続のまま: `<wcs-intersect>`・`<wcs-resize>`・`<wcs-infinite-scroll>`（観測する対象とルートを、自分の居る場所から探す）、`<wcs-fullscreen>`・`<wcs-pip>`・`<wcs-pointer-lock>`（対象が同じく場所による）、`<wcs-audio>` とそのノードのタグ（入れ子が信号の流れ）。`@wcstack/router` の要素・`<wcs-autoloader>`・`<wcs-view-transition>` は I/O ノードではなく、変わらない。

### 25.4 テスト
各パッケージは、クラスがコールバックを持つことを確かめる（`__tests__/connectedMove.test.ts`）: happy-dom には `moveBefore()` が無い。ブラウザが実際に呼ぶところは `e2e/tests/io-move-row.spec.ts`（Chromium と Firefox）: 4 つの `<wcs-fetch>` が進行中の間に 2 行が入れ替わり、どの要求も 1 回だけ届く。

## 26. `<wcs-infinite-scroll>`: 番兵は、画面に残っている間はもう一度尋ねる（2026-11-15）

継ぎ目アプリ `town-archive` から（[seam-apps.ja.md](./seam-apps.ja.md)）。4.23 までの要素は、番兵が画面に入ったとき（§2.1）にだけ target を実行し、3 つのページが読み込まれなかった: 最初のページ（番兵が、`@wcstack/state` が target の `url` を書くより先に報告した。fetch の README 自身の例で、最初のページが出たのは Chromium で 10 回中 4 回、Firefox では 0 回）、番兵を画面に残したページの次（背の高いウィンドウ、短いページ）、新しい絞り込みのページ（番兵が画面にあるまま `url` が変わった）。

### 26.1 番兵が画面にあるときの、4 つの追加の時機
- **要求が飛んでいないときに、target の `url` が書かれた・変わった** — 最初の url、絞り込み。要素がまだ何も実行していなければその場で、そうでなければ 2 フレーム後（空になった一覧がレイアウトされ、番兵が今の位置を報告した後）。
- **要求が終わり、その間に `url` が変わっていた。** 応答が行を足したかどうかによらず、新しい url を実行する。
- **要求が応答なしで終わり（中断）、`url` が別のものになっている。** 絞り込みが変わったときに飛んでいる要求を中断するページは、その直後に新しい url を書く: それはページ自身の変更で、応答への反応ではない。（ネットワークの失敗とタイムアウトは、ここでは応答に数える: `wcs-fetch:response` が status 0 で出る。）
- **要求が終わり、応答が行を足し、ページが `url` を進めた。** 要求が終わってからページには 3 フレームある（`SETTLE_FRAMES`）。その間に書かれた `url` は、応答へのページの反応と見なす。「行を足した」は、スクロールするものの中での番兵の位置（top ＋ root のスクロール量）を、要求が始まったときと比べる。

ページ自身が始めた要求（`trigger`、コマンド）も同じに数える: 要素は自分の呼び出しではなく、target の `loading` を追う。

**これらの時機に見る番兵の位置には、ブラウザが作ってまだ届けていない報告も含める**（`IntersectionObserver.takeRecords()`。4.24.1 から）。オブザーバの報告はタスクで、利用者がスクロールしている間は入力とフレームの後ろで待つ: ページが番兵を押し出したという報告が 3 フレーム目より後に届いた — パッケージの infinite-scroll の例で、ページが届く瞬間に ↓ を数回押すと、Chromium で 10 回中 7〜9 回、Firefox で 1 回、WebKit では 0 回 — ため、届いた報告だけを読んでいた 4.24.0 は、ウィンドウに要らない 1 ページを取りに行った。こうして取り込んだ報告が「番兵が画面に入った」なら、届いた場合と同じく §2.1 のエッジとして扱う。

### 26.2 そこからは決してしないこと
- **すでに尋ねた `url` は実行しない。** 失敗した要求は `url` をそのまま残すので、繰り返されない。エラー表示のレイアウトは再試行にならない。番兵がもう一度画面に入れば（§2.1 の端）、同じ `url` でも実行する — 利用者がもう一度試す道。
- **行を 1 つも足さなかった応答で終わる**（ページが `url` をどう変えても）: 空の応答でページ番号を進めるページは、もう 1 回尋ねて止まる。
- target が `loading` の間、`disabled` の間、`once` の後は実行しない。

### 26.3 ページの仕事のまま残るもの
- 応答がどの絞り込みのものか: `manual` の `<wcs-fetch>` は `url` が変わっても中断せず、前の絞り込みのページは届く。ページは、絞り込みが変わったとき、一覧を空にする前にそれを中断する（`command.abort:`）。
- `url` は state から書く。静的な `url` では、state が target をバインドする前に最初の要求が始まり、応答が `eventToken.value` のハンドラより先に届くことがある（fetch を state より先に読み込んだ Firefox）。

### 26.4 root と margin
`<wcs-infinite-scroll root>` は id かセレクタ、`<wcs-intersect root>` はセレクタか id を受ける。指定されて見つからない root は値ごとに 1 回知らせ（`[wcs/infinite-scroll-root]`・`[wcs/intersect-root]`）、今までどおり viewport を使う。`<wcs-infinite-scroll>` はスクロールしない root（`overflow: visible`）も知らせる。ブラウザが拒む `root-margin`（単位の無い長さ）は、どちらも値ごとに 1 回知らせる（`[wcs/root-margin-unit]`）。どちらも throw しない。

### 26.5 テスト
`packages/fetch/__tests__/townArchive.test.ts` はフレームを手で進める（happy-dom の `requestAnimationFrame` では「2 フレーム後」と「その場」を区別できない）。実ブラウザでは、README の例を書かれたとおりに、スクロールと 4,000 px の高さのウィンドウで、Chromium・Firefox・WebKit。遅れて届く報告は、単体テストでは偽のオブザーバの `takeRecords()`、`e2e/tests/fetch-infinite-scroll.spec.ts` ではパッケージの例で最初のページが届く瞬間に ↓ を 2 回押す — 4.24.0 では、このテストは単独（ワーカー 1 つ）で走らせると落ちる。ほかのテストで忙しいマシンでは、報告は遅れなかった。

## 27. 横断契約: `supported` — このページでその機能を使えるか（2026-11-17）

対象: `<wcs-share>`・`<wcs-contacts>`・`<wcs-credential>`・`<wcs-eyedropper>`・`<wcs-screen-orientation>`・`<wcs-tilt>`・`<wcs-accelerometer>`・`<wcs-gyroscope>`・`<wcs-magnetometer>`・`<wcs-ambient-light-sensor>`・`<wcs-fullscreen>`・`<wcs-pointer-lock>`・`<wcs-pip>`。継ぎ目アプリ `stamp-rally` が見つけた（[seam-apps.ja.md](./seam-apps.ja.md)）。この 13 は、多くのブラウザに無い API、またはページが使用を禁じられることのある API を包んでいるが、どれも、コマンドを試すまでそれを言わなかった: ページがそれを知るのは、動くはずのないタップの `error` からで — iPhone で、Firefox で、ポータルの `<iframe>` の中で — ボタンを出さないでおくことができなかった。README は、作者に自分でブラウザを調べる（`typeof EyeDropper`・`typeof navigator.share`）か、コマンドを試してエラーを読むように言っていた。4.25 から、13 のそれぞれが、そのための出力 `supported` を 1 つ持つ。

### 27.1 言うことと、言わないこと
`supported` は boolean で、`semantics: "state"`、output-only である。`true` は**このページでその機能を使える**ことを意味する: API があり、ページがその使用を禁じられていない — Permissions-Policy（サーバーのヘッダ、`allow` の無い `<iframe>`）にも、フレームを認めない規則（`<wcs-contacts>`）にも、そして機能が安全なコンテキストを要る場合は安全でないコンテキストにも。`false` は理由を問わず「ここでは使えない」である: このページで使えない機能は unsupported、という `<wcs-permission>` が 4.5 から従っている規則に合わせている。

利用者が許可すること、要求が成功すること（タップが要るかもしれない）、ロックが効くこと（`<wcs-screen-orientation>`: Safari には `lock()` が無く、デスクトップは拒否する）、センサーが実際にあること（PC には `DeviceOrientationEvent` があってセンサーが無い）、特定のデータを扱えること（`<wcs-share>`: `canShare(data)`）は言わない。それらは試して初めて分かり、`error` / `errorInfo` に出る。

Permissions-Policy に聞くのは、ページが自分のポリシーを読めるブラウザ（Chromium）で、そのポリシーが挙げている機能についてだけである。それ以外では API の有無で決まる（§9.8、§16.8）。

### 27.2 読まれるたびに調べ、接続時に知らせる
getter は読まれるたびにブラウザを調べ、何も保存しない。だから値は要素を接続する前から正しく、バインド — output-only なので authority は `element` — は張られた時点でそれを読み（§7.1）、イベントを待たない。イベント `<prefix>:supported-changed`（detail は boolean、`bubbles: true`）は、それ以外のリスナーのためにある。接続時に、値が最後に dispatch したものと違うときに dispatch する。最後に dispatch した値は `false` から始まるので、機能を使えないページには何も聞こえず、使えるページには `true` が 1 回聞こえる。切断は何も変えず、何も dispatch しない（§22.3）。再接続は、その間に値が変わっていたときだけ dispatch する。これを反映するカスタム状態（`:state()`）は無い（§17）。

§27.3 の 5 つのノードでは、Core の `observe()` が dispatch する: Shell は `connectedCallback` からそれを呼び、要素なしの Core は自分の `observe()` でイベントを受け取る。`<wcs-screen-orientation>` は、同じ `observe()` の中で、スナップショットの `wcs-orientation:change` より先にこれを dispatch する。

### 27.3 ノードごとの定義

| 要素 | イベント | `supported` が `true` になる条件 |
|---|---|---|
| `<wcs-share>` | `wcs-share:supported-changed` | `navigator.share` が関数で、`featureUnavailable("web-share") === null`: 安全でないコンテキストではなく、`web-share` を切る Permissions-Policy も無い（ブラウザのポリシーがその機能を知っている場合。デスクトップの Chromium のポリシーは知らないので、聞かない）。禁じるポリシーの下でも `share()` 自体はブラウザに渡り、`share-failed` で終わる |
| `<wcs-contacts>` | `wcs-contacts:supported-changed` | `navigator.contacts.select` が関数で、ページが最上位（`window.top === window`。throw した場合と `window` が無い場合は最上位でないとする）: Contact Picker の仕様はフレームを認めない。フレームの中でも `select()` はブラウザに聞き、ブラウザは `InvalidStateError`（`select-failed`）で答える |
| `<wcs-credential>` | `wcs-credential:supported-changed` | `navigator.credentials != null` で `typeof PasswordCredential === "function"` — Chromium だけ。Firefox と Safari は WebAuthn 用に container を持つ。`false` のところでは、`password` / `federated` を求める `get()` とすべての `store()` が、ブラウザを呼ばずに `capability-missing` で終わる |
| `<wcs-eyedropper>` | `wcs-eyedropper:supported-changed` | `typeof EyeDropper === "function"` — `open()` がする確認と同じ（ブラウザはこのコンストラクタを安全なコンテキストでだけ公開する） |
| `<wcs-screen-orientation>` | `wcs-orientation:supported-changed` | `screen.orientation` がある。つまり `type` / `angle` を見張れる。`lock()` については何も言わない |

残りの 8 つは、それぞれの節で定義している: `<wcs-tilt>` は §8.6、Generic Sensor の 4 ノードは §9.8、`<wcs-fullscreen>` / `<wcs-pointer-lock>` / `<wcs-pip>` は §16.8。そこで dispatch するのは `publishSupported()` — tilt では `observe()` が呼び、センサーでは Shell の `connectedCallback` が呼ぶ（センサーは接続時に observe しない） — か、トリオでは `observe()` である。

### 27.4 テスト
§27.3 の 5 つのノードそれぞれに、2 回の読み取りの間で API を入れたり外したりするテスト（getter はキャッシュしない）、`observe()` と接続が、最後に dispatch した値から変わったときだけ dispatch することを確かめるテスト — 機能を使えないページでは何も出さず、再接続でももう一度は出さない — 、Shell のプロパティが接続前から正しいことを確かめるテストがある（`__tests__/<name>Core.test.ts`・`__tests__/<name>.test.ts`）。ポリシーやフレームで決まるところは、偽の `document.featurePolicy` や `top` が代役をする。残りの 8 つは、それぞれのスイートで同じことを確かめる。実ブラウザでは `e2e/tests/io-screen-sensors.spec.ts`（Chromium・Firefox・WebKit）が、`<wcs-contacts>` の `supported` を、代役のピッカーがあれば `true`、無ければ `false` と読む。

## 28. `<wcs-contacts>`: 選ばずに閉じたピッカーは `cancelled`（2026-11-17）

継ぎ目アプリ `stamp-rally` から（[seam-apps.ja.md](./seam-apps.ja.md)）。Contact Picker の仕様には、閉じられたピッカーのための reject が無い: `select()` は**空のリストで resolve し**、reject するのは `InvalidStateError`（最上位のページでない、ピッカーがすでに出ている、ピッカーが失敗した）、`SecurityError`（ユーザー操作が無い）、`TypeError`（プロパティが空、または非対応）だけである。4.24 までの要素は `AbortError` を待っていたので、`cancelled` が `true` になることはなく、閉じたピッカーは直前の選択の上に `value: []` を書いていた。

### 28.1 空の結果がキャンセルである
4.25 から、`select()` が空の配列で resolve すると、要素は `wcs-contacts:cancelled-changed`（`true`）、続けて `wcs-contacts:loading-changed`（`false`）を dispatch する。`wcs-contacts:complete` は dispatch せず、`value` は元のまま。コマンドは `null` で resolve し、lane の終端の結果は `aborted` になる。空でない結果はこれまでどおり — `complete`、続けて `loading-changed`（`false`） — で、`cancelled` はその `select()` が始まった時点で `false` に戻っている。`AbortError` での reject は、引き続きキャンセルとして読む。`dispose()` の後に届いた完了は、このどれも書かない（§22.2）。

### 28.2 テスト
`packages/contacts/__tests__/contactsCore.test.ts`: イベント、前の `value` が残ること、次の選択、`dispose()` の後の完了。実ブラウザでは `e2e/tests/io-screen-sensors.spec.ts` の代役のピッカー。

## 29. `<wcs-credential>`: `preventSilentAccess()` は operation lane の外にある（2026-11-17）

継ぎ目アプリ `stamp-rally` から（[seam-apps.ja.md](./seam-apps.ja.md)）: ページにはサインアウトする手段が無かった — 次に開いたときの `get({ password: true, mediation: "silent" })` が、利用者をそのままサインインし直していた。4.25 から、要素はコマンド `preventSilentAccess()`（`navigator.credentials.preventSilentAccess()`）を持つ。

### 29.1 何とも競合せず、書くのは `error` / `errorInfo` だけ
`get()` と `store()` は 1 つの `latest` の lane を共有し、後の呼び出しが前の呼び出しを追い越す。`preventSilentAccess()` はそこに入らない — 競合する結果を持たない — ので、進行中の `get()` / `store()` を追い越さず、追い越されもせず、`loading`・`value`・`cancelled` のどれにも触れない。ブラウザの promise が resolve すると、`errorInfo` と `error` を `null` に消す（`wcs-credential:error-info-changed`、続けて `wcs-credential:error`。どちらも同値ガード付きなので、エラーが無かったときは何も出ない）。reject は、名前を問わず — `NotAllowedError` も含む: 閉じるべき選択 UI が無い — それらをセットする（`credential-failed`、phase `execute`、`recoverable: true`）。`navigator.credentials` かこのメソッドが無いところでは、コマンドは何も呼ばず、何も書かずに resolve する: サインアウトはどこでも動く。呼び出しの前に lane の owner generation を捕捉するので、`dispose()` の後に届いた完了は何も書かない（§22.2）。

### 29.2 テスト
`packages/credential/__tests__/credentialCore.test.ts`: 呼び出し、エラーが消えること、reject、同期的な throw、container が無い場合とメソッドが無い場合、進行中の `get()` が追い越されないこと、`dispose()` の後の完了。

## 30. `<wcs-sse>` と `<wcs-ws>`: クリアした `url` は閉じる。`<wcs-sse>` とページの離脱（2026-11-19）

継ぎ目アプリ `lending-desk` から（[seam-apps.ja.md](./seam-apps.ja.md)）。サインアウトしたタブが、前の利用者のストリームを開いたままにしていた: `url` の getter は `null` を返したが、4.25 まではクリアした `url` は接続をそのままにした（意図的に。`<wcs-ws>` も同じ）。そして Firefox のコンソールの文言へのページ自身の対処 —— SSE の README のとおり `beforeunload` でストリームを閉じる —— は WebKit でライブの更新を止めた。WebKit は同じ文書の中の遷移でも `beforeunload` を出す。

### 30.1 クリアした `url` は、接続時のマイクロタスクで閉じる（`<wcs-sse>`、`<wcs-ws>`）
空になる `url` —— `null`、`""`、属性の除去、マークアップに無かったときの `undefined` —— はほかと同じ変化であり、§23 の判断は、読んだ `url` が空なら `close()` と同じに接続を閉じる。`<wcs-sse>`: `connected`・`loading`・`readyState`（`CLOSED (2)`）をその場で知らせる。`<wcs-ws>`: 開いているソケットは閉じ、その `close` イベントが終わりを知らせる。接続中のソケットは手放し、終わりをその場で知らせる（§22）。待っている `auto-reconnect` はどちらも外す。`manual` の要素にも当てはまる: 閉じることは接続ではなく、ストリームを特定していたのは `url` だった。

マイクロタスクの判断なので、1 つのタスクの変化はまとまる: クリアして書き戻した `url` は、閉じも開き直しもしない。`<wcs-sse>` は Core のガード（開いている・開こうとしているストリームの `url` への `connect()` は何もしない）に頼る。`<wcs-ws>` は接続した `url` を覚え、その `url` で開いている・開こうとしているソケットはそのままにする —— これで、1 つのタスクで変えて戻した `url` も何もしない（4.25 までは接続し直した）。`url` の無いまま付けた要素は何も知らせない: 閉じるものが無い。

### 30.2 `<wcs-sse>` はページが離れようとするときに閉じ、文書が残ればまた開く
全体の遷移が始まるときに開いている `EventSource` について、Firefox は `The connection to <url> was interrupted while the page was loading.` を出す（`console.error`）。それより先に来るのは `beforeunload` での close だけで、`pagehide` では遅い。Navigation API を持つ WebKit は、`@wcstack/router` が横取りする遷移 —— `<wcs-link>`、ガードのリダイレクト（遷移とそのリダイレクトで 2 回）、`navigateUrl` の書き込み。履歴の移動（戻る）は除く —— の `navigate` イベントの前に `beforeunload` を出す。Chromium と Firefox は出さない。WebKit での順は、1 つのタスクの中で `beforeunload`、`navigate`、`currententrychange`、`navigatesuccess`。「このページを離れますか」に「留まる」と答えたとき、ダウンロードだったリンクは、ページをそのままにし、その後のイベントは無い。そこで、要素が接続している間（`window` と、あれば `navigation` のリスナ。`beforeunload` は、開いている・開こうとしているストリームか、それで閉じてまた開くものがある間だけ —— リスナがあるだけでページを back/forward cache から外すブラウザがある。`@wcstack/router` の `leaveConfirm` も同じことを考えている）:

- **`beforeunload`**: 開いている・開こうとしているストリームを閉じ（`SseCore.suspend()`）、終わりを知らせる —— `connected` は `false` になる。1 秒のタイマーを始める。`auto-reconnect` を待つストリームには開いているものが無い: リスナは無く、その開き直しはそのまま進む。
- **文書が残る**: `navigation` の `currententrychange`（同じ文書の遷移が確定した）が、マイクロタスクでストリームをまた開く —— 遷移がページに書かせる `url` が開くものになる —— 。そうでなければ、`pagehide` が来なかったときにタイマーが開く。開くのは `connect()` で、そのときの `url` とオプションを読む。閉じている間の 2 回目の `beforeunload` は待ち直す（2 本開くことは無い）。
- **`pagehide`**（persisted かどうかによらず）: 閉じたままにし、タイマーを外す。開いていた —— または `beforeunload` で閉じた —— ストリームは、ページが back/forward cache に入りうるとき（`persisted`）覚えておく。
- **`persisted` の `pageshow`**: 覚えておいたストリームをまた開く。4.8 からの `<wcs-ws>` と同じ（websocket の README、「back/forward cache」）。

また開くのは、要素がこうして閉じたものだけ。`close()`、クリアした `url`（§30.1）、要素を外すことは開き直しを取り消し、`connect()` / `trigger` と `url` の変化はそれを引き取る。ページがつないだ `manual` の要素はまた開く（要素が閉じたのはページの接続だから）。ページが一度もつながなかったものには、開き直すものが無い。閉じていた間に送られたイベントは届かない: `connected` が `true` になったら追いつくのはページで、ほかの再接続の後と同じ（sse の README、再接続）。

代わりに払うもの: WebKit では router の遷移のたびにストリームを閉じて開き直す（新しい要求、`Last-Event-ID` なし）。応答がタイマーより遅い遷移では、ページが離れる前にストリームをまた開き、そのために Firefox の文言が戻りうる。

### 30.3 ページがもうしないこと
ページ自身の `beforeunload` での close —— 4.25 までの SSE の README と `io-node-catalog` のレシピ —— は外す: それがあると、router の下の WebKit は最初の遷移の後閉じたままになる。lending-desk のアプリが落ちたのはそれだった。切断のために `url` をクリアするページに、並べた `close()` はもう要らない。

### 30.4 テスト
`packages/sse/__tests__/sse.test.ts`（偽の `navigation` と偽のタイマー: close、`currententrychange` とタイマーによる開き直し、開き直しで読む `url`、2 回の `beforeunload`、`pagehide`、`pageshow`、間の `close()` / `connect()` / クリアした `url` / 取り外し、`manual` の要素、そのままにする待っている `auto-reconnect`、閉じるか開き直すものがある間だけの `beforeunload` のリスナ、Navigation API が無い場合。クリアした `url` のそれぞれの形、1 つのタスクでのまとまり）と `sseCore.test.ts`（`suspend()`）。`packages/websocket/__tests__/webSocket.test.ts`（開いている・接続中のソケットでのクリアした `url`、まとまり、切れたソケット、その前の `close()`、待っている `auto-reconnect`、`manual`）。実ブラウザでは `e2e/tests/sse-unload.spec.ts`: router の遷移と戻るのたびにイベントが届くこと（Chromium、Firefox。WebKit は `webkit` のプロジェクトを足して手元で走らせた —— リポジトリの e2e には無い —— そこでは閉じて開き直すことを確かめる）、全体の遷移でコンソールが静かなこと（Firefox の文言は `console.error` として捕まる）、「留まる」と答えた確認（Chromium、Firefox）、back/forward cache からの復元（完全な Chromium。fixture の文書は `no-store` なしで返す）。
