# 実装計画: アプリ作者向けテスト支援と TypeScript の出口

- **状態**: 2026-08-30 起草、同日アーキテクチャレビュー反映（D8〜D12 追加・実測 12〜14 追加・Phase 2a/4 の前提修正）。**同日 Phase 0〜5 実装完了（ローカルブランチ・未 push・PR 未作成）**: `docs/app-testing-l0` → `feature/lint-strict` → `feature/state-schema-validation` → `feature/wcs-schema` → `feature/tag-name-map` → `feature/testing-package` → `feature/wcs-tsc`（P2a 以降は積み上げ。P0 は P4 に cherry-pick 済み）。各 Phase の実装時発見は各節末尾に記録。指摘「型安全とテスト支援がアプリ作者に届いていない」（①`@wcstack/testing` 相当が無い／②型は VSCode 拡張の診断のみ・CI では `@wcstack/lint` が唯一の網）への対処を、実測で補正した上で 6 案（L0 / T2 / T1 / T3 / L1 / T4）に分解し、着手可能なタスク粒度・受け入れ条件・完了条件に展開した手順書。
- **届ける相手（2 種類・区別して扱う）**: **(A) CDN のみ**（Import Map / `https://esm.run/...`、tsc を回さない・wcstack の主利用者）と **(B) npm + tsc**（`@wcstack/*` を install し `tsconfig.json` を持つ）。Phase 0 / 1 / 2 は A・B 双方に届く（HTML と manifest だけで成立）。**Phase 3 / 5 は B にしか届かない**（Phase 3 の augmentation はパッケージの `.d.ts` がプログラムに載って初めて効き、URL import では tsc に到達しない。Phase 5 は `tsconfig.json` の `include` を要求する）。各 Phase の見出しに対象を付す。
- **前提となる設計書**: [static-wiring-dx-design.md](./static-wiring-dx-design.md)（§7 で `@wcstack/language-server` 汎用化を棄却済み＝本書でも踏襲）、[wcstack-manifest-schema.md](./wcstack-manifest-schema.md)（`stateSchema` の規範）、[wcs-validate-npm-cli-proposal.md](./wcs-validate-npm-cli-proposal.md)（lint の zero-dep 配布パターン）、[sri.md](./sri.md)（`src/auto.ts` の自己完結不変条件）。
- **ブランチ**: Phase ごとに `--no-track` で切る（`docs/app-testing-l0` → `feature/lint-strict` → `feature/state-schema-validation` → `feature/tag-name-map` → `feature/testing-package` → `feature/wcs-tsc`）。コミットは `git commit -F`。
- **新規パッケージ**: **2 つ作る**。`@wcstack/testing`（Phase 4）と `@wcstack/typescript`（Phase 2b / 5）。どちらも `packages/*` に置けば CI の detect-changes と release の Discover が自動で拾う（`@wcstack/*` スコープ判定）。**初回 publish は手動**＋ trusted publisher 登録（[npm-release-state](./distribution-robustness-impl-plan.md) の既知手順）。パッケージ数記載 8 箇所は **45 → 47** に直す。

---

## 0. 決定レコード

### 0-1. 品質特性の優先順位（本書の全決定はこの順に従う）

1. **既存利用者の CI と挙動を壊さない** — 明示のオプトイン（manifest を置く／`--strict` を付ける）なしに severity・exit code・診断の意味を変えない（D6・D8・D9）。
2. **zero-dep / 自己完結配布** — `@wcstack/lint` は runtime dependency ゼロ、`src/auto.ts` は `./exports` 以外を import しない。`typescript` / Volar を要する道具は別パッケージに隔離し、そこでも必須の runtime dependency は持たない（D2・D10）。
3. **IDE / CLI パリティ** — 同じ入力は IDE と `wcs-validate` で同じ `code` を出す。新しい入力経路（manifest 発見）は両者で 1 関数に閉じる（D8）。
4. **レシピが正本・パッケージは任意** — 文書に書いた素の手順が先にあり、`@wcstack/testing` はそれを短くするだけ（Phase 0 → 4）。
5. **型検証の正確さ** — 上の 4 つを満たす範囲で最大化する。

この順序の帰結: 「正確さ」を「zero-dep」の下に置いたので、検証器は TS を直接読まず manifest を中間媒体にする（D1）。その代償として派生物 manifest の drift を引き受け、検出を D9 で補う。**順序が逆転する（正確さ > zero-dep）なら**、`wcs-validate` が `typescript` を optional peer で直接読む設計になり、Phase 2b は不要になる。

### 0-2. 決定表

| # | 決定 | 理由 |
|---|---|---|
| **D1** | TS 型を HTML 側（`data-wcs` パス）の検証に届ける媒体は **サイドカー manifest の `stateSchema`** とし、指摘の字面（`.d.ts` 生成）は採らない | HTML は `.d.ts` を消費できない。検証器はすでに JSON-Schema サブセットの `stateSchema` を規範に持ち（[wcstack-manifest-schema.md §3](./wcstack-manifest-schema.md)）、`resolveSchemaPath` まで[実装済み](../packages/vscode-wcs/src/core/sidecar/schemaSubset.ts)で**消費者だけが無い**。生成器（TS 型 → stateSchema）を足せば CI・全エディタで同じ検証が成立する。**棄却した代替案**: `wcs-validate` が `typescript` を optional peer で `src="state.ts"` を直接読む — 優先順位 2（lint の zero-dep）に反し、IDE 側も同じ経路を持たないとパリティ（3）が崩れる |
| **D2** | `typescript` を必要とする道具は新パッケージ **`@wcstack/typescript`** に隔離する（bin: `wcs-schema` / `wcs-tsc`）。`@wcstack/lint` は zero-dependency を維持 | lint は「148KB 自己完結」が売り（[wcs-validate-npm-cli-proposal.md](./wcs-validate-npm-cli-proposal.md)）。typescript は **peerDependency**（利用者の tsc を使う）で、パッケージ自体は runtime dependency ゼロ（Volar の扱いは D10） |
| **D3** | `@wcstack/testing` は **`@wcstack/state` と `@wcstack/server` を peerDependency** にし、happy-dom は自分では宣言しない（server の `dependencies` 経由で到達する） | `@wcstack/server` は happy-dom を **`dependencies`（同梱）** で持つ唯一の例外枠（[server/package.json](../packages/server/package.json)）。testing は server の `installGlobals` と安定化ループを再利用する（D11）ので server が必要であり、happy-dom はそこから来る。vitest の `environment: 'happy-dom'` 下では `installDom()` を呼ばないので、vitest 側の happy-dom と衝突しない（npm は `^20` で dedupe する）。**棄却した代替案**: happy-dom を optional peer にして server に依存しない — 安定化ループまで複製することになる（D11） |
| **D4** | `HTMLElementTagNameMap` 拡張は**各パッケージが自分の `src/` に `declare global` で持つ**（生成しない）。ドリフトは vscode-wcs の builtinTags カタログと突き合わせるテストで検出 | 単一正本は Shell クラス自身。`wcstack` エントリの `exports` は `./auto` のみが不変条件（conformance プローブ回避）なので集約 `.d.ts` を `wcstack` に置けない。**棄却した代替案**: `@wcstack/typescript` に集約 `.d.ts` を置く — 型がパッケージ本体から離れ、Shell を触った PR がカタログを直し忘れる構造になる（ドリフト検査は「自分の src」にあるからこそ同じ PR で直せる） |
| **D5** | `@wcstack/language-server` の他エディタ配布は**引き続きやらない**。他エディタ・CI には `wcs-validate`（Phase 1/2）と `wcs-tsc`（Phase 5）で届ける | [static-wiring-dx-design.md §7](./static-wiring-dx-design.md) の理由（typescript+Volar 同梱の重さ・Cursor/Windsurf は VS Code 拡張が動く）は変わっていない。GitHub issue にも需要シグナルなし |
| **D6** | `stateSchema` が宣言された state では、未存在パスは **`wcs/path-nonexistent` = error**。未宣言の state では従来どおり `wcs/binding-path-missing` = warning。**存在判定は `resolveSchemaPath` の三値（resolved / unknown / nonexistent）で行い、`unknown` は沈黙**する | 規範 §6「definite … nonexistent member → error／unknown → warning・info」に合わせる。明示の契約がある時だけ厳しくするので既存利用者の CI は壊れない。schema が意図的に開いている箇所（`{}` = `Date`・`Map`・深さ打ち切り）を error にしない（実測 14）。`--strict`（Phase 1）は severity を変えず exit code だけ動かす別軸 |
| **D7** | 着手順は **Phase 0 → 1 → 2 → 3 → 4 → 5**。**P0 / P1 / P2a / P3 は互いに独立**で並行可。P2b は P2a、P4 は P0、P5 は P2b のマージ後（§8 の依存表が正） | Phase 0/1 は既存資産だけで完結（S）。Phase 2 が本質的な穴を塞ぐ。Phase 5 は最も重く、Phase 2 の生成器と `@wcstack/typescript` の器を共有するので最後 |
| **D8** | application manifest の発見規則を**改定**する: HTML ファイルのディレクトリから上へ `wcstack.manifest.json` を探し**最も近い 1 つ**を採る。CLI 引数で明示された application manifest は発見結果より優先。明示が 2 つ以上あり同名 state を宣言していれば **`manifest-state-collision` = error**（勝者なし・その state は未宣言扱い） | 規範 [§5-1](./wcstack-manifest-schema.md) は「発見順序は呼び出し側指定（CLI は引数、IDE は workspace 順）」を **fixed** としているが、IDE には manifest を読む経路が無く（実測 8）、引数方式では IDE/CLI パリティ（優先順位 3）が成立しない。よって規範 §5-1 を書き換える（追記ではなく改定）。最近傍 1 つ・合成なしは §5「暗黙 merge 禁止」に整合。application 同士の衝突は §5-3 の package 衝突と同じ「勝者なし」に揃える |
| **D9** | `stateSchema` の**正本は TS 型**、manifest は**派生物**。`wcs-schema check`（再生成結果と manifest の差分で exit 1）を提供し、推奨 CI フローを `wcs-schema check && wcs-validate --strict` にする。`--merge` は該当 state の `stateSchema` を**無条件に置き換える**（手書きは残らない） | 規範 §5-5 の drift 検出は package 側の `wcBindable` だけで、application 側の `stateSchema` が `state.ts` と乖離しても CI は緑のまま。派生物の drift は生成器側でしか検出できない。手書きと生成の合成は「暗黙 merge 禁止」に反するので、手書き schema を持ちたい state は `wcs-schema` の対象から外す運用にする |
| **D10** | `@wcstack/typescript` は runtime dependencies を**ゼロのまま**にする。`@volar/typescript` / `@volar/language-core` は **optional peerDependencies**（`~2.4.0`）とし、`wcs-tsc` が起動時に `require.resolve` して無ければインストール案内を出して exit 2 | `wcs-schema` だけ欲しい利用者に Volar を引かせない（優先順位 2）。npm 7+ は optional でない peer を自動インストールするが optional peer はしないので、宣言だけで重さを分離できる。**棄却した代替案**: (a) `dependencies` に置く — 2b の zero-dep が Phase 5 で崩れる (b) `@wcstack/tsc` に分割 — パッケージ数 +1・初回手動 publish +1 で、bin 2 つの器を分ける以上の価値が無い |
| **D11** | `@wcstack/testing` の `mount()` は **server の安定化ループを再利用**する: `@wcstack/server` が既存ループを `waitForReady(root)` として export し（挙動変更なし）、testing は `installGlobals` と共にそれを import する。`GLOBALS_KEYS` の複製と fs パリティテストは**やらない** | server は `static hasConnectedCallbackPromise` / `getBindingsReady` を自動検出して待つプロトコルを既に実装済み（実測 12）。router もこのプロトコルに乗っている。複製すると protocol が増えるたびに 2 箇所を直すことになる。**棄却した代替案**: 複製 + fs 一致検査 — 40 行超の挙動を複製し、sync-protocol-types の型同期と違い runtime を同期する仕組みが無い |
| **D12** | schema 宣言 state では、同じパスに inline script 解析候補と schema 候補が両方あり `typeHint` が食い違う場合、**schema が勝つ** | D6 と同じ「明示の契約が優先」。script 解析は正規表現ベースの推定（実測 5）で、schema は型から生成された確定情報 |

---

## 1. 出発点の実測（2026-08-30）

指摘の前提を実測で補正した結果。番号は後段の受け入れ条件から参照する。

1. **live DOM テストは今日でも約 15 行で成立する**。happy-dom の `Window` → `GLOBALS_KEYS` 差し替え（[server/render.ts](../packages/server/src/render.ts) と同じ 17 キー）→ `bootstrapState()` → `innerHTML` → `connectedCallbackPromise` → [`getBindingsReady(document)`](../packages/state/src/stateElementByName.ts) → `createStateAsync("writable")` で mount / 書き換え / 検証ができた（`count 1→42`、`li 2→3`）。vitest の happy-dom 環境なら globals 差し替えは不要。**欠けているのは文書と薄い包み**であり、ランタイムではない。
2. `@wcstack/server` の `renderToString()` はスナップショットテストにそのまま使えるが、README は SSR 用途としてしか説明していない。
3. アプリ作者向けのテスト記述は README / AGENTS.md / state README / wcstack-skill の**どこにも無い**。e2e は 28 本（`e2e/tests/*.spec.ts`）で全て wcstack 自身の検証用。
4. `.ts` state 側の型は **state 本体が公開済み**（`defineState` / `WcsPaths` / `WcsPathValue`、[define-state.md](../packages/state/docs/define-state.md)）。VSCode 非依存で `tsc` に効く。
5. **VSCode 内でも `data-wcs` パス検証は型ベースではない**。IDE と CLI は同じ[正規表現アナライザ](../packages/vscode-wcs/src/service/stateAnalyzer.ts)を使い、TS 型注釈を読まない。実測: `users: [] as {name:string}[]` に対し `users.*.name` が偽警告 `wcs/binding-path-missing`。
6. `wcs/binding-path-missing` は warning → `wcs-validate` は **exit 0**。typo `coutn` で CI が落ちない。warning を落とすオプションは無い（[cli.ts parseArgs](../packages/vscode-wcs/src/cli.ts)）。
7. サイドカーの `wcstack.application.stateSchema` は型定義・規範・`resolveSchemaPath` まであるが、**消費者ゼロ**（`wcs/path-nonexistent` 系コードは [diagnostics.ts](../packages/vscode-wcs/src/core/diagnostics.ts) で宣言のみ）。stateSchema を与えても診断は不変（実測）。
8. **IDE はサイドカー manifest をそもそも読んでいない**（`wcsCompletionPlugin.ts` に manifest の読み込み経路なし）。CLI は引数で渡された manifest を集合検証（衝突・drift）するだけで、HTML の検証には合流させていない（[runValidation.ts](../packages/vscode-wcs/src/core/cli/runValidation.ts)）。
9. `@volar/typescript` の `runTsc`（vue-tsc と同じ仕組み）は vscode-wcs の依存に**同梱済み**。既存の Volar LanguagePlugin は `LanguagePlugin<URI>` で `uri.path` しか使っていないので string 版に一般化できる。
10. `stripWcsImport` は bare 指定 `@wcstack/state` だけを剥がす。CDN URL import（`https://esm.run/@wcstack/state`）は残るため headless tsc では TS2307 になる（IDE でも同じはず＝Phase 5 で直すと IDE も改善する）。
11. Shell クラスを export しているパッケージは 39（＋ state / router）。`declare global` は state の `polyfills.ts` に前例があるが、rollup-plugin-dts が出力 `index.d.ts` に残すかは**未検証**。state dist に `declare global` が無いのは `polyfills.ts` が `exports.ts` から到達不能なためで、**落ちる証拠にはならない**（Phase 3 のスパイクで確かめる）。
12. **router は readiness プロトコルを既に持つ**。[Router.ts](../packages/router/src/components/Router.ts) は `static hasConnectedCallbackPromise = true` と `connectedCallbackPromise` を実装し、[server/render.ts](../packages/server/src/render.ts) はこのフラグと `static getBindingsReady` を**自動検出して待つ安定化ループ**を持つ（ssr-router-design §3.2）。「router に readiness API が無い」は誤り（Phase 4 の前提を修正）。
13. リポジトリ内に application manifest（`wcstack.manifest.json`）は**存在しない**（`packages/state/dist/wcs-manifest.json` は package artifact で名前も違う）。D8 の発見規則を入れても、リポジトリ自身の `wcs-validate` CI job の結果は変わらない。
14. [`resolveSchemaPath`](../packages/vscode-wcs/src/core/sidecar/schemaSubset.ts) は三値を返す: `properties` に子がある → resolved／`type:"object"` か `properties` があるのに子が無い → **nonexistent**／どちらも無い素の `{}` → **unknown**。生成器が `Date`・`Map`・深さ打ち切りで出すのは素の `{}` でなければならない（`{type:"object"}` にすると下が全部 nonexistent = error になる）。

---

## 2. Phase 0（L0）: 文書だけで「テストの道」を通す — 工数 S — 対象 A・B

**目的**: 実測 1〜3 の穴を、コードを増やさずに塞ぐ。Phase 4 のパッケージができても「素のレシピ」は残す（依存を増やしたくない利用者向け）。

### 2-1. state README に `## Testing Your Page` を新設（en / ja）

- 置き場所: `## TypeScript Support` の直前（[README.md](../packages/state/README.md) 2249 行付近、README.ja.md も同じ位置）。
- 内容（3 レシピ、全て実行済みのものだけ載せる）:
  1. **vitest + happy-dom**: `vitest.config.ts`（`environment: 'happy-dom'`）、`bootstrapState()` を setup で 1 回、テストは `document.body.innerHTML = ...` → `await stateEl.connectedCallbackPromise` → `await getBindingsReady(document)` → assert → `createStateAsync("writable", ...)` → `await new Promise(r => setTimeout(r, 0))` → assert。
  2. **素の Node（vitest 以外）**: `@wcstack/server` が既に export している `installGlobals(window)`（`GLOBALS_KEYS` 17 キーの差し替え・解除関数を返す）を使う 4 行を載せる。「`renderToString` が同じ手順で動いている」と出典を示す。キー一覧は複製せず server の `GLOBALS_KEYS` export を指す。
  3. **スナップショット**: `renderToString()` で描画結果を文字列比較。
- 明記する制限: happy-dom は `customElements.define` 時に既存ノードを差し替える（state の integration テストのコメントと同じ文言）。イベント発火の実機差は e2e（Playwright）で確かめる旨。

### 2-2. 導線

- ルート [README.md](../README.md) `## Quick Start` 末尾と [AGENTS.md](../AGENTS.md) `## Building an app WITH wcstack?` に 1 行ずつ、state README の新節へのリンク。
- `@wcstack/server` README `## Quick Start` に「テストのスナップショット用途にも使える」1 段落。
- wcstack-skill（別リポジトリ `../wcstack-skill`）: `SKILL.md` §5 "Server and verification" にレシピ 1 を要約、`references/state-binding.md` 末尾に `## Testing` 節。

### 2-3. レシピが嘘にならない仕組み

- `packages/state/__tests__/readme.testingRecipe.test.ts` を追加: README のレシピ 1 を**そのまま**（`src` ではなく公開 API 名で）実行する契約テスト。README を書き換えたらこのテストも変える運用にし、ファイル先頭のコメントで README の節名を指す。

**受け入れ条件**: (a) 契約テストが state の `npm test` で通る (b) README en/ja の両方に節がある (c) skill 側に PR が出ている（マージはユーザー操作）。

---

## 3. Phase 1（T2）: `wcs-validate --strict` — 工数 S — 対象 A・B

**目的**: 実測 6。warning を CI で落とせるようにする。severity 自体は動かさない（D6）。

- [cli.ts](../packages/vscode-wcs/src/cli.ts) `parseArgs`: `--strict` を追加（`options.strict = true`）。
- [runValidation.ts](../packages/vscode-wcs/src/core/cli/runValidation.ts): `RunValidationOptions.strict?: boolean`。`exitCode` は `errorCount > 0 || (strict && warningCount > 0) ? 1 : 0`。`--errors-only` との併用時も counts は全診断で数える（既存契約を維持）。
- サマリ行に `(strict)` を付けて、何で落ちたかが読めるようにする。
- テスト: `core.cli.test.ts` に strict の error 側／warning 側／info だけ（exit 0 のまま）の 3 ケース。`packages/lint/scripts/smoke-test.mjs` に配布物側のケースを **error/warning 両側**で追加（smoke-test.mjs 106〜115 行のコメントが要求している対称性）。
- README（lint en/ja）の Options 表と exit code 表を更新。wcstack-skill の Pitfall Checklist に「`--strict` は typo（warning）でも落ちる。外部 state を fileReader が解決できない時は warning が残るので、`src=` のパスを相対で解決可能にしてから使う」を追記。
- **リポジトリ自身の CI（`wcs-validate` job）は非 strict のまま**。examples に解決不能な外部 state 由来の warning があるため（[cli.ts](../packages/vscode-wcs/src/cli.ts) の `errorsOnly` の動機と同じ）。

**受け入れ条件**: `node packages/lint/dist/cli.cjs --strict index.html`（実測 6 の fixture）が exit 1、`--strict` なしは exit 0。

---

## 4. Phase 2（T1）: `stateSchema` の消費と TS 型からの生成 — 工数 M — 対象 A・B（2b の生成器を回すのは B だが、生成物の manifest は A でも使える）

本質的な穴（実測 5・7・8）を塞ぐ。2a（検証器）と 2b（生成器）は別 PR。2a が先。

### 4-1. Phase 2a: 検証器が `stateSchema` を消費する（vscode-wcs / lint）

1. **候補導出（補完・hover 用）** `stateAnalyzer.ts`: `analyzeSchemaPaths(schema: JsonSchemaNode, stateName, resolver): PathCandidate[]`。`collectJsonPaths` と同じ規則で `properties` → `data`（`typeHint` は `type` から。`anyOf` は null を除いた主型、`enum`/`const` は要素型）、`items` を持つ `array` → `<path>.*`（`list`）＋ `<path>.length`（`number`）＋ items が object なら子へ再帰、`$ref` は `resolveSchemaPath` の局所解決を通す（循環は既存の `manifest-ref-cycle` に任せて打ち切り）。深さ上限は既存 `MAX_OBJECT_NEST_DEPTH`（= 5、生成器も同じ値に揃える）。**この候補リストは存在判定には使わない**（次項）。
2. **合流** `validateDocument.ts` / `bindingValidator.ts`: `ValidateDocumentOptions.applicationStates?: ReadonlyMap<string, JsonSchemaNode>`。schema が宣言された state を `schemaDeclared` 集合に持つ。**存在判定は二系統**: (i) `schemaDeclared` の state では、パスを segments に分けて `resolveSchemaPath(schema, $defs, segments)` を呼び、`nonexistent` のときだけ `WcsDiagnosticCode.PathNonexistent`（error）、`unknown` は沈黙、`ref-error` は既存の manifest 診断に任せる（実測 14・D6）。inline script 由来の候補（メソッド・`$` キー・getter など schema に載らないもの）は resolve の前に候補集合で先に照合し、当たれば存在扱い。(ii) 未宣言の state は従来どおり候補集合照合 → `BindingPathMissing`（warning）。発火点は [bindingValidator.ts:208](../packages/vscode-wcs/src/service/bindingValidator.ts) の 1 箇所を分岐させる。候補平坦化だけで判定すると `{}` の下が全部 error になる（レビュー指摘）ので、`resolveSchemaPath` を経由することが完了条件。
3. **型整合**（同 PR・範囲を限定）: schema の `typeHint` と構造ディレクティブの要求だけを突き合わせる — `for:` に non-array → `PathTypeMismatch`（error）。それ以外の型期待は既存 `BindingTypeExpectation` の機構に `typeHint` が流れ込むことで自然に効く（新規コードは書かない）。同じパスに script 候補と schema 候補が両方あるときは **schema の `typeHint` で上書き**する（D12）。
4. **発見規則** `core/sidecar/discover.ts`（新規・pure）— **規範 §5-1 の改定（D8）**: HTML ファイルのディレクトリから上へ `wcstack.manifest.json` を探し、**最も近い 1 つ**を採る（親と子の両方にあっても合成しない＝規範 §5「暗黙 merge 禁止」に整合）。入力は `fileReader` だけ（読めなければ無いものとする）。CLI 引数で明示された manifest は従来どおり集合検証に入れ、application artifact なら発見結果より優先する。明示 application manifest が複数あり同名 state を宣言 → `manifest-state-collision`（error・その state は未宣言扱い）。`WcsDiagnosticCode` に `ManifestStateCollision` を追加。
5. **CLI 配線** `runValidation.ts`: HTML 入力ごとに discover → `loadManifest` → `wcstack.application.states` を `applicationStates` に変換して `validateDocument` へ。manifest 自体の診断（envelope 不正等）はその HTML の source に載せず、manifest の source に載せる（既存の並びを崩さない）。
6. **IDE 配線** `wcsCompletionPlugin.ts` の `provideDiagnostics`: 同じ `discover` を同じ `fileReader` で呼ぶ。**CLI と IDE で discover の呼び出しが 1 関数に閉じていること**が IDE/CLI パリティの完了条件（static-wiring-dx-design.md §6-2 と同じ構造）。
7. テスト: `stateAnalyzer.test.ts`（schema → 候補）、`bindingValidator.test.ts`（schema あり/なしで severity が変わる、`for:` 型不一致、**`{}` の下のパスは沈黙**、**script 候補と schema の typeHint 衝突は schema 優先**）、`core.sidecar.discover.test.ts`（最近傍・不在・読めない・明示 2 件の同名 state 衝突）、`core.cli.test.ts`（実測 5 の fixture を schema 付きで通すと `users.*.name` の偽警告が消え `coutn` が error になる）、`plugin.test.ts`（IDE 経路でも同じ code）。lint smoke に 1 ケース。
8. 文書: [wcstack-manifest-schema.md](./wcstack-manifest-schema.md) **§5-1 を D8 の規則に書き換え**（「caller-supplied order」→「nearest `wcstack.manifest.json` + explicit inputs」、application 同士の衝突規則を §5-3 の並びに追加）、§6 に D6 の三値 severity 規則を追記。lint README en/ja に「stateSchema があると path 診断が error になる」節。vscode-wcs は 1.11.0 → 1.12.0。

**受け入れ条件**: 実測 5 の fixture（`state.ts` + `index.html` + `wcstack.manifest.json`）で `wcs-validate index.html` が「偽警告 0 / `coutn` error / exit 1」。manifest を消すと従来どおり warning 3 件 / exit 0。

### 4-2. Phase 2b: `wcs-schema` — TS 型から `stateSchema` を生成する（`@wcstack/typescript` 新設）

1. **パッケージ雛形** `packages/typescript/`: server と同じ tsc + rollup 構成（`dist/index.esm.js` / `index.d.ts`）に加え bin `dist/wcs-schema.mjs`。`peerDependencies: { typescript: ">=5.0" }`、runtime dependencies なし（Phase 5 でも増やさない — D10）。vitest は node 環境。ESLint 設定は他パッケージから複製。**CI**: `@wcstack/*` なので detect-changes matrix に自動で載るが、build が vscode-wcs をソースからビルドする lint と同型なので、matrix 内では state の committed dist に依存する。[ci.yml の `wcs-validate` job](../.github/workflows/ci.yml) に lint と同じ「新鮮な state × packages/typescript の build + test」ステップを追加する（#183 型の穴を新パッケージで再生産しない）。
2. **CLI** `wcs-schema emit <state.ts|state.js> [--state=default] [--out=wcstack.manifest.json] [--merge] [--tsconfig=...]` と `wcs-schema check <state.ts|state.js> [--state=default] [--manifest=wcstack.manifest.json]`:
   - `ts.createProgram` → default export の型を `checker.getTypeAtLocation` で取る。`defineState(x)` は identity なので unwrap は不要。`export default { ... }` の素のオブジェクトでも同じ。`.js` は `allowJs/checkJs` で JSDoc 型が効く。
   - 型 → JSON-Schema サブセット（許可キーワードは `type, properties, required, items, enum, const, anyOf, $defs, $ref` のみ・規範 §4）。規則: `$` 始まりキーは捨てる／call signature を持つメンバー（メソッド）は捨てる／getter は戻り型で載せる／配列は `items`／union は null を分離して `anyOf`／リテラル union は `enum`／`Date`・`Map` 等の組み込みは**素の `{}`**（unknown・`type` を付けない — 実測 14）／深さ **5**（= 検証側 `MAX_OBJECT_NEST_DEPTH`）で打ち切って素の `{}`。`WcsPaths` の 4 はコンパイル性能上の別制限で、schema には関係しない。
   - `--merge`: 既存 manifest の他 state・`filters`・`listContexts` を保持して該当 state の `stateSchema` を**無条件に置き換える**（D9・手書きは残らない旨を README に明記）。envelope は `schemaVersion: 1, kind: "application"` を補う。
   - `check`: emit と同じ生成を行い、manifest 内の該当 `stateSchema` と正規化比較（キー順を揃えた JSON 文字列比較）。一致で exit 0、差分で exit 1（差分パスを stderr に列挙）、manifest 不在・state 不在は exit 2。**推奨 CI フローは `wcs-schema check && wcs-validate --strict`**（D9）。
   - 生成結果は必ず `validateManifestArtifact` 相当の自己検査を通す（不正なら exit 2）。検査ロジックは vscode-wcs 側にあるので、lint と同じく **ビルド時に vscode-wcs のソースから bundle** する（[lint/scripts/build.mjs](../packages/lint/scripts/build.mjs) の型。vscode-wcs の [esbuild.config.js](../packages/vscode-wcs/esbuild.config.js) に `src/cli.ts` と並ぶ第 4 エントリ `src/schemaCore.ts` → `dist/schema-core.cjs` を足し、`packages/typescript` の build がそれを取り込む）。
3. テスト: 型 → schema の変換を表で固定（プリミティブ／配列／入れ子／union／getter／`$` キー／メソッド除外／深さ上限／`Date` が素の `{}`）。生成物を 2a の検証器に通して `users.*.name` が解決する end-to-end ケースを 1 本。`check` の一致・差分・不在の 3 ケース。
4. 文書: `packages/typescript/README.md`（en/ja）、[define-state.md](../packages/state/docs/define-state.md) に「型を CI に届ける（`wcs-schema` → `wcs-validate`）」節、lint README から相互リンク。**`docs/typescript.md`（en/ja）を新設**し、`defineState` / `wcs-schema` / tag name map（Phase 3）/ `wcs-tsc`（Phase 5）の単一入口にする。**Phase 3 / 5 の節は見出しと「予定」1 行だけ先に置く**（P3 / P5 が同ファイルを編集する競合を減らす）。ルート README `## Packages` 直下の数と `### Additional Packages` に追加（8 箇所）。

**受け入れ条件**: `wcs-schema emit state.ts --out wcstack.manifest.json && wcs-validate --strict index.html` が実測 5 の fixture で「typo だけ error」になる。`state.ts` に property を足した後の `wcs-schema check` が exit 1。

---

## 5. Phase 3（T3）: `HTMLElementTagNameMap` 拡張 — 工数 S（スパイク付き）— 対象 B のみ

**目的**: `document.querySelector('wcs-fetch')` が `WcsFetch` に型付く。指摘の「`.d.ts`」の字面に唯一合う安価な策。**届くのは B（npm + tsc）だけ**: augmentation はパッケージの `.d.ts` がプログラムに載って初めて効くので、`import "@wcstack/fetch"`（副作用 import）か tsconfig `types` が要る。URL import しかしない A には届かない。

1. **スパイク（最初にやる）**: `packages/fetch/src/exports.ts` に `declare global { interface HTMLElementTagNameMap { "wcs-fetch": WcsFetch; "wcs-infinite-scroll": WcsInfiniteScroll } }` を置いて `npm run build` し、`dist/index.d.ts` に残るか確認（実測 11）。残らなければ `src/elements.d.ts` を `files` に含め `types` から `/// <reference path>` で引く形に切り替える。結論を本書 §9 に追記してから横展開。
2. 横展開: Shell を export する 39 パッケージ＋ state（`wcs-state`）＋ router（`wcs-router` / `wcs-route` / `wcs-outlet` / `wcs-link` / `wcs-layout` / `wcs-layout-outlet` / `wcs-head` / `wcs-guard-handler` — [router/config.ts](../packages/router/src/config.ts) の 8 タグ）。既定タグ名のみ（`IWritableTagNames` で変えた場合は対象外と README に明記）。`src/auto.ts` には触れない（[sri.md](./sri.md) の不変条件）。
3. **ドリフト検査**: `packages/vscode-wcs/__tests__/tagNameMap.test.ts` — `BUILTIN_TAGS` の全キーが、対応パッケージの `src/**/*.ts` 内の `HTMLElementTagNameMap` 宣言に現れることを fs で検査（vscode-wcs の CI job は常時走る）。逆方向（宣言にあってカタログに無いタグ）も落とす。**ただし `BUILTIN_TAGS` は I/O パッケージの `dist/auto.min.js` から生成され state / router のタグを含まない**（[emit-builtin-tags.mjs](../packages/vscode-wcs/scripts/emit-builtin-tags.mjs)・54 タグ）ので、逆方向検査は state / router の宣言を**明示リストで除外**し、その 2 パッケージは自パッケージのテストで `config.ts` の既定タグ名と宣言の一致を検査する。
4. 文書: `docs/typescript.md` に節を追加（「`import "@wcstack/<pkg>"` を 1 行入れないと効かない」を先頭に）。各パッケージ README には書かない（46 ファイルの同期は不要）。

**受け入れ条件**: fetch を消費する tsc プロジェクトで `document.querySelector('wcs-fetch')!.url` が型エラーなく通る。ドリフト検査が green。

---

## 6. Phase 4（L1）: `@wcstack/testing` — 工数 S〜M — 対象 A・B（Node で vitest を回せれば CDN 作者でも使える）

**目的**: Phase 0 のレシピを 1 import にする。レシピが先にあるので、このパッケージは「便利」であって「必須」ではない。

### 6-1. 公開 API（v1）

```ts
import { mount, settle, state } from "@wcstack/testing";

const app = await mount(`<wcs-state json='{"count":1}'></wcs-state><p data-wcs="textContent: count"></p>`);
expect(app.root.querySelector("p")!.textContent).toBe("1");
await app.state().write(s => { s.count = 42; });   // createStateAsync("writable") の包み
await settle();                                     // microtask + macrotask を流す
expect(app.root.querySelector("p")!.textContent).toBe("42");
app.unmount();
```

- `mount(html, { root?: "document" | "shadow", bootstrap?: Array<(registry?) => void> })`: 既定は `document.body` に流し込む。`bootstrap` の既定は `[bootstrapState]`（peer の state から import）。router / fetch を使う時は利用者が `bootstrapRouter` 等を渡す（`registerComponents` は全パッケージが define 済みガードを持つので多重呼び出しは安全）。流し込んだ後は **server の `waitForReady(root)` を呼ぶ**（D11・実測 12）: `static hasConnectedCallbackPromise` を持つ全要素の `connectedCallbackPromise` と `static getBindingsReady` を自動検出して待つ既存ループなので、**router の初回 commit も state のバインド完了も同じ 1 呼び出しで待てる**。戻り値は `root` / `state(name = "default")` / `unmount()`。
- **server 側の変更（同 PR）**: [render.ts](../packages/server/src/render.ts) の安定化ループ（`hasConnectedCallbackPromise` 収集 → 安定化 → `getBindingsReady`）を `waitForReady(root: Node): Promise<void>` として切り出して export する。`renderToString` はそれを呼ぶだけにし、挙動は変えない（server の既存テストがそのまま回帰テストになる）。
- `state(name).read(fn)` / `.write(async fn)`: `createState("readonly")` / `createStateAsync("writable")` の包み。
- `settle()`: `await Promise.resolve()` ×2 → `setTimeout(0)`。state の更新はマイクロタスク境界で収束するため、実測レシピと同じ待ち方に固定する。
- `fire(el, type, init?)`: `bubbles: true` 既定の `Event`/`CustomEvent` ディスパッチ。
- `installDom()`: vitest 以外（素の Node）向けに happy-dom の `Window` を作り、**server の既存 export `installGlobals(window)`** で差し替えて解除関数を返す（D11）。`GLOBALS_KEYS` の複製も fs パリティテストも持たない。

### 6-2. 範囲外（v1 では作らない）

- Playwright フィクスチャの配布、React/Vue アダプタ向けヘルパ。
- （旧記載「router の readiness 待ち」は**撤回**: router は readiness プロトコルを持ち、`waitForReady` が待つ — 実測 12）

### 6-3. 実装メモ

- パッケージ雛形は server に倣う。`peerDependencies: { "@wcstack/state": "^1.32.0", "@wcstack/server": "^1.32.0", "happy-dom": ">=20" }`（D3。happy-dom は **optional peer** — `installDom()` が `import("happy-dom")` するのは testing の位置からの解決なので、server の依存経由では届かない。vitest の happy-dom 環境では不要）。server の `@wcstack/state` 依存は `^1.9.1` のままで、利用者の `^1.32.0` と dedupe される。devDependencies は `file:../state` / `file:../router` / `file:../server`、build（`scripts/build-deps.mjs`）がその 3 つを src から再ビルドする（CI matrix の committed dist は src に遅行する — #183 型）。
- **実装時に見つけた実欠陥 3 件（同 PR で修正）**: (1) state `loadFromInnerScript` の `data:` URL 経路は本文が同一だと ESM キャッシュに当たり **同じ state オブジェクトを共有**（テスト間の漏れ・SSR の同一テンプレート再描画でも）→ sourceURL に通し番号。(2) router CSR の `connectedCallbackPromise` は初期化が throw すると永久未決着（SSR 経路だけ reject 配管あり）。加えて happy-dom は開始タグで connectedCallback を呼ぶので `<template>` 未到着で throw → SSR 経路と同じ 1 microtask 待避。(3) router CSR は初回ルート内容を binder に渡さない（「state の走査時に既に document に居る」前提）が、`json=` の state は I/O 無しで router より先に走査を終える → binder が居れば差し出す。
- **happy-dom の癖**: `textContent = 0` が空文字、`innerText = 0` は throw（ブラウザは "0"）。`mount()` が setter をシムする（own-property マーカーで Node / Element 両方を包む）。素のレシピ側は README の死角に記載。
- 自身のテストは vitest happy-dom 環境。HTML は文字列リテラルで持つ（`*.html` としてコミットすると CI の `wcs-validate` gate が走査する — AGENTS.md の規則）。
- 実例: `examples/state-testing-todo/`（最小 todo ＋ `__tests__/todo.test.ts`）を追加し、[examples/README.md](../examples/README.md) に載せる。e2e smoke には載せない（ブラウザで開く価値がない）。
- 文書: README en/ja、`docs/typescript.md` からは触れない（型の話ではない）、state README `## Testing Your Page` の先頭に「1 import で済ませるなら `@wcstack/testing`」を追記、skill 追随。パッケージ数 8 箇所。

**受け入れ条件**: `examples/state-testing-todo` の vitest が通る。`bootstrap: [bootstrapState, bootstrapRouter]` で `<wcs-router>` を含む HTML を `mount` し、初回ルートの描画結果を `waitForReady` 後に assert できる（router を待てる証拠）。server の既存テストが無変更で通る。Phase 0 の契約テストは残す（レシピ単体の保証）。

---

## 7. Phase 5（T4）: `wcs-tsc` — 工数 M〜L — 対象 B のみ

**目的**: `<wcs-state>` インライン `<script type="module">` を CI で tsc 検査する（vue-tsc と同じ構造）。実測 9〜10。`tsconfig.json` を持つ B にしか届かない。

1. **LanguagePlugin の一般化**（vscode-wcs 側・IDE 無変更）: `createWcsLanguagePlugin` を `LanguagePlugin<string | URI>` にし、`getLanguageId` / `createVirtualCode` が受ける識別子から path を取る小関数を挟む。`plugin.test.ts` に string 経路のケース。
2. **URL import**: `stripWcsImport` を `@wcstack/state` の **bare / `https://…/@wcstack/state[@ver][/...]`** の両方を剥がす正規表現に拡張（IDE でも TS2307 が消える）。その他の URL import は `wcs-tsc` が `--url-imports=any`（既定・`declare module "https://*"` を仮想ファイルとして注入）／`error` で切り替え。
3. **CLI** `wcs-tsc [tsc の引数…]`: `@volar/typescript` の `runTsc(require.resolve('typescript/lib/tsc'), { extraSupportedExtensions: ['.html'], extraExtensionsToRemove: [] }, getLanguagePlugins)`。利用者の `tsconfig.json` に `"include": ["**/*.html"]` と `noImplicitThis` / `allowJs` / `checkJs` が要る（server.ts が強制している設定と同じ）。不足していれば起動時に**警告し、`--wcs-defaults` で補う**。
4. **配布**: `@wcstack/typescript` に bin `wcs-tsc` を追加。`@volar/typescript` と `@volar/language-core` は **optional peerDependencies（`~2.4.0`）**、`typescript` は peer のまま、runtime dependencies はゼロを維持（D10）。`wcs-tsc` は起動時に両方を `require.resolve` し、無ければ `npm i -D @volar/typescript@~2.4.0 @volar/language-core@~2.4.0` を案内して exit 2。バンドルは lint と同じく vscode-wcs ソースからの esbuild（`external: ['typescript', '@volar/*']`）。
5. テスト: fixture HTML は一時ディレクトリに生成（AGENTS.md 規則）。ケース: 型エラーが `file.html:line:col` で報告される／`defineState` 未使用の `export default {}` が自動ラップされる／CDN import が消える／`--url-imports=error`／Volar 不在時の exit 2 と案内文。
6. CI: `examples/**/*.html` に対して**非ゲートの experimental job** を先に 1 リリース分回し、偽陽性が 0 になったらゲート化。**ゲート化の判断はリリース時作業（§10）に載せ、リリース担当が experimental job の直近 1 リリース分のログを見て決める**。偽陽性が残っていれば理由を §9 に書いてもう 1 リリース延ばす。
7. 文書: `docs/typescript.md`、`packages/typescript/README`、skill §5。**D5 は据え置き**である旨を `static-wiring-dx-design.md` §7 の行に追記（「他エディタは wcs-validate + wcs-tsc で到達」）。

**受け入れ条件**: `examples/` の全 HTML で `wcs-tsc --noEmit` が偽陽性 0 で通る。`this.coutn++` を仕込んだ HTML が `TS2339` で落ちる。

**実装時の発見（2026-08-30）**: (a) `runTsc`（proxyCreateProgram）は `getExtraServiceScripts` を提供せず **1 ファイル 1 サービススクリプト**（vue-tsc と同じ）。よって Language Plugin に `mode: 'tsc'` を足し、全ブロックを 1 本の仮想 TS に合成する（プリアンブル 1 回・import 巻き上げ・ブロックごとのスコープ・`export default` → `const __wcs_state_N =`）。`getExtraServiceScripts` は定義するだけで警告が出るので tsc モードでは持たない。(b) `<wcs-state>` の無い HTML に `undefined` を返すと `.html` が素の TS として読まれ構文エラーの山になる → 空モジュールを返す。(c) typo の診断コードは `TS2339` ではなく候補付きの `TS2551`（"Did you mean 'count'?"）。(d) Volar は optional peer で `wcs-tsc` 起動時にプロジェクト側から解決（D10）。(e) tsc の exit code をそのまま使う（`noEmit` でも診断ありは非ゼロ）。(f) `stripWcsImport` は改行だけを残して import を消していたため、import 以降の診断位置が削った文字数ぶんずれていた（IDE でも同じ）→ 改行以外を空白に置換して文字数を保つ。(g) **examples 初回実測（experimental job の判断材料）**: 偽陽性 7 件・3 種 — `EyeDropper`（DOM lib に無い・`state-color-palette`）、`$streams` が実体化する値プロパティ（`pageResult`）をプリアンブルが知らない（`state-intersect-scroll`、`new Promise(resolve => …)` の `resolve()` 引数無しも同じページ）、例のコード自身の union 推論（`websocket-chat/state`）。ゲート化の前に、プリアンブルへの `$streams` 反映と DOM 拡張 API の ambient 宣言（または examples 側の `declare`）が要る。

---

## 8. PR 分割と依存

| PR | Phase | 内容 | 依存 | 工数 |
|---|---|---|---|---|
| P0 | 0 | state README en/ja 新節 + 導線 + 契約テスト（skill は別リポ PR） | なし | S |
| P1 | 1 | `--strict`（cli / runValidation / smoke / README） | なし | S |
| P2a | 2a | schema 三値判定・合流・発見規則（規範 §5-1 改定）・IDE 配線 | なし | M |
| P2b | 2b | `@wcstack/typescript` 新設 + `wcs-schema emit/check` + `docs/typescript.md`（骨組み込み）+ CI smoke | P2a（受け入れ条件が検証器を使う） | M |
| P3 | 3 | tag name map スパイク → 横展開 + ドリフト検査 | コードは独立。`docs/typescript.md` の節だけ P2b の骨組みに載せるので**文書コミットは P2b 後** | S |
| P4 | 4 | `@wcstack/testing` + server の `waitForReady` export + example | P0（レシピ確定後） | S〜M |
| P5 | 5 | `wcs-tsc` + plugin 一般化 + URL import | P2b（パッケージの器） | M〜L |

P0 / P1 / P2a / P3 は互いに独立で並行可（D7）。それ以外はこの表の依存が正。

---

## 9. 追随先と地雷

- **パッケージ数 8 箇所**（`packages/wcstack/package.json` description、`packages/wcstack/README.md`、ルート README en/ja の `## Packages` 直下・Additional Packages・ディレクトリツリー）: 45 → 47。`grep -c "# @wcstack/" README.md` で検算。
- **初回 publish は手動**（新パッケージ 2 つ）＋ trusted publisher 登録。release.yml の Discover は自動で拾うが、初回だけ OIDC が無い。
- **wcstack-skill 追随**: Phase 0（Testing 節）、1（Pitfall #29 `--strict`）、2（`wcs-schema` 手順）、5（`wcs-tsc`）。plugin version は検証したリリースに合わせる。
- **`src/auto.ts` に触らない**（Phase 3）。`./exports` 以外の import は SRI を黙って壊す。
- **vscode-wcs は state の dist を消費する**: Phase 2a で `@wcstack/state/manifest` を触る必要は無いが、触ったら vscode-wcs の build が次に走る時まで壊れに気づかない（#183 と同型）。**`packages/typescript` も同じ経路で vscode-wcs をビルドする**ので、`wcs-validate` job に build + test を足す（§4-2-1）。
- **規範 §5-1 は fixed 宣言**（Phase 2a）: 発見規則は「追記」ではなく改定（D8）。規範を書き換える PR であることを PR 本文に明記し、`docs/architecture-hardening/09-remediation-design.ja.md` §11 の決定ゲート参照も同期する。
- **`{}` と `{type:"object"}` は別物**（Phase 2b）: 前者は unknown、後者は下が全部 nonexistent（実測 14）。生成器のテスト表で固定する。
- **testing は server を peer に持つ**（Phase 4）: server の `waitForReady` / `installGlobals` の署名を変えると testing が壊れる。両方 `@wcstack/*` なので matrix には載るが、server 単独の PR では testing のテストが走らない（lint と同型の穴）。server の PR チェックリストに testing の `npm test` を加える。
- **HTML fixture をコミットしない**（Phase 2/4/5 のテスト）。CI の `wcs-validate` job が `packages/**/*.html` を走査する。
- **happy-dom の define 差し替え**（Phase 0/4）: 「define 後に同一ノードへ値が届く」は unit で検証できない。文書に書く。
- **`declare global` の dist 残存**（Phase 3）: スパイク結果をここに追記する。
- **Volar のバージョン固定**（Phase 5）: `~2.4.0`。`runTsc` の引数形は 2.4 系の `{ extraSupportedExtensions, extraExtensionsToRemove }`。上げる時は vscode-wcs と同時。

## 10. リリース時の作業（ユーザー操作）

- `@wcstack/testing` / `@wcstack/typescript` の初回手動 publish と trusted publisher 登録。**version は他パッケージと同じ値（1.32.0 系の次）に揃えて publish する**（release.yml は publish_list に `npm version` を掛けるが、初回手動時は自分で揃える）。
- vscode-wcs（1.12.0）の vsix publish。
- wcstack-skill の各 PR マージ。
- Phase 5 の experimental job のログを 1 リリース分確認し、偽陽性 0 ならゲート化 PR を出す（§7-6）。
- リリースノート: `--strict`（lint）／`stateSchema` 消費で **manifest を置いているプロジェクトは path 診断が error に上がる**（D6・破壊的ではないが挙動変更）／**manifest の発見規則が最近傍自動発見に変わる**（D8・規範 §5-1 改定）／`wcs-schema emit/check`／`HTMLElementTagNameMap`／`@wcstack/testing`（`@wcstack/server` が peer）／`@wcstack/server` に `waitForReady` 追加／`@wcstack/typescript`。
