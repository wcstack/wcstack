# 設計メモ: `@wcstack/form`（`<wcs-form>`）— フォームの一級サポート

- **状態**: 設計ノート（未実装・未採択）。2026-09-06 の外部レビュー「フォームの一級サポートが無い — Constraint Validation API の宣言的露出、dirty/touched、FormData の一括 state 化が無く、CRUD デモが全部手書きハンドラになっている」への回答。実装に入る前に §6 の未決事項を決める
- **対象 WebAPI**: Constraint Validation API（`checkValidity()` / `reportValidity()` / `validity` / `validationMessage` / `setCustomValidity()`）、`FormData`、`HTMLFormElement.elements` / `requestSubmit()` / `reset()`、`submit` / `input` / `change` / `focusout` / `reset` イベント
- **位置づけ**: I/O ノード（Core + Shell、`wc-bindable`）。`intersection` / `resize` と同じ「要素を `observe(target)` で受け取る監視ノード」の系譜。既存 25+ ノードの中で**プラットフォーム API ではなくフォームという文書構造を包む初のノード**であり、Gate 1 の境界例（§2）
- **前提規範**: [feedback: data-wcs は配線であって DSL ではない](../CLAUDE.md) — 端点指定と線上変換だけを許し、計算は state かノードへ押し出す。本ノードの存在理由は、フォームの「計算」（妥当性の集約・値の収集・変更追跡）を `data-wcs` にも state にも書かせず、**ノードが引き受ける**ことにある

---

## 0. 今できること・できないこと

| 要求 | 既存手段 | 足りないもの |
|---|---|---|
| 入力 ↔ state の同期 | `value:` / `checked:` / `radio:` / `checkbox:` の双方向バインド（自動有効） | — |
| 送信の横取り | `onsubmit#prevent: save` | — |
| 複数入力を 1 オブジェクトで保存・復元 | storage README の**アクセサペア**（`get formSnapshot()` / `set formSnapshot(v)`）＋ `value#init=element`（PR#245） | 入力ごとに getter/setter へ列挙する手書きが残る |
| 妥当性（`required` / `pattern` / `min` …） | ブラウザのネイティブ検証（送信時にバブル表示） | **state から見えない**。`valid` で送信ボタンを無効化する、メッセージを自分の場所に描く、が書けない |
| dirty / touched | 無し | 「変更があるときだけ保存を出す」「触った項目だけエラーを出す」が書けない |
| `FormData` の一括取得 | 無し（手書きハンドラで `new FormData(form)`） | CRUD デモが全部手書きハンドラになっている直接の理由 |

方向は 2 つあった。**(A)** `data-wcs` にフォーム語彙を足す（`valid: isValid` を `<input>` に書く等）、**(B)** フォームを包む I/O ノードを 1 つ足す。(A) は「端点指定と線上変換のみ」の規範を破る — `validity.valueMissing` の**集約**は計算であり、要素 1 つの端点では表現できない。よって **(B)** を採る。state 側は結果を**読む**だけ、規則（`required` / `pattern`）は HTML 属性のまま、という分担になる。

---

## 1. 存在意義

- **妥当性が state になる**: `<button data-wcs="disabled: form.valid|not">`、`<p data-wcs="textContent: form.messages.email">`。ネイティブ検証の結果を、ネイティブの規則のまま、自分のマークアップで描ける
- **FormData が 1 本の線で state になる**: `data-wcs="values: draft"` の 1 行で、入力ごとのバインドを列挙せずに、送信・保存・復元（storage との合流）が書ける
- **手書きハンドラの消滅**: `packages/fetch/examples/users-crud` の `onsubmit` ハンドラは「値を集めて fetch を蹴る」だけ — `values` と `command.fetch` の配線に置き換わる
- **既存資産との整合**: 規則は HTML、結果は state、表示は `data-wcs`。フレームワーク的なフォームライブラリ（スキーマ・バリデータ DSL）を持ち込まない

---

## 2. 3 ゲート判定（[io-node-candidate-screening.md](./io-node-candidate-screening.md) §1）

| Gate | 判定 | 根拠 |
|---|---|---|
| **1 — Core が DOM 非依存で書けるか** | **△（境界例・許容）** | Core はフォーム要素を `observe(form)` の引数で受け取る（intersection / resize の先例）。読むのは `elements` / `checkValidity()` / `FormData` という**公開 API 面**であり、レイアウト計算などの内部構造には依存しない。ただし「要素の子孫（コントロール）を列挙する」点で先例より一段深く、Core の単体テストは happy-dom のフォーム実装に乗る（§7） |
| **2 — 1 イベント＋派生 getter** | **✅** | 単一イベント `wcs-form:change` の detail にスナップショット `{ valid, values, validity, messages, dirty, touched }` を載せ、各プロパティは getter で分派する（network / router と同型） |
| **3 — never-throw / `_gen` / 冪等 observe** | **✅** | 監視は `input` / `change` / `focusout` / `reset` / `submit` のリスナー登録で、`observe()` 再呼び出しは前の登録を外してから張る。`FormData` 生成・`checkValidity()` は try/catch で包み、失敗は `error` に落とす |

「observable surface が薄すぎる」懸念（§4 の一発コマンド）には当たらない — 状態（妥当性・値・変更）が主で、コマンドは従。

---

## 3. 表面（wcBindable）

### 3.1 監視対象の指定

`intersection` の 3 系統（self / selector / child）のうち、フォームでは **child**（包む）を既定、**target セレクタ**を代替とする。self は意味を持たない（`<wcs-form>` 自身はフォームではない）。

```html
<!-- 既定: 直下の <form> を包む -->
<wcs-form data-wcs="values: draft; valid: canSave; messages: errors">
  <form novalidate>
    <input name="email" type="email" required>
    <input name="age"   type="number" min="0">
    <button data-wcs="disabled: canSave|not">Save</button>
  </form>
</wcs-form>

<!-- 代替: 離れたフォームを id で -->
<wcs-form target="#signup" data-wcs="valid: canSubmit"></wcs-form>
```

`<wcs-form>` は `display: contents`（intersection の先例）で layout box を注入しない。

### 3.2 出力（`properties`・output-only）

| 名前 | 型 | 内容 |
|---|---|---|
| `valid` | `boolean` | `form.checkValidity()` の結果（UI を出さない側） |
| `values` | `Record<string, string \| string[]>` | `FormData` の投影。同名複数（checkbox 群・`<select multiple>`）は配列。**file input は含めない**（§6-3） |
| `validity` | `Record<string, ValidityFlags>` | コントロール名 → `{ valid, valueMissing, typeMismatch, patternMismatch, tooShort, tooLong, rangeUnderflow, rangeOverflow, stepMismatch, badInput, customError }`（`ValidityState` の plain 写し） |
| `messages` | `Record<string, string>` | コントロール名 → `validationMessage`（ブラウザのロケール文言。カスタムは §3.4） |
| `dirty` | `boolean` | 観測開始（または `markPristine` / reset）以降に何かが変わった |
| `touched` | `Record<string, boolean>` | コントロール名 → `focusout` を一度でも経た |
| `submitted` | occurrence（`semantics: "event"`） | `submit` が起きた。detail は `values` のスナップショット。`preventDefault` 済み（§6-4） |
| `error` | `object \| null` | never-throw の落とし所 |

全て 1 イベント `wcs-form:change` の detail から getter で分派（`submitted` だけ別イベント `wcs-form:submit`）。同値ガード: 各面は前回スナップショットと shallow 比較し、変化した面だけ更新する（router の commit と同じ規範）。

### 3.3 入力（`inputs`）

| 名前 | 内容 |
|---|---|
| `target` | 属性ミラー。セレクタ |
| `values` | **双方向候補**（§6-2）。書くと同名コントロールへ値を配る（プログラム的な代入は `input` イベントを起こさないので echo しない） |
| `validateOn` | `"input"`（既定）/ `"change"` / `"submit"` — 妥当性の再計算タイミング |

### 3.4 コマンド（`commands`）

| 名前 | 内容 |
|---|---|
| `checkValidity()` | 再計算のみ |
| `reportValidity()` | ネイティブのバブル表示込み |
| `submit()` | `requestSubmit()`（検証を通す） |
| `reset()` | `form.reset()` ＋ dirty / touched をクリア |
| `setCustomValidity(name, message)` | state 側のカスタム検証をネイティブへ書き戻す（`""` で解除）。**規則は HTML、例外は state** の唯一の橋 |
| `markPristine()` | 現在値を基準にして `dirty = false` |

command-token の位置引数素通し（[spec-proposal-command-token-arguments.md](./spec-proposal-command-token-arguments.md)）に乗る。

---

## 4. Core / Shell の分担

- **`FormCore`**（`core/FormCore.ts`）: `observe(form: HTMLFormElement)` / `dispose()`、5 種のリスナー、スナップショット計算（`snapshot(): FormSnapshot`）、`setCustomValidity` の要素解決（`form.elements.namedItem`）。DOM は引数で受けるだけで自分では探さない。`FormData` は `new FormData(form)` の 1 箇所に閉じ、失敗は `error`
- **`Form`**（`components/Form.ts`）: 監視対象の解決（child / `target`）、属性ミラー、`static wcBindable`、CustomStateSet（`:state(valid)` / `:state(dirty)`）、`upgradeProperties`、`display: contents`
- 対象が見つからないとき: 接続後 1 フレーム待って再解決し、それでも無ければ `error` に「no form」を落として `valid = false`（never-throw）。autoloader で `<form>` が後から来るケースは MutationObserver を**作らない**（intersection の先例と同じ「実需まで作らない」）

---

## 5. state との整合 — 二重の真実を避ける

`values` 双方向と、フォーム内の `<input data-wcs="value: user.name">` を**同時に**使うと、同じコントロールに 2 つの書き手ができる。規範:

1. **どちらか 1 つ**。フォーム単位なら `values`、項目単位なら `value:`。README で明記し、lint 候補（`wcs/form-double-binding`）として積む
2. 混在させるなら `values` は**読み取り専用**（`values#ro`）にする — 集約結果だけを読む
3. `submitted` の detail は常にスナップショット。state はそれを `command.fetch` の `body` へ渡すだけで、フォームを読みに行かない

storage の**アクセサペア**は残す（オンデマンド保存の形として現役）。`values` は「毎入力で流れる投影」、アクセサペアは「任意のタイミングで組み立てる」— 用途が違う。

---

## 6. 未決事項（実装前に決める）

1. **名前**: `<wcs-form>` か `<wcs-validity>` か。前者は「FormData と検証の両方」を含意し、後者は検証だけを含意する。`values` を持つ以上 `<wcs-form>` が正直。ただし `<form>` を包む要素が `form` と名乗る混乱（`this.form` の衝突）を README で潰す
2. **`values` を双方向にするか**: 双方向は「1 行で復元」を可能にするが、§5 の二重書き手を招く。**提案: 双方向で出し、既定は `#init=element`（要素が正）**。storage と同じ着地
3. **file input**: `File` は生ハンドルで state に入れない（camera の規範）。`values` から除外し、必要なら `files: Record<string, File[]>` を**別プロパティ**で露出（`data-wcs` で `<wcs-upload>` へ直結する形）。**提案: Phase 2 に回す**
4. **`submitted` の preventDefault**: ノードが常に `preventDefault` するか、`onsubmit#prevent` を書かせるか。**提案: `prevent` 属性（既定 on）**。SPA では 100% 横取りするが、素の POST を残したい PWA もある
5. **`messages` のロケール**: ネイティブ文言はブラウザのロケール。`config.locale`（state）とは無関係で、揃えたいなら `setCustomValidity` で上書きする。README で明記するだけ
6. **ネストルート／`for` 内のフォーム**: 行ごとにフォームがある一覧（inline edit）。`<wcs-form>` を行テンプレートに置けば行ごとに 1 インスタンス。`values` を `.draft` に配線する — 通常の `for` 内バインドと同じ。追加設計は不要だが e2e が要る

---

## 7. テスト方針

- Core: happy-dom の `HTMLFormElement` は `checkValidity` / `FormData` を持つ（要確認・持たない項目はテストダブルで差す）。スナップショット計算は純関数に切り出して網羅
- Shell: 対象解決 3 系統、属性ミラー、CustomStateSet、`display: contents`
- 統合（state と）: `values` 双方向の echo 無し、`valid` による `disabled` 切替、`submitted` → `command.fetch`
- e2e（実 Chromium）: `reportValidity` のバブル、`requestSubmit` の検証経路、`for` 内の複数フォーム — happy-dom では検証 UI を再現できない

---

## 8. 段階

| Phase | 内容 | 完了条件 |
|---|---|---|
| 0 | 本メモの §6 決定・README 草案 | 未決 6 件に決定が付く |
| 1 | Core + Shell: `valid` / `values`（output）/ `messages` / `validity` / `submitted` / `checkValidity` / `reportValidity` / `submit` / `reset` | 100/97 カバレッジ・lint 0・README 英日 |
| 2 | `dirty` / `touched` / `setCustomValidity` / `markPristine` / `values` 入力側 / `files` | 同上＋ storage との合流例 |
| 3 | `users-crud` の書き換え・skill references・lint `wcs/form-double-binding` | 手書きハンドラ 0 の CRUD デモ |
