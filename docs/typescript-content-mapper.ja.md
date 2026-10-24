# TypeScript 7 の下の `<wcs-state>`: content mapper

**English**: [typescript-content-mapper.md](./typescript-content-mapper.md)

- **状態**: 設計。未実装。2026-10-24 に TypeScript 7.1.0-beta（2026-10-20 公開。RC は約 1 か月後の見込み）に対して書いた。以下の数値はすべて、リポジトリの外で同じ beta に対して動かした試作から取った。§8 の決定は著者のもの。
- **読み手**: `@wcstack/typescript` と `packages/vscode-wcs` に TypeScript 7 の対応を入れる人と、入れるかどうか・いつ入れるかを決める著者。
- **ここまでに出したもの**: 4.6.1 は TypeScript 7 を名指しで断る（peer は `typescript >=5.0 <7`、2 つのコマンドは版を名指しして exit 2）。4.6.2 は getter の本体を検査する（§5.3）。mapper はこれをそのまま受け継ぐ。

## 1. なぜ: TypeScript 7 は `wcs-tsc` と `wcs-schema` の足場を外した

TypeScript 7 はネイティブ（Go）のコンパイラである。npm のパッケージは JavaScript のコンパイラ API を公開しない。`typescript` 7.0.2 と 7.1.0-beta のルートの export は `./lib/version.cjs`（`{ version, versionMajorMinor }`）で、`exports` に `./lib/tsc` は無い。

| 道具 | 5 / 6 での仕組み | 7 では |
|---|---|---|
| `wcs-tsc` | vue-tsc と同じ: `@volar/typescript` の `runTsc` がプロジェクトの `typescript/lib/tsc.js` にパッチを当て、tsc に `.html` を受け付けさせ、言語プラグイン経由で program を組む（[typescript.ja.md](./typescript.ja.md) §4） | パッチを当てる `lib/tsc.js` が無い |
| `wcs-schema` / `loadStateFile` | `import ts from "typescript"` から `createProgram` とチェッカー | `createProgram` もチェッカーも無い |
| VS Code 拡張 | TypeScript 5.9 と Volar 2.4 を同梱 | 影響なし: プロジェクトの TypeScript を読まない |

いま `npm i -D typescript` で入るのは 7 なので、新しいプロジェクトは最初のインストールでこれに当たる。4.6.1 は足りないものに当たって落ちる代わりにそう言うが、7 の下で `<wcs-state>` を型検査するものはまだ無い。

TypeScript 7.1 は代わりを 2 つ持ってくる。表の 1 行目には **content mapper**（この文書）、2 行目には新しい**プログラム API**（`typescript/sync`・`typescript/async`、§7）。

## 2. content mapper とは

content mapper（[microsoft/typescript-go#4712](https://github.com/microsoft/typescript-go/pull/4712)、2026-08-19 にマージ）は、TypeScript が知らない種類のファイルを program に入れる仕組みである。mapper はファイルのテキストを TypeScript に変換し、両者の間の範囲の対応を返す。TypeScript は変換後の TypeScript を検査し、元のファイルの位置で報告する。Volar のモデルを TypeScript の機能にしたもので、Vue・Svelte・Astro・MDX・Ember・CSS Modules に試作がある。

- **設定**は、プロジェクトの `tsconfig.json` に書く:
  ```jsonc
  {
    "include": ["src"],                       // 対応付けた拡張子も含む
    "contentMappers": [
      { "package": "@wcstack/typescript", "extensions": [".html"], "options": { } }
    ]
  }
  ```
  `package` は Node のモジュールとして解決される。その `package.json` のトップレベルの `typescript` に mapper を宣言する: `"typescript": { "contentMapper": { "exec": ["node", "./dist/content-mapper.cjs"] } }`。`exec` は任意のコマンドでよい。`compilerOptions`（変換が読むオプション）と `dynamicConfig` は省ける。
- **プロトコル**: TypeScript が mapper を起動し、標準入出力の JSON-RPC（`Content-Length` の枠）で話す。要求を送るのはいつも TypeScript で、`initialize`（位置の単位を `utf-8` か `utf-16` から選ぶ・診断の出所の名前）、`openProject`（不透明なプロジェクトのハンドル・その項目の `options`・実効のコンパイラオプション）、`transform`（`fileName`・`content`）、`closeProject` の 4 つ。同じパッケージ・同じ版を使うプロジェクトは 1 つのプロセスがまとめて受ける。
- **`transform` が返すもの**は、正規の出力 1 つと、省ける `supplemental` の出力（`{ text, extension, mappings }`）。supplemental の出力は、同じ program に入るが import できないファイルで、1 ファイルが複数のスクリプトを持つときはこれを使う。範囲の対応は `[virtualStart, virtualLength, originalStart, originalLength, kind, features?]` で、`kind` は `Verbatim`（同じテキスト）・`Atom`・`Alias`、`features` はその範囲を使ってよい言語機能のビットマスク。どの範囲にも入らないテキストは合成されたものとして扱われる。
- **許可**: mapper は任意の実行ファイルなので、`tsc` は `--runExternalCode` が無いと `contentMappers` を拒む（TS18068）。言語サーバーは、クライアントが LSP の `initializationOptions` に `runExternalCode: true` を渡したときだけ mapper を動かす（VS Code は信頼したワークスペースで渡す）。`tsc --lsp` にそのコマンドラインフラグは無い。VS Code では `js/ts.contentMappers.enabled` で機能ごと止められる。
- **診断**は範囲を通して元の位置に戻る。合成されたテキストの中の診断は（Volar と違って）捨てられず、CLI は生成コードの抜粋と一緒に出す。合成されたテキストの中の「宣言したが使っていない」は抑える。診断をコードで絞ることはできず、抑える手段は `diagnosticDirectives`（仮想の範囲に expect / ignore）だけ。
- **エディタでの起動**: VS Code 拡張は TypeScript 7 の拡張（`TypeScriptTeam.native-preview`）の `registerContentMappers(contributorId, [{ extensions, inferredProjectContribution? }])` を呼ぶ。これで `tsconfig.json` が mapper を名指す前から `.html` が TypeScript のサーバーに届く。`inferredProjectContribution` は、どの設定済みプロジェクトにも属さないファイル向けの manifest を持ち込む。`registerLspMiddleware` でサーバーの応答を書き換えられる。
- **出力**: 対応付けたファイルは JavaScript には出力されない。`--declaration` なら `App.svelte` は `App.d.svelte.ts`（supplemental の分は `App.svelte.0.d.ts` …）を出す。declaration map は無い。
- **インクリメンタル**: `--incremental`・`--build`・`--watch` は動く。静的な mapper の同一性は、パッケージ名と版・`options`・それが列挙したコンパイラオプションなので、変換を変えたら版を上げる。

## 3. 試作で測ったこと

試作は約 100 行の mapper で、`dist/tsc-core.cjs`（`wcs-tsc` と拡張が使うのと同じ `createWcsLanguagePlugin`）を包み、Volar の `VirtualCode` をプロトコルに訳した。正規の出力は `export {};`、`<wcs-state>` のブロック 1 つにつき supplemental の出力 1 つ（Language Server モードの仮想コード: プリアンブル、`defineState` のラップ、`@wcstack/state` の import の除去）。

| 問い | 結果 |
|---|---|
| mapper は `.html` を取れるか | 取れる。`<wcs-state>` の無いページは `export {};` で、マークアップが TypeScript として読まれることはない（上流の HTML の見本は VS Code の HTML と離れるために `.dhtml` を取っている。§6） |
| Volar の対応はそのまま使えるか | そのままでは使えない。TypeScript は `Verbatim` の範囲を 1 文字ずつ元のテキストと照合し、違えば拒む（TS18073）。プラグインは `@wcstack/state` の import を空白にしたうえでブロック全体を 1 つの範囲で結んでおり、Volar はそれを許していた。範囲を一致する区間ごとに分け、違う区間は対応なしにすると通る |
| 1 ページに複数の `<wcs-state>` | それぞれ supplemental の出力 1 つ。別のファイルなので、同じ `const helper` を宣言する 2 つのブロックはぶつからない — tsc モードの合成（`buildCombinedScript`: 1 本のモジュール、import の巻き上げ、ブロックスコープ）は要らない |
| `wcs-tsc` との一致 | `examples/` の 33 ページ（CI の `examples/tsconfig.wcs-tsc.json`）で、7.1 の mapper と 5.9 の `wcs-tsc` は同じ診断を同じ位置に出す。4.6.2 より前は 23 件、4.6.2 では 25 件。ブロックの間の多バイト文字も正しく戻る（`utf-16` の位置） |
| `--url-imports=any` | `declare module "https://*"; declare module "http://*";` だけの supplemental の出力（グローバルなスクリプト）で、CDN の import は `any` になる。無ければ TS2307。どのページが宣言してもよい |
| 言語サーバー | `tsc --lsp --stdio` に `initializationOptions: { runExternalCode: true }` を渡すと、`.html` の hover・定義（正しいブロックへ）・診断を HTML の位置で返す。渡さなければ `.html` には何も返さない |
| 速さ | 33 ページで、起動込みで 7.1 が約 1.0 秒、5.9 の `wcs-tsc` が約 1.6 秒 |

## 4. 設計

### 4.1 パッケージ

mapper は、すでに `wcs-tsc` と `wcs-schema` を持つ `@wcstack/typescript` に入れる:

- `package.json`: `"typescript": { "contentMapper": { "exec": ["node", "./dist/content-mapper.cjs"] } }`。変換はコンパイラオプションを読まないので `compilerOptions` は書かず、`dynamicConfig` も無し。同一性は静的になり、`--build` はプロセスを起こさずに判断できる。
- `dist/content-mapper.cjs` は `tsc-core.cjs` と同じく作る: esbuild が `packages/vscode-wcs`（プラグインの正本）から束ね、`scripts/build-schema-core.mjs` がコピーする。Node の組み込みだけを使うので、パッケージのランタイム依存はゼロのまま。7 の下では、実行時に `typescript` も Volar も要らない。
- プロジェクトは `{ "package": "@wcstack/typescript", "extensions": [".html"] }` と書く。オプション（`openProject` で検査し、`optionDiagnostics` で報告する）:
  - `stateTagName`（既定 `wcs-state`）。拡張の `wcstack.stateTagName` と同じ。
  - `urlImports`: `"any"`（既定）か `"error"`。`wcs-tsc --url-imports` と同じ。

### 4.2 変換

`transform` はファイルごとに返す:

1. **正規の出力**: `export {};`、拡張子 `.ts`、対応なし。
2. **`<wcs-state>` のブロックごとに supplemental の出力 1 つ**: Language Server モードの仮想コード — ブロックごとにプリアンブル 1 回、`@wcstack/state` の import を除いたユーザーコード、`defineState(…)` で包んだ `export default {…}`、`this` を読む getter ごとの `: any`（§5.3）。拡張子 `.ts`。
3. **`urlImports: "any"` なら**: 2 つの短縮形の ambient module 宣言だけの supplemental の出力をもう 1 つ。

対応は、挿入するテキストとユーザーコードをすでに分けているプラグインの `VirtualCodeBuilder` が作る。mapper はユーザーコードの断片をそれぞれ 1 つの `Verbatim` の範囲（`features` は既定の全部）として出す。その前に、断片が元のテキストと一致することを確かめる。プリアンブル・`defineState(`・`)`・`: any`・空白にした import は合成されたテキストとする。空白にした import は、範囲ではなく隙間にしなければならない。テキストがもう一致しないからである（§3）。

位置: TypeScript が `utf-16` を出せばそれを取る（JavaScript の文字列のオフセットで、プラグインが計算するもの）。出さなければ両側を `utf-8` に直す。

### 4.3 プラグインの再利用

仮想コードの定義はプラグイン 1 つのまま（[typescript.ja.md](./typescript.ja.md) §4: エディタが下線を引くものがそのまま CI に出る）。mapper は、Volar の言語サーバーと `runTsc` に並ぶ 3 つ目の使い手である:

- `createWcsLanguagePlugin`（Language Server モード）がブロックごとの仮想コードを出し、mapper はその枠を付け直すだけ。tsc モードと `buildCombinedScript` は、5 / 6 の `wcs-tsc` のために残る。
- 共通のテストで、例のどのページについても、mapper が出す `Verbatim` の範囲がすべて元のテキストと一致することを確かめる — TypeScript が実行時に確かめること（TS18073）。

### 4.4 失敗

パースできないブロックも対応付ける。構文エラーは TypeScript が HTML の位置で報告する。クラッシュやプロトコルの誤りは TypeScript が報告し、そのファイルを空として読む。1 つのプロジェクトで 5 回失敗すると、TypeScript はその mapper を呼ばなくなる。だから mapper は `transform` の外へ例外を出さない。受けられない要求（知らないプロジェクトのハンドル）は JSON-RPC のエラーにする。

### 4.5 合成されたテキストの中のプリアンブル

Volar の下では、プリアンブルの中の診断は捨てられていた。content mapper の下では、プリアンブルの抜粋付きで出る。だからプリアンブルは、プロジェクトが設定しうるどのオプションの下でもきれいでなければならない: `strict`、`noImplicitAny`、`noUnusedLocals`（合成されたテキストの未使用の宣言は抑えられるが、ほかの検査は抑えられない）、`exactOptionalPropertyTypes`、`noUncheckedIndexedAccess`、`wcs-tsc` が受け付ける `lib` / `target` の組み合わせ。これらのオプションの組み合わせでテストを足す。

## 5. CLI

### 5.1 動かし方

```bash
npm i -D @wcstack/typescript typescript@^7.1
npx tsc --noEmit --runExternalCode
```

`--runExternalCode` は必須で、渡すのは利用者である。`declaration: true` のプロジェクトは、ページごとに `index.d.html.ts` と supplemental の `.d.ts` を出してしまう。ページには `noEmit`（または別の tsconfig）を勧める。

### 5.2 7 の下の `wcs-tsc`

`wcs-tsc` は、両方の世界で 1 つのコマンドのままでいられる。5 / 6 では今のまま。7.1 以降では、プロジェクトの `tsc` を `--runExternalCode` 付きで、利用者の設定を extends して `contentMappers` の項目を足した一時の設定で動かす（今の `--wcs-defaults` がオプションを足すのと同じやり方）。`--url-imports` は mapper のオプションとして渡す。mapper の無い 7.0 では、4.6.1 の断りのまま。こうすれば利用者の tsconfig は変えなくてよく、CI のスクリプトも `npx wcs-tsc` のままでよい。

### 5.3 getter（4.6.2 で出す）

`defineState<T>(def: T & ThisType<…T…>)` は T をオブジェクトリテラルから推論する。戻り値の型注釈の無い getter の型は本体から推論され、本体が `this` を読むと推論が T に戻ってくる。TypeScript はその getter を `any` にし、本体の `this` も `any` のままにする。だから `get first() { return this.items[0].nmae; }` は報告されず、`strict` では getter の中のコールバック（`this.items.filter((i) => …)`）が暗黙の `any`（TS7006）になっていた。メソッドは影響を受けない。これは TypeScript の振る舞い（5.9 も 7.1 も同じ）で、`.ts` の state ファイルについては [define-state.ja.md](../packages/state/docs/define-state.ja.md#戻り値の型が推論される-getter) に書いてある。

インラインのスクリプトは JavaScript なので、作者は注釈を書けない。4.6.2 から、プラグインは state オブジェクトの直下の getter のうち `this` を読むものの引数リストの後ろに `: any` を挟む（`src/language/getterAnnotations.ts`、acorn）。挟んだテキストには対応が無い。getter の型はもともと `any` だったので失うものは無く、本体は推論された `this` で検査される。mapper はこれを受け継ぐ。7.1 でも、getter の typo を `wcs-tsc` と同じ HTML の位置で報告する。

## 6. エディタ

拡張は TypeScript 7 を必要とせず、そのまま動く。問題は、その隣で何が起きるかである。

- **重なり。** tsconfig が mapper を名指す信頼したワークスペースでは、TypeScript 7 のサーバーも `.html` に応える（§3）。その診断と hover が拡張のものと並ぶ。診断は範囲ごとに止められない（§2）ので、1 つの tsconfig のまま「エディタでは黙り、CLI では話す」mapper にはできない。
- **案 A — Volar を残して身を引く（まずこれを推す）。** 拡張は、TypeScript 7 の拡張が動いていて、ワークスペースの tsconfig が `.html` に `@wcstack/typescript` を名指していることを検出する。そのときは `<wcs-state>` のスクリプトへの TypeScript の機能（Volar の TypeScript サービスプラグイン）を止め、`data-wcs` のもの（検証・補完・ナビゲーション・レンズ）は残す。これらは TypeScript のサービスを使っていない。それまでは、両方を使う人には README で `js/ts.contentMappers.enabled: false` を案内する。
- **案 B — 任せる（後で）。** 拡張は同梱の mapper（またはワークスペースの `@wcstack/typescript`）で `registerContentMappers("wcstack.wcstack-intellisense", [{ extensions: [".html"], inferredProjectContribution: { manifest } }])` を呼び、同梱の TypeScript と Volar の TypeScript プラグインを外す。拡張は `data-wcs` だけに縮む。TypeScript 7 の拡張が入っていることが前提で、それが VS Code の既定になってから正しくなる。
- **VS Code の HTML。** 組み込みの HTML 言語サーバーは、すでに `<script>` の中で JavaScript の機能を出す。案 B では、1 つの `<script>` に HTML のサーバー・TypeScript 7・拡張の 3 つが応えうる。上流の見本はファイルを `.dhtml` にしてこの問いを避けた。B を選ぶ前に測る。

## 7. `wcs-schema` は別の移植

content mapper は `wcs-schema` に触れない。`wcs-schema` は `.ts` / `.js` の state ファイルをチェッカーで読む。TypeScript 7.1 の `typescript/sync` の API には、使っているチェッカーの呼び出し（`getPropertiesOfType`・`getTypeOfSymbolAtLocation`・`isArrayType`・`isTupleType`・`getTypeArguments`・`getIndexInfosOfType`・`typeToString`・`getCallSignatures`）がある。オブジェクトは `Disposable` で、ネイティブのコンパイラと IPC で話し、API 自身が不安定だと言っている。移植は、その API の上にもう 1 つ `program.ts` / `typeToSchema.ts` を書き、入っているメジャー版で選ぶことになる。API がプレビューを出てから計画する。

## 8. 著者の決定

1. **いつ。** 7.1 が beta のうちに mapper を作るか（プロトコルは PR のマージ後にも変わった、[microsoft/TypeScript#63936](https://github.com/microsoft/TypeScript/pull/63936)）、7.1 の stable の後か。推奨: いまブランチで試作し、stable の後に、1 つの minor の間は experimental として出す。
2. **peer の範囲**（mapper を出したら）: `typescript: ">=5.0 <7 || >=7.1"`。各コマンドが要る版を確かめる（`wcs-schema` は §7 まで 5 / 6 のまま）。
3. **CLI の形**: `wcs-tsc` が自分で `tsc --runExternalCode` を動かす（§5.2）か、`tsc` の呼び方を文書に書くだけか。推奨: 両方 — 続けて使えるように `wcs-tsc`、`tsc` は文書に。
4. **エディタ**: いまは検出付きの案 A、TypeScript 7 の拡張が VS Code の既定になったら案 B（§6）。
5. **オプション**（`stateTagName`・`urlImports`）とその既定。

## 9. テストの計画

- **単体**（vscode-wcs）: プラグインのフィクスチャに対する変換の出力。`Verbatim` の範囲がすべて元のテキストと一致すること。`utf-8` と `utf-16` の位置。プロトコル（initialize → openProject → transform → closeProject、1 つのプロセスに 2 つのプロジェクトのハンドル、知らないハンドル、壊れた入力）。
- **一致**（CI。`wcs-tsc` の job と同じく、最初はゲートにしない）: `typescript@7.1` の `tsc --runExternalCode` を `examples/` にかけた結果が、5.9 の `wcs-tsc` とちょうど同じになること。
- **オプションの組み合わせ**: §4.5 のオプションの下でプリアンブルがきれいなこと。
- **言語サーバーのスモーク**: `runExternalCode` 付きの `tsc --lsp --stdio` が、フィクスチャのページで hover・定義・診断に応えること。付けなければ何も返さないこと。
- **エディタ**: 案 A の検出を、両方の拡張を入れた VS Code で手で確かめる。

## 10. 参照

- [Announcing TypeScript 7.1 Beta](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/)
- [microsoft/typescript-go#4712 — Content mappers](https://github.com/microsoft/typescript-go/pull/4712)（プロトコル、範囲の対応、LSP での起動、出力、インクリメンタル）
- [microsoft/TypeScript#63800 — API usage patterns for complex editor extensions](https://github.com/microsoft/TypeScript/issues/63800)
- [DanielRosenwasser/content-mapper-sample](https://github.com/DanielRosenwasser/content-mapper-sample)（`<script>` とイベントハンドラ属性を扱う HTML の mapper）
- [typescript.ja.md](./typescript.ja.md) §4 — 今の `wcs-tsc` と言語プラグイン
