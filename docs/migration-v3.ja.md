# wcstack 2.x → 3.x 移行ガイド

**English**: [migration-v3.md](./migration-v3.md)

wcstack 3.0.0 の変更は `@wcstack/state` に集中しています。主題は 2 つです。**2.x が黙って丸めていた書き方を、3.0 は名指しで拒否するか、書いたとおりに読む。** そして **core と機能を分け、使う機能だけを入れられるようにした。** 他のパッケージ（router・I/O ノード・protocol）は版数が揃うだけで、挙動は変わりません。

互換層はありません。代わりに **2.6.x が、3.0 で拒否される・読み方が変わる書き方をすべて `wcs/v3-migration` で予告しています**（2.x のまま動かしつつ、書き方とサイトごとに 1 回）。2.6.1 に上げて警告を消してから 3.0 に上げるのが最短の経路です（[§2](#2-機械的な手順)）。

`@wcstack/state` の既定の入口（`@wcstack/state` と `/auto`）は全機能入りのままなので、分割エントリを使わないページは読み込み方を変える必要がありません。

設計の記録は [state-next-major-requirements.ja.md](./state-next-major-requirements.ja.md)（決定は §6）、リリースごとの一覧はルートの [CHANGELOG](../CHANGELOG.md)（英語）にあります。

## 1. 考え方

2.x のパーサと値の適用には、エラーにせず「それらしく」扱う箇所がありました。

```html
<input data-wcs="value#ro#wo: name">              <!-- 2 つ目の # 以降を捨て、ro だけ残す -->
<span data-wcs="textContent: tags|join('; ')"></span> <!-- 引用符の中の ; で束縛が 2 つに割れる -->
<li data-wcs="class.done: done|eq(true)"></li>    <!-- 真偽値を文字列 "true" と比べ、常に false -->
<img data-wcs="attr.alt: caption">                 <!-- caption が undefined だと alt="undefined" -->
```

3.0 は、壊れていた入力は `[wcs/binding-syntax]` などのコード付きで拒否し、意図の読める入力は書いたとおりに読みます。

```html
<input data-wcs="value#ro,wo: name">               <!-- 修飾子は 1 つの # の後にカンマ区切り -->
<span data-wcs="textContent: tags|join('; ')"></span> <!-- 引用符の中の ; と | は区切りではない -->
<li data-wcs="class.done: done|eq(true)"></li>    <!-- 引用符の無い true は真偽値 -->
<img data-wcs="attr.alt: caption">                 <!-- undefined / null は属性を削除 -->
```

もう 1 つの柱は分割エントリです。`@wcstack/state/core` はバインディングの本体だけを持ち、`$watch`・`bind-component`・SSR・書式フィルタなどは `@wcstack/state/features/*` から `installFeatures([...])` で足します。これは**追加の形式**で、既存のページには関係しません（[§4](#4-構文ではない挙動の変更)）。

## 2. 機械的な手順

1. **まず 2.6.1 に上げ、ページを動かします。** 3.0 で変わる書き方が通るたびに、コンソールに次の形で出ます。

   ```
   [@wcstack/state] [wcs/v3-migration] "value#ro#wo": 3.0 rejects a second "#". Write "value#ro,wo".
   See "Preparing for 3.0" in the @wcstack/state README.
   ```

   文法の行はバインディングを最初に解析したときに、値の行はその値が実際に来たときにだけ出ます。コンソールが静かでも、動かしていない経路については何も分かりません。
2. **バリデータで静的に洗います。** 2.6.x の `@wcstack/lint` と VS Code 拡張は、文法の行を同じ判定で `wcs/v3-migration`（info）として報告します。値の行（`undefined` の表示、readonly からの書き込みなど）は静的には分からないので、1 の実行とテストで拾います。

   ```bash
   npx @wcstack/lint@2.6 index.html
   ```
3. **警告を 1 件ずつ直します。** 置き換え先は警告の文言と [2.6.1 の README「3.0 への準備」](https://github.com/wcstack/wcstack/blob/v2.6.1/packages/state/README.ja.md#30-への準備wcsv3-migration)にあり、どれも 2.x のままで書ける形です — 直したページは 2.6.1 でも 3.0 でも同じに動きます。
4. **3.0 に上げます。** `@wcstack/*` のピンをすべて同じ版に揃えます。3.0 の `@wcstack/lint` / VS Code 拡張は、3.0 が拒否する書き方を `wcs/binding-syntax`（**error**）で報告します。

## 3. 破壊的変更の全表

すべて `@wcstack/state` です。「2.6 の予告」は 2.6.x の `wcs/v3-migration` が出るかどうか。

**文法**（バインディングを解析する段で落ちる。lint / VS Code 拡張も同じ判定）

| 書き方 | 2.x | 3.0 | 書き換え先 | 2.6 の予告 |
|---|---|---|---|---|
| 2 つ目の `#`（`value#ro#wo:`） | 最初の修飾子列だけ残す | `[wcs/binding-syntax]` | `value#ro,wo:` | 実行時・lint |
| `else:` の後ろの値（`else: x`） | 右辺を捨てる | `[wcs/binding-syntax]` | `else:` | 実行時・lint |
| `for` / `if` / `elseif` / `else` / `...` の左辺の修飾子・フィルタ | ただのプロパティのバインディングになる | `[wcs/binding-syntax]` | キーワードだけ | 実行時・lint |
| フィルタ引数の閉じていない引用符（`join('x)`） | 黙って閉じる | `[wcs/binding-syntax]` | 引用符を閉じる | 実行時・lint |
| フィルタが受け取る数の外の引数（`join(a,b)`） | 余りは無視 | 束縛計画の段で `[wcs/filter-arity]` | 余りを消す | 実行時・lint |
| 空のフィルタ（`x\|`・`x\|\|y`・`x\|(1)`） | `[wcs/filter-unknown]`（名前 `""`） | `[wcs/binding-syntax]`（コードが変わるだけ） | 空のフィルタを消す | — |
| `radio#ro:` / `checkbox#ro:` | `radio` という名前の素のプロパティになり、radio / checkbox として働かない | 修飾子を受けた radio / checkbox のバインディング | —（意図どおりか確かめる） | 実行時・lint |
| 引用符の中の `;` / `\|`（`join('; ')`・`join(' \| ')`） | そこで束縛が割れて壊れる | 区切りではない — 書いたとおりに動く | — | —（2.x で動いていたページは影響なし） |

**値と書き込み**（その値・その書き込みが来たときに変わる）

| 書き方 | 2.x | 3.0 | 書き換え先 | 2.6 の予告 |
|---|---|---|---|---|
| `eq` / `ne` の引用符の無い `true` / `false` / `null`（`eq(true)`） | 真偽値・`null` の値を文字列と比べる（真偽値は一致しない） | 型付きの値と比べる | 文字列で比べ続けるなら `eq('true')` | 実行時・lint（原文で判定） |
| `defaults` の引用符の無い `true` / `false` / `null` | 文字列（`"null"`）を既定値にする | 型付きの値（`null`） | 文字列のままなら `defaults('null')` | 実行時・lint（原文で判定） |
| `defaults` の引用符の無い数値（`defaults(0)`） | 文字列 `"0"` を既定値にする | 数値 `0` | 文字列のままなら `defaults('0')` | —（表示は同じ。後続のフィルタや比較で型が効く） |
| `truthy` / `falsy` / `defaults` に来た `0n` | 真 | 偽（JavaScript の真偽判定。`boolean` と同じ） | — | 実行時 |
| `textContent` / `innerText` / `innerHTML` への `undefined` | 前のテキストを残す（使い回した行では**前の行の**テキスト） | 空にする | 「前の表示を保つ」が要るなら値を保持する | 実行時 |
| `attr.*` への `undefined` / `null` | `"undefined"` / `"null"` を書く | 属性を削除する | — | 実行時 |
| `style.*` への `undefined` | 前の値を残す | 消す | — | 実行時 |
| `$resolve(path, indexes, undefined)` | 読む | `undefined` を書く（読み書きは引数の個数で決まる） | 読むなら `$resolve(path, indexes)` | 実行時 |
| readonly のプロキシからの `$resolve(path, indexes, value)` / `$setAll`（`**` の一斉書き込みを含む） | 書ける | `This state is readonly.` を投げる | `createState("writable", …)` の中で書く | 実行時 |
| `#ro` のマウント（`state#ro: user`・`state.title#ro: doc.title`）を通るコンポーネントの書き込み | ホストのツリーに書く | `[wcs/mount-readonly]` を投げる。コンポーネント内の双方向入力は書き戻さない | ホストで書くか、`#ro` を外す | 実行時 |
| 明示した部分マウントに覆われるコンポーネント自前の既定値（`state = { message: "" }` と `state.message: user.name`） | 既定値が勝つ（`wcs/mount-own-key-shadow` 警告） | 明示したマウントが勝つ — ホストの値が届く | 既定値を消す | 実行時 |

**ツール向けの面**（`@wcstack/state/parser` を import するツールだけが対象）

| 面 | 2.x | 3.0 |
|---|---|---|
| `ParseBindTextResult` の `inFilters` / `outFilters` | `IFilterInfo`（`filterFn` を持つ） | `IParsedFilter`（`filterName` / `args` / `literals`）。実関数は束縛計画の段で解決されるので、パースだけでは未知のフィルタで落ちない |
| `findV3MigrationIssues` / `findEmbeddedV3MigrationIssues` | 2.6.x だけにある | 削除（予告の役目を終えた） |
| `splitBindTexts` | — | 追加。ランタイムと同じ、引用符を知る `;` の分割 |

### 3.1 / 3.2 — 2.x から 3.2 へ直接上げるときに一緒に来るもの

ここに挙げたものは、3.0 で動いていた書き方を拒否しません。ただし 2.x から上げる人は最新の 3.x に着地するので、併せて読んでください。各項目の全文はルートの [CHANGELOG](../CHANGELOG.md)（英語）にあります。

| リリース | 変更 | 2.x から来たときの意味 |
|---|---|---|
| 3.1 | **明示のプロパティ形 `.name:`**（要件 B5） | 追加のみ。`online: x` は従来どおりイベント束縛（`"line"` の購読）で、`.online: x` が要素の `online` **プロパティ**です。先頭のドットは以前は適用の段で落ちていたので、動いていたページは変わりません。ドットの後の名前空間の語（`.class` / `.attr` / `.style` / `.command` / `.eventToken` / `.state`）と空の名前は `[wcs/binding-syntax]` |
| 3.1 | **ボリュームの注入口** `<wcs-state mount="cart" data-wcs="state.taxRate: settings.taxRate">`（要件 B14③） | 追加のみ。ただし 1 つ帰結があります: `<wcs-state mount=…>` の左辺が `state.` で始まると注入の宣言として読まれ、**束縛にはなりません**。2.x では無い `state` プロパティへの書き込みとして適用に失敗する束縛だったので、動いていたページは変わりません。`mount=` の無い `<wcs-state>` に書くと `[wcs/mount-path-invalid]` |
| 3.2 | **フィルタ / API / 宣言キーの正式名と、旧名のエイリアス**（要件 B12） | 2.x の書き方は 3.x の間そのまま動きます。好きな時期に改名してください: `inc`/`dec` → `add`/`sub`、`fix` → `toFixed`、`uc`/`lc`/`cap` → `upper`/`lower`/`capitalize`、`rep`/`rev` → `repeat`/`reverse`、`pad` → `padStart`、`null` → `nullIfEmpty`。`$trackDependency`/`$untrackDependency` → `$dependOn`/`$untracked`。`$updatedCallback` → `$renderedCallback`、`$streams` → `$stream`。lint と VS Code 拡張は旧名を `wcs/name-alias`（info）で示します。ランタイムが警告するのは 3.x の最後のマイナーだけで、4.0 で外します。**宣言キーを旧名と正式名の両方で書くと `[wcs/declaration-alias]`** — 動かなくなるのはこの形だけです。旧名で書いた宣言キーは、state がランタイムに入る時点で正式名へ**移される**（旧名はオブジェクトから消える）ので、state のコードが自分の宣言を読み返していた場合（`this.$streams` / `this.$updatedCallback`）は正式名（`this.$stream` / `this.$renderedCallback`）に直してください。3.x の間そのまま動くのは「宣言として書けること」であって「旧名で読み返せること」ではありません |
| 3.2 | `add` / `sub`（`inc` / `dec`）は引数が必須 | 2.x では引数表が「省略可」と言っていたため、引数なしの `inc` が lint を通ってからコードなしで落ちていました。今は `[wcs/filter-arity]` です |
| 3.2 | フィルタ `padEnd(n, c)` と `coalesce(v)` の追加 | 追加のみ。`coalesce` は `null` / `undefined` だけを置き換え、`defaults` は従来どおりすべての falsy を置き換えます。`padStart` の埋め文字の既定は `0`、`padEnd` は空白で、対は意図的に揃えていません（`padStart` はほぼゼロ埋めに使われるため） |

## 4. 構文ではない挙動の変更

- **分割エントリ（追加）。** `@wcstack/state/core`・`@wcstack/state/features/{temporal,scopes,recursion,ssr,formats,devtools,diagnostics}`・`@wcstack/state/define` が増えました。`@wcstack/state` と `/auto` は `bootstrapState()` が全機能を install するので、既存のページは同じ挙動・同じ API です。core を使うページで、宣言が要る機能を入れ忘れると `[wcs/feature-not-installed]` が入れるべきエントリを名指しして落ちます（`bind-component`・`mount=`・DCC も同じ — 2.x には「機能が無い」という状態自体がありませんでした）。分割の形は jsDelivr の素の `/npm/` パスかバンドラから読み、**`esm.run` からは読まないでください**（エントリごとに別のエンジンを抱えます）。詳しくは state README の[分割エントリ](../packages/state/README.ja.md#分割エントリ使う機能だけを入れる)、integrity は [sri.ja.md §5.1](./sri.ja.md#51-wcstackstate-の分割エントリ)。
- **表示の空値はサーバー描画にも効きます。** `@wcstack/server` はブラウザと同じランタイムで描画するので、`undefined` / `null` の属性は出力されず、`undefined` のテキストは空になります。スナップショットテストの期待値が変わることがあります。
- **`$errorCallback` をボリュームやマウントされたコンポーネントに宣言すると警告が出ます。** 2.6.0 から同じです（2.5 以前は黙って無視）。動くのは今もルートの state だけです。スコープごとに動くものは state README の [`mount=`](../packages/state/README.ja.md#追加の状態をマウントするmount) の表にまとめました。
- **名前付きエントリ（`dist/index.esm.js`）は minify 済みです。** gzip 321 KB → 78.5 KB。スタックトレースやプロファイルの関数名は読めなくなります。名前が要るときはソースから `WCS_STATE_UNMINIFIED=1 npm run build` でビルドしてください。
- **サイズ。** `auto.min.js` は 2.6.1 の 71.6 KB から約 77 KB gzip に増えました（機能の受け口と、上の破壊的修正の分）。機能を入れない core だけの分割の形は約 52 KB（チャンクごとの gzip の合計）です。
- **性能。** 2.5.1 と比べた中央値で、1 万行の生成（cold）−18.7%、1,000 行の追加 −15.9%、1 万行の消去 −14.7%。warm の 1,000 行生成は変わらず、退行した指標はありません。行あたりのヒープは 3.6 → 3.0 KB です（2.6 相当のビルドとの比較）。

## 5. ツール

| ツール | 変わること |
|---|---|
| `@wcstack/lint` / VS Code 拡張 | `wcs/binding-syntax`（**error**）を新設: 閉じていない引用符・2 つ目の `#`・`else:` の後ろの値・構造ディレクティブ / spread の修飾子やフィルタ・空のフィルタ。判定は正本パーサ（`@wcstack/state/parser`）そのものなので、ランタイムとずれません。2.6.x の `wcs/v3-migration`（info）は無くなりました。引用符の中の `;` は区切りとして扱いません |
| `@wcstack/devtools` | State ペインに **Keyed selection** 節が増えました: `$eq` / `$eqPath` / `$eqIndex` の購読を path ごとに数え、全行を再評価する getter の path には `tracked` バッジを付けます。読む元の `keyedSubscriptions(rootNode)` は追加の pull API なので hook protocol は v2 のままです — 2.x の devtools ビルドも 3.0 の state を（節なしで）表示でき、3.0 のビルドは 2.x の state では節を出しません |
| `@wcstack/server` | API は変更なし。3.0 の `@wcstack/state` と組で使います。描画結果は §4 の空値の規則に従います |
| `@wcstack/testing` / `wcs-schema`（`@wcstack/typescript`）/ manifest | 変更なし（manifest は `schemaVersion` 2 のまま） |
| `wcstack/auto`・CDN ピン | 全パッケージ同時リリース。`@wcstack/*` のタグは全部同じ版に揃えます。リリースごとの SRI ダイジェストは GitHub Release ページと [sri.ja.md](./sri.ja.md) |

## 6. チェックリスト

```text
[ ] 2.6.1 でページとテストを動かす        → wcs/v3-migration の警告ゼロ
[ ] npx @wcstack/lint@2.6 <全 html>       → wcs/v3-migration（info）ゼロ
[ ] value#ro#wo → value#ro,wo ; else: x → else: ; 構造ディレクティブの修飾子・フィルタを消す
[ ] 閉じていない引用符・余分なフィルタ引数・空のフィルタを消す
[ ] eq(true) / defaults(null) の意図を確かめる（文字列なら引用符を付ける）
[ ] undefined を「前の表示を保つ」つもりで返していないか（表示は空になる）
[ ] $resolve(p, i, undefined) を読みのつもりで書いていないか
[ ] readonly のプロキシ・#ro のマウントを通して書いていないか
[ ] 部分マウントに覆われる既定値を消す
[ ] @wcstack/state/parser を使うツール: IParsedFilter に合わせる
[ ] @wcstack/* のピンを 3.0 の 1 つの版に揃える
[ ] npx @wcstack/lint <全 html>           → error ゼロ
```

## 7. 2.x 後期にも変わったもの

2.6.0 より前から上げる場合、次は minor / patch リリースで入った変更で、3.0 の変更とは独立に影響します。詳細は [CHANGELOG](../CHANGELOG.md) の各版を参照してください。

- **2.6.1 — 鍵付き選択の穴を修正**: オブジェクトの鍵・`path` の祖先への書き込み・getter の `path` で、選択が行に届かなかった件。
- **2.6.0 — 鍵付き選択（`$eq` / `$eqPath` / `$eqIndex`）を追加**。`defineState` だけの import はランタイムを残さなくなりました。
- **2.5.0 — 初期化済みの要素への `setInitialState()` は画面を描き直します**（以前は次の書き込みまで古い表示が残った）。ロード済みのボリュームへの `setInitialState()` は throw します。
