# 実装計画: 配布・CI 構造強化 — 合成バンドル / 同期完全性ガード / 鮮度ゲート

- **状態**: 起草(2026-08-29)→ 同日、3 視点アドバーサリアルレビュー(CI/リリース統合・バンドルビルド成立性・網羅性)の指摘を反映 → **同日、全決定確定(D2 = 案 A、4-12(e) = Rules 表据え置き+本番節で回収)・実装着手**。なお rollup 合成方式(D4)はレビュー時に実際に 5 パッケージを合成して成立を実証済み(219,403 B の有効な単一 ESM、TLA 込み、空バンドル化なし)。
- **経緯**: 外部レビューの指摘 3 点(①合成バンドル不在 ②copy-distribution の登録漏れ漂流 ③vscode-wcs / lint が変更検知マトリクス外)への対処。①はレベル 2(単一リクエスト化の実体まで)、②③は全部実施、が採択済みの方針。
- **重要な前提修正**: 調査の結果、①の当初案「jsDelivr `/combine/` の公式レシピ化」は**実測で不成立**(§1.4)。①-1 は「combine 禁止の規範明文化」に反転し、単一リクエスト化の実体は①-2(`wcstack` 実体化)が単独で担う。
- **行番号の引用**: main `aee8b9be` 時点。
- **進め方**: Phase ごとに 1 ブランチ 1 PR(ブランチは `--no-track` で作成、コミットは `git commit -F`)。DoD は各 Phase 共通で: 対象パッケージの `npm run lint` / `npm run build` / `npm test` green、coverage 100/97/100/100 基準、リポジトリ横断の sync `--check` 全 green。**作業中に他パッケージの dist をビルドしたら戻してからコミットする**。
- 受け入れ条件は §7 のマトリクス(G/F/C/B 系 ID)を正とし、各タスクに ID を付す。

## 0. 決定レコード

| # | 論点 | 決定 |
|---|---|---|
| D1 | jsDelivr `/combine/` | **不採用、規範として禁止を明文化**。根拠: (a) 公式が SRI 使用を明示的に禁止(「Only use SRI with full single-file links, and static versions」)、(b) terser 済み ESM の連結はトップレベル識別子が衝突し構文エラー — ローカル連結・公開済み 1.30.0 のリモート combine 出力の両方で `SyntaxError: Identifier 't' has already been declared` を実測(§1.4)、(c) 1 ファイル欠損で全体 404(1 日エッジキャッシュ)、(d) URL path 実効上限 ≈8KB。 |
| D2 | バンドルのプロファイル(内容物) | **確定(2026-08-29 ユーザー採択): 案 A = state + router + fetch + storage + autoloader**(SPA コア 5 つ、実測 216KB min / 60KB gzip)。全部入り(44 パッケージ)は「使う分だけ払う」哲学と衝突し不採用。エントリは `wcstack/auto` の 1 本で開始し、`./spa` 等の追加プロファイルは需要が出るまで作らない。 |
| D3 | バンドルの器 | **既存 `wcstack` エントリパッケージを実体化**(新設 `@wcstack/bundle` ではなく)。npm 名を所有済み・trusted publisher 登録済み([scripts/npm-trust-setup.mjs:74](../scripts/npm-trust-setup.mjs))・publish ループに既に乗っている(初回手動 publish 不要)。URL も `cdn.jsdelivr.net/npm/wcstack@X/dist/auto.min.js` と一等になる。 |
| D4 | バンドル生成方式 | rollup + `@rollup/plugin-node-resolve` で各メンバーの **published `/auto` エントリ(dist/auto.min.js)をインライン**。識別子リネームは rollup が保証し、combine の失敗モード(素の連結)を機械的に回避する。メンバーの src には触れない=パッケージ独立性を維持。 |
| D5 | バンドルのエントリ構成 | **`./auto` のみ**。`dist/index.esm.js` / `index.d.ts` は作らない。理由: (a) named re-export の名前衝突問題を回避、(b) [scripts/conformance-bindable-inputs.mjs:97-100](../scripts/conformance-bindable-inputs.mjs) の discovery が `dist/index.esm.js` の存在プローブなので、作らなければ自動的に対象外。 |
| D6 | バンドルの SRI | [scripts/generate-sri.mjs](../scripts/generate-sri.mjs) の discovery(L55 の `@wcstack/` scope フィルタ)を `wcstack` 込みに拡張。単一ファイル×version pin なので SRI 完全適合 — README の「1 ハッシュで実行コード全カバー」の主張が**アプリ単位でも真になる**(これが combine に対する決定的優位)。 |
| D7 | リリースビルド順 | wcstack を**両パス(Build all / Rebuild after version bump)で最後に強制**。現行プロファイル(案 A / 案 B)ではメンバー全員が `sort` 順で wcstack より**前**に並ぶため、素通しでも今日は壊れない(§1.6)。ただし `wi*`〜`z*` 名のメンバー(例: websocket / worker をプロファイルへ追加)を足した瞬間、`sort` は**警告なく** bump 前 VERSION の stale dist 埋め込みへ転落する。末尾固定はその恒久保険。実装は discovery で「メンバー sorted → wcstack を末尾に追加」。 |
| D8 | builtinTags カタログ | [packages/vscode-wcs/scripts/emit-builtin-tags.mjs](../packages/vscode-wcs/scripts/emit-builtin-tags.mjs) の `SKIP` に `"wcstack"` を追加。追加しないと、dist を初コミットした**当の PR** で `--check`(ci.yml:83、毎 PR 実行)が即 fail する — 全メンバータグを再捕捉して catalog の `package:` を上書きするか、最小 DOM シム下で state の TLA ブートが失敗して exit 1。**dist の初回コミットと同一 PR 必須**。 |
| D9 | wcstack の config / README banner | [scripts/sync-package-configs.mjs](../scripts/sync-package-configs.mjs) / [scripts/sync-readme-agents-banner.mjs](../scripts/sync-readme-agents-banner.mjs) は `@wcstack/` scope discovery なので wcstack は**自動的に対象外のまま**(編集不要)。rollup / eslint config は手書き(AUTO-GENERATED banner を付けない — Phase 1 の orphan ガードと衝突させない)。README は「Do not install / documentation only」前提を改稿(§5 の 4-12)。 |
| D10 | 完全性ガードの設計 | 2 方向: (a) **正典ディレクトリ列挙ガード** — `protocol/` / `io-core/` / `config-templates/` を readdir し、各 sync スクリプトの登録済み集合に無いファイルがあれば fail(write / `--check` 両モード)。(b) **orphan banner スキャン** — 各 sync スクリプトが自分の banner(`Generated from /<dir>/<file>`)を **`packages/*/` 全域**から自己スキャンし、自分の生成対象 (pkg, dest) 集合に無いコピーを fail。除外は `dist` / `.tsc-out` / `node_modules` / `coverage` の 4 ディレクトリのみ(dist には banner が残存するため除外必須。範囲を `src/` 等へ狭めると `examples/` / `scripts/` への手コピーが漏れる)。現状ツリーの実測では banner 保有ファイル(protocol 127 / io-core 35 / config-templates 83)が全件正規 dest と一致=偽陽性ゼロで導入できる。banner の無い手書き複製は検出不能(§8 に明記)。 |
| D11 | wcs-validate 鮮度ゲート | ジョブ先頭(setup-node 直後・vscode-wcs `npm ci` 前)で `packages/state` を `npm ci && npm run build`。**無条件・毎 PR**(条件分岐は穴の再発源)。`node_modules/@wcstack/state` は symlink([packages/vscode-wcs/package-lock.json:1142-1145](../packages/vscode-wcs/package-lock.json) `"link": true`)なので後段が自動で新鮮 dist を見る。lint も vscode-wcs のビルドを再実行するだけ([packages/lint/scripts/build.mjs:25-39](../packages/lint/scripts/build.mjs))なので追加手当不要。 |
| D12 | メンバー変更 PR でのバンドル再検証 | **回さない**。PR 時点のバンドルはコミット済みメンバー dist を埋め込んでおり、それが PR 時点の正。鮮度が問題になるのはリリース時のみで、それは D7 が担保する。 |

## 1. 出発点の実測(現状の事実)

### 1.1 指摘① 「合成バンドルが無い」 — 真。ただし「HTTP ウォーターフォール」は不成立

各 `dist/auto.min.js` は静的 import ゼロの自己完結バンドル([docs/sri.md](./sri.md) §6 不変条件 1、[config-templates/rollup.config.js:35-37](../config-templates/rollup.config.js))。`<script type="module">` タグを N 個並べても HTML パース時に N リクエストが**並列**発行されるだけで直列連鎖はない。実在するコストは: リクエスト数、SRI `integrity` 属性 N 個の管理、`esm.run` 経由のリダイレクト 1 段。`wcstack` パッケージは `files: ["README.md"]`([packages/wcstack/package.json:29-31](../packages/wcstack/package.json))で実体なし — ここは指摘どおり。

### 1.2 指摘② 「同期スクリプトの登録漏れ漂流」 — 真

正典(コピー元)ファイル集合を**ハードコード列挙**し、正典ディレクトリの完全性ガードを持たない sync スクリプトが 3 本ある。なおパッケージ側の discovery は sync-package-configs / sync-readme-agents-banner とも readdir 自動(scope フィルタ)で、ハードコードなのは**ファイル集合**の方(protocol-types / io-core は対象パッケージ配列もハードコード):

- [scripts/sync-protocol-types.mjs:25-31](../scripts/sync-protocol-types.mjs) — 正典 7 ファイルを `canonical*Path` 定数で列挙。`protocol/` に 8 個目を置いても `--check` は緑のまま。
- [scripts/sync-io-core.mjs:29-32](../scripts/sync-io-core.mjs) — `DEST_NAME` 2 キー。同上。
- [scripts/sync-package-configs.mjs:69](../scripts/sync-package-configs.mjs) — 対象ファイルは `Object.keys(DEVIATIONS)` 由来で、`config-templates/` を**ディレクトリとして読まない**。新テンプレートは黙って未同期。
- 現時点では `protocol/`(7)+ `io-core/`(2)+ `config-templates/`(2)の全ファイルがたまたま登録済み=偽陽性ゼロでガードを入れられる好機。
- [scripts/sync-readme-agents-banner.mjs](../scripts/sync-readme-agents-banner.mjs) は正典がインライン定数で discovery も完全(README 欠落は fail 済み)— ガード対象外。

### 1.3 指摘③ 「vscode-wcs / lint がマトリクス外」 — 半分は解消済み。本質穴は stale dist

`wcs-validate` ジョブ([.github/workflows/ci.yml:104-147](../.github/workflows/ci.yml))は**条件なしで全 PR 実行**され、vscode-wcs の build+test、lint の build+test(#183 型の穴を塞ぐスモーク、L128-140 のコメント参照)を回している。「state 変更では回らない」は現状では偽。

残る本質穴: vscode-wcs は `"@wcstack/state": "file:../state"` で state の**コミット済み dist**(`@wcstack/state/parser` / `manifest` → `dist/parser.esm.js` / `manifest.esm.js`)を消費し、esbuild が cli.cjs にインライン化する([packages/vscode-wcs/esbuild.config.js:28-29](../packages/vscode-wcs/esbuild.config.js))。コミット済み dist はリリース間で src に遅行するため、**state の src 変更が parser/manifest 契約を壊しても PR CI は緑のまま**で、破綻はリリースの「Build all packages」で初めて顕在化する — #183 と同一の時点。

### 1.4 `/combine/` の実測(D1 の根拠)

- 公式規範(https://www.jsdelivr.com/using-sri-with-dynamic-files): 「Combining the exact same source code multiple times might not result in the exact same generated code.」「Only use SRI with full single-file links, and static versions.」combine 出力の先頭コメント自体に「Do NOT use SRI with dynamically generated files!」が埋め込まれる。
- **構文レベルで不成立**: terser 済み ESM はトップレベル識別子(`t`, `e`, …)をモジュールスコープ前提で短縮する。combine の連結(裸の `;` 区切り、ラップなし)では 2 ファイルが 1 モジュールスコープを共有し衝突する。実測(2026-08-29): (a) ローカルで `packages/state/dist/auto.min.js` + `packages/router/dist/auto.min.js` を combine と同形式で連結 → `node --check` で `SyntaxError: Identifier 't' has already been declared`。(b) 公開済み `https://cdn.jsdelivr.net/combine/npm/@wcstack/state@1.30.0/dist/auto.min.js,npm/@wcstack/router@1.30.0/dist/auto.min.js` の実レスポンス → 同一エラー。`+esm` 同士の combine も同様に実測で構文エラー。
- その他: 1 ファイル 404 で全体 404(`Cache-Control: max-age=86400` で 1 日キャッシュ)、MIME 混在で 400、URL path ≈8192 バイトで 414。

### 1.5 二重ロードの実測(D4 の根拠 — バンドル+個別 auto の併載安全性)

候補 5 パッケージの全 `customElements.define` は `registry.get(...)` ガード済みで、2 回目の評価は no-op:

- state: [packages/state/src/registerComponents.ts:10-17](../packages/state/src/registerComponents.ts)、router: 7 タグ全部([packages/router/src/registerComponents.ts:15-38](../packages/router/src/registerComponents.ts))、fetch: 4 タグ、storage / autoloader: 各 1 タグ+autoloader は await 前後の二重ガード([packages/autoloader/src/eagerload.ts:85-104](../packages/autoloader/src/eagerload.ts))。
- グローバル登録(binder / ssr-snapshot / view-transition naming)はすべて `Symbol.for` 上で「先勝ち・後客は譲る」ガード済み([packages/state/src/bindings/binder.ts:121-125](../packages/state/src/bindings/binder.ts) — コメントが「1 ページに 2 つの state バンドル」をまさに想定)。import 時副作用のイベントリスナは 5 パッケージともゼロ。
- 系統的注意(ドキュメント化対象): 併載時は**先に評価された側がページを所有**する。後から読んだ個別パッケージの `bootstrapState({...})` 等は不活性インスタンスに作用し効かない([packages/state/src/bootstrapState.ts:15-16](../packages/state/src/bootstrapState.ts) に明記済み)。

### 1.6 サイズ実測(D2 の材料)と build 順の構造(D7 の根拠)

| ファイル | min | gzip |
|---|---|---|
| state/dist/auto.min.js | 155,792 B | 44,889 B |
| router/dist/auto.min.js | 31,151 B | 9,002 B |
| fetch/dist/auto.min.js | 19,271 B | 5,641 B |
| storage/dist/auto.min.js | 7,460 B | 2,388 B |
| autoloader/dist/auto.min.js | 7,874 B | 2,915 B |
| **案 A 合成(連結近似)** | **221,552 B** | **61,892 B** |

計測: UTF-8 バイト数+ .NET GZipStream(Optimal)。gzip 実装・レベルにより ±1% 程度変動する。rollup + terser での実合成(レビュー時の検証ビルド)は **219,403 B** で、連結近似はやや保守的。

release.yml の discovery は `sort` 素通し([release.yml:75](../.github/workflows/release.yml))。ソート位置は `autoloader < fetch < router < state < storage < wakelock < wcstack < websocket < worker` — 現行プロファイル案のメンバーは全て wcstack より**前**に並ぶため今日は素通しでも壊れないが、それは偶然の産物であり、wcstack より後ろに並ぶ名前のパッケージをプロファイルへ足した瞬間、Rebuild パスで bump 前 VERSION の stale dist を埋め込む事故が**警告なく**発生する構造になっている(D7 の末尾固定はこの保険)。

## 2. Phase 1 — 同期スクリプト完全性ガード(指摘②)

**ブランチ**: `improve/sync-completeness-guards`。**作業ディレクトリ**: `scripts/` のみ(CI 変更ゼロ — 既存 `protocol-types-sync` ジョブの `--check` がそのまま拾う)。

| タスク | 内容 | 受け入れ |
|---|---|---|
| 1-1 | `sync-protocol-types.mjs`: `protocol/` を readdir し、登録済み正典集合(7 ファイル)に無いファイルがあれば両モードで exit 1。エラーメッセージは「`canonical*Path` 定数+対象パッケージ配列に登録するか、ファイルを移動せよ」と指示。 | G1, G5, G6 |
| 1-2 | `sync-io-core.mjs`: `io-core/` vs `Object.keys(DEST_NAME)` で同上。 | G2, G5, G6 |
| 1-3 | `sync-package-configs.mjs`: `config-templates/` vs `Object.keys(DEVIATIONS)` で同上。 | G3, G5, G6 |
| 1-4 | orphan banner スキャン: 3 スクリプト各自が自分の banner 形(`Generated from /protocol/...` 等)を **`packages/*/` 全域**からスキャンし、自分の生成対象 (pkg, dest) に無いコピーを fail。除外は `dist` / `.tsc-out` / `node_modules` / `coverage` の 4 ディレクトリのみ(範囲を `src/` 等へ狭めると `examples/` / `scripts/` への手コピーが漏れる — D10 と同一仕様)。 | G4, G5 |

検証手順: 一時的に `protocol/zzz-probe.ts` 等の未登録ファイルを置いて `--check` が fail することを確認し、確認後に削除する。**この環境はファイル削除が denied になった前例がある** — denied の場合は scratchpad にリポジトリの部分コピーを作って検証する(リポジトリ内に消せないプローブを残さない)。

## 3. Phase 2 — wcs-validate 鮮度ゲート(指摘③)

**ブランチ**: `improve/wcs-validate-fresh-state`。**変更ファイル**: `.github/workflows/ci.yml` のみ(2-0 でドリフトが見つかった場合、その解消は**先行 PR** に分離し、本 PR を ci.yml のみに保つ)。

| タスク | 内容 | 受け入れ |
|---|---|---|
| 2-0 | **前提: ベースライン実証**。main HEAD でローカル一巡: `packages/state` で `npm ci && npm run build` → `packages/vscode-wcs` で `npm test` → `packages/lint` で `npm run build && npm test`。state の src はコミット済み dist より約 10 コミット先行し、破壊的変更(`config.locale` 既定の `<html lang>` 化等)を含む — 鮮度ゲート初回投入で赤くなる既存ドリフトがあれば**先行 PR で解消**してから ci.yml を触る。確認後、state の dist は戻す。 | F5 |
| 2-1 | `wcs-validate` の setup-node(L118)直後・vscode-wcs `npm ci`(L119)前に新ステップ: `working-directory: packages/state` で `npm ci` → `npm run build`。無条件・毎 PR(D11)。 | F1, F2 |
| 2-2 | `cache-dependency-path` を複数行化(`packages/vscode-wcs/package-lock.json` + `packages/state/package-lock.json`)。 | F4 |
| 2-3 | ジョブのコメントブロック(L104-110, L128-134)を「コミット済み dist ではなく src からの新鮮 dist に対してゲートする」前提へ書き換え。#183 の残り半分を塞ぐ旨を明記。 | F1 |
| 2-4 | ローカル検証: `packages/state` の src(例: filterMeta 相当)に一時変更 → `npm run build` → `packages/vscode-wcs` の `npm test`(filterMeta パリティテスト)が変化を検出することを確認 → 変更と dist を戻す(symlink 経路の実証)。 | F3 |

コスト見積り: state は devDeps 17 個 / lock 約 260 エントリ+ `rimraf && tsc && rollup -c && node scripts/emit-manifest.mjs`([packages/state/package.json:30](../packages/state/package.json))で、ジョブ +1〜2 分。

## 4. Phase 3 — `/combine/` 禁止の規範文書化(指摘①-1・反転後)

**ブランチ**: `docs/sri-combine-prohibition`。Phase 4 と独立に先行できる。

| タスク | 内容 | 受け入れ |
|---|---|---|
| 3-1 | [docs/sri.md](./sri.md) §3(esm.run では SRI は成立しない)の直後に小節「jsDelivr `/combine/` も不成立」を追加(**既存の節番号は変えない** — §3 配下の subsection とする)。内容: §1.4 の実測根拠(**実測日付 2026-08-29+エラー全文を正**とし、再現 URL は例示に留める — combine 出力はビルダー更新で変わり得ると公式自身が留保している)、公式の SRI 禁止引用、all-or-nothing 404、規範語で MUST NOT。正しい形=「pin した単一ファイル URL × 複数 `<script integrity>` タグ(並列ロード)」を明記。 | C1, C2 |
| 3-2 | [docs/sri.ja.md](./sri.ja.md) に対訳を同時追加(リンクは言語内で閉じる — docs/README.md ルール 1)。 | C1 |
| 3-3 | (任意)`generate-sri.mjs` の notes 出力に複数パッケージ利用時の 2 タグ例スニペットを追加。 | C3 |

## 5. Phase 4 — `wcstack` 実体化=合成バンドル(指摘①-2)

**ブランチ**: `feature/wcstack-bundle`。**前提**: D2 確定。**作業ディレクトリ**: `packages/wcstack/`、`.github/workflows/`、`scripts/generate-sri.mjs`、`packages/vscode-wcs/scripts/emit-builtin-tags.mjs`、docs。

### タスク

| タスク | 内容 | 受け入れ |
|---|---|---|
| 4-1 | 骨格: `src/auto.ts` = メンバー `/auto` の side-effect import のみ(例: `import "@wcstack/state/auto";` ×5)。ambient 型宣言は**不要** — 型なし subpath への side-effect import は `moduleResolution: "bundler"` の tsc を素通りする(実測済み。エラーになるのは named import 時の TS7016 のみ)。裏返しに subpath の **typo も tsc は検出しない**ため、誤記の唯一のゲートは 4-5 の B2 スモーク。 | B1 |
| 4-2 | `rollup.config.js`(手書き・banner なし — D9): 単一エントリ `src/auto.ts` → `dist/auto.min.js`。plugins = `@rollup/plugin-node-resolve`(exports map で `/auto` を解決)+ `@rollup/plugin-typescript` + `terser`。external なし。sourcemap は true のままだが、メンバー min 済みコードを指す劣化 map になる旨をコメントで明記。 | B1 |
| 4-3 | `package.json` 改修: **`"type": "module"` 追加**(現行に無い — TLA 入り ESM dist を Node から import する経路が CJS 解釈になる。リポジトリ規約「ESM only」とも整合)、`files: ["README.md", "dist"]`、`exports: { "./auto": "./dist/auto.min.js" }` のみ(D5 — `.` エントリなし、`main`/`module`/`types` なし)。scripts に `clean` / `build` / `lint` / `test` / `test:coverage`(CI・release の必須セット。`test:coverage` は release で `--if-present` でない点に注意)。devDeps = `file:../{state,router,fetch,storage,autoloader}` + rollup/vitest/eslint ツールチェーン。`package-lock.json` 生成・コミット — **Windows 生成 lock の罠(PR#57 前例)**: `@rollup/rollup-linux-*` / `@esbuild/linux-*` の optional エントリが含まれることをコミット前に確認。description / keywords 更新。 | B1, B4, B14 |
| 4-4 | `eslint.config.js` / `tsconfig.json` / `vitest.config.ts` / `__tests__/setup.ts`: 他パッケージ準拠の手書き(sync-package-configs は scope 外 — D9)。 | B4, B11 |
| 4-5 | スモークテスト: (a) `src/auto.ts` import 後に期待タグ全定義(`wcs-state`, `wcs-ssr`, router 7 タグ, fetch 4 タグ, `wcs-storage`, `wcs-autoloader` を `customElements.get` で確認)、(b) 併載実証 — `src/auto.ts` と**ビルド済み `dist/auto.min.js` を別モジュールインスタンスとして両方 import** し、throw せず定義が先勝ちのまま(`customElements.get('wcs-state')` の同一性維持)であること。**同一 specifier の再 import は ESM キャッシュで再評価されず検証にならない**点に注意(レビューで 2 回指摘された罠)、(c) state / router の top-level await 完了待ち(`await import(...)`)。coverage 対象は `src/auto.ts` のみだが import 文だけのため **v8 coverage は計測対象 0 の空集合通過**=閾値はゲートとして空。実効ゲートは B2/B3 である旨をテストコメントに明記。 | B2, B3, B4 |
| 4-6 | `dist/` 初回ビルド&コミット(全パッケージが dist をコミットする慣行に一致。以降は release.yml が更新)。 | B1 |
| 4-7 | `emit-builtin-tags.mjs` の `SKIP` に `"wcstack"` 追加 — **4-6 と同一 PR 必須**(D8)。 | B7 |
| 4-8 | [ci.yml detect-changes](../.github/workflows/ci.yml) の case に `wcstack)` ブランチを追加(パターンはリテラルなので安全)。L22-24 の「excludes non-published ones」コメントを更新。 | B5 |
| 4-9 | [release.yml](../.github/workflows/release.yml): `collect()` を「メンバー sorted → `wcstack` を末尾に追加」へ変更し `include_entry` フラグを廃止(list == publish_list)。L45-57 / L62-65 の docs-only 前提コメントを全面書き換え、**末尾不変条件(D7)の理由**(バンドルはメンバーの bump 後 dist を埋め込む必要がある)をコメント化。Commit release artifacts(L198-203)は list 参加で自動カバー(編集不要を確認)。publish ループは名前+版で冪等のため無変更。さらに **Rebuild 後・Commit artifacts 前に `packages/wcstack` の `npm test` を再実行するステップを追加** — bump 後バンドルは conformance-bindable-inputs(D5)からも emit-builtin-tags(D8)からも設計的に除外されるため、これが publish 前の唯一の実行ゲートになる。 | B6, B13 |
| 4-10 | `generate-sri.mjs` L55 のフィルタを `name.startsWith("@wcstack/") \|\| name === "wcstack"` へ。あわせて L42-45 の「Same discovery rule as release.yml」コメントを 4-9 後の実態(メンバー sorted + wcstack 末尾)へ書き換える。 | B9 |
| 4-11 | conformance 系の確認: `conformance-bindable-inputs.mjs` は `dist/index.esm.js` プローブなので D5 により対象外(ローカル実行で確認)。`conformance-io-nodes.mjs` は**レビューで確定済み・対応不要** — discovery はハードコード許可リスト `IO_NODES`([scripts/conformance-io-nodes.mjs:29-36](../scripts/conformance-io-nodes.mjs))で `src/core` / `src/components` のソースを読み(dist ではない)、かつどのワークフローからも呼ばれていない。 | B8 |
| 4-12 | docs 追随: (a) sri.md / sri.ja.md の Phase 3 節に「アプリ単位でも 1 タグ 1 ハッシュ」としてバンドルを追記、(b) ルート README.md / README.ja.md の本番(SRI)節にバンドル 1 文、(c) `packages/wcstack/README.md` 改稿 — 冒頭の「Do not install this package / documentation only」を撤去し、バンドルの使い方(タグ 1 本+integrity、含有パッケージ、個別 auto との併載規範=先勝ち)+実測サイズを追加。**`npm view wcstack readme` のオーサリングガイド機能は本文維持**。(d) CLAUDE.md の Other packages 節へ wcstack エントリパッケージの項を**追加**(現行は server と vscode-wcs の 2 項のみで wcstack の行は無い)。(e) ルート README の Rules 表 Rule 1「Single CDN import」(README.md:23 / README.ja.md:21)は外部指摘の発端 — バンドルにより「アプリ単位でも 1 タグ」が真になるため、本番(SRI)節でその旨を明示する。Rule 1 行そのものの扱いは**確定(2026-08-29 ユーザー採択): 表は据え置き、本番節+wcstack README で回収**。パッケージ個数の記載 8 箇所は不変(wcstack は 45 に計上済み)— 1 行確認のみ。 | B10, B12 |
| 4-13 | examples は増やさない(既存デモは esm.run 個別のまま)。e2e.yml の stale-dist ループにも足さない(examples がバンドルを使い始めたら — §8)。 | — |

### 既知の落とし穴(実装時チェックリスト)

- subpath の typo は tsc では検出されない(型なし side-effect import は素通り — 4-1)。誤記の唯一のゲートは B2 スモーク。
- vitest(happy-dom)で state / router のブートが走る — 他パッケージのテストで実績のある環境だが、TLA を含むので `await import(...)` でテストする。
- 併載テストは**別モジュールインスタンス**でしか成立しない(同一 specifier の再 import は ESM キャッシュで no-op — 4-5(b))。
- Windows 生成の `package-lock.json` に Linux 向け optional deps(`@rollup/rollup-linux-*` / `@esbuild/linux-*`)が欠けると ubuntu の CI / release が全滅する(PR#57 の前例)。コミット前に lock を確認(B14)。
- 現行プロファイルは素通し `sort` でも壊れないが、それは偶然(メンバー名が全て `wcstack` より前)。4-9 の末尾固定を必ず入れ、レビューで順序を確認(D7)。
- wcstack は sync 系スクリプトに入らない/入れない(D9): package-configs / readme-banner は `@wcstack/` scope discovery で自動除外、protocol-types / io-core はハードコード配列(登録しない)。

## 6. リリース時の追随(実装後・ユーザー操作を含む)

- **wcstack-skill references**: バンドル読み込みガイダンス(複数パッケージ時の推奨手順)を追加。CDN 読み込み手順の変更なのでスキル追随が必要。
- **リリースノート**: (a) `/combine/` 禁止規範の新設、(b) `wcstack` バンドル新設(旧「documentation only」からの変更)、(c) 既存の未リリース群(i18n の minor bump 等)と同乗。
- npm 初回 publish 不要(`wcstack` は 1.31.0 まで公開済み・trusted publisher 登録済み)。

## 7. 受け入れマトリクス

| ID | 条件 |
|---|---|
| G1 | `protocol/` に未登録 `.ts` を置くと `sync-protocol-types.mjs` が write / `--check` 両モードで fail |
| G2 | `io-core/` に未登録ファイルを置くと `sync-io-core.mjs` が両モードで fail |
| G3 | `config-templates/` に未登録ファイルを置くと `sync-package-configs.mjs` が両モードで fail |
| G4 | sync スクリプトの banner を持つ孤児コピー(未登録パッケージへの手コピー)が fail |
| G5 | 既存リポジトリ状態で全 `--check` green(偽陽性ゼロ) |
| G6 | エラーメッセージが登録手順(どの定数・どの配列に足すか)を指示する |
| F1 | wcs-validate のログで state の build が vscode-wcs の build に先行する |
| F2 | 通常 PR で wcs-validate green(偽陽性なし) |
| F3 | ローカルで state src の一時変更が vscode-wcs テストに観測される(symlink 経路の実証) |
| F4 | `cache-dependency-path` が両 lockfile を含む |
| F5 | 2-0 のベースライン一巡が main HEAD で green(またはドリフトを先行 PR で解消済み) |
| C1 | sri.md / sri.ja.md 両方に combine 節が入りリンクが言語内で閉じる |
| C2 | 規範語(MUST NOT)+実測根拠(再現 URL・エラー全文)+公式引用を含む |
| C3 | (3-3 採用時)sri-notes 生成が複数タグ例を含む |
| B1 | `npm run build` が `dist/auto.min.js`(+map)のみ生成し `index.esm.js` を生成しない |
| B2 | バンドル import 後、期待タグ全定義(スモークテスト) |
| B3 | `src/auto.ts` とビルド済み `dist/auto.min.js` の **2 モジュールインスタンス評価**で throw せず、定義が先勝ちのまま維持される(`customElements.get` の同一性) |
| B4 | lint / build / test green、coverage 閾値通過(`src/auto.ts` は計測対象 0 の空集合通過 — 実効ゲートは B2/B3 である旨をテストコメントに明記) |
| B5 | `packages/wcstack/` 変更で detect-changes が matrix に載せる |
| B6 | `collect()` の出力で wcstack が末尾(Build / Rebuild 両パス) |
| B7 | `emit-builtin-tags.mjs --check` green(SKIP 登録済み) |
| B8 | `conformance-bindable-inputs.mjs` のローカル実行で wcstack が対象外(io-nodes 側は許可リスト方式・非 CI につき対応不要を確認済み) |
| B9 | `generate-sri.mjs` のローカル実行で wcstack 行が出る |
| B10 | sri.md / sri.ja.md / README ×2 / wcstack README / CLAUDE.md 追随完了 |
| B11 | 全 sync `--check` green(wcstack が誤って対象化されない) |
| B12 | wcstack README に実測サイズ(min / gzip)明記 |
| B13 | release.yml の Rebuild 後に wcstack の `npm test` 再実行ステップが入り、bump 後バンドルが publish 前に実行ゲートを通る |
| B14 | `packages/wcstack/package-lock.json` に Linux 向け optional deps エントリ(`@rollup/rollup-linux-*` / `@esbuild/linux-*`)が含まれる |

## 8. 明記して見送るもの

- **camera の stale-dist 穴**: `packages/camera` も `file:../state` を持ち PoC テスト 1 本が state dist を消費する。PR 時は committed dist に対して走るが、リリースの「Test all packages」は Build all の後なので新鮮 dist で捕捉される。vscode-wcs と違い契約消費が薄いため Phase 2 の対象外とする(将来壊れたらリリースが publish 前に止まる)。
- **メンバー変更 PR での wcstack バンドル再ビルド**: D12 のとおり不要。
- **e2e.yml のバンドル対応**: examples がバンドルを使い始めるまで不要([e2e.yml:52-55](../.github/workflows/e2e.yml) の scope フィルタはそのまま)。
- **banner の無い手書き複製の検出**: 原理的に不能。copy-distribution の新設時は banner を付ける、が運用規範(Phase 1 のガードがその banner を守る)。
- **追加プロファイル(`./spa` 等)**: 需要が出るまで作らない(D2)。
