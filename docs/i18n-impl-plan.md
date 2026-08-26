# 実装計画: i18n / l10n

- **状態**: 初稿（2026-08-27）。**着手前**。設計の正本は [i18n-design.md](./i18n-design.md)（D1 反転後・以下「設計書」）。本書はその §13 を着手可能なタスク粒度・受け入れ条件・完了条件に展開した手順書。
- **初稿計画（クロス state 読み取り前提）は破棄した。** D1（ライブ切替）を降ろしたことで、**`@wcstack/state` の core には一切触らない**計画になった。[state-cross-state-read-design.md](./state-cross-state-read-design.md) への依存は無い。
- **ブランチ**: 未作成。`feature/i18n` を `--no-track` で切る。コミットは `git commit -F`。
- **作業ディレクトリ**: Phase 0 が `examples/`、Phase 1 が `packages/state/`、Phase 2 が README（英日）とデモのテンプレート、Phase 3 が `packages/router/`、Phase 4 が `packages/lint/` と `packages/vscode-wcs/`。
- **新規パッケージ**: **作らない**（D7 決定・2026-08-27）。層 2 は head の同期スクリプトとして配る。**全 Phase が着手可能**で、裁定待ちのものは無い。

---

## 0. 全体方針

### 0-1. 進め方と DoD

- **Phase 単位でコミット**する。各 Phase の DoD は共通で、触ったパッケージについて:
  1. `npm test` green（既存テスト含む）
  2. `npm run test:coverage` の閾値維持（100/97/100/100 が baseline）
  3. `npm run lint` pass
  4. `npm run build` が通る（dist を生成したら**戻してからコミットする**）
- テストは実装と同時に書く。記述は日本語。
- 受け入れ条件は §5 のマトリクス（P1–P14 / S1–S8）を正とし、各タスクに ID を付す。
- **Phase 0 → 1 は並行可能**（依存が無い）。Phase 2 は Phase 0 に、Phase 3 は Phase 2 に、Phase 4 は Phase 0 に依存する。

### 0-2. 初稿計画からの差分

| | 初稿計画 | 本計画 |
|---|---|---|
| フェーズ数 | 6 | 5 |
| state core への変更 | **あり**（評価スタックのモジュール化・依存グラフの越境・名前解決の遡上） | **無し**。フィルタ 4 箇所の小修正だけ |
| 前提となる別設計 | クロス state 読み取り Phase 1–3 | **無し** |
| 新規パッケージ | `@wcstack/i18n` 確定 | **作らない**（D7 決定） |
| ベンチ回帰の必要 | あり（`jsfb-verify.mjs`） | **無し**（ホットパスに触らない） |
| SSR の追加課題 | 2 件（hydrate の遡上・`$refs` getter の raw 評価） | **0 件**。残るのはペイロード重複の裁定のみ |

**この計画で最も重いのは Phase 0（規約を決めること）であって、コードではない。**

### 0-3. コード確認で判明した訂正 — **設計書に反映済み**（2026-08-27）

計画を立てる前に設計書の前提を実装で確認し、2 件の訂正を設計書へ反映した（訂正 1 は [i18n-design.md](./i18n-design.md) §9-1-1 と D9・§8、訂正 2 は同 §4-1 と §12）。本節はその根拠の記録である。

#### 訂正 1（反映済み）: 未対応ロケールの redirect は router guard では書けない

設計書 §9-1 は当初「未対応ロケールの URL は guard で fallback ロケールへ redirect する」としていたが、**router の guard は redirect 先を動的に決められない**。

- redirect 先は `<wcs-route guard="/login">` の**属性値（静的）**で、`GuardCancel` の `fallbackPath` にはその値がそのまま渡る（[RouteCore.ts:364](../packages/router/src/core/RouteCore.ts#L364)、[showRouteContent.ts:37-40](../packages/router/src/showRouteContent.ts#L37)）
- guard ハンドラの戻り値は真偽値だけで、fallback パスを返す口が無い
- したがって `/xx/products` → `/en/products`（**残りのパスを保ったままロケールだけ差し替える**）は表現できない。`guard="/en"` と書けば `/en` に飛ぶだけで `products` が失われる

**解決**: redirect は **head の同期スクリプト（設計書 §8 の 4 番）が `location.replace()` で行う**。router は関与しない。

これは劣化ではなく**単純化**である。理由は 3 つ。

1. head スニペットは DOM 解析前に走るので、**無駄な描画とネットワークが一切発生しない**。guard による redirect は route 解決まで進んでから引き返す
2. アプリ内リンクは常に正しいロケールを含む（設計書 §9-1: 切替 UI はただのリンク）。不正なロケールが入ってくる経路は**外部リンク・直打ち・ブックマークだけ**で、これらはすべてフルロード ＝ head スニペットを通る
3. SPA 内ナビゲーションで不正ロケールに到達しうるのはアプリ側のバグであり、静的 fallback（`guard="/en"`）で受け止めれば十分な防御深度になる

**設計書 §8 の 4 番と §9-1 の役割分担を、この形に書き換える必要がある。**

#### 訂正 2（反映済み）: `Object.freeze` は「誤書き込み防止」ではなく訳漏れ診断の前提でもある

設計書 §4-1 は当初 `Object.freeze` の理由を「辞書は不変なので誤書き込みを即エラーに」だけとしていたが、**もう 1 つ効いている**。

実行時のパス存在検査は、**getter に当たった時点で `UNKNOWN` を返して打ち切る**（[pathDiagnostics.ts:161](../packages/state/src/pathDiagnostics.ts#L161) 付近、`typeof descriptor.get === "function"` の分岐）。辞書が素のデータ（value descriptor）である限り検査は最後まで進み、`missing` を確定できる。§12 が「追加実装ゼロで効く」と言えるのは**辞書に getter が 1 つも無いこと**が条件で、`Object.freeze` された plain object はそれを構造的に保証する。

**この因果を設計書 §4-1 と §12 に明記した。** 後から「ここに getter を 1 個足すだけ」で診断が静かに死ぬのを防ぐため。

### 0-4. 確認して設計どおりだった 3 件（変更不要）

- **`<wcs-state src="x.js">` は `await import(url)` の `module.default` を state にする**（[State.ts:242](../packages/state/src/components/State.ts#L242)、[loadFromScriptFile.ts](../packages/state/src/stateLoader/loadFromScriptFile.ts)）。設計書 §4-2 の `export default { lang, t }` はそのまま動く。**named export は無視される**ので `export { lang }` だけでは載らない点に注意
- **`<wcs-head>` の link 重複キーは `link:${rel}:${href}:${media}`**（[Head.ts:113-118](../packages/router/src/components/Head.ts#L113)）。`hreflang` が入っていないので `x-default` 併記の衝突は実在する。設計書 §9-2 のとおり
- **router のパラメータ型はユーザー拡張できない**。`RouteCore` が `Object.keys(builtinParamTypes).includes(...)` で検査し、外れたら `any` に落ちる（[RouteCore.ts:261](../packages/router/src/core/RouteCore.ts#L261)）。`enum` 型を足すには core の型定義（[types.ts:40](../packages/router/src/types.ts#L40)）ごと触ることになる。設計書 D9 の「当面は `slug` ＋ guard」は正しい

---

## Phase 0 — パターンの確立（新規コードゼロ）

**この Phase の成果物は動くデモと規約であって、ライブラリコードではない。** 設計書 §13 が「飛ばすな」と言っているのはここ。

### タスク

| ID | 内容 |
|---|---|
| **T0-1** | `examples/router-i18n/`（名称は提案）を作る。root `examples/` は cross-package 専用という規約に合致する（state + router + server）。`examples/shared/server.js` に載せ、`server.js` は自分のルートだけを宣言する薄いファイルにする |
| **T0-2** | ファイル配置とキー命名の規約を決める。原案: `/i18n/{lang}.js`（訳文のみ）・`/i18n/catalog.js`（正本・ロケール決定と deep merge）・`/i18n/format.js`（`Intl` インスタンス）・`/i18n/state.js`（`<wcs-state src>` 用の射影 3 行） |
| **T0-3** | head スニペットの原型を書く。責務は 4 つ（交渉 → `lang`/`dir` → `setConfig` → 不正ロケールの `location.replace`）。**訂正 1 により redirect もここに入る** |
| **T0-4** | deep merge ヘルパを examples 内に置いて実測する。置き場の最終決定は Phase 2（設計書 §14-4） |
| **T0-5** | 訳漏れ（`t.typo@i18n`）を 1 箇所わざと仕込み、`wcs/binding-path-missing` が実際に出ることを確認する |

### 検証項目（ここで設計の前提が崩れたら Phase 1 以降を作り直す）

| ID | 検証 | 崩れたときの影響 |
|---|---|---|
| **V0-1** | `<html lang>` → `catalog.js` 評価 → `<wcs-state src>` の**評価順序が実際に成立するか**。`<wcs-state>` の `_initialize` は upgrade 後に `await import()` するので、head スニペットが先行するはず | 崩れると設計書 §4-1 の根幹（`<html lang>` を読む）が破綻。辞書モジュールにロケールを外から注入する形へ再設計 |
| **V0-2** | autoloader 併用時に V0-1 が変わらないか。autoloader はタグ定義を import するだけで `lang` に触らないので影響しないはず | 同上 |
| **V0-3** | shadow DOM を持つコンポーネントから同じ `catalog.js` を import する形の使い勝手（設計書 §5） | 崩れるとクロス state 読み取りが再び前提に戻る ＝ 計画全体の作り直し |
| **V0-4** | 訳漏れ診断が実際に `missing` で出るか（`UNKNOWN` で打ち切られないか。0-3 訂正 2） | 崩れると §12 の静的検査が唯一の検出手段になり、Phase 4 の優先度が上がる |

### DoD

- デモが 2 言語（`ja` / `en`）で動く
- `/xx/products` がフルロードで `/en/products` に redirect される（**パスが保たれること**）
- 言語切替がただの `<a>` で成立している
- V0-1〜V0-4 の結果を本書に追記する
- **`examples/README.md` のポート表に追加**（規約）

### 結果（2026-08-27・完了）

`examples/router-i18n/` を実装し、Playwright で **20/20 green**。V0-1〜V0-4 は
すべて成立した（`<html lang>` → 辞書モジュール → `<wcs-state src>` の順序、
autoloader 非依存、shadow root からの同一実体 import、`missing` 診断の実発火）。

**設計が持ちこたえた。** 辞書＝ES モジュール、射影としての `<wcs-state src>`、
行ゲッターによる動的キー、ロード時 deep merge、`Intl` のモジュールスコープ生成は
どれも書いたとおりに動く。一方で**前提が 4 つ崩れた**（§Phase 0-結果-1〜4）。

#### 結果-1（実装バグ・修正済み）: `<wcs-state src>` の URL 解決基準が誤っていた

`loadFromScriptFile` は `import(url)` を素で呼んでいた。動的 `import` の相対解決は
**import を書いたモジュール**を基準にするので、`src` が `@wcstack/state` の所在から
解決されていた。同一オリジンに置けば偶然一致するが、**CDN 一発で読み込んだ瞬間に
`src="/app.js"` が CDN 側を指して 404 になる**。

- `src="*.json"` 側は `fetch` なので document 基準で正しく解決されていた ＝ **同じ属性が
  形式によって違う基準で解決されていた**
- [csp.md](./csp.md) は inline state の代替として `src="./state.js"` を推奨しており、
  **推奨されている回避策が推奨されているロード方法で動かない**状態だった
- 既存 examples に `<wcs-state src>` の利用が 1 件も無かったため、露出していなかった

修正は `new URL(url, document.baseURI)` の 1 行（[loadFromScriptFile.ts](../packages/state/src/stateLoader/loadFromScriptFile.ts)）。
**T1-0 として Phase 1 の先頭に繰り上げ済み**（本書 Phase 1）。

#### 結果-2（設計変更・反映要）: ロケールは `/:lang` ではなく **router の basename** に置く

D9 は `/:lang` を `slug` で受ける形だった。**これは言語切替を壊す。**

`<wcs-router>` は basename 配下の同一オリジンナビゲーションを**すべて** `intercept()`
に渡す（[Router.ts:222-243](../packages/router/src/components/Router.ts#L222)）。素の
`<a>` クリックも含む。したがって basename 内の言語リンクはクライアント側で処理され、
**リロードも辞書モジュールの再評価も起きない ＝ 言語が変わらないのに何も壊れて見えない**。

basename を `/{lang}` にすると解ける。`/en/` へのリンクは basename の外なので
intercept されず、ブラウザが本物のナビゲーションを行う。**「ただのリンクで切り替わる」
は basename のおかげで成立する。**

- basename は head スニペットが `<base href="/ja/">` を書いて渡す。属性を使うと
  「`<wcs-router>` がパース済みで、かつ upgrade 前」という狭い窓を狙うことになる
- 制約 1 つ: ページ上の URL をすべて絶対にすること
- 副産物: **ルートパターンからロケールが消える**（`/`・`/about`）。`enum` パラメータ型の
  議論も、ロケールセグメントの検証も要らなくなる
- D9 の「basename とは分離する」の根拠（1 デプロイ 1 言語になる）は、basename を
  **実行時に**決めるこの形には当たらない

#### 結果-3（設計補強）: 構造レンダリングは router の外

`<wcs-route>` の中に置いた `<template data-wcs="for:">` は描画されない。state が
バインドを組み立てる時点でルートのノードは inert な `<template>` の中にあるため。
**ルート内の素のバインドは動く**ので境界が見えにくい（About ページはその場で翻訳
されている）。既存の `examples/router-spa` が同じ分担を明示している。

i18n 固有の話ではないが、**多言語ページを書く人が最初に踏む**ので §9-2 あたりに
1 行あるとよい。

#### 結果-5（設計の穴・未解決）: CDN 一発のページからロケールを設定する手段が無い

§8 の 3 番「`setConfig({ locale })`」は、**公開 API では書けない**。

- `setConfig` は [config.ts](../packages/state/src/config.ts) に居るが `exports.ts` から export されていない。公開されているのは `getConfig` だけ
- 公開の入口は `bootstrapState({ locale })` ただ 1 つ。ところが **`@wcstack/state/auto` は `bootstrapState()` を引数なしで呼ぶ**（[auto.ts](../packages/state/src/auto.ts)）
- したがって CDN 一発（`<script src="https://esm.run/@wcstack/state/auto">`）で読み込んだページには**ロケールを渡す口が無く**、`locale` / `date` / `time` / `datetime` は `'en'` に固定される
- auto バンドルは SRI のため自己完結なので、別途 `@wcstack/state` を import して `bootstrapState` を呼んでも**別のモジュールインスタンス**になり効かない。名前付きエントリ 1 本に絞るしかない

これは **五つのルールの 1 番（CDN 一発）と D8 の不変条件が両立しない**ということで、i18n に限った不便ではない。

**推奨の解（Phase 1 で実装）**: `bootstrapState` が `locale` を明示されなかったとき **`document.documentElement.lang` を既定にする**。

- head スニペットは既に `<html lang>` を書いており（§8 の 2 番）、辞書モジュールもそこを読む。**ロケールの正本が 1 つになる**
- 不変条件が「`setConfig` を最初のバインドより前に呼ぶ」から「**`<html lang>` が state モジュールのロードより前に確定している**」へ変わる。後者は head の同期スクリプトで構造的に保証され、順序事故が起きようがない
- スニペットから `setConfig` を呼ぶ必要が消える ＝ §8 の 4 手順が 3 手順になる
- 既存ページへの影響: `<html lang>` は多くのページが持っており、`'en'` 以外を書いているページの `|date` 出力が変わりうる。**破壊的変更として扱い、minor bump とリリースノートが要る**

デモは暫定として名前付きエントリ経由で `bootstrapState({ locale })` を呼んでいる。この解が入ったら CDN 一行に戻す。

#### 結果-4（設計補強）: `Object.freeze` は deep でなければ意味がない

`Object.freeze` は浅い。ネストしたカタログ（`t.orders.status`）が書き換え可能なまま
残り、そこに誰かが getter を足せる ＝ §12 の診断がその枝ごと黙って死ぬ。**deep freeze
を規範にする**（デモの `mergeAndFreeze` がそのまま参照実装）。

---

## Phase 1 — フィルタの焼き込み修理と順序不変条件（`packages/state/`）

Phase 0 と**並行可能**。設計書 §10。

### タスク

| ID | 内容 |
|---|---|
| **T1-0** | **完了（2026-08-27）**。`<wcs-state src="*.js">` を document の base URL で解決する（Phase 0 の結果-1）。`resolveAgainstDocument` を切り出して単体テスト 4 本。state 2529 tests green / lint 0 / カバレッジ閾値維持 |
| **T1-1** | `locale` / `date` / `time` / `datetime` の 4 箇所で `const opt = options?.[0] ?? config.locale` を**返り値の関数の内側へ移す**（[builtinFilters.ts](../packages/state/src/filters/builtinFilters.ts) の 279 / 574 / 588 / 602 付近）。他の 42 フィルタは `config.locale` を読まないので対象外 |
| **T1-2** | テストを `__tests__/filters.builtinFilters.test.ts` に追加。**2 つの挙動を両方固定する**: (a) `setConfig` 後に構築したバインドは新ロケールを使う (b) 構築済みのバインドは再描画されない限り変わらない。**(b) を仕様としてテストに書く**のが重要で、書かないと将来「なぜ切り替わらないのか」を誰かがバグとして直そうとする |
| **T1-3** | 順序診断。最初のバインド構築後に `setConfig({locale})` でロケールが**変化した**ら `console.warn` する（1 回だけ）。実装は「最初のフィルタ構築時に `config.locale` を読んだ」フラグ 1 個で足りる |
| **T1-1b** | **`bootstrapState` の `locale` 既定を `document.documentElement.lang` にする**（Phase 0 の結果-5）。これが無いと CDN 一発のページはロケールを設定できない。破壊的変更なので minor bump とリリースノート |
| **T1-4** | `packages/state/README.md` / `README.ja.md` に `config.locale` の位置づけ（「このページのロケール」）と不変条件（**確定は最初のバインド構築より前**。T1-1b 後は「`<html lang>` が state のロードより前」）を明記 |

### T1-3 の裁定事項

診断 code の語彙は**コンソール → lint → IDE の三面で共有する**規約がある（[errorGuidance.ts](../packages/state/src/errorGuidance.ts) 冒頭）。しかしこれは**実行順序の問題で、静的に検出できるものが何も無い**ため lint 側に対応物が作れない。

- **案 A**: code 無しの `console.warn`（`[@wcstack/state]` プレフィクスのみ）
- **案 B**: `wcs/locale-set-after-binding` を新設し、三面共有規約に「runtime 専用 code」の例外を作る

**推奨は案 A。** 三面共有規約は「書き手が誤った瞬間に lint と IDE が同じ語彙で指せる」ことに価値があり、静的側が存在しない code を足すと規約が形骸化する。ただし規約の解釈に関わるので Phase 1 着手時に確定させる。

### DoD

- state の 4 ゲート green・カバレッジ閾値維持
- **既存ページへの影響ゼロ**（`|date` の既定挙動は不変。引数を強いる deprecate はしない — 設計書 §10 の棄却済み代替）

---

## Phase 2 — ロケール決定（head の同期スクリプト）

### 裁定の記録: 候補 A（パッケージを作らない）— **2026-08-27 決定**

| | 候補 A: パッケージを作らない | 候補 B: `@wcstack/i18n` |
|---|---|---|
| 実行タイミング | head の同期スクリプト ＝ **確実に間に合う** | カスタム要素は upgrade 後。**辞書モジュール評価より後になりうる**（V0-1） |
| redirect（訂正 1） | 描画前に `location.replace` | route 解決まで進んでから引き返す |
| 固有の Web API | **無い**（`Intl` と `navigator.languages` は関数呼び出しで、監視すべき状態を持たない） | 「1 タグ 1 プラットフォーム API」に合致しない |
| 運用コスト | 無し | パッケージ追加の定型追随（§7） |
| CDN 一発の導線 | 失う | 保てる |

**「1 タグ 1 プラットフォーム API」の原則に照らすと、ここに監視すべき状態は無い。** 候補 B を選ぶ理由があるとすれば CDN 一発の導線だけで、それは設計判断ではなく GTM 判断に属する（GTM が触ってよいのは説明順序とコピーであって、設計判断ではない）。

**候補 A で確定した。** 成果物はライブラリコードではなく、README（英日）とデモに載せるテンプレートである。

### タスク

| ID | 内容 |
|---|---|
| **T2-1** | `negotiate(supported, fallback)` の実装。`Intl.getCanonicalLocales` ＋ `Intl.NumberFormat.supportedLocalesOf` で lookup マッチング。`Intl.LocaleMatcher` は提案段階なので依存しない |
| **T2-2** | 決定順（D13）の実装: **URL > 明示選択(`localStorage`) > `navigator.languages` > fallback**。決定は起動時 1 回 |
| **T2-3** | `documentElement.lang` / `dir` の反映。`dir` は対応ロケール宣言（`ar:rtl` 相当）から取る（設計書 §14-1 は未決のまま） |
| **T2-4** | `setConfig({ locale })`（Phase 1 の不変条件を満たす位置） |
| **T2-5** | 不正・未対応ロケールの `location.replace`（訂正 1） |
| **T2-6** | SSR ページでは**サーバーが書いた `<html lang>` を上書きしない**分岐（設計書 §8-1） |
| **T2-7** | スニペットを README（英/日）とデモのテンプレートとして配る |

### DoD

- `negotiate` の表駆動テスト（`navigator.languages` の組み合わせ × 対応一覧 × fallback）
- デモで D13 の 4 入力の優先順が観測できる
- **テストの置き場を決める**（`examples/` にはテスト基盤が無い）。`packages/state/__tests__/` に間借りするのが第一候補。**これが D7 決定の唯一の弱点**なので、T2-7 で先送りにせず Phase 2 の着手時に決める（設計書 §14-2）

---

## Phase 3 — router / SSR / `hreflang`（`packages/router/`, `packages/server/`）

Phase 2 に依存。

| ID | 内容 |
|---|---|
| **T3-1** | `/:lang/...` を `slug` で受ける形をデモと README で確立（0-4: `enum` 型は追加しない） |
| **T3-2** | 切替リンクのヘルパ — 現在パスのロケールセグメントだけを差し替える関数。**router から export するか README のスニペットに留めるかを決める**。3 行なので後者が有力 |
| **T3-3** | `<wcs-head>` の link 重複キーに `hreflang` を含める（[Head.ts:113-118](../packages/router/src/components/Head.ts#L113) の 1 行）。**キー変更は既存の重複判定の挙動を変えるので回帰テスト必須**。`x-default` と代表ロケールが同一 href のとき両方生き残ることを固定する |
| **T3-4** | guard は**静的 fallback による防御深度**としてのみ位置づける（訂正 1）。デモで `guard="/en"` を張るかは任意 |
| **T3-5** | SSR: サーバーが URL の `:lang`（無ければ `Accept-Language`）から実効ロケールを決め `<html lang>` に書く経路を `examples/ssr` に反映 |

### DoD

- router の 4 ゲート green
- e2e: 言語切替リンクで遷移して訳文と `<html lang>` が変わる
- e2e: SSR ページでハイドレーション前後の訳文が一致する（ちらつきが無い）

---

## Phase 4 — 静的検査（`packages/lint/`, `packages/vscode-wcs/`）

Phase 0 に依存（規約が決まっていないと辿れない）。設計書 §12。

| ID | 内容 |
|---|---|
| **T4-1** | `@i18n` を参照するバインドのパスを、辞書モジュールのキー集合と突合する。`<wcs-state src>` から `import` を辿る必要がある |
| **T4-2** | **言語間でキー集合が一致しているか**。fallback の deep merge で埋まる訳漏れは実行時に見えないので、**ここが唯一の検出点** |
| **T4-3** | 契約テストを**両側に置く**（罠）。挙動の正本は `packages/vscode-wcs` だが、lint 側にしかテストが無いと壊れるのが次のビルド時になり CI マトリクスに乗らない。過去に同型の事故が 2 回ある |

### DoD

- 両パッケージ green
- T4-1 が `import` を辿れない構成（動的 URL 等）では**静かに諦めず「解析不能」を報告する**こと

---

## 5. 受け入れ条件マトリクス

| ID | 条件 | Phase |
|---|---|---|
| **P1** | `<html lang>` が head スニペットにより DOM 解析前に確定する | 0 |
| **P2** | 辞書モジュールが `<html lang>` を読んで 1 言語ぶんを export する | 0 |
| **P3** | `<wcs-state name="i18n" src>` が辞書を射影し、`text: t.x@i18n` が描画される | 0 |
| **P4** | shadow DOM を持つコンポーネントが同じ `catalog.js` を import して同一実体を得る | 0 |
| **P5** | 行 getter が import した辞書で動的キーを解決する（`items.*.statusLabel`） | 0 |
| **P6** | 訳漏れが `wcs/binding-path-missing` で報告される | 0 |
| **P7** | `/xx/products` がフルロードで `/en/products` に redirect される（パス保持） | 0 |
| **P8** | `setConfig` 後に構築されたバインドが新ロケールで書式化する | 1 |
| **P9** | 構築済みバインドは再描画されない限り旧ロケールのまま（**仕様として固定**） | 1 |
| **P10** | 最初のバインド構築後のロケール変更が warn される | 1 |
| **P11** | 決定順 URL > storage > navigator > fallback が観測できる | 2 |
| **P12** | SSR のサーバー決定ロケールをクライアントが上書きしない | 2/3 |
| **P13** | `x-default` と代表ロケールの `hreflang` が両方 head に残る | 3 |
| **P14** | 言語間キー集合の不一致が lint と IDE の両方で報告される | 4 |
| **S1** | 対応ロケール 0 件の宣言 → fallback に落ちる | 2 |
| **S2** | `navigator.languages` が空 / 未対応のみ → fallback | 2 |
| **S3** | 辞書ロード失敗（404）→ loud に失敗する（空辞書で描画しない） | 0 |
| **S4** | fallback にしか無いキー → fallback の訳文が出る（deep merge） | 0 |
| **S5** | どの言語にも無いキー → 空描画 ＋ warn | 0 |
| **S6** | 辞書への書き込み → `Object.freeze` により throw | 0 |
| **S7** | `|date` に明示引数がある場合 `config.locale` を無視する（既存挙動） | 1 |
| **S8** | `import` を辿れない辞書構成 → 「解析不能」を報告 | 4 |

---

## 6. リスク

| リスク | 影響 | 緩和 |
|---|---|---|
| **V0-1（評価順序）が成立しない** | 設計の根幹が破綻。Phase 1 以降を作り直し | **Phase 0 で最初に確認する**。他のタスクより先 |
| V0-3（shadow DOM からの import）の使い勝手が悪い | クロス state 読み取りが前提に戻る ＝ 計画全体の作り直し | Phase 0 でコンポーネントを 1 つ実際に書く |
| `Head.ts` のキー変更が既存の重複判定を壊す | router の回帰 | T3-3 に回帰テストを必須で紐付け |
| 候補 A のテスト置き場が無い（Phase 2 DoD） | スニペットが無検証のまま配られる | T2-7 で判断。最悪 `packages/state/__tests__/` に間借り |
| 辞書の正本を `.js` にしたが翻訳者は JSON を触りたい | 配布形式の反転（設計書 §14-5） | Phase 0 で `.json` を正本にして `catalog.js` が読む形も試す |

**この計画には性能リスクが無い。** 初稿計画で最大の懸念だった評価スタックのモジュール化（クロス state 読み取り §8）が前提から外れたため、ベンチ回帰の必要も無い。

---

## 7. 追随チェックリスト

- **`examples/README.md`** のポート表に新デモを追加（Phase 0）
- **`packages/state/README.md` / `README.ja.md`** に `config.locale` の位置づけと不変条件（Phase 1）
- **`packages/router/README.md` / `README.ja.md`** に `/:lang` パターンと切替リンク（Phase 3）
- **`docs/README.md`** の翻訳状況表は**触らない**（本書と設計書は日本語 `.md` の内部設計ノートで、翻訳はオンデマンド）
- **`wcstack-app` スキル**（別リポジトリ `wcstack/wcstack-skill`）— `data-wcs` 構文もプロトコルも変えないので**追随不要**。Phase 3 で router の推奨パターンが増えるだけなら任意
- **パッケージ追加の定型追随は発生しない**（D7 で候補 A に確定したため）。もし将来この決定を翻すなら、パッケージ個数の記載 8 箇所（正しい数は現状 44 / npm 45）・バージョン整列・`src/auto.ts` が `./exports` 以外を import しないこと（SRI が黙って死ぬ）・SRI ドキュメント・README 英日が必要になる

---

## 8. 未解決（設計書 §14 のうち、計画に影響するもの）

1. **head スニペットのテスト置き場**（§Phase 2 DoD / 設計書 §14-2）— Phase 2 着手時に確定
2. **T1-3 の診断 code**（案 A / 案 B）— Phase 1 着手時に確定
3. **deep merge ヘルパの置き場**（設計書 §14-4）— Phase 0 の実測後、Phase 2 で確定
4. **SSR ペイロードの辞書重複**（設計書 §14-3）— Phase 3 で計測してから判断。先回りして最適化しない
5. **辞書の配布形式**（設計書 §14-5）— Phase 0 で両方試す

**D7（実装形）は 2026-08-27 に確定したのでこの一覧から外した。** 着手を止めている裁定は残っていない。
