# TypeScript 7 の下の `<wcs-state>`: content mapper

**English**: [typescript-content-mapper.md](./typescript-content-mapper.md)

- **状態**: 実装済み・experimental・未リリース（ブランチ `feat/typescript-content-mapper`。TypeScript 7.1 の stable の後に 4.7 で出す予定 — §8）。設計は 2026-10-24 に TypeScript 7.1.0-beta（2026-10-20 公開。RC は約 1 か月後の見込み）に対して、リポジトリの外の試作から書いた。実装は同じ日に 7.1.0-beta と 7.1.0-dev.20261023.1 で測った。§8 の決定は著者のもの。
- **読み手**: `@wcstack/typescript` と `packages/vscode-wcs` の TypeScript 7 の対応を保守する人と、いつ出すかを決める著者。
- **ここまでに出したもの**: 4.6.1 は TypeScript 7 を名指しで断る（peer は `typescript >=5.0 <7`、2 つのコマンドは版を名指しして exit 2）。4.6.2 は getter の本体を検査する（§5.3）。mapper はこれをそのまま受け継ぐ。

## 1. なぜ: TypeScript 7 は `wcs-tsc` と `wcs-schema` の足場を外した

TypeScript 7 はネイティブ（Go）のコンパイラである。npm のパッケージは JavaScript のコンパイラ API を公開しない。`typescript` 7.0.2 と 7.1.0-beta のルートの export は `./lib/version.cjs`（`{ version, versionMajorMinor }`）で、`exports` に `./lib/tsc` は無い。

| 道具 | 5 / 6 での仕組み | 7 では |
|---|---|---|
| `wcs-tsc` | vue-tsc と同じ: `@volar/typescript` の `runTsc` がプロジェクトの `typescript/lib/tsc.js` にパッチを当て、tsc に `.html` を受け付けさせ、言語プラグイン経由で program を組む（[typescript.ja.md](./typescript.ja.md) §4） | パッチを当てる `lib/tsc.js` が無い |
| `wcs-schema` / `loadStateFile` | `import ts from "typescript"` から `createProgram` とチェッカー | `createProgram` もチェッカーも無い |
| VS Code 拡張 | TypeScript 5.9 と Volar 2.4 を同梱 | 影響なし: プロジェクトの TypeScript を読まない |

いま `npm i -D typescript` で入るのは 7 なので、新しいプロジェクトは最初のインストールでこれに当たる。4.6.1 は足りないものに当たって落ちる代わりにそう言う。

TypeScript 7.1 は代わりを 2 つ持ってくる。表の 1 行目には **content mapper**（この文書）、2 行目には新しい**プログラム API**（`typescript/sync`・`typescript/async`、§7）。

## 2. content mapper とは

content mapper（[microsoft/typescript-go#4712](https://github.com/microsoft/typescript-go/pull/4712)、2026-08-19 にマージ。[microsoft/TypeScript#63936](https://github.com/microsoft/TypeScript/pull/63936) で仕上げ。ソースはいま microsoft/TypeScript の `tsc/internal/contentmapper`）は、TypeScript が知らない種類のファイルを program に入れる仕組みである。mapper はファイルのテキストを TypeScript に変換し、両者の間の範囲の対応を返す。TypeScript は変換後の TypeScript を検査し、元のファイルの位置で報告する。Volar のモデルを TypeScript の機能にしたもので、Vue・Svelte・Astro・MDX・Ember・CSS Modules に試作がある。

- **設定**は、プロジェクトの `tsconfig.json` に書く:
  ```jsonc
  {
    "include": ["src"],                       // 対応付けた拡張子も含む
    "contentMappers": [
      { "package": "@wcstack/typescript", "extensions": [".html"], "options": { } }
    ]
  }
  ```
  `package` は設定のディレクトリから Node のモジュールとして解決される（絶対パスや相対パスは拒まれる、TS18075）。その `package.json` のトップレベルの `typescript` に mapper を宣言する: `"typescript": { "contentMapper": { "exec": ["node", "./dist/content-mapper.cjs"] } }`。`exec` は任意のコマンドでよい。`compilerOptions`（変換が読むオプション）・`dynamicConfig`・`outputExtensions` は省ける。`contentMappers` は `extends` で継承され、自分の配列は継承した配列を置き換える。1 つの拡張子に mapper は 1 つだけ（TS18067）。
- **プロトコル**: TypeScript が mapper を起動し、標準入出力の JSON-RPC（`Content-Length` の枠）で話す。要求を送るのはいつも TypeScript で、次の 4 つ:
  - `initialize`: 受け付ける位置の単位と、省ける `locale` が来る。答えで `utf-8` か `utf-16` を選び、診断の出所の名前を返す。その名前は `typescript`・`tsc`・扱う拡張子と同じであってはならない。
  - `openProject`: 不透明なプロジェクトのハンドル、その項目の `options`、実効のコンパイラオプションが来る。答えには `optionDiagnostics` を載せられる。`configIdentity` / `watchedFiles` を返せるのは `dynamicConfig` の mapper だけ。
  - `transform`: `fileName` と `content` が来る。
  - `closeProject`: `null` で答える。閉じたハンドルは後で開き直されうる。

  同じパッケージ・同じ版を使うプロジェクトは 1 つのプロセスがまとめて受ける。round 2（#63936）で `protocolVersion` が消え、診断の `code` が必須になった。
- **`transform` が返すもの**は、正規の出力 1 つと、省ける `supplemental` の出力（`{ text, extension, mappings, diagnosticDirectives? }`）。
  - supplemental の出力は、同じ program に入るが import できないファイルで、1 ファイルが複数のスクリプトを持つときはこれを使う。
  - `.mts` / `.cts` / `.mjs` / `.cjs` の出力は、いつもモジュールとして読まれる。
  - 範囲の対応は `[virtualStart, virtualLength, originalStart, originalLength, kind, features?]` で、仮想側の昇順・重なり無し。`kind` は `Verbatim`（同じテキスト。1 文字ずつ照合される）・`Atom`・`Alias`、`features` はその範囲を使ってよい言語機能のビットマスク。
  - どの範囲にも入らないテキストは合成されたものとして扱われる。位置がコードポイントを割ってはならない。
- **許可**: mapper は任意の実行ファイルなので、`tsc` は `--runExternalCode` が無いと `contentMappers` を拒む（TS18068）。言語サーバーは、クライアントが LSP の `initializationOptions` に `runExternalCode: true` を渡したときだけ mapper を動かす（VS Code は信頼したワークスペースで渡す）。`tsc --lsp` にそのコマンドラインフラグは無い。VS Code では `js/ts.contentMappers.enabled` で機能ごと止められる。
- **診断**は範囲を通して元の位置に戻る。
  - 合成されたテキストの中の診断は（Volar と違って）捨てられず、CLI は生成コードの抜粋と一緒に出す。
  - 合成されたテキストの中の「宣言したが使っていない」は抑える。
  - 診断をコードで絞ることはできない。抑える手段は `diagnosticDirectives` だけで、形は `[originalStart, originalLength, virtualStart, virtualEnd, policy]`（仮想側は長さではなく終端）。仮想範囲は互いに重ならず、policy は `0` が ignore、`1` が expect。
- **エディタでの起動**: VS Code 拡張は TypeScript 7 の拡張（`TypeScriptTeam.native-preview`）の `registerContentMappers(contributorId, [{ extensions, inferredProjectContribution? }])` を呼ぶ。これで `tsconfig.json` が mapper を名指す前から `.html` が TypeScript のサーバーに届く。`inferredProjectContribution` は、どの設定済みプロジェクトにも属さないファイル向けの manifest を持ち込む。`registerLspMiddleware` でサーバーの応答を書き換えられる。
- **出力**: 対応付けたファイルは JavaScript には出力されない。`--declaration` なら `App.svelte` は `App.d.svelte.ts`（supplemental の分は `App.svelte.0.d.ts` …）を出す。
- **インクリメンタル**: `--incremental`・`--build`・`--watch` は動く。静的な mapper の同一性は、パッケージ名と版・`options`・それが列挙したコンパイラオプションなので、変換を変えたら版を上げる。

## 3. 測ったこと

試作は約 100 行の mapper で、`dist/tsc-core.cjs`（`wcs-tsc` と拡張が使うのと同じ `createWcsLanguagePlugin`）を包み、Volar の `VirtualCode` をプロトコルに訳した。実装（§4）はその形を保ち、試作と計画のレビューで見つかったことを直した。

| 問い | 結果 |
|---|---|
| mapper は `.html` を取れるか | 取れる。`<wcs-state>` の無いページは空の出力で、マークアップが TypeScript として読まれることはない（上流の HTML の見本は VS Code の HTML と離れるために `.dhtml` を取っている。§6） |
| Volar の対応はそのまま使えるか | そのままでは使えなかった。TypeScript は `Verbatim` の範囲を 1 文字ずつ元のテキストと照合し、違えば拒む（TS18073）。プラグインは `@wcstack/state` の import を空白にしたうえでブロック全体を 1 つの範囲で結んでおり、Volar はそれを許していた。プラグインは空白にした import を結ばなくなったので、作る対応はどれも一致する（§4.2） |
| 1 ページに複数の `<wcs-state>` | それぞれ supplemental の出力 1 つ。別のファイルなので、同じ `const helper` を宣言する 2 つのブロックはぶつからない — tsc モードの合成（`buildCombinedScript`: 1 本のモジュール、import の巻き上げ、ブロックスコープ）は要らない |
| 出力は `.ts` か `.mts` か | `.mts`。`.ts` の出力は、import も export も無いブロックだとスクリプトになり、プリアンブルの宣言がページをまたいで衝突する（TS2451 / TS2393）。`module: nodenext`（7.1 の `tsc --init` が書く）で `"type": "module"` が無いと、`.ts` の出力は CommonJS になり、`import` / `export default` がすべて TS1295 になる。インラインの `<script type="module">` はいつも ES モジュールで、`.mts` はそれをそのまま言う |
| CDN の import | 試作の ambient の `declare module "https://*"` の supplemental は、`moduleDetection: force` で壊れる（augmentation になって TS2664、import は TS2307 のまま）。URL の module specifier ごとの ignore の directive（TS2307 を出さず、束縛は `any`）は、どの設定でも動く |
| プリアンブル | `lib` に DOM が無いと、プリアンブルの `HTMLElement` が合成テキストの位置で TS2304 になり、ブロックごとに出た。プリアンブルの仮想範囲への ignore の directive で、Volar と同じ振る舞い（プリアンブルの診断を捨てる）になる |
| `wcs-tsc` との一致 | `examples/` の 33 ページ（CI の `examples/tsconfig.wcs-tsc.json`）で、7.1.0-beta と 7.1.0-dev.20261023.1 の mapper は、5.9 の `wcs-tsc` と同じ 25 件の診断を同じ位置に出す。ブロックの間の多バイト文字も正しく戻る |
| 言語サーバー | `tsc --lsp --stdio` に `initializationOptions: { runExternalCode: true }` を渡すと、`.html` の hover・定義（正しいブロックへ）・診断を HTML の位置で返す。渡さなければ `.html` には何も返さない |
| 速さ | 33 ページで、起動込みで 7.1 が約 1.0 秒、5.9 の `wcs-tsc` が約 1.6 秒 |

## 4. 設計

### 4.1 パッケージ

mapper は、すでに `wcs-tsc` と `wcs-schema` を持つ `@wcstack/typescript` に入れる:

- `package.json`: `"typescript": { "contentMapper": { "exec": ["node", "./dist/content-mapper.cjs"] } }`。変換はコンパイラオプションを読まないので `compilerOptions` は書かず、`dynamicConfig` も無し。同一性は静的になり、`--build` はプロセスを起こさずに判断できる。
- `dist/content-mapper.cjs` は `tsc-core.cjs` と同じく作る: esbuild が `packages/vscode-wcs`（`src/contentMapperMain.ts` と `src/contentMapper/`。プラグインの正本の隣）から束ね、`scripts/build-schema-core.mjs` がコピーする。Node の組み込みだけを使うので、パッケージのランタイム依存はゼロのまま。7 の下では、実行時に `typescript` も Volar も要らない。案 B（§6）では拡張が同じファイルを同梱できる。
- プロジェクトは `{ "package": "@wcstack/typescript", "extensions": [".html"] }` と書く。オプションは `openProject` で検査し、`optionDiagnostics` で報告する（`wcs1001` は知らないオプション、`wcs1002` は値の誤り。その項目は既定値で続ける）:
  - `stateTagName`（既定 `wcs-state`）。拡張の `wcstack.stateTagName` と同じ。
  - `urlImports`: `"any"`（既定）か `"error"`。`wcs-tsc --url-imports` と同じ。
- メッセージは英語。TypeScript が渡す `locale` は使わない（`wcs-tsc` と同じ）。

### 4.2 変換

`transform` はファイルごとに返す:

1. **正規の出力**: 空の `.mts`、対応なし。
2. **`<wcs-state>` のブロックごとに supplemental の `.mts` の出力 1 つ**: Language Server モードの仮想コード — ブロックごとにプリアンブル 1 回、`@wcstack/state` の import を空白にしたユーザーコード、`defineState(…)` で包んだ `export default {…}`、`this` を読む getter ごとの `: any`（§5.3）。合成の `export {}` は足さない: `.mts` はすでにモジュールで、足した文は構文エラーのブロックの後ろに余計な誤りを生む。
3. **診断の directive**（policy は ignore）を、それぞれの supplemental の出力に: プリアンブルの仮想範囲と、`urlImports: "any"` なら `http(s)://` の module specifier の文字列リテラルすべて（`from "…"`・`import "…"`・`import("…")`。`fetch("…")` は覆わない）。

対応はすべてプラグインの `VirtualCodeBuilder` が作る。これは挿入するテキストとユーザーコードを分け、空白にした import（と、tsc モードで巻き上げた import の元の位置）を隙間のままにする。mapper はそれぞれを、既定の `features`（全部）の `Verbatim` の範囲として出す。その前に両側が等しいことを確かめ、等しくない対応はコードポイントの境界で一致する区間に分ける（安全網 — そうしないと TypeScript はページ全体を空として読む）。テストで、例のどのページでも安全網が要らないことを確かめる。

位置: TypeScript が `utf-16` を出せばそれを取る（JavaScript の文字列のオフセットで、プラグインが計算するもの）。出さなければ両側を `utf-8` に直す。

### 4.3 プラグインの再利用

仮想コードの定義はプラグイン 1 つのまま（[typescript.ja.md](./typescript.ja.md) §4: エディタが下線を引くものがそのまま CI に出る）。mapper は、Volar の言語サーバーと `runTsc` に並ぶ 3 つ目の使い手である:

- `createWcsLanguagePlugin`（Language Server モード）がブロックごとの仮想コードを出し、mapper はその枠を付け直すだけ。tsc モードと `buildCombinedScript` は、5 / 6 の `wcs-tsc` のために残る。
- 空白にした import を結ばなくしたことは Volar の両モードも変えるが、害は無い。空白にしたテキストに届くエディタの機能は無く、そこに対応付けられた Volar の編集（整形・import の整理）が利用者の import を書き換えることもなくなった。5.9 の `wcs-tsc` は、前後で `examples/` に同じ 25 件を出す。

### 4.4 失敗

パースできないブロックも対応付ける。構文エラーは TypeScript が HTML の位置で報告する。クラッシュやプロトコルの誤りは TypeScript が報告し、そのファイルを空として読む。1 つのプロジェクトで 5 回失敗すると、TypeScript はその mapper を呼ばなくなる。

- だから mapper はどの要求にも答え、要求の中の例外は JSON-RPC のエラー（-32603）にする。
- stdout には protocol のメッセージしか書かない（`console.log` は stderr へ回す）。
- 受けられない要求（知らない・閉じたプロジェクトのハンドル、`initialize` の前の `transform`）は JSON-RPC のエラー、形の違う params は -32602。
- stdin が閉じたら、stdout が流れ切るのを待って終わる。

### 4.5 プロジェクトが設定しうるオプション

mapper がプリアンブルのほかに足すもの — `defineState(`・`)`・`: any` — は、プロジェクトが設定しうるどのオプションの下でも報告されてはならない。e2e のテストは、きれいなページを次の下で動かす:

- `strict` と、より厳しい検査のすべて（`noUnusedLocals`・`noUnusedParameters`・`exactOptionalPropertyTypes`・`noUncheckedIndexedAccess`・`noImplicitReturns`・`noPropertyAccessFromIndexSignature`・`noImplicitOverride`）
- 7.1 の `tsc --init` の設定（`module: nodenext`・`verbatimModuleSyntax`・`isolatedModules`・`noUncheckedSideEffectImports`・`moduleDetection: force`）
- `"type": "module"` 付きの `nodenext`
- DOM の無い `lib`
- TypeScript 7 の既定（`strict`）

## 5. CLI

### 5.1 動かし方

```bash
npm i -D @wcstack/typescript typescript@^7.1
npx tsc --noEmit --runExternalCode        # tsconfig.json に mapper を書いて
```

`--runExternalCode` は必須で、渡すのは利用者である。`declaration: true` のプロジェクトは、ページとその supplemental の出力ごとに宣言ファイルを出してしまう。ページには `noEmit`（または別の tsconfig）を使う。型エラーの exit code は 2。

### 5.2 7 の下の `wcs-tsc`

`wcs-tsc` は、両方の世界で 1 つのコマンドのままでいる（`src/cli/wcsTscMapper.ts`）。5 / 6 では今までのまま。7.1 以降（プレリリースも）では、プロジェクトの `tsc`（その `typescript/package.json` の `bin.tsc`）を `--runExternalCode` 付きで動かす:

- **mapper の有無**: まず、設定のディレクトリから上へ `node_modules` の `@wcstack/typescript` を探す。TypeScript は mapper をそこから解決し、`tsc --showConfig` は解決できない mapper を報告しない（`.html` が黙って消える）からである。無ければ exit 2 と `npm i -D @wcstack/typescript`。走っている `wcs-tsc` と版が違えば警告。
- **mapper を名指すかどうか**: 設定の `extends` の連鎖の実効の `contentMappers` を自分で読む（TypeScript 7 にそのための API は無い。JSONC、相対とパッケージの `extends`）。
  - 連鎖が `@wcstack/typescript` を名指していれば、設定をそのまま使い、明示した `--url-imports` は効かないと報告する。
  - 名指していなければ、利用者の設定の隣に一時の設定 `.wcs-tsc.<設定のファイル名>` を書く。それは利用者の設定を `extends` し、`contentMappers` を「継承した項目 + `{ "package": "@wcstack/typescript", "extensions": [".html"] }`（`--url-imports=error` なら `options.urlImports` 付き）」にする — 自分の配列は継承した配列を置き換えるからである。
  - 継承した mapper がすでに `.html` を取っていれば exit 2 で断る。
  - 名前が固定なので、`incremental` のプロジェクトの `.tsbuildinfo` は 1 つのまま。同じ設定に同時に 2 つ走らせると、そのファイルを共有する。
- **点検**: 実効の設定を `tsc --showConfig --runExternalCode`（`-w` を除いた利用者の引数付き）で点検する。`files` に `.html` が無い・`noImplicitThis` が切られている（7 の既定は `strict`）は警告。`--wcs-defaults` なら、一時の設定に `noImplicitThis: true` を足し、解決された `include` に `**/*.html` を足す。7.1 の経路では `allowJs`・`checkJs`・`target` を点検しない: 出力は `.mts` で、7 の既定の target は新しい。
- **`-b` / `--build`**: `--runExternalCode` を付けて素通しにし（各プロジェクトの tsconfig が mapper を名指す必要がある）、警告する。`-p` とファイル名の混在は tsc 自身が断る（TS5042）。
- **後片付けと exit code**: 一時の設定は、終わるときと SIGINT / SIGTERM / SIGHUP（Windows では SIGBREAK も）で消す。exit code は tsc のもの。
- **7.0**: mapper が無いので名指しで断り、`typescript@^7.1`（または `typescript@6`）を案内する。

利用者の tsconfig は変えなくてよく、CI のスクリプトも `npx wcs-tsc` のままでよい。

### 5.3 getter（4.6.2 で出した）

`defineState<T>(def: T & ThisType<…T…>)` は T をオブジェクトリテラルから推論する。戻り値の型注釈の無い getter の型は本体から推論され、本体が `this` を読むと推論が T に戻ってくる。TypeScript はその getter を `any` にし、本体の `this` も `any` のままにする。だから `get first() { return this.items[0].nmae; }` は報告されず、`strict` では getter の中のコールバック（`this.items.filter((i) => …)`）が暗黙の `any`（TS7006）になっていた。メソッドは影響を受けない。これは TypeScript の振る舞い（5.9 も 7.1 も同じ）で、`.ts` の state ファイルについては [define-state.ja.md](../packages/state/docs/define-state.ja.md#戻り値の型が推論される-getter) に書いてある。

インラインのスクリプトは JavaScript なので、作者は注釈を書けない。4.6.2 から、プラグインは state オブジェクトの直下の getter のうち `this` を読むものの引数リストの後ろに `: any` を挟む（`src/language/getterAnnotations.ts`、acorn）。挟んだテキストには対応が無い。getter の型はもともと `any` だったので失うものは無く、本体は推論された `this` で検査される。mapper はこれを受け継ぐ。7.1 でも、getter の typo を `wcs-tsc` と同じ HTML の位置で報告する。

## 6. エディタ

拡張は TypeScript 7 を必要とせず、そのまま動く。問題は、その隣で何が起きるかである。

- **重なり。** tsconfig が mapper を名指す信頼したワークスペースでは、TypeScript 7 のサーバーも `.html` に応える（§3）。その診断と hover が拡張のものと並ぶ。診断は範囲ごとに止められない（§2）ので、1 つの tsconfig のまま「エディタでは黙り、CLI では話す」mapper にはできない。案 A を出すまでは、両方の拡張を使う人に README で `js/ts.contentMappers.enabled: false` を案内する。
- **案 A — Volar を残して身を引く（次に）。** 拡張は、TypeScript 7 の拡張が動いていて、ワークスペースの tsconfig が `.html` に `@wcstack/typescript` を名指していることを検出する。そのときは `<wcs-state>` のスクリプトへの TypeScript の機能（Volar の TypeScript サービスプラグイン）を止め、`data-wcs` のもの（検証・補完・ナビゲーション・レンズ）は残す。これらは TypeScript のサービスを使っていない。両方の拡張を入れた VS Code で手で確かめる必要があるので、別の変更にする。
- **案 B — 任せる（後で）。** 拡張は同梱の mapper（またはワークスペースの `@wcstack/typescript`）で `registerContentMappers("wcstack.wcstack-intellisense", [{ extensions: [".html"], inferredProjectContribution: { manifest } }])` を呼び、同梱の TypeScript と Volar の TypeScript プラグインを外す。拡張は `data-wcs` だけに縮む。TypeScript 7 の拡張が入っていることが前提で、それが VS Code の既定になってから正しくなる。
- **VS Code の HTML。** 組み込みの HTML 言語サーバーは、すでに `<script>` の中で JavaScript の機能を出す。案 B では、1 つの `<script>` に HTML のサーバー・TypeScript 7・拡張の 3 つが応えうる。上流の見本はファイルを `.dhtml` にしてこの問いを避けた。B を選ぶ前に測る。

## 7. `wcs-schema` は別の移植

content mapper は `wcs-schema` に触れない。`wcs-schema` は `.ts` / `.js` の state ファイルをチェッカーで読む。TypeScript 7.1 の `typescript/sync` の API には、使っているチェッカーの呼び出し（`getPropertiesOfType`・`getTypeOfSymbolAtLocation`・`isArrayType`・`isTupleType`・`getTypeArguments`・`getIndexInfosOfType`・`typeToString`・`getCallSignatures`）がある。オブジェクトは `Disposable` で、ネイティブのコンパイラと IPC で話し、API 自身が不安定だと言っている。移植は、その API の上にもう 1 つ `program.ts` / `typeToSchema.ts` を書き、入っているメジャー版で選ぶことになる。API がプレビューを出てから計画する。それまで `wcs-schema` と `loadStateFile` は 7 を名指しで断る。

## 8. 決定

2026-10-24 に推奨どおりに決めた。実装の前に計画を独立にレビューし、その指摘は §3〜§5 に入れてある。

1. **いつ。** いまブランチで、7.1.0-beta に対して作った（nightly でも確かめた）。7.1 の stable の後に — devDependency の `typescript-7` を stable に上げて — マージし、1 つの minor の間は experimental として出す。
2. **peer の範囲**: `typescript: ">=5.0 <7 || >=7.1"`。`wcs-tsc` は要る版（5 / 6、または 7.1 以降）を確かめる。`wcs-schema` は §7 まで 5 / 6 のまま。
3. **CLI の形**: 両方 — 続けて使えるように `wcs-tsc` が自分で `tsc --runExternalCode` を動かし（§5.2）、素の `tsc` の呼び方を文書に書く。
4. **エディタ**: この作業では変えず、重なりを文書に書く。次に案 A を別の変更で、TypeScript 7 の拡張が VS Code の既定になったら案 B（§6）。
5. **オプション**: `stateTagName`（既定 `wcs-state`）と `urlImports`（既定 `any`）。診断の出所は `wcs`。出力は `.mts`（§3）。

## 9. テスト

- **単体**（vscode-wcs、`__tests__/contentMapper.test.ts`）:
  - 変換の出力（ブロック無し・1 つ・複数、`stateTagName`、`urlImports`、directive）。
  - `Verbatim` の範囲が `utf-16` でも `utf-8` でも元のテキストと一致すること。サロゲートペアを含むページと、例のすべてのページで確かめ、安全網が一度も使われないこと。
  - URL の specifier の拾い方、オプション。
  - プロトコル（initialize → openProject → transform → closeProject、1 つのプロセスに 2 つのハンドル、閉じたハンドルの開き直し、知らないハンドル、壊れた JSON と要求、通知、要求の中の例外）。
  - 枠（分かれたチャンクと 1 つにまとまったチャンク、多バイトの本文、余分なヘッダー）。
  - `__tests__/plugin.test.ts` は、プラグインの両モードが同じテキストだけを対応付けることを確かめる。
- **CLI**（packages/typescript、`__tests__/wcsTscMapper.test.ts`・`tsconfigChain.test.ts`）: §5.2 の全分岐を、tsc を差し替えて。
- **端から端まで**（packages/typescript、`__tests__/contentMapper.e2e.test.ts`。ゲート。devDependency の `typescript-7` に対して）:
  - HTML の位置での診断、ブロック・ページの間で衝突しないこと。
  - `urlImports: "error"`、tsconfig の位置でのオプションの診断、フラグが無いときの TS18068、§4.5 のオプションの組み合わせ。
  - ビルドした `wcs-tsc` を 7.1 で、ビルドした `content-mapper.cjs` を標準入出力で。
- **一致と言語サーバー**（CI の `wcs-validate` job。7.1 が stable になるまで非ゲート。`packages/typescript/scripts/content-mapper-parity.mjs`）:
  - 7.1 の `tsc --runExternalCode` を `examples/` にかけた結果が、5.9 の `wcs-tsc` とちょうど同じになること。
  - `tsc --lsp --stdio` が、`runExternalCode` 付きでページの hover と診断に答え、付けなければ何も返さないこと。
  - `WCS_TS7_TSC` で別のビルドに対して動かせる。
- **エディタ**: 案 A の検出を、作るときに手で。

## 10. 参照

- [Announcing TypeScript 7.1 Beta](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/)
- [microsoft/typescript-go#4712 — Content mappers](https://github.com/microsoft/typescript-go/pull/4712)（プロトコル、範囲の対応、LSP での起動、出力、インクリメンタル）
- [microsoft/TypeScript#63936 — Content mappers round 2](https://github.com/microsoft/TypeScript/pull/63936)（`protocolVersion` の削除、診断のコードの必須化）。wire の型は `tsc/internal/contentmapper/hostimpl.go`、範囲の検査は `tsc/internal/spanmap/spanmap.go`
- [microsoft/TypeScript#63800 — API usage patterns for complex editor extensions](https://github.com/microsoft/TypeScript/issues/63800)
- [DanielRosenwasser/content-mapper-sample](https://github.com/DanielRosenwasser/content-mapper-sample)（`<script>` とイベントハンドラ属性を扱う HTML の mapper）
- [typescript.ja.md](./typescript.ja.md) §4 — `wcs-tsc` と言語プラグイン
- [typescript-binding-check.ja.md](./typescript-binding-check.ja.md) — mapper を通して `data-wcs` の結び付けを検査する（検討と試作）
