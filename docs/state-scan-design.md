# 設計: `$scan` — 時間軸方向の累積を宣言する

- **状態**: 決定済み（2026-09-13）。§0 の決定レコードが正本。起点は [Issue #272](https://github.com/wcstack/wcstack/issues/272)（外部評の判定・同型 13 サイトの実数・5 案比較・決定ゲート G0〜G11）。
- **対象**: `@wcstack/state` の core 拡張。watch runtime（drain 終端フック）と event-token の購読経路に乗る。proxy core・updater・依存グラフの契約は変えない。
- **一言で**: 「**過去の出来事の系列を畳んだ値**」を置く場所。`$streams.fold` は run 寿命（restart で `initial`）、`$watch` は値を所有しない。どちらにも置けなかった「run を跨いで持続する累積」を、所有者・発火単位・reset 条件つきで宣言する。
- **位置づけ**: 空間軸の導出（wildcard getter・`$getAll(...).reduce`）と対になる時間軸の導出。getter に前回値を渡す形（Vue `computed(prev)` / Solid `createMemo(prev)`）は採らない。**fold を派生値の再評価回数に結び付けない**ことが設計の中心（Issue #272「先行事例の教訓」1・2）。

---

## 0. 決定レコード

| ゲート | 論点 | 決定 |
|---|---|---|
| **G1** | Gate 0（挙証責任）の判定基準 | **予防的正しさを通過要件と認める**（2026-09-13 決裁）。命令的累積に起因する既存 Issue は 0 件だが、所有権の構造化・宣言 reset・getter 柵・exactly-once の契約化で「事故を起こしにくくする」ことを利得として数える。同型サイト 13（10 ファイル）で n=1 棄却の前例（lane §0-1）は当てはまらない。 |
| **D1** | 何を作るか | 宣言マップ `$scan: { <output>: { from \| on, initial, fold, resetOn? } }`。出力は **runtime 所有**の平坦なプロパティ（`$streams` の値と同じ規範）。 |
| **D2** | source の種類と形（G3） | **`from`（state パス）か `on`（event-token 名）のどちらか 1 つ**。要素の出来事（`message` / `loading` / `value` / `dt` …）は `on`、state が所有する値（`$streams` の値・スカラの遷移・行の変化）は `from`。複数 source は第 2 段（1 出力 1 source）。`$` 始まりの `from`（`$streamStatus.<n>` 等）は第 2 段。 |
| **D3** | 発火単位（G8-a/b） | `from`: **drain 終端で、バッチに載った絶対アドレス 1 つにつき fold 1 回**（変化の scan）。同一 job 内の複数書き込みは 1 回に畳まれる。`on`: **イベント 1 回につき fold 1 回・同期**（出来事の scan）。`on` には drain を待つ遅延が無い。 |
| **D4** | fold 契約（G8-j） | 同期・純粋・**新しい値を返す**。`this` は渡さない（`$streams.fold` と同じ）。引数は `from` が `(acc, cur, prev, ...indexes)`、`on` が `(acc, event, ...indexes)`。`acc` と同一参照を返したら書かない。throw と thenable の戻り値は報告して書かない（例外隔離）。 |
| **D5** | getter を source に許すか（G4） | **許さない**。`from` 自身またはその祖先パスが getter なら宣言時 raise。接ぎ木（ボリューム）で後から getter になった `from` は発火時に検出して報告し、その scan を止める。 |
| **D6** | reset（G2） | `resetOn: ["<path>", ...]`（平坦な state パスの配列）。どれかがバッチに載ったら**出力を `initial` に戻し、そのバッチの fold は行わない**（reset が勝つ）。戻すのは**出力だけ**で、協調するカーソル（`page` 等）は戻さない（G2-a (i)）。発火はアドレス駆動で値比較なし（`$streams.args` と同じ。primitive は same-value guard により実質変化時のみ）。getter・wildcard・`$` 始まり・自分の `from` とその子孫・scan 出力（自他とも）は raise（`from` の祖先は「親の差し替えで作り直す」として許す）。ユーザー起点の reset は nonce を `resetOn` に読ませる（G2-c）。**`on` の scan では reset を enqueue の時点で保留する**: 保留中に来た出来事の fold は `initial` から畳んで保留を消し、保留が残ったまま drain に来たら `initial` に戻す。書き込みより後の出来事（その書き込みの binding 適用で要素が同期に dispatch したものを含む）を消さないため（§5-4）。 |
| **D7** | 出力 | 名前は平坦（`.` / `*` / `$` 始まり / 空文字 / `Object.prototype` 継承名を raise）。getter・setter・`$streams` 名との衝突は raise。**未定義なら `initial` で実体化し、既に値があれば保持する**（同じオブジェクトの再セット・SSR ハイドレーションで累積を失わない）。 |
| **D8** | 寿命（G6） | 出力は通常の state 値として**切断・再接続を跨いで保持**する。切断中の出来事は畳まない。`from` は再接続で再開する（`$watch` と同じ二段構え）。`on` は `$on` と同じ購読経路に乗るので、ルート `<wcs-state>` の再接続で購読が戻らない既存欠陥（[#273](https://github.com/wcstack/wcstack/issues/273)）を共有する。#273 を直せば `$on` と一緒に戻る（`scan.on.test.ts` の `DEFECT(#273)` を反転させる）。`_state` の再セットで宣言を作り直す。SSR では `from` は発火せず出力の実体化だけを行い、`on` は `$on` と同じ扱い。ボリューム（`mount=`）での宣言は raise、マウントされたコンポーネントでは warn（`$streams` / `$watch` と同じ扱い）。 |
| **D9** | 自己ループの柵（G5） | `from` の根が `$streams` 名である scan について、**その stream の `args` 依存に、scan 出力から依存グラフで到達できるパスが含まれていたら raise**（起動時は loud fail、依存駆動 restart では `$streamError` に正規化）。「scan 出力 → getter → 同じ stream の args」は、sentinel を経由せずに全ページを読み続ける（冪等キーが無ければ無限に再取得する）前進ループになるため。 |
| **D10** | 同居バッチの優先順（G11） | `from` の根が `$streams` 名で、**同じバッチにその stream の restart 依存が載っていたら fold しない**。`$streams` §3-2「restart が勝つ」に揃える（到着した chunk は abort される run のもの）。 |
| **D11** | 機構間の順序（G8-f） | watch runtime の drain リスナー（`WATCH_LISTENER_PRIORITY`）内で **`$scan` → `$watch`**。連鎖深さ（32 段）・`prev` 台帳・例外隔離・発火対象集合を `$watch` と共有する。`on` の fold は同じトークンの `$on` ハンドラより**先**に走る（reducer → effect の順）。 |
| **D12** | scan 出力を `$watch` したときの `prev`（G8-h） | **常に `undefined`**。scan の書き込みは drain リスナーの内側で起き、`prev` 台帳は同じ drain の終わりに消える。`$watch` ハンドラの書き込みを別の `$watch` で見たときと同じ。 |
| **D13** | 前提（G8-i） | `config.sameValueGuard` 既定 ON が前提。OFF では `from` の primitive は書き込み回数を数え、`prev` も `undefined` になる（非サポート）。 |
| **D14** | `$listKeys` × 出力（G9） | キー突合は**出力そのものが配列**のときだけ効く（書き込みアドレスが宣言リストパスと一致する必要があるため）。オブジェクト出力の子配列（`feed.items`）には効かない。 |
| **D15** | bound path の初期同期（G10） | `from` は state の書き込みを見るので、要素出力の初期同期（directional initial sync）も 1 回の変化として畳む。**要素の出来事は `on` で受ける**ことを規範にし、runtime は書き手を区別しない。 |
| **D16** | pre-drain gate（G8-g） | 採らない。drain 終端で始め、`from` の 2 hop 遅延が実害になった時点で再評価する。`on` は同期なのでこの問題を持たない。 |
| **D17** | signals 共有契約（G7） | 該当なし（`$streams.persist` 案を採らないため、`$streams` の restart-reset 契約は不変）。 |
| **D18** | 同じ drain での scan 間の読み（§5-4） | drain 側の発火を **計画 → 書き込みの 2 相**にする。全 scan の次の値を読むだけで決めてから、宣言順に書く。1 相で「畳んでは書く」と、別の scan の出力を `from` に取る scan が同じ drain で先行 scan の書いたばかりの値を先取りし、次のバッチで同じ値をもう一度畳む（届いていた値は取りこぼす）。宣言順しだいで exactly-once が破れる。 |

---

## 1. 宣言構文

```js
export default {
  pageSize: 20,
  page: 1,
  retryNonce: 0,

  $eventTokens: ["pageArrived", "message"],

  $streams: {
    pageResult: {
      args: (s) => ({ page: s.page, pageSize: s.pageSize, retryNonce: s.retryNonce }),
      source: loadPage,
    },
  },

  $scan: {
    // from: state パスの変化を畳む（stream の値・スカラの遷移・行の変化）
    feed: {
      from: "pageResult",
      initial: { items: [], pages: [] },
      fold: (acc, chunk) => {
        if (chunk?.kind !== "success" || acc.pages.includes(chunk.page)) return acc;
        return { items: acc.items.concat(chunk.items), pages: [...acc.pages, chunk.page], lastSize: chunk.items.length };
      },
    },

    // on: event-token の出来事を畳む（要素の出力）
    log: {
      on: "message",
      initial: [],
      fold: (acc, event) => [...acc.slice(-49), event.detail],
      resetOn: ["host"],          // host が変わったら initial に戻す
    },
  },
};
```

### 1-1. 各フィールドの契約

| フィールド | 型 | 必須 | 契約 |
|---|---|---|---|
| `from` | `string` | `on` と排他で 1 つ | state パス。wildcard 可（行ごとに発火）。`$` / `@` 始まり不可。getter（祖先を含む）不可。自出力・自出力の子孫は不可。 |
| `on` | `string` | `from` と排他で 1 つ | `$eventTokens` に宣言済みのトークン名。 |
| `initial` | any | ✔ | 実体化の種と `resetOn` の戻り先。 |
| `fold` | function | ✔ | D4。 |
| `resetOn` | `string[]` | — | D6。 |

### 1-2. 宣言時の検査（raise）

`value` だけを読む検査なので、`_state` セッターの「世代を進める**前**」の群に置く（throw した再セットは旧世代のまま残る）。

- `$scan` がオブジェクトでない／エントリがオブジェクトでない。
- 出力名（D7）。getter / setter / `$streams` 名との衝突。
- `from` と `on` がどちらも無い／両方ある。`on` が `$eventTokens` に無い。
- `from` が空・`$` 始まり・`@` を含む・空セグメント・wildcard 深度超過・getter（祖先を含む）・自出力またはその子孫。
- `initial` が無い。`fold` が関数でない。
- `resetOn` が文字列配列でない／要素が getter・wildcard・`$` 始まり・自分の `from`・自分の `from` の子孫・いずれかの scan 出力（またはその子孫）。
- scan 出力を介した循環（A の `from` の根が B の出力、B の `from` の根が A の出力、…）。

---

## 2. ランタイムモデル

### 2-1. `from` の発火（D3・D10・D11）

watch runtime の drain リスナー内で、`$watch` の収集より前に scan を収集・発火する。

1. バッチの各絶対アドレスについて、発火対象の stateElement の scan registry を `from` パスと `resetOn` パスで引く。
2. entry ごとに「reset hit があるか」「from hit（行ごと）があるか」をまとめる。
3. **相 1（計画）**: 宣言順に、次の値を読むだけで決める。1 entry につき `createState("readonly")` を 1 回（D18）。
   - 直前に registry の identity と発火対象集合を再確認する（先行 fold が同期に切断・再セットを起こし得る — `$watch` と同じ）。
   - reset hit があれば「`initial` を書く」計画にして終わる（D6）。
   - `from` が後から getter になっていたら報告して止める（D5）。
   - `from` の根が `$streams` 名で、その stream の依存がバッチに載っていれば何もしない（D10）。
   - 行を indexes 昇順に並べ、`acc = fold(acc, cur, prev, ...indexes)` を連鎖し、開始値と `Object.is` で異なるときだけ書く計画を立てる。
4. **相 2（書き込み）**: 計画を宣言順に書く。1 計画につき `createState("writable")` を 1 回。直前に同じ再確認をする。`on` の scan の reset は保留が残っているときだけ書く（§2-2）。
5. fold の throw・thenable の戻り値・書き込みの throw は entry ごとに閉じて報告する。
6. scan 発火は `beginWatchFiring` の内側で行う（scan の書き込みも連鎖深さに数える）。

`prev` は `$watch` と同じ台帳から取る。そのため `from` パスは `$watch` のパスと並んで旧値キャプチャのゲートに入る（`scanPaths`）。

### 2-2. `on` の発火（D3・D11）

event-token の subscriber として登録する。`_state` セッターで `clearEventTokenRegistry` の直後・`processOnDeclaration` の直前に購読するので、同じトークンでは `$on` ハンドラより先に呼ばれる。

subscriber は `(state, event, ...indexes)` を受け、`state[output]` を読んで fold し、同一参照でなければ書く。例外は閉じて報告する（後続の `$on` ハンドラを巻き添えにしない）。

`resetOn` は書き込みの時点で効かせる（D6）。updater の enqueue に葉モジュール（`scan/eventReset.ts`）のフックを置き、発火対象の state で `on` の scan の `resetOn` アドレスが enqueue されたら、その entry に reset を保留する。subscriber は保留があれば `initial` から畳み、成功したら保留を消す（throw・thenable なら保留を残し、drain が `initial` に戻す）。drain 側は保留が残っているときだけ `initial` を書く。`resetOn` を持つ `on` の scan がページに無ければ、フックは整数比較 1 回で抜ける。

### 2-3. 自己ループの柵（D9）

`startStream`（起動・restart の共通手順）で `traceArgs` の後に検査する。`from` の根がこの stream 名である scan それぞれについて、出力パスから `staticDependency`（子）と `dynamicDependency`（依存する getter）を辿った到達集合を作り、`args` の依存パスと交われば raise する。辿るグラフは `walkDependency` が書き込みを伝播させるのと同じものなので、「書き込みが args に届くか」をそのまま判定できる。

### 2-4. 実体化と登録の位置（`_state` セッター）

| 位置 | 処理 |
|---|---|
| 世代を進める前 | `$scan` の検査（§1-2）。 |
| `clearEventTokenRegistry` の直後 | 出力の実体化（D7）→ `on` の購読 → `processOnDeclaration`。実体化を `_rebuildPathInfo` より前に置くのは、再セットで前世代の `from`（別 scan の出力の子）を張り直すとき存在検査が偽の miss を出さないため。 |
| `processWatchDeclaration` の直前 | scan registry の作り直しと、`from` / `resetOn` の `setPathInfo(path, "prop", "scan")`。 |

---

## 3. 埋まらないもの（正直な線引き）

`examples/state-intersect-scroll` を `$scan` で書き直しても、次は残る。

1. **commit 後の `reobserve()`**。パス変化で command を発射する宣言面は無い（`$effects` は watch 設計 §12 で非スコープ）。`$watch` に残る。
2. **error 確定時点の `window.scrollY` 記録**。帯域外の viewport 値の時点記録で、純粋な fold にも getter にも置けない。
3. **sentinel の edge → page 導出と retry 資格判定**。filter / gate は `$on` の責務。
4. **per-page の冪等キー**。runtime が保証するのは「着地ごと 1 回」で、「page あたり 1 回」ではない。done 後の `retryNonce++` と切断→再接続は同じ page を再着地させる（Issue #272 G6 の実測: 現行の `$watch` 形でも再接続で items 9→12 件）。
5. **`page` を plain property に保つ制約**。getter にして args に読ませる形は D9 で raise するが、sentinel を経由する正しい形を宣言で表す手段は無い。
6. **retry policy**（attempt loop・abortable delay）と `retryNonce` 符号化。value ベースの restart API の境界。
7. **fold の純粋性は規約**。`this` を渡さないので state への書き込みは書けないが、`window` や外部変数は読める。

外部評の「`$watch` も `items` も冪等性の心配も同時に消える」に対する答えは、「`items` は runtime 所有の fold 出力になり、`console.assert` の写しは不要になるが、`$watch` は責務 3→2 で残り、冪等キーは再接続の正しさを担う分岐として残る」。

---

## 4. 実装計画

| Phase | 内容 | DoD |
|---|---|---|
| **A** | `src/scan/`（types・宣言検査・registry・runtime）。`State` の配線（§2-4）・`define.ts` の予約名・manifest・マウント warn・ボリューム raise・`scanPaths` の旧値ゲート。 | unit（下記）緑・既存緑・カバレッジ閾値・lint 0。 |
| **B** | D9（自己ループ柵）・D10（同居バッチ）・D5 後段（接ぎ木後の getter 検出）。 | 各 fail-before-fix の fixture。 |
| **C** | ツールチェーン: vscode-wcs（宣言検査・候補パス実体化・preamble 型・メッセージ）、`packages/lint` 再ビルド＋smoke、devtools（`state:watch-error` の `phase: "fold"`、`state:path-unresolved` の `source: "scan"`）。 | vscode-wcs / devtools のテスト緑。repo 全 HTML の診断差分 0（`$scan` を使う example を除く）。 |
| **D** | README（en/ja）Scan 節、`packages/state/docs/scan(.ja).md`、timing 契約・streams / watch 設計の相互参照、`examples/state-intersect-scroll` の書き直しと README、`watch.streamCommit.test.ts` の置換、CHANGELOG。 | e2e `state-intersect-scroll` 6 本が無改変で緑（ローカル dist）。 |

### 4-1. Phase A の unit（抜粋）

- `from`: 着地 1 回＝fold 1 回／同一参照 return は書かない（`$watch.<output>` も鳴らない）／バインド無しで発火／`$watch` 無しの state で発火／`$watch.<from>` と `$scan{from}` の同居・同じ `from` の 2 scan が各 1 回／scan → watch の順／wildcard `from` の同一バッチ複数行は acc を連鎖して 1 回書く／祖先書き込みで `prev` が `undefined`／fold の `this` は `undefined`／throw・thenable は報告して書かない。
- `on`: イベント 1 回＝fold 1 回（同一 task の 2 回も 2 回）／`$on` より先／ループ文脈の indexes。
- `resetOn`: 載ったら `initial`・fold は skip／nonce による手動 reset。
- 寿命: 切断中は畳まない・再接続後に再開・出力は保持／`_state` 再セットで作り直す／SSR で fold しない／ボリューム raise・マウント warn。
- 検査: §1-2 の各 raise。throw した再セットが旧世代に残ること（`integration.stateGenerationReset.test.ts` と同型）。

---

## 5. 実測と、Issue #272 の推奨からの変更（2026-09-13）

### 5-1. G0 の決着

Issue #272 の G0 は「D1 は `$scan` としてプロトタイプされていない」だった。Phase A〜D をそのまま実装として書き、次を実測した。

| 項目 | 結果 |
|---|---|
| e2e `state-intersect-scroll` 6 本（`$scan` へ書き直した example・ローカル dist） | 全 pass（spec は無改変） |
| scan → watch の発火順 | `scan.from.test.ts` で固定 |
| `acc` と同一参照を返したら書かない（出力の `$watch` も鳴らない） | `scan.from.test.ts` / `scan.on.test.ts` で固定 |
| fold の `this` | `undefined`（D4。Issue の書き直し案の readonly `this` は採らなかった） |
| `$watch.<path>` と `$scan{from:<path>}` の同居・同じ `from` の 2 scan | 各 1 回（`scan.from.test.ts`） |
| wildcard `from` の同一バッチ複数行・2 段 wildcard | 添字昇順に連鎖して 1 回書き（`scan.from.test.ts` / `scan.runtimeEdges.test.ts`） |
| progress chunk（loading / retrying）での行 getter の再評価 | 0 回（`scan.streamCommit.test.ts`）。D5（`$streams.persist`）で実測された全行再展開は起きない |
| 同じ page の再着地（done 後の Retry・再接続） | page キーで捨てる。キーが要ることも固定（`scan.streamCommit.test.ts`） |
| restart が勝つ（D10）・自己ループの柵（D9） | `scan.from.test.ts` で固定（restart 経路の `$streamError` 正規化を含む） |
| `wcs-validate` の診断（example の書き直し前後） | どちらも 0 error・同じ 4 warning（行フィールドの `binding-path-missing`） |
| カバレッジ | `src/scan/` 100 / 100 / 100 / 100。state 全体は閾値内 |

未計測のまま残したもの: `$listKeys` を出力そのもの（平坦な配列）に付けたときのキー突合（D14 は機構の読みに基づく）、成功 chunk の fold と `sink.done()` が同じバッチに合流するかのホップ数（G8-d。e2e の挙動には現れない）。

### 5-2. 推奨からの変更

| 論点 | Issue #272 の推奨 | 採った形 | 理由 |
|---|---|---|---|
| source の種類（G3-a） | 第 1 段は path のみ、event-token は第 2 段 | **`from` と `on` の両方を第 1 段に入れた**（D2） | 同型 13 サイトのうち 11 は要素所有の出来事で、path の `from` では state semantics の occurrence（`loading` の true→true）と同一 task の複数回を落とし、初期同期を拾う（G10）。同期 subscriber にすれば lane §9-2 の保留理由（bridge の microtask・initial リセット）が当たらない |
| reset の形（G2-b） | `$streams.args` と同じ関数の依存捕捉 | **`resetOn` をパスの配列にした**（D6） | 値を返す必要が無く、静的に検査でき、getter を読む reset（依存書き込みごとの wipe）を宣言時に拒否できる |
| registry（G0-4） | watch registry に第 3 台帳 | **別モジュールの scan registry** から watch runtime が引く | watch の registry は path につき entry 1 個で、同居と同 `from` の 2 scan を載せられない。発火対象集合・連鎖深さ・prev 台帳は共有した |
| fold の `this`（G8-j） | readonly `this` | **渡さない**（D4） | 規則が 1 本減り、`$streams.fold` と揃う。必要な値は source の値に載せる（example は chunk に `pageSize` を載せた） |

### 5-3. 見つけた既存欠陥

ルート `<wcs-state>` を付け直すと `$on` と command-token の購読が失われる（[#273](https://github.com/wcstack/wcstack/issues/273)）。`on` の scan は同じ購読経路に乗るので同じく止まる（`scan.on.test.ts` の `DEFECT(#273)`）。

### 5-4. 実装レビューで直したもの（2026-09-13）

| 指摘 | 実測（修正前） | 対処 |
|---|---|---|
| 連鎖した scan（`history.from` が `total` の出力）で、上流の source を `$watch` が同じ drain に書くと、下流が先取り・二重に畳む | 上流を先に宣言すると `history = [3, 6, 6]`、下流を先に宣言すると `[1, 3, 6]` | D18（計画 → 書き込みの 2 相）。`scan.from.test.ts` が両方の宣言順で `[1, 3, 6]` を固定 |
| `on` の scan の `resetOn` が drain 終端でしか効かず、書き込みより後の出来事まで消す | 同じジョブで `server = "b"` の後に来た出来事、および `data-wcs="src: server"` の setter が同期に dispatch した `started:b` が `[]` に消える。`<wcs-fetch>` は自動 fetch を `queueMicrotask` に回すので当たらない | D6 改訂（enqueue 時点の保留 reset）。`scan.on.test.ts` が同じジョブ・2 回書き・同期 dispatch・fold の throw・切断中の書き込みを固定 |
| `resetOn` が `from` の子孫だと reset が毎回勝ち、一度も畳まれない | — | 宣言時 raise（runtime・vscode-wcs）。祖先は許し、`scan.from.test.ts` が「行の書き込みは畳み、親の差し替えで作り直す」を固定 |

---

## 関連

- [Issue #272](https://github.com/wcstack/wcstack/issues/272) — 外部評の判定・13 サイト・5 案比較・反証・決定ゲート
- [state-watch-hook-design.md](./state-watch-hook-design.md) — drain 終端フック・prev 台帳・連鎖深さ・§12（`$effects` 非スコープ）
- [state-streams-design.md](./state-streams-design.md) — §3-2（restart が勝つ）・§6（有界 fold・新値 return）・§8（第 1 段スコープ外）
- [state-event-lane-design.md](./state-event-lane-design.md) — §7-2（`$t` は生えない）・§9-2（event-token を source にする案の保留。本書 D2 の `on` がその再開であり、保留理由 3 点は「`$streams.source` への bridge」に対するもので、同期 subscriber には当たらない）
- [state-redesign-council.md](./state-redesign-council.md) — ADR-4（Gate 0）・ADR-6
