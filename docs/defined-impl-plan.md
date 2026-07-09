# 実装計画: `@wcstack/defined`（`<wcs-defined>`）

- **状態**: ✅ 実装完了（2026-06-16・未リリース v1.13.0）。テスト 49 本 100/100/100/100、build 成功。設計は [defined-tag-design.md](./defined-tag-design.md) を正とする。
- **実装メモ**: invalid name は設計 §5 決定2 が想定した「同期 throw」ではなく現行仕様/happy-dom では **rejected promise** だったため reject ハンドラで処理。さらにレビュー指摘を受け、旧仕様/ポリフィルの **同期 throw も try/catch で吸収**し never-throw を環境非依存化（reject と sync-throw が共通 `_markInvalid` に合流）。timeout の世代ガードは dispose の `clearTimeout` で stale 発火が起きず**到達不能**と判明し削除（resolve/reject 側は promise がキャンセル不可なので世代ガード必須・維持）。same-value ガードは snapshot の JSON 比較に簡約。dispose は pending 中でも `_ready` を resolve（hang 防止）。
- **方針**: `packages/permission/` を**雛形にコピー → 名称置換 → 差分実装**。permission は event-token 専用ノード（command なし・Core/Shell 分割・SSR `connectedCallbackPromise`・「1イベント・多 getter」idiom・`_gen` 世代ガード・same-value ガード）を既に備え、本ノードと構造が最も近い。
- **permission との主な差分**（実装で効くポイント）:
  1. 対象 API が `customElements.whenDefined`（**単調**・終端あり）→ `change` 再購読が不要で状態機械が単純。
  2. **happy-dom は `customElements` を実装済み** → permission の `mocks.ts`（navigator.permissions 全モック）は不要。テストは `customElements.define` の遅延実行 ＋ **fake timers**（timeout 駆動）で済む。
  3. 状態が単一 `state` でなく **6 プロパティ**（`defined`/`pending`/`missing`/`count`/`total`/`error`）＋**不変条件** `total === count + pending + missing`。
  4. 属性が `tags`/`mode`/`timeout`（descriptor 系 `user-visible-only`/`sysex` は廃止）。

---

## 1. パッケージ雛形（コピー → リネーム）

`packages/permission/` を `packages/defined/` へコピーし、以下を機械的に置換・改名する。

| permission | defined |
|---|---|
| `src/core/PermissionCore.ts` | `src/core/DefinedCore.ts` |
| `src/components/Permission.ts` | `src/components/Defined.ts` |
| `src/bootstrapPermission.ts` | `src/bootstrapDefined.ts` |
| クラス `PermissionCore` / `WcsPermission` | `DefinedCore` / `WcsDefined` |
| `bootstrapPermission` | `bootstrapDefined` |
| タグ `wcs-permission` | `wcs-defined` |
| イベント `wcs-permission:change` | `wcs-defined:change` |
| `[@wcstack/permission]`（raiseError 接頭辞） | `[@wcstack/defined]` |

そのままコピーでよいファイル（中身は設定のみ）:
- `rollup.config.js`（3 出力 ＋ `copyAutoPlugin`・無改変）
- `vitest.config.ts`（**`thresholds` を branches も 100 に統一可。permission は 100/100/100/100。本パッケージは分岐が多いので、まず 100 を狙い、困難なら 97 へ緩める判断は実装後**）
- `tsconfig.json`（無改変）
- `eslint.config.js`（無改変）
- `src/auto/auto.js` / `auto.min.js`（`bootstrapPermission` → `bootstrapDefined` のみ置換）
- `package.json`（後述 §2）

---

## 2. `package.json`

permission からコピーし以下を変更:

- `name`: `@wcstack/defined`
- `version`: 既存クライアント群と揃える（[[feedback_version_alignment]]）。直近 permission/notification 系が `1.13.x` なので **`1.13.0` 起点**（リリース時に最終調整）。
- `description`: "Declarative custom-element readiness gate for Web Components. Waits on customElements.whenDefined with timeout-based load-failure detection via wc-bindable-protocol."
- `keywords`: `web-components`, `custom-elements`, `whenDefined`, `defined`, `lazy-loading`, `autoloader`, `wc-bindable`, `declarative`, `zero-dependencies`, `framework-agnostic`
- `repository.directory`: `packages/defined`
- `exports`/`files`/`scripts`/`devDependencies` は無改変（`./auto` も維持）。

---

## 3. ソース実装

### 3.1 `src/types.ts`

permission の wc-bindable インターフェース群（`IWcBindable*` / `IConfig` 系）は**そのまま流用**。`tagNames` を `{ defined: string }` に。permission 固有型（`PermissionStateOrUnsupported` / `WcsPermissionDescriptor`）は削除し、本ノードの値型に置換:

```ts
export interface ITagNames { readonly defined: string; }
export interface IWritableTagNames { defined?: string; }
// IConfig / IWritableConfig / IWcBindable* は permission からそのまま

export type DefinedMode = "all" | "any";

/** 観測プロパティ（headless DefinedCore の値サーフェス）。 */
export interface WcsDefinedCoreValues {
  defined: boolean;
  pending: string[];
  missing: string[];
  count: number;
  total: number;
  error: string | null;
}

export type WcsDefinedValues = WcsDefinedCoreValues;

/** Shell の settable 入力（属性）。 */
export interface WcsDefinedInputs {
  tags: string;     // カンマ区切り
  mode: DefinedMode;
  timeout: number;  // ms（0/未指定=無限待ち）
}
```

> `types.ts` は coverage 除外（vitest.config の exclude）なのでテスト不要。

### 3.2 `src/core/DefinedCore.ts`（中核）

**状態フィールド**（内部で保持し getter で公開）:
```
_defined: boolean = false
_pending: string[] = []
_missing: string[] = []
_count: number = 0
_total: number = 0
_error: string | null = null
_mode: DefinedMode = "all"
_timeoutId: ReturnType<typeof setTimeout> | null = null
_gen: number = 0           // 世代ガード（permission の _permGen 同型）
_subscribed: boolean = false
_ready: Promise<void> = Promise.resolve()
```

**`wcBindable`**（6 プロパティすべて共有イベント `wcs-defined:change` ＋ getter）:
```ts
static wcBindable: IWcBindable = {
  protocol: "wc-bindable", version: 1,
  properties: [
    { name: "defined", event: "wcs-defined:change", getter: (e) => (e as CustomEvent).detail.defined },
    { name: "pending", event: "wcs-defined:change", getter: (e) => (e as CustomEvent).detail.pending },
    { name: "missing", event: "wcs-defined:change", getter: (e) => (e as CustomEvent).detail.missing },
    { name: "count",   event: "wcs-defined:change", getter: (e) => (e as CustomEvent).detail.count },
    { name: "total",   event: "wcs-defined:change", getter: (e) => (e as CustomEvent).detail.total },
    { name: "error",   event: "wcs-defined:change", getter: (e) => (e as CustomEvent).detail.error },
  ],
  commands: [],   // event-token 専用
};
```
> permission は `detail` に単一 string を載せていたが、本ノードは 6 値なので **`detail` を状態スナップショット object** にする（getter が各フィールドを引く）。

**メソッド構成**:

- `constructor(tags?, mode?, timeout?, target?)`: headless 利用時に引数があれば即 `_init()`。Shell は引数なしで構築（getter が既定値を返す）。
- 6 個の getter（`defined`/`pending`/`missing`/`count`/`total`/`error`）。配列は防御コピー（`[..._pending]`）で返すか、内部不変運用なら直接返す（permission は state を直接返す＝後者でよい。ただし配列はミューテート防止のため slice 推奨）。
- `get ready(): Promise<void>`。
- `observe(tags: string[], mode: DefinedMode, timeoutMs: number): Promise<void>`: `_subscribed` でなければ `_init()`。permission の `observe` 同型（再 init はしない、reconnect でのみ）。
- `dispose()`: `_subscribed=false`、`_gen++`、`clearTimeout(_timeoutId)`。
- `_init()`: 中核ロジック（下記）。
- `_publish()`: same-value ガード後に `wcs-defined:change`（`detail`=スナップショット, `bubbles:true`）を dispatch。
- `_finishIfDone()`: 全タグ解決 or timeout 終端で `_ready` を resolve。

**`_init()` のロジック**（設計 §4・§5 を実装）:
1. `tags` を検証。空配列なら `_error="no tags specified"`、`_total=0`、`_defined=false` 固定 → publish ＋ ready resolve（**決定3**）。
2. `_total = tags.length`。各タグについて:
   - 不正名（`whenDefined` が同期 throw）→ `_error` に「invalid custom element name: <tag>」を追記、当該タグを `_missing` へ（**決定2**・never-throw で継続）。
   - `customElements.get(tag)` が真 → 即 `_count++`（connect 前に定義済み）。
   - それ以外 → `_pending` に積み、`whenDefined(tag).then(...)` を張る（`gen` をキャプチャ、resolve 時 `gen !== _gen` なら bail。`_pending`→`_count` へ移動し publish。**決定1 の昇格もこのハンドラが担う**＝timeout 後でも移動する）。
3. `mode=all` → `_defined = _count === _total && _total > 0 && !_error優先`、`mode=any` → `_defined = _count >= 1`。**`_recompute()` ヘルパ**で一元化し、各遷移後に呼ぶ。
4. `timeoutMs > 0` なら `_timeoutId = setTimeout(() => { if (gen!==_gen) return; _pending` に残る全タグを `_missing` へ移動; recompute; publish; finish; }, timeoutMs)`。
5. 初回スナップショットを publish。全タグが connect 時点で定義済みなら即終端。

**不変条件**: `_recompute()` 内で `_total === _count + _pending.length + _missing.length` を**開発時 assert**（`if (sum !== _total) raiseError(...)`）してもよい。本番は raiseError 不使用方針（never-throw）なので、テストで担保するに留める。

**`_recompute()` の `defined` 判定（決定3 と整合）**:
```ts
const ok = this._mode === "any" ? this._count >= 1 : (this._total > 0 && this._count === this._total);
this._defined = ok;   // error があっても count が満ちれば any では true になりうる。
                       // mode=all は missing/error があれば count<total なので自動的に false。
```
> 空 tags（total=0）は `mode=all` でも `count===total`（0===0）だが `_total>0` 条件で `false` に倒れる（決定3）。

### 3.3 `src/components/Defined.ts`（Shell）

permission の `WcsPermission` を写経:
- `static hasConnectedCallbackPromise = true`
- `wcBindable = { ...DefinedCore.wcBindable, inputs: [{name:"tags",attribute:"tags"},{name:"mode",attribute:"mode"},{name:"timeout",attribute:"timeout"}], commands: [] }`
- 属性アクセサ:
  - `tags`: `getAttribute("tags") ?? ""`（setter は反映）
  - `mode`: `getAttribute("mode") === "any" ? "any" : "all"`
  - `timeout`: `Number(getAttribute("timeout")) || 0`
- Core 委譲 getter ×6。
- `_parseTags(): string[]`: `this.tags.split(",").map(trim).filter(Boolean)`。
- `connectedCallback()`: `this.style.display = "none"; this._connectedCallbackPromise = this._core.observe(this._parseTags(), this.mode, this.timeout);`
- `disconnectedCallback()`: `this._core.dispose();`
- `get connectedCallbackPromise()`。

### 3.4 その他（ほぼ無改変）
- `src/config.ts`: `tagNames.defined = "wcs-defined"`。
- `src/registerComponents.ts`: `WcsDefined` を `config.tagNames.defined` で define。
- `src/bootstrapDefined.ts`: permission 同型。
- `src/raiseError.ts`: 接頭辞のみ置換（never-throw なので未使用のまま保持）。
- `src/exports.ts`: `bootstrapDefined` / `getConfig` / `DefinedCore` / `WcsDefined` ＋型を export。

---

## 4. テスト（`__tests__/`・happy-dom）

permission の `mocks.ts`（navigator.permissions 全モック）は**不要**。happy-dom の実 `customElements` を使い、**fake timers** で timeout を駆動。`setup.ts` は最小コメントのみ。

**テスト分割**（permission 構成を踏襲）:
- `definedCore.test.ts`（中核）
- `defined.test.ts`（Shell・属性パース・ライフサイクル）
- `bootstrapDefined.test.ts` / `config.test.ts`（permission からコピー・名称置換）

**ヘルパ**（`__tests__/helpers.ts`）:
- 一意なダミータグ名生成（テスト間衝突回避。`customElements` はグローバルで**定義の取り消し不可**なので、テストごとに `wcs-x-<連番>` のようなユニーク名を使う ※ `Math.random` 不可の制約はテストでは無関係だが、連番カウンタで採番）。
- `defineLater(tag)`: `customElements.define(tag, class extends HTMLElement {})`。

**観点（設計 §8）**:
1. connect 前に定義済みのタグ → 即 `count` 算入・同期 `defined`（`mode=all`/`any`）。
2. 未定義タグの遅延 `define` → `pending`→`count`、`wcs-defined:change` 再発火、`mode=all` は全解決で `defined=true`。
3. `mode=any` → 1 つ定義で即 `defined=true`、残りは `pending`。
4. `timeout` 発火（fake timers `vi.advanceTimersByTime`）→ 残り `pending` が `missing` へ、`defined` 判定、`ready` resolve。
5. **決定1**: timeout 後の遅延 `define` → `missing`→`count` 昇格、`mode=all` の遅延 `defined=true` 昇格。
6. **決定2**: invalid tag name（ハイフン無し `"foo"` 等）→ `error` セット ＋ `missing` 算入、他の正当タグの監視は継続（never-throw）。
7. **決定3**: `tags` 空 → `error="no tags specified"`、`total=0`、`defined=false`。
8. **不変条件** `total === count + pending.length + missing.length` を全遷移後に assert（専用テストで毎回検査）。
9. `_gen` 世代ガード: dispose / reconnect 後に遅延 `whenDefined` resolve・timeout コールバックが来ても publish しない。
10. same-value ガード: スナップショットが同値なら再 dispatch しない。
11. Shell: `tags`/`mode`/`timeout` 属性パース（trim・空要素除去・`mode` 既定 all・`timeout` 非数値→0）、`display:none`、`connectedCallbackPromise`、disconnect で dispose。
12. headless: `new DefinedCore([...], "all", 0)` の即時 observe。

> **カバレッジ**: 100/100/100/100 を目標。timeout 無指定（`missing` 常に空）枝、空 tags 枝、invalid 枝、`gen` bail 枝を個別に踏むこと。branches 100 が難しければ vitest.config を 97 に緩める（CLAUDE.md の標準閾値内）。

---

## 5. example: `packages/defined/examples/defined-loader/`（旧 `examples/state-defined-loader/`）

**主題**: autoloader 遅延ロードの readiness ゲート ＋ ロード失敗フォールバック（CSS `:defined` では出せない「失敗検出」を目玉に）。`state-permission-banner` を雛形に。

- Import Map ＋ `@components/` で **わざと存在しない or 遅延するコンポーネント**を 1 つ含め、`timeout` で `missing` に落ちる失敗フローを実演。
- `<wcs-defined tags="my-chart,my-grid" timeout="3000" data-wcs="defined: ready; missing: failed; count: loaded; total: total; error: err">`
- UI:
  - `hidden@ready` のスピナー（準備中）。
  - `hidden@!ready` の本体（`<my-chart>` 等）。
  - `hidden@!hasFailed`（`get hasFailed(){ return this.failed.length>0 || !!this.err }`）の「読み込みに失敗しました: {failed}」。
  - 進捗 `{loaded}/{total}` の text 束縛。
- README.ja / README.md（CSS `:defined` との使い分け・失敗検出の価値を明記）。
- ルート `examples/` の一覧 README があれば追記。

---

## 6. README（`packages/defined/README.md` ＋ `README.ja.md`）

permission の README 構成を踏襲しつつ、本ノード固有を明記:
- **CSS `:defined` との使い分け**（FOUC は CSS で十分／本ノードは集約・失敗検出・state 連携）。
- **autoloader 連携**が主用途。
- **単調性**（一度 defined は不可逆）と **timeout=失敗検出** の意味。
- 6 プロパティ表 ＋ 不変条件 ＋ `mode`/`timeout` 属性。
- **SSR**: timeout 未指定だと未解決タグで無限待ちになりうる → SSR では `timeout` 指定推奨。
- never-throw（invalid name でも全体は落ちない）。
- ルート README（リポジトリ直下）の「対応タグ一覧」へ 1 行追記（permission/notification と同様の "Twenty-two 化"）。

---

## 7. ビルド & 検証手順

`packages/defined/` で順に:
```bash
npm install            # 雛形コピー直後（devDependencies 解決）
npm run lint           # eslint src
npm test               # vitest run（全観点グリーン）
npm run test:coverage  # 閾値達成を確認
npm run build          # rimraf → tsc → rollup（index.esm / .min / .d.ts ＋ auto コピー）
```
- `dist/index.d.ts` に 6 プロパティ型と `DefinedMode` が正しく現れることを確認。
- example をローカルサーバで開き、(a) 全コンポーネント定義時に本体表示、(b) 1 つ未ロードで timeout 後に失敗 UI、(c) `count/total` 進捗、を目視。

---

## 8. 成果物チェックリスト

- [ ] `packages/defined/` 一式（src 8 ファイル ＋ auto 2 ＋ 設定 4 ＋ README 2 ＋ package.json）
- [ ] `DefinedCore`（6 プロパティ ＋ 不変条件 ＋ 決定1/2/3 ＋ `_gen`/same-value ガード）
- [ ] `WcsDefined` Shell（`tags`/`mode`/`timeout` ＋ display:none ＋ SSR promise）
- [ ] `__tests__/` 12 観点・カバレッジ 100/(100|97)/100/100
- [ ] `packages/defined/examples/defined-loader/`（旧 `examples/state-defined-loader/`）（readiness ゲート ＋ 失敗フォールバック）
- [ ] README ja/en ＋ ルート README 追記
- [ ] バージョン整合（1.13.x 系）
- [ ] `npm run build` 成功・`dist` 型確認

---

## 9. 着手順（推奨）

1. 雛形コピー ＋ 名称置換（§1・§2）→ `npm install`。
2. `types.ts` → `config.ts` → `registerComponents.ts` → `bootstrapDefined.ts` → `exports.ts`（土台・ほぼ機械置換）。
3. `DefinedCore`（§3.2）を TDD で：先に `definedCore.test.ts` の観点 1〜10 を書き、実装で緑化。
4. `WcsDefined`（§3.3）＋ `defined.test.ts`（観点 11〜12）。
5. カバレッジ詰め（枝の取りこぼし潰し）。
6. example ＋ README ＋ ルート README 追記。
7. `npm run build` ＋ example 目視 → 完了。
