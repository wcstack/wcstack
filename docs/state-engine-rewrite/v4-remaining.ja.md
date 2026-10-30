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
- core 19,434B gzip（`dist/core.min.js`。上限 20,000B まで 566B。2026-10-03、main の 3.5.0 の取り込みの後の作業ツリーをビルドして測った）、全部入りの `auto` 45,651B（3.3.0 は 80.9KB）。2026-09-27 から terser を後段に通す（§8）。上限を確かめる検査は無い — `build.mjs` がサイズを表示するだけで、テストにも CI にもしきい値は無い（§4）。
- 公式 js-framework-benchmark の CPU 加重幾何平均は 1.08〜1.11（signals 1.21〜1.25、3.3.0 1.51）。

## 1. 決めてほしいこと

| # | 論点 | 選択肢 | 根拠・状況 |
|---|---|---|---|
| R1 | 置き換えの形 | (a) `packages/state` の中身を state-next に差し替え、`@wcstack/state` 4.0 として出す (b) 別の名前のパッケージのまま出す | **決定（2026-09-26）: (a)**。**済み（2026-10-03）**: 差し替えた — `packages/state` が 4.0 のエンジンで、`packages/state-next` は無い（dist はコミット済み、版は 4.0 のリリースまで 3.5.4）。ブランチを main に入れるのは 4.0.0 のとき（§6） |
| R2 | 4.0 の公開 API の範囲 | 現行の公開物を、残す・落とす・後付けへ、のどれにするか | **済み（2026-09-26）**: 3.3 の公開面にそろえた（§2.3、§8）。内部の部品は公開しない |
| R3 | 3.x の最後の minor | (a) 最後の minor で、旧名にランタイムの警告を出す (b) 約束を取り下げる | **決定（2026-10-02、ユーザー）: (a) 約束を守る**。3.4.0（2026-10-02、main）は不具合の修正だけで警告は入っていないので、3.5 を最後の minor として出す。CHANGELOG 3.2.0／state-3x-naming D39 の「ランタイムの警告は 3.x の最後の minor でだけ出す」。3.5 には旧名のほか、4.0 で消える・throw するもの（`$scan`・`substr`・`bootstrapState` の消える／`$behavior` へ移るキー、全パッケージの `bootstrapXxx` の知らないオプション、autoloader の `scanImportmap`）の警告と、lint の 4.0 への案内（info）も入れる。lint と VS Code 拡張の通知（`wcs/name-alias`）は 3.2 からある |
| R4 | `substr` | 残す・外す・改名する | **決定（2026-09-27）: 外して `slice` に一本化する**。state-next から外した（§8）。[state-3x-naming.ja.md](../state-3x-naming.ja.md) V10 で「4.0 で考える」としていたもの |
| R5 | 現行の未解決 Issue | 3.x で直す、または 4.0 で解決として閉じる | #2・#258・#319〜#324 は、どれも state-next で起きない（#258 の行の中のコンポーネントは `faddc735` で直した。#2 は 2026-09-27 に確かめた、§8）。#330〜#338（2026-09-26 登録）は #332 だけが state-next でも起きていた（§2.5 の F17 として直した、§8）。#347〜#368（2026-09-27 登録）は #353・#354・#357・#362・#365 と、#347・#349・#356・#363 の一部の形が state-next でも起きる（§2.5 の F20〜F30、§8）。#372〜#391（2026-09-27 登録）は、#377・#382・#388・#389 の一部の形だけが state-next でも起きる。確かめる途中で、別の不具合を 8 つ見つけた（§2.5 の F31〜F38、§8。F31 の `<select>` の初期値は 3.3 からの退行）。F31〜F33・F35〜F37 は直した（#377・#388 の形を含む）。F34（#382）・F38 と #389 の性能は残り |
| R6 | 後回しにした機能 | 4.0 に入れる、または 4.0 の後 | **済み（2026-09-27）**: コンポーネントの mount の `#ro` と「エクスポートした getter」を入れた（§8） |
| R7 | 3.x のコメント束縛（`<!--@@: path-->`・`<!--@@wcs-text:path-->`）の扱い | (a) 廃止する（4.0 は束縛しない。検出は lint／vscode-wcs） (b) 支える（core +50〜80 B の見込み、未計測） | **決定（2026-10-02、ユーザー）: (b) 支える**。vscode-wcs の lint は `<template>` の外の `{{ }}` を FOUC の原因として報告し、代わりにコメント束縛を勧めている（README でも「Comment binding syntax — no FOUC」）。SSR の無いページで要素を足さずに FOUC を避ける書き方なので、廃止すると lint の勧めどおりに書いたページが黙って空になる。実装は core +81 B（計測。`<textarea>`・`<title>` の中を除く検査を含む）。ページの走査とテンプレートの計画の両方で `{{ }}` と同じテキスト束縛にし、コメントはテキストノードに置き換える（3.x と同じ DOM）。`enableMustache` によらず束ねる。SSR はサーバで値を描き、クライアントはコメント束縛として戻して束ね直す（§5 の移行ガイドの行） |
| R8 | 4.0 の出し方 | (a) 4.0.0-rc を npm の `next` タグで先に出し、試してから 4.0.0 を `latest` で出す (b) いきなり 4.0.0 | **決定（2026-10-03、ユーザー）: (a) rc を先に出す**。`release.yml` は patch / minor / major だけなので、プレリリース（`4.0.0-rc.N`、`npm publish --tag next`、GitHub Release の prerelease）の対応を足す。rc の間、README の CDN の固定は最新の安定版（3.5.x）のまま。**経路は済み（2026-10-03）**: §4・§6 |
| R9 | 4.0.0 の前に片付ける範囲 | (a) 必須だけ（差し替え・CI ゲート・周辺パッケージ・文書） (b) 既知の後続もすべて | **決定（2026-10-03、ユーザー）: (a) 必須だけ**。§3.2 の「3.x の修正の確認」の行の後続（終わりの無い値の `$watch` の循環、mount の前に外したコンポーネントが待ち続ける、など）は 4.0.x で直す |
| R10 | 利用者のコンテンツを束縛として読ませない印の属性（`data-wcs-ignore`、§2.4 の CSTI） | (a) 4.0 に入れる (b) 文書で注意するだけ | **決定（2026-10-03、ユーザー）: (b)**。4.0 の README に危険と書き方の注意を書く。属性は 4.x で足す（足すのは互換を壊さない） |
| R11 | 4.0 の規則を載せた VS Code 拡張の版 | (a) 2.0.0 で 4.0.0 と同時 (b) 1.22.0 | **決定（2026-10-03、ユーザー）: (a) 2.0.0**。3.x の利用者は 1.21.x に留まる |

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
| `/parser`・`/manifest` | ある | **済み**（`/parser` の結果の形と誤りの文面は 3.3 と同じ。`/manifest` は 3.3 の形に `behaviorOptions`（`$behavior` のキーと型）・`features`（後付けの名前）を足した（2026-10-02、lint と VS Code 拡張が読む）。旧名の表は空、予約名から `$scan` が外れた） |
| ESLint | `npm run lint` | **済み**（共通のひな形から生成。`sync-package-configs.mjs` に state-next の Rollup の例外を登録） |
| カバレッジ | `npm run test:coverage`（3.3 の基準 statements 99.5・branches 98.5・functions 100・lines 99.5） | **済み**（同じ基準。99.75・99.11・100・99.95、2026-09-27 の不具合の修正の後） |

- `/parser` と `/manifest` は、vscode-wcs が import している（`@wcstack/state/parser` 4 か所、`/manifest` 2 か所）。lint（vscode-wcs のビルド経由）と `@wcstack/typescript` も、ビルド時に `dist/parser.esm.js` と `dist/manifest.esm.js` を取り込む（`.github/workflows/release.yml` の注記）。
- manifest の旧名の表: `filterAliases`・`declarationAliases` は空にした（ランタイムが受け付けないため）。`apiAliases` も、§2.1 で engine が旧名を受け付けなくなったときに空にした（3 つとも空）。

### 2.3 公開 API の差（R2 の材料）

**済み（2026-09-26）**。入口ごとの export（値と型）が 3.3 と同じことを `__tests__/public-surface.test.ts` が確かめる（3.3 側はコミット済みの配布物の `.d.ts`）。詳細は §8。

意図して残した差（移行ガイドに書く）:
- `IStateElement` の `listPaths`・`getterPaths`・`setterPaths`・`nextVersion` は無い（2026-09-26 の決定。要るなら DevTools の後付けで出す）。
- `Ssr`（`<wcs-ssr>`）: `hydrateProps` は常に空（値の表は承認済みの削除）。3.3 の内部の静的メソッド（`extractStateData`・`buildContent` など、`ISsrElement` に無いもの）は無い。
- パース結果の `uuid` は無い（新エンジンは構造の束縛に id を使わない）。
- `$listKeys` は後付け `features/list-keys` に移った（3.3 は core に持っていた）。`.` と `/auto` は入れるので、`/core` だけのページで使うときだけ install が要る。
- 分割ビルドの `chunks/` のファイル名にハッシュが付く（3.3 は名前だけ。esbuild では名前だけだと衝突する）。
- 設定の `commentTextPrefix`・`enablePropagationContext`・`debug` は消した（渡すと throw）。`enableMustache`・`sameValueGuard`・`enableDirectionalInitialSync` は状態の `$behavior` へ移った（2026-09-30、§8）。
- `installFeatures` は同じ名前の後付けを 2 回目から飛ばす（3.3 は毎回 `install()` を呼ぶ。どちらも冪等なので結果は同じ）。
- `.` は型 `IStateElement` を足した（README の表を型にしたもの）。

### 2.4 その他

- ~~#2（リスト要素 getter の隣接項目問題）を state-next で確かめる（R5）~~ 済み（§8）。
- エラー番号の一覧を、利用者が引ける場所に置く（README か docs）。番号と文面の正本は `src/diagnostics/messages.ts`。
- ~~分割エントリと設定を、root の `<wcs-state>` の属性や状態の宣言キーで指定する案~~ 済み（2026-09-30、§8）: 属性＋`$behavior`／`$features`。検討は [root-attributes.ja.md](./root-attributes.ja.md)、計画と計測は [config-impl-plan.ja.md](./config-impl-plan.ja.md)。
- ~~`config.debug` がどこからも読まれていない~~ 済み（2026-09-30）: 消した（渡すと throw）。
- ~~CSP の診断（docs/csp §9）が state-next に無い~~ 済み（§8 の 2026-09-28）。
- `<wcs-state>` の中の `<script type="module">` はブラウザも評価するので、CSP が無いページではトップレベルのコードが 2 回走る（3.x も同じ）。README と docs/csp に書いた。挙動を変えるかは決めていない（§8 の 2026-09-28）。
- ~~判断事項（2026-10-02、品質改善のサイクル 3 の F4）: `on*:` を委譲せず要素に直接付ける、要素ごとの opt-out の修飾子を足すか~~ **決定（2026-10-02、ユーザー）: ② `#direct`**。`on*#direct:` は委譲せず、その要素に直接 `addEventListener` する（`currentTarget` は要素。行・枝の中でも行ごとに付け、行・枝の後始末で外す。`#prevent`・`#stop` と組み合わせられる）。委譲（2026-09-25 の決定）で困る 3 つの形 — (a) `#stop` でページ側のコードが祖先に付けたリスナーを止める、(b) 祖先が `stopPropagation()` しても中の `onclick:` が呼ばれる、(c) 別の root へ移した要素でも呼ばれる（F38）— を、その束縛だけ 3.x と同じにする。core +46 B（計測。修飾子の無い束縛の経路には足していない）。組み合わせの注意は仕様として文書化する（§5 の移行ガイドの行）: 外側が `#direct` で内側が委譲だと、外側が先に走り、内側の `#stop` で外側を止められない（DOM の順のとおり。委譲のハンドラはルートで走る）。止めたいときは内側にも `#direct` を付ける。
- 後続作業（2026-10-02、サイクル 3 の E2 の補足）: SSR でないサーバのテンプレートに埋めた利用者のコンテンツも、ページの走査で束縛として読まれる（CSTI。`{{ … }}`、`data-wcs`、コメント束縛 `<!--@@: x-->`・`<!--@@wcs-text: x-->`）。コメント束縛は `$behavior.enableMustache: false` でも束ねる（R7）ので、mustache を切っても防げない。走査しない印の属性（Vue の `v-pre` にあたる `data-wcs-ignore`）を足すかを決める（対象は 3 つの書き方すべて）。それまでは README で注意する（§5）。

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
| F14 | `dom/binder.ts` | 状態を受け取った後の bind-component のホストに、後から結線（`state.a: x`）を足して binder に渡すと、黙って捨てられる | 低 | 済み（投げる。binder 経由は 2026-10-02 から `console.error` に報告する） |
| F15 | `dom/mount.ts`・`plan.ts` | 構造でない `data-wcs` を持つ `<template>`（`attr.id: x`）は丸ごと無視される（README に記述なし） | 低 | 済み（3.3 と同じく普通の要素として束縛） |
| F16 | `dom/view.ts`・`mount.ts` | wcBindable の無い要素（ネイティブ要素と、宣言の無いカスタム要素）の `#init=` は、検査だけで効き目が無い。3.3 は `init=element`／`none` で初期の state → 要素の書き込みを止め、`init=auto` は状態に値が無ければ止める（F7 を直すときに見つけた） | 要判断 | 済み（3.3 に合わせた） |

- F9・F10・F16 の決定（2026-09-27）: F9 は 3.x に合わせる、F10 は投げる、F16 は入れる。

**Issue #330〜#338 の確認で見つかったもの（2026-09-27）**

| # | 場所 | 内容 | 重さ | 状態 |
|---|---|---|---|---|
| F17 | `dom/plan.ts`（`boundPattern`） | #332 と同じ。マークアップに書いた数値添字のパス（`items.0.v`）は字面どおりのパターンになり、添字のパスへの書き込み（`items.*.v` の行 0 に届く）でも、要素の差し替え（`items.0 = {…}`）でも描き直されない。一覧を丸ごと置き換えたときだけ描き直される。数値添字の getter（`items.0.double`）は `items.*.double` の getter に当たらず、初期から空（`this["items.0.double"]` で読めば値が返る） | 中 | 済み |
| F18 | `dom/plan.ts` | マークアップの `$1`（`{{ $1\|add(1) }}`、`textContent: $1`）が `binding-path-missing` で束縛に失敗する。README（3.3）は「テンプレートでループの添字を直接表示できる」と定める | 中 | 済み |
| F20 | `dom/view.ts`（`buildBlock` の `plan.single`）・`dom/plan.ts` | テンプレートの直下が構造のテンプレート 1 つだけ（行が `if:` だけの `for:`、中身が `if:`／`for:` だけの `if:`）だと何も描かれない（`#12` … `Cannot read properties of null (reading 'insertBefore')`）。単独で複製したアンカーのコメントに親が無い。#347・#356・#363 の一部の形 | 高 | 済み |
| F21 | `dom/view.ts`（`Block.removeNodes`・`insertBefore`） | 要素で包まない位置（ブロックの直下）の入れ子の `if:` の枝・`for:` の行が、外側の行と一緒に動かず、行を消しても残る（`<template for: items><b>…</b><template if: .x>…</template></template>` を反転すると枝が元の位置に残る）。ブロックは作った時の直下のノードしか持たない。#347・#349・#356 の一部の形 | 高 | 済み |
| F22 | `dom/plan.ts`（`compilePlan` の `walk`） | `if:` の枝・`for:` の行のテンプレートの中の Light DOM の `bind-component` の子の中身を、ページの側が束ねる（`mount.ts` の走査と違い `componentScope` を見ない）。子の `if: x` がページの `x` を読む。#348 の周辺 | 中 | 済み |
| F23 | `ssr/ssr.ts`（`snapshot`・`build`） | サーバ描画で、ページの直下の Light DOM の `bind-component` の子の `if:` のテンプレートが出力から失われ、クライアントで追従しない（ページのエンジンのアンカーだけを変換する）。#348 の周辺 | 中 | 済み |
| F24 | `engine.ts`（`walkChange`・`sync`） | #362。元の配列をそのまま返す getter を `for:` で描くと、元のパスへの要素・葉の書き込みで行が描き直されない（同じ配列なので `sync` が何もしない）。別名の getter（#363 の `for: current`）も同じ | 中 | 済み |
| F25 | `engine.ts`（`markupAccessor`・`resolve`） | #363 の周辺。数値添字のパスの `for:`（`for: groups.0.items`）の行の `{{ .v }}` が空になる（F17 の accessor が行の文脈を `groups.*.items` の行として解こうとする）。#363 が訴える `[wcs/wildcard-rank]` の例外は起きない | 中 | 済み |
| F26 | `engine.ts`（`write` の葉の分岐・`walkChange`） | #365。同じオブジェクトをリストの 2 つの行に置くと、片方の行への葉の書き込みが、もう片方の行の束縛と行の getter に届かない（読みと、ルートの getter・`$getAll` は新しい値） | 中 | getter が結び付ける形（写しを返す絞り込み・並べ替え・切り出し・連鎖・volume の中）は 2026-10-05 に直した（research/kl-lists、`mirror` の別名の辿り。作られた行への記帳なし、getter が関わる一覧だけが辿る）。1 つの一覧の中の重複と、普通のキーの 2 本の配列（#378・#401）は 4.0 の既知の制限のまま |
| F27 | `engine.ts`（`drain`・`schedule`） | #353。drain の打ち切り（32 回）は 1 回の drain の中しか数えないので、drain をまたぐ無限ループ（microtask で値を出す要素、`$renderedCallback` から書く）は止まらず、ページが固まる（3.3.x の修正後は `$renderedCallback` の連鎖を 100 段で止める）。`$watch` を挟む循環は止まって報告される | 高 | 済み（async の `$renderedCallback` も止める） |
| F28 | `temporal/watch.ts`（`WatchRuntime.drained`） | #354。32 段を超える有限の描画の連鎖に `$watch`（ハンドラが書く）を足すと、`the chain is cut` が誤って出て、ハンドラが 1 回飛ぶ。連鎖の深さが、そのバッチがハンドラの書き込みから来たかを見ない | 中 | 済み |
| F29 | `dom/wc.ts`（`whenDefined`）・`scopes/component.ts`・`public/contract.ts` | #357。スコープ付きの CustomElementRegistry の shadow root の中の要素は、定義を global の登録簿で待つので、束縛が掛からない（行だけでなくルートも）。happy-dom は scoped registry を持たないので、コード読みと模擬テストで判定 | 中 | 済み（Chromium の e2e で確認） |
| F30 | `scopes/component.ts`（`mountKey` の setter） | #367 の周辺。ホストの行が消えた後のコンポーネントの書き込みは、消えた行の元のオブジェクトに黙って入る（別の行には着地しない）。3.3.x の修正後は `The host row of <x> was removed.` で拒む | 低 | 済み |
| F19 | `dom/view.ts`（`applyTo`） | 表示のプロパティ（`textContent`・`innerText`）に数値をそのまま書いていた。ブラウザは文字列にするが、happy-dom（`@wcstack/server` のサーバの DOM）は 0 を空にし、`innerText` に数値を書くと投げる。サーバ描画で `textContent: count` の 0 が消える（F18 を直すときに見つけた） | 中 | 済み |

**Issue #372〜#391 の確認で見つかったもの（2026-09-28）**

| # | 場所 | 内容 | 重さ | 状態 |
|---|---|---|---|---|
| F31 | `dom/plan.ts`（`compilePlan`）・`dom/mount.ts`・`dom/view.ts`（`buildBlock`） | `<select>` の `value:`／`selectedIndex:` を、中の `for:` が `<option>` を作る前に当てるので、初期表示が先頭の選択肢になる（ルートの `<select>`、行の中の `<select>`、#376 の行ごとの `<select>`）。後から値を書けば合う。選択肢を後から読み込む形（空から 3 つ）も同じ。束縛は文書の順に当てるため。3.3 は `<select>` の `value`／`selectedIndex` を選択肢の後に当てる（`packages/state/src/apply/applyChange.ts:146-152`）ので、3.3 からの退行 | 高 | 済み |
| F32 | `dom/view.ts`（`rowAt`） | F1 のマークアップ側。行の中の束縛の、別のリストのワイルドカードのパス（`for: a` の行の `{{ b.*.y }}`）が、今の行（`a` の行）に解ける。表示は `a` の行の値になり、双方向の書き戻し（`value: b.*.y`）は `a` のデータを壊す。#376 の形で、内側の行から `g.*.n` を読むと tags の行の値になる。F1 はプロキシの `resolve` だけを直していた | 中 | 済み |
| F33 | `ssr/ssr.ts`（`prepare`・`hydrated`）・`scopes/component.ts`（`start`） | SSR で、ページの直下の Light DOM の `bind-component` の子の `if:` の枝・`for:` の行を、ハイドレーションで引き取らない。子のエンジンがマウントするのは、ページが引き取りを終えた後なので、サーバの描いたノードを捨てて描き直す。子のクラスがハイドレーションの後に定義されると（autoloader）、定義までの間、子の `{{ x }}` が生の `{{x}}` で見え、枝と行が消える。#372・#374 の確認で見つけた | 中 | 済み |
| F34 | `engine.ts`（`resolve`）・`pattern.ts`（`parsePath`）・`list.ts` | #382 の形 2。数値キーのオブジェクト（`sales = {2024: {total: 10}}`）の `sales.2024.total` を、スクリプトで読むと undefined になり、`$eq` は常に偽になる。書き込みと双方向の書き戻しは `no row for "sales.*.total"` で投げる。数値の段を、入れ物の型によらず `*` と添字にするため。マークアップの読みは F17 の accessor で 10 を描く。3.3 もスクリプト側では投げるので退行ではない。ただ 4.0 は黙って undefined や偽になるので、見つけにくい（`usersById.42.name` のような ID の辞書にも当たる） | 中 | 直した（2026-10-05、research/kl-core。配列でないオブジェクトの下の数値の段は、書いたとおりの綴りのキー） |
| F35 | `engine.ts`（`postUpdateFn`・`enqueueBound`） | 行の値をその場で書き換え、一覧のパスで知らせる形（`s.todos[0].done = true; s.$postUpdate("todos")`）が、`for: todos` の行の束縛に届かない。届くのはルートの束縛と行の getter だけで、配列が同じなので `sync` も働かない。#377 の確認で見つけた | 中 | 済み |
| F36 | `engine.ts`（`postUpdateFn`） | #377 の `$postUpdate` の形。同じ配列を持つ 2 つの一覧（元の配列を返す getter の `for: shown` と、`for: todos`）で、`$postUpdate("todos.0.done")`・`$postUpdate("todos.1")` が片方の一覧にしか届かない。F24 の `mirror` を `write()` からしか呼んでいない | 低〜中 | 済み |
| F37 | `features/diagnostics.ts`（`missing` の `named`） | #388。数値添字のパスの `for:`（`for: groups.0.items`）の行で、行 getter（`{{ .double }}`、`groups.*.items.*.double`）が空で描かれ、警告も出ない。診断の後付けは、F17 の読み替えで getter に当たったとして警告を止める。一方 core は F25 で accessor を付けないので、getter に届かない。打ち間違い（`.nmae`）は警告する | 低〜中 | 済み |
| F38 | `dom/view.ts`（`attachEvent`）・`engine.ts`（`delegate`） | 束縛を持つ要素を別の root（別の shadow root）へ移すと、その要素のバブリングするイベント（`onclick:`）のハンドラが呼ばれない。委譲のリスナーが元の root にあるため。双方向の入力は要素に直接付くので動く。shadow の中のダイアログを body へ移す形も同じはず（未確認）。#387 の確認で見つけた | 低 | |

**使われていないコード**: `dom/wc.ts` の `isCustomTag`、`list.ts` の `StateRow.parent`／`depth`、`pattern.ts` の `PatternTable.has`、`scopes/volume.ts` の `fail()` の第 3 引数は、2026-10-01（品質改善のサイクル 1）に 4 つとも削除した（直接呼んでいたテストも直した）。テストの届いていない分岐（多くは届かない防御）は、行番号が編集でずれるので関数名で書く（2026-10-02 のカバレッジ）: `engine.ts` の `sharing`・`mirror`・`forAllLists`・`report`、`dom/view.ts` の `attachCustomOrPlain`・`IfView`／`ForView` の `headAt` と `dispose`、`dom/plan.ts` の `isTwoWay`、`dom/wc.ts` の `whenDefined`・`attachProperty`、`strategy/dirty.ts` の `dropped`、`config.ts` の `locale` の既定値（document の無い環境）、`scopes/component.ts` の `mountKey`・`answer`（setter）・`touch`・`crossed`、`ssr/ssr.ts` の `adoptScope`、`devtools.ts` の `snapshot`、`temporal/stream.ts` の `consume`・`untrack`、`temporal/watch.ts` の `compareRows`、`recursion.ts` の `wrap`（族の行の getter の枠）、`features/diagnostics.ts` の `check`・`detail`。

## 3. 周辺パッケージと道具

| 対象 | やること |
|---|---|
| vscode-wcs・lint（`wcs-validate`） | **済み（2026-10-03、差し替えまで）**: 依存は `"@wcstack/state": "file:../state"` に戻り（4.0 のエンジン）、CI の state-next の扱い・`ensure-state-dist.mjs`・`release.yml` の「vscode-wcs が state-next を指す間は止まる」ガードは差し替えで外れた（release.yml のガードは §4 の rc の経路に置き換わった）。`emit-builtin-tags.mjs` の SKIP には state-next を残した（差し替えより前にビルドしたチェックアウトに、git の外の `packages/state-next/dist` が残るため）。CHANGELOG の Unreleased は 2.0.0 の中身として書き直した（版は 4.0.0 と同時に上げる、R11）。以下は差し替えの前の記録。**済み（2026-10-02、未コミット）**。**このブランチは state-next を `@wcstack/state` に差し替えるまで release しない** — `@wcstack/lint` と `@wcstack/typescript` は毎回のリリースで vscode-wcs から作り直して公開されるので、差し替えの前に出すと 4.0 の規則が 3.x の版番号で配られ、3.x の利用者の CI が落ちる（`release.yml` のガードが止める。下の CI）。拡張の版は上げていない — 4.0 の規則は 3.x の利用者を壊すので、4.0 と同時に出す（vscode-wcs の CHANGELOG の「Unreleased」に記録。3.x のプロジェクトは 1.21.x のまま — 2026-10-03 に main の 3.5.0 を取り込み、package.json は main が 3.x 向けに公開した 1.21.0。4.0 のリリースで上げる）。**依存の形**: `"@wcstack/state": "file:../state-next"`（`node_modules/@wcstack/state` が state-next を指すので、import は `@wcstack/state/parser`・`/manifest` のまま）。4.0 で `packages/state` の中身と差し替えたら `file:../state` に戻し、下の CI の state-next の扱いを外す。state-next は dist をコミットしないので、vscode-wcs の `npm test`・`npm run build` は dist が無ければ先にビルドする（`scripts/ensure-state-dist.mjs`、Vitest の globalSetup と esbuild の前。古い dist はそのまま使う）。**CI**: ci.yml の `wcs-validate` は `packages/state` の代わりに `packages/state-next` を src からビルドしてから、vscode-wcs・lint・typescript を回す（ci の lint・typescript の matrix の job は `ensure-state-dist.mjs` が dist を作る）。`release.yml` は (1) vscode-wcs の依存が `file:../state-next` を指している間は、bump の種類によらず最初のステップで止まる（major でも、`packages/state` の 3.x のコードを 4.0.0 として出してしまうため）、(2) `private: true` のパッケージ（state-next）をビルド・テスト・版の更新・コミット・公開の対象から外す。`scripts/generate-sri.mjs` も private のパッケージを外し、`emit-builtin-tags.mjs` の SKIP に state-next を足した（state-next の dist があるとカタログに wcs-state・wcs-ssr が混ざり `--check` が落ちていた）。CLAUDE.md の依存とリリースの段落も直した。**直したもの**: #355・#383 — 数値の添字のパス（`items.0.name`・`groups.0.items.1.v`・行の中の `groups.*.sel.0.id`・`for: groups.0.items`）に `wcs/template-syntax` を出さない。存在は書いたままの形、なければ添字を `*` に読み替えた形で照合（`stateSchema` も同じ。型・hover も読み替えた候補から引く。`$watch` のキーも同じ）。`[wcs/wildcard-rank]` #1403 — 検出する: 束縛のパスの各 `*` の手前を、囲む `for:` の段ごとのリスト（相対 `for:` を合成した形）と比べる（属性・mustache・コメント束縛・`for:` の右辺。warning）。`substr` と 3.x のフィルタの旧名（`uc`・`fix` …）— ランタイムと同じ `wcs/filter-unknown`（warning）で、文面が書き換え先を言う（`substr(2, 3)` には `slice(2, 5)`、負・非リテラルの引数は一般形 `slice(start, start + length)`）。hover も同じ。拡張にコードアクションの仕組みが無いので、クイックフィックスは付けない。`wcs/name-alias` — API の旧名（`$trackDependency`・`$untrackDependency`）を error（4.0 は読んだ時点で #1701）。宣言キーの旧名（`$streams`・`$updatedCallback`）は単独でも `wcs/declaration-alias`（error、#1601。class 構文の state は warning）。`wcs/declaration-alias-read` の文面も 4.0 に。`$scan` は 1 件の `wcs/scan-declaration-invalid`（error。4.0 は読み込み時に throw）にし、3.x のエントリの検査と `wcs/scan-source-computed`・`wcs/scan-path-missing` は外した。`$behavior`・`$features`・root の `features=` — 新設 `wcs/behavior-invalid`（キー・boolean・オブジェクトでない・ボリューム）・`wcs/feature-unknown`（8 つの名前、did-you-mean。分割 auto のランタイムと同じ code）・`wcs/features-invalid`（配列でない・ボリューム。root 以外の `features=` は warning）。キーと値の型・名前は manifest（`behaviorOptions`・`features` — 下の (b)）から読み、拡張は自分の表を持たない。#203 — `for:`・`if:`・`elseif:`・`else:` のテンプレートの中の `outerHTML:`・`outerText:`（明示のプロパティ形も）を `wcs/template-syntax`（error）。#204 は実行時にしか分からないので静的には出さない。#120 — 新しいパーサがそのまま `wcs/binding-syntax`（error）で報告する（属性・mustache・コメント束縛。パスを指さない右辺は対象外）。テストを足した。コメント束縛 — 有効な束縛のまま（FOUC の勧めも同じ）。`findAllCommentBindings`・`findAllMustacheSyntax` は複数行の式を拾う（コメントの終わり・タグの始まりはまたがない）。`<textarea>`・`<title>`（と `<script>`・`<style>`）の中のコメントは束縛として扱わない。4.0 に無い `commentTextPrefix` の引数は外した。走査は `<template>` の深さと raw text の範囲を 1 回だけ集める（式ごとの全文走査をやめた）。`#direct` — 補完の候補と hover に足し、イベント束縛（`on*:`）以外では無視されるので `wcs/template-syntax`（warning）。preamble — `$trackDependency`・`$untrackDependency`・`$scan`・`$streams` の型を外し（書けば型エラー）、`$behavior`（boolean の 3 キー）と `$features`（名前）を型付けする。語彙 — 上のほか、マウントしたコンポーネントの `$recursion` を error に（4.0 は `[wcs/mount-dollar-declaration]` で拒む。code は `wcs/recursion-declaration-invalid` のまま）。`wcs/updated-callback-unbound` は `$renderedCallback` だけを見る。`wcs/feature-not-installed`・`wcs/recursion-context`・#204 は実行時だけのもの（README に書いた）。検証の指摘（2026-10-02）で直したもの: ボリュームの文面（4.0 のボリュームは読み込みを通らず、接ぎ木を拒んで `console.error` — `wcs/declaration-alias`・`$scan`・`$behavior` / `$features`・`$recursion`）、#203 の誤検出（行の中の構造でない `<template>` の中・`textContent:` / `innerHTML:` などを束縛した要素の子孫は報告しない）、#120 で拒まれたパスに `wcs/binding-path-missing` を重ねない、`$features` の要素・`$behavior` の値の隣のコメント、`$scan: undefined` を宣言なし扱い、`features=` の検査の早期 return、README の重大度の例外（`wcs/filter-unknown`・`wcs/wildcard-rank` は 4.0 では throw するが warning — 実行時のフィルタ登録が見えない・for のスコープの再構成が厳密でないため）と「47 の組み込みフィルタ」、`ensure-state-dist.mjs`（古いリンクの検出・`.d.ts` の確認・並行ビルドのロック）。**テスト**: vscode-wcs 1,089 件（型検査も通過。カバレッジは閾値なし、全体 92 / 86 / 88 / 95 — (b)(c) の前の計測）、lint の smoke 22 件、typescript 56 件。リポジトリの HTML への `wcs-validate` の結果は切り替えの前後で同じ（0 error・102 warning・26 info）。vsix のパッケージも作れる（公開はしていない）。**決めたこと**: `#番号` のメッセージの解読はしない — 文は diagnostics の後付け（`src/diagnostics/messages.ts`）にだけあり、`/parser`・`/manifest` は文を出さない。出すには state-next の公開面を足すことになり、3.3 にそろえた `public-surface.test.ts` に当たる。README には「番号の付いた文面のコードは lint と同じ。文は全部入りの `auto` が出す」と書いた。**残り（判断が要る）**: ~~(a) 実行時の文面の lint への誘導 — `src/diagnostics/explain.ts` は #1403（`ranges over the rows of`）と #203（`replaces its element`）を「lint が検出しないもの」として `LINT_HINT` を付けない。lint が検出するようになったので外すか~~ 済み（2026-10-02）: 除外から外し、#1403 と #203 の実行時の文面にも lint への誘導を付ける（diagnostics の後付けだけの変更。#117 のパスの段の上限、#204、formats の後付けの壁は lint が検出しないので、引き続き付けない）。~~(b) manifest に `$behavior` のキーと後付けの名前を載せるか（config-impl-plan §4 段 4 の未決）。(c) lint が見ていない 4.0 の形: ボリュームが拒む `$watch`・`$listKeys`・`$renderedCallback`・`$stream`、マウントしたコンポーネントで走らない `$watch`・`$stream`・`$renderedCallback`（`[wcs/mount-dollar-declaration]` の警告）、`$0`・`$129`（`[wcs/index-param-range]`。`$129` は段数の `wcs/wildcard-rank` になる）。~~ 済み（2026-10-02、ユーザーの決定で両方やった）: (b) state-next の manifest に `behaviorOptions`（キーごとに `{ type: "boolean", default: true }`）と `features`（8 つの名前）を足した。`features` は `load.ts` の許可リスト（`FEATURE_NAMES` として出した）から作り、`behaviorOptions` は engine.ts の `BEHAVIOR_KEYS` の写し（manifest は engine を import しない。表を config.ts へ移して共有する形は core +4 B・auto +19 B だったのでやめ、core は 0 B）。添字の上限 `MAX_INDEX_PARAM` と `INDEX_PARAM` は `parser/define.ts` に移して engine と manifest が共有（費用 0）。`public-surface.test.ts` は 3.3 との差を「4.0 が足した 2 項目」として固定し、manifest＝engine の `BEHAVIOR_KEYS`＝ランタイムの表＝分割ビルドの `FEATURES`（`build.mjs`）を突き合わせる。`bundle.test.ts`（最小化した manifest）も新しい項目を見る（mangle の対象外の名前なので引用は要らない）。vscode-wcs は `configDeclarationValidator`・preamble・文面をこの manifest から作り、src の表と突き合わせていたテストは「拡張の表＝manifest」に置き換えた。(c) 新設 `wcs/volume-declaration`（ボリュームが拒む `$stream`・`$watch`・`$listKeys`・`$renderedCallback` は error、実行しない `$commandTokens`・`$eventTokens`・`$on`・`$errorCallback` は warning。表は `scopes/volume.ts` とテストで突き合わせる。ほかの code が報告するキーは重ねない）、新設 `wcs/index-param-range`（`for` の中の `$129`〜`$999` と、スクリプトの `this.$0`・`this.$129`・`this["$1000"]`。error。上限は manifest から）、マークアップの `$0`・`$01`・`$1000` は実行時と同じ `wcs/binding-path-missing`（ただし error — 実行時にバインディングが失敗する）。`for` の外の `$129` は実行時が #1401 なので従来どおり。マウントしたコンポーネントで動かない宣言（`INERT`）は静的には出せない: 4.0 のコンポーネントの state はホスト要素のプロパティ（JS）だけで、`<wcs-state bind-component>` の中のスクリプトや `state`/`src`/`json` はランタイムが拒む（3.x も同じ）。代わりにその併記を新設 `wcs/bind-component-source`（error）で報告し、その中のスクリプトにはほかの宣言・スクリプトの検査を重ねない（`parseLoadedScriptBlocks`。それまでの「マウントしたコンポーネントの `$recursion` は `wcs/mount-dollar-declaration` で拒まれる」報告は外した）。検証の指摘（2026-10-02、指摘者 K）で直したもの: `<wcs-state>` の走査が `<script>`・`<style>`・`<textarea>`・`<title>` の中身（JS で作る shadow DOM の `innerHTML` の文字列など）の `<wcs-state>` を数え、`wcs/second-root` を誤報していた（走査が raw text を飛ばすようにした。`<wcs-state>` の中のスクリプトの文字列の `</wcs-state>`、root の判定の文字列の `<template>` も）。for の外のパターンパス・省略パス・ループの添字を、ランタイムと同じ `wcs/wildcard-rank`（#1401 / #1402。warning のまま）にした（それまでは `wcs/template-syntax`。mustache の `{{ $1 }}` も報告する）。(c) の残りの洗い出しで、小さいので足したもの: 同じ root の 2 つ目の `<wcs-state>`（新設 `wcs/second-root`、error。4.0 の #47）。ボリュームの `$watch` のキーの存在（`wcs/watch-path-missing`）は検査しないようにし、ボリュームの `$behavior: undefined`・`$features: undefined` を宣言なし扱いにした（ランタイムは `!== undefined` で拒む）。どれも throwaway の happy-dom のテストで state-next の実際の挙動を確かめた。リポジトリの HTML への `wcs-validate` は変わらず 0 error・102 warning・26 info（新しい code の検出 0 件）。**見ていない 4.0 の形（静的に見られるが小さくないもの）**: ページのスクリプトの `bootstrapState({ … })` の知らないキー・移ったキー（`enableMustache` などは `$behavior` へ）・消えたキー（`debug`・`commentTextPrefix`・`enablePropagationContext`）— 設定のキーと型の表が manifest に無く、`<wcs-state>` の外のスクリプトを読む仕組みも要る。`bind-component` の置き場所（カスタム要素の直下でない・配線の無い Light DOM）— 親の判定に宣言的 Shadow DOM の組み立て直しが要る。DCC の `$bindables`・`$commands` の要素（存在しない・メソッドとデータの取り違え・`$` 始まり・重複）。 (d) `quoteAware.ts` の写しは、4.0 の `/parser` が `indexOfOutsideQuotes`・`splitOutsideQuotes` を出しているので正本へ委譲できる（未着手）。 |
| `@wcstack/typescript` | 前置きの型から旧名（`$trackDependency`・`$untrackDependency` など）を外す。`WcsThis` などの型の出所を R2 に合わせる |
| `@wcstack/testing` | `file:../state` で state を使う。state-next でテストを流す（`createStateAsync` は足し済み） |
| `@wcstack/server` | 依存 `^3.3.0` を `^4` へ。SSR の出力は 3.3 と互換が無い（版の検査でクライアント描画に倒れる）ので、移行ガイドに書く。server 自身の変更は不要（後付け 5 で確認） |
| `wcstack`（入口パッケージ） | state の `/auto` を取り込むので、新しい auto で作り直し、サイズを記録する |
| `@wcstack/router`（N1 の (a)、2026-10-02） | **済み（2026-10-02）**。**2026-10-03 に main の 3.5.0 を取り込み、router の src とテストは main の #404（このブランチの 45861afb を 3.x に移すときに硬くしたもの）に置き換わった — 下の「表示中のルートの再表示は内容を動かさない」は #404 で「持ち出してすぐ戻す」に変わった（§3.2）。** 退出したルートが state の描いた行・枝を残す穴を直した（router が着地のルートを先に挿入し、state が後からマウントしてページの走査で `<wcs-route>` の直下の構造テンプレートを描く形。CDN の auto でふつうの順序。3.x の state でも同じく残り、戻ると束縛の適用の失敗を出していた）。`showRoute` は初めての表示で内容の後ろに終了の印 `<!--@@wcs-route-end:<absolutePath>-->`（SSR の終了マーカーと同じ文面）を置き、`hideRoute` は placeholder からその印までの範囲（元のノード・アンカー・描いた行・枝）を DocumentFragment に移して `route.held` に持ち、`showRoute` はそれを戻す。`childNodeArray` は binder に渡すために元のまま残す。範囲の外へ移された自分のノード（body へ移したダイアログ）は従来どおり外し、内容の中の元の位置で持つ。親を持たない元のノード（state がアンカーに置き換えた template）は戻さない。表示中のルートの再表示（パラメータの変化）は内容を動かさない。SSR: サーバーは終了の印を二重に置かず（`showRoute` が置いたものを使う）、開始の印を placeholder の直後に置く。クライアントの採用は終了の印を残してルートの範囲の終わりとして使う。確かめたもの: 入れ子のルートとレイアウト、outlet の `:empty`（印はコメント）、view transition（範囲の移動は arbiter に渡す変更の中）、3.x の state（`packages/state/dist`）と state-next の両方の結合テスト、router の単体テスト 791 件と e2e 135 件（router の dist を一時的に作り直して流し、コミット済みの dist に戻した）。サイズ（gzip）: `auto.min.js` 13,251 → 13,367 B（+116）、`index.esm.js` 48,257 → 48,951 B（+694。最小化しない ESM で、コメントを含む）。どちらもワーキングツリーの src を一時の出力先で作って測った（コミット済みの dist は古い）。後から binder に渡されたルートの直下の構造テンプレート（ナビゲーションで入ったルート、state が先に束ねたページ）: **決定（2026-10-02、ユーザー）: 指摘者 D の案で #204 を緩めた**。binder プロトコルの `bind(subtree, options?)` に省略できる第 2 引数 `IWcsBindOptions` を足し（正本 `/protocol/binder.ts`、写しは `scripts/sync-protocol-types.mjs`。版は 1 のまま）、`{ range: true }` は「呼ぶ側が範囲を持ち運ぶ」の宣言。この router は `bindRouteContent` と `_offerInitialContentToBinder` で宣言を渡し、`<wcs-head>` は渡さない（要素 1 つだけを追う）。state-next は宣言があるときだけ #204 の確認を飛ばして描く（別々に渡された `if:`／`else:` は 1 つの連鎖）。宣言の無い呼び出し（古い router、`<wcs-head>`、ほかの挿入元）は従来どおり #204。3.x の state は第 2 引数を無視する（描かず、束縛の適用の失敗のまま）。確かめたもの: 遷移で入ったルートと入れ子のルートの直下の `for:`／`if:`+`else:`、state が先に束ねたページ、SSR の往復、3.x との組み合わせ、e2e 135 件。サイズ: state core +10 B（core.min.js、単独で測った差）、router `auto.min.js` 13,367 → 13,383 B（+16）。レイアウト（`<wcs-layout>`）の中のルート（2026-10-02 に直した。指摘者 D の調べ）: 遷移で入ると、`bindRouteContent` の時点では内容がまだレイアウトの outlet に入っていない（`LayoutOutlet` は `await layout.loadTemplate()` の後で中身を移す）。(a) 初めて入ったときのルートの内容が束ねられなかった（2 回目からは束ねる。3.x も同じ）。(b) **4.0 の退行**: レイアウトのテンプレート自身の束縛（`<b>{{ msg }}</b>` など）が、遷移で入ると二度と束ねられなかった（1 回目に空の outlet の要素が渡されて走査済みになり、後から入った中身が飛ばされる。3.x は 2 回目から束ねた）。直し方（router 側。binder プロトコルの D5「挿入の後に渡す」を守る）: `LayoutOutlet._initialize` が、中身を自分の light DOM に置いた後で、置いた要素を範囲を持ち運ぶ宣言付きで binder へ渡す（shadow の分岐は light DOM の子、shadow でない分岐はテンプレートを置いた直下の要素。binder が居なければ渡さない — `src/routeRange.ts` の `offerToBinder`）。3.x の state でも同じく直る。shadow root の中のテンプレートはページの state の対象外のまま。確かめたもの: 3.x と state-next で、初めての入場からルートの内容とテンプレートの束縛を束ね往復で重ならない、shadow／非 shadow、入れ子のレイアウト、着地、e2e 135 件。サイズ: router `auto.min.js` 13,383 → 13,413 B（+30。渡す箇所を 1 つにまとめた後）。既存の制限（3.x も同じ。README に書いた）: router と outlet が binder に渡すのは要素だけなので、ルート本文やレイアウトのテンプレートの直下の（要素に包まれていない）テキストの `{{ }}` は、遷移で入ると束ねられない（着地では state の最初の走査が束ねる）。要素で包めば束ねる。テキストノードも渡す形は採らない（テキストノードには走査済みの印が無く、再入場で描いた値〔`{{` を含みうる〕を束縛として解釈し直してしまうため） |
| `@wcstack/devtools` | **済み（2026-10-03）**: プロトコル v2 のままで、改修は不要（後付け 6 で確認）。型のずれを見るテスト（`packages/devtools/__tests__/protocol.typesDrift.test.ts`）は、v2 の型宣言を 3.5.4 の写し（`__tests__/fixtures/state-3.5.4-devtools-types.ts.txt`、凍結）と突き合わせ、4.0 のランタイムとは実物の形を突き合わせる — happy-dom の上で全部入りの入口を入れ、送られたイベント（4.0 が送る種別をすべて起こす）・要約・鍵付き購読・ソース・レジストリのキーが、消費側の宣言するメンバ（`absoluteAddress`・`binding`・`listIndex` の参照先と、聞き手の呼び出しも）を含むかを見る。4.0 が持たないもの（`getDeclaredBindings`・`listIndex.index`・`state:binding-cleared`・`propagation:*`・overlays の中身）は理由つきの表にし、現れたら落ちる。ci.yml は `packages/state` の変更で devtools と router（`routeRange.state.test.ts` も state の src を流す）も選ぶ |
| I/O パッケージ（41）の bootstrap | **済み（2026-10-01、§8）**: `setConfig` を state-next と同じ規則にした（知らないキー・型の違う値・定義していないタグ名で throw、何も当てない。undefined は飛ばす）。autoloader の読まれていない `scanImportmap` を消した。残り: 各 README の設定の節と移行ガイド（§5） |
| wcstack-skill（別リポジトリ） | `$scan` の削除、旧名の削除、`substr` の削除（`slice` へ）、イベントの委譲（バブリングするイベントの `currentTarget` がルート）と、委譲しない修飾子 `on*#direct:`（要素に直接付く。`#stop` で祖先のページ側のリスナーを止める、祖先の `stopPropagation()` に影響されない、外側の `#direct` は中の委譲のハンドラより先に走る）、コメント束縛（`<!--@@: path-->`）は 4.0 も支える（`enableMustache: false` のページでも束ねる。`<textarea>`・`<title>` の中は束ねない）こと、エラーの番号、`bootstrapState` から `$behavior` へ移った 3 キー、`$features`・root の `features=`・分割 auto（`dist/split/auto.js`）、全パッケージの `bootstrapXxx` が知らないキーで throw すること、autoloader の `scanImportmap` の削除などを反映し、プラグインの版を上げる。CSP の記述の誤りも直す（§3.1。4.0 を待たずに直せる） |

### 3.1 wcstack-skill の CSP の記述（2026-09-28）

docs/csp（ja / en）と README で直した誤り 2 つ（§8 の 2026-09-28）が、wcstack-skill にも残っている。3.x の挙動についての記述なので、4.0 を待たずに直せる。正本は docs/csp（ja / en）。

- 誤り 1: 「ページの nonce では救えない」。実際は、state／router を読み込む `<script>` に nonce を付ければ、blob: の import はその nonce を引き継いで通る。nonce を付けられないときだけ `script-src blob:` か `src=` が要る（ガードには `src=` が無いのはそのまま）。
- 誤り 2 は skill には書かれていないが、足すべき事実: `<wcs-state>` の中の `<script type="module">` はブラウザも評価するので、トップレベルのコードが 2 回走る（CSP の有無によらない）。トップレベルに副作用を置かない。

手元の写し（`~/.claude/skills/wcstack-app`）で見つけた、直す場所:

| ファイル | 行 | 今の記述 | 直す向き |
|---|---|---|---|
| `SKILL.md` | 58 | 本番／CSP の項: 「a page nonce does not help」「Route guards are blob:-only with no `src=` escape」 | state／router を読み込む `<script>` に nonce を付ければ blob: は要らない |
| `SKILL.md` | 196 | 落とし穴の表: 「the page nonce does not carry over」 | 同上 |
| `references/state-binding.md` | 77 | 表: 内包 `<script>` の要求が `script-src blob:` だけ | 「state を読み込む `<script>` に nonce、または `script-src blob:`」 |
| `references/state-binding.md` | 79 | 「The page's nonce cannot rescue method 5」 | nonce で救える。`src=` は引き続き推奨（blob: も nonce の受け渡しも要らず、2 回の実行も起きない） |
| `references/state-binding.md` | 81 | 「`<wcs-guard-handler>` is blob:-only with no escape hatch」 | router を読み込む `<script>` に nonce を付ければ通る。`src=` が無いのはそのまま |
| `references/state-binding.md` | 630 | まとめの 16: 「the page nonce does not carry over」 | 誤り 1 と同じ |
| `references/router-and-scaffold.md` | 180 | 「Guards force `script-src blob:` under a CSP」 | 81 行目と同じ |
| `references/router-and-scaffold.md` | 434 | まとめの 10: 「Route guards require `script-src blob:`」 | 81 行目と同じ |

あわせて足すとよいもの:
- 分割エントリの CSP（docs/csp §2.1）: 要るのはホストの許可だけ。README の例（import map とインラインの起動スクリプト）は、2 つに nonce かハッシュが要る。
- Firefox では、3.x の state と 3.3.0 までの router が CSP を断定できない（非断定の文面になる。docs/csp §9）。

### 3.2 3.5 の準備で見つかった 4.0 側の課題（2026-10-02）

R3 の決定（3.5 を最後の minor にする）に沿って、main から 6 つの PR を出した（wcstack#403 CSP の文書、#404 router の範囲の移植、#405 state の `[wcs/v4-migration]` 警告、#406 全パッケージの bootstrap の警告、#407 lint の 4.0 への案内、#408 移行ガイド。wcstack-skill#27 は CSP の記述）。その検証で見つかった、このブランチ側で直すもの:

2026-10-03 に main の 3.5.0（`dda6320c`）を取り込んだ（§8 の「main の 3.5.0 の取り込み」）。**済み** はその取り込みで片付いたもの。

| 対象 | 内容 |
|---|---|
| SSR（高） | **済み（2026-10-03、research/fix-runtime）**: 版の違う出力（3.x の `@wcstack/server` のもの）はスナップショットを捨て、`legacy()` が 3.x の印を外して（行・枝を除き、テキストの印をコメント束縛に、テンプレートの印を戻し、`data-wcs-ssr-id` を外す）クライアントで描く。ページから配線した Light DOM のコンポーネント（丸ごと・部分マウント・私有のキー・入れ子）は、ホストの配線を通してパスを戻す。印の正規表現は 3.x と同じ `^@@wcs-(?:for\|if\|elseif\|else):`、終わりの印が無い始まりは触らない。テンプレートの外のテキストはフィルタを失う（警告と移行ガイド §3.6）。**3.5.3 の版の門（2026-10-03、research/ssr-3x-353）**: `<wcs-ssr version>` が 3.5.3 以上（プレリリース・読めない版は前と数える）なら、テキストの印は 3.x の #373 でフィルタ込みの式（Light DOM の子では子の語彙）なので `own()` を通さずそのままコメント束縛にし（`state.x: v; state.v: w` の子が `host-v / host-v` になる読み違えを直す）、コメントに入らない式（`--`）でパスに戻った印は私有のキー（`#mN.`）だけ配線で戻し（配線したキーは子の語彙として読む制限、§3.6）、警告のフィルタの文は 3.5.2 までの出力にだけ付ける（ssr の後付け +52 B）。ゴールデンは `scripts/ssr-3x.mjs`：`ssr-3x.json`（3.5.0 の dist で生成、凍結）と `ssr-3x-353.json`（3.5.3 の dist）・`__tests__/ssr-3x.test.ts`。**3.5.4 の出力（2026-10-03、research/ssr-3x-354）**: 3.x の #427 でコメントに入らない式の印は Light DOM の子が書いたパス（3.5.3 は `#mN.other`・`user.name` とページのパス）になり、上のそのまま読む扱いで値がフィルタ抜きで出るので、配線したキーが空のままになる制限は 3.5.3 の出力だけに残る（`legacy()` の変更なし・サイズ不変、`#mN.` の戻しは 3.5.3 のために残す。ゴールデンは `ssr-3x-353.json` も凍結し、3.5.4 の dist で `ssr-3x-354.json` を足した）。逆（server 4.0 ＋ client 3.x）は実測して移行ガイドに書いた（テンプレートの外の `data-wcs` 属性の束縛だけが追従し、テキスト・行・枝はサーバの HTML のまま）。ssr の後付けは 3,703 → 5,071 B（2026-10-03、3.5.3 の版の門まで） |
| 旧フィルタ名（中） | **済み（2026-10-03、research/fix-runtime）**: 診断の後付けに旧名の表（`diagnostics/explain.ts` の `RENAMED_FILTERS`。3.x の `builtinFilterAliases` の 10 項目）を持たせ、`"uc" was renamed "upper" in 3.2 and removed in 4.0 — write "upper".` と案内する。旧名と `substr` には did-you-mean を出さない。ページが旧名を自分で登録すれば、それが使われる |
| lint（中） | **済み（2026-10-03、research/fix-lint）**: 読める `src=`（`.js` は `.ts` を先に）とインラインのボリュームのキー・メソッドを、root の `$watch` と束縛の既知のパスに足す。読めない state（読めない `src=`・素のリテラルでない／spread・読み込み元の無い要素。読めた空の state は「読めた」）のマウントパスの下とその祖先、読めないページの root の持ち分は黙る（`<template>` の中と `bind-component` はページの root の判定に数えない）。root の `$watch` は自分の木のボリュームと照合する（自前の root を持つ最も内側の `<template>`。route・レイアウトの雛形の中のボリュームはページの root）。stateSchema があれば schema で判定するが、読めない state のハンドラは除く。`wcs/delegated-current-target` もボリュームのメソッドを見る。`wcs-schema` はインデックスシグネチャの型を `{}` にする（main も #421／#422 で同じ修正）。リポジトリの `wcs-validate` は CI の 76 件で変わらず、e2e を含む 89 件では `e2e/fixtures/mount-volume.html` の誤検出 2 件が消えた。既知の制限: ページの root が読めるかの判定は文書全体に効く（読めないページの root があると、読める宣言的 shadow root の中の打ち間違いも黙る。逆も）。計算キーだけのリテラルは「読めたが空」。3.x の lint にも `src=` の同じ穴があるが、そのまま移せるのは `statePathResolver.ts` だけ（ボリュームの `$watch` が相対で動く、メソッドを接ぎ木しないなど、規則が違う） |
| lint | **済み（2026-10-03）**: `substrRewrite` は 2 つとも 0 以上の整数リテラルのときだけ具体形を出す（負の length は一般形だけ）。`bindingValidator.test.ts` に `2,-3`・`2, -1`・`1.5,2` を足した。元の指摘: `substrRewrite`（`removedNames.ts:71-77`）が負の length を許し、`substr(2,-3)` を `slice(2,-1)` と案内する。具体形は 0 以上の整数リテラルだけにする（3.x の #407 はそうした） |
| lint | **済み（2026-10-03）**: 新設 `wcs/delegated-current-target`（warning）。#407 の判定（`scriptAst.ts` の `readsEventCurrentTarget` — acorn、最初の `await` の被演算子まで）と、要素の文脈を 1 回の走査で決める `forContext.ts` の `analyzeElementContexts`（router の route の `<template>` は対象、自前の `<wcs-state>` を持つ `<template>` は対象外）を移した。委譲されるイベントの表（`bindingValidator.ts` の `DELEGATED_EVENTS`）は `dom/view.ts` の `BUBBLING` とテストで突き合わせる。#203 の `outerHTML:` もこの走査に載せ、route の中の `for` / `if` も報告するようにした。テストは `__tests__/delegatedCurrentTarget.test.ts`、lint の smoke に 1 件。`examples/state-tilt-maze` は main の `on*#direct:` の形を取り込んだので、リポジトリの `wcs-validate` は 0 error・102 warning・26 info のまま。元の指摘: 委譲されるイベントのハンドラが `event.currentTarget` を読む形を、4.0 の lint は検出しない |
| router | **済み（2026-10-03）**: router の src とテストは main の #404 を取った（45861afb を置き換える）。binder への `{ range: true }`（`ROUTE_RANGE`）も #404 にある。このブランチに残したのは `routeRange.stateNext.test.ts`（state-next との結合。パラメータの変化で表示中のルートを持ち出して戻しても、直下の `for:` / `if:`+`else:` の行と枝が並びを保ち重ならないテストを 1 件足して 10 件）と、`routeRange.state.shared.ts` の「両方のエンジンで流す」の注記。router は 825 件すべて通過。元の指摘: #404 で 3.x に移植するときに直した点を、このブランチの router にも入れる: 表示中のルートの再表示（パラメータの変化）は範囲を取り出して戻す（45861afb は「動かさない」ので、実ブラウザで直下のカスタム要素が再接続せず、`connectedCallback` で新しいパラメータを読めない）／表示するすべてのルートにパラメータを割り当ててから置き、再表示の子は親と一緒にだけ動かす（入れ子の子が古いパラメータで一度つながる）／`hideRoute` を冪等に（2 回で描いた行を失う）／動かすノードを先に決める（移動中の `disconnectedCallback` で無限ループや `appendChild(null)`）／一度置いたルートは書かれたノードから置き直さない（終了の印を消されると、state がアンカーに置き換えた template が戻る）／印が無いときの範囲はほかのルートの印で止める |
| router | **済み（2026-10-03）**: main の `deepClone` の配列の扱いを、このブランチの（投げる）`config.ts` に入れた。main の `config.test.ts` のテストがそのまま通る。元の指摘: `getConfig().basenameFileExtensions` が配列でなく `{ "0": ".html" }`（`deepClone` が配列を扱わない。cda5f99c の router にも同じ）。#406 で 3.x は直した |
| 例 | **済み（2026-10-03）**: main の書き換え（`state-intersect-scroll` の `$watch`、`state-tilt-maze` の `on*#direct:`）を取った。元の指摘: `examples/state-intersect-scroll` の `$scan`（4.0 では読み込みで throw）。#405 で `$watch` に書き換えた。このブランチの例も同じ形に |
| 文書 | マウントしたコンポーネントの `$commandTokens`・`$eventTokens`・`$on`・`$errorCallback` は 4.0 では動く（3.x は動かさず警告した）。移行ガイド（`docs/migration-v4(.ja).md`、2026-10-03 の取り込みでこのブランチにも入った）に書いた。README は残り |
| 初期化の失敗 | **済み（2026-10-03、research/fix-runtime）**: (a) 失敗の見出しは要素とソースを名指す（`[@wcstack/state] <wcs-state src="…"> failed to initialize.`、#49。1 回だけ）。束縛を組み上げた後の失敗は `$connectedCallback failed.`（#50）として出し、`connectedCallbackPromise` は reject、`getBindingsReady` は resolve。(b) DCC の定義と `bind-component` の失敗は reject する（ボリュームは 3.x と同じく resolve — `Claimed.lenient`）。引き取られた要素も、組み上げた時点で `getBindingsReady` が resolve する（`Claimed.start(state, built)`）。根が失敗したときに配線していたコンポーネントは、3.x では `connectedCallbackPromise` が決着しなかったが、4.0 は reject する（`@wcstack/server` の `renderToString()`・`@wcstack/testing` の `mount()` も reject）。移行ガイド §3.4・§3.5・§4.2 |
| lint（取り込みのレビューで見つけたもの） | **済み（2026-10-03、research/fix-lint）**: (a) schema の数値の段は、親が配列のときだけ `*`、そうでなければ素のキー。(b) #203 と `wcs/delegated-current-target` は、中身を束ねる state がある template の中だけを見る（自前の state・`<wcs-router>`・`<wcs-layout layout>`。router の既定のタグ名と `enableShadowRoot: false` を前提とし、README に書いた） |
| main との統合 | **取り込んだ（2026-10-03、3.5.0）**: vscode-wcs は 4.0 の規則を基にした（`indexPath.ts` はこのブランチの版。1.20.0 / 1.21.0 の 3.x の規則と `wcs/v4-migration` は持ち込まず、4.0 でも成り立つ部品だけを移した — vscode-wcs の CHANGELOG の Unreleased）。`public-surface.test.ts` の比較元（`packages/state/dist`）は main の 3.5.0 の dist になり、手を入れずに通る。**済み（2026-10-03）**: 3.4 / 3.5 の state の修正が state-next でも成り立つかの確認は、下の「3.x の修正の確認」の行。元の指摘: main は 3.4.0（#379・#393・#394 など）と上の 3.5 の PR で進む。取り込むときに、vscode-wcs の 1.20.0 と 4.0 への切り替えがぶつかる（`indexPath.ts` は両側で新規）、3.4 の修正が state-next でも成り立つかの確認、`public-surface.test.ts` の比較元を 3.4 の dist に |
| 3.x の修正の確認（2026-10-03） | 3.4.0〜3.5.1 の state の修正のシナリオ 676 件を state-next に移した（`__tests__/regression-3x-*.test.ts` の 10 ファイル）。643 件はそのまま成り立ち、成り立たなかった 33 件は次で直した（意図した失敗は 46 → 15 件。残りは 3.x 由来ではない既知の制限）。**engine**（research/fix-engine）: #332 先頭が数値のキー、#388 字面どおりの getter の誤報、#366 getter・数値のパスの `$eqIndex`、#362 写しから元の配列に戻ったときの保った行、#370 `for:` のフィルタは正本パーサが `[wcs/binding-syntax]` #121 で拒む（lint も報告し、後続の診断は重ねない）。**temporal**（research/fix-chains）: #354 `$stream` の再開を含む循環でページが固まる（打ち切って報告）・打ち切りの遅れ・3.x と同じ 33 段、#338 打ち切りの DevTools のイベントと遅れた適用の循環（`carried`）、#389 残った行の行 getter の `$watch`（値が変わったときと、行の外で読んだものが変わったときだけ）。**components**（research/fix-components）: #367・#368 消えた行のコンポーネントが別の行を読む、#331 切り離したメソッド、3.x の #417・#419（`<wcs-state>` だけの差し替えは古いエンジンを引き継ぐ）、cc／dc の対。**SSR**（research/fix-ssr-hydrate）: #258-5 ハイドレーションで行・枝の中のカスタム要素を切断しない。**runtime**（research/fix-runtime）: #411 の見出し・DCC と `bind-component` の reject、#361。方針の決定: #379 は 4.0 の振る舞い（配列を持つ外側の行ごとに発火）を移行ガイドに書いた／#361 は投げる setter でも知らせる／#338 の遅れた適用は「数え直さない」ではなく `carried`（正当な形を打ち切ったため）。残り（後続）: なし（2026-10-05 の既知の制限の作業で、ここに挙げていた 6 つをすべて直した。#362 の `was` の判定は書き込みの時点で行をそろえる形に置き換えて外した — §8「既知の制限の解消」）|

3.x 側で見つかったが 3.5 の PR に入れていないもの（起票の候補）: 3.x の state の binder の `bindNow`（`bindings/binder.ts:57,69-72`）は、自分に `data-wcs` を持つ要素の後ろの兄弟の構造テンプレートを、集める前に普通の束縛として登録するので、ナビゲーションで入ったルートでその `for:` が描かれない（回避はルートの本文を 1 つの要素で包む。router の README に書いた）。

## 4. ビルド・CI・サイズ・計測

- **済み（2026-10-03、research/gates-4x）**: 4 つの検査を 2 つにまとめて作り直した。`scripts/check-state-size.mjs` は dist だけを読み、相対の上限（基準値＋3 %＋任意の slack）と絶対の上限 2 つ（`dist/core.min.js` ≤ 20,000 B、`dist/define.js` ≤ 1,024 B）を見る。`scripts/check-state-coupling.mjs` は src を esbuild でメモリ上に束ね、metafile から次を確かめる: 後付けが自分以外のコードを持たないこと、core の入口が後付けに届かないこと、core ↔ 後付けの import の一覧、評価時に処理を走らせるモジュールの一覧。`check-state-split.mjs`・`audit-state-tech-coupling.mjs`・`audit-state-tech-helper-import.mjs` と `state-split-baseline.json` は外した。helper の検査は `/define` を測る。4.0 の `.` は、`defineState` だけを import しても約 21 KB（gzip）が残り、tree-shake されない（`element.ts` が import だけで残る）ため。数値と規則は CLAUDE.md。以下は元の記述。
- 3.x の `@wcstack/state` の CI の検査 4 つを、新しい出力の形に合わせて作り直す（`--update` で基準値を取り直すだけでは足りない。どれも `packages/state` の 3.x のビルドを前提にしていて、今は state-next を測らない）。
  - サイズの検査（`scripts/check-state-size.mjs`・`scripts/check-state-split.mjs`）と基準値（`scripts/state-size-baseline.json`・`scripts/state-split-baseline.json`）。`check-state-split.mjs` は `dist/split/**.js.map` を読み、3.x の src のディレクトリを後付けに割り当てる（`FEATURE_BY_DIR`）が、state-next はソースマップを出さない。
  - 結合の検査（`scripts/audit-state-tech-coupling.mjs --check`、基準値 `scripts/state-coupling-baseline.json`）。パッケージの `tsconfig.json` で tsc に出力させて import のグラフを読むが、state-next の tsconfig は `noEmit: true`。
  - helper だけの import のサイズの検査（`scripts/audit-state-tech-helper-import.mjs --check --max-gzip 1024`）。パッケージの `rollup.config.js` を import して組むが、state-next には無い（esbuild の `build.mjs`）。
  - core の上限（`dist/core.min.js` の gzip ≤ 20,000B）を確かめる検査も、今は無い（`build.mjs` が表示するだけ）。作り直すときに検査に入れるかを決める。
- **済み（2026-10-03、research/release-4x）: rc のリリースの経路（R8）。** `release.yml` の `version_type` に `premajor-rc`（3.5.4 → 4.0.0-rc.1）・`prerelease-rc`（4.0.0-rc.N → rc.N+1）・`release`（4.0.0-rc.N → 4.0.0）を足した。版の計算とガードは `scripts/compute-next-version.mjs`（semver の順序で計算する。それまでの `sort -V` と `IFS=. read` はプレリリースの後ろの部分を読めなかった）、テストは `scripts/compute-next-version.test.mjs`（`node --test`。ci.yml の `release-plan` と、release.yml の「Plan the release」の最初で流す — research には CI が走らないため）。rc は `npm publish --tag next`、GitHub Release は prerelease（リリースノートの起点は上げる前の版のタグ）、版を上げたコミットとタグは実行したブランチへ push する（`git push origin "HEAD:refs/heads/$GITHUB_REF_NAME"`。ブランチ名は環境変数で渡し、`${{ }}` では埋め込まない — git の ref は `$(...)` を含められるため）。安定版（patch / minor / major / release）は従来どおり `latest` で、main からだけ、main へ push。**ガード**（どれも install・build の前に止める）: (a) state の dist が 4.0 のエンジン（`wcs-manifest.json` の `behaviorOptions`）なら major < 4 を拒む（逆に 3.x のエンジンで 4 以上も拒む。ビルドの後に新しい manifest でもう一度確かめる）／(b) 安定版は main 以外から拒む（4.x に限らない — それまでの `git push origin HEAD:main` は、ほかのブランチから実行するとそのブランチを main に push していた）／(c) プレリリースは main から拒む（main は安定版だけを持つ。rc のコミットが main に入ると、main の次の 3.x の patch が rc から計算される。main の 3.x のコードを 4.0.0-rc として出すこともない。4.0.0 の後に rc が要るときは main から切ったブランチで出す）／タグの ref は拒む／今の版に合わない bump（rc に patch / minor / major — `release` を使う、安定版に `prerelease-rc` / `release`）も拒む。**内部の依存の範囲**（`scripts/align-internal-dep-ranges.mjs`）: 安定版は `^X.Y.Z`、rc は rc の版そのもの（`4.0.0-rc.1`）。`^4.0.0-rc.1` は以後の 4.0.0-rc.N と 4.x に合うので、server rc.1 が state rc.3 と組める（semver で確かめた）— rc どうしは互換を壊しうるし、SSR の版の門は major.minor しか見ない。rc はそろって出るので、`@next` を入れれば同じ rc の組になる。**npm の trusted publishing**: 登録はリポジトリと workflow のファイル名だけ（`scripts/npm-trust-setup.mjs`、`environment` なし。npm にブランチの制限は無い）で、GitHub 側も environment・ブランチの保護・ruleset は無い（2026-10-03 に API で確かめた）ので、research から実行しても公開でき、push も通る。provenance には research のコミットが載る。SRI（`generate-sri.mjs`）は版の文字列を URL に入れるだけで、rc でもそのまま動く（`--version 4.0.0-rc.1` で確かめた）。**レビューの指摘で足したもの（2026-10-04）**: 新しい major が `latest` に載るのは `release`（rc の列の終わり）だけで、`major` はいつも拒む（research を最初の rc の前に main へ入れても、main の `major` で 3.5.4 → 4.0.0 を `latest` に出せない）／プレリリースは `research/state-engine` と `release/*` からだけ／`v<X.Y.Z>` のタグがあれば `prerelease-rc` を拒む・目標の版のタグが既にあれば拒む／Plan と公開の直前で、ブランチがディスパッチの時点の SHA（`$GITHUB_SHA`）から動いていないことを `git ls-remote` で確かめる／目標の版が npm にあるのにタグが無い（前の実行が公開して push の前に止まった、部分的なリリース）なら Plan で拒む — 戻すのは人の判断／`concurrency: release`（途中で取り消さない）／リリースノートの起点（`previous_tag_name`）は計画が決める — 安定版は rc でない最後の安定版のタグ、rc は上げる前の版のタグ。rc のノートの先頭に `npm i @wcstack/state@next`・CHANGELOG の `[Unreleased]`・移行ガイドへの案内。テストは 3.x の木でも通る（エンジンの判定は木がビルドするエンジンと突き合わせる）。dry run は npm・gh・`git ls-remote` / `push` をスタブにして（PATH の先頭にあることを `command -v` で確かめ、本物の npm は届かないレジストリに向ける）、research と main の木で流した。**main への移植**（同日）: main の release.yml にはガードが無く、`major` で 3.x のエンジンが 4.0.0 として `latest` に出る（4.0.0 は二度と使えなくなる）、ほかの ref から実行するとその HEAD を main に push する。`origin/main` から切った `chore/release-guards` に、同じスクリプト・テスト・`align-internal-dep-ranges.mjs`（どれも同じファイル）と Plan の段・再確認・ブランチの確認・`concurrency`・ci.yml の `release-plan` を移した。入力は patch / minor / major のままで、research の写しとの違いは入力と private のパッケージを外す段だけ（4.0 のマージで機械的に合わさる）。main の patch / minor は従来の計算と同じ版になる（dry run で確かめた）。PR は調整役が開く。
- `release.yml` と `ci.yml` のビルド手順を合わせる。state-next は `tsc`＋Rollup ではなく esbuild（`build.mjs`、短縮名の表 `mangle.mjs`）と、その後段の terser（`minify.mjs`）。state を最初にビルドする順序（lint と typescript が取り込むため）は変わらない。
- 4.0 の成果物で、性能とサイズを記録し直す（公式 js-framework-benchmark、DOM 直接との比、`bench/run-all.sh`）。

## 5. 文書

| 文書 | やること |
|---|---|
| `packages/state/README.md`・`README.ja.md` | 新エンジンの規範文書として書き直す。変わった約束: `$scan` の削除、旧名の削除、イベントの委譲（と、委譲しない修飾子 `on*#direct:`。2026-10-02）、要素への書き込みの位置モデル、無いキーへの書き込み、再セットで無いパスは空、エラーの番号、後付けの入口と「状態を定義する前に install する」。「設定」を bootstrap（表記: タグ名・束縛の属性名・コメントの接頭辞・`locale`・`enableContractAnalyzer`）と状態の `$behavior`（振る舞い）に分ける。「分割エントリ」に分割 auto（`dist/split/auto.js`、import map 無しの 1 行）と、`features=`（定義の前に要る scopes・開発環境の diagnostics／devtools）と `$features`（その状態が要る後付け）の役割の違い。品質改善のサイクル 3（2026-10-02）で書くこと: 安全の方針（E13）— state は値をサニタイズしない。`href:`・`src:`・`attr.href:` に入る `javascript:` の URL、`attr.on*:` に入るハンドラの文字列は、CSP（`script-src` から `unsafe-inline` を外す）と作者の検証で防ぐ（`attr.on*:` は拒まない。2026-10-02 にコア担当が決めた。CSP の下ではどのみち動かず、書かれにくい形で、拒む検査はサイズに見合わない）。利用者の HTML は `textContent:` か、サニタイズした上で `innerHTML:`／`html:` に入れる／利用者のコンテンツをサーバのテンプレート（SSR でないもの）やページのマークアップに直接埋めない。ページの走査がその中の `{{ … }}`・`data-wcs`・コメント束縛 `<!--@@: x-->` を束縛として読む（CSTI。コメント束縛は `enableMustache: false` でも束ねるので、mustache を切っても防げない。後続の `data-wcs-ignore` は §2.4）／SSR の制限（E11）: スナップショットは JSON なので、`Date`・`Set`・`Map`・クラスのインスタンスは文字列か素のオブジェクトになって、クライアントの値を上書きする（3.x も同じ）。SSR する状態には JSON の値を置き、`Date` などは getter で組み立てる（`get created() { return new Date(this.createdIso); }`）／SSR の出力のコメントを取り除かないこと（html-minifier の `removeComments` など、後段の HTML の圧縮を含む）。テキストの束縛と行・枝の印はコメントなので、取り除くと注入とハイドレーションの崩れの原因になる（値の中の `{{ }}` がクライアントで束縛として読まれ、行や枝の引き取りも崩れる） |
| 移行ガイド（`docs/migration-v4.md`・`.ja.md`） | **済み（2026-10-04、research/guide-4x）: rc / 4.0 のガイドに仕上げた。** プレビューの断り書きを rc（`next` タグ）の案内に替え、「マークアップの誤りで初期化が止まる」は 4.0 の挙動として確定（コードで確認）、§5 を「既知の制限」として R9 の後続（コードで確認したもの）と回避策で書き直した。`$watch` の行の発火（`for:` / `$listKeys` 不要・行 getter の先行評価・丸ごとの代入は入ってきた行だけ）、`wcs/delegated-current-target`、ボリュームの `data-wcs`・既存パスへのマウント・`mount` の変更、`/core` の 24 フィルタ、`/define`（A1）、レイアウトの先頭の `for:` / `if:` を足した。以下は元の記述。main から入った（#408、3.x の利用者向けのプレビュー）。残りは 4.0 の実装に合わせて仕上げること。 当初の計画: 新しく作る。承認済みの簡素化（volume の注入、volume に書いた `$watch` などがエラー、SSR のインライン snapshot と値の表、`listPaths` などを core に入れない、私有データは要素ごと）と、3.3.0 の不具合を直した差（#319〜#324 など）を並べる。設定の 3 キーが `bootstrapState` から状態の `$behavior` へ移る（切り貼りで済む）、`debug`・`commentTextPrefix`・`enablePropagationContext` が消える、`bootstrapState` が知らないキー・型の違う値で throw するようになる。全パッケージの `bootstrapXxx` も同じ規則で throw する（これまでは黙って無視。`tagNames` の中の知らない名前・文字列でない値も）。autoloader の `scanImportmap` が消える（渡しても効果が無かった）。品質改善のサイクル 1（2026-10-01）で足す差: マウントした部品の `$recursion` は警告ではなくエラー（`[wcs/mount-dollar-declaration]`）／`$listKeys` は部品自身の一覧に効く（3.x は動かず警告）／volume のメソッドをパスで呼べる（`onclick: p.m`、`this["p.m"]`。3.x はメソッドをツリーに出さなかった。4.0 はパスの accessor なので、`Object.keys(p)` には出ない）／カスタム要素の `on*:` も、バブルするイベントは委譲する（`currentTarget` はルート。ハンドラは内側から順に呼ばれ、内側の `#stop` で外側が止まる）。バブルしないで dispatch されたイベント（`bubbles: false` の `CustomEvent` など）だけは要素の上で拾い、その `currentTarget` は要素／同じオブジェクト・配列を表示する束縛は、`$postUpdate` や同じ参照の再代入で描き直される／制限: 再セットの後、`Object.keys(this)`・`in`・`delete`・`JSON.stringify(this)` は古い状態を見る／行の中の委譲イベントで、要素かその祖先の手前に構造のアンカー（`if:`／`for:`）があるとき、または要素がカスタム要素の中にあるときは、ハンドラを要素に置く（`currentTarget` はほかの委譲と同じくルート。要素に置いたハンドラも、ルートの委譲のリスナーから呼ばれる）／`textContent:`・`innerHTML:` の値の中の `{{ }}` や `data-wcs` は束縛として解釈しない（3.x と同じ）／`createStateAsync("readonly")` は `$setAll` と書き込みの `$resolve` を拒む／中身を束縛する要素（`textContent:`・`text:`・`innerText:`・`innerHTML:`・`html:`）の子は、ページでもテンプレートの中でも束縛しない。中の `{{ }}`・`data-wcs`・構造のテンプレートは文字どおりに残る（制限: `#init=element`・`#init=none` で最初の値を当てずに残した子も同じで、作者が書いた子の `{{ }}`・`data-wcs` は束縛されない。SSR でサーバが後から値を書いた中身を束ねないため。中身を束縛する要素の中にマークアップを書くときは、別の要素に分ける）／束縛した要素の子は、束縛の前からあったノードだけを走査する（要素の中で移ったものを含む）。束縛（カスタム要素のプロパティの setter など）が足したノードは走査しない／行の中で束縛を付けるときに失敗すると（未宣言のトークンやメンバー、`#init=auto` の読みの失敗など）、行全体ではなく、その束縛の失敗として `$errorCallback` に届き、行は組み上がる。`info.path` はふつう束縛のパスで、`command.` の束縛では `"$command.<名前>"`（3.x と同じ）、eventToken の束縛ではトークン名。ただし同じ設定の誤りでも、ページの直下（根の mount の走査）では今も例外で、根の要素ごと初期化に失敗する（行の中との食い違いが残る）／1 つの要素に複数のハンドラがあるとき、2 つ目以降は 1 つ目が `stopPropagation` しても呼ばれる（DOM と同じ）。外側の要素のハンドラは呼ばれない／HTML の書き込み先（`html:`・`innerHTML:`・`outerHTML:`・`srcdoc:`）は、同じオブジェクトが来ても書き直さない（上の「同じオブジェクトは描き直す」の例外）／SSR の `outerHTML:`・`outerText:` は、サーバでは当てず、クライアントで当てる。サーバの出力には要素が書いたまま（`data-wcs` 付き、値なし）で載るので、その値は SEO や JavaScript の無い表示には出ない／`for:`・`if:` のテンプレートの中の `outerHTML:`・`outerText:` は、初期化のときに `[wcs/template-syntax] #203` で失敗する（3.x は 1 回だけ当てていた。行と枝はノードを位置で持つため）。代わりに、包む要素に `innerHTML:` を付ける。ページの直下では従来どおり使える。lint・VS Code 拡張も静的に検出する（4.0 に切り替えた lint。実行時の文面にも lint への誘導が付く。§3）／binder プロトコルの `bind()` は、渡されたサブツリーのマークアップの誤り（#101・#203・部品に後から届いた結線など）で投げず、誤りを `console.error` に出す。誤りより前の部分は束ねられ、後ろは束ねられない。誤りを含む要素（祖先）の束縛は付く。router のナビゲーションや `<wcs-head>` の更新は途中で止まらない。ページの初回マウントでの誤りは、従来どおり `<wcs-state>` の初期化を失敗させる。初期構築の前に binder に渡された、誤りを含むサブツリーも、初期化を失敗させない（console に報告する）／ページの直下の `outerHTML:`・`outerText:` の要素の中に作者が書いた子は束縛しない（置き換えでページから外れるため。表示は変わらない）。差ではないもの（3.x と同じ挙動。4.0 の開発中に壊れていたのを直した）: SSR で、スナップショットを持つ根では、volume がマウントパスのサーバのデータを採用する（D14）。品質改善のサイクル 2（2026-10-02）で足す差（後付け）: `$listKeys` の取り直しで、1 段のパスにならないフィールド名（`@odata.etag`・`2fa`・`a.b`）と行の getter と同じ名前のフィールドは、残した行にそのまま入り、行がまるごと描き直される（以前はパスとして書き、`__proto__.x` のような名前で `Object.prototype` を汚せた・途中で投げた）。JSON の自前の `__proto__` キーは写さない／`$watch` の getter の下のパス（`current.name`、`items.*.info.label`）が、getter の変化で発火する（以前は発火しなかった）。行の getter への watch は、行のオブジェクトの差し替え・`$postUpdate("items.1")` でも発火する／SSR の引き取りで、サーバの行の形が計画と合わない行（Light DOM の要素が子を先頭に足す、`<tbody>` を書かない表の `<tr>`）は、引き取らずにクライアントで作り直す。隣り合う別々の `if:` の連鎖も、それぞれの枝を引き取る（以前は取り違えた）。同じくサイクル 2 の差（core）: `$postUpdate` は、その下の `$eq`／`$eqIndex` の購読にも届く（3.x と同じ。前の値が分からないので、全キー・全行を無効化する）／`$eqIndex` の元のパスが getter かその下にあるときは、追跡付きの読みとして振る舞い、祖先のオブジェクトを置き換えても選択が動く／再セットした状態に、描いている一覧のキーが無くても、再セットは途中で止まらない（`for` の失敗として報告し、その一覧は前の行を残す）／binder（router のルート内容、`<wcs-head>`）に直接渡された構造のテンプレート（`for:`・`if:`・`elseif:`・`else:`）は、呼ぶ側が範囲を持ち運ぶと宣言したとき（`bind(subtree, { range: true })`。この版の router が渡す）だけ描き、宣言が無ければ描かずに `[wcs/template-syntax]` #204 として console に報告する（2026-10-02 に緩めた。§3 の router の行）。要素で包めば描く（3.x はこの形を一度も描かなかった。直下の `if:`／`else:` を 1 つの連鎖として描くとした前回の記述は、この拒否で置き換えた）。binder の `bind()` は、文書に接続していないサブツリーを無視する／ネイティブ要素の `command.`・`eventToken.`・`...:` は、定義を待たずにその場で #1202／#1501 として拒む（ページでは初期化の失敗、行では束縛の失敗）／遅れて定義された要素の束縛の失敗と適用の失敗は、定義された時点で `$errorCallback`（無ければ console）に届き、`$renderedCallback` も呼ばれる。定義の遅れたタグを持つ行が多くても、定義されたときの `$renderedCallback` は 1 回にまとまる／定義されないタグを持つ行を消すと、その行は GC される（3.x の DefinitionCoordinator と同じ性質）。品質改善のサイクル 3（2026-10-02）で足す差: イベントの委譲（2026-09-25 の決定）で起きる 2 つの形（F4）— (a) `onclick#stop:` の `stopPropagation` はルートで呼ばれるので、ページ側のコードが祖先の要素に付けたリスナーを止められない（クリックできるカードの中の `#stop` のボタン）。(b) ページ側のコードが祖先で `stopPropagation()` を呼ぶと、その中の `onclick:` は一度も呼ばれない（モーダルの中身がオーバーレイへのクリックを止める形）。双方向の入力は要素に直接付くので動く。3.x は (a) で止まり (b) で呼ばれた。その束縛だけ 3.x と同じにするには `on*#direct:` を書く（サイクル 5 の項。§2.4 の決定）／4.0 は `for:` の行と `if:` の枝の要素から `data-wcs` を外す（3.x は展開したパス付きで残していた）。`[data-wcs…]` で行を選ぶ CSS や e2e のセレクタは、クラスなど別の印に替える（F8）／SSR（後付け）: ページの直下で束縛した Light DOM のカスタム要素が値から描いた子は、サーバの出力に入れない（クライアントで描く）。クライアントがそれをページのマークアップとして読み、利用者の `{{ … }}` や `data-wcs` を束縛してしまうため（E2）。作者が書いた子の中（`.slot` など）に値から描いたものも同じ（サイクル 3 の再検証、R3-5）。作者が書いた子（`{{ }}`・`for:`・`if:` を含む）と、`{{` を含まない文字は残る。中身を束縛するカスタム要素（`innerHTML:`・`textContent:` など）の値は、ネイティブの要素と同じく残る（R3-6）。子を自分で包み直す要素は、包んだ要素ごと外れるので SSR と併用しない／SSR（後付け）: `<textarea>`・`<title>` の中の `{{ }}` は、サーバでは値を出し、元のテンプレートを `data-wcs-raw` 属性で運んでクライアントで束ね直す（以前は印のコメントが文字として見え、値の中の `{{ }}` が束縛された。E5）。同じくサイクル 3 の差（core）: HTML の書き込み先（`innerHTML`・`outerHTML`・`srcdoc`・`html:`）に配列や TrustedHTML でないオブジェクトを渡すと、文字列にして、注入した policy に通す（以前は素通し）。本物の TrustedHTML だけはそのまま通す／`<iframe>` の `attr.srcdoc:` は `srcdoc` プロパティとして policy を通して書く。iframe 以外の要素の `attr.srcdoc:` は属性として書く（`attributeChangedCallback` に届き、null・undefined なら属性を外す）。カスタム要素の `innerHTML:`・`outerHTML:`・`srcdoc:` は、定義を待たずにその場で（policy を通して）書く。接続したときに自分の中身を描く要素では、束縛が書いた中身と要素が描いた中身が混ざりうる（`<i>shell</i><b>bound</b>`）／同じ root に 2 本目の `<wcs-state>` があると、その要素は #47 で初期化に失敗する（3.x と同じく `connectedCallbackPromise` が reject）。v1 の `name="…"` は無いので、部分木は `mount="path"` で接ぎ木する。取り外した後の付け替えは通る。#47 のとき `getBindingsReady(root)` は、束ねた方の結果を返す（#47 で失敗した方の結果ではない）。束ね終えた根は、`$connectedCallback` が reject しても失敗した根とみなさない。その横の 2 本目は #47 で拒み（部品の shadow root の中でも同じ）、その root で待つ volume や、結線を待つ部品も、根の失敗として拒まれない／`state="id"` は、その id の `<script type="application/json">` だけを読む（同じ id の別の要素は無視する。DOM clobbering の対策）／パスに `__proto__`・`prototype` の段があると、#120 `[wcs/binding-syntax]` で失敗する（束縛・代入・`$resolve`／`$setAll`。`this.__proto__` の読みも含む）／formats を入れると、既定のロケールは Intl が受け取る値で使う。`getConfig().locale` は設定した値のまま返す（Intl に合わせて正した値ではない）。フィルタは値が変わったときだけ確かめ、受け取られない値（`<html lang="en_US">` など）なら #48 で 1 回警告して `"en"` を使う（3.x と同じ）。正しい locale を明示すれば、`<html lang>` が不正でも警告しない（3.x と同じ）。既知の差: `<html lang>` を読むのは、3.x（`bootstrapState` の時点）と違い、モジュールを評価した時点のまま／`getBindingsReady(root)` は、その root に接続した `<wcs-state>` で決まる（外したものは、次に `<wcs-state>` が接続するまで数に入る）。どれかが束縛を作った時点で resolve する。`$connectedCallback` は待たない（遅くても、終わらなくても、投げても resolve する。3.x の README の契約と同じ）。reject するのは、その root に接続した `<wcs-state>` がすべて束縛の前に失敗したときだけで、最初の要素の失敗を理由にする。迷い込んだ要素（状態を受け取らないもの、読み込みに失敗するもの、#47 で負けるもの）は、ほかの要素が束ねれば結果に影響しない。尋ねた後に接続した要素も待つ対象に含める。根の `<wcs-state>` を差し替えたとき（外して新しい `<wcs-state>` を足したとき）は、新しい要素が失敗すれば reject、状態を待つ間は pending、束ねれば resolve する。外した方が以前に束ねていたかどうかは関係しない（3.x の README の復旧の手順と同じ）。外した `<wcs-state>` は、次に同じ root に `<wcs-state>` が接続した時点で一覧から外れるので、root の内容を出し入れするたびに要素や状態が溜まることはない。外して戻した `<wcs-state>` は、また数に入る。状態を受け取らない `<wcs-state>` しか無い root では、pending のまま（束縛ができるのを待つ）。制限: その root の `<wcs-state>` がどれも束縛を作れず、そのうちの 1 つが状態（`setInitialState`）を待ち続けている間は、決着しない（状態を待つ要素は、後から状態を受け取る正規の根かもしれず、外からは区別できないため）。状態を与えれば決着する。その要素を外しただけでは決着しない。後から同じ root に接続した `<wcs-state>` が束ねた後に尋ね直した呼び出しは resolve する（それより前に得た Promise は pending のまま）。`connectedCallbackPromise` と `initializePromise` の挙動は変わらない／ページの走査は、要素の子を先に束ねてから、要素自身の束縛を付ける（後順）。要素の束縛がその中のどこに描いた値も、束縛として解釈しない（値の中の `{{ }}`・`data-wcs`、壊れた束縛による初期化の失敗を含む）。テンプレートの中身（行・枝）の束縛は、これまでどおり文書順。そのためページの直下では、要素の束縛が子孫の束縛の後に当たり、カスタム要素の最初の書き込みの順も、`$errorCallback` に届く順も 3.x と逆になる（子が先。3.x と行の中は文書順）。既知の制限: 束縛をきっかけに自分の直下へ `<wcs-state bind-component>` を足す要素では、作者が書いた子をページのエンジンも束ねる（コンポーネントかどうかの判定が束縛より前になったため。想定外の形）／`srcdoc:`・`attr.srcdoc:` の null・undefined は、`srcdoc` 属性を外す（iframe は `src` に戻る）／再接続のときに `$connectedCallback` が reject しても、未処理の reject にならず console.error に出る／`<noscript>` と `<iframe>` の中身（子）は、ページの走査でもテンプレートの計画でも束縛しない。中の `{{ }}` は文字のまま残る。要素自身の `data-wcs`（`srcdoc:`、`attr.src:` など）は、これまでどおり束ねる（3.x の除外は script と style だけだった。廃止済みの noembed・noframes・xmp は対象外）。差ではないもの（3.x と同じ挙動。4.0 の開発中に壊れていたのを直した）: SSR で `<svg>` の中に置いた `for:`／`if:` のテンプレートは、入れ子のテンプレートを含めて、client で SVG の文脈のまま戻る。サーバの行はそのまま採用され、client で作る行も SVG の要素になる。サーバはテンプレートの中身を `<svg>` で包んで出し（中の SVG のテンプレートは HTML の `<template>` にして出す）、client はパーサが SVG として読んだ中身から SVG の `<template>` を組み立てる。文字列を解析しないので、Trusted Types の sink を使わない（R3-7・R3-8）。`<foreignObject>` の中（HTML に戻る文脈）のテンプレートは、HTML のテンプレートのまま戻り、行も HTML の要素になる。サーバはアンカーの祖先を名前で見て（`svg` と `foreignObject` の近い方。サーバの DOM が統合点を知らなくてもよいように）SVG の文脈かを決め、テンプレートの id（`wcs-s…`）で client に伝える（S3-3）。Chromium（Playwright）で、svg の入れ子の `for:`、`foreignObject` の直下と、その中の要素の中の `for:`、svg の行の中の `foreignObject` の `if:` を、サーバの出力からの引き取りと以後の書き込みまで確かめた（2026-10-02。e2e への組み込みはまだ）／品質改善のサイクル 4（2026-10-02）で足す差: 拒まれた再セット（接ぎ木した volume・マウントした部品のある根、形の誤った `$commandTokens`／`$eventTokens`／`$on`）は、古い状態を一切変えずに投げる（`$watch`・`$stream`・`$listKeys` も古い状態のまま動き続ける。以前は後付けの入れる順によって、拒んだ後の `$watch` が二度と発火せず、stream は止まったまま `$streamStatus` が `active` だった）。既知の制限（開発時の誤り）: 再セットした状態の `$listKeys`／`$recursion` の宣言の誤りで投げると、古い状態の `$watch` と `$stream` は止まる（temporal が先に新しい状態のものへ差し替えるため。後付けの入れる順で変わり、全部入りの順で起きる）。拒まれた状態の `$watch`・`$stream` は、残った状態の上では動かない（切断・再接続でも、`$stream` の args が読むパスが変わっても。要素を外したときも、残った状態の `$streamStatus` に書かない）。古い状態の `$listKeys` は効き続ける（`$recursion` の誤りのときも）。直して再セットすれば戻る／結線した部品（`data-wcs="state…"` でホストに結線した部品）の shadow root の中の `<wcs-state mount>` は、読み込みの順に関係なく接ぎ木せず、`will not graft: its component is wired to its host.` を `console.error` に出して決着する（`connectedCallbackPromise` は解決する）。結線した部品はホストの木を読むので、接ぎ木する木が無い。データはホストの状態に置く。3.x は接ぎ木せず pending のままだった。4.0 の開発中は順によって部品の木に接ぎ木したり、丸ごとの結線（`state: user`）ではホストの木に書き込んだりした。結線しない部品の中の volume は、これまでどおり部品の木に接ぎ木する。部品がマウントされないとき（ページの根の初期化の失敗、部品の状態がオブジェクトでない、など）は、その shadow root の中の volume は `will not graft: the root state failed to initialize.` と報告して決着する（後から読み込むものも同じ）。差ではないもの（3.x と同じ挙動。4.0 の開発中に壊れていたのを直した）: SSR で、volume の `$connectedCallback` は、読み込みの順や後付けの入れる順に関係なく、スナップショットの上で走る（V7・D14。以前は volume が根より先に読み込まれると、クライアントでの書き込みがスナップショットで消えた）。`$watch` は、活性化の後に getter になったパス（後から定義した部品のエクスポートした getter、根の接続の後に接ぎ木した volume の getter）でも発火する。診断（diagnostics）は、ページの `<wcs-state mount>` のマウントパスの配下では、volume の読み込みが終わるまでは `binding-path-missing` を出さず、終わった後に宣言の無いパスを警告する（D22）／品質改善のサイクル 5（2026-10-02）で足す差: 差ではないもの（3.x と同じ。R7 の決定、2026-10-02、ユーザー）— 3.x のコメント束縛（`<!--@@: expr-->`・`<!--@@wcs-text: expr-->`）を 4.0 も束ねる。`expr` は `{{ }}` と同じテキスト束縛の式（フィルタを含む）。ページの直下でも `for:`・`if:` のテンプレートの中でも束ね、コメントは同じ位置のテキストノードに置き換わる（3.x と同じ DOM）。`$behavior.enableMustache: false` のページでも束ねる（テキストを束ねる、要素を足さず FOUC の無い書き方。vscode-wcs の lint が `<template>` の外の `{{ }}` の代わりに勧める形）。キーワードは空か `wcs-text` だけで、ほかのコメント（router の `@@route:`、3.x の SSR の印、ふつうのコメント、式の無い `<!--@@:-->`）は束ねずに残す。束縛の値の中のコメント（`innerHTML:` の値、カスタム要素が中に描いた値）、中身を束縛する要素の子、`<noscript>`・`<iframe>` の中は、`{{ }}` と同じく束ねない。SSR では、サーバで値を描き、クライアントはテキストの束縛の印をコメント束縛として戻して束ね直す（`{{ }}` も同じ印で、`enableMustache: false` の往復でも束ねる）。差（3.x との違い）: `<textarea>`・`<title>` の中のコメントは束ねない（ブラウザのパーサはそこを文字にする。サーバの DOM〔happy-dom〕はコメントにするので、SSR とクライアントの描画をそろえるため）。式は複数行でもよい（3.x は 1 行だけ）。3.x は内部のアンカーのキーワード（`<!--@@wcs-for: x-->`・`<!--@@wcs-if: x-->` など）のコメントもテキスト束縛として描いていた（値を文字にした `[object Object],…`・`true` などが出た）が、4.0 は束ねずに残す（作者が頼る形ではない）。設定キー `commentTextPrefix`（キーワードの別名）は無い（渡すと throw）。／`on*#direct:`（F4 の決定、2026-10-02、ユーザー）— 委譲せず、その要素に直接リスナーを付ける（`currentTarget` は要素。3.x と同じ）。`#prevent`・`#stop` と組み合わせられる（`onclick#direct,stop: save`）。行・枝の中でも行ごとに付き、行・枝の後始末で外れる。委譲で困る形をその束縛だけ 3.x と同じにする: `#stop` でページ側のコードが祖先に付けたリスナーを止める（クリックできるカードの中のボタン）／祖先が `stopPropagation()` しても呼ばれる（オーバーレイへのクリックを止めるモーダルの中身）／別の root へ移した要素でも呼ばれる。組み合わせの注意（仕様）: 外側の要素が `#direct` で、内側が委譲（修飾子なし）だと、外側が先に走る（委譲のハンドラはルートで走るため。DOM の順のとおり）ので、内側の `#stop` で外側は止まらない。止めたいときは内側にも `#direct` を付ける（`onclick#direct,stop:`）。知らない修飾子（`#foo`）は、これまでどおり報告せずに無視する（3.x と同じ）。書式フィルタの壁（formats の後付けを入れずに書式フィルタを書いた）の文面は、`installFeatures([formats])`（`@wcstack/state/features/formats` から。分割 auto では root の `features="formats"` か状態の `$features`）を案内する（分割 auto の書き方は diagnostics が足す。以前は、どの入口からも export されていない `installFormats()` を案内していた）。この文面と、書式フィルタが 1 つも無いページでの打ち間違いへの案内には、lint への誘導を付けない（lint の manifest は書式フィルタを知っているので報告しない。I4）。束ね終えた根は、`$connectedCallback` が reject しても、`setInitialState()` で再セットできる（3.x と同じ。I2。`connectedCallbackPromise` は reject する）。`$errorCallback` の `info.node` は、表示する `for` の無い一覧（`$getAll`・`$watch` が保つもの）の失敗では `null`（型も `Node | null`。I8）。パーサの束縛の解析（`@wcstack/state/parser` の `parseBindTexts*`）も、パスを指す右辺の `__proto__`・`prototype` の段を #120 で拒む（I6。`$command.<名前>`・eventToken・単独のメソッド名は対象外で、実行時と同じ範囲。`getPathInfo` 自体は拒まない。lint が報告できるようになる）。差ではないもの（3.x と同じ。4.0 の開発中に壊れていたのを直した）: DOM のグローバル（`HTMLElement`）が無い Node でも、`.` と `/core` を import できる（I1）。DevTools のプロトコル v2 の `state:watch-fired`・`state:watch-error`（`phase` は `prime`・`evaluate`・`handler`）・`state:watch-chain-limit`・`state:path-unresolved`（diagnostics を入れたとき）を送る（I3。どれにも発火元の `stateElement` を付ける。DevTools が付いている間だけペイロードを作る）。DevTools を外して付け直すと、残っている束縛を `binding-added` で送り直す（I7）。活性化（接続・再セット）で、watch した getter を前もって評価したときに投げても、`$watch initial evaluation of "…" threw.` を出して続ける（その watch の `prev` は最初の発火で undefined。接続は失敗せず、ほかの `$watch`・stream も動き、後付けの接続の処理も走る。行の watch は行ごと。行の watch が読む一覧そのものが getter で投げたときも同じ。サイクルより前からの不具合、R6・R8）／router（2026-10-02、§3 の N1 の (a)）: 表示中のルート本文の終わりにコメントの印 `<!--@@wcs-route-end:<path>-->`（SSR の終了マーカーと同じ文面）が入る（outlet の `childNodes` が増える。コメントなので `:empty` は変わらない）。退場では placeholder からこの印までをまとめて持ち出し、次の入場で戻すので、その間に描かれたもの（`<wcs-route>` の直下の構造テンプレートが state の最初の走査で描いた行・枝など）や作者のコードが差し込んだノードも、ルートと一緒に出入りする（以前は元のノードだけを出し入れし、それ以外は outlet に残った）。表示中のルートをもう一度表示するとき（パラメータの変化）は内容を動かさない（以前は元のノードを placeholder の後ろへ並べ直した）。SSR の採用の後も終了の印は残る（開始の印は外れる）／lint・VS Code 拡張（4.0 の規則。拡張は 4.0 と同時に出し、3.x のプロジェクトは拡張 1.19.x のまま）: 4.0 で外れた名前（3.2 の旧名・`$scan`・`substr`）は書き換え先を添えて報告する（フィルタは `wcs/filter-unknown`、API は `wcs/name-alias`、宣言キーは `wcs/declaration-alias`、`$scan` は `wcs/scan-declaration-invalid`）。数値の添字のパスは警告しない。`$behavior`・`$features`・root の `features=` を検査する（§3 の vscode-wcs の行）。／vscode-wcs の 4.0 切り替えの検証で直した差（2026-10-02、指摘者 K）: volume に書いた `$updatedCallback`（3.x の名前。3.x は volume の中でも相対配送で走らせていた）は、黙って捨てず、`$renderedCallback` と同じく `console.error` で接ぎ木を拒む（根の状態では `[wcs/declaration-alias]` #1601 で `$renderedCallback` へ改名を案内する）／#203 で拒むのは要素を置き換えるプロパティの束縛（`outerHTML:`・`outerText:`・`.outerHTML:`）だけで、同じ名前の `class.outerHTML:`・`attr.outerText:`・`onouterHTML:` は `for:`・`if:` の中でも拒まない（以前は名前だけで拒み、ページでも要素の子の走査を止め、SSR のサーバはその束縛を外していた）／数値の添字のキーの `$watch`（`"items.0.v": fn`）は、その添字の値が変わったときだけ発火する（以前は別の行への書き込みや値の変わらない一覧の差し替えでも、`cur === prev` のまま発火した。3.x は添字のパスへの書き込みでは発火せず、一覧の差し替えでは値が同じでも発火していた）。getter のキーの `$watch` は従来どおり、変化が届けば値が同じでも発火する／`<wcs-route>` の直下の構造テンプレート（2026-10-02、ユーザーの決定。§3 の router の行）: この版の router と 4.0 では、着地でも遷移で入ったルートでも描かれ、描いた行・枝はルートと一緒に出入りする（router が binder に `{ range: true }` を宣言して渡す）。古い router・`<wcs-head>`・3.x の state との組み合わせでは、遷移で入ったときは描かれない（4.0 は #204、3.x は束縛の適用の失敗）。要素で包めば、どの版でも描かれる |
| I/O パッケージの README（ja・en） | 設定の節に「知らないキー・既定値と型の違う値・定義していないタグ名は throw し、何も当てない。undefined は飛ばす」を足す。storage の README に「`tagNames` の文字列でない値は無視する」旨があれば直す。main（3.5、#406）から、設定の節を持つ 12 パッケージの README に「3.5 は警告し、4.0 は throw する」の 1 行が入った。4.0 では「throw する」に書き換える |
| [docs/sri.ja.md](../sri.ja.md)・[docs/csp.ja.md](../csp.ja.md)（英語版も） | sri の分割エントリの節と csp §2.1 の表に分割 auto の行: 動的 import は `<script integrity>` の範囲の外、要るのは配信元ホストの許可だけ、起動の `<script>` の nonce で `'strict-dynamic'` でも通る（[root-attributes.ja.md](./root-attributes.ja.md) §4、2026-09-30 に 3 ブラウザで確かめた） |
| `CHANGELOG.md` | 4.0.0 の項 |
| [timing-and-firing-contract.ja.md](../timing-and-firing-contract.ja.md)（英語版も） | §3 の見出しの `$streams`、§4.3 の機構の順序（`$scan` → `$watch` → `$streams` restart、`$updatedCallback`）を 4.0 に直す。新エンジンの順序は `$renderedCallback` → `$watch` → stream の再開。§4.3 の「arbiter がある間は順序が反転する」が新エンジンでも成り立つかを確かめる |
| `CLAUDE.md` | State の構成の説明（`proxy/`・`binding/`・`structural/` など 3.x の構成）と、サイズの検査の記述を直す |

## 6. リリース

- 全パッケージを 4.0.0 にそろえる（版をそろえる方針）。vscode-wcs は別の版。
- **リリースの実行中はブランチを凍結する**: release.yml はディスパッチの後にブランチが動いていれば公開の前に止まり、公開の間に push されると最後の push が失敗する（npm には版が出たのにタグが無い状態になり、次の実行は拒む — 戻すのは人）。rc の間は research へのマージ、4.0.0 の間は main へのマージを止める。
- CHANGELOG: 4.0 の下書きは rc の間ずっと `[Unreleased]` に置き、rc ごとの見出しは作らない（rc の GitHub Release が `[Unreleased]` を案内する）。rc で変わったことは下書きに書き足す。`[4.0.0] — 日付` に改めるのは最終版のときだけ（CHANGELOG の `[Unreleased]` の注記と CLAUDE.md にも書いた）。
- rc（R8、経路は §4）: `research/state-engine` で release.yml を `premajor-rc` で実行する（`gh workflow run release.yml --ref research/state-engine -f version_type=premajor-rc`）。次の rc は `prerelease-rc`（rc.1 は部分リリースになったので、rc.2 から — §8「4.0.0-rc.1 の部分リリース」）。npm の `next` に載り、main は 3.x のまま（3.x の patch は main から従来どおり出せる）。`@wcstack/lint` / `@wcstack/typescript` も rc と一緒に `next` に載る。拡張は出さない（R11）。
- **CDN のピン**: state の README（en/ja）の分割エントリーの URL は版を名指しする（import map の例と `dist/split/auto.js`。どちらも 3.5.4 では 4.0 のファイルにならない — `split/auto.js` は 3.5.4 に無い）。rc を出す前の準備で、その rc の版（`4.0.0-rc.N`）に合わせて commit する。4.0.0 の準備では `4.0.0` に改め、ほかのパッケージの README の 3.x の手順どおりのピン（media-query など）も 4.0.0 に上げる。`docs/sri(.ja).md` の 3.5.4 の例は 3.x の説明なので変えない。
- 4.0.0: ブランチを push し、PR とレビューを経て main に入れてから、main で `release` を実行する（`latest`。`major` は拒むので、rc を経ずに 4.0.0 は出ない）。拡張の 2.0.0 を同時に出す。その後、npm の `next` は最後の rc を指したまま残る（workflow の OIDC の資格は publish にしか使えないので、揃えるなら手で `npm dist-tag add <pkg>@4.0.0 next`）。4.0.0 の後の 3.x の修正は、この経路では出せない（安定版は main からだけで、main は 4.0 のエンジン）。

## 7. 進め方の案

1. §1 の R1 と R2 を決める（配布の形と公開範囲が §2.2・§2.3・§3 の前提）。
2. §2（旧名の受け口、配布物の形、型定義、`/parser`・`/manifest`、ESLint とカバレッジ）。
3. §3 の周辺パッケージを、state-next の入口に向けて流し直す。
4. §4 のビルドと CI、§5 の文書。
5. R3 は決めた（2026-10-02: 3.5 を最後の minor として、警告と lint の案内を入れる）。3.5 の作業は main から切ったブランチで進める（router の範囲の修正の移植、CSP の文書、移行ガイド、state の警告、全パッケージの bootstrap の警告、lint の 4.0 への案内）。

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
  - 2026-10-02 読み替え（品質改善のサイクル 1）: binder で後から渡したときも `bind()` からは投げず、`console.error` に報告する。プロトコルの契約（`protocol/binder.ts` の `bind` の doc と [binder-protocol-design.md](../binder-protocol-design.md) §2 の「Never throws for markup reasons」）を優先した。黙って捨てない点は変わらない。
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

### Issue #347〜#368 の確認（2026-09-27）

2026-09-27 に登録された 22 件を state-next で確かめた。#355 は vscode-wcs／lint の Issue で、実行時の確認の対象外（§3 に 4.0 での直し方を書いた）。残り 21 件を 3 つに分けて並行で流した（SSR 7 件・リストと行 8 件・コンポーネントなど 6 件）。再現のテストは `__tests__/tmp-issues-ssr.test.ts`・`tmp-issues-lists.test.ts`・`tmp-issues-misc.test.ts`（未コミット。起きる形は失敗するテストとして残してある）。

| Issue | state-next | 備考 |
|---|---|---|
| #347 SSR 後、行の直下に `if:`・`{{ }}` がある一覧を書き換えると崩れる | 一部起きる | SSR 固有の症状は無い。行が `if:` だけの形は F20、行の直下の `if`／`else` の並べ替え・先頭行の削除は F21（どちらも CSR でも同じ） |
| #348 SSR で Light DOM の `bind-component` の子の `if:` がページの `else:` と組になる | 起きない | Issue の形は期待どおり。周辺に F22（テンプレートの中の Light DOM の子）・F23（SSR で子の `if:` が失われる）。`else:` を `<ul>` の後に置く形は、4.0 では `#202`（`else:` は `if:` の直後） |
| #349 SSR 後、枝の中の連鎖や包まない 3 段の `if:` で 2 つの枝が同時に出る | 一部起きる | 連鎖と行の中の連鎖は期待どおり。包まない 3 段の `if:` は F21（CSR でも同じ） |
| #350 SSR 後、行の `{{ $1 }}` が空 | 起きない | |
| #351 SSR 後、同じ配列を `for: items` と getter の `for:` で描くと行が重複 | 起きない | |
| #352 定義待ちの間に要素を外して戻すと取り消される | 起きない | 定義待ちはブロックが破棄されたときだけ取り消す |
| #353 描画の連鎖の上限に掛からない無限ループ | 一部起きる | F27。microtask で値を出す要素・`$renderedCallback` の循環は止まらない。`$watch` を挟む循環は止まる。`$scan` は 4.0 で廃止 |
| #354 32 段を超える有限の連鎖に `$watch` を足すと上限が誤って出る | 起きる | F28 |
| #356 SSR の最後に隠れた `if:` の中身が包まない `if:`／`for:` | 起きる（原因は CSR 側） | 表示の症状は同じだが、F20・F21 による（CSR でも同じ）。SSR の出力に何かが残る問題は無い |
| #357 スコープ付き CustomElementRegistry | 起きる | F29（コード読みと模擬テスト。ルートも待ち続ける） |
| #358 SSR で作った行の spread | 起きない | |
| #359 入れ替えが揃わないうちに前の配列へ戻す | 起きない | 行が値と一緒に動かないのは 4.0 の意図した差（位置のモデル） |
| #360 外側を並べ替えても入れ子のテンプレートの `{{ $1 }}` が古い | 起きない | |
| #361 入れ替えを 2 つのバッチに分けると `$watch` が別の位置で呼ばれる | 起きない | `$watch` は書いた位置と値で呼ばれる |
| #362 元の配列を返す getter の `for:` が元のパスへの書き込みで描き直されない | 起きる | F24 |
| #363 深さ 1 の `for: groups.0.items` で 2 つの数値添字のパスが `[wcs/wildcard-rank]` | 一部起きる | 例外は起きず、書き込みも着地する。表示は F25（行が空）と F24（別名の getter）で期待に届かない。Issue の対照の形は F20 |
| #364 行の子のパスを描く for が無いと、要素の書き込み・`$postUpdate` が届かない | 起きない | |
| #365 同じオブジェクトを 2 つの行に置く | 一部起きる | F26（`for:` の行と行の getter だけ古い） |
| #366 `$eq` の path の数値添字 | 起きない | |
| #367 部分マウントの async メソッドの await の間に行が消える | 起きない | 別の行には着地しない。周辺に F30 |
| #368 プールから使い回した行のコンポーネントの `$connectedCallback` | 起きない | 4.0 は行の要素を使い回さない |

- happy-dom の癖（テストで吸収した）: 定義より前に作った要素を `cloneNode` で複製すると、文書に入るまで upgrade されない（Chromium は複製の時点で upgrade する）。

### F20〜F23・F27・F28・F30 の修正（2026-09-27）

§2.5 の F20〜F30 のうち、7 つを直した。Issue の再現のテストは `__tests__/issues-ssr.test.ts`・`issues-lists.test.ts`・`issues-misc.test.ts` に正式に置いた（一時ファイルから改名）。まだ直していない F24・F25・F26・F29 の形は `it.fails` で残し、`else:` を `if:` の直後に置かない #348 の形 3 は、4.0 では `#202` で失敗することを確かめる形にした。

- **F20・F21**（`dom/view.ts`・`plan.ts`）: ブロックの範囲を「先頭の直下ノード（そこをアンカーにする入れ子のビューがあれば、その描いた最初のノード）から、最後の直下ノードまで」として動かし、消す（`Block.head()`、`lead`、`headAt`）。入れ子のビューはアンカーの前に描くので、範囲は連続している。`for:` の行の並べ替えの基準も `head()` にした。直下が構造のアンカー 1 つだけのテンプレートは、単独で複製しない（`single` はコメントでないときだけ）。直下が要素 1 つのブロック（jsfb の行）は、これまでと同じ経路。
- **F22**（`dom/plan.ts`）: テンプレートの中の Light DOM の `bind-component` の子の中身は、ページの走査と同じく、コンポーネント自身のエンジンが束ねる（`componentScope`）。
- **F23**（`ssr/ssr.ts`）: サーバのアンカーをページのルートごとにも記録し、スナップショットで、同じルートの `bind-component` のエンジン（Light DOM のコンポーネント）のアンカーとビューも変換する。ほかのルート（別の `<wcs-state enable-ssr>`）のエンジンは含めない。
- **F27**（`engine.ts`）: 描画から続いた書き込み（要素の書き戻し、`$renderedCallback` の中の書き込み — async のものは Promise が終わるまで、`$watch` のハンドラの書き込み）だけで始まった drain が 100 回続いたら、そのバッチを適用せずに打ち切り、一度 `#41`（`render chain depth limit exceeded (100 drains that rendering itself started); bindings for this batch were not applied.`）とそのバッチのパスを `console.error` に出す。コードからの書き込み（ユーザーの操作、`await` の続き、`$stream`）で始まった drain と、マクロタスクをまたいだ drain で数え直す。上限 100 は 3.3.x の #338 の修正と同じ。3.3.x は「束縛を適用している間の同期の書き込み」だけを数え、microtask で値を出す要素・async の `$renderedCallback` は止めない（#353）。4.0 はこれらも止める。（2026-10-03 更新）DevTools へは `state:render-chain-limit`（`maxDepth: 100`・捨てた仕事の `paths`）を送り、`console.error` にも同じパスを添える。1 回の drain の中で落ち着かない打ち切り（`#11`）も、同じイベントを `maxDepth: 32` で送り、`#11` は連鎖ごとに 1 回だけ報告する。`$stream` の再開の書き込みも反応として数える。arbiter が適用を遅らせたときは、その適用が同期に書いた書き戻しが起こす drain（とその反応の drain）が、適用を出した drain の連鎖の続きを数える（`carried`。マクロタスクの区切りで戻すのはタスクの連鎖だけ）。適用の後に `await` を挟んで書く async の `$renderedCallback` は運ばれず、その循環は arbiter のタスクごとに 1 周して止まらない（固まりはしない）。
- **F28**（`temporal/watch.ts`・`stream.ts`、2026-10-03 更新）: `$watch` の連鎖は 3.4 と同じく書き込みごとの深さで数え、深さ 32 を超えた書き込みが起こしたハンドラは動かさない（3.x と同じく 33 段まで動く）。同じバッチに相乗りした描画の書き戻しは、連鎖を伸ばしも戻しもしない（#354）。打ち切るのは上限を超えたハンドラだけで、同じバッチのほかのハンドラは動く（3.x はバッチごと）。`$stream` の再開も段に数え（再開を起こした書き込みの深さ + 1）、実行を始めたタスクの中で届いた値が別の stream の args に届くと、その再開は実行と同じ深さで数える（すぐに値を出す source どうしが互いの args を読む循環も止まる。値が起こす `$watch` は数え直し）。打ち切りは `state:watch-chain-limit` で、同じタスクの中では新しいパスのときだけ報告する。行 getter の `$watch` は、リストが残した行で値が変わらず、同じバッチの書き込みが getter の読んだもの（行の外 — 直接、またはその getter が読む getter を通して）を変えていないときは発火しない（#389）。getter と args の深さは、最後に評価してから最初の書き込みのもの（届いた getter は読まれるまで届き直さない）、drain の中で同期し直した一覧が届けたときは 0 — それらを通る循環は F27 に任せる。ハンドラと再開の書き込みは描画の連鎖（F27）にも数えるので、`$watch` と描画が交互に回るループは F27 の上限で止まる。
- **F30**（`scopes/component.ts`）: ホストの行が消えた後のコンポーネントのコードの書き込みは `The host row of <tag> was removed.` で拒む（3.3.x と同じ文面）。要素からの書き込みは捨てる。
- **async のイベントハンドラ**（`dom/plan.ts`）: `onclick: method` の async のメソッドが拒否した Promise を `console.error` に報告する（これまでは未処理の拒否になっていた）。F30 の確認で見つけた。
- 番号 #41（`RenderChain`）を足した。

| | 前（`6c45352d`） | 後 |
|---|---|---|
| テスト | 1,340 件（通過 1,339・スキップ 1） | 1,522 件（通過 1,507・意図した失敗 14・スキップ 1） |
| カバレッジ | 99.72・99.03・100・99.95 | 99.71・98.99・100・99.93 |
| core（`core.min.js` gzip） | 18,736B | 19,070B（+334B。上限 20,000B まで 930B） |
| e2e | 131/131 | 131/131 |

### F24・F25・F29 と F26 の扱い（2026-09-27）

決定: F24（と同じ仕組みの F25）は「同じ配列を持つ一覧を結び付ける」、F26 は 4.0 の既知の制限として記録する、F29 は Chromium の e2e で確かめて入れる。

- **F24・F25**（`engine.ts`）: 一覧を同期するたびに、配列（本物の配列だけ）ごとにそれを持つ一覧を記録する（`listsByArray`）。同じ配列を持つ一覧が 2 つ以上になると、それらに `shared` の印が付く。印のある一覧の行への要素・葉の書き込みは、同じ配列を持つほかの一覧の同じ位置の行に届く（行の値の更新、子の一覧の同期、`written`、描き直し。`mirror`）。元の配列をそのまま返す getter の `for:`（#362）、別名の getter（#363 の `for: current`）、数値添字のパスの `for:`（`for: groups.0.items`、#363）が、どちら側から書いても追従する。印の無い一覧（ほとんど）は、書き込みの経路でフラグを 1 つ見るだけ。
  - F25: 数値添字の段の後ろにワイルドカードがあるパス（`groups.0.items.*.v`）には F17 の accessor を付けない。行は自分の値から読み、添字のパスからの書き込みは上の結び付けで届く。
- **F26**: 4.0 の既知の制限。同じオブジェクトを 1 つの一覧の 2 つの行に置くと、片方の行への葉の書き込みは、もう片方の行の束縛と行の getter に届かない（読み・ルートの getter・`$getAll` は新しい値）。直すには一覧を作るたびに重複を調べる必要があり、行の生成の費用に響くため。テスト（`issues-lists.test.ts` の #365）は `it.fails` で症状を残した。README（移行ガイド）に書く。
- **F29**（`dom/wc.ts`・`scopes/component.ts`）: 定義を待つ登録簿を、要素の `customElementRegistry`（スコープ付きの登録簿）から引く。行の要素は、テンプレートの中身を文書に取り込んだ時点で global の登録簿を持ち、shadow root に入った時点でスコープ付きのものに替わるので、文書に入っていない要素で、今の登録簿がタグを知らないときは、置かれた後まで 1 マイクロタスク待つ（`customElementRegistry` のあるブラウザだけ）。コンポーネントのホストの定義待ちも同じ登録簿で待つ。
  - Chromium 149 で確かめた（`e2e/tests/state-scoped-registry.spec.ts`・`e2e/fixtures/state-scoped-registry.html`）: 最初に描いた行・後から足した行・ルートのプロパティの束縛と spread、スコープ付きの登録簿に後から定義した要素。global の登録簿はタグを知らないまま。このテストは `STATE=next` のときだけ走る（3.3 は #357 のまま）。
  - happy-dom はスコープ付きの登録簿を持たないので、unit では要素に `customElementRegistry` を足して待ちの経路だけを確かめた。#357 の模擬テストは外した。

| | 前（F20〜F30 の修正の後） | 後 |
|---|---|---|
| テスト | 1,522 件（意図した失敗 14） | 1,523 件（通過 1,520・意図した失敗 2（F26）・スキップ 1） |
| カバレッジ | 99.71・98.99・100・99.93 | 99.66・98.87・100・99.93 |
| core（`core.min.js` gzip） | 19,070B | 19,368B（+298B。上限 20,000B まで 632B） |
| e2e | 131/131 | 132/132（スコープ付きの登録簿を足した） |

- 性能（F20〜F30 の修正をすべて入れた後。修正の前のコミット `0de3ec55` の src から同じ方法で作ったバンドルと、同じセッションで順番を入れ替えて 4 回・各 96 サンプル）: 中央値は warm 1,000 行作成 5.65 → 5.60ms、cold 10,000 行作成 70.55 → 69.55ms、warm 10,000 行作成 43.8 → 44.5ms、cold 1,000 行作成 10.25 → 10.5ms で、差はばらつきの範囲。F24・F29 を入れる前の計測で warm 10,000 行作成が 3ms 遅く出たが、この計測では消えた。

### CSP の診断の移植と CSP の文書の訂正（2026-09-28）

分割エントリと CSP の検討（[root-attributes.ja.md](./root-attributes.ja.md) §4）から始めた。実ブラウザ（Playwright の Chromium・Firefox・WebKit）で確かめたことと、直したこと。

**確かめたこと**
- 分割エントリの読み込み（静的 import と、`import.meta.url` からの相対の動的 import）は、ホストの許可だけ・nonce だけ・nonce と `'strict-dynamic'` のどれでも通る。
- モジュールの `import()` は、import を書いたモジュールを読み込んだ `<script>` の nonce を引き継ぐ。state（3.x・state-next）と router のバンドルを nonce 付きの `<script>` で読めば、blob: の import は `script-src blob:` なしで通る。docs/csp の「nonce では救えない」は誤りだった。
- `<wcs-state>` の中の `<script type="module">` はブラウザも評価する。CSP が無いか、その `<script>` に nonce があると、トップレベルのコードが 2 回走る（3.x も同じ）。docs/csp の「ブラウザからは実行されない」は誤りだった。
- Firefox は `securitypolicyviolation` を import の失敗より後（次のタスク）に出す。Chromium と WebKit は失敗より先に出す。

**直したこと**
- state-next に CSP の診断を移した（3.x の `stateLoader/loadFromInnerScript.ts` にあり、state-next に無かった。docs/csp §9 の約束）。`element.ts` の `loadInnerScript` が、読み込みの間だけ違反を購読する。失敗したら 1 タスク待ってから判定する（Firefox の順のため）。CSP を見たら #42（`M.InlineBlocked`）、見なければ元のエラーの文面を添えた #43（`M.InlineFailed`。元のエラーは `cause`）で投げる。文面は診断の後付けにあり、#42 の文面は nonce の手当ても案内する。
- テスト 7 件（`coverage-element-load.test.ts` に 5 件、文面の表に 2 件）。Firefox の順のテストは、待ちを外すと落ちることを確かめた。作り直した `auto.min.js` で、3 エンジンとも #42 の文面になり、構文エラーでは #43 の文面になることを確かめた。
- docs/csp（ja / en）: 冒頭・§0・§3 の表と本文・§3.3・§4・§5・§9 を直し、§2.1（分割エントリ）を足した。state・router・ルートの README（ja / en）の CSP の注記を直した。
- e2e: `e2e/tests/csp.spec.ts` と fixture 3 つ（nonce 付きで state のインラインが読める・nonce が無いと CSP を断定して失敗する・nonce 付きで router のガードが動く）。3.3 と state-next の両方で通る。

| | 前 | 後 |
|---|---|---|
| テスト | 1,523 件（通過 1,520・意図した失敗 2・スキップ 1） | 1,530 件（通過 1,527・意図した失敗 2・スキップ 1） |
| カバレッジ | 99.66・98.87・100・99.93 | 99.66・98.87・100・99.93（変えた 3 ファイルは 100） |
| core（`core.min.js` gzip） | 19,368B | 19,494B（+126B。上限 20,000B まで 506B） |
| 全部入りの `auto.min.js`（gzip） | 40,640B | 40,963B（+323B。文面を含む） |
| e2e | 132/132 | 135/135（CSP の 3 件を足した。3.3 では 134 件通過・スキップ 1） |

**残り**（state-next の外）
- 3.x の state（`stateLoader/loadFromInnerScript.ts`）は失敗の直後に判定するので、Firefox では CSP で止められても非断定の文面になる。文面も nonce の手当てを案内していない。3.4.0 には入らなかったので、3.5 で直す（R3。router は 85000a00 の移植で直す）。
- ~~router（`loadGuardHandler.ts`）も同じ~~ 済み（下の「router の CSP の診断」）。
- インラインの `<script>` が 2 回走る件の挙動は変えていない（§2.4）。
- wcstack-skill の CSP の記述に同じ誤りがある（§3.1）。

### router の CSP の診断（2026-09-28）

上の「残り」のうち、4.0 の後も残る router の分を直した。

- `packages/router/src/loadGuardHandler.ts`: blob: と data: の両方の import が失敗したあと、1 タスク待ってから CSP かどうかを判定する（state-next と同じ。Firefox の順のため）。CSP の文面に nonce の手当て（router を読み込む `<script>` に nonce）を足した。
- テスト: CSP の文面のテストを新しい文面に合わせ、Firefox の順のテストを 1 件足した（待ちを外すと落ちることを確かめた）。router は 764 件すべて通過、カバレッジ 100・99.5・100・100、lint と型検査も通過。
- 実ブラウザ（作り直した `auto.min.js`、各 5 回）: Firefox は修正前が 5 回とも非断定、修正後は 5 回とも断定。Chromium と WebKit は前後とも断定。
- router の `dist/` はリリースのときに作り直すので、コミット済みの dist はまだ修正前（e2e の router はこの dist で動く）。CHANGELOG もリリースのときに書く。
- docs/csp（ja / en）§9 の「router は待たない」を「3.3.0 より後の版は待つ」に直した。

### Issue #372〜#391 の確認（2026-09-28）

2026-09-27 に登録された 20 件を state-next で確かめた。4 つに分けて並行で流した（SSR 4 件、リストと行 6 件、添字のパスと性能 5 件、コンポーネントなど 5 件）。確かめた時点では、合わせて 183 件で、通過 153・失敗 30 だった（起きる形は、期待を書いた失敗するテスト）。すべて happy-dom で流し、Chromium の e2e では流していない。再現のテストは、直した後に `__tests__/issues2-ssr.test.ts`・`issues2-lists.test.ts`・`issues2-paths.test.ts`・`issues2-components.test.ts` に正式に置いた（下の「F31〜F33・F35〜F37 の修正」）。4.0 に無いフィルタ名は読み替えた（`uc` → `upper`、`inc(1)` → `add(1)`）。

| Issue | state-next | 備考 |
|---|---|---|
| #372 SSR 後、Light DOM の `bind-component` の子の `{{ }}`・`for:` が追従しない | 起きない | 別名・同名の配線、ホストと子の同名の一覧、子の私有リスト、ページの行の中の子とも期待どおり。目印は子の語彙の式のまま（`<!--wcs-t:x-->`）で、範囲はノードで引き当てる。周辺に F33 |
| #373 SSR 後、`{{ }}` が出力フィルタを失う | 起きない | 目印に式全体（`name\|upper`）が残り、行はテンプレートの計画から束ねる。ハイドレーションの間のちらつきも無い |
| #374 inline の SSR で、枝・行の中の Light DOM の子の `if:` がスナップショットに載らない | 対象外（orchestrated は起きない） | orchestrated は枝・行・`elseif:`・孫とも期待どおり（F23）。inline のスナップショットは 4.0 に無い。古いレンダラと組むと `<wcs-ssr>` が出ず、ページ全体が警告なしに固まる（下の「F 番号を付けないもの」） |
| #375 SSR 後、getter を条件にした `if:`／`elseif:` が追従しない | 起きない | 連鎖を組むときに条件を読む（引き取りでも同じ）ので、getter の依存ができる。行 getter・`$1` を読む getter・枝の中の連鎖も期待どおり。router の `get q()` は、query を状態のキーにした形で代用した |
| #376 行の中でトップレベルのリストを回す `for:` で、外側の一覧が消える | 起きない | CSR・SSR とも描け、`tags` の書き込みと外側の行の追加・削除に追従する（1 本のルートの一覧を、行ごとの `ForView` が `extra` として描く）。内側の行は親の行を持たない（下の「F 番号を付けないもの」）。`<select>` の形は初期値が F31、内側で外側のパス（`g.*.n`）を読むと F32 |
| #377 配列をそのまま返す getter の行から書くと、元のリスト・`$getAll`・`for:` が古い | 一部起きる | getter のパスへの書き込み、要素の差し替え、getter の連鎖、同じ配列を持つ普通のキーは、F24 の `mirror` で届く。`$postUpdate` の 2 形は起きる（F36）。写しを返す形（`filter = active`）の checkbox は F26 の系統（下の「F 番号を付けないもの」） |
| #378 退避したキーの添字のパスが、元のキーを絞り込んだ後に別の要素を指す | 起きない | 一覧はパターンごとに行を持ち、配列の台帳が無いので、`backup` は自分の配列から行を作る |
| #379 共有した内側の配列の要素の差し替えが、片方の外側の行にしか出ない | 起きない | 外側の行ごとの子の一覧が同じ配列を持つので `shared` になり、`mirror` で両方に届く。外側の一覧を写しても失敗しない |
| #380 入れ替えで `$watch("items.*")` の `prev` がずれる | 起きない | 位置のモデル（行は値と一緒に動かない）。`prev` は、書いた位置の行に最初の書き込みで記録される（#361 と同じ扱い） |
| #381 1 バッチで一覧を 2 回置き換えると、`$eqIndex` の行 getter が古い | 起きない | `$eqIndex` の付け替えは、`sync` のたびに一覧ごとの前の行と新しい行で行う。2 回・3 回の置き換えの総当たり（575 通り）で、表示と読みが正しい |
| #382 スクリプトで読む数値添字のパス（`$watch` のキー、数値キーのオブジェクト、空の一覧） | 一部起きる | `$watch("items.0.v")` と空の一覧は期待どおり。数値キーのオブジェクト（`sales.2024.total`）は F34 |
| #383 行 getter の中の、`*` と数値の添字が混ざったパス（`groups.*.sel.0.id`） | 起きない | 読み・`$eq`・`$resolve` とも期待どおり。葉・要素・一覧の書き込み、外側の並べ替え、行の追加に追従する。`*` は文脈の行、数字は添字として段ごとに解く（lint は §3） |
| #384 行の部品の shadow の中の、`for:` の外の `state: .` | 起きない（形を指す診断になる） | パースの段階で `[wcs/wildcard-rank] "." is relative: it needs an enclosing "for" template`（#1402）になる。`users.*..` などの書いていないパスは出ない。ただし文面に要素名が無く、走査が止まる（下の「F 番号を付けないもの」） |
| #385 完全マウントの行の部品で、リストの置き換えが行数の 2 乗以上に遅い | 起きない | 私有キーは部品の state（要素ごと）にあり、ホストの木にマーカーのパスを作らない。2 回目・3 回目の置き換えは 250〜2,000 行でほぼ比例し（2,000 行で 120〜240ms）、繰り返しても遅くならない。部分マウントと同じ程度 |
| #386 要素の書き込みで行を差し替えると、完全マウントの部品の私有キーが初期値に戻る | 起きない | 位置の行と要素がそのまま残り、私有キーは要素ごとにある（部分マウントと同じ）。行を消すと、`$disconnectedCallback` が控えた値（`tid`）を読める |
| #387 別の root へ移した要素の束縛が止まる（root の作成順で変わる） | 起きない | 4.0 は root ごとの MutationObserver を持たず、束縛は束ねたエンジンに属する。どちらの向きでも止まらず、元の root の state に追従する（行き先の state には追従しない）。定義待ちも取り消されない。周辺に F38 |
| #388 `for: groups.0.items` の行の、解決しないパスに診断が出ない | 一部起きる | 打ち間違い（`.nmae`）は警告する。行 getter（`.double`）は空で描かれ、警告も出ない（F37） |
| #389 要素の書き込みの費用が、行の下で読んだパスの種類の数に比例する | 一部起きる | 辺の登録は無い。ただ要素の書き込みが `forSubtree` で下の全パターンを辿るので、読んだ綴りの種類の数（K）に比例する（K = 10,000 で 0.1〜0.2ms、100,000 で 1.5〜2.8ms。happy-dom）。普通の形での上乗せは無い（×1.01〜1.14） |
| #390 外側の行の位置が変わる更新が、入れ子の行を辿る | 起きない | 位置の変化は、`$k` を読む getter（`indexWatchers`）にだけ届く。外側 3,000 行の先頭への追加・先頭の削除は、入れ子の行の数に比例しない（0.1〜0.4ms、happy-dom） |
| #391 自己再帰の部品の木（P2-5）のテストが重い | 対象外（3.3 のテストの Issue） | state-next に同じテストは無い。同じ木（深さ 5、364 個）で、エンジンの時間はマウント 107〜194ms、葉の 100 回の更新 7〜19ms（同じ機械で 3.3 は 319ms・123ms）。3.3 のテストの約 9 秒は、ほとんどが `setTimeout(0)` の待ち。同じ待ち方にすると、state-next も 4〜5.7 秒・1〜2.7 秒になる。再評価は祖先の経路だけ（各段 1 回） |

**F 番号を付けないもの**（どれも判断か文書が要る）
- **F26 の範囲**: 同じオブジェクトが別の配列の 2 つの一覧に載る形でも、F26 と同じことが起きる。TodoMVC の絞り込みの定番の形（写しを返す `get shown()` の `for: shown` の checkbox）で、`left`（`$getAll("todos.*.done")`）と `for: todos` の行が古いまま残り、入れた行が active の一覧から抜けない。#378 の、`backup` の行への葉の書き込みも同じ。Issue も #365 の系統として扱っていて、3.3 でも起きる。F26 を既知の制限と決めたとき（1 つの一覧の 2 つの行）より範囲が広いので、決定の見直しか、README での回避の案内が要る。
- **#376 の内側の行**: ルートの一覧の行なので、親の行を持たない。`$1` は内側の添字、`$2` は誤りを出さずに空、イベントに渡る添字も内側のものだけになる。外側の行が要るときは行 getter（`get "g.*.tagsHere"() { return this.tags; }`）で子の一覧にする。移行ガイドに書くかを決める。
- **#374 の inline**: 古いレンダラ（`data-wcs-server=""`）と組むと、4.0 は `<wcs-ssr>` を出さない。クライアントの `hydrate()` は黙って戻り、ページ全体がサーバの出力のまま固まる。案は、ssr の後付けで警告すること（サーバ側で `orchestrated` でないとき、クライアント側でサーバの目印があるのに `<wcs-ssr>` が無いとき）。core には響かない。
- **#384 の診断**: #1402 の文面に、要素名と束縛の文字列が無い。また 4.0 は束縛の構文の誤りが 1 つあると、root や部品の走査を止める（未知のフィルタや `:` の抜けでも同じ）。誤りより前の束縛だけが生き、その部品の `$connectedCallback` も走らない。ページの直下なら root の初期化が失敗する（3.3 は警告と、その束縛の失敗だけで済んでいた）。
- **#389 の性能**: 直すなら、パターンに「下に依存・ルートの束縛・`$eq` の購読がある」印を持たせ、`forSubtree` が印の無い部分木を飛ばす（core +50〜80B の見込み）。→ 2026-10-06 に別の形で直した: パスの読み書きだけが作ったパターンを drain の後に回収する（[scale-verification.ja.md](./scale-verification.ja.md) §3.2）。行の getter が動的なキーを読む形は残る。
- ルートの getter で、行の文脈なしにワイルドカードのパス（`this["items.*.v"]`）を読むと、黙って undefined になる。3.3 は投げる。
- `parsePath` のキャッシュ（`pattern.ts`）はモジュール単位で、上限が無い。動的なキーを大量に読むと増え続ける。パターン表も、エンジンが生きている間は減らない。→ 2026-10-06 に直した（キャッシュは 4,096 件で空にする。パターンは何も持たなければ回収する。[scale-verification.ja.md](./scale-verification.ja.md) §3.2）。
- getter の `$watch` は、値が同じでも呼ばれる（`[1, 1]`）。
- happy-dom の `Range.deleteContents()` は、ノードの数の 2 乗の時間が掛かる（部品の無い素の行でも、1,000 行を空にするのに 1.7 秒、2,000 行で 8.4 秒）。エンジンの不具合ではないが、happy-dom の上のテストと `@wcstack/server` の描画が遅くなる。

### F31〜F33・F35〜F37 の修正（2026-09-28）

Issue #372〜#391 の確認で見つけた F31〜F38 のうち、6 つを直した。F34（数値キーのオブジェクト）と F38（別の root へ移した要素の委譲されたイベント）は、直し方に判断が要るので残した（下の「残したもの」）。

- **F31**（`dom/view.ts`）: `<select>` の `value`／`selectedIndex` に当てた値を、要素に控える（`applyTo`、symbol のキー）。中の `for:`／`if:` が選択肢を描いた後（`ForView.update`・`IfView.update`）に、`<select>`（`<optgroup>` の中ならその親）へもう一度当てる（`reselect`）。束縛を当てる順は変えていない。選択肢を後から読み込む形・並べ替え・選択肢と値を同じバッチで書く形も合う。選んだ選択肢が消えると、ブラウザが先頭を選ぶ代わりに、何も選ばない（`selectedIndex` -1）。静的な選択肢に無い値を当てたときと同じで、state の値は変わらない。利用者が選んだ値は書き戻しで控え直すので、選択肢が変わっても保たれる。
  - Chromium で確かめた（`e2e/tests/state-select-options.spec.ts`・`e2e/fixtures/state-select-options.html`・`state-select-shared-options.html`）。最初の描画の形は 3.3 でも通る。選択肢が後から変わる形と #376 の行ごとの `<select>` は `STATE=next` のときだけ走る（3.3 はその形を描かない、または値を当て直さない）。
- **F32**（`dom/plan.ts` の `boundPattern`）: 束縛のパスの `*` の段ごとに、その段の囲む `for:` の一覧と同じかを、計画を作る時点で確かめる。別の一覧なら `[wcs/wildcard-rank]` #1403（`"b.*.y" ranges over the rows of "b", but the enclosing "for" template at that level renders "a".`）で投げる。段が足りなければ #1401（囲む段の数も示す: `the scope provides 1.`）。束縛（テキスト・プロパティ・spread）、`for:` の右辺、`if:` の条件がすべてここを通る。
  - ページの直下の #1401 の検査（`dom/mount.ts`）は、ここに移ったので外した。#1401・#1402 と同じく走査を止める（4.0 の「誤りは大きく失敗させる」）。3.3 は束縛ごとに `ListIndex not found` で失敗させていた。
  - #1403 の文面には直し方の案内（`$resolve(path, indexes)` で getter の中で読む）を付ける。lint への誘導は、lint が `*` の数しか見なかった間は付けなかったが、lint が 4.0 のパーサで #1403 を検出するようになったので付ける（2026-10-02、§3）。
- **F33**（`ssr/ssr.ts`・`scopes/component.ts`・`hooks.ts`）: ハイドレーションで、ページの側は Light DOM の `bind-component` の子の部分木に触らない（`prepare` と `holdRegions` が `componentScope` を飛ばし、その子を `deferred` に記録する）。子のエンジンがホストをマウントする直前（`start`）に、新しいフックの `adoptScope` がその部分木だけを戻して領域を預け、子のマウントの間だけ引き取りを有効にする。マウントの後は、そのマウントで預けた分の残りだけを捨てる（ほかのエンジンの領域は残す）。子のクラスがハイドレーションの後に定義されても、定義までサーバの描いた値・枝・行がそのまま見え、定義の後はサーバのノードを引き取る。ページの行の中の子、子の中の孫も同じ。core に増えたのはフックの欄だけ。
- **F35・F36**（`engine.ts`）: `$postUpdate(path)` は、`path` の下の一覧を書き込みと同じく同期し、それらの行（同じ配列を持つほかの一覧の行も）の束縛を積む（`touched`）。要素のパス（`$postUpdate("todos.1")`）は、行の値を配列の今の要素に取り直す。同じ配列を持つ一覧には `mirror` を通して届く（`direct` は false）。配列のその場の `push` は、これまでどおり検出しない（README の「新しい配列を代入する」）。`write()` の要素の分岐と葉の分岐は、一覧の同期と `mirror` を 1 か所にまとめた（動きは同じ）。
- **F37**（`features/diagnostics.ts`）: 診断の後付けの数値添字の読み替えを、core が accessor を付ける形（数値の添字の後ろに `*` が無い）だけに限った（`wildcardForm`）。`for: groups.0.items` の行の `{{ .double }}` は `binding-path-missing` で警告し、同じ形の行 getter（`groups.*.items.*.double`）が宣言されていれば、その getter がどの入れ子の `for:` の行に効くかを添える（`The getter "groups.*.items.*.double" is declared for the rows of for: groups → for: .items; a list named by an index has rows of its own.`）。core は変えていない。
- テスト: Issue の再現を `__tests__/issues2-ssr.test.ts`・`issues2-lists.test.ts`・`issues2-paths.test.ts`・`issues2-components.test.ts` に正式に置いた。まだ直していない形（F34 の 6 件、F38 の 1 件、F26 の系統の 3 件、#374 の inline の 1 件）は `it.fails` で残した。計測（#385・#389・#390・#391 の時間）は単体テストから外し、`bench/issues2.perf.test.ts` に置いた（`npx vitest run --config bench/vitest.perf.config.ts`、約 1 分）。単体テストには正しさ（再評価が祖先の経路だけ、入れ子の `$1` の追従など）だけを残した。

**残したもの**（判断が要る）
- **F34**: (1) `resolve` で、数値の段の入れ物が配列でなければ、その段を素のキーとして読み書きする（core +100〜200B の見込み。accessor の getter／setter がプロキシを通ると循環するので、データを直接読み書きする経路が要る）、(2) スクリプト側は形を指す誤りにし、`this.sales[2024].total` の書き方を案内する（+40〜80B の見込み）。
- **F38**: (1) ブロックの外（ページの直下）の要素のイベントだけ、要素に直接付ける（`event.currentTarget` が要素になり、ブロックの中の要素（ルート）と食い違う）、(2) 委譲のリスナーで `composedPath()` を見る。
- **F26 の範囲**（§8 の「Issue #372〜#391 の確認」の「F 番号を付けないもの」）: TodoMVC の絞り込み（写しを返す getter の行の checkbox）に当たる。決定の見直しか、README での回避の案内。
- **#389**: `forSubtree` が印の無い部分木を飛ばす案（core +50〜80B の見込み）。→ 2026-10-06 にパターンの回収で直した（§8「規模の検証」）。
- core の上限まで残り 287B（下の表）。F34 の (1) を入れると、ほぼ使い切る。[root-attributes.ja.md](./root-attributes.ja.md) §10 の計測は、この修正の前の core（19,494B、残り 506B）が基準なので、推奨の「属性＋`$config`／`$features`」（+314B）をそのまま入れると上限を 27B 超える。

| | 前（`5afa3976`） | 後 |
|---|---|---|
| テスト | 1,530 件（通過 1,527・意図した失敗 2・スキップ 1） | 1,715 件（通過 1,701・意図した失敗 13・スキップ 1） |
| カバレッジ | — | 99.65・98.86・100・99.93 |
| core（`core.min.js` gzip） | 19,494B | 19,713B（+219B。上限 20,000B まで 287B） |
| 全部入りの `auto`（gzip） | 40,963B | 41,581B（+618B。diagnostics +259B、ssr +134B、scopes +29B を含む） |
| e2e（`STATE=next`） | 135/135 | 138/138（`<select>` を足した） |

- 性能: 修正の前（`5afa3976` の src から同じ方法で作った `auto.min.js`）と後を、同じセッションで交互に 4 回ずつ（`scripts/audit-state-tech-warmth.mjs`、create1k・create10k・append1k・clear10k）。4 回の中央値の中央値は、warm 1,000 行作成 7.45 → 7.45ms、cold 1,000 行作成 11.8 → 11.95ms、warm 10,000 行作成 71.0 → 72.8ms、cold 10,000 行作成 80.2 → 81.7ms、append 1,000（warm）10.85 → 10.4ms、clear 10,000（warm）63.15 → 61.7ms で、差はばらつきの範囲（1 回ごとの幅は ±10ms を超える）。

### サイズの削減（2026-09-29）

core のサイズを減らす方策を試作して測り（候補ごとに core の gzip の差）、意味を変えない書き換えを採った。機能の置き場所を変える案（View Transition の自動命名を後付けへ −262B、formats の案内 −194B、コードの名前の表を診断の後付けへ −191B、CSP の診断 −85B、旧名の検査 −81B。どれも上限の見積もり）は、判断が要るので入れていない。

**効かないと分かったこと**: terser の設定の調整（−7B 以下）、よく出る名前（`index`・`getter` など）の短縮（各 0〜5B）、使われていないコードの削除（−6B）、重複を関数にまとめるだけの書き換え（gzip が繰り返しをほぼ只で縮めるので、減らないか増える）。減るのは、1 回しか出ない中身そのものを消したとき。

**入れたもの**
- engine 系（`engine.ts`・`pattern.ts`・`list.ts`・`strategy/dirty.ts`、約 30 件）: `$` 関数を名前をキーにした表（`api`）にする、`rootList`／`childList` を 1 つにする、`resolve` と `resolveApi` の行を降りるループを `rowOf` にまとめる、書くだけで読まれない欄（`Pattern.id`・`PatternTable.nextId`／`root`）を消す、`force` を `mark` にまとめる、setter・`invoke`・`callHook` の「文脈を差し替えて呼ぶ」を `callAt` にまとめる、など。`reconcile` の「全部挿入」「全部削除」の速い道を消す案（−38B）は入れていない（行の追加・削除の熱い経路のため）。
- DOM の層（`dom/view.ts`・`plan.ts`・`mount.ts`、15 件）: ページの走査と計画の走査を `walkBindings` 1 つにする、構造でない束縛を付ける処理（ページの直下と行）を `attachSpec` 1 つにする、コンストラクタで代入するフィールドを `declare` にする、フィルタのループを `pipe` にまとめる、届かない分岐を消す、など。
- element・wc・filters・parser（11 件）: 引用符の外を走査するループ 3 本を 1 本にする、束縛の文字列の解析の分岐を整理する、フィルタの登録の Map を 1 つにする、比較と算術のフィルタ 9 本を表にする、など。文面は変わらない。
- `tsconfig.json` に `useDefineForClassFields: false`（クラスのフィールドを定義でなく代入で作る。すべてのクラスに効く）。`HTMLElement` を継承するクラス（`WcsState` ほか）のフィールドに、DOM のアクセサと同じ名前は無い。
- `hooks.x !== null && hooks.x(...)` を `hooks.x?.(...)` にした（約 30 か所）。
- 後付けの受け口の名前を短縮した: `addHook(name, fn)`（名前を文字列で引く）をやめ、受け口に代入する形（`hooks.written = chain(hooks.written, fn)`、最初の答えが勝つ受け口は `first(handled | known | taken, hooks.x, fn)`）にした。`element`（DevTools に向けた欄と同名）と `detail`（DOM の名前）は短縮しない。

**性能**（この作業の大半）。入れた後で計ると、公式の js-framework-benchmark と同じ CPU 4 倍の減速の下で、いくつかの操作が遅く見えた。原因を切り分けて、次を直した。
- **呼ぶたびに closure を作る形**が熱い経路に入っていた。プロキシ経由の読み書きのたびに一覧を引く `childList`（`upsert(..., () => new StateList(p, row))`）、書き込みのたびの `syncListsUnder`（`forListsUnder(p, row, (l) => this.sync(l))`）、getter への書き込みの `enqueueBound`、行の位置が変わったときの `onIndexChange` と `invalidateUnder`（同じ深さの近道を消していた）。普通のループと同じ深さの近道に戻し、定数を作るだけの closure はモジュールの定数（`newSet`・`newArray`）にした。4 倍の減速の update10k は、直す前 HEAD と同じか +3〜13%、直した後 HEAD より 11% 速い（中央値、各 320 サンプル）。
- `$1` を読むたびに正規表現の test と `key.slice(1)` が走っていた（`$n` の 1 桁の速い道を消していた）。戻した。
- 委譲されるイベントでも、行ごとに `attachSpec` を呼んで何もせずに戻っていた（jsfb の行で 2 回）。行を組み立てるときに飛ばす。
- 4 倍の減速の create1k は、+1〜15% と回ごとに大きくぶれた。関数名を残したバンドルでプロファイルを取ると、コードの実行時間は HEAD と同じで、GC の時間だけが増えていた（割り当ての総量は HEAD より少ない）。毎回 GC を強制してから計ると、差は消える（HEAD の −2%）。GC がいつ起きるかの違いで、実行は遅くなっていない。追わなかった。
- 誤った警報: 同じページで繰り返す計測（`scripts/audit-state-tech-warmth.mjs`、1 回あたり 6 サンプル）で 3 回続けて「append（warm）+10%」と出たが、180 サンプルで計ると逆に 10% 速かった。jsfb の計測で出た update10k +5% も、240 サンプルでは 5% 速かった。途中で一度、プロファイラを付けたまま計っていた（引数の取り違え）ので、その回の数値は捨てた。
- 計り方: `e2e/bench/jsfb-verify.mjs`（公式と同じ 8 操作。作成・追加・全削除はページを毎回読み直す）と、`bench/inpage-ab.mjs`（ページの中で操作を続けて計り、バンドルを順番を入れ替えながら交互に開く。`--profile`・`--alloc`・`--gcbefore` で切り分ける）。このマシン（Windows のデスクトップ）は、ほかのアプリの負荷で周ごとの値が 30〜100% 揺れるので、1 回の比較の差が数%なら、順番を入れ替えた多数のサンプルで確かめる必要があった。
- 最後の確かめ（公式と同じ 8 操作、`jsfb-verify.mjs`、HEAD と交互に順番を入れ替えて。途中でマシンが眠ったので、4 倍の減速は 5 周、減速なしは組のそろった 4 周）: 4 倍の減速では、どの操作も有意な差が無い（|z| ≤ 1.3。中央値の比は create1k ×1.02、update10k ×0.91、append ×0.93、clear10k ×0.95、swap ×0.92）。減速なしでも、組のそろった周ごとに比べて差はばらつきの範囲（create1k 4.2/4.1・11.05/10.6・11.2/11.15・10.2/10.25ms）。まとめた値で遅く見えた回は、組の無い周がマシンの速い時間帯に入っていたため。

| | 前（`751cac99`） | 後 |
|---|---|---|
| core（`core.min.js` gzip） | 19,713B | 18,129B（−1,584B。上限 20,000B まで 1,871B） |
| 全部入りの `auto`（gzip） | 41,581B | 39,891B（−1,690B） |
| `index.esm.js`（gzip） | 44,390B | 42,623B（−1,767B） |
| 分割の core（`core.js` とチャンク） | 23,915B | 22,208B（−1,707B） |
| テスト | 1,715 件（通過 1,701・意図した失敗 13・スキップ 1） | 同じ |
| カバレッジ | 99.65・98.86・100・99.93 | 99.71・99.06・100・99.95 |
| e2e（`STATE=next`） | 138/138 | 138/138 |

- 試作の途中で入れていない案: `reconcile` の速い道の削除（上）、空の一覧に行を作るときの近道の削除を戻す案と `buildBlock` のノード探しのインライン化（どちらも計測で効果が見えず、バイトが増えるだけなので、削った形のまま）。
- [root-attributes.ja.md](./root-attributes.ja.md) の推奨（+314B）は、入れても上限まで 1,557B 残る。

### 設定の分割・`$behavior`・`$features`・分割 auto（2026-09-30）

[root-attributes.ja.md](./root-attributes.ja.md) の推奨（属性＋状態の宣言キー）を、[config-impl-plan.ja.md](./config-impl-plan.ja.md) の計画どおりに入れた。検討で `$config` と呼んでいたキーは、`bootstrapState(config)` と混ざらないように `$behavior` にした（root-attributes §13）。

- **設定の分割**（`config.ts`）: `bootstrapState` の設定はマークアップの表記（タグ名・束縛の属性名・コメントの接頭辞）と `locale`・`enableContractAnalyzer` だけにした。読まれていない `debug`・`commentTextPrefix`・`enablePropagationContext` を消した。知らないキー・型の違う値は `#44` で throw（これまでは黙って無視）。undefined の値は飛ばす。
- **`$behavior`**（`engine.ts`・`dom/plan.ts`・`dom/wc.ts`・`temporal/watch.ts`）: `enableMustache`・`sameValueGuard`・`enableDirectionalInitialSync` を状態の宣言にした。エンジンを作るときに読み、エンジンの欄（短縮名）に持つ。木ごとに違ってよい。コンポーネントの mount はホストから継がない。ボリュームに書くとエラー。再セットで変えると `#45`。SSR ではサーバも同じ状態を読むので、サーバとクライアントで食い違わない。
- **`$features`**（`hooks.ts`・`element.ts`・`scopes/component.ts`）: その状態が要る後付けの名前。エンジンを作る前に、足りない分を受け口 `hooks.load` で読み込む（分割 auto だけが埋める）。全部入り・バンドラでは検査だけ。読むものが無ければ待たない（起動の順番は変わらない）。`enable-ssr` の検査は読み込みの後へ移した。配列でなければ `#46`。
- **分割 auto**（`split-auto.ts`・`load.ts`・`build.mjs`）: `dist/split/auto.js`。import map 無しの 1 行で分割のビルドを使う。root の `<wcs-state>` の `features=` を定義の前に読む（scopes はここでしか入らない）。許可リストの 8 つだけを、自分の `import.meta.url` の隣の `features/` から読む。`exports` には載せない。
- テスト: `behavior-features.test.ts`・`split-auto.test.ts` を足し、`public-api`・`component`・`scopes` などに足した。実ブラウザ 3 つで、CSP（nonce＋`'strict-dynamic'`）の下の分割 auto を確かめた（[config-impl-plan.ja.md](./config-impl-plan.ja.md) §4）。
- 性能: `bench/inpage-ab.mjs`（CPU 4 倍の減速、ABBA、各 320 サンプル）で HEAD と有意な差なし（update10k ×1.019・t ≈ 1.4、create1k ×0.963）。
- カバレッジ付きの全体実行で `split.test.ts` の beforeAll が 60 秒を超える（HEAD でも 65 秒で落ちる。前からある問題）。`split-auto.test.ts` も同じくビルドと terser を回すので、並ぶと起きやすい。カバレッジは `split.test.ts` を除いて取った（src のカバレッジには効かないテスト）。

| | 前（`23debc13`） | 後 |
|---|---|---|
| テスト | 1,715 件（通過 1,701・意図した失敗 13・スキップ 1） | 1,749 件（通過 1,735・意図した失敗 13・スキップ 1） |
| カバレッジ | 99.71・99.06・100・99.95 | 99.71・99.05・100・99.95 |
| core（`core.min.js` gzip） | 18,129B | 18,369B（+240B。上限 20,000B まで 1,631B） |
| 全部入りの `auto`（gzip） | 39,891B | 40,208B（+317B） |
| `index.esm.js`（gzip） | 42,623B | 42,992B（+369B） |
| 分割の core（`core.js` とチャンク） | 22,208B | 22,328B（+120B） |
| 分割 auto（`auto.js` とチャンク） | — | 22,536B（`auto.js` の自分の分 602B） |
| e2e（`STATE=next`） | 138/138 | 138/138 |

### 全パッケージの bootstrap の設定の検査（2026-10-01）

state の `bootstrapState` と `$behavior` の分割（2026-09-30）の後、ほかのパッケージの bootstrap の設定にも同じ変更が要るかを調べた。state の問題の根（ページ全体の設定に、その木の振る舞いが入っていた）は、ほかには無い。I/O ノードの要素ごとの振る舞いは、最初から要素の属性（`manual`・`url` など）で書く。

| キー | パッケージ | 性質 |
|---|---|---|
| `tagNames.*` | 全部（25 はこれだけ） | 表記 |
| `triggerAttribute`（speech は `listenTriggerAttribute` も） | fetch・storage など 13 | 表記（`data-fetchtarget` の属性名） |
| `autoTrigger` | 同じ 13 | document に click の委譲を 1 本登録するかのスイッチ。発火させるかは要素の側（`data-xxxtarget` を書くか）で決まる |
| `enableShadowRoot` | router | ページの既定値。`<wcs-layout>`・outlet の `enable-shadow-root`／`disable-shadow-root` で要素ごとに上書きできる |
| `basenameFileExtensions` | router | URL の正規化（router と `<wcs-link>` が共有、router は複数置ける） |
| `loaders`・`observable` | autoloader | 関数の登録、ページ全体の MutationObserver |
| `createContext` | audio | 関数（AudioContext の生成を差し替える） |

どれも bootstrap に置いてよい。持ち込んだのは次の 2 つ。

- **読まれていないキー**: autoloader の `scanImportmap` は受け取るがどこからも読まれず、`false` でも import map を読んでいた（state の `debug` と同じ）。import map を読まない autoloader は何もしないので、実装せずに消した。
- **`setConfig` の検査**: 41 パッケージは知らないキー・型の違う値を黙って無視していた（storage だけは文字列でないタグ名を飛ばしていた。`{ storage: undefined }` が `customElements.define(undefined, …)` を落とした指摘への対処）。state-next と同じ規則にした: 知らないキー、既定値と型の違う値（`null`、オブジェクトに配列、も）、定義していないタグ名、文字列でないタグ名は `[@wcstack/<pkg>] bootstrapXxx: "<key>" is not one of its options, or not of the option's type.` で throw し、先に全部を確かめるので何も当てない。undefined の値は飛ばす（`tagNames` の中も）。autoloader の `loaders` はこれまでどおり足し合わせる。state-next も同じ形にした（それまでは当てながら確かめていて、`tagNames` の中は見ていなかった）。
- 各パッケージの `__tests__/config-options.test.ts` は同じ形で書いた（知らないキー・型・`null`・配列・タグ名、投げたときに当てないこと、undefined）。1 行に書いた `for (…) if (…) 文;` は、v8 のカバレッジが分岐の数を負に数える（`config.ts` の分岐が 95.83% に見えた）ので、ブロックに分けて書いた。
- テスト: 41 パッケージで 5,105 → 5,481 件、すべて通過。カバレッジのしきい値と lint も通る。storage の「文字列でないタグ名は無視する」テストは「undefined は飛ばし、ほかは投げる」に直した。state-next は 1,755 件（通過 1,741・意図した失敗 13・スキップ 1）。`split-auto.test.ts` の `DOMContentLoaded` の待ちのテストは、負荷の下で `import()` が遅れるとエントリが待ちを登録する前にイベントを出してしまう競合があったので、登録を見届けてから出すようにした。
- state-next のサイズ（gzip）: `core.min.js`・`auto.min.js` は変わらない（`setConfig` は `bootstrapState` からしか届かない）。`index.esm.js` 42,992 → 43,068B、分割の core 22,328 → 22,418B。
- 3.x の `packages/state` は 4.0 で state-next に置き換わるので、変えていない。
- テストを流すため、この worktree に無い依存を本体のチェックアウトの `node_modules` からジャンクションで借りた（git の対象外。作業の後に外した）。

### main の 3.5.0 の取り込み（2026-10-03）

main（3.3.0 の `a796d712` から 3.4.0・3.5.0 の `dda6320c` まで、78 コミット）をマージで取り込んだ。衝突は 134 ファイル。扱い:

- **`packages/state`**: 4.0 の差し替え（R1）まで 3.x のままなので main を取った（README も）。binder プロトコルの写しだけは正本（`/protocol/binder.ts`）から作り直した。正本の `IWcsBindOptions.range` の doc は main の「3.x は第 2 引数を読まない」とこのブランチの「4.0 は宣言が無ければ #204」を両方書いた（`scripts/sync-protocol-types.mjs` で router・state・state-next の写しへ）。
- **`packages/router`**: src とテストは main の #404 を基にした（§3.2）。`config.ts` はこのブランチの投げる版に、main の `deepClone` の配列の扱いを入れた。README・`docs/binder-protocol-design.md`・`docs/ssr-router-design.md` は 3.x と 4.0 の両方を書いた（router の README は直下の構造テンプレートを版ごとの箇条書きに、binder の文書は main の §9-5「ルートの範囲」の後ろに、このブランチの 4.0 の節を §9-6「マークアップの誤りの扱い」・§9-7「文書に接続していないサブツリー」として番号を付け直した）。
- **41 パッケージの bootstrap**: このブランチの throw する `setConfig` と `config-options.test.ts` を取った（3.5 の警告は 3.x のもの）。main のテストのうち 4.0 にも当てはまる「知らないキーでも値が undefined なら飛ばす」を各テストに 1 行足した。autoloader は `scanImportmap` を消したこのブランチの版。storage の「文字列でないタグ名」のテストもこのブランチの版。
- **vscode-wcs・lint・typescript**: 4.0 の規則を基にした（vscode-wcs の CHANGELOG の Unreleased「main の 3.4 / 3.5 から移したもの」）。`wcs/v4-migration` は持ち込まない。移したもの: `wcs/delegated-current-target`（warning）、`analyzeElementContexts`、`for: items;` の `firstExpressionOf`、`substrRewrite` の負の length、raw text 要素の表を `htmlParse.ts` の 1 つに。lint の smoke は 22 → 24 件（数値添字のパスの 4.0 版と `wcs/delegated-current-target`）。CHANGELOG はこのブランチの Unreleased を先頭に、main の 1.21.0・1.20.0 をその後ろに置いた。package.json は 1.21.0（main が 3.x 向けに公開した最新の版。取り込んだ `dda6320c` の後で main に入った #413 の版上げの中身を先に入れた）。
- **文書**: `docs/csp(.ja).md` は main の訂正版を取り、§9 の末尾に 4.0 の番号の文面（#42 / #43）の 1 段落を残した。`docs/migration-v4(.ja).md` は main から。CLAUDE.md は main の size gate の数字（3.5.0）とこのブランチの state-next・vscode-wcs・リリースの段落を両方。AGENTS.md の vscode-wcs の項はこのブランチの依存（`file:../state-next`）に直した。`examples/router-i18n` の README と index.html は 3.x と 4.0 を書き分けた。
- **例・e2e**: main の `state-intersect-scroll`（`$watch`）・`state-tilt-maze`（`#direct`）、main の CSP の spec と fixture を取った。

| | 結果 |
|---|---|
| state-next | 1,988 件（通過 1,974・意図した失敗 13・スキップ 1）、lint・型検査も通過 |
| router | 825 件すべて通過（state-next との結合 10 件、3.x との結合を含む） |
| vscode-wcs | 1,114 件すべて通過、型検査も通過 |
| lint の smoke | 24 件すべて通過 |
| typescript | 56 件すべて通過 |
| 3.x の state | 4,980 件すべて通過 |
| `wcs-validate`（リポジトリの HTML 76 件） | 0 error・102 warning・26 info（取り込みの前と同じ） |

- lint・typescript の dist はテストのために作り直し、コミット済みのもの（取り込みの結果 — main の 3.5.0 のビルド）に戻した。41 パッケージのコミット済みの dist も main の 3.5.0 のビルド（警告する版）で、このブランチの src（投げる版）とは違う — dist はリリースのときに作り直す。
- 41 パッケージのテストは、取り込みのレビューで流した（router 以外の 40 パッケージで lint・tsc・カバレッジ付きテスト、計 4,706 件すべて通過）。

### 4.0.0-rc.1 の部分リリース（2026-10-04）

- `premajor-rc` の実行（run 37151131398、6573b5cc）は、公開の段で router の `prepublishOnly`（build + test:coverage）が落ちて止まった。`__tests__/version.test.ts` が `VERSION` を `.` で割って先頭 3 つを数値として読み、`4.0.0-rc.1` の `0-rc` で落ちた。このテストは版を上げた後にしか落ちないが、release.yml の「Test all packages」は版上げの前に走っていたので見逃した。
- npm の `next` に出たのは 31 パッケージ（state と、アルファベット順で accelerometer〜resize）。router 以降の 18 パッケージ（wcstack を含む）は出ていない。`latest` は 3.5.4 のまま。タグも bump の commit も無い（runner の上にだけあった）。
- 復旧（ユーザーの決定）: rc.1 は欠けたまま残し、rc.2 に進む。
  - router のテストがプレリリースの後置を受け付けるようにした。
  - release.yml のテストを版上げと再ビルドの後（公開の前）に移した。
  - 全パッケージの版を手で `4.0.0-rc.1` にした（`npm version`。内部の `@wcstack/*` の範囲は ^3.5.4 のまま。rc.2 の実行が厳密な版にそろえる）。
  - 版を rc.2 に上げた状態で、全パッケージの `prepublishOnly` を手元で通してから `prerelease-rc` を実行する。
  - rc.2 を出した後、31 パッケージの rc.1 を deprecate する（npm のログインと OTP が要るので、ユーザーが実行する）。
- ドキュメントの rc の例と state README の CDN のピンは rc.2 に合わせた。
- rc.2 の 1 回目の実行（run 37154155325、385d5c2f）は「Install dependencies」で止まった（公開の前なので何も出ていない）。server の lockfile は `../state` へのリンクを記録しており（main でも同じ。公開後の lock の同期がそう書く）、`npm ci` はリンク先の版を範囲と突き合わせる。手で版だけを rc.1 にしたので、server の `^3.5.4` が state の 4.0.0-rc.1 を満たさなかった。workflow は版上げの前に `npm ci` するので、自分の実行ではこうならない。rc.1 の実行が公開の後にしたはずのこと（server と testing の内部の範囲を厳密な rc.1 にし、lockfile を同期する）を commit して、全パッケージのクリーンな `npm ci` を確かめてから再実行した。
- A1（`@wcstack/state`（`.`）から `defineState` だけを import してもエンジン、約 21 KB が残る）: 4.0 の仕様として受け入れる（2026-10-04、ユーザーの決定）。型だけが要る用途には `@wcstack/state/define`（40 B）を案内する（移行ガイド §3.7・state README）。

### 4.0.0-rc.2 の公開（2026-10-04）

- `prerelease-rc` の 2 回目の実行（run 37154825167、3b96e9ab）で公開した。全 49 パッケージが npm の `next` で 4.0.0-rc.2（`latest` は 3.5.4 のまま）。タグ `v4.0.0-rc.2` と GitHub のプレリリース。bump の commit は 4436fa72。
- 確かめたこと: 全パッケージの dist-tag、server の依存と testing の peer が厳密な `4.0.0-rc.2`、state README の CDN のピン（`@4.0.0-rc.2/dist/split/…`）と `esm.run` の `/auto`（state・router・wcstack）がどれも 200。
- サイズと結合のゲートの基準値を rc.2 の dist で取り直した。core.min.js 19,530B（上限 20,000B）、split core 23,652B、`index.esm.js` 49,331B、`auto.min.js` 46,249B（gzip）。
- 残り: rc.1 の 31 パッケージの deprecate（ユーザー）。rc を試してもらった結果で必要なら rc.3。4.0.0 は §6 の手順（main へのマージ → main で `release`。拡張 2.0.0・スキル v4.0.0・CDN のピンを 4.0.0 に）。

### 既知の制限の解消（2026-10-05）

移行ガイド §5 の既知の制限 11 件を、領域ごとに 4 つのブランチで並行して直し、research にマージした。

- **research/kl-core**
  - 配列でないオブジェクトの下の数値キー（F34、#382 の形 2）: 書いたとおりの綴りのキーとして、読み・書き・`$eq`・双方向の書き戻し・`$watch` に効く。
  - 再セットの後の列挙: プロキシの target を空の `{}` にし、`has` / `ownKeys` / `deleteProperty` / `defineProperty` / `getPrototypeOf` をいまの state に転送する。記述子は `configurable: true` で返す。副作用として、`Object.isFrozen(this)` などは空の target について答える。
  - クラスの状態の getter を持たない state への再セット: ほかの落ちたキーと同じく空にする。
- **research/kl-life**
  - 後から入れたコンポーネントのホストを、`<wcs-state bind-component>` の接続で配線する（3.x も待ち続けた）。
  - 差し替えた `<wcs-state bind-component>` を戻すと、スコープを引き取る。
  - ルートの `<wcs-state>` を戻すと、その間に接続した volume を接ぎ、その間に binder に渡された内容を（range ごと）束ねる。
  - ルートの `$connectedCallback`（入れ直し）と `$disconnectedCallback` の失敗を `console.error` で報告する（新しいメッセージ #51）。
  - ルートの `<wcs-state>` が切り離されたら、登録を外す（つなぎ直せば戻す）。内容ごと外したルートの状態と DOM は回収される。
- **research/kl-temporal-ssr**
  - `$stream` の実行がそのタスクの中で書くもの（値・`done` / `error`）が、起こす `$watch` にも実行の連鎖を引き継ぐ。すぐに値を出す source の `$watch` → `$stream` の循環は、約 16 周で切れて止まる。
  - トレードオフ: そうした source で回す、終わる自動ページ送りも 16 ページほどで止まる（3.x と rc.2 は最後まで回した）。ユーザーの決定でこのまま採用した（2026-10-05）。
  - SSR: 連鎖のテンプレートの間のコメント（とコメントの束縛）を越えて、サーバーの枝を引き取る。
- **research/kl-lists**（F26）
  - 行の下への書き込みが、getter が結び付ける配列（写しを返す絞り込み・並べ替え・切り出し・連鎖・volume の中）の、オブジェクトを持つ行に届く。その配列がオブジェクトを持つ getter は評価し直す（`Engine.mirror`）。
  - 行を作るときの記帳は無い。共有・getter・依存のある一覧だけが辿る。
  - #362 の「戻ったときの描き直し」（`was`）は外した（−41B）。書き込みの時点で行をそろえるので要らなくなった。ただ、次の狭い場合は rc.2 より後退する。
    - 絞り込みの間に `$postUpdate("todos")`（一覧のパス）で知らせた変更
    - 普通のキーの別名の配列を通した書き込み
    - getter が生で読んだ入れ子の元を通した書き込み

    これらは、元の配列に戻ったときに描き直されない。戻すなら +41B。
- **残る既知の制限**（§5）: 1 つの一覧の中の同じオブジェクトの重複と、getter が結び付けない普通のキーの 2 本の配列（#378 の `backup`、#401）。どの形でも、共有していない一覧に費用がかかるので見送った（kl-lists の分析）。

**サイズ**（gzip、rc.2 → マージ後）

| | rc.2 | マージ後 |
|---|---:|---:|
| core.min.js | 19,530B | 19,930B（上限 20,000B まで 70B） |
| 分割の core（チャンク込み） | 23,652B | 24,121B（上限 24,362B） |
| `index.esm.js` | 49,331B | 49,916B |
| `auto.min.js` | 46,249B | 46,849B |
| scopes / temporal / ssr | 8,718 / 3,699 / 5,294B | 8,868 / 3,707 / 5,296B |

**テスト**
- state: 2,973 件が通過（意図した失敗 6、スキップ 1）。カバレッジ 99.78 / 99.28 / 100 / 99.95。
- router 822 件、server 100 件と e2e 18 件、testing 15 件、devtools 170 件が通過。

**性能**: `bench/inpage-ab.mjs`（CPU 4 倍の減速、ABBA、8 ページ×40 回、n=320）で rc.2 の `auto.min.js` とマージ後を比べた。中央値の比は次のとおり。
- update10k ×0.998
- create1k ×1.045（p25 は ×1.008。マージ後の 1 ページだけ 28.0ms に跳ねた）。16 ページ（n=640）で測り直すと ×0.981（p25 ×1.000）
- replace1k ×0.988
- append ×0.991
- clear10k ×0.977（p25 ×0.985）

どの操作も rc.2 から有意に遅くなっていない。

**残した小さな点**
- マウントしたコンポーネントの同期の `$disconnectedCallback` の throw は、まだ外へ漏れる（`scopes/component.ts`）。
- binder プロトコルの `flushPendingBinds` は range を落とす（生成されたコピーなので、正本 `/protocol/binder.ts` で直す）。
- `mangle.mjs` の `fed` は使われなくなった。

### 4.0.0-rc.3 の公開（2026-10-05）

- `prerelease-rc` の実行（run 37300105190、73c7a9e0）で公開した。中身は rc.2 の後の既知の制限の解消（上の節）。
  - 全 49 パッケージが npm の `next` で 4.0.0-rc.3（`latest` は 3.5.4 のまま）。
  - タグ `v4.0.0-rc.3` と GitHub のプレリリース。bump の commit は 144046ea。
  - テストを版上げの後・公開の前に走らせるようにしてから、初めての rc。部分リリースにはならなかった。
- 公開の前に確かめたこと:
  - e2e（Playwright）139 件
  - vscode-wcs 1,160 件、lint のスモーク 26 件
  - 手元で試算した版の計画（rc.2 → rc.3）
- 公開の後に確かめたこと:
  - 全パッケージの dist-tag（@wcstack/upload は数十秒遅れて見えた）
  - server の依存が厳密な `4.0.0-rc.3`
  - state README の CDN のピンと、`esm.run` の `/auto`（state・router・wcstack）がどれも 200
- サイズと結合のゲートの基準値を rc.3 の dist で取り直した。
  - core.min.js 19,930B（上限 20,000B まで 70B。core に足すものは、どこかで削って払う必要がある）
  - split core 24,121B、`index.esm.js` 49,916B、`auto.min.js` 46,849B（gzip）

### core の縮小（2026-10-06）

- rc.3 の後、`core.min.js` は上限 20,000B まで 70B しか残っていなかった。ユーザーが承認した 3 つの移動で、19,930 → 19,500B（−430B、余白 500B）にした（research/core-slim）。
- **算術・変換・欠損値のフィルタ 14 本**（`add sub mul div mod abs clamp int float number string defaults coalesce nullIfEmpty`）を、core から formats へ移した。−178B。
  - core に残るのは条件の 10 本（`eq ne not lt le gt ge truthy falsy boolean`）。`else:` の `not` もここにある。
  - `/core` で formats が無いとき、移した 14 本は、表示フィルタと同じ「formats を入れよ」の壁で落ちる。`FORMATS_FILTER_NAMES` に名前を足す費用は 56B。
  - did-you-mean の同じ距離の候補の順を rc.3 と同じに保つため、`installFormats` は core の 10 本も rc.3 の位置に登録する。formats 側に +67B かかる。
  - 後から読み込む split のページだけは、この順が rc.3 と変わり得る。
- **`[wcs/<code>]` のコード名**（`CODES` / `codeOf`）を diagnostics へ移した。−167B。
  - diagnostics が無いときのメッセージは `#<番号> <値>` になる。diagnostics があるときは変わらない。
  - 全文で残す 2 つの壁（feature-not-installed と formats の壁）は、コード付きのまま。
- **3.x の旧名の検出**を diagnostics の `hooks.declare`（ほかの後付けより先に走る）と `hooks.dollar` へ移した。−85B。
  - 対象は `$scan`（#1）、`$streams` / `$updatedCallback`（#1601）、`$trackDependency` / `$untrackDependency`（#1701）。
  - diagnostics があれば同じエラーが出る。無ければ、知らない `$` 名と同じく何もしない。
- 全部入りの `.` と `/auto` は動きが変わらない。変わるのは `/core` だけを使うページ。
- formats と diagnostics が意図して大きくなったので、サイズと結合の基準値を取り直した。
  - formats 1,084 → 1,387B、diagnostics 6,928 → 7,189B
  - `index.esm.js` 49,971B、`auto.min.js` 46,927B、split core 23,655B
- テスト: すべて通過。
  - state 2,979 件（カバレッジ 99.78 / 99.28 / 100 / 99.95）
  - router 822 件、server 100 件と e2e 18 件、vscode-wcs 1,160 件
  - lint のスモーク 26 件、e2e（Chromium）142 件
- 文書も合わせた: CHANGELOG・移行ガイド §2 / §3.1 / §3.8 / §4.2・state-errors・state README・streams / define-state・wcstack の AI ガイド・vscode-wcs README。
- スキル（wcstack-skill）の 4.0 版で、`/core` のフィルタの数と、`/core` のメッセージの形を直すこと。

### 4.0.0-rc.4 の公開（2026-10-06）

- `prerelease-rc` の実行（run 37351211073、5ad45acf）で公開した。中身は rc.3 の後の次の 3 つ。
  - core の縮小（上の節）
  - 新しいデモ `examples/state-intersect-fetch`
  - `state-intersect-scroll` の e2e の Firefox 対応
- 全 49 パッケージが npm の `next` で 4.0.0-rc.4（`latest` は 3.5.4 のまま）。タグ `v4.0.0-rc.4` と GitHub のプレリリース。bump の commit は ae2be0ba。
- 公開の後に確かめたこと:
  - 全パッケージの dist-tag（`@wcstack/view-transition` と `wcstack` は、npm の表示が 2 分ほど遅れた。版は公開済みだった）
  - server の依存が厳密な `4.0.0-rc.4`
  - state README の CDN のピンと、`esm.run` の `/auto`（state・router・wcstack）がどれも 200
- ゲートの基準値を rc.4 の dist で取り直した（gzip は縮小の後の値と同じ）。core.min.js は 19,500B で、上限まで 500B。

### ネイティブ要素のコマンド（2026-10-06）

- `research/primitive-dom-commands`（`research/state-engine` の b135c762 から）。設計・調査・実装の記録は [native-commands.ja.md](./native-commands.ja.md)。
- 新しい後付け `native-commands`: ネイティブ要素の `command.<method>:` を、決まった表のメソッド（`<dialog>` の `showModal` / `close`、全要素の `focus`、`<video>` の `play` など）で呼ぶ。コアにはフック 1 本（`hooks.nativeCommand`）。第 1 引数が `Event` の emit（`onclick: $command.x`）は引数なしで呼ぶ。表に無いメソッドは `#1205`。完全版の入口は全部入りで、`/core` は後付けを入れなければ従来どおり `#1202`。
- core.min.js は 19,525B（+25B、上限まで 475B）、後付けは 499B。`split/auto.js` は 610B で上限 620B まで 10B。
- manifest に `nativeCommands`。vscode-wcs（`wcs-validate`）が表に無いメソッドを error にする。
- 残り: wcstack-skill の command-token の参照、VS Code 拡張の補完。

### 4.0.0-rc.5 の公開（2026-10-06）

- `research/primitive-dom-commands`（`native-commands` の後付け機能: ネイティブ要素の `command.<method>:`）を research に取り込み、`prerelease-rc`（run 37361706414、5f31f729）で公開した。
- 全 49 パッケージが npm の `next` で 4.0.0-rc.5（`latest` は 3.5.4 のまま）。タグ `v4.0.0-rc.5` と GitHub のプレリリース。bump の commit は 276b6043。
- 取り込みの後、公開の前に確かめたこと:
  - state 3,002 件（カバレッジ 99.78 / 99.28 / 100 / 99.95、lint・型検査）、router 822 件、server 100 件と e2e 18 件
  - vscode-wcs 1,167 件、lint のスモーク 26 件、typescript 58 件、devtools 170 件、e2e 145 件
  - リポジトリ全体のバリデーターでエラー 0 件、生成ファイルの同期の検査 4 本、組み込みタグのカタログの検査
- 公開の後に確かめたこと:
  - 全パッケージの dist-tag（3 つが約 1 分遅れて見えた）
  - server の依存が厳密な `4.0.0-rc.5`
  - CDN（`split/features/native-commands.js` を含む）と `esm.run` の `/auto` が 200
- ゲートの基準値を rc.5 の dist で取り直した。
  - core.min.js 19,525B（上限まで 475B）、native-commands 499B
  - `index.esm.js` 50,306B、`auto.min.js` 47,329B

### 規模の検証（2026-10-06）

- 「4.0 のエンジンは大規模でも破綻しない」を示すための検証。設計・計測・修正の記録は [scale-verification.ja.md](./scale-verification.ja.md)。
- 試験的な計測（のちに `bench/scale/` のスイートに置き換えた）とスイートで、破綻する箇所を 3 つ見つけて直した。
  - 同じ値が並ぶ一覧の reconcile が O(n²)（バケットの `shift()`）で、1 セルの変更で後ろの行が全部動いていた。`pop()` にし、同じ位置に同じ値がある行をその場に残す。0/1 の盤面 90,000 セルで 4.6 s → 6 ms。
  - データから組み立てたパス（`this["usersById." + id]`）のパターンと依存の辺が残り続けていた。root の getter の依存を最後の評価の分にし（配列を持つ source は F26 のために残す）、drain の後に何も持たないパターンを回収する。`literalCache` は 4,096 件で空にする。#389 の主な形もこれで直った。
  - happy-dom（`@wcstack/testing` と SSR の DOM）で、一覧を空にするのが O(n²) だった（`Range.deleteContents()` が 2 乗。1,000 行で 15 s）。親の子が一覧とテキストだけなら `replaceChildren` の 1 回（テキストは付け直す）、それ以外はノードを順に消すループにした（5 ms。Chromium の clear10k は Range より 14% 速い）。
- 振る舞いの変化: 重複した値の一覧の全体の代入で使い回す行が変わる（#359 の `$watch` の発火位置は 3.x と同じになった）。root の getter は、前の評価でだけ読んだパスの変更で評価し直さない。
- core.min.js 19,525 → 19,921B（+396B、上限まで 79B）。テスト 3,020 件、カバレッジ 99.79 / 99.29 / 100 / 99.95。
- 検証のスイートは `packages/state/bench/scale/`（happy-dom の `npx vitest run --config bench/vitest.scale.config.ts`、Chromium の `node bench/scale/browser.mjs`、表の `node bench/scale/report.mjs`）。
- 結果（2026-10-07、[docs/research/state-engine/scale/2026-10-07/](../research/state-engine/scale/2026-10-07/README.md)）: happy-dom・Chromium とも 33 軸すべてが PASS。局所性（無関係な規模を 100 倍にしても書き込みの仕事は同じ）、線形性（一覧の操作は 16,000 行まで k 0.91〜1.04、Chromium）、有界性（表の大きさが一定、ヒープの増分は 1 周 260B 以下）、限界（getter 128 段で番号付きのエラー、入れ子 100 段・自己再帰 150 段で `RangeError` なし）、正しさ（ランダムな操作 2,500 回で食い違い 0）。

### 4.0.0-rc.6 の公開（2026-10-07）

- `research/scale-verification`（規模の検証と、規模で破綻する 3 箇所の修正）を PR #430 で research に取り込み（d14cf495）、`prerelease-rc`（run 37525045114、36 分）で公開した。
- 全 49 パッケージが npm の `next` で 4.0.0-rc.6（`latest` は 3.5.4 のまま）。タグ `v4.0.0-rc.6` と GitHub のプレリリース。bump の commit は 83c95d35。
- 取り込みの前に確かめたこと（research への PR では CI が走らないので手元で）:
  - state 3,020 件（カバレッジ 99.79 / 99.29 / 100 / 99.95、lint・型検査、サイズとカップリングの検査）、router 822 件
  - 規模の検証のスイート: happy-dom 33 / 33、Chromium 33 / 33
  - 公式のベンチマークのページの A/B（CPU 4 倍の減速）: clear10k 0.861 倍、ほかは差がばらつきの範囲
  - src から作った state の dist の上で: e2e 145 件、server 100 件と e2e 18 件、testing 15 件、devtools 170 件、wcstack のスモーク 3 件（バンドルを作り直して）、vscode-wcs 1,167 件（manifest とパーサーの出力は変わらない）。確かめた後で dist は戻した。
- 公開の後に確かめたこと:
  - 全パッケージの dist-tag（2 つが約 1 分遅れて見えた。公開のログには 49 件すべての `+ name@4.0.0-rc.6` がある）
  - server の依存が厳密な `4.0.0-rc.6`
  - CDN（split の core・auto・features の 3 本と `native-commands`）と `esm.run` の `/auto`（state・router・wcstack）が 200
  - jsDelivr の `index.esm.js` がコミットされた rc.6 の dist と同一で、修正（`replaceChildren`、`literalCache` の上限）を含む
- ゲートの基準値を rc.6 の dist で取り直した（カップリングは基準値どおり）。
  - core.min.js 19,921B（上限まで 79B）
  - `index.esm.js` 50,689B、`auto.min.js` 47,744B、split の core 24,119B

### core の上限を 20 KiB に（2026-10-07）

- ユーザーの判断で、`dist/core.min.js` の絶対の上限を 20,000B から 20 KiB（20,480B）にした（`scripts/check-state-size.mjs` の `HARD_LIMITS`）。rc.6 の 19,921B で、残りは 79B から 559B になった。

### examples での rc の評価（2026-10-07）

利用者のアプリが少なく rc を評価できないので、リポジトリの examples（`examples/` と `packages/state/examples/`）を 4.0 の書き方で書けているか確かめ、実ブラウザの e2e で動きを確かめた。

- **4.0 の書き方**: rc.6 の dist から組み直した vscode-wcs の validator で、両方のディレクトリの HTML はどれも error 0。warning 53 件は、空の配列で始まる一覧・モジュールの const を指すキー・Map を返す getter の下のパスを lint が推論できないものと、router-i18n の `wcs/base-href-missing` だけ。lint が見ない書き方（`event.currentTarget`、`#stop` と `stopPropagation()`、`[data-wcs]` のセレクタ、`bootstrapXxx()` のオプション、並べ替えのための要素への書き込み）にも 3.x の形は無い。`currentTarget` を読む state-tilt-maze のドラッグは `#direct` 済み。
- **e2e**: 未対象だった examples 25 本の spec を足した（142 件）。対象外は `websocket-chat/react`・`/vue`（state を使わない Vite のアプリ）だけ。`e2e/serve.mjs` は esm.run の URL を各パッケージの `exports` で書き換えるようにした（`@wcstack/signals/dom` も届く）。オリジンのルートに置く SPA・チャンクの応答・SSR は、spec がデモのサーバーを `WCS_LOCAL=1` で立てる（router-i18n に加えて router-spa・ssr・streams）。足りないプラットフォームの API は `addInitScript` の差し替えか Chromium の機能（偽のカメラ、コンテキストの権限）で与える。全 287 件（既存 145 件＋新規 142 件）。4 つの修正の後の dist で `--repeat-each=3` の 861 件がすべて通る（検証の後、state と audio の dist はコミット済みの rc.6 に戻した）。
- **見つけた不具合と修正**（1〜3 は 3.x では起きず rc で入ったもの。4 は 3.x からあり、4.0 では読み込み直後から起きるようになったもの）:
  1. 消えた行のコンポーネントの中にマウントしたコンポーネント（行の `state: .`・行でない部分マウント）が描き続け、ホストの getter を読みに行って `The host row of <x> was removed.` を `console.error` に出す（recursive-tree で子を持つ節点を外したとき）。描画の結果は正しい。`scopes/component.ts` の drain の止め方が、自分の行しか見ていなかった。マウントの連鎖をルートまでたどって止める（`inPlace`）。
  2. 双方向の `value:`・`radio:` で、要素の書き戻しと、最後に当てた値へ戻す書き込み（送信の後のクリア、入力の検証）が同じ drain に入ると、要素が状態を映さない（state-testing-todo。デモ自身のヘッドレスの vitest も 5 件中 1 件落ちていた）。`Binding.writeBack()` が最後に当てた値を残し、apply が「変わっていない」と判断していた。書き戻した後の apply は必ず走らせる。radio は同じグループのほかの radio のチェックをブラウザが外すので、毎回当て直す。
  3. `style.<camelCase>:`（`style.backgroundColor:`）が黙って効かない（state-color-palette。eyedropper の README も同じ書き方）。4.0 は `style.setProperty()` だけで書いていた。`-` を含まない名前は 3.x と同じく `style[name]` に書く（ケバブケースとカスタムプロパティは `setProperty`）。
  4. boolean の属性ミラー。state は wc-bindable の `inputs[].attribute` に boolean を `String(value)` で写していた（README の表。3.x も同じ）。`false` が `active="false"` になり、属性の有無で真偽を決める I/O ノード（wakelock の `active`、camera の `keep-alive`、geolocation の `watch`、各 `manual` など 40 の入力）は真と読む。3.x では true → false に戻したときだけ起き、4.0 は初期の適用でも写すので読み込み直後から起きた（pomodoro・tilt-maze が読み込み直後から wake lock を取り、camera の `keepAlive: recording` が効かない）。**決定（2026-10-07、ユーザー）: state の写し方を変える** — HTML の真偽属性として写す（true は `""`、false は外す。`dom/wc.ts` の `mirrorAttribute`）。`"off"` でない限り on の `<wcs-audio>` の `limiter` / `resumeOnGesture` は、どちらの写し方でも false を書けないので、宣言から `attribute` を外した（setter が `"on"` / `"off"` を書く）。ほかの I/O ノードの入力は、属性の有無で読むもの（40）か文字列・数値で、`[x="false"]` を当てるスタイルも無い。README の表、移行ガイド §3.4・§4.1、CHANGELOG に書いた。
  - `packages/state/__tests__/fixes.test.ts` に 5 件、`coverage-element-wc.test.ts` に 1 件、audio に 1 件。state のテスト 3,026 件、カバレッジ 99.79 / 99.29 / 100 / 99.95。core.min.js 19,921 → 19,954B（+33B）、scopes +9B。audio 197 件。router 822 件、server 100 件と e2e 18 件、state-testing-todo の vitest 5 件。
- **examples の直し**: ssr（`@wcstack/server` の依存が `^1.15.0` のままで 4.0 を一度も通らなかった → `^4.0.0-rc.6`。`WCS_LOCAL=1`。README の SSR 出力の記述が 3.x の印のままだった）、router-spa（`WCS_LOCAL=1`。README の「router が後から刻むノードはバインドされない」は 3.x の制約）、state-devtools-playground の README（state の後に devtools を読むと declared の台帳に落ちる、は 3.x だけ）、state-camera-record-upload（`.rec { display: inline-flex }` が `[hidden]` に勝ち、REC が常に見えていた）、streams の README（実装の場所、ReadableStream の読み方）。
- **ほかのパッケージの直し**（examples の e2e で見つけたもの。ユーザーの指示で 2026-10-07 に直した）:
  - `@wcstack/devtools`: 開いたままの State ペインがページからの書き込みに追従しなかった（timeline の変化で timeline ペインしか描き直していなかった。devtools-tag-design §10 G-U1 と食い違い、2026-07 から）。空でない update-batch ごと（⏸ の間も）に読み直す。Core の変化の種類に `values` を足した。インライン編集の入力欄にフォーカスがある間とペインでポインタを押している間は待ち、展開した枝とスクロール位置は保つ。G-U1 の記述も訂正した。右ドック（420px）でヘッダーがはみ出し × が画面の外に出ていた: 選択と操作のボタンを縮んで横にスクロールするまとまりにし、ドックと × は常に右端に残す。README の「Late attach」を 3.x と 4.0 で書き分けた。テスト 181 件（+11）、カバレッジ 100 / 98.55 / 100 / 100。
  - `@wcstack/websocket`: `<wcs-ws>` が 1 回の接続で 2 本張っていた（3.x から）。`attributeChangedCallback` が同じ値でも繋ぎ直し（setter 自身の属性の書き込みに state の属性ミラーが続く）、upgrade では `attributeChangedCallback` と `connectedCallback` の両方が繋いでいた。url が変わったときだけ、`connectedCallback` が接続を判断した後に限って繋ぎ直す。テスト 162 件（+11）、カバレッジ 100%。
  - `examples/websocket-chat/react`・`/vue`: 依存を `@wcstack/websocket ^4.0.0-rc.6`、`@wc-bindable/react` / `vue ^0.9.0` にした（`^1.8.1` / `^0.8.0` のままで、lockfile は websocket 1.22.6 だった）。インストール・型検査・ビルドを通し、本物の WebSocket サーバーに対して接続・echo・broadcast を Playwright で確かめた。
  - wcstack-skill の `release/v4.0.0`（未コミット）: 真偽属性の写し方、`<wcs-audio>` の `limiter` を写さないこと、`style.PROP` の名前の書き方。
  - 4 つの修正の後の dist（state・audio・websocket・devtools）で e2e 289 件 × 3 回がすべて通り、`test.fail` は残っていない。検証の後、dist はコミット済みの rc.6 に戻した。
- **残したもの（ほかのパッケージ。直していない）**:
  - `<wcs-ws>` の書く順番: state が `url` を `manual` / `autoReconnect` より先に書くと、最初の接続は自動再接続なしで張られ、`manual: true` も効かない（修正前からの挙動）。`<wcs-fetch>` のようにマイクロタスクへ遅らせれば解消するが、接続が同期でなくなる。
  - `<wcs-storage>`: `key` の `attributeChangedCallback` に同値ガードが無く、upgrade で 2 回、同じ `key` の書き込みとミラーでも読み込み直し、loading と value を出し直す（読み込みは同期で結果は同じ）。
  - `<wcs-infinite-scroll>`: 監視する属性のどれでも、同じ値で IntersectionObserver を作り直す。番兵が見えていて fetch が止まっているときに同じ値の書き込みがあると、余分にページを取得しうる。
  - sse・worker・broadcast・media-query は同値ガードを持たないが、Core が同じ値の 2 回目を無視するので問題ない。
  - examples の CDN の URL は版を固定していない（R8 のとおり、rc の間は npm の `latest` の 3.5.x を読む）。4.0 の評価は e2e がローカルの dist に書き換えて行う。

### 4.0.0-rc.7 の公開（2026-10-07）

- `research/examples-eval`（examples での評価と、そこで見つけたものの修正）を PR #431 で research に取り込み（7ad8f932）、`prerelease-rc`（run 37543829812、33 分）で公開した。
- 全 49 パッケージが npm の `next` で 4.0.0-rc.7（`latest` は 3.5.4 のまま）。タグ `v4.0.0-rc.7` と GitHub のプレリリース。bump の commit は 23114db6。
- 取り込みの前に確かめたこと（research への PR では CI が走らないので手元で）: state 3,026 件（カバレッジ 99.79 / 99.29 / 100 / 99.95、lint・型検査、サイズとカップリングの検査）、router 822 件、audio 197 件、websocket 162 件、devtools 181 件。src から作った dist の上で e2e 289 件 × 3 回、server 100 件と e2e 18 件、testing 15 件、wcstack のスモーク 3 件、vscode-wcs 1,167 件、state-testing-todo の vitest 5 件。確かめた後で dist は戻した。
- 公開の後に確かめたこと:
  - 全パッケージの dist-tag（3 つ — screen-orientation・websocket・wcstack — がレジストリに約 2 分遅れて見えた。公開のログには 49 件すべての `+ name@4.0.0-rc.7` がある）
  - server の依存が厳密な `4.0.0-rc.7`
  - CDN（split の core・auto・features の `scopes` と `native-commands`）と `esm.run` の `/auto`（state・router・wcstack）が 200
  - jsDelivr の `index.esm.js` がコミットされた rc.7 の dist と同一
  - コミットされた rc.7 の dist のまま（手元でビルドせずに）e2e 289 件がすべて通る
- ゲートの基準値を rc.7 の dist で取り直した（カップリングは基準値どおり）。
  - core.min.js 19,954B（上限 20,480B まで 526B）
  - `index.esm.js` 50,740B、`auto.min.js` 47,792B、split の core 24,156B、scopes 8,878B
- wcstack-skill の `release/v4.0.0` に、真偽属性の写し方などを入れた（f8dd5f4、push 済み）。main へのマージは 4.0.0 のとき。

### ソースマップを戻す（2026-10-08）

- 4.0 は `.map` を公開しないと決めていた（3.5.4 は 24 個で、展開後の 8.4 MB のうち 6.7 MB）。**決定（2026-10-08、ユーザー）: 戻す。TypeScript のソースをマップに埋め込む形（A）**。比べた形 B（ソースを入れずに `src/` をパッケージに含める）は 1.8 MB で済むが、マップ単体で完結しない。
- `build.mjs` が esbuild に `sourcemap: 'external'`（`sourcesContent: true`）を渡し、`minify.mjs` の terser が esbuild のマップを読んでつないだマップに置き換え、`//# sourceMappingURL=` を足す。対象は `index.esm.js`・`auto.min.js`・`dist/split` のすべてのファイル（24 個）。`core.min.js`（計測用で公開しない）とツールの入口（`define`・`manifest`・`parser`）には付けない。`package.json` の `files` は変えない（`dist` の下は全部入る）。
- マップは 2.25 MB、公開する dist は 0.58 → 2.83 MB。ビルドは決定的なまま（2 回の出力が同一）、`sources` は相対パス。
- 確かめたこと: Node の `--enable-source-maps` でスタックトレースが `src/config.ts:49:7`・`src/messages.ts`・`src/parser/raiseError.ts` と元の関数名で出る（マップが無いと `index.esm.js:1:2238` の `v`）。Chromium が `auto.min.js.map` を読む（`Debugger.scriptParsed` の `sourceMapURL`）。`wcstack/auto` は rollup が state の中のコメントを落とし、自分のマップの行だけを持つ。
- 各ファイルが `//# sourceMappingURL=` の 1 行（gzip で約 25B）ぶん大きくなり、小さな後付け（`native-commands` 498 → 526B、`split/auto.js` 613 → 636B）が 3% を超えたので、サイズの基準値を取り直した。core.min.js は変わらない（19,954B）。
- state 3,026 件（カバレッジ 99.79 / 99.29 / 100 / 99.95）、lint・型検査、カップリングの検査、server 100 件、wcstack のスモーク 3 件、vscode-wcs 1,167 件、e2e 289 件。確かめた後で dist は戻した（rc.8 の公開で作り直す）。
- CHANGELOG の Removed の「source maps」と、移行ガイド §3.8 の「ソースマップは入らない」を外した（3.x と同じく入る）。

### js-framework-benchmark を rc.7 で取り直す（2026-10-08）

- 公式のハーネス（`f2df01a`）で、4.0.0-rc.7・3.5.4・signals・vanillajs を 1 回のセッションで測った。Chrome 154、既定の回数と CPU スロットル。記録と表は [jsfb-official/README.md](../research/state-engine/jsfb-official/README.md) の「4.0.0-rc.7 の計測」、生の値は `results-rc7/`。
- CPU の加重幾何平均: vanillajs 1.02、**4.0 1.07**、signals 1.22、3.5.4 1.44（rc.2 は 1.02 / 1.06 / 1.20 / 1.44。揺れの範囲で同じ）。script だけの幾何平均は 4.0 2.03、signals 2.99、3.5.4 6.28。メモリの幾何平均は 4.0 1.95、signals 1.41、3.5.4 4.40。
- rc.2 からはっきり変わったのは clear（vanillajs との比 1.25 → 1.06）で、rc.6 の `Range` を使わない取り外しの効果。create 10k と replace は比が上がったが、vanillajs を超える script の時間はほぼ同じで、差は paint とセッションの速さ。
- state の README（英日）の Performance、CHANGELOG の Speed を、開発中の値（1.08〜1.11 など、2026-09）からこの値に替えた。§0 の値は作成時の記録として残す。

### 入力の属性ミラーをやめる（2026-10-08）

- rc.7 で、wc-bindable の入力の属性ミラーの boolean を真偽属性として写すようにした（「examples での rc の評価」の 4）。これに対し、書き方は state だけの約束で、プロトコルは値の書き方を定めていない、という評価が出た: `getAttribute(x) === "true"` で読む外部の要素が 4.0 で壊れ、ほかの binder は別の書き方をしうるし、`<wcs-audio>` の既定 on の入力は表せない。
- 確かめたこと: 公式の SPEC.md / SPEC-extensions.md は、`attribute` ヒントを「マークアップの属性がどの入力プロパティに対応するか」の宣言とし、core は解釈せず、属性の反映はコンポーネントの責任としている。consumer が属性を書くことは書かれていない — ミラーそのものが state 独自の振る舞いだった。ほかの consumer（signals の `bindNode`、`@wc-bindable/*` のアダプタ）はプロパティしか書かない。このリポジトリの I/O ノードの、ヒントを持つ 113 の入力のうち 103 は、setter が自分の書き方で属性を反映しており、ミラーはそれを上書きしていた（rc.6 の wake lock の不具合の原因）。
- **決定（2026-10-08、ユーザー）: ミラーをやめる**。状態は入力のプロパティだけを書く（`dom/wc.ts` の `mirrorAttribute` と `Binding.attribute` を外し、`Bindable.inputs` は名前の集合にした）。上流の仕様には「consumer はヒントの属性を書かない（SHOULD NOT）、反映はコンポーネントの責任」を足す提案を用意した（[spec-proposal-input-attribute-reflection.md](../spec-proposal-input-attribute-reflection.md)）。4.0.0 の前に提案を出す。
- `<wcs-audio>` の `limiter` / `resumeOnGesture` のヒントを戻した（rc.7 で外したもの）。setter が `"on"` / `"off"` を反映する。
- ミラーに隠れていた要素の側の不具合を 1 つ直した: audio のノードのタグの数値のパラメータ（`frequency` など）の setter は、渡された値をそのまま持っていたので、range の input の値（文字列）を束ねると文字列のまま読めた（3.x はミラーが属性を書き、`attributeChangedCallback` が数値にしていた）。文字列は属性と同じく `parseFloat` で読む（synth-playground の e2e で見つけた）。audio 198 件。e2e 289 件 × 3 回、testing 15 件、vscode-wcs 1,167 件、router 822 件、server 100 件と e2e 18 件。core.min.js 19,954 → 19,846B（−108B）。
- テスト: 3.x の出力と食い違う 6 つの場面（双方向・入力専用・`#init=`・command token・行の中・re-set）を意図した差（`differs`）にした。`coverage-element-wc.test.ts` は「ヒントの属性を書かない」「要素の setter の反映を上書きしない」の 2 件に替えた。state 3,026 件、カバレッジ 99.79 / 99.29 / 100 / 99.95。
- 文書: state の README（英日）の節を「Inputs and the `attribute` Hint」に書き直し、移行ガイド §3.4・§4.1、CHANGELOG、CLAUDE.md、wcstack-skill を合わせた。

### 4.0.0-rc.8 の公開（2026-10-08）

- `research/rc8-prep`（ソースマップ、入力の属性ミラーの廃止、rc.7 の js-framework-benchmark）を PR #432 で research に取り込み（5212e0ec）、`prerelease-rc`（run 37694886121、21 分）で公開した。
- 全 49 パッケージが npm の `next` で 4.0.0-rc.8（`latest` は 3.5.4 のまま）。タグ `v4.0.0-rc.8` と GitHub のプレリリース。bump の commit は 61ebc46a。
- 取り込みの前に確かめたこと（research への PR では CI が走らないので手元で）: state 3,026 件（カバレッジ 99.79 / 99.29 / 100 / 99.95、lint・型検査、サイズとカップリングの検査）、audio 198 件、router 822 件。src から作った dist の上で e2e 289 件 × 3 回、server 100 件と e2e 18 件、testing 15 件、wcstack のスモーク 3 件、vscode-wcs 1,167 件。ソースマップは 2 回のビルドで同一、Node の `--enable-source-maps` と Chromium で src を指すこと。確かめた後で dist は戻した。
- 公開の後に確かめたこと:
  - 全パッケージの dist-tag（公開のログには 49 件すべての `+ name@4.0.0-rc.8` がある。名前順の後ろの 11 件がレジストリに数分遅れて見えた）
  - server の依存が厳密な `4.0.0-rc.8`
  - CDN（split の core・auto・features の `scopes` と `native-commands`、`auto.min.js.map`・`index.esm.js.map`・`split/core.js.map`）と `esm.run` の `/auto`（state・router）が 200
  - jsDelivr の `index.esm.js` がコミットされた rc.8 の dist と同一。`auto.min.js` は `//# sourceMappingURL=auto.min.js.map` で終わる
  - コミットされた rc.8 の dist のまま（手元でビルドせずに）e2e 289 件がすべて通る
- ゲートの基準値を rc.8 の dist で取り直した（カップリングは基準値どおり）。
  - core.min.js 19,846B（上限 20,480B まで 634B）
  - `index.esm.js` 50,654B、`auto.min.js` 47,715B、split の core 24,502B、scopes 8,909B
- wcstack-skill の `release/v4.0.0` に、入力をプロパティにだけ書くことを入れた（0cc3464、push 済み）。
- 上流の wc-bindable-protocol への提案（[spec-proposal-input-attribute-reflection.md](../spec-proposal-input-attribute-reflection.md)）は [#29](https://github.com/wc-bindable-protocol/wc-bindable-protocol/issues/29) として出した（2026-10-08）。#27（undefined の書き込み）の提案文にあるミラーの一文は、これが通れば不要になる。

### wc-bindable-protocol 0.10.0 への追随（2026-10-10）

上流の 0.10.0 は、core と framework アダプタの挙動を変えていない（破壊的なのは `@wc-bindable/remote` の JsonValue 検証だけで、wcstack は remote も composite も使っていない）。仕様には Extension 1 の applier プロファイル（A1〜A3）と、入力についての producer ガイダンス（P1〜P4）が入った。wcstack が出した #27〜#29 への回答でもある。

- state（binding applier。プロファイルの宣言は任意）:
  - A1（ヒントの属性を書かない・upgrade 前に属性へ逃げない）は rc.8 から満たしている。
  - A2 は満たさない。state は前に値があっても `undefined` を書かない（B8）。A2 は値の後の `undefined` を書いて要素を初期状態に戻させる。4.0.0 は今の規則のまま、プロファイルを宣言しない（判断。根拠と差は [spec-proposal-undefined-write-skip.md](../spec-proposal-undefined-write-skip.md) §8）。`examples/router-spa` の詳細 url はこの規則に依存している。A2 に合わせるかは 4.0.0 の後に改めて決める。
  - A3 は引数の扱いは満たすが、`Token.emit` が購読者の同期 throw を報告して結果を `undefined` にすること、切り離された要素を呼ばないことが違う。
- I/O ノード（P1 / P2）: 入力の setter は `/protocol/input-attribute.ts`（`reflectAttribute` / `reflectBooleanAttribute`、各パッケージへ `src/protocol/inputAttribute.ts` として同期。33 パッケージ）を通して属性を書く。`null` は属性を外し（既定値）、`undefined` は最初の書き込みの前の属性（マークアップの値）に戻す。文字列 `"null"` / `"undefined"` は書かない。調べた時点では `String(value)` で `"undefined"` を書く setter が大半で、`<wcs-sse>` / `<wcs-ws>` / `<wcs-worker>` は `undefined` を開き、`target` のセレクタは監視を止め、`<wcs-audio>` の `limiter` は切れていた。state は `undefined` を書かないので表に出ていなかったが、React 19、signals の `bindInput`、直接の代入では起きる。各 README に `null` / `undefined` の段落を足した。
  - view-transition は全入力を属性へ反映するようにした（P3。`disabled` 以外は Core にだけ書き、接続のたびに古い属性で上書きされていた）。audio のノードタグの AudioParam 入力も属性へ反映する。storage の `value = undefined` は保存を消さない。
- ついでに見つかった不具合: router の `basename` に setter が無かった（4.0 の `basename:` バインディングが TypeError）。defined の `tags` / `mode` / `timeout` は接続時にしか読まず、バインドした値が効かなかった。throttle の `leading` プロパティが効かなかった。wakelock は `active` と `manual` があっても upgrade でロックを取っていた。
  - 調査で挙がった「`manual` より先に `url` が取り込まれて動き出す」（sse / worker / resize）は起きない: 取り込み直しの途中では、まだ取り込まれていない `manual` が own プロパティとして読める。
- 文書: 提案文書 4 本に上流の回答、framework-adapter-integration とルート README に 0.9 のアダプタ（`syncOn: "define"` が既定）、`protocol/wc-bindable.ts` のコメント、vscode-wcs の補完の文言（`Markup attribute of …`）、CHANGELOG、移行ガイド §3.9。React / Vue の例は `@wc-bindable/*` 0.10。wcstack-skill の `release/v4.0.0` にも反映した（未コミット）。
- 確かめたこと: 変更した 42 パッケージで test:coverage・lint・`tsc --noEmit`、vscode-wcs のテスト 1,167 件、`sync-protocol-types.mjs --check`。dist はビルドしていないので、e2e と lint / 補完のツールに I/O ノードの変更が届くのは次の rc のビルドから。
- 続き（同日）:
  - signals の `bindInput` を A2 に合わせた（最初の評価の `undefined` を書いて、要素の初期状態を上書きしていた）。binding を外したときに `undefined` を書くこと（SHOULD）は入れていない（取り外し中の要素で副作用を起こしうる）。`bindCommand` は戻り値を捨てるので、signals もプロファイルは宣言しない。
  - camera の `deviceId` は、決まった後は使っているデバイス（`wcs-camera:device-changed` と同じ値）を返す。要求（`device-id`）を返していたので、binder の初期同期がイベントと違う値を読んでいた。recorder の `mimeType` と同じ形。
  - `<wcs-voice>` の `poly` の setter も helper を通す（wc-bindable の入力ではないが、`"undefined"` で無駄な rebuild が走っていた）。
  - wcstack-skill の main（3.x 向け）にも、0.9 のアダプタの規則を入れた。I/O ノードの `null` / `undefined` と `basename` は 4.0 の変更なので main には入れない。

### 4.0.0-rc.9 の公開（2026-10-10）

- wc-bindable-protocol 0.10.0 への追随（上の節）を `prerelease-rc`（run 38019489462、34 分。publish に 14 分）で公開した。エンジン（`packages/state/src`）は rc.8 から変わっていない。版を名指す例（state README の split の URL、移行ガイド、examples/ssr）は先に rc.9 にした（84e225a9）。
- 全 49 パッケージが npm の `next` で 4.0.0-rc.9（`latest` は 3.5.4 のまま）。タグ `v4.0.0-rc.9` と GitHub のプレリリース。bump の commit は 3a6e6574。
- 公開の前に確かめたこと（この branch では CI が走らないので手元で）: release.yml と同じ手順の dry run（rc.9 への bump → 内部依存の範囲合わせ → 49 パッケージの build → 計画のやり直し → 全パッケージの typecheck と test:coverage → bindable の settable-surface → wcstack のスモーク → builtin-tags の再生成）、作り直した dist での e2e 289 件、再生成したカタログでの vscode-wcs のテスト 1,167 件（差分は `<wcs-defined>` の observedAttributes だけ）、wcs-validate（全ページ 0 error）、全パッケージの lint、sync スクリプト 4 本の `--check`、サイズとカップリングの検査。
- 公開の後に確かめたこと:
  - 全パッケージの dist-tag（公開のログには 49 件すべての `+ name@4.0.0-rc.9` がある。名前順で最後の `wcstack` がレジストリに数分遅れて見えた）
  - server の依存が厳密な `4.0.0-rc.9`
  - CDN（split の core・auto・features の `scopes` と `native-commands`、`auto.min.js.map`・`index.esm.js.map`・`split/core.js.map`、defined の `auto.min.js`）と `esm.run` の `/auto`（state・router）が 200
  - jsDelivr の state の `index.esm.js`・`auto.min.js`、defined と router の `auto.min.js` がコミットされた rc.9 の dist と同一
  - コミットされた rc.9 の dist のまま（手元でビルドせずに）e2e 289 件がすべて通る
- ゲートの基準値を rc.9 の dist で取り直した（カップリングは基準値どおり）。動いたのは 1〜2B だけ。
  - core.min.js 19,846B（上限 20,480B まで 634B。rc.8 と同じ）
  - `index.esm.js` 50,653B、`auto.min.js` 47,715B、split の core 24,500B、scopes 8,909B
- wcstack-skill の `release/v4.0.0` に 0.10.0 への追随を入れた（8409b10）。main（3.x 向け）には 0.9 のアダプタの規則だけを入れた（59835ca）。どちらも push 済み。

### 4.0.0 の前の点検（2026-10-11）

- rc.9 の後に、4.0.0 を止めるものが残っていないかを調べた。src は rc.9 から変わっていない。手元でゲート（sync の `--check` 5 本、`compute-next-version` のテスト、bindable の適合、サイズとカップリング、state の lint・型検査・test:coverage 3,026 件）がすべて通る。
- 開いている Issue 23 件の 4.0 での扱い: 21 件は 4.0 で直っているか対象外で、4.0.0 で閉じる（#2・#353・#363・#372・#374〜#378・#380〜#387・#391・#396〜#398）。#365・#401 は F26 の残りとして 4.0.x に残す。#378・#396・#398 を閉じるときに、この 2 件を案内する。
- **F26 は 3.4〜3.5.4 からの部分的な退行を含む**。3.4.0 の #399（`rowsByElement`）は、同じパターンの別の配列にある同じ要素の行の、葉の束縛を描き直す（外側の 2 つの行が、写し・逆順の写し・同じ要素で作った配列を持つ形）。#401 の形 A では、3.5.4 が `77,88`、4.0 が `77,20`。行 getter と `$getAll` は 3.x でも古い。移行ガイド §5 は「3.x はどの形でも届かない」と書いていたので、入れ子の形と回避（もう片方の一覧か外側の一覧の `$postUpdate`。もう片方の配列は古いオブジェクトを持つので、要素の差し替えは効かない — throwaway のテストで確かめた）を足し、3.4・3.5 との差を書いた。state の README（同じ形の 1 文）と CHANGELOG の「Not fixed」も合わせた。1 つの一覧の中の重複（#365）と `backup`（#378）は 3.5.4 も古いままで、退行ではない。
- #376 の形（行の中でトップレベルの一覧を回す `for:`）の添字を、README のループ添字の節に書いた（上の「#376 の内側の行」の未決）: `$1` は内側の添字、`$2` は空、ハンドラには内側の添字だけ。行 getter（`for: .tagsHere`）にすれば `$1` が外側、`$2` が内側（throwaway のテストで確かめた）。
- 文書: CHANGELOG のサイズを rc.9 の dist の値に直し、`wcstack/auto` を足した（109,793 → 69,627 B）。冒頭とルートの README の Versioning に v4 の移行ガイドへのリンク、README と wcstack の README の `wcstack/auto` のサイズ（218 KB min / 70 KB gzip）、AGENTS.md の版の記述、storage の README の `enableDirectionalInitialSync`（4.0 は `$behavior` のキー）、vscode-wcs の CHANGELOG（ネイティブ要素の `command.<method>:` の検査、属性の hover の文言）。
- リリースの手順で見つけたこと: main とのマージで `release.yml` が 3 か所衝突する（main の #429 のバックポート。どれも research 側を採る）。CHANGELOG の見出しの書き換えは release.yml がしないので、dispatch の前に main へ入れる。安定版のリリースノートには移行ガイドへの案内が入らない（rc のときだけ足す）。拡張の版は 1.21.0 のまま（2.0.0 は 4.0.0 と同時。公開する workflow は無く、手で出す）。

### 4.0.0 の公開（2026-10-11）

- 上の点検の書き換えと 4.0.0 の準備（版の固定・移行ガイドの文面・main 向けの CLAUDE.md / AGENTS.md）、CHANGELOG の `[4.0.0] — 2026-10-11`、拡張の 2.0.0 を research に入れ、main を取り込んで（`release.yml` の 3 か所は research 側）、PR #433 で main にマージした（merge commit、984f909a）。
- PR の CI の初回は、`ci` の matrix が 49 パッケージのうち 12 しか選ばなかった。`detect-changes` が `set -o pipefail` の下で `echo "$changed" | grep -q` を使っていたため: 変更の一覧（2,705 行）がパイプのバッファを超えると、`grep -q` が最初の一致で抜けた後に `echo` が SIGPIPE で落ち、パイプ全体が「一致なし」になる（一覧の後ろで一致するパッケージだけが残った）。here-string に替えて（db674d94）、49 パッケージすべてと e2e が通った。main の CI も同じ穴を持っていた（大きな PR でだけ表に出る）。
- main で `release`（run 38104459294）。49 パッケージが npm の `latest` で 4.0.0（`next` は下の公開後の作業で 4.0.0 へ）、タグ `v4.0.0`、GitHub Release（Latest）、版を上げた commit は 614714c3。server の依存は `^4.0.0`。CDN（`esm.run` の state・router・wcstack の `/auto`、jsDelivr の `auto.min.js`・`split/auto.js`・`split/core.js`、`wcstack@4.0.0`）が 200、jsDelivr の state の `auto.min.js` はコミットされた 4.0.0 の dist と同一。
- ゲートの基準値を 4.0.0 の dist で取り直した（カップリングは基準値どおり）。動いたのは版の文字列の数バイトだけ: `index.esm.js` 50,648B、`auto.min.js` 47,711B、split の core 24,496B、core.min.js 19,846B（上限 20,480B まで 634B）。
- 公開後の作業（同日）:
  - examples の依存（`examples/ssr` の `@wcstack/server`、`websocket-chat` の React / Vue の `@wcstack/websocket`）を `^4.0.0` にし、lockfile を 4.0.0 で取り直した（8de910cb。main と research は同じ commit）。
  - Issue: 21 件を閉じた（#374・#391 は 4.0 で対象外として not planned）。#365・#401 には 4.0.x で扱う既知の制限と回避をコメントした（#401 は 3.4〜3.5 との差も）。
  - wcstack-skill: `release/v4.0.0` の版の印（plugin・README・SKILL.md・references）と CDN の固定を 4.0.0 にし、PR #33 で main にマージしてタグ `v4.0.0` を付けた。devtools の行の watch についての注記（SKILL.md）は、devtools の変更を待つものなので残した。
  - npm の `next`: 49 パッケージとも 4.0.0 に付け替えた（ユーザーの端末で。npm のアカウントは書き込みに 2 要素認証を求めるので、セッションからは `EOTP` で通らない）。`latest` と `next` がどちらも 4.0.0 であることを確かめた。
  - VS Code 拡張 2.0.0: 8de910cb で `npm run package` した vsix（vscode-wcs のテスト 1,167 件）を、ユーザーが Marketplace に公開した（2026-10-11 03:00 UTC。`vsce show` で確認）。3.x のプロジェクトは 1.21.x のまま。

### 4.0.1 の公開（2026-10-12）

- 中身: LP のチュートリアル（`wcstack.github.io/tutorial/`、ショップを題材にした Part 1 の 7 ステップ、日英）を書く中で見つけた 3 件を、PR #434（merge commit bc02a211）で直した。lint が getter の `return` 式から戻り値の形を読む（`for: visible` の行・`summary.total` の偽陽性。写すのはデータだけで、元のリストのパス getter は写さない）、名前の無い `class:` / `attr:` をパーサが `[wcs/binding-syntax]` #122 で拒む（core +34B）、`wcs/filter-unknown` を error にした（warning の根拠「ページが自前のフィルタを登録できる」は、3.5.4 にも 4.0 にもその公開 API が無く、成り立っていなかった）。
- 準備: PR #435 で CHANGELOG を `[4.0.1] — 2026-10-12` に締め、CDN の固定 17 か所を 4.0.1 にした。パッチにしたのは、名前の無い `class:` が文書化された形ではなく、どの要素でも何も起きない書き方だったため。
- main で `release`（patch、run 38208134097、約 21 分）。49 パッケージが npm の `latest` で 4.0.1、来歴証明（SLSA provenance）も 49/49、タグ `v4.0.1`、GitHub Release（`sri.json` 付き）、版を上げた commit は 8e6033ce。SRI は 44/44 が `sri.json`・タグの dist・jsDelivr で一致し、README の固定 7 URL が 200。公開版の `npx @wcstack/lint@4.0.1` で、README の Todo は 0 警告、名前の無い `class:` と未知のフィルタは error になった。
- 公開後の作業（同日）:
  - ゲートの基準値を 4.0.1 の dist で取り直した（カップリングは基準値どおり）: `index.esm.js` 50,789B、`auto.min.js` 47,850B、split の core 24,511B、core.min.js 19,880B（上限 20,480B まで 600B）。CLAUDE.md / AGENTS.md の数値と、拡張の 2.0.1 も同じ PR #436（merge commit f90504d2）。
  - VS Code 拡張 2.0.1: f90504d2 で `npm run package` した vsix（vscode-wcs のテスト 1,177 件。server・cli・schema-core に #122 と getter の形が入っていることを確かめた）を、セッションから Marketplace に公開した（PAT はレジストリの `VSCE_PAT`）。タグ `vscode-wcs-v2.0.1`（f90504d2）。付け忘れていた `vscode-wcs-v2.0.0` を、その vsix をパッケージした 8de910cb に付けた。
  - wcstack-skill: PR #34 で版の印と CDN の固定を 4.0.1 にし、拒まれる書き方の表に #122 を、`wcs/filter-unknown` を error として書き直した。マージしてタグ `v4.0.1`。
  - LP: 版の参照を 4.0.1 にした（0ad4efd）。state ページに #122 と lint の重さ、チュートリアルのステップ 2（`class:` は名指しで拒まれる）とステップ 7（未知のフィルタは error）を 4.0.1 の挙動に合わせ、llms.txt / llms-full.txt を 4.0.1 と skill v4.0.1 から作り直した。チュートリアルのデモの操作と本文の主張は、4.0.1 の dist と lint で検証し直した。
  - examples の依存は `^4.0.0` のまま 4.0.1 を受ける（lockfile は 4.0.0）。npm の `next` は 4.0.0 のまま（付け替えは 2 要素認証が要るので、ユーザーの端末で行う）。

### 4.0.2 の公開（2026-10-12）

- 中身: LP のチュートリアル Part 2（`<wcs-fetch>` で読む商品一覧と `<wcs-storage>` に残すカート）の完成形を試作し、4.0.1 の dist の上で Chromium で動かして見つけた lint の穴を、PR #438（merge commit 6a7f4f16）で直した。JSDoc の `@type` / `@typedef` で形を宣言できる（新しい `jsdocType.ts`。`null` で始まるリストの行の形が読めず、完成形に `wcs/binding-path-missing` が 7 件出ていた）。`wcs/input-nested-write`（新設・warning）は、`manual` でない `<wcs-storage>` の `value` を束ねたパスの下への書き込み（`value: cart` と `` this[`cart.${i}.quantity`] += 1 ``）を報告する。表示は 2、保存は 1 で、再読み込みすると 1 に戻り、エラーは出ない。`wcs/storage-init-seed`（新設・warning）は、`null` 以外のシードと `#init=element` の組み合わせを報告する（初回は `null` が入り、`findIndex` が投げる）。`wcs/storage-seed-clobber` の直し方は `#init=element` と `null` のシードにした（`undefined` のシードと言っていた）。`wcs/type-annotation` は入れ子の型・`@typedef`・`any` を読むようにした。`wcs/getter-untracked-read` の証拠に、テンプレートリテラルのキーと行の中の双方向の束縛を加えた。runtime は 4.0.1 から変わらない。
- 準備: PR #439 で CHANGELOG を `[4.0.2] — 2026-10-12` に締め、CDN の固定 17 か所を 4.0.2 にした。
- main で `release`（patch、run 38222712176）。49 パッケージが npm の `latest` で 4.0.2、来歴証明も 49/49、タグ `v4.0.2`、GitHub Release（`sri.json` 付き）、版を上げた commit は e7e4ce50。SRI は 44/44 が `sri.json`・タグの dist・jsDelivr で一致し、固定 URL（7 種・17 か所）が 200。view-transition と websocket はレジストリに約 2 分遅れて見えた（公開のログには 49 件すべて）。
- 公開後の作業（同日）:
  - PR #440（merge commit 42d57c56）: ゲートの基準値を 4.0.2 の dist で取り直した（ssr の版の文字列の 1B だけ。カップリングは基準値どおり）。CLAUDE.md / AGENTS.md の版、拡張の 2.0.2。
  - VS Code 拡張 2.0.2: 42d57c56 で `npm run package` した vsix（vscode-wcs のテスト 1,212 件。server・cli・schema-core に新しい 2 規則と JSDoc の形が入っていることを確かめた）を、セッションから Marketplace に公開した。タグ `vscode-wcs-v2.0.2`（42d57c56）。
  - wcstack-skill: PR #35 で版の印と CDN の固定を 4.0.2 にした。storage の節は、`undefined` のシードではなく `#init=element` と `null` のシードを先に置き、リスト（カート）の形（行 getter と `$getAll` のアクセサペア、ID と数量だけ）、新しい 2 規則、fetch したリストの JSDoc、`body:` が使い捨てであること（下を参照）を書いた。マージしてタグ `v4.0.2`。
  - LP: チュートリアル Part 2（08-fetch〜12-lint、日英）と版の参照を 4.0.2 にし、llms.txt / llms-full.txt を 4.0.2 と skill v4.0.2 から作り直した（33ab0f3）。デモは公開版の `@wcstack/lint@4.0.2` で全部 0 件、本文の主張 24 件は Chromium で確かめた。
- 残したもの:
  - **`#init=element` を付け忘れたアクセサペア**（`<wcs-storage data-wcs="value: savedCart">`）は、再読み込みでカートを空にする（getter の `[]` が先に保存される。実測）。`wcs/storage-seed-clobber` はデータのスロットだけを見るので、lint は報告しない。`manual` でない `<wcs-storage>` の `value` を `#init` なしで getter に束ねた形を報告するのが候補（チュートリアルのステップ 11 と 12 は、今は「検査器に見えない」と書いている）。
  - **`<wcs-fetch>` の `body:` は使い捨て**: `body` は `fetch()` の後に `null` に戻り、束ねたパスの下への書き込み（`value: newUser.name`）では当て直されない。fetch の README §4 の POST の例は、2 回目の送信で本文が空になる（実測。1 回目は同じオブジェクトの参照で届く）。送信のハンドラで本文の新しいオブジェクトを代入すれば、何度でも届く（実測。束縛を書く順によらない）。README の例を直すか、`body` のリセットを見直すかは未決。
  - npm の `next` は 4.0.0 のまま（付け替えは 2 要素認証が要るので、ユーザーの端末で行う）。

### 4.0.3 の公開（2026-10-12）

- 中身: 4.0.2 の記録に残した 2 件と、LP のチュートリアル Part 3 の調査で見つけた 1 件を、PR #442（merge commit 80085992）で直した。`wcs/storage-seed-clobber` は、`#init=element` なしで `<wcs-storage>` に束ねたアクセサペア（getter と setter）も報告する（setter の無い getter は保存専用の設計がありうるので対象外。`PathCandidate.settable`）。`wcs/input-nested-write` は `<wcs-fetch>` の `body` も対象にする（`manual` でも。`body` は使い捨てで、直し方は「要求を始めるハンドラで新しいオブジェクトを作る」）。fetch の README §4 の POST の例をその形に直し、実物の state で両方の形を固定する統合テストを足した（fetch に `@wcstack/state` の `file:../state` の devDependency）。`wcs/base-href-missing` と `wcs/script-order` は版を付けた URL（`@wcstack/router@4/auto`・jsDelivr の `dist/auto.min.js`・`dist/split/auto.js`）と一括バンドル `wcstack/auto` を認める（バンドルでは `<wcs-router>` のあるページでだけ `<base href>` を求める）。本番の書き方でだけ黙っていた。runtime は 4.0.1 から変わらない。
- 準備: PR #443 で CHANGELOG を `[4.0.3] — 2026-10-12` に締め、CDN の固定 17 か所を 4.0.3 にした。
- main で `release`（patch、run 38249397898）。49 パッケージが npm の `latest` で 4.0.3、来歴証明も 49/49、タグ `v4.0.3`、GitHub Release（`sri.json` 付き）、版を上げた commit は 851d0c36。SRI は 44/44 が `sri.json`・タグの dist・jsDelivr で一致し、固定 URL（7 種）が 200。
- 公開後の作業（同日）:
  - PR #444（merge commit ff1f5291）: ゲートの基準値を 4.0.3 の dist で取り直した（版の文字列の数バイトだけ。カップリングは基準値どおり）。CLAUDE.md / AGENTS.md の版、拡張の 2.0.3。
  - VS Code 拡張 2.0.3: ff1f5291 で `npm run package` した vsix（vscode-wcs のテスト 1,221 件）を Marketplace に公開した。タグ `vscode-wcs-v2.0.3`（ff1f5291）。
  - wcstack-skill: PR #36 で版の印と CDN の固定を 4.0.3 にし、「アクセサペアは lint に見えない」の記述を外し、fetch の `body` の直し方を具体的にした。マージしてタグ `v4.0.3`。
  - LP: チュートリアル Part 3（13-router〜16-publish、日英）と、Part 2 のステップ 11・12 の 4.0.3 への追随、版の参照、llms の作り直し（777699f）。読者のファイル（`app/`、`<base href="/">`）から、サイトの中のフォルダを指す base に差し替えたデモ（`shop/`）を build-tutorial.mjs が書く。デモと読者のファイルは公開版の lint 4.0.3 で 0 件、テストは公開版 4.0.3＋vitest 5＋happy-dom 21 で 5 件通過、本文の主張は Chromium で確かめた。
- 書く中で見つけたこと（直していない）: `<wcs-router>` は outlet を**自分のすぐ次の兄弟要素**としてしか探さず、無ければ自分の直後に作る（`Router.ts` の `_getOutlet`）。router をページの上の方に置き、`<wcs-outlet>` を `<main>` の中に置くと、ページはヘッダーの上に描かれ、`<main>` の outlet は空のまま、何も報告されない。チュートリアルは router を outlet の直前（`<main>` の中）に置き、`wcs-router { display: contents; }` で格子に場所を取らせない形にし、この間違いを「よくある間違い」に書いた。lint で「router の直後に outlet が無いのに、別の場所に `<wcs-outlet>` がある」を報告するか、router が文書の中の自分用の outlet を探すかは未決。

### 4.0.4 の公開（2026-10-13）

- 中身: 4.0.3 の記録に残した outlet の穴を、PR #446（merge commit 2c76f847）で扱った。経緯を調べると、outlet を「router の次の兄弟要素だけ」で探すのは v1.8.6 のマルチ Router 対応（`15ac3bc4`）で `document.querySelector` から狭めた副産物で、規則はどこにも書かれていなかった。2026-10-13 に著者が **A**（規則は変えず、間違いを知らせ、規則を書き残す）を決めた: router は自前の outlet を作るときに、同じ root の「直前の兄弟が router でない `<wcs-outlet>`」を outlet ごとに 1 回 `[wcs/router-outlet-misplaced]` で警告する（`src/misplacedOutletWarning.ts`、挙動は変えない）。lint は同じ code を warning としてタグの並びから報告する（直後に outlet を持たない router があるページでだけ）。router の README（日英）に置き場所を書き、`examples/router-i18n` の outlet（router の中にあった）を外へ出した。規則・経緯・決定は docs/router-outlet-placement.md / `.ja.md`。探す範囲を広げる（B）と明示的に結ぶ属性（C）は実需が出るまで見送り、router の TODO.md に残した。リポジトリの HTML 115 ページで新しい警告が出たのは router-i18n だけだった。state の runtime は 4.0.1 から変わらない。
- 準備: PR #447 で CHANGELOG を `[4.0.4] — 2026-10-13` に締め、CDN の固定 17 か所を 4.0.4 にした。
- main で `release`（patch、run 38305339370）。49 パッケージが npm の `latest` で 4.0.4、来歴証明も 49/49、タグ `v4.0.4`、GitHub Release（`sri.json` 付き）、版を上げた commit は d4d9c691。SRI は 44/44 が `sri.json`・タグの dist・jsDelivr で一致し、固定 URL（skill の分を含め 9 種）が 200。jsDelivr の router 4.0.4 と lint 4.0.4 に `router-outlet-misplaced` が入っていることも確かめた。
- 公開後の作業（同日）:
  - PR #448（merge commit 1550d47d）: ゲートの基準値を 4.0.4 の dist で取り直した（版の文字列の数バイトだけ。`core.min.js` は 19,880 B のまま）。CLAUDE.md / AGENTS.md の版、拡張の 2.0.4。
  - VS Code 拡張 2.0.4: 1550d47d で `npm run package` した vsix（vscode-wcs のテスト 1,227 件）を Marketplace に公開した。タグ `vscode-wcs-v2.0.4`（1550d47d）。
  - wcstack-skill: PR #37 で版の印と CDN の固定を 4.0.4 にし、`references/router-and-scaffold.md` §1 に置き場所の規則（「書かなければ自動生成」だけだった）、SKILL.md に規則・lint の一覧・落とし穴の行を足した。マージしてタグ `v4.0.4`。
  - LP（2564628）: 版の参照と「Shipped in」の v4.0.4 の一文、state / signals のページの版、llms の作り直し。チュートリアルのステップ 13 の「ルーターから離れた outlet」は「コンソールには何も出ない」を 4.0.4 の警告に直し、ステップ 15 の依存を `^4.0.4`、ステップ 16 の固定を `wcstack@4.0.4` と v4.0.4 の `sri.json` の integrity にした。本番で 13・14・16 のデモ（outlet の位置・商品ページ・戻る・警告が出ないこと・16 は integrity 付きの 4.0.4）と、jsDelivr の router 4.0.4 が離れた outlet を 1 回警告することを Chromium で確かめた（9/9）。

### 4.1.0 の公開（2026-10-13）

- 中身: 継ぎ目アプリ（docs/seam-apps.ja.md — 公開文書だけを読む初めての作者のサブエージェントが、テストの見逃すものを見つけるために作るアプリ）4 本の発見を、PR #450（merge commit 846aedc2・方法の文書と router-auth）と PR #451（4bbdfde6・router-admin / state-collab-board / signals-shop）で直した。設計の決定は著者（2026-10-13）。新しい API（router の `leaveConfirm` と `<wcs-link match="prefix">`、`<wcs-network offline>`、signals の `For` の第 3 引数 `current()`、lint の `wcs/on-handler-this`）と挙動の変更（ガードのリダイレクトは履歴を置き換え・無言・10 回で打ち切り・ハンドラだけで有効、ルートの出力は中身の前・`path` は後、ビュー遷移は一覧と分岐の変化だけ、`$watch` は要素の初期値で 1 回、`h()` の `on…` はすべてリスナー、`wcs/storage-seed-clobber` は error）を含むので minor。core は 19,880 → 19,919 B、temporal +76 B。
- 準備: PR #452 で CHANGELOG を `[4.1.0] — 2026-10-13` に締め、CDN の固定 18 か所（signals の README の古い 1.25.0 が加わった）を 4.1.0 にした。
- main で `release`（minor、run 38402818289）。49 パッケージが npm の `latest` で 4.1.0、来歴証明も 49/49、タグ `v4.1.0`、GitHub Release（`sri.json` 付き）、版を上げた commit は 1eda9b4a。SRI は 44/44 が `sri.json`・タグの dist・jsDelivr で一致し、固定 URL（skill の分を含め 10 種）が 200。jsDelivr の router / network / lint / signals 4.1.0 に新しいもの（`leave-confirm`・`offline`・`on-handler-this`・`current`）が入っていることも確かめた。
- 公開後の作業（2026-10-14）:
  - PR #453（merge commit 12afd670）: サイズの基準値を 4.1.0 の dist で取り直した。CLAUDE.md / AGENTS.md の版とサイズ、拡張の 2.1.0（新しい error が 2 つあるので minor）。
  - VS Code 拡張 2.1.0: 12afd670 で `npm run package` した vsix を Marketplace に公開した。タグ `vscode-wcs-v2.1.0`（12afd670）。
  - wcstack-skill: PR #38 で版の印と CDN の固定を 4.1.0 にし、ガード（セッションは関数の中で `localStorage` から・モジュールは一度だけ評価・`toPath` にクエリ無し）、`leaveConfirm`、`$watch` の初期値、`$on` の `(state, event)`、`<wcs-network offline>`、構造だけのビュー遷移、`<wcs-fetch-header value:>` とトークンの要る要求の url、`For` の `current()` と signals の router・storage の書き方を足した。マージしてタグ `v4.1.0`。
  - LP（50d7c25）: 版の参照と「Shipped in」の v4.1.0 の一文、state / signals のページの版、llms の作り直し、チュートリアルのステップ 15 の `^4.1.0`、ステップ 16 の `wcstack@4.1.0` と integrity。本番で 13・14・16 のデモと jsDelivr の router 4.1.0 を Chromium で確かめた（9/9）。
- 残り: 4 本のアプリを回避策を外して `examples/` へ（e2e 付き）。seam-apps の表の未着手（lint 数件、レイアウトの既定 slot、ルート再入の fetch、`date` の書式、チュートリアルの読み込み順など）。

### 4.1.1 の公開（2026-10-14）

- 中身: 4.1.0 の記録に残した「4 本のアプリを `examples/` へ」を PR #455（merge commit a273cf66）で済ませた。同じ作者のサブエージェントが、4.1.0 で要らなくなった回避策を外してアプリを移し、意図を確かめる e2e の spec を書いた（router-auth 10 件・router-admin 15 件・state-collab-board 7 件・signals-shop 8 件、`WCS_LOCAL=1` で各例の `server.js` を起動）。そこで見つかったものも同じ PR で直した: 公開した `@wcstack/lint` / `@wcstack/typescript` 4.1.0 が `<wcs-network offline>` を知らなかった（`release.yml` が組み込みのタグの一覧を作り直す前に両方をビルドしていた。リリースは一覧の後に両方をビルドし直してテストする）、router の `navigateUrl` / `replaceUrl` がガードのリダイレクトで `AbortError` を報告していた（`src/isAbortError.ts`、報告しない）、`wcs/on-handler-this` が `const state = this` のような別名を見逃した（`findOwnThis`）、SSR の e2e が minor の `4.0.` を固定していた。examples/README（日英）に「継ぎ目アプリ」の節、docs/seam-apps に取り込みの表。state の runtime は 4.1.0 から変わらない（`core.min.js` は 19,919 B）。
- 準備: PR #456（merge commit a5e27be5）で CHANGELOG を `[4.1.1] — 2026-10-14` に締め、CDN の固定 18 か所を 4.1.1 にした。
- main で `release`（patch、run 38450629077）。49 パッケージが npm の `latest` で 4.1.1、来歴証明も 49/49、タグ `v4.1.1`、GitHub Release（`sri.json` 付き）、版を上げた commit は ca726e01。SRI は 44/44 が `sri.json`・タグの dist・jsDelivr で一致し、固定 URL（skill の分を含め 10 種）が 200。公開された lint / typescript 4.1.1 の一覧に `<wcs-network>` の `offline` があり、lint 4.1.1 の `--strict` で `examples/state-collab-board` が 0 件になることも確かめた（リリースの修正の確認）。
- 公開後の作業（同日）:
  - PR #457（merge commit 91d93c81）: サイズの基準値を 4.1.1 の dist で取り直した（版の文字列だけ）。CLAUDE.md / AGENTS.md の版、拡張の 2.1.1。
  - VS Code 拡張 2.1.1: 91d93c81 で `npm run package` した vsix（一覧に `offline` あり）を Marketplace に公開した。タグ `vscode-wcs-v2.1.1`（91d93c81）。
  - wcstack-skill: PR #39（merge commit d20c5ac5）で版の印と CDN の固定を 4.1.1 にし、lint の一覧の `wcs/on-handler-this` に別名を足した。タグ `v4.1.1`。
  - LP（ec36c4a）: 版の参照と「Shipped in」の v4.1.1 の一文、state / signals のページの版、llms の作り直し、チュートリアルのステップ 15 の `^4.1.1`、ステップ 16 の `wcstack@4.1.1` と integrity。本番で 13・14・16 のデモと jsDelivr の router 4.1.1 を Chromium で確かめた（9/9）。
- 残り: docs/seam-apps.ja.md の表の未着手 — 設計の問い 3 つ（言語の切り替えに `leaveConfirm` が効かない、兄弟のリンクがある `match="prefix"`、要素の最初の値での getter の `$watch`）、signals の遅れて定義される要素、lint の候補（`#prevent` の無い `onsubmit:`、`Object.assign` や別名を通したその場の変更、`$on` の書き込みを証拠にする `wcs/getter-untracked-read`、getter の中の `location`、ルート下の裸の `{{ }}`、別ファイルをまたぐ `signals-dual-entry`）、レイアウトの既定 slot、ルート再入の fetch、`date` の書式、チュートリアルの読み込み順。

### 4.2.0 の公開（2026-10-17）

- 中身: 4.1.1 の記録に残した「seam-apps の表の未着手」を PR #459（merge commit c3eb950d）で扱った。設計の問い 4 つは著者が 2026-10-14 に推奨どおり決めた: `leaveConfirm` はページを離れる取り消せるナビゲーション（basename の外・別のサイト・フォームの送信）でも自分の文言で聞く（Navigation API がある所。受け入れたらブラウザは聞き直さない — Chromium で `navigate` が `beforeunload` より先に来て取り消せることを確かめた）、`match="prefix"` が兄弟のリンクの下のパスでも印を付けるのは設計どおり（README に書いた）、要素が持ってきた最初の値で根の getter の `$watch` も 1 回発火する（`prev` は `undefined`）、`date` / `time` / `datetime` に書式（`date(en-US,medium)`）と新しい `currency(code, loc?)`（48 フィルタ）。ほかに: router の `[wcs/layout-slot-missing]` とレイアウトのテンプレートの outlet の警告、state の型エラーの文言と書いたとおりのバインディング名、signals の定義前の要素へのオブジェクトの保持・`UNTRACKED_COMPUTED` / `UNTRACKED_EFFECT`・定義前の `bindNode` の文言、lint の新しい warning 3 つ（`wcs/submit-without-prevent`・`wcs/route-bare-mustache`・`wcs/layout-slot-missing`）と、別名・`Object.assign`・`$on` の state を通したその場の変更（error）、`$on` の書き込みと `location` の `getter-untracked-read`、両方を割り当てた import map の `signals-dual-entry`。確かめる中で、同じ配列を書き戻しても `$postUpdate` しても一覧の行は追加・置き換えされない（新しい配列だけが行を合わせ直す — 設計どおり）ことが分かり、state の README を直した。ルートへ戻ったときの古い url での要求は 4.1.0 で消えていた（router-auth の e2e で押さえた）。サイズは core が 19,919 → 19,944 B、formats +260 B、diagnostics +321 B（PR の中で基準値を取り直した）。signals は文言を縮めても `.` +230 B・`./dom` +330 B（brotli）なので、size-limit を 3 / 6 kB から 3.1 / 6.2 kB に上げた（mountNode のときの前例に合わせた）。記録は docs/seam-apps.ja.md「残っていたもの（2026-10-14）」。サイトのチュートリアル（ステップ 8〜14）の読み込み順は 2026-10-14 に LP d6180d7 で直した。
- 準備: PR #460（merge commit 0094495c）で CHANGELOG を `[4.2.0] — 2026-10-17` に締め、CDN の固定 18 か所を 4.2.0 にした。
- main で `release`（minor、run 39006044502）。49 パッケージが npm の `latest` で 4.2.0、来歴証明も 49/49（`@wcstack/storage` だけ最初の照会で見えず、レジストリの反映待ちだった）、タグ `v4.2.0`、GitHub Release（`sri.json` 付き）、版を上げた commit は 2c8cde98。SRI は 44/44 が `sri.json`・タグの dist・jsDelivr で一致し、固定 URL（skill の分を含め 10 種）が 200。jsDelivr の state 4.2.0 に `currency`、router に `layout-slot-missing`、lint に `submit-without-prevent` と `currency`、signals のコアのチャンクに `UNTRACKED_EFFECT` が入っていることも確かめた。
- 公開後の作業（同日）:
  - PR #461（merge commit d720b975）: サイズと結合の基準値を 4.2.0 の dist で取り直した（数バイト。`core.min.js` は 19,944 B で残り 536 B）。CLAUDE.md / AGENTS.md の版・サイズと、SSR のスナップショットの規則（同じ major.minor だけ — 4.2 は 4.1 のものを捨てる）、拡張の 2.2.0（新しい規則と、error で報告する形が増えたので minor）。
  - VS Code 拡張 2.2.0: d720b975 で `npm run package` した vsix（vscode-wcs のテスト 1,256 件、`currency` と新しい code を含む）を Marketplace に公開した。タグ `vscode-wcs-v2.2.0`（d720b975）。
  - wcstack-skill: PR #40（merge commit 49c6a92）で版の印と CDN の固定を 4.2.0 にし、`leaveConfirm`・レイアウトの既定の slot・`match="prefix"`・日付の書式と `currency`（arity も）・getter の `$watch`・新しい lint と広げた検出・signals の 3 件を足した。4.1.0 の更新で「Since 4.0.4 the router warns」が版の一括置換で書き換わっていたのも戻した。タグ `v4.2.0`。
  - LP（c945adc）: 版の参照と「Shipped in」の v4.2.0 の一文、state / signals のページの版、llms の作り直し、チュートリアルのステップ 15 の `^4.2.0`、ステップ 16 の `wcstack@4.2.0` と integrity、sitemap の lastmod（ステップ 8〜14 は 2026-10-14）。本番で 13・14・16 のデモと jsDelivr の router 4.2.0 を Chromium で確かめた（9/9）。
- 残り: docs/seam-apps.ja.md の表に未着手は無い。npm の `next` は 4.0.0 のまま（著者の方針で動かさない）。

### 4.3.0 の公開（2026-10-18）

- 中身: 4.x の指針（[docs/v4-direction-2026-10.md](../v4-direction-2026-10.md)、2026-10-17 に著者が採択した「黙って壊れない」）の下での最初の minor。PR #463〜#478（2026-10-18 にマージ）:
  - 誤りの目録（#463）と、lint を 4.0 のランタイムに合わせる変更（#464 — 8 つの形を error に）。
  - router の囲むルート（#465）と、fetch / storage の警告（#466）。
  - `data-wcs-ignore`（#467）と、1 つの一覧の 2 つの位置の同じオブジェクト（#468、Fixes #365）。
  - 継ぎ目アプリ ssr-news（SSR × router × state）の発見の修正（#469〜#471・#475〜#477）と記録（#472・#478）。
  - 著者が 2026-10-18 に推奨どおり決めた 6 つ（指針の §5.1）の実装（#473〜#477）。リリースの workflow に、README の未リリースの印を外す段が加わった（#474）。
- 準備: PR #479（merge commit ac9499bd）で CHANGELOG を `[4.3.0] — 2026-10-18` に締め、CDN の固定 18 か所を 4.3.0 にした。印を外す段は、書き込まずに試してから走らせた（4.3.0 で問題 0、patch の版では止まる）。
- main で `release`（minor、run 39077407800）。
  - npm: 49 パッケージが `latest` で 4.3.0、来歴証明も 49/49（`@wcstack/media-query` の dist-tags だけ最初の照会で読めず、再照会で 4.3.0）。
  - タグ `v4.3.0` と GitHub Release（`sri.json` 付き）。版を上げたコミット f0fb286b は、7 つの README の 26 か所の印を外した（日本語は「4.3 から」に戻る）。npm の README に印は残っていない。
  - SRI 44/44（`sri.json`＝タグの dist＝jsDelivr）。文書の固定 URL 8 つがすべて 200。
  - jsDelivr の配布物に今回の変更（`resolveModule`・`data-wcs-ignore`・`[wcs/command-not-ready]`・`[wcs/fetch-auto-unsafe]`・`pendingPromise`・router の新しい報告・`[wcs/ssr-pending-timeout]`）がある。`@wcstack/server` 4.3.0 は `@wcstack/state` の `4.3.0` にちょうどで依存する。
- 公開後の作業（同日）:
  - PR #480（merge commit f2652f70）: サイズの基準値を 4.3.0 の dist で取り直した（`core.min.js` は 20,069 B で残り 411 B）。ssr の slack 256 B は、増えた分が基準に入ったので外した。CLAUDE.md / AGENTS.md の版・サイズと、SSR のスナップショットの規則も更新し、拡張を 2.3.0 にした。
  - VS Code 拡張 2.3.0: f2652f70 で `npm run package` した vsix（890 ファイル、vscode-wcs のテスト 1,264 件、4.3.0 の state を同梱）を Marketplace に公開した。タグ `vscode-wcs-v2.3.0`（f2652f70）。
  - wcstack-skill: PR #41（merge commit 9c74f68）で、版の印と CDN の固定を 4.3.0 にした。あわせて `data-wcs-ignore`・lint の重大度・ガードの囲むルート・`[wcs/base-href-missing]`・fetch の url の扱いと 2 つの警告・`[wcs/command-not-ready]`・SSR の変更を足した。タグ `v4.3.0`。
  - LP（1c08afd）:
    - 版の参照と、「Shipped in」の v4.3.0 の一文。state / signals のページの版。
    - チュートリアルのステップ 12 の lint の出力を、4.3.0 の実際の出力に直した。`wcs/input-nested-write` は 4.3 から error で、`wcs/storage-seed-clobber` は 4.1 から error なのに warning と書いてあった。
    - ステップ 15 の `^4.3.0`、ステップ 16 の `wcstack@4.3.0` と integrity（ショップとページの両方）。
    - llms の作り直しと、sitemap の lastmod。
    - 本番で 9/9。
- 残り:
  - ssr-news を examples/ に取り込み、e2e を付ける。
  - #24（古いクライアントが、初期化に失敗する前にサーバーの行を取り除く）。
  - npm の `next` は 4.0.0 のまま（著者の方針で動かさない）。

### 4.4.0 の公開（2026-10-18）

- 中身: 4.x の指針の下での 2 つ目の minor。PR #482〜#491（2026-10-18 にマージ）:
  - 4.3.0 の残り 2 件 — ssr-news を examples/ に取り込み e2e を付けた（#482）、版違いのクライアントはページを計画してからサーバーの行を外す（#483、#24）。
  - 外からの評価 7GUIs（誤りを 34 件わざと入れたもの）から: 外部 state（`src=`）へのスクリプトの規則（#484）、lint の規則 3 つと拡張 3 つ（#485）、diagnostics の警告 2 つ（#486）、著者の決定 2 つの実装（#487、指針の §5.2）、ページで定義した自作要素の `static wcBindable` の照合（#488）。
  - 外からの評価 確定申告の下書き（getter 96 本）から: getter が読むパスの検査（lint と diagnostics の `wcs/read-path-missing`）と、トップレベルの spread の誤報の修正（#489）、`wcs-schema` のスタック溢れと閉じた schema の修正（#490）、state の README の読む範囲の案内・書き戻しの規則・行の中の要素の初期化の順（#491）。
- 準備: PR #492（merge commit 65e59329）で CHANGELOG を `[4.4.0] — 2026-10-18` に締め、要約と **Upgrading** の節を書いた（lint が多く報告し一部は error になる — `src=` の state への規則と新しい規則で CI が落ちうる、spread のある state は少なく報告する、コンソールの警告が増える、`wcs-schema` が開いた schema を書く、SSR はサーバーとクライアントを同じ minor で）。CDN の固定 18 か所を 4.4.0 にした。印を外す段は書き込まずに試した（問題 0・8 ファイル・残り 0）。リリースの前に、main の state を作業ツリーの外でビルドして、サイズと結合のゲート・e2e 347 件を確かめた。
- main で `release`（minor、run 39113946327）。
  - npm: 49 パッケージが `latest` で 4.4.0、来歴証明も 49/49。
  - タグ `v4.4.0` と GitHub Release（`sri.json` 付き）。版を上げたコミット b3601c00 は、8 つの README の 26 か所の印を外した。npm の README に印は残っていない。
  - GitHub Release の本文の先頭に、CHANGELOG の要約と Upgrading の節を足した（本文は SRI と PR の一覧だけだったため）。
  - SRI 44/44（`sri.json`＝タグの dist＝jsDelivr）。文書の固定 URL 8 つがすべて 200（esm.run はリダイレクトの先で）。
  - jsDelivr の配布物に今回の変更（state と `wcstack` の `read-path-missing`、lint の `read-path-missing` と `path-dynamic-unknown`、typescript の worker と「ran out of stack」）がある。`@wcstack/server` 4.4.0 は `@wcstack/state` の `4.4.0` にちょうどで依存する。
- 公開後の作業（同日）:
  - PR #493（merge commit 2f2c9ee9）: サイズの基準値を 4.4.0 の dist で取り直した（`core.min.js` は 20,102 B で残り 378 B、diagnostics +780 B、ssr +121 B）。diagnostics の slack 768 B は外した。結合の基準は変わらない。CLAUDE.md / AGENTS.md を更新し、拡張を 2.4.0 にした。拡張の CHANGELOG は #484 で「2.3.0」の見出しが「Unreleased」に置き換わっていたので戻した。
  - VS Code 拡張 2.4.0: 2f2c9ee9 で `npm run package` した vsix（890 ファイル、4.4.0 の state を同梱、新しい規則を含むことを確かめた）を Marketplace に公開した（反映を `vsce show` で確認）。タグ `vscode-wcs-v2.4.0`（2f2c9ee9）。
  - wcstack-skill: PR #42（merge commit a0c2d82）で、版の印と CDN の固定を 4.4.0 にした。あわせて lint の 4.4 の規則と `src=` の state、spread と `stateSchema`、`wcs-schema` の JS と spread の型付け、実行時の新しい警告、`$postUpdate` の `*`、書き戻しの規則、行の中の自作要素の初期化の順を足した。タグ `v4.4.0`。
  - LP（3030317）:
    - 版の参照と、「Shipped in」の v4.4.0 の一文（lint を上げると CI が落ちうることと、リリースノートへのリンク）。state / signals のページの版。
    - state のページのフィルタが 4.1 のままだった: 48 個、`currency(code,loc?)`、日付のスタイル、v4.2.0 の注記。
    - チュートリアルのステップ 07: `currency` は 4.2 から組み込みのフィルタなので、「存在しないフィルタ」の例を `money` にした（lint とコンソールの出力は 4.4.0 で取り直した）。48 個。
    - ステップ 12: `@typedef` の打ち間違いで、4.4 の `wcs/read-path-missing` が検索の getter にも出る。
    - ステップ 15 の `^4.4.0`、ステップ 16 の `wcstack@4.4.0` と integrity（ショップとページの両方）とリリースへのリンク。
    - llms の作り直しと、sitemap の lastmod。
    - 本番で 9/9。
- 残り:
  - 長期サポート版は保留（著者の判断）。
  - npm の `next` は 4.0.0 のまま（著者の方針で動かさない）。

### 4.5.0 の公開（2026-10-20）

- 中身: 4.x の指針の下での 3 つ目の minor。継ぎ目アプリ `state-field-report`（デバイス系の I/O × 権限、docs/seam-apps.md）から。PR #495〜#500（2026-10-20 にマージ）:
  - camera: 切断で `active` / `recording` を知らせる、録画中に外れたら撮った分をクリップにして渡す（著者の決定）、`mime-type` が無くても型の付いたクリップ、CSP の下でのプレビューのスタイル、keep-alive なしの録画中の suspend の警告（#495）。
  - 切断は変える state の出力をすべて知らせる — 13 パッケージにあった無言のリセットと捨てた完了を、横断の契約にした（timing-and-firing-contract §22、著者の決定、#496）。
  - このページで使えない機能（安全でない origin・Permissions-Policy）は、見張り役も取りに行く側も `unsupported`、`errorInfo` は理由付きの `capability-missing`（著者の決定、#497）。
  - 黙って拒んでいた upload / fetch / notify の警告、storage の JSON が保てない値、聞き取り中の読み上げ（#498）。lint の `map` で作る行と `wcs/handle-bound-as-value`（#499）。記録（#500）。
  - `@wcstack/state` のソースは変えていない。
- 準備: PR #501（merge commit 79bc95d2）で CHANGELOG を `[4.5.0] — 2026-10-20` に締め、要約と **Upgrading** の節を書いた（切断が出すイベント、切断で残る録画、`granted` / `denied` が `unsupported` になる場合、recorder の型、新しいコンソールの警告、lint、SSR は同じ minor で）。文書の固定版 18 か所を 4.5.0 にした。
- main で `release`（minor、run 39289068647）。**部分リリースになった**:
  - npm への公開までは通った（49 パッケージが `latest` で 4.5.0、来歴証明 49/49）。その後の「Tag and push release」で、版を上げたコミットの main への push が `remote: fatal error in commit_refs`（GitHub 側のエラー）で拒まれ、タグも GitHub Release も作られなかった。コミットは runner にしか無かった。
  - 戻し方（著者の了承を得て）: workflow と同じ手順を 79bc95d2 から手元でたどった（各パッケージの `npm version 4.5.0`、`align-internal-dep-ranges`、`unreleased-marks --strip 4.5.0`、再ビルド、組み込みタグの目録、lint と typescript の道具、server と testing の lock の同期）。そのうえで、registry から落とした 49 本の tarball の全 460 ファイルと突き合わせた。JavaScript の束・README・package.json は一致し、source map と state の分割のチャンク名（手元のパスとハッシュ）だけが違ったので、dist は tarball のファイルそのものにした。npm に出ない `dist/core.min.js` だけは手元のビルドで、サイズの検査は通る。これを c72e28a0「chore: bump all packages to v4.5.0」として main に push し、タグ `v4.5.0` を付け、GitHub Release を `sri.json` 付きで作った（本文は workflow と同じ SRI と PR の一覧に、要約・Upgrading・手で作った経緯を足した）。
  - 罠: 手元の npm は公開から日の浅い版を取らない設定なので、`npm pack <pkg>@4.5.0` は何も取らない。設定は触らず、`https://registry.npmjs.org/<name>/-/<base>-4.5.0.tgz` を curl で取った。
  - SRI 44/44（`sri.json`＝タグの dist＝jsDelivr。公開直後の 1 回目は network だけ jsDelivr が 404、取り直して一致）。文書の固定 URL 7 つがすべて 200。npm の README に印は残っていない（16 ファイルの印は版を上げたコミットで外した）。`@wcstack/server` 4.5.0 は `@wcstack/state` の 4.5.0 にちょうどで依存する。
  - jsDelivr の配布物に今回の変更（camera の `camera-keep-alive-missing`、storage の `storage-unserializable`、speech の `speech-echo`、upload / fetch / notification の拒否の警告、permission のポリシーと安全なコンテキストの判定、geolocation の `capability-missing`、websocket の切断の `connected-changed`、lint の `handle-bound-as-value`）がある。
- 公開後の作業（同日）:
  - PR #502（merge commit fe72408d）: サイズの基準値を 4.5.0 の dist で取り直した（state のソースは変えていないので、版の文字列だけ — devtools と ssr が +1 B、`core.min.js` は 20,102 B のまま）。CLAUDE.md / AGENTS.md の版と数値、拡張を 2.5.0 に。
  - VS Code 拡張 2.5.0: fe72408d で `npm run package` した vsix（890 ファイル、4.5.0 の state を同梱、テスト 1,304 件）を Marketplace に公開した（反映は publish から十数分遅れ、gallery の照会 API で 2.5.0 を確認）。注釈付きのタグ `vscode-wcs-v2.5.0`（最初に軽量タグで付けてしまい、前回にそろえて付け直した）。
  - wcstack-skill: PR #43（merge commit c3c8480）で、版の印と CDN の固定を 4.5.0 にした。あわせて切断が出すイベント、使えない機能の `unsupported`、拒んだコマンドの警告、upload の `files` の使い切りと束縛の順、recorder の型と `mimeType#init=element`、keep-alive、`type="session"` の下書きと Blob、`wcs/handle-bound-as-value`、`map` で作る行を書いた。注釈付きのタグ `v4.5.0`。
  - LP（61bf612）:
    - 版の参照と、「Shipped in」の v4.5.0 の一文（上げるとイベントとコンソールの警告が増えうることと、リリースノートへのリンク）。state / signals のページの版。
    - ステップ 15 の `^4.5.0`、ステップ 16 の `wcstack@4.5.0` と integrity（ショップとページの両方）とリリースへのリンク。`wcstack/auto` は 73.0 KB gzip で「about 70 KB」のまま。
    - ステップ 07・12: それぞれの「わざと壊す」変更を 4.5.0 の lint で取り直した — 出力は変わらない。
    - llms の作り直しと、sitemap の lastmod。
    - 本番で 9/9。
- 残り:
  - `state-field-report` を examples/ へ取り込む（e2e には `channel: "chromium"` の Playwright の project が要る）。
  - 長期サポート版は保留（著者の判断）。npm の `next` は 4.0.0 のまま。

### 4.6.0 の公開（2026-10-24）

- 中身: 4.x の指針の下での 4 つ目の minor。継ぎ目アプリ `fw-inventory`（フレームワークの中の `wcs-*` — React 19 と Vue 3 から `@wc-bindable` のアダプター越しに I/O ノードを使う、docs/seam-apps.md）から。PR #505〜#509（2026-10-21・24 にマージ）:
  - storage の `storage-key` / `storageKey`（React と Vue は `key` を取る。著者の決定）と key の無い操作の警告、url より先に来たファイルを url が来たら送る upload（著者の決定）、worker / broadcast の `[wcs/post-uncloneable]`、全 I/O ノードの `[wcs/input-as-attribute]`、fetch の補助タグのクラスの書き出しと `[wcs/fetch-helper-undefined]`（#505）。
  - どの `./auto` にも `dist/auto.d.ts`、`exports["./auto"]` は `{ types, import }`（著者の決定。JSX の宣言は記録だけ、#506）。lint は読まなかったファイルを `not read:` / `nothing to check:` で挙げる（#507）。文書と websocket-chat の例（#508）、examples/fw-inventory と e2e（Vite のビルドを e2e.yml に、#509）。
  - アダプター側の発見は wc-bindable-protocol#42 に提案した。`@wcstack/state` のソースは変えていない（`./auto` の型だけ）。
- 準備: PR #510（merge commit 87615378）で CHANGELOG を `[4.6.0] — 2026-10-24` に締め、要約と **Upgrading** の節を書いた（url より先のファイルを送るようになった upload、新しいコンソールの警告、lint の注、`./auto` の export がオブジェクトになったこと、SSR は同じ minor で）。文書の固定版 18 か所を 4.6.0 にした。README の印の剥がしは事前に試した（22 ファイル・42 行）。
- main で `release`（minor、run 40033140631）。成功した: 版を上げたコミット e38e6d7b、タグ `v4.6.0`、GitHub Release（`sri.json` 付き。本文の先頭に要約と Upgrading を足した）。
  - npm 49/49・`latest` 49/49・来歴証明 49/49。ただし `wcstack` だけ、公開（22:57 UTC）から registry に現れるまで約 15 分かかった（ほかは約 1 分）。npm の「処理中」の非同期の受け付けで、公開し直さずに待った。
  - SRI 44/44（1 回目は storage が jsDelivr の 502、wcstack が反映前の 404。取り直して一致）。文書の固定 URL（18 か所・8 本）がすべて 200。npm の README に印は残っていない。`@wcstack/server` 4.6.0 は `@wcstack/state` の 4.6.0 にちょうどで依存する。`wcstack/auto` 4.6.0 は 73.8 KB gzip、integrity は `sha384-0TjjA01DK4f0Mifl/Kf93JLUD/QM+koQyVquDIMwwTLmmW9Mh4oGGOQDSKI0sQyI`。
  - 配布物に今回の変更（storage の `storage-key`、worker / broadcast の `post-uncloneable`、upload ほかの `input-as-attribute`、44 個の `auto.d.ts`、lint の `not read:`、タグの目録の `storageKey`）がある。
- 公開後の作業（同日）:
  - PR #511（merge commit b3142f9c）: サイズの基準値を 4.6.0 の dist で取り直した（版の文字列だけ — `index.esm.js` と `auto.min.js` が +1 B、ssr が −1 B、`core.min.js` は 20,102 B のまま）。CLAUDE.md / AGENTS.md の版と数値、拡張を 2.6.0 に。
  - VS Code 拡張 2.6.0: b3142f9c で `npm run package` した vsix（890 ファイル、4.6.0 の state を同梱、テスト 1,309 件）。最初の公開は Marketplace の PAT の期限切れで止まった（`VSCE_PAT` も手元に保存した資格情報も同じ PAT）。著者が PAT を作り直し（Organization は All accessible organizations、スコープは Marketplace の Manage）、`vsce verify-pat` が通ってから同じ vsix を公開した（Marketplace の照会 API に 2.6.0 が出たのは公開から約 6 分後）。注釈付きのタグ `vscode-wcs-v2.6.0`（b3142f9c）。**global PAT は Azure DevOps で 2026-12-01 に廃止される**ので、その前に Microsoft Entra ID による公開（`vsce publish --azure-credential`）へ移る。
  - wcstack-skill: PR #44（merge commit bd90502）で、§5 の lint の門が覆う範囲、§6 のフレームワークの規則（深い写し、`event` の出力は要素で、要素を持つ ref と Vue の静的な ref、`trigger` でなく命令、`storage-key`、props の順、他のタブへの追随、付け直し、JSX のコロンのイベント、`/auto` の型、Vite の proxy）、失敗の表の 5 行、catalog を書き、版の印と CDN の固定を 4.6.0 にした。注釈付きのタグ `v4.6.0`。
  - LP（03eeace）:
    - 版の参照と、「Shipped in」の v4.6.0 の一文（上げるとコンソールの警告が増えうることと、リリースノートへのリンク）。state / signals のページの版。
    - ステップ 15 の `^4.6.0`、ステップ 16 の `wcstack@4.6.0` と integrity とリリースへのリンク。`wcstack/auto` は 73.8 KB gzip で「about 70 KB」のまま。
    - ステップ 07・12: それぞれの「わざと壊す」変更を 4.6.0 の lint で取り直した — 8 つの出力は一字一句変わらない。
    - llms の作り直しと、sitemap の lastmod。
    - 本番で 9/9。
- 残り:
  - 拡張の公開を、2026-12-01（global PAT の廃止）より前に Microsoft Entra ID の方法へ移す。
  - examples/fw-inventory の依存を `^4.6.0` にして lock を更新する（手元の npm は公開から 1 日たたない版を取らない設定）。
  - 長期サポート版は保留（著者の判断）。npm の `next` は 4.0.0 のまま。

### 4.6.1 の公開（2026-10-24）

- 中身: patch。TypeScript 7.1 の content mapper の調査から。`npm i -D typescript` で入るのは TypeScript 7 になったが、7 には JavaScript のコンパイラ API が無い（`typescript` が公開するのは版だけで、`exports` に `./lib/tsc` も無い）。それなのに `@wcstack/typescript` の peer は `>=5.0` で 7 を受け入れていた。`wcs-tsc` は「typescript が要る: `npm i -D typescript`」と言い（入れ直すとまた 7 が入る）、`wcs-schema` は読み込みの時点で `TypeError` で落ちた。PR #514（merge commit 47e4e821）:
  - peer を `typescript >=5.0 <7` にした。`wcs-tsc`・`wcs-schema`・`loadStateFile` は版を名指しし、`npm i -D typescript@6` と言って exit 2。判定は `src/typescriptSupport.ts` にまとめた。
  - `DEFAULT_COMPILER_OPTIONS` は enum を `?.` で読む（TS 7 の下でもモジュールが読み込める）。README と docs/typescript.md のインストールの行は `typescript@6`。
  - ほかのパッケージは版だけ。content mapper そのもの（TS 7.1 の `tsc` が `.html` の `<wcs-state>` を検査する）は scratchpad で試作した。examples の 33 ページで `wcs-tsc`（TS 5.9）と診断 23 件が一致したが、パッケージには入れていない。
- 準備: PR #515（merge commit e0eabd29）で CHANGELOG を `[4.6.1] — 2026-10-24` として締め、要約と Upgrading（TS 7 のプロジェクトでは、install の時点で npm が peer の不一致を報告する）を書いた。文書の固定版 18 か所を 4.6.1 にした。
- main で `patch`（run 40045737516）。成功した: 版を上げたコミット ff8e5258、タグ `v4.6.1`、GitHub Release（`sri.json` 付き。本文の先頭に要約・Upgrading・Fixed を足した）。
  - npm 49/49・`latest` 49/49・来歴証明 49/49（初回ですべてそろった）。SRI 44/44。文書の固定 URL 8 本がすべて 200。npm の README に印は残っていない。`@wcstack/server` 4.6.1 は `@wcstack/state` の 4.6.1 にちょうどで依存する。`@wcstack/typescript` 4.6.1 の peer は `>=5.0 <7`。`wcstack/auto` 4.6.1 は 73.8 KB gzip（4.6.0 と同じ大きさ）、integrity は `sha384-C9/GHL+ARs367PIKAIE2C3xVETLlQoAhvFZQtVXp2hV1WoJ9T6956yfBIHMZbj2m`。
  - 公開された tarball でも確かめた。TS 7.0.2 のプロジェクトでは npm が `ERESOLVE` を出し、`--force` で入れると 2 つのコマンドが版を名指しして exit 2。TS 6.0.3 では、`wcs-tsc` が型エラーを HTML の位置で報告し、`wcs-schema emit` が manifest を書く。
- 公開後の作業（同日）:
  - PR #516（merge commit 4fef6756）: サイズの基準値を 4.6.1 の dist で取り直した（版の文字列だけ — devtools と ssr が −1 B、`core.min.js` は 20,102 B のまま）。結合の基準値は変わらない。CLAUDE.md / AGENTS.md の版も直した。
  - VS Code 拡張は 2.6.0 のまま。4.6.1 は拡張が同梱するものを変えていないので、vsix は出していない。
  - wcstack-skill: PR #45（merge commit 7a178dc）で、§5 の `wcs-schema` / `wcs-tsc` の行に「TypeScript 5 か 6・`typescript@6` を入れる」と書き、版の印と CDN の固定を 4.6.1 にした（6 本とも 200）。注釈付きのタグ `v4.6.1`。
  - LP（2447ecb・bd221d8）:
    - 版の参照、「Shipped in」の v4.6.1 の一文、state / signals のページの版。
    - ステップ 15 の `^4.6.1`、ステップ 16 の `wcstack@4.6.1` と integrity とリリースへのリンク。llms の作り直し。sitemap の lastmod は既に 2026-10-24 だった。
    - 最初の commit がトップの v4.6.0 の一文とそのリンクまで v4.6.1 に置き換えていたので、bd221d8 で戻した。
    - lint は変えていないので、ステップ 07・12 の出力は取り直していない。
    - 手元で Chromium 7/7（ステップ 16 の integrity 付きの束で `wcs-state` が定義される）。本番の各ページに 4.6.0 の参照は残っていない。
- 残り:
  - content mapper を `@wcstack/typescript` に実験的に入れるか（著者の判断。TS 7.1 の stable を待つ案）。
  - 調査で見つけたもの（未修正）: `wcs-tsc` の設定の監査が、`include: ["src"]` のようなディレクトリだけの指定を「HTML を含まない」と誤って警告する。getter の中の `this.items[0].nmae` を `wcs-tsc` が見逃す（TS 5.9 でも 7.1 の試作でも同じ。メソッドの中なら報告する）。
  - 4.6.0 からの持ち越し: 拡張の公開を 2026-12-01 より前に Microsoft Entra ID の方法へ移す。examples/fw-inventory の依存を `^4.6.0` 以上にして lock を更新する。
  - 長期サポート版は保留（著者の判断）。npm の `next` は 4.0.0 のまま。

### 4.6.2 の公開（2026-10-24）

- 中身: patch。4.6.1 と同じ content mapper の調査で見つけた `wcs-tsc` の不具合 2 件と、TypeScript 7 への対応の設計。PR #518（merge commit 074398e1）:
  - getter の本体を検査する（`wcs-tsc` と VS Code 拡張）。`defineState` は T をオブジェクトから推論し、戻り値の型注釈の無い getter の型は本体から推論される。本体が `this` を読むとその推論が T に戻ってくるので、TypeScript（5.9 も 7.1 も）はその getter の `this` を `any` のままにする。最小の `f<T>(x: T & ThisType<T>)` でも再現する。
    - その結果、`get first() { return this.items[0].nmae; }` は報告されず、strict では getter の中のコールバックが TS7006、`this.$getAll<number>()` が TS2347 の偽陽性になっていた。
    - 制約の型を変えても、`NoInfer` でも、`_WcsThis` を削っても直らない。戻り値の型を注釈すれば直る。
    - そこで言語プラグインが、state の直下の getter のうち `this` を読むものの `)` の後ろに `: any` を挟む（`getterAnnotations.ts`、acorn。挟んだテキストに対応は無い）。両モードとも `VirtualCodeBuilder` で組む。
    - examples の 33 ページでは 23 件が 25 件になった。増えたのは router-spa の `routeParams: {}` / `query: {}` を読む getter で、メソッドなら前から報告される種類。CHANGELOG の Upgrading に書いた。
  - `include: ["src"]` を「HTML を含まない」と誤って警告していたのを直した（`includeCoversHtml`。tsc はディレクトリを `src/**/*` と読む）。
  - docs/typescript-content-mapper.md（日英）: TypeScript 7 の下で `<wcs-state>` を content mapper で検査する設計。プロトコル、試作で測ったこと（この修正込みで examples の 25 件が一致、TS18073、LSP の `runExternalCode`、CDN の import を supplemental の宣言で `any` に）、設計、エディタでの拡張との重なり、`wcs-schema` の別の移植、著者が決めること。未実装。
- 準備: PR #519（merge commit b36f6e18）で CHANGELOG を `[4.6.2] — 2026-10-24` として締め、固定版 18 か所を 4.6.2 にした。
- main で `patch`（run 40062903397）。成功した: 版を上げたコミット 595ae64b、タグ `v4.6.2`、GitHub Release（`sri.json` 付き。本文の先頭に要約・Upgrading・Added・Fixed を足した）。
  - npm 49/49・`latest` 49/49・来歴証明 49/49。ただし `wcstack` だけ、公開（04:57 UTC）から registry に現れるまで約 10 分かかった（4.6.0 と同じ。公開し直さずに待った）。SRI 44/44（1 回目は storage が jsDelivr の 502。取り直して一致）。文書の固定 URL 8 本がすべて 200。`@wcstack/typescript` 4.6.2 の peer は `>=5.0 <7`。`wcstack/auto` 4.6.2 の integrity は `sha384-XkPudkLILZ2r27xNWb1Zex/AuqgRZGUBp52c8k9GPB16q86k2y/GkCnhDqv2VG2+`。
  - 公開された tarball で確かめた。strict の TS 6.0.3 のプロジェクトで、getter の typo を `getter.html(4,38)` で報告し、getter のコールバックに TS7006 は出ない。`include: ["src"]` の警告も出ない。
- 公開後の作業（同日）:
  - PR #520（merge commit 47d1e38a）: サイズの基準値を 4.6.2 の dist で取り直した（版の文字列だけ — ssr が +2 B、`core.min.js` は 20,102 B のまま）。結合の基準値は変わらない。CLAUDE.md / AGENTS.md の版と、拡張を 2.6.1 に。
  - VS Code 拡張 2.6.1: 47d1e38a で `npm run package` した vsix（890 ファイル、テスト 1,314 件、server に getter の注釈が入っている）を公開した。PAT は事前に `vsce verify-pat` で確かめた。Marketplace の照会 API に 2.6.1 が出たのは 05:21 UTC。注釈付きのタグ `vscode-wcs-v2.6.1`。
  - wcstack-skill: PR #46（merge commit 9006dfd）で、§5 の `wcs-tsc` の行に「4.6.2 から getter の本体も検査する（拡張 2.6.1 も同じ）」と書き、版の印と CDN の固定を 4.6.2 にした（6 本とも 200）。「since 4.6.1 npm refuses」は始まった版なので残した。注釈付きのタグ `v4.6.2`。
  - LP（8c73f51）:
    - トップは、pill と「Shipped in」の見出しだけを 4.6.2 にし、v4.6.1 の一文の後に v4.6.2 の一文を足した（4.6.1 のときの一括置換の罠を避けた）。
    - state / signals のページの版、ステップ 15 の `^4.6.2`、ステップ 16 の `wcstack@4.6.2` と integrity とリリースへのリンク、llms の作り直し。
    - 手元で Chromium 7/7。本番に残る 4.6.1 は、トップの v4.6.1 の一文（日英）と skill の「since 4.6.1」だけ。
- 残り:
  - content mapper の実装（著者の判断。docs/typescript-content-mapper.md §8）。
  - 4.6.0 からの持ち越し: 拡張の公開を 2026-12-01 より前に Microsoft Entra ID の方法へ移す。examples/fw-inventory の依存を更新する。
  - 長期サポート版は保留（著者の判断）。npm の `next` は 4.0.0 のまま。

### 4.7.0 の公開（2026-10-25）

- 中身: minor。docs/v4-direction-2026-10.md の下での 5 回目の minor で、§3.2 の最後の継ぎ目 — 本番の形 — の継ぎ目アプリ `prod-booking`（docs/seam-apps.md）から。作者の決定 5 件は v4-direction §5.5。PR #525〜#531（番号順に積み、番号順にマージ）:
  - #525 router: ページが求める読み直し（`location.reload()`・`history.go(0)`・`navigation.reload()`）を intercept しない（`navigationType === "reload"` をブラウザに任せる）。`<wcs-head>` は変わらない `<head>` の要素を入れ直さない（スタイルシートの取り直しと、WebKit の遷移ごとの `base-uri` 違反が消えた）。module のスクリプトの無い `<wcs-guard-handler>` はルートを閉じる（読み込めなかったハンドラと同じく guard のパスへ。`guard` 属性の無いルートも — 既存の「ハンドラはそれ自体で guard を有効にする」と一貫させた）。
  - #526 autoloader: どの名前空間にも属さないカスタム要素で走査を止めない（以前は最初の走査で投げると MutationObserver も張らず、ページの部品が 1 つも読まれなかった）。
  - #527 state: エンジンが報告するエラーをすべて `reportError()` で出す（`parser/raiseError.ts` の `report()`。happy-dom・Node では従来どおり `console.error`）。別のエンジンのコピーのアドオンを `installFeatures` が `[wcs/feature-foreign]` で拒む（どの add-on も自分のビルドの `hooks` を持ち、core が比べる。formats → `hooks.ts` の結合を記録し直した）。`core.min.js` は 20,102 → 20,163 B。
  - #528 formats: 日付の 5 つ（`date`・`time`・`datetime`・`ymd`・`hms`）は値が無いとき素通し。
  - #529 lint: `wcs/state-src-unread`（info、新規。読めない `<wcs-state src>`）と、`(x ?? []).map(…)`・`null` を種にしたリストの行の形。CI で lint のスモークテストの 2 件が「info 0 件」を完全一致で期待して落ちた — 手元では、まとめたコマンドの終了コードだけを見て通ったと誤認していた。期待を直して取り込んだ。
  - #530 docs と `scripts/generate-sri.mjs`: `sri.json` に `@wcstack/state` の `dist/split` のすべてのファイル、リリースノートに import map の `integrity` のブロック。csp.md / sri.md のブラウザ対応（Firefox の import map の integrity は 138、外部スクリプトの CSP ハッシュは 115、Safari も。Trusted Types は Safari 26 と Firefox）、部品自身の `shadowRoot.innerHTML` が Trusted Types の sink であること、自前配信（sri.md §7）、README 4 つ。
  - #531 記録: seam-apps（日英）、v4-direction §5.5、誤りの目録（108 項目）。
- 準備: PR #532（merge commit e3ad8ba8）で CHANGELOG を `[4.7.0] — 2026-10-25` として締め（要約と Upgrading 4 項目）、固定版 18 か所を 4.7.0 にした。印の除去は 8 README・16 行の見込み（ほかの版の印は無し）。
- main で `minor`（run 40143918670）。成功した: 版を上げたコミット cf3280ce、タグ `v4.7.0`、GitHub Release（`sri.json` 付き。本文の先頭に要約・Upgrading・Added・Changed・Fixed を足した）。
  - npm 49/49・`latest` 49/49・来歴証明 49/49。SRI 44/44。**分割エントリのダイジェスト 22/22**（今回から `sri.json` に載る。jsDelivr が返すファイルと照合）。文書の固定 URL 8 本がすべて 200。公開された README に未リリースの印は無い。`@wcstack/server` の依存は `@wcstack/state` 4.7.0。公開物に `feature-foreign`・`state-src-unread`・読み直しの扱いが入り、autoloader の `No matching namespace` は消えた。`wcstack/auto` 4.7.0 の integrity は `sha384-xJE52u8ewAT7VeLCXj5a4Yg9dhGMDaH7i+zpsJR+D8b0TJeNzJBPPh9AqzlNxDU3`。
- 公開後の作業（同日）:
  - PR #533（merge commit f2d4012c）: サイズの基準値を 4.7.0 の dist で取り直した（`core.min.js` 20,163 B、残り 317 B。どの add-on も数 B 増 — 自分のビルドの `hooks` を持つため）。結合の基準値は変わらない。CLAUDE.md / AGENTS.md の版と数字、拡張を 2.7.0 に。
  - VS Code 拡張 2.7.0: f2d4012c で `npm run package` した vsix（890 ファイル、テスト 1,320 件）。作る途中で、未追跡の `packages/vscode-wcs/dist` に TypeScript 7.1 のブランチのビルドの残り（`content-mapper.cjs`）が入っていて 891 ファイルになっていた — 前の版の vsix と一覧を突き合わせて見つけ、外した。publish は著者が実行した（Marketplace 00:56 UTC）。Marketplace から取った vsix は手元のものと SHA-256 が一致。注釈付きのタグ `vscode-wcs-v2.7.0`（f2d4012c）。
  - wcstack-skill: PR #47（merge commit a682b58）で、`/core` の filter の一覧の誤り（算術・変換・既定値は formats）、add-on の名前に `native-commands`、`[wcs/feature-foreign]`、分割のダイジェストは `sri.json` から、ブラウザ対応、日付の素通し、ガード・読み直し・`basename`・autoloader、配備をまたぐ保存値、`wcs/state-src-unread`、`reportError()` を追随し、版の印と CDN の固定を 4.7.0 にした（6 本とも 200）。「Since 4.6.2 it checks getter bodies」は始まった版なので残した。注釈付きのタグ `v4.7.0`。
  - LP（7ddb32f）: トップの pill と「Shipped in」の見出しを 4.7.0 にし、v4.6.2 の一文の後に v4.7.0 の一文（日英）を足した。state / signals のページの版と分割の URL、ステップ 15 の `^4.7.0`、ステップ 16 の `wcstack@4.7.0` と integrity とリリースへのリンク、llms の作り直し。手元で Chromium 7/7、ステップ 07 / 12 の lint の出力は 4.7.0 の lint で 8 つとも不変。
  - examples への取り込み: PR #534（merge commit c51b590d）。`examples/prod-booking/` に v1（公開版 4.6.2、npm の別名）と v2（`WCS_LOCAL=1` の dist）を並べ、6 つのプロファイル。spec 11 件、`@browsers` の 2 件は新しい `firefox` の project でも走る（e2e.yml が firefox を入れる）。CI の e2e で 384 件が通過。取り込みで、その場の置き換えが拒まれるのは開いたタブが 4.7 以降のときだけ（4.6 の core に検査が無い）と分かり、記録した。
- 残り:
  - 拡張の公開を 2026-12-01 より前に Microsoft Entra ID の方法へ移す（4.6.0 からの持ち越し）。
  - content mapper（TypeScript 7.1 の stable の後の最初の minor。draft の #523、#524）。
  - 長期サポート版は保留（著者の判断）。npm の `next` は 4.0.0 のまま。

### 4.8.0 の公開（2026-10-26）

- 中身: minor。docs/v4-direction-2026-10.md の下での 6 回目の minor で、その 2 巡目（§3.2）の最初の継ぎ目アプリ `shift-desk` — シフトの間開いたままのサポート窓口の画面 — から（docs/seam-apps.md）。作者の決定 5 件は v4-direction §5.7。リリースの単位は「1 本で minor 1 回、そろったらすぐ出す」（§5.6 の 2、著者が推奨の「2 週間に 1 回」を退けた）。PR #536〜#543（番号順にマージ。CHANGELOG の `[Unreleased]` と `WebSocketCore` の `_onOpen` の衝突は両方を残して解いた）:
  - #536 方針: 2 巡目の候補と順、止める目安、1 本につき変える軸は 1 つ、core の予算（残り 317 B は後付けに置く）、§5.6。
  - #537 router: `<wcs-head>` の束ねた子のクローンを子ごとに 1 つ持ち、入れ直す。遷移のたびに新しいクローンを binder に渡していて、binder に解く口が無い（binder の設計書 §6-2 の未解決）ので、束ねた `<title>` で遷移ごとに 2 ノード残っていた。core は 0 B。
  - #538 I/O ノード（17 パッケージ）: 接続時の仕事は 1 つのマイクロタスクで、そのときの入力で決める（timing-and-firing-contract §23）。router が入れ直すルートの同じノードは、state が次のルートの入力を書く前に接続する — ルートの `<wcs-ws>` は前のチケットのチャットへつないでから閉じていた。最初の接続で結果を同じタスクで使う storage・broadcast・worker はその場のまま。明示のコマンドは判断を引き取る（停止は止めたまま、`pause()` は開始してから一時停止）。棚卸しとパッケージごとの実装は、サブエージェント 3 人で並行。
  - #539 lint: getter の `@returns` と JSDoc の交差型を読む。既定引数が呼び出しのメソッドを見失わない。アプリの誤報 10 件と examples/prod-booking の 5 件が消えた。
  - #540 `stale-after`（`<wcs-sse>` / `<wcs-ws>`、任意）と、`<wcs-ws>` の back/forward cache（persisted の `pagehide` で閉じてその場で知らせ、`pageshow` でつなぎ直す — `WebSocketCore.suspend()`）。sse の README の追いつきの作法（イベントごとに開き直していた）、諦めたストリームの見分け方（`errorInfo`）、URL のトークン。
  - #541 文書: docs/long-lived-pages.md（日英、新規）、存在しない `debounce` フィルタの例（notification・speech・I/O ノードの手引き）、idle の例。
  - #542 `[wcs/command-not-ready]` は不調 1 回につき 1 回、許可なしの `<wcs-idle>` の `start()` も警告（分離した作業ツリーのサブエージェント）。
  - #543 記録: seam-apps（日英）、v4-direction §5.7、誤りの目録（108 → 119 項目）。
- リリースの前: CI は PR でしか走らないので、衝突を解いた後の main の組み合わせを手元で確かめた — 全パッケージを src からビルドして e2e 384/384。`@wcstack/typescript` のビルドの rollup が出力の後に終わらず（CPU 0 のまま）、PID で止めた。この環境だけの症状で、CI の Linux では同じビルドが通る。
- 準備: PR #544（merge commit 4c82f23c）で CHANGELOG を `[4.8.0] — 2026-10-26` として締め（要約と Upgrading 3 項目）、固定版 18 か所を 4.8.0 にした。印の除去は 42 README・70 行の見込み（ほかの版の印は無し）。
- main で `minor`（run 40300636847）。成功した: 版を上げたコミット 08dbe832、タグ `v4.8.0`、GitHub Release（`sri.json` 付き。本文の先頭に要約・Upgrading・Added・Changed・Fixed・Documentation を足した）。
  - npm 49/49・`latest` 49/49・来歴証明 49/49。SRI 44/44。分割エントリのダイジェスト 22/22。文書の固定 URL 8 本がすべて 200。公開された README に未リリースの印は無い。`@wcstack/server` の依存は `@wcstack/state` 4.8.0。公開物に `stale-after`・`pagehide`・idle の警告が入っている。`wcstack/auto` 4.8.0 の integrity は `sha384-luQNsFQ18iKvnjSBUHt/kYkc5VZk2c2WwfORG5JdTrWQDtS1JyntOHntZppHWyQn`。
- 公開後の作業（同日）:
  - PR #545（merge commit e10619a6）: サイズの基準値を 4.8.0 の dist で取り直した（state の src は 4.7.0 から変わっていない。devtools が版の文字列で 1 B、`core.min.js` は 20,163 B のまま、残り 317 B — 2 巡目の core の予算は使っていない）。結合の基準値は変わらない。CLAUDE.md / AGENTS.md の版、拡張を 2.8.0 に。
  - VS Code 拡張 2.8.0: e10619a6 から、リポジトリの隣の作業ツリーで `npm run package` した vsix（890 ファイル — 2.7.0 と一覧が同じ、テスト 1,323 件）。scratchpad の下では作業ツリーのファイル名が長すぎて作れなかった。publish は著者が実行した。Marketplace から取った vsix は手元のものと SHA-256 が一致（`5014efb4…`）。注釈付きのタグ `vscode-wcs-v2.8.0`（e10619a6）。
  - wcstack-skill: PR #48（merge commit 0578e98）で、接続時の判断のマイクロタスク、`stale-after`、`<wcs-ws>` と bfcache、不調 1 回につき 1 回、開いたままのページ、SSE の追いつきと諦めたストリーム、idle の `active`、失敗の一覧の 3 行（`debounce` フィルタ・`$connectedCallback` だけの取り直し・刻みで時間）を追随し、版の印と CDN の固定を 4.8.0 にした。注釈付きのタグ `v4.8.0`。
  - examples への取り込み: PR #546。`examples/shift-desk/`（自分の `server.js` と `ws`、`WCS_LOCAL=1`）。4.8.0 で要らなくなった回避策 5 つ（接続の見張り、チャットの開閉、静的な `<title>`、`readyState === 2`、idle の `active`）を外した。spec 12 件（ポート 5700 + 10 × index）、bfcache の試験はフル版の Chromium を試験の中で起動する。取り込みで見つかったもの: docs/ の未リリースの印はリリースで確かめられも外されもしない（`scripts/unreleased-marks.mjs` は README だけを読む）— framework-adapter-integration に 4.6 の印が 4.6.0 から残っていた。PR の中で外した。手引きの起き上がりの処理に、スリープ中に期限が来たタイマーは古いトークンで動くことを足した。
- 残り:
  - LP の追随（今回は頼まれていない）。
  - `scripts/unreleased-marks.mjs` を docs/ に広げるか（文書の中で印そのものを説明する文 — seam-apps・v4-direction — を除く工夫が要る）。
  - 拡張の公開を 2026-12-01 より前に Microsoft Entra ID の方法へ移す。
  - content mapper（TypeScript 7.1 の stable の後の最初の minor。draft の #523、#524）。
  - 長期サポート版は保留（著者の判断）。npm の `next` は 4.0.0 のまま。

### 4.9.0 の公開（2026-10-28）

- 中身: minor。docs/v4-direction-2026-10.md の下での 7 回目の minor で、その 2 巡目（§3.2）の 2 本目の継ぎ目アプリ `family-ledger` — 2 人で使う家計簿 — から（docs/seam-apps.md）。この回は継ぎ目ではなく作者を変えた: AI の作成スキル（v4.8.0）だけを入口にする、別のモデル（Sonnet 5.5）の初めての作者を、リポジトリと関係のないディレクトリの入れ子の `claude -p` で動かした（サブエージェントにはリポジトリのパスと CLAUDE.md が見える）。作者は lint を自分から回し、わざとした間違い 26 件のうち 6 件は何も知らせなかった。作者の決定 4 件は v4-direction §5.8。
  - #548 router: `leaveConfirm` が真偽値を受ける（`true` は英語の既定の文言、`false` は聞かない）。真偽値が文言になり、遷移のたびに `confirm("false")` が出ていた。
  - #549 state の診断: `$on` の `this` を宣言のときに（`[wcs/on-handler-this]`）、ルートが 2 つの `<wcs-state>` の両方を名指す（`[wcs/second-root]` — 状態が先にそろった方がルートを取り、文書で先の本物が拒まれていた）、日付だけの文字列には `new Date(y, m - 1, d)` と言う。core は 0 B、diagnostics +563 B（リリースまで slack 512 B）。
  - #550 fetch の文書: `value` は新しい url の間も空の url の後も前の応答のまま、`value` / `status` は同じ値では発火しない — 応答のイベントで完了を知る。
  - #551 testing: `mount(html, { resolveModule })`（`src` の state）、読み込み元の無い `<wcs-state>` は挿入の前に断る（無言の時間切れだった）。
  - #552 upload: `<wcs-upload-header>`。vscode-wcs の tagNameMap の試験に「config にあり、コミット済みの dist にまだ無いタグ」の除外（リリースで dist とカタログが作り直されると自然に消える）。
  - #553 sse: `auto-reconnect` / `reconnect-interval` / `max-reconnects`（ws と同じ名前、opt-in）。3 本の継ぎ目アプリが同じタイマーを自前で書いていた。諦めた通知の途中のリスナーが `connect()` すると新しいストリームを見失う再入の欠陥も直した。Firefox の「接続が中断された」は README に 1 行。
  - #554 lint: メソッドで `map` から代入した行と、`{}` の種に代入したオブジェクトリテラルのキーを読む。束縛が書くパスを getter が入れ子で読むと `wcs/getter-untracked-read` は error（ボリュームの照合と `value#ro,init=none` の誤報も直した）。リポジトリのページの出力は 4.8.0 と同一。
  - #555 記録: seam-apps（日英）、v4-direction §5.8、誤りの目録（119 → 125 項目）。
  - 4 本（#551〜#554）は分離した作業ツリーのサブエージェントが作り、差分を見てから push した。
- リリースの前: 衝突を解いた後の main の組み合わせを手元で確かめた — 全パッケージを src からビルドして e2e 396/396。rollup が出力を書き終えた後に終わらないことが、typescript だけでなく gyroscope でも起きた（PID で止めた。この環境だけの症状）。
- 準備: PR #556（merge commit 143d0cdc）で CHANGELOG を `[4.9.0] — 2026-10-28` として締め（要約と Upgrading 4 項目）、固定版 18 か所を 4.9.0 にした。印の除去は 12 README・44 行の見込み（ほかの版の印は無し）。
- main で `minor`（run 40549727479）。成功した: 版を上げたコミット 2087829c、タグ `v4.9.0`、GitHub Release（`sri.json` 付き。本文の先頭に要約・Upgrading・Added・Fixed・Documentation を足した）。
  - npm 49/49・`latest` 49/49・来歴証明 49/49。SRI 44/44。分割エントリのダイジェスト 22/22。文書の固定 URL 8 本がすべて 200。公開された README に未リリースの印は無い。`@wcstack/server` の依存は `@wcstack/state` 4.9.0。最初の照合では websocket だけがレジストリにまだ見えなかった（`npm view` では公開済み）— 反映を待って照合し直した。公開物に `<wcs-upload-header>`・`auto-reconnect`・二つの診断・router の既定の文言・testing の `resolveModule` が入り、公開版の lint は family-ledger の再現で誤報が消え、束縛の書くパスの読みを error にした。
- 公開後の作業（同日）:
  - PR #557（merge commit c3c826cf）: サイズの基準値を 4.9.0 の dist で取り直した（`core.min.js` は 20,163 B のまま、残り 317 B — 2 巡目の core の予算は 2 本とも使っていない。diagnostics は 9,186 B、slack を外した）。CLAUDE.md / AGENTS.md の版、docs/long-lived-pages の 4.9 の印（リリースは README の印しか外さない）、拡張を 2.9.0 に。docs/csp.md（日英）の「`<base>` の下ではルート絶対で書く」を「ルートより下の base のとき」に直した — スキルの同じ助言の元で、`<base href="/">` では相対で同じ URL になり、lint はルート絶対の `src` を読まない。
  - VS Code 拡張 2.9.0: c3c826cf から、リポジトリの隣の作業ツリーで `npm run package` した vsix（890 ファイル — 2.8.0 と一覧が同じ、テスト 1,346 件）。publish は著者が実行した。Marketplace から取った vsix は手元のものと SHA-256 が一致（`664e1b3c…`）。注釈付きタグ `vscode-wcs-v2.9.0`（c3c826cf）。
  - wcstack-skill: PR #49（merge commit 2b7e5ef）で、`<base href="/">` の下の相対の `src`、別のタブのログアウト、真偽値の `leaveConfirm`、`<wcs-upload-header>`、sse の `auto-reconnect` と `message` の形、fetch の `value` と完了の知り方、testing の `resolveModule`、4.9 の lint と診断、失敗の一覧の 7 行を追随し、注釈付きタグ `v4.9.0`。
  - examples への取り込み: PR #558。`examples/family-ledger/`（Node の組み込みだけのサーバー、`WCS_LOCAL=1`）。4.9.0 で要らなくなった回避策 5 つ（CDN の `UploadCore`、ストリームを開き直すタイマー、`loading` の端で知る削除、`budgetRows` の JSDoc、試験で `lib.js` をインラインに貼ること）を外し、それぞれ外すと spec が落ちることを確かめた。spec 14 件（ポート 5900 + 10 × index）。取り込みで 2 件見つけた: 4.9 の lint が受け入れる `{}` の種の代入を、診断の後付けは読み込みの時点の値で `[wcs/binding-path-missing]` と警告し「silently dropped」と言う（未決）、`wcs-link.btn a` の CSS はどこにも当たらない（`<a>` はホストの次の兄弟）。
- 残り:
  - 診断の後付けの `{}` の種への警告を lint にそろえる（次の minor の候補）。
  - 2 巡目の 3 本目（アクセシビリティと言語 — §3.2）。止める目安には当たっていない（重い実行時の欠陥と新しい種類の発見が出た）。
  - LP の追随（今回は頼まれていない）。
  - 拡張の公開を 2026-12-01 より前に Microsoft Entra ID の方法へ移す。
  - content mapper（TypeScript 7.1 の stable の後の最初の minor。draft の #523、#524）。
  - 長期サポート版は保留（著者の判断）。npm の `next` は 4.0.0 のまま。

### 4.10.0 の公開（2026-10-30）

- 中身: minor。docs/v4-direction-2026-10.md の下での 8 回目の minor で、その 2 巡目（§3.2）の 3 本目の継ぎ目アプリ `city-library` — キーボードとスクリーンリーダーで使う、日本語・英語・アラビア語の図書館の利用者サイト — から（docs/seam-apps.md）。この回は作者を 1 巡目の設定（公開文書・スキル v4.9.0・公開版 4.9.0）に戻し、継ぎ目をアクセシビリティと言語に変えた。わざとした間違い 20 件のうち 16 件は何も知らせず、公開版の lint はアプリに 108 件の誤報を出した。作者の決定 4 件は v4-direction §5.9。
  - #560 state の診断: 空の `{}` の種の下のキーを報告しない（family-ledger の取り込みで見つけた）。diagnostics +8 B。
  - #561 state: `<wcs-view-transition>` があっても `$watch` と `$stream` の再開は、トランジションが適用するバインディングを待つ（決定 Q1）。文書のログインがタグを足すと 3 回中 0 回になっていた — `$watch` の画面移動が `<wcs-storage>` の保存より先に走り、ガードが読み手を戻した。core +39 B。
  - #562 state の診断: 要素が書くオブジェクトの下のキー（router の `searchParams: query` の `query.next`）を報告しない。
  - #563 router: 素のフラグメントへのリンクはページの中に留まり、指す要素へフォーカスを移す（決定 Q2）。クエリ付きの `<wcs-link>` はそのクエリのときだけ current（Q3）。同じフラグメントの 2 回目がスクロールしない既存の欠陥、接続前の `match` のエラーも直した。router の文書（ルートの中身の状態のリージョンは読まれない、ガードのセッションの保存の形など）と e2e `router-fragment-links.spec.ts`。
  - #564 state: `date` / `time` / `datetime` が 3 つ目の引数でタイムゾーンを受ける（Q4）。`date(UTC)` はゾーンとして読み、4.9 まで `RangeError` だった `date(,long)` も動く。formats +41 B（残り 10 B）。
  - #565 lint: 名前で書いたキー（短縮プロパティ・import した定数）を読む、`<head>` のスクリプトが作る `<base>`、入れ子のコールバックの `return`、`$renderedCallback` の文字列の比較の誤報を直し、`--root`。新しい規則 `wcs/live-region-inserted`（文と一緒に挿入される状態のリージョン — リポジトリの family-ledger・router-auth・state-field-report がその形だったので直した）。
  - #566 記録: seam-apps（日英）、v4-direction §5.9、誤りの目録（125 → 133 項目、#565 の項目と合わせて）。
  - #563〜#565 は分離した作業ツリーのサブエージェントが作り、差分を見てから push した。
- マージ: #562 は `diagnostics.test.ts` で衝突し、手で解いた。CHANGELOG の衝突の解決で 2 項目が別の見出しに入った（準備で直した）。**#562 のコミットが state の README（日英）に全文の写しを入れていた** — JS の `replace` の置換文字列の `` $` `` が「一致より前の全文」に展開された。CI も差分の確認も通り、後のマージ（#564）がメッセージ表の 2 行を写し側に当てていた。準備でピンの置換数が 26（いつもは 18）になって気づいた。
- リリースの前: 全パッケージを src からビルドして e2e 421/423。落ちた 2 件は family-ledger の spec が 11 番目のワーカーでポート 6000（fetch とブラウザが拒む）を引いたため。
- 準備: PR #567（merge commit 70801f3c）。CHANGELOG を `[4.10.0] — 2026-10-30` として締め（要約と Upgrading 5 項目、誤った見出しの 2 項目を移した）、固定版 18 か所を 4.10.0 にした。README の写しを捨て（写し側に入った 2 行は本体へ）、family-ledger の spec のポートを 6100 + 10 × index にした。印の除去は 8 README・36 行の見込み。
  - **準備の CI の e2e が `examples/router-admin` で 3 回とも落ちた — #561 の退行**。`$watch` を適用の後に回したので、`$watch` が state に写した一覧（`this.rows = cur.items`）のパスは 2 つ目のトランジションになり、「読み込み中の表示が消えたのに行は前のページのまま」のフレームができた。試験は古い 1 行目の名前を読み、クリックの時点では新しい行だった。#561 と #563 は CI で一緒に試されていなかった（各 PR の CI はマージ前の main の上）。手元の組み合わせの確認は多くのワーカーで流したので隠れていた — 1 ワーカーなら state を src にして 0/8、4.9.0 で 8/8。
  - PR #568（merge commit ca4c03cd）: 保留したパスを裁定者が適用したら、その適用と後の `$watch` が書いた分をその場でドレインし、同じトランジションの中で当てる（タグが無ければ同じフレームで当たるのと同じ）。`$watch` は適用の後のまま（決定 Q1）。連鎖は数え続けるので循環は打ち切られ、読み込み時の循環はアービターが無いときと同じく読み込み時に打ち切られる（regression-3x-chains の期待を 1 回 → 2 回に）。core +32 B。2 ワーカーで e2e 423/423、city-library の F21 はタグありで 3/3 のまま。
- main で `minor`（run 40961065091）。成功した: 版を上げたコミット c1b5c577、タグ `v4.10.0`、GitHub Release（`sri.json` 付き。本文の先頭に要約・Upgrading・Added・Changed・Fixed・Documentation を足した）。
  - npm 49/49・`latest` 49/49・来歴証明 49/49。SRI 44/44。分割エントリのダイジェスト 22/22。文書の固定 URL 8 本がすべて 200。公開された README に未リリースの印は無い。公開物に router のフラグメントのリンク、formats のゾーン、フィルタの引数 0〜3（manifest）、lint の `wcs/live-region-inserted` と `--root` が入っている。
- 公開後の作業（同日）:
  - PR #569（merge commit a220581a）: サイズの基準値を 4.10.0 の dist で取り直した（`core.min.js` 20,237 B — 4.9.0 から +74 B、残り 243 B。diagnostics 9,384 B、formats 1,731 B）。CLAUDE.md / AGENTS.md の版、docs/timing-and-firing-contract と examples/router-i18n の 4.10 の印（リリースは README の印しか外さない）、CHANGELOG の core の数字を公開物の実測に、拡張を 2.10.0 に。
  - VS Code 拡張 2.10.0: a220581a から、リポジトリの隣の作業ツリーで `npm run package` した vsix（890 ファイル — 2.9.0 と一覧が同じ、テスト 1,392 件）。publish は著者が実行した。Marketplace から取った vsix は手元のものと SHA-256 が一致（`bf7c5d58…`）。注釈付きタグ `vscode-wcs-v2.10.0`（a220581a）。
  - wcstack-skill: PR #50（merge commit edc0aee）で、`<base href>` は `/` か basename、スキップリンク、クエリ付きのリンクの `aria-current`、言語の切り替えは素の `<a>`、`$watch` の順序と同じトランジション、日付のゾーン（引数 0〜3）、ライブリージョン、lint のボリューム・名前で書いたキー・`--root`、行の中の `aria-*` を追随し、失敗の一覧に 4 行。注釈付きタグ `v4.10.0`。
  - LP（wcstack.github.io 0861d6f）: リリースの表示、v4.10.0 の一文（日英）、固定版、ステップ 16 の integrity（`sri.json`・jsDelivr・手元の dist の 3 者一致）と大きさ（約 76 KB）、llms。ステップ 07 / 12 の lint の出力は 4.10.0 でも 8 ブロック不変。本番 8/9（`/tutorial/16-publish/app/` の 404 は設計どおり）。
  - examples への取り込み: PR #570（merge commit 45501a6a）。`examples/city-library/`（ページは `public/`、Node の組み込みだけのサーバー、`WCS_LOCAL=1`）。4.10.0 で要らなくなった回避策 6 つ（`public/site/` に置いて相対で書いた `src`、422 の後のフォーカスと `localStorage` を待つログインを `$renderedCallback` で動かすこと、`query.next` を読む getter、東京時刻の `Intl.DateTimeFormat`、router のパスから組んだスキップリンクの `href`）を外し、4.9.0 の state と router の dist ではそれぞれ自分の試験で落ちることを確かめた（フィルタを 4.9 の形に戻して 13 件。そのままでは 16 件 — ゾーンの引数が `[wcs/filter-arity]` でルートの state を止める）。422 の要約に欄ごとのリンクを足し、作者の値だけの更新を、4.9 まで壊れていた構造の変更にした。lint は `--root=examples/city-library/public` で 0 件（`--strict` も）。spec 18 件（`@browsers` の 7 件は Firefox でも。ポート 7100 + 10 × index）、2 ワーカーの全 e2e 448/448。取り込みで 3 件見つけた（すべて未決）: `<wcs-view-transition>` があると最初の描画より前の state の更新がトランジションの中で走り、Chromium はページの最初の描画を止める（最小のページで約 20 ms → 250–300 ms。4.9.0 も同じ）。タグがあると router の `path` は `routeName` より 1 フレーム遅れ、そのフレームの 401 は離れるページを `next` にした。`page` を省いた 1 ページ目へのリンクは 4.10 のクエリの規則でどのページでも current になる（設計の問い）。
- 残り:
  - 取り込みで見つけた 3 件（最初の描画がビュー遷移を待つ、`path` の 1 フレームの遅れ、省いた既定のパラメータと current）— 次の minor の候補。
  - 2 巡目は止める目安に当たっていない（いちばん重い実行時の欠陥と、新しい種類の発見 — スクリーンリーダーに何が聞こえるか — が出た）。次の継ぎ目は v4-direction §3.2 から。
  - 組み合わせの確認は CI と同じワーカー数でも流す（今回の退行は多ワーカーで隠れた）。
  - 拡張の公開を 2026-12-01 より前に Microsoft Entra ID の方法へ移す。
  - content mapper（TypeScript 7.1 の stable の後の最初の minor。draft の #523、#524）。
  - 長期サポート版は保留（著者の判断）。npm の `next` は 4.0.0 のまま。
