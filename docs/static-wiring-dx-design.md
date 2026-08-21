# 設計: data-wcs 静的配線 DX — 結線の一級データ化

- **状態**: 検討完了・採択（2026-08-21）。実装前。§0 の決定レコードが正本。
- **対象**: `packages/vscode-wcs` / `packages/lint` / `packages/devtools` / `@wcstack/state`（parser subpath 公開・manifest 収載・エラーメッセージ強化）。
- **一言で**: 「結線が `data-wcs` に静的露出している」という wcstack 固有の性質を、現行 lint / devtools を越える DX に換金する。核は **1 本の背骨（正本パーサの公開 + 位置情報付き参照インデックス）** と **2 つの独立チャネル施策（ランタイムエラー self-fix 誘導・skill への検証ループ組込）**、その上に載る換金面（hover / go-to-definition / 配線カバレッジ / 機械可読診断）。
- **前提資産**: manifest 正本導出パターン（`@wcstack/state/manifest`、PR#154 で確立）、`$watch` 静的検証 + devtools sink（PR#161）、devtools hook protocol v1（[devtools-hook-protocol.md](./devtools-hook-protocol.md)）、`wcs-validate` の IDE/CLI 診断パリティ（[architecture-hardening/09](./architecture-hardening/09-remediation-design.md) §7.1）。
- **経緯**: 2026-08-20 に 4 レンズ（IDE 深化 / グラフ基盤 / devtools 融合 / AI-native）で 22 案を起案し、実現性・価値の両面から敵対的検証した結果の統合。行番号の引用は main `58cfb34c` 時点。

---

## 0. 決定レコード

| ゲート | 論点 | 決定 |
|---|---|---|
| **D1** | 最初に何を作るか | **背骨**（§2 の 3 手: parser subpath 公開・修飾子語彙等の manifest 収載・位置付き参照インデックス）。新機能ゼロでも**パーサ 3 実装分裂**（§1-1）の返済として単独で正当化でき、以後の全機能の限界費用を下げる。 |
| **D2** | 正本パーサはどれか | **`@wcstack/state` の `bindTextParser` を `./parser` subpath で公開**したものが唯一の正本。vscode-wcs の `parseBindingExpression`（正規表現）と devtools の `declaredScan`（簡易パーサ）は段階的にこれへ寄せる。検討中に提案間で正本指名が割れた論点であり、ここで確定する。 |
| **D3** | 位置情報とエラー耐性 | **正本パーサには足さない**。`parseBindTextsForElement` は位置情報を持たず不正構文で throw する（§2-4）。tolerant パース + 診断 range 生成は **vscode-wcs 側の positional ラッパー**の責務とする（ランタイムのサイズと責務を汚さない）。 |
| **D4** | S 級機能 | ①**ランタイムエラーへの self-fix 誘導埋め込み**（§3、GTM 2-5 の実装）②**配線カバレッジ**（§4、`watchPaths` pull + `state:watch-fired`）。いずれも実測済みの失敗（AI の lint 実行 0/9・PR#157/#160 系の「黙って発火しない」バグ族）への直接対処。 |
| **D5** | 捨てるもの | **rename / LSP 汎用化 / devtools 内 SVG グラフ描画 / 属性文字列リンク**（§7 に理由）。rename は issue が立ったら再検討。 |
| **D6** | グラフのシリアライズ | **内部表現のみ**。公開フォーマット（`wcs-page-graph/1` の類）の凍結は**消費者が現れてから**。mermaid 出力・devtools JSON export は内部表現から吐く。公開契約＝恒久メンテ義務であり、ソロ体制で先行凍結しない。 |
| **D7** | 縮退の原則 | **過小近似の明示**。静的に解決できないもの（動的キー・非リテラル `$resolve`・未定義タグへの spread・bind-component サブパス派生）は `dynamic` / `unexpanded` / `approx` として出力に明示し、unused 系判定は「使用の可能性あり」側に倒す（偽陽性ゼロ優先。[ADR-06](./architecture-hardening/06-path-type-safety.md) の精度哲学に整合）。 |
| **D8** | spread の CLI 側展開 | `expandSpread` は live `Element` + `CustomElementRegistry` 必須（§2-4）のため、**ブラウザ外では builtinTags カタログ（41 タグ）限定**。ユーザー定義 wc-bindable タグ・DCC への spread は `unexpanded` マーク。この coverage 穴は隠さず文書化する。 |
| **D9** | 即果実の扱い | §6 の 3 件（devtools `_ingest` 追随・CLI `fileReader` 配線・builtinTags → VS Code custom data）は背骨と独立に**先行 PR 可**。 |
| **D10** | 効果測定ゲート | unused / project モード・mermaid・`--format=json` 拡充へ進む前に **ai-cold-start-probe の再実行**で「AI が検証ループを回すようになったか」を実測する。 |

---

## 1. 出発点の実測（現状の事実）

### 1-1. パーサは 3 系統に分裂している

| 実装 | 場所 | 性質 |
|---|---|---|
| ランタイム正本 | `packages/state/src/bindTextParser/` | 意味論の正本。非公開（subpath 無し） |
| vscode-wcs | `packages/vscode-wcs/src/service/bindingValidator.ts` の `splitBindingExpressions` / `parseBindingExpression` | 正規表現ベース。エラー耐性 + 診断 range 生成を担う |
| devtools | `packages/devtools/src/core/declaredScan.ts` | 簡易パーサ。冒頭コメントで「bindTextParser 非追随」と**自己申告**＝ドリフトが構造的に仕込まれている |

加えて vscode-wcs の `preamble.ts` は defineState の型を手書き複製しており、state 側 API 追加のたびに手動追随している（PR#136 / #161 で実績）。

### 1-2. 結線モデルはどこにも一級データとして存在しない

vscode-wcs の 30 診断はすべて「軽量パーサ + 宣言カタログの突合」であり、「どの要素がどのパスに配線されているか」のグラフは診断の副産物としても保持されない。devtools の `IWiringEntry` は propName / bindingType / path のみで filters を持たず、filters を持つのは簡易パーサの declared ビュー側だけ。

### 1-3. 静的に決定できる範囲は広い（検討の根拠）

- 端点（要素プロパティ・`attr./style./class.`・イベント）⇔ state パス、フィルタ列と型（`filterMeta` の minArgs/maxArgs/argTypes/resultType）、修飾子、`if/elseif/else/for` 構造、command/event token 結線、spread 対象、bind-component のプライマリ規則 — **結線トポロジーは HTML + 宣言から完全静的**。
- 静的依存グラフそのものが「バインドされたパス + `$watch` キーの親チェーン展開」の純関数（`packages/state/src/components/State.ts:739-751`）であり、**ブラウザ外で同型再構築できる**。`setPathInfo` の呼び出し元は BindingSession / fragment 収集 / `$watch` 宣言の 3 箇所だけで、いずれも入力は宣言文字列。
- 動的にしか決まらないのは「行の具体化（listIndex）」「getter の動的依存」「値」のみ。

### 1-4. 欠けている最低ラインと、眠っている資産

- hover / go-to-definition / rename / inlay hint は**皆無**（provider は completion と diagnostics の 2 つのみ。grep 実測）。全メジャー FW が持つ水準。
- state 側は devtools hook に 14 種のイベントを流しているが、devtools 側 union に `propagation:*` 3 種と `contract:*` 3 種が無く、`DevtoolsCore._ingest`（`packages/devtools/src/core/DevtoolsCore.ts:316-496`、switch に default 無し）で**黙って捨てられている**。
- `statePathResolver.ts` の `fileReader`（外部 state の .json/.ts/.js 解決）は完全実装済みだが、**全呼び出し箇所が渡していないデッドコード**。外部 state のページは「候補ゼロ→検証スキップ」に落ちている。
- `$watch` 宣言は pull API（`IStateElementSummary`）に一切載らず、正常動作中の watch は devtools から観測不能（エラーと深さ打ち切りのみ）。

---

## 2. 背骨（Phase B1）

### 2-1. `@wcstack/state` に `./parser` subpath を追加

`parseBindTextsForElement`（+ 必要な型）を `./manifest` と同じ形で公開する（`packages/state/package.json` の exports に追加。dist 消費パターンは PR#154 で確立済み）。責務は**意味論の正本の一本化**であり、それ以上ではない（D3）。

### 2-2. manifest への欠落収載

`packages/state/src/manifest.ts` は区切り文字（`MODIFIER_SEPARATOR` = `#` 等）は持つが、以下が未収載:

- **修飾子の語彙**: `prevent` / `stop` / `ro` / `init=` / `sync=`（現状コードに散在: `event/handler.ts` / `bindings/initialSync.ts` 等）
- **bindingType の判別規則**（`else` / `...` / `if|elseif|for|radio|checkbox` / `eventToken`・`on*` / prop）
- **`$1..$N` インデックス名**（`define.ts:45-49`）

vscode-wcs の補完・hover・診断はこれらを手書きしているため、収載して正本導出に切り替える（フィルタで実施済みの構図の横展開）。

### 2-3. 位置情報付き参照インデックス（vscode-wcs 側）

`packages/vscode-wcs/src/core/` に「path → 出現 range[]（data-wcs 属性・mustache・コメントバインディング）+ 宣言 span」のインデックスを新設する。宣言側 span（`nameStart`/`nameEnd`/`valueStart`）は `stateAnalyzer.ts:450-553` に既在で、`$watch` 検証が既に消費している。単位は現行アーキテクチャどおり**単一 HTML ファイル閉じ**。

このインデックスが hover / GTD / find-references / unused 診断 / mermaid 出力の共有基盤になる。

### 2-4. 罠（実現性検証で確定した制約）

1. **正本パーサは位置情報ゼロ + 不正構文で throw**（`parseBindTextsForElement.ts:23-25` — `raiseError` に range 無し）。vscode-wcs の正規表現パーサが存在する理由の半分は「エラー耐性 + 診断 range」であり、subpath 公開で消えるのは**意味論の複製だけ**。positional ラッパー（パース結果の原文逆照合。クォート入りフィルタ引数で非自明 — PR#155 のトリム規則に注意）込みで見積もる（S でなく M）。
2. **`expandSpread` は live Element + CustomElementRegistry 必須**（`expandSpread.ts:95-117`: `getCustomElement` → `registry.get` → upgrade）。ブラウザ内（devtools）では正本をそのまま呼べるが、CLI / エディタ側は builtinTags カタログ縮退（D8）。
3. **実行時 DOM では構造 template の中身が `fragmentInfoByUUID` に引き上げられ DOM から消える**。devtools の「root を渡して再スキャン」方式では for/if 内の宣言が拾えない。§5-1 の `getDeclaredBindings` は state 側実装とし、fragment レジストリを列挙する（DOM 再スキャンより正確になる）。
4. `setConfig` で属性名・タグ名は可変（区切り文字は不変宣言済み）。静的解析器は既定値前提を明示し、既存の `--attr` / `--state-tag` フラグで吸収する。

---

## 3. チャネル施策 A: ランタイムエラーへの self-fix 誘導（S 級・背骨と独立）

GTM 2-5 で「lint 実行 0/9 の壁を破る本命」と認定済み・未実装のものを実装する。コンソールは「AI が誤った瞬間に必ず読む唯一の push 型チャネル」であり、人間の DX も同時に上がる。

- **埋め込み内容**: (a) did-you-mean（編集距離 2。`ioNodeValidator.ts` の実装を state 側に小さく複製）(b) 正しい形の一行例 (c) `npx @wcstack/lint` への言及。
- **埋め込み先の raiseError サイト**（実在確認済み): 構造型の単独バインディング違反（`parseBindTextsForElement.ts:100-105`）、`$watch` 宣言検証（`watch/processWatchDeclaration.ts:50-91`）、DCC 宣言検証（`dcc/processDccDeclarations.ts`）、未知フィルタ・eventToken/command/`$on` の宣言不一致（候補が列挙できる did-you-mean の本命サイト）。
  - **訂正（実装時の実読）**: 当初挙げていた wcBindable 重複棄却（`protocol/wcBindableReader.ts`）は **raiseError せず沈黙 null を返す契約**（かつ AUTO-GENERATED の conformance mirror）のため対象外。この「宣言全体が警告なしで丸ごと死ぬ」経路の可視化は別施策（配線カバレッジ §4 側）。
- **lint 誘導の精度原則**（実装時に確立）: `npx @wcstack/lint` への誘導文は **lint が実際にそのケースを検出するサイトにだけ**付ける。検出しないケースに付けると「エラー → lint 実行 → clean」の空振りで generate→validate→fix ループ自体の信頼を毀損する。`wcs/*` code 前置（三面同語彙）は検出可否と独立に付けてよい。lint 未検出のケース（構造型の単独バインディング違反・watch の非オブジェクト形など）は lint 側へ検査を追加してから誘導を戻す。
- **診断 code の共有語彙**: コンソール→lint→IDE の三面で同じ `wcs/xxx` code を表記し、AI がエラー文からそのまま lint の診断に接続できるようにする。
- **制約**: エラーパスのみで文字列構築（正常系ゼロコスト契約に非衝突）。メッセージは `auto.min.js` サイズに乗る。**エラーパス専用モジュールの遅延 import は不可**（`src/auto.ts` は `./exports` 以外を import できない — SRI 自己完結制約、[sri.md](./sri.md)）。文字列は inline に留め、量を絞る。
- 動的キー・`$resolve` 組み立てパスでは候補が出せない → did-you-mean を省略し誘導文のみに縮退。

対の施策（別リポジトリ）: wcstack-skill の手順書に「生成 → `npx @wcstack/lint` → error 修正 → 提示」を MUST として追記し、AGENTS.md 配布スニペット（GTM 1-4）に同文 + 診断 code 早見表を載せる。コード変更ゼロ・数日で「導線欠落」仮説を検証できる。

## 4. S 級: 配線カバレッジ（devtools）— 「宣言したのに黙って死んでいる配線」の検出

宣言（静的）× 実測（動的）の突合。**data-wcs の静的露出だからこそ成立する DX** であり、hook protocol の自己定義「弱い静的検査可能性をランタイム検査可能性で補償する」の直系。PR#160 レビューで発覚した「ワイルドカード行 watch は `for` も `$listKeys` も無いと一度も発火しない」バグは、この機能があれば一目で見えていた。

- **hook への additive 追加は 2 点だけ**（version 不変）:
  1. `IStateElementSummary.watchPaths` — 現状 `$watch` 宣言は pull に載らない（`bridge.ts:137-153`）
  2. `state:watch-fired` イベント（payload: stateName / path のみ、値は載せない）— **[state-watch-hook-design.md](./state-watch-hook-design.md) §11 で第 2 フェーズとして予約済み**。発火点は `watchRuntime.ts` のハンドラ呼び出し直前、既存の `devtoolsSink !== null` パターンでゼロコスト契約充足。
- **突合対象**: 宣言面（declared graph / watchPaths / `$commandTokens`・`$eventTokens`）vs 実測面（binding 台帳・`state:token-emit` の `subscriberCount`（0 = 空撃ち、payload 実在）・watch 発火）。
- **UI**: Wiring ペインに coverage タブ（リスト UI で十分。グラフ描画はしない — D5）。devtools バックログ P2-3-5（token subscriber-0 恒常警告)の上位互換としてバックログも消化。
- **誤警告の回避**: ワイルドカード行 watch は `for` / `$listKeys` が発火前提（watch 設計 §6-3）→「未発火」でなく「**前提未成立**」と区別表示。mapped 子スコープは `$watch` 宣言不可のため対象外。遅延アタッチでは binding 台帳の過去が再構成不能（protocol §6）→「観測開始: HH:MM 以降」を常時表示。

## 5. 換金面（A 級・背骨後）

### 5-1. devtools declared ビューの正本化

`IDevtoolsSource` に `getDeclaredBindings(root?)` を additive 追加し、state 側が自身の `parseBindTextsForElement` + `expandSpread` で答える（パーサ複製ゼロ・ブラウザ内なので spread も完全展開・fragment レジストリ列挙で template 内も拾える）。declaredScan の構造的ドリフトを恒久解消し、§4 カバレッジの宣言側前提になる。「declared ビューは表示専用」の線は維持。

### 5-2. hover + inlay hint

- パス hover:「解決先パス・種別（data/computed/list 行）・型・宣言位置」。フィルタ hover: filterMeta の description + シグネチャ + チェーン適用後の型。修飾子 hover: 意味説明（§2-2 の manifest 収載が前提）。wcs-* タグの prop hover: wcBindable 由来の semantics。
- inlay: for 内短縮パス `.name` の後ろに `=users.*.name` を淡色表示。**ランタイムは実際に属性文字列をこの形へ書き換える**（`expandShorthandPaths.ts` の DOM 変形と同一規則）ため「コンパイル結果の開示」として正確 — buildless ゆえコンパイル出力を見る手段が無い弱点を埋める唯一の面。フィルタ鎖末尾に `→ string`、spread に `→ N props`。
- 解決不能なら出さない（誤 hint ゼロ原則)。computed は「型不明（computed）」、外部 state は「外部定義（解析対象外）」と明示して沈黙しない。

### 5-3. go-to-definition + find-references

data-wcs / `{{ }}` / コメントバインディングのパス ⇔ state 宣言の相互ジャンプ。属性文字列 = 実行時識別子なのでソースマップ不要（他 FW に無い実装優位）。`@state` 越境は同一 HTML 内の `<wcs-state name=>` 突合で解決。外部 state は `<wcs-state src=>` タグへのフォールバックジャンプ。

### 5-4. `--format=json` + fix 候補付き診断

`runValidation` は構造化済み（formatter は小工数）。各 validator に `fix?: {candidates, reason}` を additive に付与（材料は filterMeta・パス候補集合・token 宣言 — 全て既存突合データで新規解析ゼロ）。外部 state 由来の未解決 warning は `confidence: "unresolved"` を明示し、**AI が未解決 warning を「修正」して壊す過剰修正を構造的に抑止**する。既定テキスト出力・exit code は不変（CLI 契約維持）。単体では効かない（0/9 の教訓）ため §3 の誘導とセットで出す。

## 6. 即果実（背骨と独立・先行 PR 可、全て S 工数）

1. **devtools `_ingest` の追随**: `DevtoolsEventLike` union に `propagation:suppressed/coalesced/hop-limit` + `contract:*` を追加し Timeline 行 4 種を足す。プロトコル変更ゼロ・100 行未満で、state が既に流している計装が可視化される（「state 14 種 emit vs devtools 8 種消費」の解消）。
2. **CLI への `fileReader` 配線**: `cli.ts` に `readFileSync` ベースの reader を渡すだけで、外部 state（`src=`）ページの `binding-path-missing` が「検証スキップ」から実検査に変わる。resolver は完成品が眠っている（§1-4）。
3. **builtinTags → VS Code custom data / web-types 生成**: `emit-builtin-tags.mjs` に出力フォーマットを追加するだけで、拡張なしの全エディタ（AI エディタ含む）に wcs-* タグの属性補完 + hover が届く。CEM 出荷（44 パッケージ配線が必要な M 案件）の 8 割を先取り。

## 7. やらないこと（理由付き）

| 案 | 捨てる理由 |
|---|---|
| **rename（パス一括改名）** | TS の rename が追えるのは素の `this.x` ドットアクセスのみ。`this["users.*.name"]` ブラケット参照は preamble の `_WcsPaths<T>` 合成型経由で**宣言位置まで遡れない**ため、実態は正規表現一括置換 = 唯一「ユーザーのファイルを書き換える」形で精度リスクが顕在化する。需要シグナル（issue）が立つまで封印。 |
| **`@wcstack/language-server` 汎用化** | `server.ts` は typescript + Volar 5 パッケージが runtime dependencies で、lint の「148KB 自己完結ラッパー」パターンは複製不能（typescript 同梱で数十 MB か zero-dep 放棄の二択）。しかも Cursor / Windsurf は VS Code 拡張をそのまま実行でき主要 AI エディタには既到達。残る聴衆に対しエディタ別検証・バグ対応の恒久コストが見合わない。 |
| **devtools 内 SVG グラフ描画** | ゼロ依存 vanilla DOM での有向グラフ自動レイアウト自作が隠れ L。機能価値は Wiring ペインのリスト + declared/connected バッジで出る。「絵」の役割は mermaid 静的出力（`wcs-validate graph --format=mermaid`、背骨後 S）に寄せる。 |
| **属性文字列リンク（devtools → エディタ）** | 文字列コピー + workspace 検索で今日できることの自動化 = ガジェット。 |
| **公開グラフフォーマットの凍結** | D6。内部表現で全消費者が賄える。 |
| **因果レンズ**（write → 依存閉包 → バッチ → DOM ハイライト） | 捨てない**が棚上げ**。唯一どの FW も持たない本命候補である一方 L 工数で、「今誰が困っているか」に答えられない。背骨 + カバレッジの資産が揃った後に再挙証。 |

## 8. フェーズ計画（PR 分割）

並行 2 トラック。互いの成否を待たない（どちらも単独で正当化済み）。

| Phase | 内容 | 依存 |
|---|---|---|
| **A1** | wcstack-skill へ検証ループ MUST 追記 + AGENTS.md スニペット（別リポジトリ） | なし |
| **A2** | ランタイムエラー self-fix 誘導（§3） | なし |
| **B0** | 即果実 3 件（§6、それぞれ独立 PR） | なし |
| **B1** | 背骨: `./parser` subpath + manifest 収載 + positional ラッパー + 参照インデックス（§2） | なし |
| **B2** | declared 正本化（§5-1）+ 配線カバレッジ（§4） | B1（カバレッジの宣言面）。watchPaths/watch-fired は独立可 |
| **B3** | hover + inlay（§5-2）→ GTD + references（§5-3） | B1 |
| **B4** | `--format=json` + fix 候補（§5-4） | A2 とセットで効果が出る |
| **測定** | ai-cold-start-probe 再実行（D10） | A1/A2/B4 後 |
| **B5** | unused 診断・project モード・mermaid 出力 | B1 + 測定結果 |
| **別トラック** | CEM 出荷（`wcstack:bindable` 拡張フィールド付き） | release workflow への生成組込と抱き合わせ |

## 9. 追随先と地雷

**追随先**（変更時に同期が必要な箇所）:

- `packages/lint/dist`（tracked）— vscode-wcs 再ビルド + コピーが必要（`packages/lint/scripts/build.mjs`）
- `builtinTags.generated.ts` — 手動 `npm run emit:builtin-tags`（各パッケージ dist ビルド前提）。custom data / CEM 出力を足す場合は release workflow への組込を同時に行う
- `preamble.ts` — state API 追加時の手書き追随（背骨で解消するのは data-wcs 側のみ。TS 型投影は残る）
- wcstack-skill リポジトリの references — 構文・診断の変更時

**踏んではいけない既存規範**（検討時に全提案へ適用済み。実装時も維持）:

- buildless を必須化しない / HTML の完全型検査は非目標（ADR-06）
- 動的パスは `unknown` = info 止まり、error にしない（[wcstack-manifest-schema.md](./wcstack-manifest-schema.md)）
- sidecar / ツーリング情報はランタイム正しさの入力に昇格しない（同 Invariant）
- hook detached 時ゼロコスト（null チェック 1 個）/ get トレース・タイムトラベルはやらない（hook protocol §1, §4.6）
- 診断 code は公開後不変・追加のみ / CLI のオプション・出力・exit code は不変
- `data-wcs` は配線であって DSL ではない — 本設計は**構文追加ゼロ**（全機能が既存宣言の読み取りのみ）
