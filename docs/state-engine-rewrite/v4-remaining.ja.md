# state エンジン再設計 — v4.0 までの残り

作成 2026-09-26。対象は `research/state-engine` の `faddc735`（main `a796d712` = 3.3.0 から 14 コミット、未 push）。

## 0. 前提

- 4.0 について文書で決まっているのは、3.2 で改名した旧名（エイリアス）を外すことだけ（要件 D4・B12。[state-3x-naming.ja.md](../state-3x-naming.ja.md)、CHANGELOG 3.2.0）。
- 新エンジン（`packages/state-next`）は「4.0 相当の範囲」で作った（[scope-classification.ja.md](./scope-classification.ja.md) §4.1）。これまでの記録は「state-next が現行を置き換える」ことを前提にしている（[addons-plan.ja.md](./addons-plan.ja.md) §6）。
- `docs/state-next-major-*.md` の「次期メジャー」は、2.5.1 の時点で書かれた 3.0 のこと。3.0〜3.3 は出荷済みで、4.0 の計画書ではない。
- GitHub にマイルストーンと開いている PR は無い。
- この文書は、置き換えに要るものを実物で確かめて拾った一覧。決定ではない。§1 の判断が §2〜§5 の前提になる。

**新エンジンの現状**（詳しくは [addons-plan.ja.md](./addons-plan.ja.md) §6）
- コアと後付け 8 つ（formats・diagnostics・temporal・list-keys・scopes・recursion・ssr・devtools）を実装済み。
- テスト 839 件（通過 838・スキップ 1）。リポジトリの e2e は 131/131。
- core 19,000B gzip（上限 20,000B）、全部入りの `auto` 38.7KB（3.3.0 は 80.9KB）。
- 公式 js-framework-benchmark の CPU 加重幾何平均は 1.08〜1.11（signals 1.21〜1.25、3.3.0 1.51）。

## 1. 決めてほしいこと

| # | 論点 | 選択肢 | 根拠・状況 |
|---|---|---|---|
| R1 | 置き換えの形 | (a) `packages/state` の中身を state-next に差し替え、`@wcstack/state` 4.0 として出す (b) 別の名前のパッケージのまま出す | **決定（2026-09-26）: (a)**。ブランチを main に入れる手順は残り |
| R2 | 4.0 の公開 API の範囲 | 現行の公開物を、残す・落とす・後付けへ、のどれにするか | **済み（2026-09-26）**: 3.3 の公開面にそろえた（§2.3、§8）。内部の部品は公開しない |
| R3 | 3.x の最後の minor | (a) 3.4 を出して、旧名にランタイムの警告を出す (b) 約束を取り下げる | CHANGELOG 3.2.0 で「ランタイムの警告は 3.x の最後の minor でだけ出す」と約束した。3.3.0 では入っていない。lint と VS Code 拡張の通知（`wcs/name-alias`）は 3.2 からある |
| R4 | `substr` | 残す・外す・改名する | [state-3x-naming.ja.md](../state-3x-naming.ja.md) V10 で「4.0 で考える」とした。state-next では formats の後付けにある |
| R5 | 現行の未解決 Issue | 3.x で直す、または 4.0 で解決として閉じる | #258・#319〜#324 は state-next で起きない（#258 の行の中のコンポーネントは `faddc735` で直した）。**#2 は state-next で未確認** |
| R6 | 後回しにした機能 | 4.0 に入れる、または 4.0 の後 | コンポーネントの mount の「エクスポートした getter」と `#ro`（[addons-plan.ja.md](./addons-plan.ja.md) 後付け 3） |

## 2. エンジン（state-next）の残り

### 2.1 旧名の受け口を外す

- `src/engine.ts` の `$untrackDependency`（407 行）と `$trackDependency`（416 行）を、まだ受け付けている。4.0 で外す約束とも、「エイリアスを持ち込まない」決定（scope-classification §4.1）とも食い違う。
- 外すと、ベンチページ `packages/state/__e2e__/benchmark/index.html` の getter（`$untrackDependency`）が動かなくなる。`$untracked` に直す。
- このページの getter を文字列置換して変種を作るスクリプトも、同じコミットで直す（ページのコメントの注意書き）。
  - `scripts/audit-state-browser.mjs`、`scripts/audit-state-tech-{allocsample,counters,heap,heapsnapshot,keyed,profile,warmth}.mjs`、`scripts/research/keyedPrototypePatch.mjs`、`packages/state-next/bench/select10k.mjs`。
- 外した旧名の扱いがそろっていない（2026-09-26 に確かめた）。
  - `$streams`: 宣言すると `[wcs/declaration-alias] $streams was removed: write $stream.` で失敗する。
  - `$updatedCallback`: 宣言しても呼ばれず、警告も出ない（診断の後付けを入れていても）。3.x から移る利用者が黙って失う。`$streams` と同じく、宣言したら失敗させる。
  - 旧フィルタ名（`uc`・`fix` など）: `[wcs/filter-unknown]` で失敗する（did-you-mean は診断の後付けが付ける）。旧名から正式名を案内するかを決める。

### 2.2 配布物の形

| 項目 | 現行 3.3.0 | state-next |
|---|---|---|
| 型定義（`.d.ts`） | `dist/index.d.ts`、`split/*.d.ts` など | **済み**（同じ 13 ファイル。rollup-plugin-dts） |
| `package.json` の `exports` | `.`・`./auto`・`./core`・`./features/*`・`./define`・`./manifest`・`./parser`・`./wcs-manifest.json` | **済み**（同じ表と同じファイルの配置。名前と版は置き換えのときに変える） |
| `.` の入口 | `dist/index.esm.js`（最小化、要件 N1） | **済み**（`bootstrapState()` がすべての後付けを入れる） |
| `/parser`・`/manifest` | ある | **済み**（結果の形と誤りの文面が 3.3 と同じ） |
| ESLint | `npm run lint` | スクリプトも設定も無い |
| カバレッジ | `npm run test:coverage`（基準は CLAUDE.md の 100/97/100/100） | 未設定・未計測 |

- `/parser` と `/manifest` は、vscode-wcs が import している（`@wcstack/state/parser` 4 か所、`/manifest` 2 か所）。lint（vscode-wcs のビルド経由）と `@wcstack/typescript` も、ビルド時に `dist/parser.esm.js` と `dist/manifest.esm.js` を取り込む（`.github/workflows/release.yml` の注記）。
- manifest の旧名の表: `filterAliases`・`declarationAliases` は空にした（ランタイムが受け付けないため）。`apiAliases` は、engine がまだ受け付けているので残した（§2.1 で外すときに空にする）。

### 2.3 公開 API の差（R2 の材料）

**済み（2026-09-26）**。入口ごとの export（値と型）が 3.3 と同じことを `__tests__/public-surface.test.ts` が確かめる（3.3 側はコミット済みの配布物の `.d.ts`）。詳細は §8。

意図して残した差（移行ガイドに書く）:
- `IStateElement` の `listPaths`・`getterPaths`・`setterPaths`・`nextVersion` は無い（2026-09-26 の決定。要るなら DevTools の後付けで出す）。
- `Ssr`（`<wcs-ssr>`）: `hydrateProps` は常に空（値の表は承認済みの削除）。3.3 の内部の静的メソッド（`extractStateData`・`buildContent` など、`ISsrElement` に無いもの）は無い。
- パース結果の `uuid` は無い（新エンジンは構造の束縛に id を使わない）。
- `$listKeys` は後付け `features/list-keys` に移った（3.3 は core に持っていた）。`.` と `/auto` は入れるので、`/core` だけのページで使うときだけ install が要る。
- 分割ビルドの `chunks/` のファイル名にハッシュが付く（3.3 は名前だけ。esbuild では名前だけだと衝突する）。
- 設定の `commentTextPrefix` と `enablePropagationContext` は受け取るが効果が無い（`{{ }}` をコメントにしない、echo は構造で止める）。
- `installFeatures` は同じ名前の後付けを 2 回目から飛ばす（3.3 は毎回 `install()` を呼ぶ。どちらも冪等なので結果は同じ）。
- `.` は型 `IStateElement` を足した（README の表を型にしたもの）。

### 2.4 その他

- #2（リスト要素 getter の隣接項目問題）を state-next で確かめる（R5）。
- エラー番号の一覧を、利用者が引ける場所に置く（README か docs）。番号と文面の正本は `src/diagnostics/messages.ts`。

## 3. 周辺パッケージと道具

| 対象 | やること |
|---|---|
| vscode-wcs・lint（`wcs-validate`） | 新しいパーサと manifest に切り替える。`wcs/name-alias`（今は「3.x の間は動き、4.0 で外れる」）を「4.0 で外れた」エラーにする。state-next の新しいコード（`feature-not-installed`・`declaration-alias`・recursion 系など）を共有の語彙にそろえる。`#番号` のメッセージを解読させるかを決める。テストを流し直し、版を上げる |
| `@wcstack/typescript` | 前置きの型から旧名（`$trackDependency`・`$untrackDependency` など）を外す。`WcsThis` などの型の出所を R2 に合わせる |
| `@wcstack/testing` | `file:../state` で state を使う。state-next でテストを流す（`createStateAsync` は足し済み） |
| `@wcstack/server` | 依存 `^3.3.0` を `^4` へ。SSR の出力は 3.3 と互換が無い（版の検査でクライアント描画に倒れる）ので、移行ガイドに書く。server 自身の変更は不要（後付け 5 で確認） |
| `wcstack`（入口パッケージ） | state の `/auto` を取り込むので、新しい auto で作り直し、サイズを記録する |
| `@wcstack/devtools` | プロトコル v2 のままで、改修は不要（後付け 6 で確認）。型のずれを見るテスト（`packages/devtools/__tests__/protocol.typesDrift.test.ts`）が `packages/state/src/devtools/types.ts` を読むので、参照先を直す |
| wcstack-skill（別リポジトリ） | `$scan` の削除、旧名の削除、イベントの委譲（バブリングするイベントの `currentTarget` がルート）、エラーの番号などを反映し、プラグインの版を上げる |

## 4. ビルド・CI・サイズ・計測

- サイズの検査（`scripts/check-state-size.mjs`・`scripts/check-state-split.mjs`）と基準値（`scripts/state-size-baseline.json`・`scripts/state-split-baseline.json`）を、新しい出力の形に合わせて作り直す。
- `release.yml` と `ci.yml` のビルド手順を合わせる。state-next は `tsc`＋Rollup ではなく esbuild（`build.mjs`、短縮名の表 `mangle.mjs`）。state を最初にビルドする順序（lint と typescript が取り込むため）は変わらない。
- 4.0 の成果物で、性能とサイズを記録し直す（公式 js-framework-benchmark、DOM 直接との比、`bench/run-all.sh`）。

## 5. 文書

| 文書 | やること |
|---|---|
| `packages/state/README.md`・`README.ja.md` | 新エンジンの規範文書として書き直す。変わった約束: `$scan` の削除、旧名の削除、イベントの委譲、要素への書き込みの位置モデル、無いキーへの書き込み、再セットで無いパスは空、エラーの番号、後付けの入口と「状態を定義する前に install する」 |
| 移行ガイド（`docs/migration-v4.md`・`.ja.md`） | 新しく作る。承認済みの簡素化（volume の注入、volume に書いた `$watch` などがエラー、SSR のインライン snapshot と値の表、`listPaths` などを core に入れない、私有データは要素ごと）と、3.3.0 の不具合を直した差（#319〜#324 など）を並べる |
| `CHANGELOG.md` | 4.0.0 の項 |
| [timing-and-firing-contract.ja.md](../timing-and-firing-contract.ja.md)（英語版も） | §3 の見出しの `$streams`、§4.3 の機構の順序（`$scan` → `$watch` → `$streams` restart、`$updatedCallback`）を 4.0 に直す。新エンジンの順序は `$renderedCallback` → `$watch` → stream の再開。§4.3 の「arbiter がある間は順序が反転する」が新エンジンでも成り立つかを確かめる |
| `CLAUDE.md` | State の構成の説明（`proxy/`・`binding/`・`structural/` など 3.x の構成）と、サイズの検査の記述を直す |

## 6. リリース

- 全パッケージを 4.0.0 にそろえる（版をそろえる方針）。vscode-wcs は別の版。
- ブランチを push し、PR とレビューを経て main に入れる。

## 7. 進め方の案

1. §1 の R1 と R2 を決める（配布の形と公開範囲が §2.2・§2.3・§3 の前提）。
2. §2（旧名の受け口、配布物の形、型定義、`/parser`・`/manifest`、ESLint とカバレッジ）。
3. §3 の周辺パッケージを、state-next の入口に向けて流し直す。
4. §4 のビルドと CI、§5 の文書。
5. R3（3.4 を出すか）は、4.0 の時期とは独立に決められる。

## 8. 記録

### 公開面を 3.3 にそろえた（2026-09-26）

R1（state-next で `@wcstack/state` を置き換える）の決定を受けて、3.3 の公開面との差を埋めた。

**入口と配布物**
- `package.json` の `exports`・`main`・`module`・`types` を 3.3 と同じにした。ファイルの配置も同じ（`dist/index.esm.js`・`dist/auto.min.js`・`dist/split/core.js`・`dist/split/features/*.js`・`dist/define.js`・`dist/manifest.esm.js`・`dist/parser.esm.js`・`dist/wcs-manifest.json`）。名前と版は、置き換えのときに変える。
- `.`（`src/exports.ts`）: `bootstrapState()` がすべての後付けを入れてから `<wcs-state>` を登録する（3.3 と同じ）。後付けの一覧は `src/features/all.ts`（`auto` も使う）。
- `/core`（`src/core.ts`）・`/features/*`: 3.3 と同じ export。後付けは 3.3 の 7 つに `list-keys` を足した 8 つ。
- 型定義: `build.mjs` が rollup-plugin-dts で 13 の `.d.ts` を書く。README の書き方（`defineState`・`document.querySelector("wcs-state")`・分割の入口・`/parser`・`/manifest`）を、配布物の `.d.ts` に対して `skipLibCheck: false` で型検査して通ることを確かめた。
- 道具の入口（`/define`・`/manifest`・`/parser`）は、内部名を短縮せずにビルドする。外から名前で読まれるため（パース結果の `statePathName` など）。

**足した公開物**
- `getConfig()` と設定のキー 10（`tagNames.ssr`、コメントの接頭辞 5 つ、`enableDirectionalInitialSync`・`enablePropagationContext`・`enableContractAnalyzer`・`sameValueGuard`）。既定値は 3.3 と同じ。
  - `sameValueGuard: false`: 同じ値のプリミティブの書き込みも通し、`$watch` の `prev` は undefined。
  - `enableDirectionalInitialSync: false`: すべてのメンバーで状態が初期同期に勝ち、出力専用の扱いもしない。`#init=`・`#sync=` は `init=/sync= modifiers require enableDirectionalInitialSync.`（メッセージ番号 #31）で投げる。
  - コメントの接頭辞は、`for` と `if` / `elseif` / `else` の連鎖のアンカーの文字になる。SSR の後付けは 3 つの接頭辞を連鎖のアンカーとして読む。
  - `tagNames.ssr` は SSR の後付けが使う。
  - `commentTextPrefix`・`enablePropagationContext` は受け取るが効果は無い（§2.3）。
- `bootstrapState(config, registry)`: 渡した登録簿に `<wcs-state>` と後付けのタグ（`<wcs-ssr>`）を定義する。後から install した後付けも、定義済みの登録簿に追いつく（core の受け口 `tags`）。登録簿は `WeakRef` で持つ（サーバは描画ごとに登録簿を作るため。3.3 と同じ理由）。
- `defineState` と型（`WcsThis`・`WcsPaths`・`WcsPathValue`・`WcsStateApi`）。3.3 から写し、4.0 で外す旧名（`$trackDependency`・`$untrackDependency`）は型から外した。
- 型 `IWritableConfig`・`IWritableTagNames`・`IBindingErrorInfo`・`IStateFeature`・`IWcsTrustedTypesPolicy`、`HTMLElementTagNameMap` の補強（`wcs-state` は `IStateElement`、`wcs-ssr` は `Ssr`）。
- `buildBindings(root)`: 根の束ねを待つ（新エンジンは `<wcs-state>` が状態を読み込んだときに束ねるので、`getBindingsReady` と同じ）。
- `VERSION`（`package.json` の版）、`TRUSTED_TYPES_POLICY_SLOT`。
- `Ssr`（`<wcs-ssr>` の要素クラス）と `ISsrElement`: `version`・`stateData`・`templates`・`getTemplate`・`verifyVersion`・`hydrateProps`（常に空）・`Ssr.find(root)`。SSR の後付けが定義する。
- manifest（`getWcsManifest`・`WCS_MANIFEST_VERSION`・`builtinFilterMeta`・`builtinFilterAliases` ほか）と `dist/wcs-manifest.json`。
- `analyzeContract()`（`enableContractAnalyzer` で有効。DevTools が付いていればそこへも流す）。
- `/parser`: 3.3 と同じ export。パース結果に `statePathInfo`（`getPathInfo`）を付ける。`clearParserCaches()` はパスの intern とフィルタのパース結果を捨てる。

**直したこと**
- `$errorCallback` の `info.bindingType`・console・DevTools に出す束縛の種類を、3.3 と同じパーサの分類に戻した（`class.`・`attr.`・`style.`・`command.`・HTML は `prop`、`eventToken.` は `event`）。これまでは細かい種類（`class` など）を出していた。
- パーサの誤りの文面を、3.3 と同じにした（14 種類の文面。確かめた 25 通りの入力のうち 18 通りが違っていた）。段 8 で助言を診断の後付けへ移したときに、文面の一部（「— write "for:"」など）が落ちたり別の文になったりしていた。文面と助言はどちらも診断の後付けにあるので、文を 3.3 のとおりに書き、重なる助言を外した。`@name` 選択子の誤りは 3.3 と同じくコード無しにした（番号 #118 → #32）。パスの長さの上限の誤りには lint への誘導を付けない（3.3 と同じ）。
- `/parser` の入口は、自分のバンドルの中で文面と助言を有効にする。道具（VS Code 拡張）が 3.3 と同じ文面を表示できる。

**確かめたこと**
- `__tests__/public-surface.test.ts`（19 件）: 入口ごとの export（名前と値／型の別）が 3.3 のコミット済みの `.d.ts` と一致（足した `IStateElement` と `features/list-keys` を除く）、`package.json` の `exports` が一致、manifest が一致（旧名の表と `$scan` を除く）、フィルタのメタデータの引数の数が実装と一致、パース結果（`statePathInfo` を含む）・`splitBindTexts`・`getPathInfo`・誤りの文面 25 通りが 3.3 のパーサと一致。
- `__tests__/public-api.test.ts`（13 件）: `.` の `bootstrapState` が後付けを入れる、登録簿の引数、設定の既定値と 4 つの切り替え、`<wcs-ssr>` の読み出しと `tagNames.ssr` での SSR、`buildBindings`、`VERSION`、`analyzeContract`、`bindingType`。
- テスト 871 件（通過 870・スキップ 1）。e2e 131/131（SSR の e2e のプロキシを `dist/split/` に合わせた）。
- 性能（全部入りの `auto`、直前のコミット `706a61dc` と同じ回で交互に 4 周・各 24 サンプル、順序を入れ替えて 2 回、`research/state-engine/addons/surface-targets-ab{,2}/`）: ウォーム 1,000 行 5.50ms 対 5.70ms、コールド 10,000 行 68.30ms 対 71.65ms（各 48 サンプル）。後退は無い。

**サイズ（gzip）**

| 入口 | 3.3.0 | 4.0（state-next） |
|---|---:|---:|
| `.`（`index.esm.js`） | 83,423B | 42,539B |
| `/auto` | 80,860B | 39,819B |
| `/parser` | 16,128B | 8,697B |
| `/manifest` | 14,059B | 6,366B |
| core だけ（サイズ目標の計測、`core.min.js`） | — | 19,305B（上限 20,000B まで 695B） |

- core は 19,000 → 19,305B（+305B）。設定のキー、`sameValueGuard` と初期同期の opt-out、アンカーの接頭辞、登録簿の扱いの分。
