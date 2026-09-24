# state エンジン再設計 — コア構築の計画（第 2 段階）

作成 2026-09-24。前提は次の 3 つ。
- [scope-classification.ja.md](./scope-classification.ja.md) の決定状況（コアの範囲・後付け・廃止）
- [spike-results.ja.md](./spike-results.ja.md) の結論（dirty 方式・所有の木）
- 第 5 回の決定（性能目標は同条件の DOM 直接との比。コアの残りを足していく）

## 1. 進め方

試作 `packages/state-next` を土台に、コアの機能を段ごとに足す。各段の終わりに、次の 3 つを必ず回す。

| 検査 | 内容 | 合否 |
|---|---|---|
| 単体・契約テスト | 足した機能の約束（README の記述）をテストに書く | 全件緑 |
| 現行との突き合わせ（ゴールデン） | 同じシナリオ（HTML・状態・操作）を現行 3.3.0 で流して DOM を記録し、新エンジンの DOM と比べる | 差分ゼロ。意図した差（廃止・位置モデルなど）は、シナリオ側に理由付きで明記する |
| 性能とサイズ | 現行×2（A/A）・新エンジン・DOM 直接（コールド／ウォーム）を同じセッションで交互に計測する | 下記のとおり |

性能とサイズの合否は次のとおり。
- ウォーム 1,000 行作成とコールド 10,000 行作成が、同条件の DOM 直接の 2 倍以内。
- 他の操作は現行より悪化しない（A/A の揺れを超えて遅くならない）。
- `auto` の gzip サイズを記録し、core ≤ 20KB を見張る。

## 2. 段

| 段 | 足すもの |
|---|---|
| 0 | **比較の土台**: ゴールデンの仕組み（現行の配布物で記録 → 新エンジンと比較）、計測スクリプトの一本化（比とサイズを出す）、公開 API の形（`setInitialState`・`connectedCallbackPromise`・`createState`・`getBindingsReady`） |
| 1 | **状態と getter の残り**: `$getAll`/`$setAll`/`$resolve`、循環検出、状態の読み込み（`json`・`src`・インラインスクリプト）、ライフサイクル（`$connectedCallback`/`$disconnectedCallback`/`$renderedCallback`/`$errorCallback`）、設定（`bootstrapState(config)`） |
| 2 | **構造**: `if` / `elseif` / `else` |
| 3 | **DOM バインディングの残り**: 双方向（`value`・`checked`・`select`）、`radio`/`checkbox`、`html`（Trusted Types 込み）、スプレッド、修飾子（`#ro`/`#wo`/`#init=`/`#sync=`）、空値の約束（B8）、フィルタのコア 24 個（型付きリテラル B9）、文法の全体（B1〜B4 の拒否を含む） |
| 4 | **Web Components との結線**: wc-bindable、command token、event token、binder と transition-runner の受け口 |
| 5 | **キー付き選択の残り**: `$eq`/`$eqPath` |

後付け機能（mount/volume・コンポーネントの mount・temporal・`$recursion`・SSR・DCC・`$listKeys`・formats・診断・DevTools）は、コアの受け口が固まった後に別の計画で扱う。

## 3. 記録

各段の結果は、この文書の末尾に追記する。記録する項目は次のとおり。
- テスト件数
- ゴールデンの差分
- 性能の比
- サイズ

計測の生データは `docs/research/state-engine/stage-<n>/` に置く。

## 4. 記録

### 段 0〜2（2026-09-24）

**段 0（比較の土台）**
- ゴールデンの仕組みを作った。
  - 記録: `npm run golden`。現行の `packages/state/dist/index.esm.js` でシナリオを流し、`__tests__/golden/current-3.3.0.json` に書く。
  - 比較: `__tests__/conformance.test.ts`。
  - シナリオの定義: `packages/state-next/conformance/scenarios.ts`。
- 両エンジンとも公開 API（`setInitialState`・`connectedCallbackPromise`・`createState`・`getBindingsReady`）だけで動かす。
- 計測は `bench/run-all.sh`（`OUT=… ROUNDS=…`）に一本化した。現行×2・新エンジン・DOM 直接を同じセッションで測り、比とサイズを `summary.json` に出す。

**段 1（状態と getter の残り）**
- 足したもの:
  - `$getAll`（添字の省略は行の文脈）、`$setAll`（全部に同じ値・マッパー・配る）、`$resolve`（引数の数で読み書き）
  - getter の循環と深さの検出
  - getter の中の書き込みと `createState("readonly")` を読み取り専用にする
  - バインディングの失敗の封じ込め、`$errorCallback`／`$renderedCallback`／`$connectedCallback`／`$disconnectedCallback`
  - 状態の読み込み（`state`・`src`・`json`・インラインスクリプト・`setInitialState`）
  - `bootstrapState(config)`
- ゴールデンで見つかった不具合: getter が例外で失敗した後に依存元を直しても、表示が戻らなかった。「失敗した」状態をキャッシュに持たせて直した。
- 未実装: 初期化済みの要素への `setInitialState`（状態の丸ごと置き換え）。

**段 2（if / elseif / else）**
- 描画の単位をブロックに一般化した（行も `if` の中身もブロック）。
- バインディングの登録先を「行ごとの一覧」と「ルートの表（Set）」に一本化した。

**結果**
- テスト 58 件（うちゴールデン 21 シナリオ）がすべて通過。

性能（`docs/research/state-engine/stage-2/`、2 周交互、同じセッションの DOM 直接と比較）:

| 指標 | 新エンジン | DOM 直接（同条件） | 比 | 判定 |
|---|---:|---:|---:|---|
| ウォーム 1,000 行作成 | 7.1ms | 4.05ms | 1.75 倍 | 到達 |
| コールド 10,000 行作成 | 76.95ms | 44.25ms | 1.74 倍 | 到達 |

- 現行との比較: 全消去（−2.8%、揺れの範囲）を除き、どの操作も 51〜85% 速い。`$eqIndex` の選択は 7.35 → 1.7ms。
- サイズ: `auto.min.js` は 31.8KB minified／gzip 11.1KB（段 0〜2 の範囲）。

### 段 3〜5（2026-09-24）

**段 3（DOM バインディングの残り）**
- 足したもの:
  - 双方向（input／textarea／select、`value`／`valueAsNumber`／`valueAsDate`／`checked`）、`radio`／`checkbox`、`html`（Trusted Types のポリシーを現行と同じ大域スロットで通す）
  - 修飾子（`#ro`・`#prevent`・`#stop`・`#on<名前>`）、明示的なプロパティ `.名前`
  - 空値の約束（B8）、class に真偽でない値を渡したときの失敗
- パーサ: サブエージェントが現行から移植した（`src/parser/`、テスト 191 件）。`PathInfo` への依存を外し、エラーメッセージと 3.0 の拒否（B1〜B4）はそのまま。
- フィルタ: サブエージェントが現行から移植した（`src/filters/`、テスト 227 件）。
  - コア 24 個（初回使用時に自動登録）と formats 24 個（`installFormats()`。全部入りの `auto` は登録する）に分けた。
  - 旧名の別名は持ち込まない。
  - 現行と新実装を並べた 37,265 ケースで差分ゼロ。

**段 4（Web Components との結線）**
- wc-bindable:
  - 出力専用・入力専用・双方向で、向きと初期同期の権限を決める。`#init=`／`#sync=` で上書きできる。
  - 属性への反映、`getter`（既定は `e.detail`）、`semantics: "event"`。
  - クラスが定義されるまで待ってから結線する。
  - 要素から来た値は、その要素へ書き戻さない。
- command token（`$commandTokens`、`command.<m>:`、`onclick: $command.x`）と event token（`$eventTokens`、`$on`、`eventToken.<p>:`）。
- スプレッド `...:`（後に書いた明示的なバインディングが勝つ）。

**段 5（キー付き選択の残り）**
- `$eq`／`$eqPath`（トップレベルの getter でも使える。親オブジェクトの置き換えで再キー付けする。行が消えたら購読を外す）。

**ゴールデンで見つかったこと**
- 現行 3.3.0 の不具合: README が約束する `html:`（innerHTML）と `text:`（textContent の別名）が実装されていない（素のプロパティとして書かれ、何も表示されない）。新エンジンは README に従い、シナリオで意図した差分として宣言した。
- 新エンジンの不具合（修正済み）: 要素から来た値を同じ要素へ書き戻し、属性を再反映していた。

**結果**
- テスト 500 件（うちゴールデン 41 シナリオ）がすべて通過。
- サイズ（gzip）: コアだけ（`dist/core.min.js`）18.3KB。formats 込みの `auto` は 19.1KB。コアの予算 20KB まで残り約 1.7KB。

性能（同じセッション・同じ条件の DOM 直接との比、各 18 サンプル、DOM 直接は前後 2 回）:

| 計測 | ウォーム 1,000 行作成 | コールド 10,000 行作成 |
|---|---:|---:|
| 段 5 の全体計測（`stage-5/`） | 1.66 倍 | **2.29 倍** |
| 絞り込み計測 a（`targets-a/`） | 1.89 倍 | **2.10 倍** |
| 行ごとの確保を削った後 b（`targets-b/`） | 1.95 倍 | **2.18 倍** |
| c: 通常（`targets-c/`） | 1.94 倍 | **2.17 倍** |
| c: イベントの委譲を入れた実験版 | 2.01 倍 | 2.04 倍 |

- **判定: 2 指標とも 2 倍の境界上。コールド 10,000 行は超えている。**
  - 段 2 の時点（1.74 倍）から、機能を足した分だけ行の生成が重くなった。コールドとウォームの差（約 40ms。DOM 直接は約 15ms）が大きく、初回実行の解釈・最適化とメモリ回収が効いている。
  - セッションごとの揺れも大きい。同じ現行が 331ms と 387ms で 17% 違う回もあった。
- イベントの委譲はコールド 10,000 行を約 6% 縮める。ただしハンドラから見える `event.currentTarget` がルートになる（意味の変更）ので、既定では無効（`config.delegateEvents`、実験用）。
- 現行との比較（`stage-5/`）: 全操作で同等以上。作成・置き換え・追加・更新・選択・削除は 52〜84% 速く、全消去は 5〜14% 速い（揺れの範囲を含む）。
