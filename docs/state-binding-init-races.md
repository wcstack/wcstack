# 調査記録: state バインド初期化のレース 2 件（load-before-bind clobber / 未 define 要素への初期 apply 黙殺）

- **状態**: **対応済み**（2026-07-12・同日中に調査→修正）。
  - **バグ 2 = 案 A 実装済み**: `packages/state/src/apply/scheduleDeferredApply.ts` を新設し、`applyChange` の skip 分岐から whenDefined 再適用をスケジュール（two-way attach / deferred spread と対称化）。unit テスト = `packages/state/__tests__/integration.applyDeferred.test.ts`（happy-dom はノード差し替えのため no-op / エラー / 多重登録ガードのみ）、happy path の実ブラウザ回帰 = `e2e/tests/state-deferred-apply.spec.ts` + `e2e/fixtures/deferred-apply.html`。state 全テスト・カバレッジ閾値（100/97/100/100）・lint・build green。
  - **バグ 1 = 案 C 実施済み**: `examples/state-cross-tab-todo` を idiom（undefined 初期値 + `$connectedCallback` pull + script 順序）に修正、storage README（en/ja）の Quick Start §1/§4 を安全な形に直し「§5 load-before-bind: 永続スロットの idiom」を新設。リロード永続化の実ブラウザ回帰 = `e2e/tests/state-cross-tab-todo.spec.ts` に追加。**案 A（初期 apply の限定抑制）は中期課題として未着手**。
  - **案 B 実施済み**: `examples/README.md` / `README.ja.md` に「I/O ノードの script を state より先に並べる」規約を明文化。
- 以下 §1〜§4 は調査時点の記録（機序・実測・候補比較）としてそのまま残す。
- **発見経緯**: examples 追加 3 デモ（[examples-uncovered-combos.md](./examples-uncovered-combos.md)）の Playwright 実ブラウザ検証で発見・実測。
- **影響**:
  - バグ 1 は**既存デモ `examples/state-cross-tab-todo` に実害**（リロードのたびに todos が全消失。本ドキュメント時点で未修正）。`<wcs-storage>` の two-way 配線を使うすべてのページが対象。
  - バグ 2 は構成依存（state の初期化が I/O ノードの define より先に完了する構成）で、任意の state→element 初期配線が**無音で**欠落する。
- **共通の背景**: どちらも「`<wcs-state>` の非同期初期化」と「I/O ノード要素の define / connectedCallback」の順序が保証されていないことに起因する。既存デモが無事なのは全パッケージを同一 CDN からロードしていて define が先に済む**偶然**に依存している。

---

## 1. storage の load-before-bind clobber

### 1-1. 症状

`<wcs-storage type="local" data-wcs="value: todos">` の標準 two-way 配線で、**リロードするたびに localStorage の永続値が state 初期値（`[]` / `null`）で上書き消去される**。

### 1-2. 実測（Playwright・e2e serve :4173）

```
examples/state-cross-tab-todo で todo を 1 件追加:
  before reload: localStorage = [{"id":"...","text":"probe item","done":false}]
  after  reload: localStorage = []        ← 消失
  list items after reload: 0
```

修正前の state-color-palette でも同一症状（リロード後スウォッチ 0）を確認。

### 1-3. 機序（タイムライン）

1. module script 実行順で `wcs-storage` が define → upgrade → `connectedCallback` → 自動 `load()` → 永続値で `_setValue` → **value イベント dispatch**。この時点で state のバインディングは未確立＝**イベント取り逃し**。
2. `<wcs-state>` の非同期初期化が完了 → バインディング attach → `applyChangeFromBindings` が **state 初期値（`[]` / `null`）を要素へ書き込む**。
3. `<wcs-storage>` の `value` setter は非 manual で **write-through**（`packages/storage/src/components/Storage.ts` の setter → `_core.save(v)`）→ `[]` なら `"[]"` を保存、`null` なら `removeItem` → **永続値が消える**。
4. save が value イベントを再発火 → two-way で state に `[]`/`null` が書き戻る → 画面は「空」で一貫して見えるため、**消失に気づきにくい**。

### 1-4. 回避 idiom（`examples/state-color-palette` で採用・検証済み）

永続スロットを **`undefined` で開始**し（`applyChangeToProperty` は undefined を「無意見」としてプロパティ書き込み自体をスキップする既存規範 → 手順 2-3 が起こらない）、取り逃した初期ロード値は `$connectedCallback` で一度だけ pull する:

```js
palette: undefined,   // null や [] にしない（clobber ガード）

$connectedCallback() {
  (async () => {
    await customElements.whenDefined("wcs-storage");
    const el = document.querySelector("wcs-storage");
    if (!el) return;
    await el.connectedCallbackPromise;   // load 完了を待つ
    if (!Array.isArray(this.palette) && Array.isArray(el.value)) {
      this.palette = el.value;           // バインド経由で届いていれば no-op
    }
  })();
},
```

読み出しは `get list() { return Array.isArray(this.palette) ? this.palette : []; }` の正規化 getter 経由（cross-tab-todo と同型）。

### 1-5. 恒久対応の候補（未決）

| 案 | 内容 | トレードオフ |
|---|---|---|
| A | **初期 apply の限定抑制**: two-way な wcBindable プロパティで、要素側が既に非 null 値を持つ場合は初期 state→element 書き込みを skip | 「undefined は書かない」規範の自然な拡張。ただし「state 初期値を要素へ流し込みたい」正当なケースとの区別が難しく、挙動変更＝互換性リスク |
| B | **storage 側の bind 後再通知**: バインディング確立後に load 値をもう一度 dispatch | 要素側に「bind された」ことを知るプロトコルが無い（wc-bindable の範囲外）。時間ベースの再通知は二重適用・順序の新たなレースを生む |
| C | **idiom の規範化のみ**: storage README / state README に「永続スロットは undefined 初期値 + `$connectedCallback` pull」を明文化し、cross-tab-todo を同 idiom に修正 | 挙動不変更で最も安全。ただし罠は残る（知らないと踏む） |

**短期推奨 = C**（cross-tab-todo の修正込み）。**中期に A の限定版**を検討。B は非推奨。

---

## 2. 未 define カスタム要素への初期 apply 黙殺

### 2-1. 症状

state のバインド初期化が要素の define より先に完了すると、その要素への **state→element 初期適用（プロパティ書き込み・command 配線の初回 apply）が黙って捨てられ、以後も再適用されない**。

`examples/state-sse-dashboard`（state=ローカル配信で高速、sse/network=CDN で低速）で顕在化: `url: sseUrl` が一度も書かれず、`<wcs-sse>` は url 属性 null / readyState 2 のまま**左パネルが無音**。console にエラーは一切出ない。

### 2-2. 該当コード

`packages/state/src/apply/applyChange.ts`（applyChange 冒頭）:

```ts
const customTag = getCustomElement(binding.replaceNode);
if (customTag) {
  if (customElements.get(customTag) === undefined) {
    // cutomElement側の初期化を期待
    return;          // ← skip したきり、whenDefined 後の再適用が無い
  }
}
```

### 2-3. 非対称性（これがバグと考える根拠）

同じ「未 define」に対して、他の経路はすべて再試行する:

- `attachTwowayEventHandler`（`event/twowayHandler.ts`）: `customElements.whenDefined(tag).then(() => attachTwowayEventHandler(binding))` で**再 attach**
- event token（`event/eventTokenHandler.ts`）: 同じく whenDefined 後に再試行
- spread（`bindings/collectNodesAndBindingInfos.ts`）: `IDeferredSpreadEntry` として保持し、whenDefined 後に `processDeferredNode` で再展開＋`applyChangeFromBindings`

**初期の値適用だけ**が「customElement 側の初期化を期待」して片道 skip になっている。要素が自分の HTML 属性から初期化できる静的ケースでは成立するが、**値が state 由来（getter 派生の url など）のときは要素側に知りようがない**。

### 2-4. 回避 idiom（examples 3 デモすべてで採用・検証済み）

module script は**文書順で実行される**保証を使い、**I/O ノードの `<script>` を先、state を最後**に並べる。state の module が実行される時点で全ノードが define 済みになり、レースが構成によらず消える:

```html
<script type="module" src="https://esm.run/@wcstack/sse/auto"></script>
<script type="module" src="https://esm.run/@wcstack/network/auto"></script>
<script type="module" src="/state-dist/auto.js"></script>  <!-- state は最後 -->
```

（既存デモの多くは state を先頭に書いているが動いている＝define が先に済む偶然。規約としてはノード先・state 後に寄せるのが安全。）

### 2-5. 恒久対応の候補（未決）

| 案 | 内容 | トレードオフ |
|---|---|---|
| A | **applyChange に whenDefined 再適用を追加**（two-way attach と対称化）: skip 分岐で `customElements.whenDefined(tag).then(() => 単発の applyChangeFromBindings([binding]))`。再適用時は接続チェック（`isConnected`）と最新 state 値での適用が必要 | 対称性が回復し構成非依存になる。適用が非同期になるため「define 前に emit された command」等の順序は依然保証外（それは token 側の既知の空撃ちレースで別問題）。`appliedBindingSet` はコンテキスト毎なので二重適用の恒久ガードは不要だが、同一 binding の多重 whenDefined 登録を避ける台帳は要る |
| B | **script 順序規範の明文化のみ**: examples / README に「I/O ノード先・state 後」を規約化 | 挙動不変更で安全。ただしユーザーのページ構成（バンドラ・遅延ロード・autoloader 経由）までは縛れず、罠は残る |

**推奨 = A + B 併記**（A は低リスクで two-way / eventToken / spread と揃う。B は A が入るまでの運用規範）。

---

## 3. 同調査で確認した関連事実（バグではないが前提知識）

- `applyChangeToProperty` は getter-only プロパティへの書き込みを try/catch で黙って skip する（`held` / `connected` など出力専用プロパティに `data-wcs="held: x"` を張っても安全な理由）。undefined 値は書き込み自体を skip（「無意見」規範）。
- `<wcs-network>` は `observe()` が**同期**で初期スナップショットを dispatch するため、バインド確立前に発火して取り逃す（バグ 1 と同族の取り逃し）。permission / notification 系は初回 dispatch が非同期 query の後なので偶然取り逃さない。回避は同じく `$connectedCallback` での pull（state-sse-dashboard で採用）。

## 4. 再現手順

```bash
# バグ1（cross-tab-todo のデータ消失）
cd e2e && npm run serve   # :4173
# ブラウザで /examples/state-cross-tab-todo/ を開き todo を追加 → リロード
# → localStorage("wcs-cross-tab-todos") が [] に潰れる

# バグ2（初期 apply 黙殺）
# examples/state-sse-dashboard/index.html の <script> 順を state 先頭に入れ替えて
node examples/state-sse-dashboard/server.js   # :3000
# → 左パネル（<wcs-sse>）の url 属性が書かれず samples が 0 のまま
```
