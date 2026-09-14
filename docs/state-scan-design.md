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
| **D3** | 発火単位（G8-a/b） | `from`: **drain 終端で、バッチに載った絶対アドレス 1 つにつき fold 1 回**（変化の scan）。同一 job 内の複数書き込みは 1 回に畳まれる。wildcard の行の着地は、drain の時点のリストの位置 1 つにつき 1 回に絞る — 位置に行が無いアドレス（行を書いてからリストを短くした）は畳まず、同じ位置にいまそこに居る行のアドレスと外れた行のアドレスが並んだら前者だけを畳む。外れた行を添字で読むと、別の行の値を二重に畳むか範囲外で throw するため（§5-5）。`on`: **イベント 1 回につき fold 1 回・同期**（出来事の scan）。`on` には drain を待つ遅延が無い。 |
| **D4** | fold 契約（G8-j） | 同期・純粋・**新しい値を返す**。`this` は渡さない（`$streams.fold` と同じ）。引数は `from` が `(acc, cur, prev, ...indexes)`、`on` が `(acc, event, ...indexes)`。`acc` と同一参照を返したら書かない。throw と thenable の戻り値は報告して書かない（例外隔離）。報告は値の読み（`from` の行・出力）・fold・出力の書き込みで分け、devtools の `state:watch-error` の phase を `evaluate` / `fold` / `write` にする。読めない行はその行だけを捨て、同じバッチの残りの行は畳む（`$watch` が行ごとに evaluate で閉じるのと同じ。§5-5）。 |
| **D5** | getter を source に許すか（G4） | **許さない**。`from` 自身またはその祖先パスが getter なら宣言時 raise。`$recursion` の `**` getter の展開形（`get "nodes.**.total"()` に対する `from: "nodes.*.total"`・その値の内側）も getter として宣言時 raise（`_state` セッターが `$scan` の検査より前に作る再帰レジストリの `recursiveGetterOwning` で引く。§5-7）。接ぎ木（ボリューム）で後から getter になった `from` は発火時に検出して報告し、その scan の fold を止める（`resetOn` は getter を読まないので、reset は引き続き `initial` に戻す。§5-8）。getter の無い setter を `from` にした形（その配下を含む）も、読むと常に `undefined` なので宣言時 raise（`wcs/scan-declaration-invalid`）。`resetOn` の setter は値を読まない引き金として通す（§5-8）。 |
| **D6** | reset（G2） | `resetOn: ["<path>", ...]`（平坦な state パスの配列）。どれかがバッチに載ったら**出力を `initial` に戻し、そのバッチの fold は行わない**（reset が勝つ）。戻すのは**出力だけ**で、協調するカーソル（`page` 等）は戻さない（G2-a (i)）。発火はアドレス駆動で値比較なし（`$streams.args` と同じ。primitive は same-value guard により実質変化時のみ）。getter・wildcard・`$` 始まり・自分の `from` とその子孫・scan 出力（自他とも）は raise（`from` の祖先は「親の差し替えで作り直す」として許す）。ユーザー起点の reset は nonce を `resetOn` に読ませる（G2-c）。**`on` の scan では reset を enqueue の時点で保留する**: 保留中に来た出来事の fold は `initial` から畳んで保留を消し、保留が残ったまま drain に来たら `initial` に戻す。書き込みより後の出来事（その書き込みの binding 適用で要素が同期に dispatch したものを含む）を消さないため（§5-4）。保留を消すのは出力の書き込みが通った後（fold の throw・thenable・書き込みの throw なら残し、drain が `initial` に戻す）。drain がそのバッチの scan を発火しない（書き込みの後・drain の前に切断・連鎖深さの上限・先行 fold による同期の切断や再セット）ときは保留を捨てる — `from` の scan が reset しないのと揃える（§5-5）。ただし同じ `resetOn` のパスが次のバッチ向けに既に積まれていれば、その保留は次のバッチのものとして残す（§5-6）。相 1 / 相 2 の再確認で捨てる `on` の reset の計画でも同じ規則。書き込みと drain のあいだの `_state` 再セットでは、旧宣言の保留を、同じ出力名で、まだ drain されていない書き込みのパスを新旧どちらの `resetOn` にも持つ `on` の scan へ引き継ぐ（旧の保留は発火対象への書き込みでしか立たないので、enqueue の時点で立つ契約は変わらない。§5-8）。引き継ぎは書き込みがまだキューに残っている場合だけ（C2-2 / C2-16 と同じ「キューに積まれていれば」の 1 つの規則）。その書き込みのバインディング適用中の再セット（`$updatedCallback`・適用中に走る `$on`。scan の相より前）・再セットで足した reset 条件・`from` → `on` の変更では引き継がず、`on` の scan は書き込み済みの値を reset しない（`from` の scan は reset する）。同じ drain のそれより後では揃う — `$watch` ハンドラからの再セットは scan の書き込みの後なので両方 reset し、相 1 の fold からの再セットは旧宣言の group が live でなくなるので両方 reset しない（発火しない drain は保留を捨てる規則）。揃えたいときは再セットの後で `resetOn` のパスを書き直す（仕様の線引き・§5-8）。オブジェクトのパスは、そのオブジェクト自身が書かれたときだけ reset し、子への書き込みでは reset しない（アドレス駆動。子の変化で戻したいなら葉のパスを並べるか nonce を使う）。 |
| **D7** | 出力 | 名前は平坦（`.` / `*` / `$` 始まり / 空文字 / `Object.prototype` 継承名を raise）。getter・setter・メソッド（関数値のプロパティ）・`$streams` 名との衝突は raise（`initial` 自身が関数で、その値が既に置かれている形は同じオブジェクトの再セットとして通す。§5-5）。**未定義なら `initial` で実体化し、既に値があれば保持する**（同じオブジェクトの再セット・SSR ハイドレーションで累積を失わない）。実体化と reset は plain なデータの `initial` を複製して置き（plain なデータ ＝ プロトタイプが `Array.prototype` / `Object.prototype` / null で、凍結されておらず、自前のプロパティがすべて列挙できる文字列キーのデータプロパティ（配列は添字と `length` だけ）の配列とオブジェクト。getter / setter・Symbol キー・列挙できないプロパティ・配列の追加プロパティ・Array のサブクラス・凍結された値・関数・クラスのインスタンス・`Map` / `Set`・`Date`・DOM ノードは参照のまま。判定は descriptor で行い getter を実行しない。plain でない値は `initial` 自身でも内側でも宣言と同じ参照のまま出力に入り、その中へ書くと宣言の `initial` も書き換わって reset でも戻らない — 凍結された値へ書くと throw する。累積と reset の対象は plain なデータに保つ）、reset は出力が既に `initial` と同じ値なら書かない（値で比べる。`on` の scan の保留中の fold に渡す acc も同じ規則。§5-9）。`$streams` の `initial` は従来どおり参照のまま置く（範囲外）。fold が関数を返す出力は、その関数値を実体化・fold・reset がその出力に置いたことがあれば、再セットでメソッド衝突としない（置いた関数値を出力名ごとに WeakMap で記録するので、どの世代の state オブジェクトに書かれても判定がずれない。runtime（実体化・fold・reset）が置いていない関数値はすべて raise する — 新しいオブジェクトの同名の本物のメソッドや、ハンドラ・メソッド・`$resolve` / `$setAll`・state への直接の書き込みで出力へ書いた関数。§5-9）。 |
| **D8** | 寿命（G6） | 出力は通常の state 値として**切断・再接続を跨いで保持**する。切断中の出来事は畳まない。scan の書き込みは同じ drain の `$watch` の発火より前（D11）なので、`$watch` ハンドラが要素を同期に切断しても、接続中に着地した分は畳んで書かれて残る（§5-6）。`from` は再接続で再開する（`$watch` と同じ二段構え）。`on` は `$on` と同じ購読経路に乗るので、ルート `<wcs-state>` の再接続で購読が戻らない既存欠陥（[#273](https://github.com/wcstack/wcstack/issues/273)）を共有する。#273 を直せば `$on` と一緒に戻る（`scan.on.test.ts` の `DEFECT(#273)` を反転させる）。`_state` の再セットで宣言を作り直す。SSR では `from` は発火せず出力の実体化だけを行い、`on` は `$on` と同じ扱い。ボリューム（`mount=`）での宣言は raise、マウントされたコンポーネントでは warn（`$streams` / `$watch` と同じ扱い）。 |
| **D9** | 自己ループの柵（G5） | `from` の根が `$streams` 名である scan について、**その stream の `args` 依存に、scan 出力から到達できるパスが含まれていたら raise**（到達は依存グラフの辺に加えて、到達したパスを `from` に持つ別の scan の出力も辿る。§5-5。起動時は stream の開始が throw して正規化されない — stream は `idle` のまま、接続の `connectedCallbackPromise` は解決しない（`args` の自己依存と同じ着地・§5-6）。依存駆動 restart では `$streamError` に正規化）。「scan 出力 → getter → 同じ stream の args」は、sentinel を経由せずに全ページを読み続ける（冪等キーが無ければ無限に再取得する）前進ループになるため。 |
| **D10** | 同居バッチの優先順（G11） | `from` の根が `$streams` 名で、**同じバッチにその stream の restart 依存が載っていたら fold しない**。`$streams` §3-2「restart が勝つ」に揃える（到着した chunk は abort される run のもの）。 |
| **D11** | 機構間の順序（G8-f） | watch runtime の drain リスナー（`WATCH_LISTENER_PRIORITY`）内で **`$scan` → `$watch`**。`from` / `resetOn` は計画・書き込み（D18）の 2 相とも `$watch` の発火より前（書き込みを `$watch` の後に回す案は §5-6 で差し戻した）。連鎖深さ（32 段）・`prev` 台帳・例外隔離・発火対象集合を `$watch` と共有する。`on` の fold は同じトークンの `$on` ハンドラより**先**に走る（reducer → effect の順）。 |
| **D12** | scan 出力を `$watch` したときの `prev`（G8-h） | **ふつうは `undefined`**。scan の書き込みは drain リスナーの内側（同じ drain の `$watch` の発火より前）で起き、`prev` 台帳は同じ drain の watch リスナー（`$scan` / `$watch`）の終わりに消える（その後に走る `$streams` restart のリスナーの書き込みは `prev` を持つ。§5-8）。`$watch` ハンドラの書き込みを別の `$watch` で見たときと同じ。同じ drain の `$watch` ハンドラは畳んで書いた後の出力を読み、ハンドラが出力へ書いた値はそのまま残る。**契約**: 出力の着地が drain される前に `from` の source がもう一度書かれ（scan の書き込みの前後を問わない — 同じ drain のバインディング適用中の `$updatedCallback`・そこで同期に dispatch されたイベントの `$on`・同じ drain の `$watch` ハンドラ・次の drain より前に走る microtask など）、出力の着地と source の新しい着地が同じバッチに載ると、そのバッチの scan は `$watch` の発火より前に出力をもう一度書く。出力を見る `$watch` は `prev` に着地した値を受け、`cur` に 1 段先の値を見て、次のバッチで同じ値でもう一度（`prev` は `undefined`）発火し得る（オブジェクトの出力は `prev` が常に `undefined` で、同じ値の 2 回目だけが残る）。バインディング適用中（scan の書き込みより前）に書かれた形では、fold もバッチの確定値を 2 回受け取る（途中の値は一度も畳まれず、値の合計がずれ得る）。D3（バッチの確定値を読む）と `$watch` からある既存の性質で、`$scan` の退行ではない。この連鎖を組むなら、出力を見るハンドラを同じ値の重複に耐える形（冪等キー・直前に処理した値との比較）にする。書き込みを `$watch` の後に回してこれを塞ぐ案は §5-6 で差し戻した。ユーザー起点の消去は nonce を `resetOn` に読ませる形を勧める。 |
| **D13** | 前提（G8-i） | `config.sameValueGuard` 既定 ON が前提。OFF では `from` の primitive は書き込み回数を数え、`prev` も `undefined` になる（非サポート）。 |
| **D14** | `$listKeys` × 出力（G9） | キー突合は**出力そのものが配列**のときだけ効く（書き込みアドレスが宣言リストパスと一致する必要があるため）。オブジェクト出力の子配列（`feed.items`）には効かない。 |
| **D15** | bound path の初期同期（G10） | `from` は state の書き込みを見るので、要素出力の初期同期（directional initial sync）も 1 回の変化として畳む。**要素の出来事は `on` で受ける**ことを規範にし、runtime は書き手を区別しない。 |
| **D16** | pre-drain gate（G8-g） | 採らない。drain 終端で始め、`from` の 2 hop 遅延が実害になった時点で再評価する。`on` は同期なのでこの問題を持たない。 |
| **D17** | signals 共有契約（G7） | 該当なし（`$streams.persist` 案を採らないため、`$streams` の restart-reset 契約は不変）。 |
| **D18** | 同じ drain での scan 間の読み（§5-4） | drain 側の発火を **計画 → 書き込みの 2 相**にする。全 scan の次の値を読むだけで決めてから、宣言順に書く。2 相とも同じ drain の `$watch` の発火より前（D11）。1 相で「畳んでは書く」と、別の scan の出力を `from` に取る scan が同じ drain で先行 scan の書いたばかりの値を先取りし、次のバッチで同じ値をもう一度畳む（届いていた値は取りこぼす）。宣言順しだいで exactly-once が破れる。 |

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
| `from` | `string` | `on` と排他で 1 つ | state パス。wildcard 可（行ごとに発火）。`$` 始まり・`@` を含むパスは不可。getter（祖先を含む）不可。自出力・自出力の子孫は不可。 |
| `on` | `string` | `from` と排他で 1 つ | `$eventTokens` に宣言済みのトークン名。 |
| `initial` | any | ✔ | 実体化の種と `resetOn` の戻り先。 |
| `fold` | function | ✔ | D4。 |
| `resetOn` | `string[]` | — | D6。 |

### 1-2. 宣言時の検査（raise）

`value` だけを読む検査なので、`_state` セッターの「世代を進める**前**」の群に置く（throw した再セットは旧世代のまま残る）。code は `wcs/scan-declaration-invalid`・`wcs/scan-source-computed`・`wcs/recursion-unsupported` の 3 つ。

- `$scan` がオブジェクトでない／エントリがオブジェクトでない。
- 出力名（D7）。getter / setter / メソッド / `$streams` 名との衝突。
- `from` と `on` がどちらも無い／両方ある。`on` が `$eventTokens` に無い。
- `from` が空・`$` 始まり・`@` を含む・空セグメント・wildcard 深度超過・getter（祖先・`**` getter の展開形を含む）・getter の無い setter（祖先を含む）・自出力またはその子孫。
- `from` / `resetOn` の `**`（`$recursion` の有無を問わず `wcs/recursion-unsupported`。PathInfo の不変条件で落ちる）。
- `initial` が無い。`fold` が関数でない。
- `resetOn` が文字列配列でない／要素が getter・wildcard・`$` 始まり・自分の `from`・自分の `from` の子孫・いずれかの scan 出力（またはその子孫）。
- scan 出力を介した循環（A の `from` の根が B の出力、B の `from` の根が A の出力、…）。

---

## 2. ランタイムモデル

### 2-1. `from` の発火（D3・D10・D11）

watch runtime の drain リスナー内で、`$watch` の収集より前に scan を収集・発火する。

1. バッチの各絶対アドレスについて、発火対象の stateElement の scan registry を `from` パスと `resetOn` パスで引く。発火対象でない state のアドレスに当たる `on` の scan の保留 reset は捨てる（§2-2）。
2. entry ごとに「reset hit があるか」「from hit（行ごと）があるか」をまとめる。
3. **相 1（計画）**: 宣言順に、次の値を読むだけで決める。1 entry につき `createState("readonly")` を 1 回（D18）。
   - 直前に registry の identity と発火対象集合を再確認する（先行 fold が同期に切断・再セットを起こし得る — `$watch` と同じ）。
   - reset hit があれば「`initial` を書く」計画にして終わる（D6）。
   - `from` が後から getter になっていたら報告して止める（D5）。
   - `from` の根が `$streams` 名で、その stream の依存がバッチに載っていれば何もしない（D10）。
   - 行を indexes 昇順に並べ、`acc = fold(acc, cur, prev, ...indexes)` を連鎖し、開始値と `Object.is` で異なるときだけ書く計画を立てる。
   - wildcard の行は、外側の段から台帳を引き直して位置 1 つにつき 1 つに絞る。位置に行が無いアドレスは捨て、同じ位置では、いまそこに居る行（同じ行か、同じリスト要素を表す行）のアドレスを外れた行のアドレスより優先する（D3）。`cur` の読みが throw した行は、その行だけを報告して飛ばす（D4）。
4. **相 2（書き込み）**: 計画を宣言順に書く（同じ drain の `$watch` の発火より前）。1 計画につき `createState("writable")` を 1 回。直前に同じ再確認をする（後続の scan の fold が同期に切断・再セットし得る）。`on` の scan の reset は保留が残っているときだけ書く（§2-2）。再確認で落ちた `on` の group（相 1 を含む）は保留を捨てる（同じ `resetOn` のパスが次のバッチ向けに積まれていれば残す）。
5. 出力の読み・fold の throw・thenable の戻り値・書き込みの throw は entry ごとに閉じて報告する（devtools の phase は `evaluate` / `fold` / `write`）。
6. scan 発火は `beginWatchFiring` の内側で行う（scan の書き込みも連鎖深さに数える）。

`prev` は `$watch` と同じ台帳から取る。そのため `from` パスは `$watch` のパスと並んで旧値キャプチャのゲートに入る（`scanPaths`）。

### 2-2. `on` の発火（D3・D11）

event-token の subscriber として登録する。`_state` セッターで `clearEventTokenRegistry` の直後・`processOnDeclaration` の直前に購読するので、同じトークンでは `$on` ハンドラより先に呼ばれる。

subscriber は `(state, event, ...indexes)` を受け、`state[output]` を読んで fold し、同一参照でなければ書く。例外は閉じて報告する（後続の `$on` ハンドラを巻き添えにしない）。

`resetOn` は書き込みの時点で効かせる（D6）。updater の enqueue に葉モジュール（`scan/eventReset.ts`）のフックを置き、発火対象の state で `on` の scan の `resetOn` アドレスが enqueue されたら、その entry に reset を保留する。subscriber は保留があれば `initial` から畳み、出力の書き込みが通ったら保留を消す（fold の throw・thenable・書き込みの throw なら保留を残し、drain が `initial` に戻す）。drain 側は保留が残っているときだけ `initial` を書き、そのバッチの scan を発火しないとき（書き込みの後・drain の前に切断された state・連鎖深さの上限・再確認で落ちた group）は保留を捨てる（同じ `resetOn` のパスが次のバッチ向けに積まれていれば捨てない）。保留は「そのバッチの drain で戻す」予約なので、発火しない drain の後まで残すと、後の無関係な出来事が突然 `initial` から畳み始める。`resetOn` を持つ `on` の scan が発火対象（接続中）の state に無ければ — そうした state を DOM から外した後も含めて — フックは整数比較 1 回で抜ける。ゲートは registry の数ではなく watch runtime の active 集合への出入りで数え、保留を捨てる走査は保留の数で抜ける（§5-7）。

### 2-3. 自己ループの柵（D9）

`startStream`（起動・restart の共通手順）で `traceArgs` の後に検査する。`from` の根がこの stream 名である scan それぞれについて、出力パスから `staticDependency`（子）・`dynamicDependency`（依存する getter）・到達したパスを `from` に持つ別の scan の出力を辿った到達集合を作り、`args` の依存パスと交われば raise する。前の 2 つは `walkDependency` が書き込みを伝播させるのと同じグラフ、最後の辺は依存グラフに無いが、その scan が次のバッチで畳んで書くので書き込みは届く。合わせて「書き込みが args に届くか」をそのまま判定できる。

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

未計測のまま残したもの: 成功 chunk の fold と `sink.done()` が同じバッチに合流するかのホップ数（G8-d。e2e の挙動には現れない）。`$listKeys` を出力そのもの（平坦な配列）に付けたときのキー突合（D14）は、§5-9 の C5-6 で計測してテストで固定した。

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

### 5-5. 品質向上サイクルで直したもの（2026-09-13）

| 指摘 | 実測（修正前） | 対処 |
|---|---|---|
| 行の `cur` の読みの throw が fold の throw と同じ catch に落ち、グループ全体が捨てられる | 3 行の `items` で行 0・2 を書き、同じ job で `items.slice(0, 2)` にすると `log = []`。報告は「fold threw」 | 行ごとに読みを閉じ、読めない行だけを捨てて連鎖を続ける。報告を読み（`from` の行・出力）・fold・書き込みで分ける（D4）。`scan.from.test.ts` / `scan.runtimeEdges.test.ts` / `scan.on.test.ts` |
| 同じ job で行を書いてからリストを置換すると、退役した行のアドレスが新しい行の値で読まれる | `[{qty:1},{qty:2}]` で行 0 を書いて `items = [{qty:7},{qty:8}]` → `["0:1->7", "0:undefined->7", "1:undefined->8"]` | 外側の段から台帳を引き直し、行の着地を位置 1 つにつき 1 回に絞る（D3）。位置に行が無いアドレスは捨て、同じ位置では、いまそこに居る行（同じ行か、同じリスト要素を表す行）のアドレスを優先する。外れた行のアドレスしか無い位置は畳む — 入れ子のリストを置き換えると、書き込みの依存展開が置き換える前の行でアドレスを載せ、それがその位置の唯一の着地になるため（外れた行を一律に捨てる形・差分の退役印で見る形は、この着地を落としたので採らない）。その代わり、行を書いた同じ job でその行をリストの途中から取り除き、移ってきた行が着地しないときは、移ってきた行の値を 1 回畳む（修正前・`$watch` と同じ。残課題）。短縮・空配列・位置の競合・2 段 wildcard を `scan.from.test.ts` が固定 |
| `on` の fold が保留中の reset を書き込みの**前**に消費する | 書き込みを 1 回拒否すると `log = ["a1"]`・保留 false のまま、drain 後も reset されない | 書き込みが通ってから消す（D6）。Promise を返した fold と合わせて `scan.on.test.ts` |
| drain がそのバッチの scan を発火しない経路で保留が残り、後の無関係な出来事で出力が reset される | 連鎖深さ 33 のバッチで `server` を書くと、後の `x` で `["x"]`。書き込み → drain 前に切断でも保留が残る | 発火しないバッチ（非 active・連鎖深さの上限）と再確認で落ちた group の保留を捨てる（D6）。`scan.on.test.ts` |
| D9 の到達探索が scan の `from` → 出力の辺を辿らない | `feed.from = "pageResult"`・`feed2.from = "feed"`・`page` が `feed2` から導出 → raise せず runs が `[1..6]` | 到達したパスを `from` に持つ scan の出力も辿る（D9）。`scan.from.test.ts` |
| 出力名がメソッドと衝突しても通り、最初の `acc` が関数になる | `log() {}` と `$scan.log` で無言、`typeof state.log === "function"` | raise（D7）。関数の `initial` が置かれている再セットは通す。`scan.processScanDeclaration.test.ts` |
| 静的検証が runtime と食い違う | scan 同士の循環が無診断・`from: "nodes.**"` の code 違い・`from: 1` が無診断・空の出力名で中身を出力名と誤読（3 件の誤診断）・メソッド衝突が無診断 | vscode-wcs で循環検出（出力名と `from` の根だけで決まる）・`**` は `wcs/recursion-unsupported`・文字列でない `from` / `on` / `resetOn` 要素・空の出力名・メソッド衝突。ワイルドカード段数の上限（128）は `$watch` と同じく静的には見ない |
| D5 後段（接ぎ木で getter になった `from`）が devtools に出ず、書き込み失敗も `phase: "fold"` | — | late getter も devtools へ（`phase: "fold"`）。書き込み失敗は `phase: "write"`、読みの失敗は `phase: "evaluate"`。devtools protocol の union に `"write"` を足した |
| 世代を進めた後の検証で throw した再セットに残る `$scan` が未固定 | `$watch` で落とすと registry は新宣言・発火対象外で、旧も新も畳まない | 挙動は変えず、`integration.stateGenerationReset.test.ts` が `$on` / `$streams`（旧宣言が発火対象に残り、新しい state に無い旧出力を読めずに報告）と `$watch`（新宣言だが発火対象外）を 1 本ずつ固定 |
| docs の不足と古い記述 | `resetOn` のオブジェクトパスは子の書き込みで reset しない・`prev` が `undefined` になる条件・機構順序に `$scan` が無い箇所 | `scan(.ja).md`・README に追記。watch 設計書・view-transition 設計書・updater / watchRuntime のコメントを `$updatedCallback` → `$scan` → `$watch` → `$streams` restart に追随 |
| 再検証: `prev` が `undefined` になる条件を「drain のリスナーの中」に絞りすぎていた | バインディング適用中に `$updatedCallback` が `from` を書くと `[[10, undefined]]`（ふつうの書き込みは `[[10, 0]]`）。適用中に要素が同期に dispatch したイベントの `$on` の書き込みも `undefined` | `scan(.ja).md` の条件を「前のバッチの drain の最中（バインディング適用中とリスナー）」に広げた。`scan.from.test.ts` / `scan.on.test.ts` が 2 つとも固定 |
| 再検証: 計画の相（D18）の `placementOf` が、親ポインタを修理する `resolveListIndexesByList` で台帳を引いていた | — | 観測用の `getListIndexesByList` に替えた。`isSameListIndexValue` は読むだけの判定なので使い続け、list 側 2 モジュールのコメントに scan からの利用を書き足した |

#### [#274](https://github.com/wcstack/wcstack/issues/274) — 行の着地の穴（`DEFECT(#274)`）

再検証で見つかった、`$scan` 固有ではない既存欠陥（K1）と、それを落とさないために緩めた D3 の選別の副作用（K2）。1 つの Issue（[#274](https://github.com/wcstack/wcstack/issues/274)・2026-09-14 起票）で追う。`scan.from.test.ts` の `DEFECT(#274)` 2 本が現状を固定し、`scan(.ja).md` の「行の着地の既知の穴」に利用者向けの注記がある。

| 再現 | 実測 | 根の見立て |
|---|---|---|
| K1: `groups[0].items` が 1 行の状態で `$resolve("groups.*.items", [0], [{qty:5},{qty:6}])` | scan は `["0.0:5"]`、`$watch` は 1 回（DOM は `5`・`6` を描く）。バッチに載る行のアドレスは旧配列の行（値 `{qty:1}`）の `0.0` だけ | `setByAddressCore` は依存ウォーク（`notifyWrite`）を `commitWriteCache` より**前**に走らせる（fast path も通常経路も）。ワイルドカードを含むパス（`groups.*.items`）はキャッシュ対象なので、ウォークのリスト展開が書いたパス自身を読むと書き込み前の配列がヒットし、基準との差分が「変化なし」になって旧配列の行だけを展開する。トップレベルのリストはキャッシュされないので起きない。書く前にそのアドレスのキャッシュを dirty にすると 2 行とも着地することをプローブで確認した（src は未変更） |
| K2: `[1,2,3]` で行 1 を 20 に書き、同じ job で行 1 を取り除く | `["1:2->3"]` — 変わっていない行 C の値を、取り除いた B の `prev` で 1 回畳む | 位置だけが変わった行は着地しない（依存展開は index 依存 getter しか展開しない）。D3 の選別は、K1 と同じ根で「同じ長さの入れ子置換では旧配列の行のアドレスがその位置の唯一の着地になる」形を落とさないため、外れた行しか無い位置を添字で読んで畳む。K1 が直れば置換で入った行が自分のアドレスで着地するので、`selectLandedRows` で `replaced` を `gone` と同じく捨て、K2 の DEFECT テストを `[]` に反転できる見込み |

提案（このブランチでは実装しない）: `notifyWrite` の `walkDependency` の前で、書いたアドレス自身のキャッシュを dirty にする。ウォークのリスト展開が書いたばかりの配列を読むようになる。直後の `commitWriteCache` がキャッシュを載せ直すので、書き込み後の読みのコストは変わらない。

### 5-6. 品質向上サイクル 2 で直したもの（2026-09-13）

| 指摘 | 実測（修正前） | 対処 |
|---|---|---|
| 出力の着地と source の新しい着地が同じバッチに載ると、出力を見る `$watch` の cur が 1 段先行し、prev が値を持つ（当時の D12「常に `undefined`」と食い違う） | `total{from:"count"}` を `$watch.count` が 3 まで進めると `$watch.total` が `[[3,1],[6,3],[6,undefined]]`（1 が見えず、6 が 2 回）。オブジェクト出力は `[[2,-],[3,-],[3,-]]` で同じ値を 2 回 | 一度は相 2（書き込み）を同じ drain の `$watch` の発火の後に回した（`$watch.total` は `[[1,undefined],[3,undefined],[6,undefined]]`）が、派生の穴が続いたので下の「差し戻し」で戻した。実装では塞がず、D12 に契約（条件・prev・cur・同値の 2 回目・重複に耐えるハンドラの勧め）として明文化した。`scan.from.test.ts` が `$watch` ハンドラ・オブジェクト出力・microtask で source を書き進める形と、同じ drain のハンドラが畳んだ後の出力（`[[1,1],[2,3],[3,6]]`）を読むことを固定 |
| 保留 reset が entry ごとの 1 bit で、連鎖深さの上限で打ち切ったバッチの破棄が、次のバッチに積まれた同じ `resetOn` の保留まで消す（第 1 サイクルの修正で入った経路） | 深さ 33 のバッチで `server="b"`、その binding 適用中の `$updatedCallback` が `server="c"` → `log=["a1"]`（reset されない）・`fromLog=[]`（reset された） | 捨てる前に、その entry の `resetOn` のパスが updater の未 drain のキュー（次のバッチ）に積まれているかを見て、積まれていれば残す（`Updater.hasQueuedPath`）。`scan.on.test.ts` |
| `wcs/scan-path-missing` の存在照合が `$recursion` の展開形を認めない（`$watch` と食い違う誤警告） | `nodes.*.children.*.children.*.value` で `$watch` は無診断、`$scan` だけ warning（runtime は warn 0 件） | `$watch` と同じ `matchesRecursion` で照合。vscode-wcs テスト |
| `$scan: []` を静的に拾わない | 無診断（runtime は `Array.isArray` で raise） | 値全体が配列リテラルなら `wcs/scan-declaration-invalid`（`$watch` は配列を拒否しないので `$scan` だけ） |
| ボリューム・マウントされたコンポーネントの `$scan` をルートと同じに検証する | `mount="vol"` に `$scan` を置いても無診断 | ボリュームは error、`bind-component` は warning にして中身は検証しない（`$recursion` と同じ扱い）。`$streams` の同じ穴はこのブランチの範囲外 |
| README の「存在しないパスへの配線」表に `$scan` が無い | — | 英日の表に `wcs/scan-path-missing` の行を足し、導入文に `$scan` を加えた |
| プリアンブルの `this` に scan の出力（と `$streams` の値）が載らない | strict で `this.feed` / `this.pageResult` が `Property does not exist on type '_WcsThis<…>'` | `_WcsThis` に宣言キーを `any` で写す `_WcsDeclaredValues` を足した（`initial` の型は空配列が `never[]` になるので使わない） |
| §1-1 の `from` の行が「`$` / `@` 始まり不可」 | — | 「`$` 始まり・`@` を含むパスは不可」に揃えた |
| D9 の「起動時は loud fail」がテストで固定されておらず、そのとおりに観測できない | 起動時から args が feed 由来の getter を読むと、`connectedCallbackPromise` が pending のまま、status は `idle`、console・unhandledRejection とも 0 件（`args` の自己依存と同じ既存の着地） | 挙動は変えず、起動時の着地（stream の開始が throw・正規化されない・接続が解決しない）をテストで固定し、D9・`scan(.ja).md` の文言を観測できる形に直した |
| tracked な `packages/lint/dist/cli.cjs` が古く、ローカルの lint smoke が新しい scan のケースで落ちる | `2/20 smoke case(s) failed` | vscode-wcs の修正の後に `packages/lint` を build して再生成した（前例 `d11b29bd`） |
| 再検証（C2-1 の退行）: 相 1 と相 2 の間に同じ drain の `$watch` ハンドラが出力を書くと、相 2 が古い acc から作った値で黙って上書きする | `$watch.n` が `n===2` で `log = []` → `log=[1,2]`。`$watch.host` の seed を reset の計画が `[]` で上書き。同じ job の `n=6; clear=1` で `total=11` | 書き込みを `$watch` の後に回した C2-1 の派生。一度は同じ drain のハンドラが出力へ書いたら計画を黙って捨てる規則を足した（検出は下の「再検証 2」で書き込みの試みに替えた）。「差し戻し」で順序が戻り、ハンドラは scan の書き込みの後に走るので、規則ごと要らなくなった。最終値は `[]`・`["seed:b"]`・`0`、連鎖した scan は `[100, [1, 100]]`（scan の書き込みとハンドラの書き込みが次のバッチの 1 回の着地になる）。`scan.from.test.ts` がタイトルと説明を直して固定し続ける |
| 再検証: 同じ drain の `$watch` ハンドラが要素を切断すると、接続中に着地した分の計画が捨てられる | `$watch.n` が `n===2` で host を remove → `total=1`、再接続後も 1（書き込みを `$watch` より先にしていたときは 3） | C2-1 の派生。一度は「同じ drain のハンドラのしたことが勝つ」規則として D8 に書いたが、「差し戻し」で書き込みが `$watch` より前に戻り、接続中の着地は畳んで書かれて残る（`total=3`、再接続後も 3、以後の着地で 6）。`scan.lifecycle.test.ts` をこの結果に反転し、D8・`scan(.ja).md` のライフサイクル表を直した |
| 再検証: bind-component の判定がタグ全体への正規表現で、属性値の中の文字列にも当たる | `<wcs-state data-note="no bind-component here">` の正しい `$scan` に warning が出て、中身の検証を飛ばす | htmlParse が開始タグの属性を先頭から読んで属性名の集合を作り（`WcsStateInfo.bindComponent`）、scanDeclarationValidator と recursionValidator の両方をそれで判定する |
| 再検証: `_WcsDeclaredValues` の `any` が、明示的に事前宣言したプロパティの型まで潰す | `feed: "x" as string` と `$scan.feed` で `const k: number = this.feed` が無エラー | T に無いキーだけを写す（`Exclude<keyof S & string, keyof T>`）。事前宣言が型を保つことを preamble のテストで固定 |
| 再検証: watch 設計書と updater のコメントに、書き込みの移動とその帰結が無い | — | 一度は「出力の書き込みは `$watch` の発火の後」とその帰結を足したが、「差し戻し」に合わせて「畳んで書いてから `$watch` を発火する」に書き直した（watch 設計書 §3-2 層 1 の注記と §12、updater / watchRuntime / scanRuntime のコメント） |
| 再検証 2: 「出力が変わったか」を値で比べるので、ハンドラが計画時点と同じ値・同じ参照を書くと検出できず、計画が上書きする | 出力が 0 のとき同じ job の `n=6; clear=1` で `$watch.clear` が `total = 0` → `total=6`。initial のまま `log = INITIAL` → `[6]` | C2-11 の派生。一度は値の比較をやめ、計画のある drain で `$watch` を発火しているあいだだけ台帳を開いて、`setByAddressCore` の先頭（same-value guard より前）で出力とその下のパスへの書き込みの試みを記録し、試みがあった計画を捨てた（`scan/outputWriteAttempts.ts`）。「差し戻し」で台帳・`setByAddressCore` のフック・`fireWatchHits` の包み・`commitPlan` の判定をすべて外した。書き込みが `$watch` より前なので、同値・同参照を書いたハンドラの値が残り（`total=0`・`log` は `INITIAL`）、現在の値の自己再代入は無害（`log=[1,2]`）。`scan.from.test.ts` が同値・同参照・自己再代入・子パス・`$resolve`・他 state への書き込みをこの結果で固定 |
| 再検証 2: 書き込みで `on` の reset の計画を捨てるとき保留を無条件に消し、同じハンドラが書き直した `resetOn` の次のバッチの reset まで失う | `$watch.server` が `log = ["x"]` と `server = "c"` を書く（2 通りの順）→ `on` は `log=["x"]`・保留 false、`from` は `[]` | 計画を捨てるときも C2-2 と同じ規則（その entry の `resetOn` が次のバッチ向けに積まれていれば保留を残す）にした。「差し戻し」で書き込みの試みの経路は消えたが、規則は残る捨てる経路（非 active・連鎖深さの上限・相 1 / 相 2 の再確認）に保つ。`scan.on.test.ts` が、ハンドラが reset の書き込みの後に出力と `resetOn` を書く 2 通りの順（どちらも `["c", []]`・保留 false で `from` の scan と揃う）、ハンドラの同期 dispatch（`["from-handler"]`）、相 2 の再確認で次のバッチの保留を残す形を固定 |
| 再検証 3（C2-17）: 書き込みの試みに出力の子パスも数えるので、`$watch.pageResult` が `feed.lastKind` を注記すると、同じ drain の fold がまるごと捨てられる | 2 回の着地で `feed.items` が `[]` のまま | 「差し戻し」で解消（`{ items: [1, 2], lastKind: "success" }`）。`scan.from.test.ts` が固定 |
| 再検証 4（C2-18）: D12 と `scan(.ja).md` の条件が「出力の書き込みが次のバッチを待つあいだ」に絞られ、同じ drain で scan の書き込みより前に source が書かれる形（バインディング適用中の `$updatedCallback`・そこで同期に dispatch された `$on`）が漏れる | `total{from:"count"}` で、1 回目の drain のバインディング適用中に `$updatedCallback` が `count=2` を書くと、`$watch.total` は `[[4,2],[4,undefined]]`、fold の (cur, prev) は `[[2,0],[2,undefined]]`、`total=4`（1 が畳まれず、2 が 2 回畳まれる） | 条件を README と同じ「出力の着地が drain される前に source がもう一度書かれる（scan の書き込みの前後を問わない）」に揃え、この形では fold もバッチの確定値を 2 回受け取る（合計がずれ得る）ことを足した。D3 と `$watch` からある既存の性質で、退行ではない。`scan.from.test.ts` が固定 |
| 再検証 4（C2-19）: README（英日）の view transition の節が「`$watch` と `$streams` restart は元の microtask に留まる」で `$scan` を落としている（サイクル 1 からの漏れ） | — | 「`$scan`・`$watch`・`$streams` restart」に直した |

#### 差し戻し — 出力の書き込みを `$watch` の前に戻す（2026-09-14・ユーザー判断）

C2-1 は、出力を見る `$watch` の `prev` と同じ値の 2 回目の発火を消すために、相 2（書き込み）を同じ drain の `$watch` の発火の後に回した。ユーザーの判断でこれを戻し、drain の順序をサイクル 1 と同じ `$updatedCallback` → `$scan`（相 1 計画 → 相 2 書き込み。D18 の 2 相は保つ）→ `$watch` の発火 → `$streams` restart → `prev` 台帳の消去にした。

戻した理由:

- 派生の穴が続いた。相 1 と相 2 の間にハンドラが書いた値を計画が上書きする（C2-11）、ハンドラの切断で接続中の着地を失う（C2-12）、計画を捨てるときに次のバッチの保留 reset まで消す（C2-16）、出力の子パスへの注記だけで fold がまるごと捨てられる（C2-17）。
- C2-11 を値の比較で塞げず、書き込みの試みを見るために、すべての書き込みが通る `setByAddressCore` の先頭（hot path）にフックが要った。
- 同じ drain の `$watch` ハンドラが、畳む前の古い出力を読む。
- 出力の子パスへの書き込みで、同じ drain の着地を失う。

外したもの: `scan/outputWriteAttempts.ts`、`setByAddressCore` のフック（`setByAddress.ts` は HEAD と同じ）、`fireWatchHits` を包む `watchScanOutputWrites`、`commitPlan` の「試み」の判定。残したもの: D18 の 2 相、保留 reset を次のバッチ向けの積みで残す規則（C2-2 / C2-16）、C2-17 の形のテスト。

受け入れるもの: source を書き進める連鎖で出力の着地と source の新しい着地が同じバッチに載ると、出力を見る `$watch` の `prev` が着地した値を持ち、`cur` が 1 段先行し、同じ値で 2 回発火し得る。D12 に契約として明文化した。`examples/state-intersect-scroll` の `$watch.feed`（`rearm.emit()`）は当たらない。`pageResult` を書くのは stream の非同期の consume ループだけで、`loadPage` は 1 run に success を 1 回 yield して終わる。restart で戻る値は success の chunk ではないので fold が `feed` を返して書かず、restart と同じバッチの chunk は D10 で畳まない。sentinel の再武装（`reobserve()`）が起こす `sentinelChanged` は IntersectionObserver の非同期コールバックなので drain の外で `page` を書く。例と同じ宣言のプローブ（page 1 → 2 → 3、同じ page の chunk を続けて 2 回）で `$watch.feed` は着地ごとに 1 回（`[2, 4, 5]` 件で各 1 回）、1 run で success を続けて 2 回 push しても `[2, 4]` だった。

### 5-7. 品質向上サイクル 3 で直したもの（2026-09-14）

指摘者 3 体目の走査。drain の順序（§5-6 の差し戻し）と D12 の連鎖時の契約は決定済みとして変えていない。runtime の中核（D18 の 2 相・保留 reset・ライフサイクル・例外の後始末）には実測で誤動作が無かった。

| 指摘 | 実測（修正前） | 対処 |
|---|---|---|
| C3-1: `$recursion` の `**` getter の展開形を `from` に書いても宣言時に raise しない（D5 違反） | `recursionState(forest())` に `$scan.log = { from: "nodes.*.total" }` → 宣言は通り、発火時に late getter として「registered after the declaration, e.g. by a volume」を 1 回報告し、以後は黙って畳まない（`log=[]`）。静的検証も無診断 | runtime: `_state` セッターが `$scan` の検査より前に作る再帰レジストリを `parseScanDeclaration` に渡し、`from` を `recursiveGetterOwning` で引いて `wcs/scan-source-computed`（「is computed by the recursive getter …」）で raise する。展開形は必ず `*` を含むので `resetOn` はワイルドカードの検査で先に落ちる。静的: `checkPathComputed` が深さを畳んで `**` getter の候補（`kind: 'recursive'`）に当てる。D5・`scan(.ja).md`・README・CHANGELOG・vscode-wcs の README / CHANGELOG を更新。`scan.processScanDeclaration.test.ts`（深い段・値の内側・データのパス）・`scan.lifecycle.test.ts`（再セットが世代を進めない）・`scanDeclarationValidator.test.ts` |
| C3-2: `scan(.ja).md` の `prev` の記録条件が「旧値がプリミティブ」で、実装（書く値がプリミティブ）と逆 | `v` を 1 → `{a:1}` → `{a:2}` → 5 → 6 と書くと `[obj, undefined]`・`[obj, undefined]`・`[5, obj]`・`[6, 5]` | 英日を「プリミティブを書いたときに書く前の値（オブジェクトでもよい）を記録し、書く値が参照型なら `undefined`」に直した。README の `$watch` の「`prev` はスカラ限定」も同じ規則に直した。`scan.from.test.ts` が `$scan` と `$watch` の両方で固定 |
| C3-3: 「別の scan の出力を `from` にすると `prev` は常に `undefined`」が `on` の scan の出力に当たらない | `count{on}` → `log{from:"count"}` でイベント 2 回 → `[[1,0],[2,1]]` | 「`from` の scan の出力なら常に `undefined`、`on` の scan の出力は通常の書き込みと同じ」に限定した。`scan.on.test.ts` |
| C3-4: drain / enqueue のゲートが registry の数で、要素を DOM から外しただけでは閉じない（コメントは「GC された分だけ」と狭く書いていた） | `on` + `resetOn` の state を外しても、drain ゲートの数は 2 → 3、enqueue ゲートの数は 0 → 1 のまま | ゲートを watch runtime の active 集合への出入り（`addActiveWatchStateElement` / `deactivateWatch` / `clearWatchRegistry`）で数える（`$watch` のゼロコスト契約と同じ流儀）。ゲートが閉じた後も、切断の前に積んだ保留は drain で捨てる必要があるので、捨てる走査のゲートは保留の数に分け、drain 側の破棄を drain ゲートより前に置いた。再セットでは旧宣言の保留を捨てて数を戻す（`unregisterScans`）。`scan.runtimeEdges.test.ts` が切断・ルート `<wcs-state>` の再接続（#273 の経路）・接続中の再セット・書き込みと drain の間の再セットを固定し、既存の「drain の前に切断したら保留を捨てる」2 本（他に発火対象が居る drain・居ない drain）はそのまま通る |
| C3-5: `resetOn` のオブジェクトのパスの契約（そのオブジェクト自身の書き込みだけで reset・同じ内容の再代入でも reset）を固定するテストが無い | 挙動は文書どおり（`resetOn: ["filter"]` で子の書き込みの後は `[1]`、同じ内容の再代入の後は `[]`） | 挙動は変えず、`from`（同じ内容・同じ参照の再代入を含む）と `on`（保留の有無と drain の reset）の両方で固定した |
| C3-6: 「`$streams` の chunk と restart の `initial` への戻しは `prev` を持つ」がオブジェクトの chunk に当たらない | プリミティブの chunk は `[[10,null],[20,10],[null,20]]`。オブジェクトの chunk は `prev` が `undefined` で、restart の戻しは直前の chunk オブジェクトを `prev` に持つ | C3-2 の規則に揃えて「プリミティブの chunk は `prev` を持つ・オブジェクトの chunk は `undefined`・プリミティブの `initial` への戻しは直前の chunk を `prev` に持つ」に直した。`scan.from.test.ts` が 2 通りを固定 |
| C3-7: エントリの値が配列リテラルだと静的検証が無診断（runtime は「from / on のどちらか 1 つ」で raise） | `$scan: { log: [] }` → 静的は `[]` | 静的: 配列リテラルのエントリを「オブジェクトでない」で error にし、`isDefiniteNonObjectLiteral` のコメントを実装に合わせた。runtime もエントリの配列を、`$scan` 自体の検査と同じく「must be an object」で raise するようにして文言を揃えた（どちらも `wcs/scan-declaration-invalid` の宣言時 raise で、raise する形は変わらない） |
| C3-8: bind-component で宣言を実行しないことを、実際のマウントで確かめていない | テストは `warnMountedDollarDeclarations` を直接呼ぶだけ | 挙動は主張どおりだった。`data-wcs="state.user: user"` で実際にマウントしたコンポーネントの `$scan`（`from: "user.name"` と、ルートにも宣言したトークンの `on`）が、ルートの書き込み・イベントの後も畳まず、出力を実体化せず、registry も作らず、warn を 1 回だけ出すことを `scan.lifecycle.test.ts` で固定 |
| C3-9: README（英日）の `$watch` の引数表の `prev` 行が「スカラのときだけ」のままで、C3-2 で直した直下の段落と噛み合わない | — | 表の行を「プリミティブを書いたときだけ（書く前の値はオブジェクトでもよい）」に揃えた。同じ表現が残っていた `packages/state/examples/watch/index.html` の説明と `watch/types.ts` の JSDoc も揃えた（`dist/index.d.ts` と vscode-wcs の preamble には影響しない）。実装計画と設計書の経緯記録は変えない |
| C3-10: 正本の `state-watch-hook-design.md` の D3 と §4-1 が「参照型では `undefined`」「意味を持つのはスカラだけ」のままで、そこを根拠に指すソースのコメント（`setByAddress.ts`・`watch/prevValues.ts`・`watch/types.ts`）から辿ると「`prev` にオブジェクトは来ない」と誤読する | オブジェクトの上にプリミティブを書くと、旧オブジェクトが `prev` に渡る（C3-2 の `[5, obj]`） | 本文は書き換えず、D3 と §4-1 に 2026-09-14 の改訂注記（判定の軸は書く値）を足し、§4-1 の見出しから注記を指した |

### 5-8. 品質向上サイクル 4 で直したもの（2026-09-14）

指摘者 4 体目の走査。drain の順序（§5-6 の差し戻し）・D12 の契約・`prev` の規則（書く値が軸）・ゲートを active 集合で数える方式（§5-7）は決定済みとして変えていない。2 段 wildcard で外側の行が null・生の行オブジェクトの accessor が throw・`from:""` / `on:""` の二重報告・`from: undefined` と `on` の併記は、実測で問題が無かった。

| 指摘 | 実測（修正前） | 対処 |
|---|---|---|
| C4-1: `resetOn` への書き込みから drain までに `_state` を再セットすると、`on` の scan の保留 reset だけが消える（C3-4 より前からの形） | `onLog`（on）と `fromLog`（from）の両方に `resetOn: ["host"]`。`host = "b"` → 再セット（同じオブジェクト・`{ ...__state }`）→ 同じ job でイベント `b1` → `[["a1","b1"], []]`（再セットしなければ `onLog = ["b1"]`） | 案 1 を基に、案 2 のキューの判定を条件に加えた。`unregisterScans` が、旧宣言で保留を持っていた `on` の scan（出力名 → `resetOn`）を返す。`registerScans` は、新しい宣言の同じ出力名の `on` の scan について、新旧どちらの `resetOn` にもあり、まだ updater のキューに積まれているパスがあるときだけ保留を立てる（`markPendingScanReset`）。キューだけで立て直す案 2 は、初期化中など発火対象でない state への書き込みでも保留を立て、D6 の「発火対象への書き込みの enqueue で立つ」と食い違うので、単独では採らない。旧の保留は発火対象への書き込みでしか立たないので、この契約は保たれる。D6・`scan(.ja).md` の resetOn 節を更新。`scan.on.test.ts` が同じオブジェクト・値のコピーの 2 形を出力（on `["b1"]`・from `[]`）で固定し、書き込んだパスが新しい `resetOn` に無い形・出力名が変わった形では引き継がないことも固定。`scan.runtimeEdges.test.ts` の保留の数のテストは「引き継いで二重に数えず、drain で使い切る」に直した |
| C4-2: getter の無い setter を `from` / `resetOn` に書くと、静的検証だけが「is a getter」で弾き、runtime は通して `undefined` を畳む | `set sink(v)` と `from: "sink"` で、静的は `wcs/scan-source-computed`、runtime は `a = [undefined]` | 読むと常に `undefined` の `from` は畳む意味が無いので、runtime も宣言時に raise するようにした（`wcs/scan-declaration-invalid`・「is a setter without a getter, so it always reads undefined」。その配下を含む）。`resetOn` は値を読まない引き金なので setter を通し（書くたびに `initial` に戻る）、静的の偽陽性を外した。静的はパス候補に `writeOnly` を持たせ（set が先に書かれた get / set の組は getter として扱う）、`from` だけを同じ code・文言で報告する。D5・`scan(.ja).md`・CHANGELOG・vscode-wcs の README / CHANGELOG を更新。`scan.processScanDeclaration.test.ts`・`scan.from.test.ts`（`resetOn` の引き金）・`scanDeclarationValidator.test.ts` |
| C4-3: 宣言時の検査の raise の code に `wcs/recursion-unsupported` が載っていない | `from: "nodes.**.value"`（`$recursion` の有無を問わず）・`resetOn: ["nodes.**"]` がすべて `[wcs/recursion-unsupported]` で throw | 英日の `scan.md` と §1-2 に 3 つ目の code として足した |
| C4-4: `prev` 台帳が消える時点を「drain の終わり」と書いていた | 台帳を消すのは watch リスナー（優先度 10）の finally。同じ drain の `$streams` restart リスナー（優先度 20）の書き込みは `prev` を持ったまま次のバッチへ進む（`scan.from.test.ts` が restart の戻しの `prev` を固定済み） | 英日の `scan.md`・README の `prev` の説明・D12 を「`$scan` / `$watch` のリスナーの終わりで消える。その後に走る `$streams` restart の書き込みは `prev` を持つ」に直した |
| C4-5: 接ぎ木で後から getter になった `from` で「その scan を止める」と書いていたが、止まるのは fold だけで reset は続く | 接ぎ木の前の着地で `out = ["x"]` → 接ぎ木の後は畳まず報告 1 回 → `host = "b"` で `out = []` | reset は getter を読まないので続けるのが正しいと判断した。実装はそのままで、D5・`scan(.ja).md` を「fold を止める（`resetOn` は引き続き `initial` に戻す）」に直し、`scan.from.test.ts` で固定 |
| C4-6: 全行差し替えのバッチで、計画の相の位置判定が行ごとに親リストと台帳を読み直す（性能） | 指摘者の計測（5000 行・4 回）で `$scan` 440〜526ms・`$watch` 362〜487ms・宣言なし 280〜370ms | **却下**。宣言なし・`$watch`・`$scan` を交互に 2 巡し、先頭 2 回を捨てて計り直すと、5000 行の全行差し替えの中央値は宣言なし 318ms・`$watch` 333ms・`$scan` 329ms（ばらつき 174〜469ms）。2 段 wildcard（40 グループ × 50 行）は 109ms・137ms・114ms。`$scan` の上乗せは揺れに埋もれ、`$watch` を超えない。位置判定は #274 に絡む繊細な部分（§5-5）なので、差がはっきり出ない最適化は入れない |
| C4-7: devtools の `watch-error` の title が「a $watch handler or $scan fold threw」で、読み・書き込み・prime・後から getter になった `from` の報告を含まない | — | 「a $watch or $scan failure (read, handler, fold or write — see the phase in the detail)」に直し、shell のテストを合わせた |
| C4-8: `IScanPlan.reset` が `group.reset` と重複し、`scanRegistry.ts` の `__private__` がどこからも使われない | — | `IScanPlan.reset` を削って `group.reset` を読むようにし、`__private__` を削除した |
| C4-9: `resetOn` の書き込みを載せたバッチの drain の最中（バインディング適用中の `$updatedCallback`・そこで同期に dispatch された `$on`）に再セットすると、保留を引き継がない | `$updatedCallback` で同じオブジェクトを再セット → drain 後 `[["a1"], []]`（再セットしない対照は `[[], []]`）、続くイベントで `["a1","later"]`。保留の数は 0 に戻る（リークは無い） | **仕様として線引き**した。塞ぐには updater に適用中のバッチを覗く口と、scan の相の開始前かどうかの印が要る。fold が相 1 で再セットする形では、この drain の group が旧 registry から集め終わっているので、保留が残り続ける。稀な形を塞ぐたびに仕組みが増えた §5-6 の経緯を踏まえ、C2-2 / C2-16 / C4-1 の「キューに積まれていれば」という 1 つの規則を保った。引き継ぎは書き込みがまだキューに残っている場合だけと D6・`scan(.ja).md` に書き、`scan.on.test.ts` が実測値と、再セットの後で `resetOn` を書き直せば揃うこと（`[[], []]`）を固定 |
| C4-10: 静的な `writeOnly` の判定がソース上の宣言順に依存し、runtime（キーごとの descriptor）と食い違う | `user: {name}` の後の `set "user.name"(v)`・`items: [{qty}]` の後の `set "items.*.qty"(v)`・`x: 1, set x(v){}` が無診断（runtime は raise）。`set x(v){}, x: 1` が error（runtime は通る） | 同じトップレベルキーの宣言をオブジェクトリテラルの評価順どおりに畳み（後の宣言が勝つ・get / set は合わさる）、勝った側だけを候補にした。dotted な setter は、別のキーが作った同じパスのデータ候補にも `writeOnly` を付ける。`scanDeclarationValidator.test.ts` が 5 形（データの前後の dotted な setter・wildcard・同じキーの前後）を固定し、`scan.processScanDeclaration.test.ts` が runtime のデータの後の dotted な setter を固定 |
| C4-11: 再セットで足した reset 条件（`resetOn` に新しく足したパス・同じ出力名の `from` → `on`）が、書き込み済みの値に `on` の scan だけ効かない | 足した形は `[["a1","b1"], []]`。`from` → `on` は旧 `from` 側の出力が `[1,"b1"]`（保留の数はどちらも 0 に戻る） | C4-9 と同じ方針で**仕様として線引き**した。揃えるには新しい宣言の `resetOn` に照らして保留を立て直すことになり、D6 の「発火対象への書き込みの enqueue で立つ」と食い違う。D6・`scan(.ja).md` に明記し、`scan.on.test.ts` が実測値を固定 |
| C4-12: C4-9 の線引きの文が「その書き込みの drain の最中の再セット」を括りにしていて、`on` だけが reset しない形の範囲が実際より広く読める | 同じ drain の `$watch.host` ハンドラで再セット → `[[], []]`（両方 reset・保留 0）。先行する scan の fold で再セット → `[["a1"], [1]]`（両方 reset しない・保留 0） | 英日の `scan.md` と D6 を「その書き込みのバインディング適用中（`$updatedCallback`・適用中に走る `$on`。scan の相より前）の再セット」に絞り、同じ drain のそれより後の再セットでは揃う（`$watch` ハンドラからは両方 reset、fold からは発火しない drain の規則で両方 reset しない）ことを足した |

### 5-9. 品質向上サイクル 5 で直したもの（2026-09-14）

指摘者 5 体目の走査（最終サイクル）。drain の順序 A・D12・`prev` の規則・ゲートを active 集合で数える方式・D6 の線引き・setter の扱いは決定済みとして変えていない。

| 指摘 | 実測（修正前） | 対処 |
|---|---|---|
| C5-1: 実体化と reset が、宣言の `initial` を同じ参照のまま出力に置く | `initial: {items:[], note:""}` で `s["feed.note"] = "typed"` → 宣言の `INITIAL.note` が `"typed"` になり、reset 後も `{items:[], note:"typed"}`。もう一度書いて reset すると、同じ参照なので書かれず残る。C2-17 の形（最初の着地で fold が acc を返し、`$watch` が `feed.lastKind` を注記）は reset 後 `{items:[], lastKind:"src1"}` | **複製案を採った**（C2-17 の注記を docs とテストで推しているので、規約だけでは実害が残る）。`scan/initialValue.ts` が plain な配列・オブジェクトを再帰で複製し（循環と共有参照は保つ）、関数・クラスのインスタンス・`Map` / `Set`・`Date`・DOM ノードは参照のまま置く。実体化・reset・`on` の scan の保留中の fold に渡す acc の 3 か所で使う。(1) 「既に initial なら書かない」は、参照ではなく値の比較（plain な部分を再帰で比べ、それ以外は同一性）で保った。書き込みの記録は持たないので、撤去した C2-11 の台帳の複雑さには戻らない。出力が initial と同じ値のまま reset しても着地も `$watch` の発火も起きない（既存テストのまま）。(2) D7 の「同じオブジェクトの再セットで累積を保つ」は、既に値があれば置かない判定なので変わらない。(3) 複製しない値は D7・`scan(.ja).md` に書いた。(4) `on` の保留中の fold も、出力が initial と同じ値ならその出力を、違えば複製を渡す。(5) `$streams` の `initial` は範囲外として参照のまま残し、`scan(.ja).md`・D7 に注記した。`scan.initialValue.test.ts`（複製と比較の単体）・`scan.from.test.ts`（子パスの書き込み・C2-17 の形・クラスのインスタンス）・`scan.on.test.ts`（保留中の acc）で固定し、reset 後の出力を `toBe(initial)` で見ていた 7 本を「値が同じで、宣言の参照ではない」に直した |
| C5-2: fold が関数を返す出力で、同じオブジェクト・`{...state}` の再セットが「conflicts with a method」で raise する（D7 が成り立たない） | `initial: () => "initial"`・`fold: (_a, cur) => () => \`n=${cur}\`` で `n=1` を畳んだ後、どちらの再セットも throw | `_state` セッターが旧 registry の出力名（`scanOutputNames`）を `parseScanDeclaration` に渡し、旧宣言に同じ名前の出力があれば、その関数値を fold の累積とみなしてメソッド衝突にしない。初回や、旧宣言に無い名前の関数値は従来どおり raise する。D7・`scan(.ja).md` のライフサイクル表。`scan.processScanDeclaration.test.ts`・`scan.lifecycle.test.ts`（再セットの後も畳み続ける） |
| C5-3: `$eventTokens` と同名の出力は、静的に実体化を飛ばされて子パスが展開されず、偽の `wcs/binding-path-missing` が出る（`$streams` の値も同じ経路の既存の穴） | `$eventTokens:["message"]` と `$scan.message{ initial:{items:[]} }` で `for: message.items` に 2 件（出力名を `log` にすると 0 件） | 実体化を飛ばす「同名の候補あり」の判定から `kind: 'eventToken'` の候補を外した（トークン名は `eventToken.<prop>:` の右辺でパスではない。`$command` の候補は `$command.` で始まるので同名にならない）。`$streams` の値にも同じ効果があることを vscode-wcs の CHANGELOG に書いた。`scanDeclarationValidator.test.ts` |
| C5-4: `scan.md` が「restart が勝つ」の出典として、`streams.md` に無い規則を引いている | — | 英日とも `docs/state-streams-design.md` §3-2 へのリンクに直した |
| C5-5: `Object.prototype` の継承名（出力名・パス）の raise に `LINT_HINT` が無い（静的検証は `scanOutputReserved` / `scanPathReserved` で拾う） | — | 2 か所に `LINT_HINT` を付け、`scan.processScanDeclaration.test.ts` で案内が付くことを固定 |
| C5-6: D14 の「`$listKeys` を出力そのものに付ける」形が未計測・テストなし | 指摘者の計測で正しく動く（DOM `["10"]` → `["10","20"]`・reset で `[]`・`["30"]`、`INIT` は書き換わらない、`$watch.log` は 1・2・0・1） | `scan.from.test.ts` で固定し、§5-1 の「未計測」を更新した |
| C5-7: example が `$scan` を持たない CDN 版を読む（最新の公開版 2.3.0 は `$scan` を持たない） | コードからの推測（e2e はローカル dist なので当たらない） | 他の example の流儀（CDN の一行・ピン留めなし）に合わせてコードは変えず、README（英日）に「`$scan` を含む次のリリースが必要。それまでは e2e の静的サーバーでローカルの dist を使う」旨を注記した |
| C5-8: C5-2 の修正が、旧宣言に同じ出力名があるだけで関数値をすべて通し、新しいオブジェクトの同名の本物のメソッドを見逃す（C5-2 の修正が作った穴） | 1 回目 `$scan.handler{from:"n", initial:0}` → 2 回目 `{ handler(){ return "method" }, $scan:{ handler:{…} } }` の再セットが raise せず、`n=2` を畳むと出力が `"handler() {…}2"`（新しい要素に置けば raise） | 名前ではなく値で判定するようにした。`_state` セッターが、旧 registry の出力について旧世代の state でその出力が持っていた値（`scanOutputValues`）を渡し、関数値がその値そのもののときだけ通す。同じオブジェクト・`{...state}` の再セットは同じ参照なので C5-2 の形は通り、別の関数は raise する。`scan.processScanDeclaration.test.ts`・`scan.lifecycle.test.ts`（p8 (e) の形） |
| C5-9: plain の判定がプロトタイプしか見ず、getter / setter・Symbol キー・列挙できないプロパティ・配列の追加プロパティ・Array のサブクラス・凍結された値まで作り変える。throw する getter を持つ initial では、世代を進めた後の実体化が throw し、再セットが中途半端に落ちる | getter が実行されてデータに潰れる（実体化から reset までに 3 回呼ばれる）。Symbol キー・列挙できないプロパティ・配列の追加プロパティが消え、サブクラスは plain な配列になり、凍結が外れる。throw する getter では `cloneInitial` が throw | 複製するのは、プロトタイプが `Array.prototype` / `Object.prototype` / null で、凍結されておらず、自前のプロパティがすべて列挙できる文字列キーのデータプロパティ（配列は添字と `length` だけ）の値だけにした。descriptor で判定するので getter を実行しない。比較も同じ判定に揃え、plain でない値は同一性で比べる。D7・`scan(.ja).md` に条件を書いた。`scan.initialValue.test.ts`（各形が参照のまま・getter を呼ばない・throw しない）、`scan.from.test.ts`（getter を持つ initial が参照のまま置かれ、reset まで getter を呼ばない）、`scan.lifecycle.test.ts`（throw する getter を持つ initial の再セットが落ちない）で固定 |
| C5-10: 比較が訪れた対を「a → 最後に比べた b」の 1 対 1 で覚えるので、形の違う循環で再帰が止まらない | 自己循環と 2 段の循環の比較が、配列もオブジェクトも `RangeError: Maximum call stack size exceeded`。reset はその catch に落ちて行われず、報告は「could not write the output」 | 訪れた対を `Map<object, Set<object>>` で覚え、同じ対の 2 回目で true を返す。`scan.initialValue.test.ts` が自己循環×2 段循環（両方向・配列とオブジェクト）と共有参照を固定 |
| C5-11: C5-7 の注記に e2e の前提（`npm ci`・`npx playwright install chromium`）が無く、案内したスペックはヘッドレスでページを見られない | — | 前提を足し、ページを見るには `npx playwright test state-intersect-scroll --headed`（または `--ui`）を案内した。`e2e/serve.mjs` だけでは `/api/items` が無く一覧が出ないことも書いた（英日）。任意の提案だった「値が変わらない reset では出力の `$watch` が発火しないので、合図が要るなら `resetOn` のパス（nonce）を `$watch` する」も `scan(.ja).md` に足した |
| C5-8（追記）: 世代を進めた後に throw した再セットを挟むと、同じ穴が残る。`scanOutputValues` が旧 registry の出力名を `_state` セッター時点の `__state` から引くが、その `__state` は throw した再セットのオブジェクトに替わっていて、registry は旧宣言のまま | `$scan.handler`（initial 0）で接続 → `{ handler: method, $streams: { s: { source: 1 } } }` の再セットが `$streams` の検査で throw → `{ handler: method（同じ参照）, $scan: { handler: … } }` の再セットが raise せず、`n=2` を畳むと出力が「メソッドのソース + 2」 | registry に登録したときの state オブジェクト（`registry.state`）を持たせ、旧出力の値はそこから引くようにした（`registerScans` / `setScanRegistry` が state を受け取る）。throw した再セットの `__state` とは別の世代のオブジェクトなので、`method` は旧出力（`0`）と一致せず raise する。`scan.lifecycle.test.ts` がこの形を固定 |
| C5-12: docs が「出力の子パスへ書いても宣言の `initial` は変わらない・reset で消える」と言い切るが、複製するのは plain なデータの部分だけで、その内側の plain でない値（クラスのインスタンス・Date・凍結された値・accessor を持つ行）は宣言と同じ参照のまま入る | `initial = { items: [], model: new Model(), frozen, rows: [{ get x(){…} }] }` で、外側と rows は複製、model・frozen・rows[0] は同じ参照。`s["feed.model.x"] = 5` で宣言の `INITIAL.model.x` が 5 になり、畳んで reset しても出力の `model.x` は 5 のまま | 挙動は変えず、docs を正確にした。「宣言の `initial` を変えない・reset で消える」のは plain な部分の子パスだけと限定した。参照のまま置いた値（`initial` 自身でも内側でも）の中へ書くと宣言の `initial` も書き換わって reset でも戻らないこと、凍結された値へ書くと throw することを明記し、累積と reset の対象は plain なデータに保つよう勧めた。D7・`scan(.ja).md`（`initial` の行・resetOn 節）・README 英日・CHANGELOG。`scan.from.test.ts` がこの形（内側のクラスのインスタンスへの書き込みが宣言に及び reset で戻らない・凍結された値への書き込みが throw）を固定 |
| C5-13: C5-9 で比較が出力側の descriptor を先に全部見るようになり、長さの違う比較が出力の大きさに比例した（性能） | 空の initial との比較 1 回が 1 万件 1.3ms・10 万件 13.2ms・20 万件 30.9ms（C5-9 の前は 2ms）、`{items: 20万件}` と `{items: []}` で 32.8ms。複製と中身の比較（20 万件）は 140 / 93ms から 292 / 375ms | 比較は宣言側（initial）の種類を先に決め、配列の長さ・キーの数を比べてから出力側の descriptor を調べるようにした。長さやキー数が違えば、出力側の要素も descriptor も見ずに false を返す（宣言の initial は小さいので、種類の判定はキャッシュしない）。計り直すと、空の initial との比較は 1 万〜20 万件のどれも 0.1ms 未満（1 回あたり約 1μs）、`{items: 20万件}` と `{items: []}` も約 1μs。複製は 122〜125ms、中身の等しい比較は 178〜217ms。C5-9 / C5-10 のテストはすべて通り、`scan.initialValue.test.ts` に「長さが違えば出力側の要素を読まない」を足した |
| C5-14: 世代を進めた後に throw した再セットの後は、fold の書き込み先が新しい `__state` になり、fold が返した関数値が `registry.state`（旧オブジェクト）に入らない。その state のコピーでの再セットが、正当な関数値を「conflicts with a method」で拒否する（C5-2 の誤検出がこの経路でだけ戻る） | A で接続し `n=1` を畳む → `{ ...A, $streams: { s: { source: 1 } } }` の再セットが throw → `n=2` を畳むと B.handler は f2、A.handler は f1 のまま → `{ n, handler: B.handler, $scan: 同じ宣言 }` の再セットが raise | 世代で判定するのをやめ、置き換えた。実体化・fold（`commitPlan`・`on` の fold）・reset が出力に置いた関数値を、出力名ごとに WeakMap に記録し（`scan/initialValue.ts` の `recordOutputValue`）、宣言の検査は関数値がその出力に置かれたことがあるときだけ通す（`wasPlacedOnOutput`）。C5-8 で足した `registry.state`・`scanOutputValues`・`parseScanDeclaration` の旧出力の引数は外したので、二重の仕組みにはなっていない（`commitPlan` の書き込みは reset と fold で 1 か所にまとめた）。C5-2 / C5-8 / p9 iii / p8 (e) のテストはそのまま通り、`scan.lifecycle.test.ts` が p12 i-b の形を固定。ハンドラが出力へ書いた関数値は記録しないので、再セットでメソッド衝突として raise する（D7・`scan(.ja).md` のライフサイクル表に書いた） |
| C5-15: C5-14 の説明が raise する形を「ハンドラが出力へ書いた関数」としていたが、実際に raise するのは runtime（実体化・fold・reset）が置いていない関数値のすべてで、ハンドラに限らない | ハンドラを介さず `writeState(s => { s.handler = g })` で書いた後の同じオブジェクトの再セットも `conflicts with a method` で raise | 英日の `scan.md` のライフサイクル表と D7 を「runtime が置いていない関数値はすべて raise する（新しいオブジェクトの同名の本物のメソッドや、ハンドラ・メソッド・`$resolve` / `$setAll`・state への直接の書き込みで出力へ書いた関数）」に揃えた |

---

## 関連

- [Issue #272](https://github.com/wcstack/wcstack/issues/272) — 外部評の判定・13 サイト・5 案比較・反証・決定ゲート
- [state-watch-hook-design.md](./state-watch-hook-design.md) — drain 終端フック・prev 台帳・連鎖深さ・§12（`$effects` 非スコープ）
- [state-streams-design.md](./state-streams-design.md) — §3-2（restart が勝つ）・§6（有界 fold・新値 return）・§8（第 1 段スコープ外）
- [state-event-lane-design.md](./state-event-lane-design.md) — §7-2（`$t` は生えない）・§9-2（event-token を source にする案の保留。本書 D2 の `on` がその再開であり、保留理由 3 点は「`$streams.source` への bridge」に対するもので、同期 subscriber には当たらない）
- [state-redesign-council.md](./state-redesign-council.md) — ADR-4（Gate 0）・ADR-6
