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
- テスト 1,302 件（通過 1,301・スキップ 1）。リポジトリの e2e は 131/131（2026-09-27）。
- core 18,534B gzip（上限 20,000B）、全部入りの `auto` 38,635B（3.3.0 は 80.9KB）。2026-09-27 から terser を後段に通す（§8）。
- 公式 js-framework-benchmark の CPU 加重幾何平均は 1.08〜1.11（signals 1.21〜1.25、3.3.0 1.51）。

## 1. 決めてほしいこと

| # | 論点 | 選択肢 | 根拠・状況 |
|---|---|---|---|
| R1 | 置き換えの形 | (a) `packages/state` の中身を state-next に差し替え、`@wcstack/state` 4.0 として出す (b) 別の名前のパッケージのまま出す | **決定（2026-09-26）: (a)**。ブランチを main に入れる手順は残り |
| R2 | 4.0 の公開 API の範囲 | 現行の公開物を、残す・落とす・後付けへ、のどれにするか | **済み（2026-09-26）**: 3.3 の公開面にそろえた（§2.3、§8）。内部の部品は公開しない |
| R3 | 3.x の最後の minor | (a) 3.4 を出して、旧名にランタイムの警告を出す (b) 約束を取り下げる | CHANGELOG 3.2.0 で「ランタイムの警告は 3.x の最後の minor でだけ出す」と約束した。3.3.0 では入っていない。lint と VS Code 拡張の通知（`wcs/name-alias`）は 3.2 からある |
| R4 | `substr` | 残す・外す・改名する | **決定（2026-09-27）: 外して `slice` に一本化する**。state-next から外した（§8）。[state-3x-naming.ja.md](../state-3x-naming.ja.md) V10 で「4.0 で考える」としていたもの |
| R5 | 現行の未解決 Issue | 3.x で直す、または 4.0 で解決として閉じる | #2・#258・#319〜#324 は、どれも state-next で起きない（#258 の行の中のコンポーネントは `faddc735` で直した。#2 は 2026-09-27 に確かめた、§8）。#330〜#338（2026-09-26 登録）は #332 だけが state-next でも起きていた（§2.5 の F17 として直した、§8） |
| R6 | 後回しにした機能 | 4.0 に入れる、または 4.0 の後 | **済み（2026-09-27）**: コンポーネントの mount の `#ro` と「エクスポートした getter」を入れた（§8） |

## 2. エンジン（state-next）の残り

### 2.1 旧名の受け口を外す

**済み（2026-09-27）**。詳細は §8。
- engine は `$trackDependency`・`$untrackDependency` を受け付けない。読むと `[wcs/name-alias]`（#1701）で、正式名を示して投げる。
- 宣言キーの `$streams`・`$updatedCallback` は、core が `[wcs/declaration-alias]`（#1601）で、正式名を示して投げる（これまで `$updatedCallback` は黙って無視され、`$streams` は temporal の後付けが入っているときだけ失敗した）。
- manifest の旧名の表は 3 つとも空。
- ベンチページのフィクスチャ（`packages/state/__e2e__/benchmark/index.html`）の getter を `$untracked` にし、それを文字列置換する計測スクリプト 9 本の目印を同じコミットでそろえた。
- 残り: 旧フィルタ名（`uc`・`fix` など）は `[wcs/filter-unknown]` で失敗する（did-you-mean は診断の後付け）。旧名から正式名を案内するかは決めていない。

### 2.2 配布物の形

| 項目 | 現行 3.3.0 | state-next |
|---|---|---|
| 型定義（`.d.ts`） | `dist/index.d.ts`、`split/*.d.ts` など | **済み**（同じ 13 ファイル。rollup-plugin-dts） |
| `package.json` の `exports` | `.`・`./auto`・`./core`・`./features/*`・`./define`・`./manifest`・`./parser`・`./wcs-manifest.json` | **済み**（同じ表と同じファイルの配置。名前と版は置き換えのときに変える） |
| `.` の入口 | `dist/index.esm.js`（最小化、要件 N1） | **済み**（`bootstrapState()` がすべての後付けを入れる） |
| `/parser`・`/manifest` | ある | **済み**（結果の形と誤りの文面が 3.3 と同じ） |
| ESLint | `npm run lint` | **済み**（共通のひな形から生成。`sync-package-configs.mjs` に state-next の Rollup の例外を登録） |
| カバレッジ | `npm run test:coverage`（3.3 の基準 statements 99.5・branches 98.5・functions 100・lines 99.5） | **済み**（同じ基準。99.75・99.11・100・99.95、2026-09-27 の不具合の修正の後） |

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

- ~~#2（リスト要素 getter の隣接項目問題）を state-next で確かめる（R5）~~ 済み（§8）。
- エラー番号の一覧を、利用者が引ける場所に置く（README か docs）。番号と文面の正本は `src/diagnostics/messages.ts`。

### 2.5 カバレッジの作業で見つかった不具合（2026-09-27）

テストを足す途中で見つかったもの。**すべて直した**（2026-09-27、§8。再現のテストは `__tests__/fixes.test.ts`・`fixes-late-install.test.ts`・`fixes-diagnostics.test.ts`）。

| # | 場所 | 内容 | 重さ | 状態 |
|---|---|---|---|---|
| F1 | `engine.ts` `resolve` | 行の中で、別のリストのワイルドカードのパス（`a.*` の行で `this["b.*.y"]`）が、今いる行（`a` の行）に解決される。読みは違う値を返し、書きは `a` のデータを壊す。3.3 は `ListIndex not found` で投げる | 高 | 済み |
| F2 | `scopes/component.ts` `wire()` | `made`（`patterns.all()` のイテレータ）を 2 回回すので 2 回目が空。マウントした入れ子のパスの下の getter（`info.sub.upper`）が `UNDEFINED` になる | 高 | 済み |
| F3 | `engine.ts` `rekeyEqIndex` | `$eqIndex(path, level)` の level が 1 でないとき、また入れ子の行の getter の中の `$eqIndex` が、書き込みで評価し直されない（`spike: root lists only` のまま） | 中 | 済み |
| F4 | `engine.ts` drain の打ち切り（32 回） | 打ち切りのあと、getter のキャッシュが DIRTY のまま残り、以後の書き込みがその getter の束縛と上の `for` に届かない（読めば直る） | 中 | 済み |
| F5 | `scopes/component.ts` `crossed()` | 1 つのコンポーネントで重なる 2 つの対応（`state.addr` と `state.city`）の一方に書くと、もう一方が古い値のまま | 中 | 済み |
| F6 | `element.ts` | 中身が空の JSON の `<script>` で初期化に失敗する（3.3 は `{}`） | 中 | 済み |
| F7 | `dom/wc.ts`・`plan.ts` | `#init=`・`#sync=` の検査が無い。出力専用メンバーへの `init=auto`／`init=state`、イベントへの `init=`、未知の修飾子（`#foo=1`）、`wcBindable` に無いメンバーを、3.3 と README は投げるが、4.0 は黙って受け入れる | 中 | 済み |
| F8 | `engine.ts`・`recursion/recursion.ts` | README は `$resolve`・`$postUpdate`・`$dependOn`・直接の代入での `**` を `wcs/recursion-unsupported` で拒むと定めるが、4.0 はノードの行の中で通す（行の深さに束ねる）。`$resolve` は族の getter があると黙って undefined | 中 | 済み |
| F9 | `scopes/component.ts` | 丸ごとのマウントに深い部分対応を足すと、その頭のキーが丸ごとのマウントから外れる（`state: user; state.a.b: outer.b` で `a.c` が undefined）。3.x の README は「最も長い接頭辞が勝つ」 | 要判断 | 済み（3.x に合わせた） |
| F10 | `scopes/component.ts` | コンポーネント側にワイルドカードのある対応（`state.list.*: items`）は、何もマウントせず、エラーも出さない | 要判断 | 済み（投げる） |
| F11 | `features/diagnostics` | README の `wcs/default-getter-mismatch` の警告が無い | 低 | 済み |
| F12 | `features/temporal.ts` | エンジンを作った後に temporal を install すると、切断・再接続で TypeError（約束は「定義の前に install」） | 低 | 済み |
| F13 | `dom/view.ts` | 行の構築中に wc-bindable の初期化が届いたスロットの反映が失敗すると、同じ失敗が `$errorCallback` に 2 回届く | 低 | 済み |
| F14 | `dom/binder.ts` | 状態を受け取った後の bind-component のホストに、後から結線（`state.a: x`）を足して binder に渡すと、黙って捨てられる | 低 | 済み（投げる） |
| F15 | `dom/mount.ts`・`plan.ts` | 構造でない `data-wcs` を持つ `<template>`（`attr.id: x`）は丸ごと無視される（README に記述なし） | 低 | 済み（3.3 と同じく普通の要素として束縛） |
| F16 | `dom/view.ts`・`mount.ts` | wcBindable の無い要素（ネイティブ要素と、宣言の無いカスタム要素）の `#init=` は、検査だけで効き目が無い。3.3 は `init=element`／`none` で初期の state → 要素の書き込みを止め、`init=auto` は状態に値が無ければ止める（F7 を直すときに見つけた） | 要判断 | 済み（3.3 に合わせた） |

- F9・F10・F16 の決定（2026-09-27）: F9 は 3.x に合わせる、F10 は投げる、F16 は入れる。

**Issue #330〜#338 の確認で見つかったもの（2026-09-27）**

| # | 場所 | 内容 | 重さ | 状態 |
|---|---|---|---|---|
| F17 | `dom/plan.ts`（`boundPattern`） | #332 と同じ。マークアップに書いた数値添字のパス（`items.0.v`）は字面どおりのパターンになり、添字のパスへの書き込み（`items.*.v` の行 0 に届く）でも、要素の差し替え（`items.0 = {…}`）でも描き直されない。一覧を丸ごと置き換えたときだけ描き直される。数値添字の getter（`items.0.double`）は `items.*.double` の getter に当たらず、初期から空（`this["items.0.double"]` で読めば値が返る） | 中 | 済み |
| F18 | `dom/plan.ts` | マークアップの `$1`（`{{ $1\|add(1) }}`、`textContent: $1`）が `binding-path-missing` で束縛に失敗する。README（3.3）は「テンプレートでループの添字を直接表示できる」と定める | 中 | 済み |
| F19 | `dom/view.ts`（`applyTo`） | 表示のプロパティ（`textContent`・`innerText`）に数値をそのまま書いていた。ブラウザは文字列にするが、happy-dom（`@wcstack/server` のサーバの DOM）は 0 を空にし、`innerText` に数値を書くと投げる。サーバ描画で `textContent: count` の 0 が消える（F18 を直すときに見つけた） | 中 | 済み |

**使われていないコード**（削れば core が少し軽くなる。今はテストが直接呼んでいる）: `dom/wc.ts` の `isCustomTag`、`list.ts` の `StateRow.parent`／`depth`、`pattern.ts` の `PatternTable.has`、`scopes/volume.ts` の `fail()` の第 3 引数。届かない防御の分岐（`engine.ts:478`・`:810`・`:1103`、`dom/view.ts:166`・`:629`・`:652`・`:687`・`:830-832`、`dom/plan.ts:37`、`dom/wc.ts:63`、`strategy/dirty.ts:23`、`scopes/component.ts:366`・`:373`・`:481`、`devtools.ts:107`・`:120`、`temporal/stream.ts:204`・`:221`、`temporal/watch.ts:194`、`recursion.ts:186`、`features/diagnostics.ts:80`）。

## 3. 周辺パッケージと道具

| 対象 | やること |
|---|---|
| vscode-wcs・lint（`wcs-validate`） | 新しいパーサと manifest に切り替える。manifest の `filters` から `substr` が消えるので、`substr` は `wcs/filter-unknown` になる。`slice(start, start + length)` への書き換えを案内するか（クイックフィックスを含む）を決める。`wcs/name-alias`（今は「3.x の間は動き、4.0 で外れる」）を「4.0 で外れた」エラーにする。state-next の新しいコード（`feature-not-installed`・`declaration-alias`・recursion 系など）を共有の語彙にそろえる。`#番号` のメッセージを解読させるかを決める。テストを流し直し、版を上げる |
| `@wcstack/typescript` | 前置きの型から旧名（`$trackDependency`・`$untrackDependency` など）を外す。`WcsThis` などの型の出所を R2 に合わせる |
| `@wcstack/testing` | `file:../state` で state を使う。state-next でテストを流す（`createStateAsync` は足し済み） |
| `@wcstack/server` | 依存 `^3.3.0` を `^4` へ。SSR の出力は 3.3 と互換が無い（版の検査でクライアント描画に倒れる）ので、移行ガイドに書く。server 自身の変更は不要（後付け 5 で確認） |
| `wcstack`（入口パッケージ） | state の `/auto` を取り込むので、新しい auto で作り直し、サイズを記録する |
| `@wcstack/devtools` | プロトコル v2 のままで、改修は不要（後付け 6 で確認）。型のずれを見るテスト（`packages/devtools/__tests__/protocol.typesDrift.test.ts`）が `packages/state/src/devtools/types.ts` を読むので、参照先を直す |
| wcstack-skill（別リポジトリ） | `$scan` の削除、旧名の削除、`substr` の削除（`slice` へ）、イベントの委譲（バブリングするイベントの `currentTarget` がルート）、エラーの番号などを反映し、プラグインの版を上げる |

## 4. ビルド・CI・サイズ・計測

- サイズの検査（`scripts/check-state-size.mjs`・`scripts/check-state-split.mjs`）と基準値（`scripts/state-size-baseline.json`・`scripts/state-split-baseline.json`）を、新しい出力の形に合わせて作り直す。
- `release.yml` と `ci.yml` のビルド手順を合わせる。state-next は `tsc`＋Rollup ではなく esbuild（`build.mjs`、短縮名の表 `mangle.mjs`）と、その後段の terser（`minify.mjs`）。state を最初にビルドする順序（lint と typescript が取り込むため）は変わらない。
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

### 旧名の扱い・ESLint とカバレッジ・#2（2026-09-27）

**#2（リスト要素 getter の隣接項目）**: state-next では起きない。前の行の getter を読む累計（数値のパスでも `$resolve` でも）は、葉の書き込みで後ろの行がすべて計算し直され、行の追加・並べ替え・削除にも追従する。行 0 に守りの無い原文でも、無限ループにならず一覧は描かれる（3.3 は `ListIndex not found` で一覧ごと止まる）。`__tests__/issues.test.ts` に 3 件。

**旧名**（§2.1）
- engine から `$trackDependency`・`$untrackDependency` を外した。読むと `[wcs/name-alias]` #1701（例: `$trackDependency was removed: write $dependOn.`）。
- `$streams`・`$updatedCallback` の宣言は、core が `[wcs/declaration-alias]` #1601 で投げる（temporal の後付けの `$streams` の検査は core へ移した）。
- manifest の旧名の表は 3 つとも空。`scopes/volume.ts` のパス API の一覧からも旧名を外した。
- ベンチページのフィクスチャの getter を `$untracked` にし、計測スクリプト 9 本の目印をそろえた。9 本とも目印がフィクスチャにちょうど 1 回あることと、`select10k.mjs` が 3.3 と state-next の両方で変種を作れることを確かめた。

**ESLint とカバレッジ**
- `eslint.config.js` は共通のひな形から生成した。`scripts/sync-package-configs.mjs` に、state-next の Rollup の例外（esbuild の `build.mjs`）を理由付きで登録した。ブランチの初めから CI の `--check` が state-next で落ちていたのも、これで直った。
- ESLint の指摘 4 件（`Function` 型 2・使っていない import と変数 2）を直した。
- カバレッジの基準は 3.3 と同じ（statements 99.5・branches 98.5・functions 100・lines 99.5）。除外は、再エクスポートと install だけの入口、型だけのファイル、生成したプロトコルの写し。
- 最初は 92.46・87.16・91.04・95.92。未カバーの項目を 5 つのグループ（engine・DOM・要素と公開 API・scopes・後付け）に分け、並行してテストを足した（`__tests__/coverage-*.test.ts` 21 ファイル）。
- 結果: **99.71・99.16・100・99.95**。テスト 876 → 1,242 件（通過 1,241・スキップ 1）。残る 40 項目は、届かない防御の分岐と、F1・F3 の誤った経路だけ（§2.5）。
- `public-surface.test.ts` の TypeScript の型検査を使うテストは、カバレッジの計測下では 5 秒を超えるので、60 秒にした。
- core 19,358B（旧名の検査を足した分 +53B）。e2e 131/131。

### 不具合の修正（2026-09-27）

§2.5 の F1〜F8・F12・F13 を直した。どれも再現のテストを先に書き、修正前に落ちることを確かめた（`__tests__/fixes.test.ts` 23 件、`fixes-late-install.test.ts` 1 件）。

- **F1**: 行の中で読み書きするワイルドカードのパスは、文脈の行が同じリストのときだけその行に解決する（`ctxRow`）。別のリストの行の中では、文脈が無いのと同じ（読みは undefined、書きは #3 `no row`）。
- **F2**: `wire()` は `patterns.all()` を配列に取ってから 2 回回す。
- **F3**: `$eqIndex` の選択の書き替えを、どの level・どの深さの getter にも届ける（`rekeyEqIndex` が level の親の行をすべて回り、深い getter には `forRowsUnder` で届ける）。同じ getter でも level が違えば別の購読にする。
- **F4**: 打ち切りで queue を捨てるとき、DIRTY のまま残ったキャッシュを FAILED に戻す（`Strategy.dropped`）。FAILED は「読まれたので、元の変化が届く必要がある」印で、次の書き込みで届き、読めば計算し直す。
- **F5**: コンポーネントの変更がホストへ渡るとき、通った対応（entry）を覚える（`Mount.from`）。同じコンポーネントのほかの対応には、その変更が届く。
- **F6**: `JSON.parse(script.textContent || "{}")`。空白だけの中身は、3.3 と同じく JSON の誤りで投げる。
- **F7**: 3.3 の `resolveInitialSyncPolicy` と同じ検査を足した。番号 #33〜#40（コード無し、文面は 3.3 と同じ）。
  - 束縛の文を読むとき（`plan.ts`）: 未知の `key=` の修飾子（#33）、`init`／`sync` の重複（#34）、値の誤り（#35）、イベントの `init=` は `none` だけ（#36）、radio／checkbox は `state`／`none` だけ（#37）。無効の設定（`enableDirectionalInitialSync: false`）での `=` の修飾子（#31）も、ここで要素の種類を問わず投げる（3.3 と同じ。これまではカスタム要素のときだけ）。
  - wcBindable の要素に付けるとき（`wc.ts`）: 宣言に無いメンバー（#38、修飾子が無くても。無効の設定では検査しない）、メンバーの形に合わない `init=`（#39。出力専用は `element`／`none`、入力専用は `state`／`none`）、出力の無いメンバーの `sync=connect`（#40）。
  - 出力専用 × `init=auto`／`state` を固定していた 2 件のテストは、検査のテスト（13 通り）と、許される組み合わせのテストに置き換えた。
  - 縮小の名前の置き換え（mangle）で `init`／`sync` のプロパティ名が変わるので、修飾子の名前をプロパティ名に使わない（最初の版はゴールデンで落ちた）。
  - 直す途中で F16 を見つけた（§2.5）。
- **F8**: 代入・`$resolve`・`$postUpdate`・`$dependOn` は、パスに `**` があれば core が #1101 で投げる（`unbound`）。読み・`$getAll`・`$setAll` はこれまでどおり。あわせて、パターンを作るときの検査を「最後の段が `**`」から「パスのどこかに `**`」に広げた。`$eqPath` の第 2 引数や `$eqIndex` のように、`**` のパスをそのまま引く API も拒む（族のひな形の下の新しいパスが黙って undefined になっていた）。recursion の後付けは、状態の登録中だけこの検査を通らずにひな形を作る。
- **F12**: temporal の `element` フックは、ランタイムの無いエンジン（install の前に作られたもの）では何もしない。
- **F13**: 行の構築中に変更が届いたスロットは、構築の場で適用したときに queue の印を外し、drain はその印の無い項目を飛ばす。同じ束縛の適用と失敗の報告は 1 回になる。最初に試した「報告の前に同じ束縛の失敗をまとめる」は、構築の場の失敗と drain の失敗が別の報告の回に入るので効かなかった。

| | 前（`a75fb849`） | 後 |
|---|---|---|
| テスト | 1,242 件（通過 1,241・スキップ 1） | 1,287 件（通過 1,286・スキップ 1） |
| カバレッジ | 99.71・99.16・100・99.95 | 99.75・99.11・100・99.95 |
| core（`core.min.js` gzip） | 19,358B | 19,716B（+358B。上限 20,000B まで 284B） |
| e2e | 131/131 | 131/131 |

- core の増分の大半は F7 の検査（約 190B）。ほかは F1・F3・F4・F8・F13 の分。
- ESLint と型検査は通る。性能の A/B は取っていない（hot path への変更は、drain の 1 項目ごとの印の確認と、代入ごとの `**` の確認だけ）。

### F9・F10・F16（2026-09-27）

- **F9**: 丸ごとのマウントの隣の部分対応は、最も長い接頭辞が勝つ（3.x の README と同じ）。`state: user; state.a.b: outer.b` では、コンポーネントの `a.b` とその下は `outer.b`、その隣の `a.c` は `user.a.c` を読み書きする。これまでは部分対応の先頭のキー（`a`）を丸ごとのマウントから外していた。
  - 丸ごとのマウントは、1 段の部分対応の無いキーをすべて受け持つ（`mountKey`）。ホストの変更を丸ごとのマウントからコンポーネントへ渡すとき、部分対応の内側のパスと同じか、その下のパスは渡さない（`into`）。コンポーネントからホストへは、これまでどおりパスを上へたどって最初に見つかる対応を通る（`up`）ので、長い方が勝つ。
  - コンポーネントが先頭のキーを自分で持つとき（`state = { a: … }`）は、これまでどおり `a` もその下も私有（README の R1）。
- **F10**: コンポーネント側のパスに `*` のある対応（`state.list.*: items`）は、読み込みで投げる。文面は `<tag> maps "state.list.*": the component-side path of a mount cannot contain "*" — map the list itself ("state.list: <the host's list>").`（`*` で始まるときは案内を付けない）。黙って無視する動きを固定していたテストは、投げるテストに置き換えた。
- **F16**: wcBindable の無い要素（ネイティブ要素と、宣言の無いカスタム要素）の `#init=none`／`element`、状態の値が undefined のときの `init=auto` は、初期の書き込みだけをしない（3.3 と同じ）。
  - 束縛の最初の値を印（`HOLD`）にし、最初の適用では値を読んで覚えるだけにする（`initialOf`、`Binding.apply`）。値は読むので、getter に束ねても次の変化が届く。適用をただ飛ばすと、getter のキャッシュが読まれないままで、次の変化が届かない。
  - `#init=` の付いた束縛は、行のスロットにしない（Binding にする）。
  - 名前空間（`class.`／`attr.`／`style.`）は、3.3 と同じく `#init=` を無視する。
  - radio／checkbox の `init=none` も、初めに `checked` を変えない。

| | 前（`d5c7fd54`） | 後 |
|---|---|---|
| テスト | 1,287 件（通過 1,286・スキップ 1） | 1,299 件（通過 1,298・スキップ 1） |
| カバレッジ | 99.75・99.11・100・99.95 | 99.73・99.09・100・99.95 |
| core（`core.min.js` gzip） | 19,716B | 19,769B（+53B。上限 20,000B まで 231B） |
| e2e | 131/131 | 131/131 |

### F11・F14・F15（2026-09-27）

§2.5 の不具合は、これで全部直した。

- **F11**: wcBindable のプロパティのイベントを既定の getter（`e.detail`）で読むとき、形の食い違いを要素 × プロパティごとに 1 回だけ警告する（`[wcs/default-getter-mismatch]`、文面は 3.3 と同じ）。見分けるのは 3.3 と同じ 2 つの形: detail が undefined なのに要素のプロパティに値がある、detail が `{ <prop>: … }` の包みなのにプロパティがオブジェクトでない。書き込みはそのまま行う。`semantics: "event"` のメンバーは見ない。
  - 3.3 は core で警告していた。4.0 は core が hook（`hooks.detail`）を呼ぶだけで、検査と文面は診断の後付けにある（`.` と `/auto` は入れる。`/core` だけのページでは警告しない）。
- **F14**: 状態を受け取った後のコンポーネントのホストに届いた結線（`state.a: x`）は、黙って捨てずに投げる（`<tag>.state has loaded its state: the wiring "state.a" added afterwards cannot reach it — bind the host's wiring before the component loads.`）。マウントを掛け直す仕組みは無い。
  - binder で後から渡したときは `bind()` から投げる。ページの状態が後から読み込まれ、そのとき初めて結線が付くときは、ページの束縛の誤りとして `<wcs-state>` の初期化が失敗する（4.0 のほかの束縛の誤りと同じ扱い）。
  - 黙って捨てる動きを固定していた 2 件のテストは、投げるテストに置き換えた。
  - マークアップに最初から結線が書いてあれば、コンポーネントはその結線を待ってから状態を受け取るので、この誤りは起きない。
- **F15**: 構造の指示（`for`・`if`・`elseif`・`else`）の無い `data-wcs` を持つ `<template>` は、普通の要素として束縛する（3.3 と同じ）。`<template>` 自身の属性やプロパティが束縛され、中身は描かれない。ページの walker とプランの walker の両方。

| | 前（`1b669157`） | 後 |
|---|---|---|
| テスト | 1,299 件（通過 1,298・スキップ 1） | 1,301 件（通過 1,300・スキップ 1） |
| カバレッジ | 99.73・99.09・100・99.95 | 99.72・99.03・100・99.95 |
| core（`core.min.js` gzip） | 19,769B | 19,792B（+23B。上限 20,000B まで 208B） |
| 診断の後付け（core を除く） | — | 5,270B |
| e2e | 131/131 | 131/131 |

### サイズ: terser を後段に通す（2026-09-27）

esbuild の出力（実行時のバンドル 3 つと、分割ビルドのすべてのファイル）を terser にもう一度通す（`minify.mjs`）。あわせて、短縮名の表（`mangle.mjs`）に内部の名前を 11 個足した。

**何が効いたか**
- esbuild も局所の名前は短くしているので、「関数名を短くする」余地は、表に載っていない内部のプロパティ名だけだった（`invalidateUnder`・`checkArity`・`claimed` など 11 個で −55B。esbuild だけの出力で測った）。
- terser は名前を出現回数の順に付け直すので、gzip がよく効く。名前の付け直しだけで core が −719B、式の畳み込みを合わせて −1.2KB。
- terser の設定: `module: true`、`compress: { passes: 2 }`、`mangle: true`。プロパティ名は変えない（分割ビルドの後付けは、esbuild が付けた名前で core に届く）。export の名前も変えない。`unsafe` 系は使わない。
- 試して見送ったもの: 組み込みフィルタの表を配列の形にする（`{factory, arity}` を 24 回書いている）。約 −26B で、読む側のコードが増えるので正味はほぼ 0。
- 公開の型にある `hasConnectedCallbackPromise`（静的フラグ）は表に入れない。

| gzip | 前（esbuild だけ） | 後 |
|---|---|---|
| core（`core.min.js`） | 19,792B | 18,534B（−1,258B。上限 20,000B まで 1,466B） |
| `/auto`（`auto.min.js`） | 40,965B | 38,635B（−2,330B） |
| `.`（`index.esm.js`） | 43,656B | 41,466B（−2,190B） |
| 分割ビルドの core（`core.js`＋チャンク） | 23,984B | 22,620B（−1,364B） |

- 上限 20,000B は esbuild だけの出力で決めた目安。測る物（`core.min.js` の gzip）は同じで、配る物がそのまま小さくなった。
- 確かめたこと: 縮小バンドルと分割ビルドの突き合わせのテスト（`bundle.test.ts`・`split.test.ts`）は、同じ `minify.mjs` を通した出力で走る。全テスト 1,302 件（通過 1,301・スキップ 1）、e2e 131/131（dist を使う）。
- `bundle.test.ts` に、短くした名前が要素（`<wcs-state>` のクラスが継ぐ HTMLElement の鎖）と Object のプロパティ名に重ならないことのテストを足した。短くしたクラスのメンバーが、要素のプロパティを隠さないように。
- 性能: 目標の 2 項目を、同じセッションで順番を入れ替えながら 6 回（各 180 サンプル）測った。中央値は cold 10,000 行 75.3 → 75.2ms、warm 1,000 行 5.8 → 5.8ms、cold 1,000 行 11.0 → 11.3ms、warm 10,000 行 46.9 → 47.2ms で、差はばらつきの範囲。最初の 2 回（各 3 周）は、1 周ごとの中央値が 2 つの山（cold 10,000 行で 40〜56ms と 70〜80ms）のどちらに寄るかで大きく振れたので、周を増やした。
- ビルドは terser の分だけ遅くなる（24 ファイルで約 1.8 秒。`npm run build` 全体は約 9.5 秒）。devDependencies に `terser` を足した（3.3 のビルドも terser を使う）。

### Issue #330〜#338 の確認（2026-09-27）

2026-09-26 に登録された 9 件（どれも 3.3.x の修正の検証中に見つかったもの）を、Issue の再現手順のまま state-next で流した（`__tests__/issues.test.ts`）。

| Issue | state-next | 備考 |
|---|---|---|
| #330 for / if の中の spread が未定義の要素で失敗 | 起きない | 行の中・if の枝の中の spread も、要素の定義を待って展開する（`whenDefined`） |
| #331 コンポーネントのメソッドを `element.state` から呼ぶと、私有キーが描き直されず、ツリーのキーは readonly で投げる | 起きない | `element.state` はコンポーネントのエンジンのプロキシで、読み取り専用の文脈に束ねない |
| #332 マークアップの数値添字のパスが、添字のパスでの書き込みに追従しない | **起きていた**（2026-09-27 に修正） | §2.5 の F17 |
| #333 for で描いていないリストの要素を差し替えると、子のパスが古い値を返す | 起きない | 差し替えた行の子の読み・getter・`$getAll` が新しい値 |
| #334 SSR 中に空でないリストへ行を足すと境界が崩れ、ハイドレーション後に一覧を書き換えられない | 起きない | 1 行の一覧に 2 行足す形（`textContent:` とマスタッシュ）、空の一覧に 2 行ずつ 3 回足す形とも、サーバの行を引き取り、追加・削除・置き換えに追従する |
| #335 同じバッチで一覧を置き換えてから要素に書くと、for が壊れる | 起きない | 形 A・形 B とも、その後の並べ替え・追加・置き換えまで正しく、エラーも出ない |
| #336 SSR で if の中の if があると、外側の else が内側の if と組になる | 起きない | 内側に else がある形・無い形とも、外側の else が外側の if と組になる |
| #337 行の要素の出力を行そのものに束ね、同じ値を返すと幽霊行が残る | 起きない | `$1` は 0, 1, 2。一覧を縮めても空にしても行は残らない（state-next は値の `indexOf` で行を入れ替えない） |
| #338 行の要素の出力を一覧の元のキーへ束ねると、マイクロタスクの無限ループで固まる | 起きない（打ち切って報告する） | drain が 32 回で打ち切られ `#11`（`updates did not settle after 32 passes`）を報告する。評価は 33 回、ページは固まらない。Issue が望む「循環しているパスの名前」は報告に入らない |

- #337 のテストでは `$1` を行の getter から読んだ。マークアップの `$1` は state-next で束縛できない（§2.5 の F18。Issue とは別の、3.3 との差）。
- #334・#336 のテストは、`issues.test.ts` の SSR の補助（`serverRender` → スナップショット → `hydrate`）で流した。`serverRender` に、スナップショットの前に待つ時間を足した（`$connectedCallback` の `await` の後の書き込みを待つため）。

### F17・F18・F19（2026-09-27）

- **F17（#332）**: マークアップに書いた数値添字のパス（`items.0.v`、行の中の `.items.0.v`）は、`this["items.0.v"]` と同じく添字として読み書きする。数値の段を持つパターン（マークアップだけが作る。プロキシは添字を行に解く）に、プロキシを通して読み書きする accessor を付ける（`Engine.markupAccessor`、`onPatternCreated` から。再セットの後も付け直す）。読みは getter の読みとして追跡されるので、添字のパスへの書き込み・要素の差し替え・並べ替え・一覧の置き換えに追従する。行の getter（`items.0.double`）も読める。双方向の束縛の書き戻しは setter で添字のパスへ書く。
  - 一覧でない入れ物の数値のキー（`usersById.42.name`）は、添字で読むと undefined になるので、これまでどおり字面どおりに読む（3.3 のマークアップと同じ）。
  - 診断の後付けの `wcs/binding-path-missing` は、数値添字のパスを、それが指すパターン（`items.*.x`）で確かめる。行の getter を「宣言されていない」と誤って警告しなくなり（#332 の `.d` の警告）、打ち間違い（`items.0.doubel`）には行の getter も候補に挙げる。
  - #332 のテスト（`issues.test.ts`）の `it.fails` を外した。
- **F18**: マークアップの `$1`（`{{ $1|add(1) }}`、`textContent: $2`）は、最も内側のループの行のパターン（`items.*.$1`）の getter として読む。getter の中の `$k` の読みなので、添字の見張り（`indexWatchers`）に載り、行の追加・並べ替え・削除に追従する。ループの外の `$1` は `[wcs/wildcard-rank]` #1401 で投げる。
- **F19**: 表示のプロパティ（`textContent`・`innerText`・`innerHTML`）には文字列にしてから書く。

| | 前（`8a0af7fe`） | 後 |
|---|---|---|
| テスト | 1,302 件（通過 1,301・スキップ 1） | 1,326 件（通過 1,325・スキップ 1） |
| カバレッジ | — | 99.72・99.04・100・99.95 |
| core（`core.min.js` gzip） | 18,534B | 18,723B（+189B。上限 20,000B まで 1,277B） |
| e2e | 131/131 | 131/131 |

- 性能の A/B は取っていない。hot path への変更は、表示のプロパティへの書き込みの `String(v)` だけ（文字列ならそのまま返る）。数値の段の確かめはパターンを作るときだけ。

### コンポーネントのマウントの `#ro`（2026-09-27）

後回しにしていた R6 のうち `#ro` を入れた。これまでは黙って無視され、コンポーネントからの書き込みがそのままホストに届いていた（3.0 で入った約束に反する）。3.3 と同じ約束にした（README「`#ro` on a mount is honoured (3.0)」、docs/migration-v3.md）。

- `state#ro: user`・`state.title#ro: doc.title`・行の `state#ro: .` の対応を通る、コンポーネントのコードの書き込み（メソッドの `this.x = …`、`element.state.x = …`、入れ子の `this["addr.city"] = …`、`$setAll`／`$resolve`）は、書く前に投げる。文面は 3.3 と同じ: `[wcs/mount-readonly] <tag> cannot write "name": it is mounted read-only ("state#ro: user"). Write it on the host, or drop #ro from the mount.`
- コンポーネントの中の要素からの書き戻し（双方向の入力、radio／checkbox、wc-bindable のイベントと初期値）は、投げずに書かない（その束縛に `#ro` を付けたのと同じ。3.3 は束縛に `#ro` を足していた）。
- ホストからの書き込みは、これまでどおりコンポーネントに届く。`#ro` の無い対応と私有キーは書ける。
- 仕組み: core の `write` に「要素が書き戻した」の印（`element`）を足し、受け口 `beforeWrite` に渡す。受け口 `hostBinding` に結線の `#ro` を渡す。scopes の後付けが、書き込むパターンから上へたどって最初の対応（最も長い接頭辞）の `#ro` を見る（`guardReadonlyMount`）。
- 3.3 との差: 文面の書けないパスは、3.3 は具体的なパス（`items.0.v`）、4.0 はパターン（`items.*.v`）。
- テスト 5 件（`fixes.test.ts`）。core 18,740B（+17B）。テスト 1,331 件（通過 1,330・スキップ 1）、e2e 131/131。

### コンポーネントのマウントのエクスポートした getter（2026-09-27）

R6 の残り。3.3 の README「Exported getters」と同じ約束にした: ツリーに無いキーの読みは、その位置にマウントしたコンポーネントの accessor が答える。ツリーにあるキーはツリーが勝つ。私有キーとメソッドは見せない。

- エクスポートするのは丸ごとのマウント（`state: user`、行の `state: .`）の、コンポーネントの状態の accessor（getter／setter。プロトタイプの鎖も見る）。メソッド・私有データ・名前に `*` のある accessor はエクスポートしない。点を含む名前は、頭が私有データのとき（`form.label`）だけエクスポートする（頭がツリーのキーの `info.upper` はツリーの側の accessor）。
- 仕組み: コンポーネントが登録されたとき、ホストのエンジンの公開パスのパターン（`user.display`、`users.*.display`）に accessor を付ける。getter は、ツリーの親を追跡して読み、キーがあればツリーの値、無ければその行にマウントしたコンポーネントの accessor の値（無ければ undefined）。ホスト自身の accessor がそのパターンにあれば、そちらが勝つ。
- 依存: コンポーネントの accessor が変わりうるとき（受け口 `getterReached`）、ホストの公開パスを無効にする。登録・切断・再接続でも無効にする（切断中は undefined、再接続でまた読める）。行の `.display`・`$getAll("users.*.display", [])`・行の追加に追従する。
- 自己再帰のコンポーネント（行ごとに自分をマウントする木）で、各段の `total` が子の `total` を `$getAll("children.*.total", [])` で読み、深い葉の変更が根まで届く。
- 外からの書き込み: ツリーにキーがあればツリーへ、無ければコンポーネントの setter（getter だけなら 3.3 と同じ文面で投げる: `Cannot write to "display" on mounted <tag>: the accessor has no setter. …`）。コンポーネントがいなければツリーへ書く。
- 誤りと警告（文面は 3.3 と同じ）: ツリーにあるキーは登録時に一度 `[wcs/mount-export-shadowed]`。同じインスタンスに同じキーをエクスポートする 2 つのコンポーネントは、読んだときに `[wcs/mount-export-ambiguous]`。
- 3.3 との差: 初めの読みは、コンポーネントが登録される前なら undefined で、登録で収束する（3.3 と同じ）。`binding-path-missing` の遅延の検査（1 マクロタスク後）がそれより前に走ると、警告が出ることがある（3.3 の README と同じ注意）。
- テスト 11 件（`fixes.test.ts`）。happy-dom は `<template>` の中身の要素も生成するので、自己再帰のテストは中身を `connectedCallback` で入れる（README の user-card と同じ形）。
- core は変わらない（18,740B）。scopes の後付けが 6,903B → 7,679B（+776B）。テスト 1,342 件（通過 1,341・スキップ 1）、カバレッジ 99.72・99.03・100・99.95、e2e 131/131。

### `substr` を外して `slice` に一本化（2026-09-27、R4）

- formats の後付けから `substr` を外した（実装・組み込みの名前の一覧・メタデータ）。manifest の `filters`・`filterMeta` からも消える。
- `substr` を書いたページは `[wcs/filter-unknown] filter not found: substr.` で失敗する。診断の後付けは、書き換えを案内する: `"substr" was removed in 4.0 — write slice(start, start + length): slice takes the end index, not a length.`（第 2 引数の意味が違う — 長さと終わりの位置 — ので、名前の近さの候補では直し方が分からない）。
- 公開面のテスト（`public-surface.test.ts`）は、manifest の `filters`・`filterMeta` を 3.3 から `substr` を除いたものと比べる（意図した差）。
- リポジトリのページ・e2e のフィクスチャ・デモに `substr` の使用は無かった。
- 残り: lint・VS Code 拡張の案内（§3）、wcstack-skill の記述（§3）、4.0 の README と移行ガイド（§5）。
- core 18,736B（−4B）。テスト 1,340 件（通過 1,339・スキップ 1）、e2e 131/131。
