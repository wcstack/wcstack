# wcs/array-mutation 診断 — 設計＆実装計画

`<wcs-state>` インラインスクリプト内の「配列への破壊的操作」を静的検出する新診断の設計文書。
バリデータコア（`packages/vscode-wcs`）に実装し、VS Code 拡張と `@wcstack/lint` CLI（`wcs-validate`）の
両方に同時に反映される（`validateDocument` 単一入口による IDE / CLI parity 構造保証）。

- ステータス: 実装済み・Phase 4 敵対的レビュー反映済み（§9 に記録）
- 作成日: 2026-07-24 / 最終改訂: 2026-07-24（Phase 4 レビュー後の §3/§4/§5/§6 改訂）
- 先行例: `wcs/nested-assign`（`src/service/nestedAssignValidator.ts`）— 同型の非リアクティブ footgun 検出。
  Phase 4 で本診断と正規表現部品を共有する形（`service/scriptPatterns.ts`）に統合し、
  複合代入・インクリメント・式添字へ同時拡張した

---

## 1. 背景と目的

`@wcstack/state` のリアクティビティは Proxy の set トラップ（プロパティ代入）でのみ発火する。
`push` 等の破壊的メソッドやインデックス代入は Proxy を素通りするため（get は生配列を返す —
`getByAddress` は生値を返す）、**DOM がサイレントに更新されない**。これは AI の
generate–validate–fix ループでも人間の手書きでも頻出の footgun だが、既存診断
（`wcs/nested-assign` はネストされた**ドットアクセス代入**のみ）はカバーしていない。

本診断はこのギャップを静的検出で埋める。

## 2. 設計判断の記録（2026-07-24 確定）

| # | 論点 | 決定 |
|---|---|---|
| A-1 | 検出対象メソッド | 破壊的メソッド 9 種で確定: `push` / `pop` / `shift` / `unshift` / `splice` / `sort` / `reverse` / `fill` / `copyWithin` |
| A-2 | `this.items.length = 0` | **現状維持**（既存の `wcs/nested-assign` が拾う。新診断には含めない） |
| A-3 | インデックス代入 `this.items[0] = x` | **スコープに含める**（nestedAssignValidator が意図的にスキップしている bracket-only チェーンを新診断で拾う） |
| A-4 | getter（computed）絡み | **全て NG**。computed パスへの破壊的呼び出し（`this.sortedItems.push(...)`）も、getter 本体内の破壊的呼び出し（`return this.items.sort(...)` — 読み取り中の状態変異）も警告する。純構文検出（B）ではデータパス / computed パスを区別しないため、実装上は自然に両方カバーされる |
| B | 検出方式 | **案 1: 純構文検出**（`this.<パス>.<破壊的メソッド>(` を機械的に検出、`$` プレフィックスパスはスキップ）。stateAnalyzer の型突合はしない。コアの明文方針「完全な精度は求めず軽量高速」（nestedAssignValidator と同じ精度哲学）に整合 |
| C | 変異＋自己再代入イディオム | **検証を先に実行**（§3）。結果: 長さが変わる操作は自己再代入でも壊れる → **無条件警告**が正当と確定 |
| D | エイリアス経由の変異 | 検出不能な false negative として本文書 §6 に明記して割り切る（正規表現では追跡不能、nested-assign と同じ判断） |
| E | severity / コード名 | **warning**（nested-assign と同格・一貫）。メソッド別に非破壊代替をメッセージで提示。ja/en カタログ |
| F | 実装配置 | 新規 `service/arrayMutationValidator.ts`（1 カテゴリ = 1 ファイルの既存パターン）。VS Code quick-fix（自動書換）は**後続フェーズに分離**（診断のみ先行） |
| G | 抑制手段 | 既存診断に抑制機構が無いため v1 は無しで一貫 |

## 3. 動的検証結果（設計凍結前検証、2026-07-24 実施）

`packages/state` の vitest（happy-dom）で `for: items` レンダリングに対する各操作を実測した
（一時テストファイル、実測後に削除済み）。テンプレートは
`<template data-wcs="for: items"><li data-wcs="textContent: .v"></li></template>`、
初期値は `[{v:1},{v:2}]` 等。

| # | 操作 | 結果 | 判定 |
|---|---|---|---|
| V1 | `push` 単体（再代入なし） | `["1","2"]` のまま | **更新されない**（前提確認） |
| V2 | `push` ＋ 自己再代入（同一参照） | `["1","2"]` のまま — **行が追加されない** | **壊れる** |
| V3 | `sort` ＋ 自己再代入（同一参照） | `["1","2","3"]` に並び替え反映 | 動く（長さ不変のため全行展開フォールバックが効く） |
| V4 | `splice`（行削除）＋ 自己再代入 | `["1","3","3"]` — **削除が反映されず表示破壊**。さらに内部で uncaught `TypeError: Reflect.get called on non-object`（`getByAddress.ts:98`） | **壊れる＋内部例外** |
| V5 | インデックス代入 `s.items[0] = {v:9}` 単体 | `["1","2"]` のまま | **更新されない**（A-3 の根拠） |
| V6 | 対照: ドットパス代入 `s["items.0"] = {v:9}` | `["9","2"]` | 正しく更新（推奨形） |
| V7 | 対照: `s.items = s.items.toSorted(...)` | `["1","2","3"]` | 正しく更新（推奨形） |
| V8 | 複合代入 `s.items[0] += 1`（`textContent: items.0` バインド） | 表示 `"1"` のまま | **更新されない**（Phase 4 拡張の根拠） |
| V9 | インクリメント `s.items[0]++` | 表示 `"1"` のまま | **更新されない**（同上） |
| V10 | `s["items.0"] += 1`（`for` なし・直バインド構成） | get トラップが `ListIndex not found: items` を throw | ループコンテキスト外の数値解決済みパス **read は不可** |
| V11 | `s["items.0"] = s.items[0] + 1`（同構成） | set トラップが同じく throw | `for` 未確立の構成では数値パス **write も不可**（V6 は `for` あり構成で成功） |

**結論**: 「変異＋自己再代入」は長さ不変の値リフレッシュ（V3、および
`integration.diffExpansion.test.ts` の契約テスト「同一参照の再代入は in-place 変異後の
リフレッシュとして機能すること」= 行オブジェクトのフィールド変異）に限って動くが、
**長さが変わる操作（push / splice 等）では自己再代入をしても表示が壊れ、内部例外まで出る**。
正規表現で「後続の自己再代入の有無」「長さが変わるか」を文脈追跡することは不可能かつ、
安全なケースの方が例外的であるため、**破壊的メソッド呼び出しは無条件で警告する**。
メッセージは「リアクティブ更新をトリガーしない」と断定してよい（V1/V2/V4 で実証済み）。

> 補足（本診断のスコープ外・ランタイム側への申し送り）:
> ① V4 の uncaught 例外（`applyChange` → `getByAddress` で stale アドレス参照）は
> ランタイム側の頑健性課題。既知の据置項目「applyChangeToFor 矛盾」と関連する可能性がある。
> ② V10/V11 の観測より、数値解決済みパス（`items.0`）の read/write は `for` レンダリングで
> ListIndex が確立している構成でのみ動く。診断メッセージが提示する 2 代替のうち
> `with()` ＋再代入が普遍的に安全で、ドットパス代入はリスト描画コンテキスト前提。

## 4. 診断仕様

### 4.1 診断コード（`core/diagnostics.ts` に追加）

```ts
// --- <wcs-state> script: array reactivity hazards ---（概形。実コメントは実装を正とする）
// 配列破壊的メソッド呼び出し(9種)。Proxy を素通りしリアクティブ更新されない(V1/V2/V4 実証)。
ArrayMutation: "wcs/array-mutation",
// 配列インデックスへの代入(単純・複合・++/--)。同上(V5/V8/V9 実証)。正はドットパス代入(V6)。
ArrayIndexAssign: "wcs/array-index-assign",
```

2 コードに分ける理由: 修正方法（quick-fix の将来形）と提示すべき代替がメソッド呼び出しと
代入で本質的に異なるため。コード文字列は公開後不変（追加は自由）の既存規約に従う。

### 4.2 severity / range / 付帯フィールド

- severity: **warning**（両コードとも）
- range: 生ソース文字オフセット
  - `wcs/array-mutation`: `this` の先頭〜メソッド名末尾（`(` は含めない）
  - `wcs/array-index-assign`: マッチ全体 — 代入演算子の末尾まで（右辺は含まない。
    複合代入は演算子込み、`++`/`--` は演算子末尾まで。前置形は演算子先頭から）
- `statePath`: 導出したドットパス（例: `items`、`items.*.tags`）を設定する
  （`WcsDiagnostic` の既存 optional フィールド活用）

### 4.3 メッセージ（`core/messages.ts` に ja/en 追加）

カタログ関数（メソッド別代替のマップは validator 側に持ち、整形済み文字列を渡す）:

```ts
// --- arrayMutationValidator ---
arrayMutation(method: string, alternative: string): string;
arrayIndexAssign(suggestedPath: string): string;
```

- ja `arrayMutation`:
  `配列の破壊的メソッド "${method}" はリアクティブ更新をトリガーしません（同一参照の自己再代入でも要素の追加・削除は反映されません）。非破壊メソッドと再代入を使用してください（例: ${alternative}）。`
- en `arrayMutation`:
  `Destructive array method "${method}" does not trigger a reactive update (re-assigning the same reference does not reflect added/removed elements either). Use a non-destructive method with reassignment (e.g. ${alternative}).`
- ja `arrayIndexAssign`:
  `配列インデックスへの直接代入はリアクティブ更新をトリガーしません。this["${suggestedPath}"] のようなドットパス代入、または with() と再代入を使用してください。`
- en `arrayIndexAssign`:
  `Assigning directly to an array index does not trigger a reactive update. Use a dot-path assignment like this["${suggestedPath}"], or with() plus reassignment.`

メソッド別代替マップ（validator 内の定数、`<path>` は検出パスを埋め込む）:

| method | alternative 例 |
|---|---|
| `push` | `this.<path> = this.<path>.concat(item)` |
| `unshift` | `this.<path> = [item, ...this.<path>]` |
| `pop` | `this.<path> = this.<path>.slice(0, -1)` |
| `shift` | `this.<path> = this.<path>.slice(1)` |
| `splice` | `this.<path> = this.<path>.toSpliced(...)` |
| `sort` | `this.<path> = this.<path>.toSorted(...)` |
| `reverse` | `this.<path> = this.<path>.toReversed()` |
| `fill` | `this.<path> = this.<path>.map(...)` |
| `copyWithin` | `this.<path> = this.<path>.map(...)` |

（`fill` は範囲充填のため単一置換の `with()` は等価でなく `map(...)` を提示する — Phase 4 指摘で訂正）

## 5. 検出仕様

対象は `parseWcsScriptBlocks`（`language/htmlParse.ts`）が返す `<wcs-state>` スクリプト
ブロック内。文脈（イベントハンドラ / getter 本体 / トップレベル）は区別しない（A-4）。

共有正規表現部品は `src/service/scriptPatterns.ts` に置き、nestedAssignValidator と共用する
（Phase 4 改訂）。共通字句: 識別子は `$` 含み ASCII（`[\w$]+`、ルートの `$` 始まりは API
名前空間としてスキップ）。トークン間の空白・改行と optional chaining（`?.` / `?.[`）を許容。
添字は quoted string 始まり以外の任意の式（ネスト bracket なし）—
`[0]` / `[i]` / `[this.items.length]` / `[i + 1]` を含む。

### 5.1 パターン M — 破壊的メソッド呼び出し（`wcs/array-mutation`）

検出する形（概形。正確な定義は `scriptPatterns.ts` + `arrayMutationValidator.ts` を正とする）:

```
this.<prop> (.<prop> | [<式添字>])* . <9メソッドのいずれか> (?= \s* ( )
this["<dotted.path>"] (.<prop> | [<式添字>])* . <9メソッドのいずれか> (?= \s* ( )
```

- bracket ルート形 `this["items"].push(...)` / ワイルドカードパス形
  `this["items.*.tags"].push(...)` も対象（後者は `statePath` にワイルドカードパスを設定）
- computed（getter）パスもデータパスと同一に扱う（A-4）

### 5.2 パターン I — インデックス代入（`wcs/array-index-assign`）

検出する形（Phase 4 で複合代入・`++`/`--`・bracket ルート・式添字へ拡張）:

```
this.<prop> ([<式添字>])+ \s* ( <複合演算子>? = | ++ | -- )     … 後置形
this["<dotted.path>"] ([<式添字>])+ \s* ( <複合演算子>? = | ++ | -- )
(++ | --) \s* this.<prop> ([<式添字>])+                         … 前置形
(++ | --) \s* this["<dotted.path>"] ([<式添字>])+
```

- 複合演算子 = `+ - * / % ** << >> >>> & | ^ && || ??`（つまり `+=` `??=` `>>=` 等の
  複合代入 15 種）。V8/V9 で単純代入と同じくサイレント no-op であることを実証済み
- **bracket-only チェーン限定**。チェーンに（添字式の内部を除いて）ドットアクセスが
  1 つでも含まれるもの（`this.items[0].name = x`）は `wcs/nested-assign` の担当であり、
  本診断は発火しない（二重報告禁止。境界判定は共有の `hasDotSegment()` で、
  nested-assign 側は「ドットセグメントあり」のみ発火する相補実装）
- `suggestedPath` は添字が数値リテラルなら `items.0` 形式、識別子・式なら
  `items.<i>` / `items.<this.items.length>` の形で提示
- `==` / `===` / `!=` / `!==` / `>=` / `<=` は代入ではないため除外
  （演算子部がどの選択肢にも一致しない構造で保証、`=` は `(?!=)` lookahead）

### 5.3 発火しないことを保証する形（誤検出ガード）

- `const a = [...this.items]; a.push(x); this.items = a;` — 正当イディオム。
  `this.` 直呼びのみ検出するため `a.push` はヒットしない
- `this.items = this.items.toSorted(...)` — 非破壊メソッドは対象外
- `this.items.slice().sort(...)` — コピーしてからの破壊的呼び出し（チェーンは `()` を跨げない）
- `this["items.0"] = x` — 正しいドットパス代入（bracket 内が quoted string のため対象外）
- `this.obj["key"] = x` / `this.items["0"].push(...)` — quoted キーは対象外（§6）
- `this.$getAll("items.*.p", []).push(...)` / `this["$streams"][0] = x` — `$` ルートはスキップ
- 比較演算子（`==` `===` `!=` `!==` `>=` `<=`）は発火しない

## 6. 既知の限界（ドキュメント化して割り切る）

1. **エイリアス経由は検出不能**（false negative）: `const a = this.items; a.push(x);`。
   正規表現では追跡できない。nested-assign と同じ割り切り
2. **文字列リテラル・コメント内のコード片に誤反応しうる**（false positive）:
   `// this.items.push(x) はダメ` のようなコメントにもヒットする。nested-assign と共通の既知限界
3. **ユーザー定義オブジェクトの独自 `push` 等メソッド**（稀）は誤検出になる
4. `this.obj["key"] = x` / `this.items["0"].push(...)`（quoted string キー）は対象外
   （nested-assign も対象外。現状踏襲）
5. 長さ不変の「変異＋自己再代入」リフレッシュ（V3 相当）も警告される。これは**意図的**:
   長さが変わるケース（V2/V4）と静的に区別できず、公式推奨イディオムは常に非破壊＋再代入
   であるため。既存契約テストのリフレッシュイディオム（行オブジェクトのフィールド変異）は
   破壊的**メソッド**を使わないため本診断にはヒットしない
6. **添字式内のネスト bracket は検出不能**（false negative）: `this.items[this.idx[0]] = x`。
   添字は「bracket を含まない式」まで（Phase 4 拡張の範囲）
7. **分割代入・間接呼び出しは対象外**（false negative）: `[this.items[0]] = [x]`、
   `this.items.push.apply(this.items, ...)`。実コードでの頻度が低く割り切り
8. **Unicode 識別子**（`this.項目一覧.push(...)`）は検出不能。識別子字句が `\w` ベース
   （ASCII）のため。stateAnalyzer / nested-assign 含む族全体の共通限界であり、
   直すなら族一括（バックログ）
9. **オブジェクトの動的キー代入**（`this.map[key] = v`）も本診断が拾う。挙動としては
   正しい検出（生オブジェクトへの書き込みも非リアクティブ）だが、メッセージ文言は
   配列を主語にしている
10. **パーサ層の既知課題**（`htmlParse.ts` 起因、全 script 系診断に共通・据置）:
    ① HTML コメント内に `</wcs-state>` があると要素範囲が切断され後続スクリプトが
    未検証になる（`findCloseTag` がコメント非対応）
    ② 属性値内の `<script type=module>...</script>` 文字列を実ブロックとして誤抽出する
    （文脈無視スキャン起因の false positive）。
    なお `type` 属性値の大文字小文字区別は Phase 4 で修正済み（ASCII case-insensitive 化）

## 7. 実装計画

### Phase 1 — バリデータコア（packages/vscode-wcs）

| 作業 | ファイル |
|---|---|
| 1. 診断コード 2 種追加 | `src/core/diagnostics.ts` |
| 2. メッセージ関数 2 種 ja/en 追加 | `src/core/messages.ts` |
| 3. validator 新規作成（§5 の検出仕様。**code 付き `WcsDiagnostic[]` を返す**— 2 コードを持つため、単一カテゴリ validator の「集約時 code 付与」ではなく bindingValidator と同じ「validator 側で code 付与」方式） | `src/service/arrayMutationValidator.ts`（新規） |
| 4. 単一入口へ登録（`out.push(...validateArrayMutations(text, stateTagName, locale))`） | `src/core/validateDocument.ts` |

### Phase 2 — テスト（packages/vscode-wcs/__tests__）

新規 `arrayMutationValidator.test.ts`（記述は日本語、カバレッジ 100/97 基準維持）。最低限のケース:

- 9 メソッド各々の検出（code / range / severity / statePath / メッセージ内の代替提示）
- bracket ルート形・ワイルドカードパス形・チェーン形（`this.a.b.push`）の検出
- getter 本体内の破壊的呼び出しの検出（A-4）
- インデックス代入: リテラル添字 / 識別子添字 / 多重添字（`[0][1]`）
- **nested-assign との境界**: `this.items[0].name = x` → nested-assign のみ /
  `this.items[0] = x` → array-index-assign のみ（同一入力で二重報告が無いことを
  `validateDocument` 経由で確認）
- 誤検出ガード（§5.3 の 4 形が発火しないこと）
- `$` プレフィックススキップ、比較演算子除外
- 複数 `<wcs-state>` ブロック・`baseOffset` の正しさ（オフセットずれ検証)
- ja / en 両ロケールのメッセージ（arrayMutationValidator.test.ts 内の自前 locale テストで担保。
  ※Phase 4 訂正: `messagesLocale.test.ts` にキー網羅型のカタログテストは存在しない —
  同ファイルは抜き取り検査のみ）

既存全テスト green（vscode-wcs、退行なし）を確認。

### Phase 3 — 配布・ドキュメント

- `packages/lint`: コア同梱のためリビルドのみで追従。`scripts/smoke-test.mjs` に
  新コードの検出 1 ケースを追加（CLI 経路の煙確認）
- `packages/vscode-wcs/CHANGELOG.md` に追記
- wcstack-skill リポジトリ（別リポジトリ）: 非破壊イディオムの説明と診断コードの整合を確認、
  必要なら追記（フォローアップ扱い）

### Phase 4 — レビュー・品質サイクル

プロジェクト既定の敵対的レビュー込み検証パス（反証・一次資料照合・動的再現・修正の再レビュー）。
特に §5.3 の誤検出ガードと nested-assign 境界の相補性は動的に再確認する。

### 後続フェーズ（本計画のスコープ外）

- VS Code quick-fix（`push(x)` → `concat(x)` 自動書換 code action）— F の決定によりフェーズ分離
- ランタイム側: V4 の uncaught 例外（§3 補足）の調査

## 8. 受け入れ基準

1. §5 の検出対象が ja / en 両ロケールで期待どおりの code / range / severity / statePath を返す
2. §5.3 の誤検出ガード各形が発火しない
3. `wcs/nested-assign` との二重報告が無い（境界の相補性がテストで固定されている）
4. vscode-wcs の既存テスト全 green、カバレッジ閾値（100/97/100/100 基準）維持
5. `wcs-validate` CLI（packages/lint smoke test）で新コードが観測できる
6. 診断は warning のため CLI の exit code 契約（error のみ 1）に変化が無いこと

## 9. Phase 4 敵対的レビュー記録（2026-07-24）

初回実装（commit 532f6cc、テスト 38 本・全 349 green・smoke 7/7）に対し、
独立レビュアー 2 系統（実装反証 / 設計 doc 照合＋テスト変異分析）＋複合代入の
ランタイム検証（V8-V11）を実施した。

### 修正した指摘（本 doc の §3/§4/§5/§6 は修正後の姿）

| 指摘 | 対応 |
|---|---|
| 式添字が両バリデータとも素通り（`this.items[this.items.length] = x` の append 定番形を含む） | 添字を「quoted 以外の任意の式（ネスト bracket なし）」へ拡張（§5 冒頭） |
| bracket ルートの代入形の非対称（呼び出しは対応・代入は未対応） | `this["items"][0] = x` 形を追加（§5.2） |
| optional chaining（`?.`）・改行/空白折返しチェーンが FN | 全パターンでトークン間空白と `?.` を許容 |
| 複合代入 `+=` 等 15 種・`++`/`--`（前置後置）が未検出 | V8/V9 で非リアクティブを実証の上、検出対象へ追加（§5.2）。nested-assign にも同拡張 |
| `$` 含み識別子（`items$` / `.$list`）が FN | 識別子を `[\w$]+` へ。ルート `$` スキップは明示化（quoted ルート含む） |
| `fill` の代替提示が意味的に不正確（`with()` は単一置換） | `map(...)` へ訂正（§4.3） |
| htmlParse の `type` 属性値が case-sensitive 比較（`type="Module"` のブロックを丸ごとスキップ） | ASCII case-insensitive 化（module / application/json 3 箇所）＋テスト追加 |
| ja `arrayMutation` 文言の doc 乖離（「同一参照の」） | doc 側を実装に合わせて訂正（§4.3） |
| テスト変異ギャップ: 代替文言 7 メソッド無担保 / bracket ルート range 無担保 / `stateTagName` 未実効 / メッセージ全文未固定 / `push (x)` 空白形未固定 | それぞれ assert 追加（arrayMutation 38 → 62 本・nested 8 → 15 本・htmlParse +1、パッケージ全体 349 → 380 本） |
| smoke-test ヘッダの「276本」stale | 本数を書かない表現へ修正 |
| doc §7 Phase 2 の「messagesLocale カタログ網羅テスト」記載が事実と不一致 | doc 訂正（該当テストは存在しない） |

nested-assign の拡張は既存挙動を保存する（プレーン `=` の range は byte 単位で不変、
既存テスト全 green）。識別子添字の提示パスは `a.i.b`（誤解を招く旧形）から
`a.<i>.b`（動的添字マーカー、本診断と同一表記）へ統一した。

### 据置と判断した指摘（§6 に記載）

- パーサ層: コメント内 `</wcs-state>` による範囲切断・属性値内 `<script>` 誤抽出
  （`findCloseTag` / スキャナの文脈対応が必要。全 script 系診断共通の既存課題）
- Unicode 識別子（族全体の `\w` 依存。直すなら族一括）
- 分割代入・`.push.apply` 形・添字式内ネスト bracket（頻度低）

### レビューでクリーンと確認されたクラス

lastIndex 再利用・catastrophic backtracking（500KB 病的入力で CLI 全体 115ms）・
nested-assign との二重報告（構造的に両立不能）・オフセット/CRLF・安定ソート契約・
配布バンドル整合（dist/cli.cjs に両コード転写済み）・IDE 経路
（server.ts → wcsCompletionPlugin.provideDiagnostics → validateDocument の配線確認済み）。
