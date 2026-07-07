# 設計メモ: `@wcstack/defined`（`<wcs-defined>`）

- **状態**: 実装済み（`packages/defined`）。本文書は実装時の論点整理と決定事項の記録。
- **対象 WebAPI**: Custom Elements Registry（`customElements.whenDefined(tag)` ＋ `customElements.get(tag)`）
- **位置づけ**: 指定したカスタム要素群の **registration 完了を待ち、ロード失敗を timeout で検出する readiness ゲート**。`@wcstack/autoloader` が動的 import するコンポーネントの「準備完了 / 読み込み失敗」を宣言的に state 化するコンパニオンノード。
- **前提資産**: permission（event-token 専用ノード＝command なし／`_permGen` 世代ガード／`unsupported` 的フォールバック／Core/Shell 分割／SSR `connectedCallbackPromise`／「1イベント・多 getter」idiom）、wakelock（boolean state の宣言的束縛＝派生 getter）、event-token プロトコル、wc-bindable protocol v1。permission を雛形に最小改変で起こす。

---

## 0. 大前提: このノードは「片肺」かつ「単調」

permission と同様に **event-token 専用ノード**（要素 → state の一方向のみ・command-token 不成立）。`whenDefined` を能動的に起こす操作は存在せず、観測しかしない。

さらに permission との決定的な違いは **単調（monotonic）**であること。`customElements.whenDefined(tag)` は一度 resolve したら不可逆で、定義が「未定義」へ戻ることはない。permission（grant ↔ deny を双方向に追従）より状態機械が単純で、`PermissionStatus` の `change` 購読に相当する「値が揺れ戻る」処理が要らない。

| | `<wcs-permission>` | `<wcs-defined>` |
|---|---|---|
| 方向 | 要素 → state 一方向 | 要素 → state 一方向（同じ） |
| command-token | 不成立 | 不成立（同じ） |
| 値の遷移 | 双方向（grant↔deny を追従） | **単調**（未定義→定義済みの不可逆のみ） |
| 終端 | なし（生存中ずっと追従） | あり（全解決 or timeout で終端） |
| 失敗の概念 | `unsupported` | **`timeout`（永久未解決 vs 失敗の分離）** |

---

## 1. 存在意義 — 何を解決するノードか

### 1.1 CSS `:defined` との競合（最重要論点）

未定義要素のちらつき（FOUC）回避という `whenDefined` の主用途は、プラットフォームが **`:not(:defined)` で宣言的・ゼロ JS に解決済み**である。

```css
my-chart:not(:defined) { visibility: hidden; }
```

ここに本ノードを持ち込むだけでは標準の劣化コピーにしかならない。**FOUC 回避を価値提案にすると「標準で足りる」で論破される。** したがって本ノードは CSS `:defined` にできない以下に焦点を絞る。

| 価値 | CSS `:defined` | `<wcs-defined>` |
|---|---|---|
| 複数タグの集約（all / any） | `:has()` で書けるが煩雑 | `mode` 属性で自然に表現 |
| **タイムアウト失敗検出** | 不可能（`:defined` は永遠に来ないだけ） | `missing` で「失敗」を明示 |
| reactive state として他ロジックを gate | スタイリング専用 | `defined@…` で条件レンダ・state 連携 |
| 進捗の数値化 | 不可能 | `count` / `total` で `3/5 loaded` |

### 1.2 焦点 — autoloader 連携 + 失敗検出

決定: 本ノードの主目的は **autoloader 連携 + ロード失敗検出**に固定する。autoloader が動的 import する遅延コンポーネントは、**ネットワーク失敗時に `whenDefined` が永久に resolve しない**。CSS では「いつまでも隠れたまま」になり区別不能。本ノードは `timeout` 経過で当該タグを `missing` に落とし、「読み込み失敗」UI への切り替えを可能にする。これが標準・CSS のどちらにも無い欠けたピースであり、**`@wcstack/autoloader` のコンパニオン**としての存在意義を立てる。

想定ユースケース:

- **遅延ロードの readiness ゲート**: autoloader 経由の `<my-chart>` が定義されるまでスピナー、定義されたら本体を表示（`hidden@defined` / `hidden@!defined`）。
- **ロード失敗フォールバック**: timeout で `missing` に入ったら「コンポーネントの読み込みに失敗しました」を表示（`hidden@!error` 相当を `missing` で）。
- **進捗表示**: 複数コンポーネントの初期化進捗を `count / total` でプログレス表示。

---

## 2. 公開する state（値サーフェス草案）

permission/geo の **「1イベント・多 getter」idiom** に乗せる。すべての状態遷移で単一イベント `wcs-defined:change` を dispatch し、6 プロパティはその時点の内部状態を読む getter とする（wc-bindable がきれいになる）。

`DefinedCore`（観測プロパティ）:

```
defined: boolean        // mode=all → count===total / mode=any → count>=1
pending: string[]       // 未解決・まだ待機中（timeout 前）
missing: string[]       // timeout 後も未定義 / 定義不能（invalid name 含む）
count:   number         // 定義済みタグ数
total:   number         // 対象タグ数（= tags の個数）
error:   string | null  // invalid tag name / no tags など人間可読メッセージ
```

- **commands: なし**（§0 の決定。event-token 専用）。
- **inputs（属性）**: `tags`（必須）、`mode`、`timeout`。
- イベント: 状態変化を `wcs-defined:change` で publish。event-token で受ける純プロデューサ。
- **派生束縛の例**: `hidden@defined`（準備中スピナー）、`hidden@!defined`（本体）、`hidden@!error`（エラー UI）。`count` / `total` は text 束縛で `3/5` 進捗に。

### 2.1 不変条件（実装が常に保つ）

```
total === count + pending.length + missing.length
```

`pending` と `missing` は「未定義タグ集合」を **timeout イベントで分割した排他パーティション**（timeout 前は全て pending、timeout で残りが missing へ移る）。この不変条件が崩れないよう実装することで、進捗表示がいつでも整合する。`missing.length > 0` がそのまま「失敗が発生した」シグナルになり、`timedOut` boolean を別途持たずに済む（プロパティを 1 つ減らす簡約）。

---

## 3. 属性

| 属性 | 値 | 既定 | 意味 |
|---|---|---|---|
| `tags` | カンマ区切りのタグ名 | （必須） | 待機対象のカスタム要素タグ名。例 `tags="my-chart,my-grid"` |
| `mode` | `all` / `any` | `all` | `all`=全タグ定義で `defined`／`any`=1つでも定義で `defined` |
| `timeout` | ms（整数） | 無指定=無限待ち | 経過後、未解決タグを `pending`→`missing` へ移す。無指定なら `missing` は常に空 |

- `tags` は **connect 時固定**（permission の `name` 固定と同じ割り切り。v1 では `tags` の動的変更で re-observe しない）。
- カンマ区切りの各要素は trim し、空要素は無視する。

---

## 4. 状態機械（単調 + 失敗の2軸）

`whenDefined` は monotonic。これに timeout を重ねた 2 軸:

```
                  ┌─ 全タグ解決 ──→ defined（mode 判定）, missing=[]   （成功・終端）
connect ─待機中──┤
（pending に充填）  └─ timeout 経過 ─→ 残りを missing へ移動            （失敗・終端）
                                       その後遅れて定義されたら
                                       missing→count へ昇格（§5 決定1）
```

- connect 時、`tags` の各タグについて即座に `customElements.get(tag)` で **定義済みかを同期チェック**（autoloader が先に登録済みのケース）。定義済みは即 `count` に算入し、未定義は `pending` に入れて `whenDefined(tag).then(...)` を張る。
- 各 `whenDefined` が resolve するたび、当該タグを `pending`→`count` へ移し `wcs-defined:change` を publish。
- `timeout` 指定時は `setTimeout` を 1 本張り、発火時点で `pending` に残る全タグを `missing` へ移して publish。
- 全タグが `count` に入った（または timeout で終端した）時点で `ready` Promise を resolve（SSR 用）。

---

## 5. 詰める3決定（推奨で確定）

### 決定1: timeout 後に遅れて定義されたら → **昇格A**

`missing` の語義「timeout 後も**未定義**のタグ」に従い、`missing` は現時点の未定義集合を反映する。timeout 後に遅れて `whenDefined` が resolve したら、当該タグを `missing`→`count` へ移動し再 publish する。`mode=all` なら `defined` が後から `true` に昇格しうる。

- **理由**: `count` / `total` が常に真実を保ち、失敗表示を出しつつ復帰できる方が実用的。終端後も `whenDefined` のリスナは生かしておく（単調なので追加発火は高々 1 回/タグで安全）。

### 決定2: invalid tag name → **`error` ＋ `missing` の両方**

`customElements.whenDefined("foo")`（ハイフン無し等の不正名）は、**現行 WHATWG 仕様・happy-dom では rejected promise（`SyntaxError`）**を返す（当初の本書記述「同期で throw」は旧仕様準拠。実装時に訂正）。ただし旧仕様/ポリフィルでは **同期 throw** する実装もあるため、**両方を吸収する**:

- `whenDefined(tag)` を **try/catch で囲み**、同期 throw も async reject も同じ「不正名」処理へ流す（`_markInvalid`）。これで never-throw が**環境非依存**になる。
- 不正名は `error` に「invalid custom element name: foo」をセットし、**該当タグは `missing` にも入れる**（定義不能＝恒久 missing）。これで §2.1 の不変条件が保たれ、`error` は「なぜ失敗か」を人間可読に補足する。`hidden@!error` でエラー UI を出せる。
- never-throw: 不正名で全体が落ちることはなく、他の正当なタグの監視は継続する。

### 決定3: `tags` 空 / 無指定 → **`error` ＋ `defined=false` 固定**

- `tags` が空なら `error` に「no tags specified」をセットし `total=0`。
- `mode=all` の `count===total`（`0===0`）を `defined=true` と**誤判定させない**。空のときは `error` を優先し `defined=false` で固定する。

---

## 6. Core / Shell 分割（permission 同型）

### `DefinedCore`
- `static wcBindable`: `protocol:"wc-bindable", version:1`、`properties` は `wcs-defined:change` を共有イベントとする 6 プロパティ（getter 付き派生）、`commands: []`。
- `constructor(tags?, mode?, timeout?, target?)`: headless 利用時は引数で即 observe。Shell は引数なしで構築し `connectedCallback` で `observe()`。
- `observe(tags, mode, timeout)`: 監視開始。`_gen`（permission の `_permGen` 同型）で reconnect/dispose レースの遅延コールバックを bail。`ready: Promise<void>` を返す。
- `dispose()`: timeout クリア＋`_gen++`＋リスナ無効化。
- 派生 getter: `defined` / `pending` / `missing` / `count` / `total` / `error`。
- `_publish()`: same-value ガード（直前と全プロパティ同値なら dispatch 抑制。permission `_setState` 同型）後に `wcs-defined:change` を bubbles で dispatch。

### `WcsDefined`（Shell）
- `static hasConnectedCallbackPromise = true`。`wcBindable` は Core を spread し `inputs: [{name:"tags",attribute:"tags"}, {name:"mode",attribute:"mode"}, {name:"timeout",attribute:"timeout"}]`、`commands: []`。
- 属性アクセサ（`tags` / `mode` / `timeout`）＋ Core 委譲 getter（6 プロパティ）。
- `connectedCallback`: `style.display="none"` ＋ `this._connectedCallbackPromise = this._core.observe(...)`。
- `disconnectedCallback`: `this._core.dispose()`。
- クラス名は global を避け `WcsDefined`（`WcsPermission` / `WcsGeolocation` 先例）。

---

## 7. SSR

- `whenDefined` は async なので permission/geo 同型の `hasConnectedCallbackPromise` ＋ `connectedCallbackPromise`。
- `ready` は **全解決 or timeout** で resolve。timeout 無指定 かつ 未解決タグが残る場合、SSR は無限待ちになりうる点を README に明記（SSR では `timeout` 指定を推奨、または初期 HTML で `pending` を許容）。

---

## 8. テスト方針（happy-dom）

happy-dom の `customElements` は実在するので、テスト内で `customElements.define` を遅延実行して `whenDefined` 解決を駆動できる。timeout は **fake timers**（`vi.useFakeTimers`）で制御。観点:

- connect 前に定義済みのタグ → 即 `count` 算入・同期 `defined`。
- 未定義タグの遅延 `define` → `pending`→`count` 遷移と再 publish。
- `mode=all`（全解決で `defined`）／`mode=any`（1つで `defined`）の境界。
- `timeout` 発火 → 残りが `missing` へ、`defined` 判定、`ready` resolve。
- 決定1: timeout 後の遅延 `define` で `missing`→`count` 昇格、`mode=all` の遅延昇格。
- 決定2: invalid tag name → `error` ＋ `missing`、他タグの監視継続（never-throw）。
- 決定3: `tags` 空 → `error` ＋ `defined=false`、`total=0`。
- 不変条件 `total === count + pending + missing` が全遷移で成立。
- `_gen` 世代ガード: reconnect/dispose 後の遅延 `whenDefined`/timeout コールバックが publish しない。
- same-value ガードで冗長 dispatch しない。
- カバレッジ閾値（100/97/100/100）を満たす。

---

## 9. 決定事項まとめ

| 論点 | 決定 |
|---|---|
| §0 ノード種別 | event-token 専用（command なし）・単調・終端あり |
| §1 焦点 | **autoloader 連携 + timeout 失敗検出**（CSS `:defined` の劣化コピーを避ける） |
| §2 公開 state | `defined` / `pending` / `missing` / `count` / `total` / `error`（1イベント・多 getter） |
| §2.1 不変条件 | `total === count + pending + missing` を常に保つ |
| §3 属性 | `tags`（必須・connect 時固定）/ `mode`（all/any）/ `timeout`（無指定=無限） |
| §5 決定1 | timeout 後の遅延定義は `missing`→`count` へ**昇格A** |
| §5 決定2 | invalid name は `error` ＋ `missing`、never-throw |
| §5 決定3 | `tags` 空は `error` ＋ `defined=false` 固定 |
| §6 分割 | `DefinedCore` / `WcsDefined`、permission を雛形 |
| パッケージ/タグ | `@wcstack/defined` / `<wcs-defined>` / Shell `WcsDefined` |

---

## 10. 実装順の推奨

1. `DefinedCore`（同期初期チェック ＋ `whenDefined` 配列 ＋ timeout ＋ 6 プロパティ ＋ 不変条件 ＋ `_gen` ガード ＋ same-value ガード）を permission の構造を写経して実装。
2. Shell `<wcs-defined>`（`tags` / `mode` / `timeout` 属性、display:none、connect/disconnect ライフサイクル）。
3. example: **autoloader 遅延ロードの readiness ゲート + 失敗フォールバック**。Import Map ＋ `@components/` で遅延ロードする `<my-chart>` を `<wcs-defined>` で待ち、`hidden@defined` でスピナー／`missing` でエラー表示。`count/total` の進捗も併置し、CSS `:defined` では出せない「失敗検出」を目玉にする。
4. README ja/en（CSS `:defined` との使い分け・autoloader 連携・単調性・timeout の意味・SSR での timeout 推奨を明記）。
5. types.ts / exports.ts / bootstrap / registerComponents は permission からコピーして名称置換。
