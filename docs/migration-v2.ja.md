# wcstack 1.x → 2.x 移行ガイド

**English**: [migration-v2.md](./migration-v2.md)

wcstack 2.0.0（2026-09-04）の主題は 1 つです。**State は 1 つのルートノードに 1 本のツリー。拡張はマウントで行い、名前では行わない。** State を *名前* で指していたもの — `name` 属性、パスの `@name` セレクタ、そして SSR・devtools・manifest・`@wcstack/testing`・`wcs-schema` の名前を前提にした面 — はすべて撤去され、*マウントパス* に置き換わりました。バインディング構文のそれ以外の部分は変わっていません。

`<wcs-state name="…">` もパス中の `@` も使っていなかったページなら、このガイドのランタイム部分は何もしなくてよい変更です。それでも [§4 構文ではない挙動の変更](#4-構文ではない挙動の変更) と [§5 ツール](#5-ツール) には目を通してください。1.32.0 より前から上げる場合は [§7 1.x 後期の変更](#7-1x-後期にも変わったもの) も対象です。

設計の記録は [state-mount-design.md](./state-mount-design.md)、リリースごとの一覧はルートの [CHANGELOG](../CHANGELOG.md)（英語）にあります。

## 1. 考え方

v1 では 1 ページに独立した State ツリーを複数置け、名前で区別していました。

```html
<wcs-state name="cart" src="./cart.js"></wcs-state>
<wcs-state src="./app.js"></wcs-state>          <!-- name="default" -->

<span data-wcs="textContent: total@cart"></span>
<span data-wcs="textContent: user.name"></span>  <!-- @default 省略 -->
```

v2 のツリーは 1 本です。2 つ目の `<wcs-state>` は **ボリューム** になります。データは *マウントパス* の位置にツリーへ接ぎ木され、バインディングは接頭辞付きで読みます。

```html
<wcs-state mount="cart" src="./cart.js"></wcs-state>
<wcs-state src="./app.js"></wcs-state>

<span data-wcs="textContent: cart.total"></span>
<span data-wcs="textContent: user.name"></span>
```

ボリュームの中身は変わりません。`cart.js` は今までどおり `this.total` と書き、getter・`$watch`・`$listKeys`・`$updatedCallback`・ライフサイクルはすべてマウントパス相対で動きます。ルートとボリュームの読み込み順は問いません。

コンポーネントも同じ考え方です。`bind-component` はホストツリーのパスに *マウント* されます — プロパティ単位（`state.message: user.name`、v1 と同じ）でも丸ごと（`state: user`、新設）でも — そのバインディングは登録時にホストツリーの絶対パスへ変換されます。Light DOM コンポーネントも同じ書き方になり、名前は不要です。

## 2. 機械的な手順

まずバリデータを通してください。対象箇所を全部 **error** で列挙し、置き換え先を文言で示します。

```bash
npx @wcstack/lint index.html            # または VS Code の WcStack IntelliSense 拡張
```

そのうえで:

1. **`<wcs-state name="x"` → `<wcs-state mount="x"`。** `name="default"` は単に削除します。`name=` はランタイムが誘導文付きで fail-fast します。
2. **`path@x` → `x.path`、`path@default` → `path`。** `data-wcs`・`{{ }}`・`<!--@@:-->`・spread（`...: obj@x` → `...: x.obj`）・省略パス（`.name@x` → `.name`）のすべてで。v2 ではパス中の `@` は parse error です。
3. **plain な Light DOM `bind-component`**（shadow root が無く、ホストからの配線も無いもの）は v2 では存在できません。`this.attachShadow({ mode: "open" })` を 1 行足すか、ホストから配線します（`<my-c data-wcs="state: path">`）。ランタイムは誘導文付きで raise します。
4. **`@wcstack/testing`:** `state("x")` → `state()`。読み書きするパスに `x.` を付けます。引数を渡すと移行ヒント付きで throw します。
5. **`wcs-schema`:** `wcs-schema emit` を再実行します。manifest は `schemaVersion` 2（ツリー全体で 1 つの `stateSchema`）になります。ボリュームの型ファイルは `--mount=<path>` でその部分木として出力します。旧 `--state=` は usage error です。

単純リネームで済まない宣言は 4 つだけです。ボリュームでは **`$streams` は raise**、**`$commandTokens` / `$eventTokens` / `$on` は warn** になるので、ルート State へ移してください。それ以外の宣言はマウント相対で動きます。

## 3. 破壊的変更の全表

| v1 | v2 | 検出 |
|---|---|---|
| `<wcs-state name="x">` | `<wcs-state mount="x">` | 実行時 fail-fast（誘導文付き）／lint `wcs/named-state-deprecated`（error） |
| `path@x` / `path@default` — `data-wcs`・`{{ }}`・`<!--@@:-->`・spread・省略パス | `x.path` / `path` | parse error（誘導文付き）／lint error |
| plain（配線なし）Light DOM `bind-component` | shadow root を付けるか、ホストから配線（`state: path`） | 実行時 raise（誘導文付き） |
| mapped コンポーネントの own key 既定値（`state = { message: "" }` がマッピングに覆われる形） | 規則 **R1**: コンポーネント自身の data キーは私有で、マッピングに覆われない — 既定値を削除 | `wcs/mount-own-key-shadow` warn |
| 同一コンポーネントへの複数 `<wcs-state bind-component>`（別 prop） | 1 コンポーネント 1 マウントスコープ。配線を 1 本にまとめるかコンポーネントを分割 | 実行時 raise（誘導文付き） |
| 接ぎ木済みボリューム／マウントのあるツリーへの `setInitialState()` 再 set | 変更したいパスを個別に書く | 実行時 raise（丸ごと再 set は接ぎ木・アクセサ・台帳を無言で壊すため） |
| マウントされたコンポーネントのワイルドカード終端アクセサ（`get "tags.*"()` がホストツリーのリストへ翻訳される形） | ホストツリー側の getter か、コンポーネント私有の配列 | 実行時 raise（誘導文付き） |
| `$updatedCallback` への他 State パス配送（`path@name` 合成） | 名前次元ごと撤去。ボリュームの `$updatedCallback` は自分の接頭辞配下の更新を **相対パス** で受ける | 届く形が変わる — §4 |
| SSR `<wcs-ssr name>` / `Ssr.findByName` | name なし `<wcs-ssr>` / `Ssr.find(root)`。1.x サーバーが書いた name 付きスナップショットも読める | — |
| `@wcstack/server` の `extractStateData()`（1.x で deprecated） | `@wcstack/state` の `Ssr.extractStateData()` | import エラー |
| devtools hook protocol v1（state 名を取る `keys` / `read` / `write`・`stateName` payload） | protocol **v2**: `keys(rootNode)` 等・`overlays(rootNode)` 新設 | `version: 2`（first-wins）— 旧 devtools ビルドは何も表示しない |
| manifest `states[name].stateSchema`（`schemaVersion` 1） | 単一 `stateSchema`（`schemaVersion` 2）。ボリュームはマウントパスの部分木 | 読み手が移行ヒント付き error |
| `@wcstack/testing` `state(name)` | `state()` | 引数はヒント付き throw |
| `wcs-schema --state=<name>` | `--mount=<path>` | usage error（ヒント付き） |
| `IStateElement.name` / `State.name`（2.1.0） | 削除 — 常に `"default"` だった | TypeScript エラー |

## 4. 構文ではない挙動の変更

- **ボリュームの `$updatedCallback`** は、マウント配下のパスを相対パス（`cart.total` ではなく `total`）で、かつそれだけを受けます。ルートのコールバックは絶対パスを受けます。どちらも私有マーカーパス（`#m<id>`）は受けません — 2.1.0 でフィルタされました。マウントの可視化は devtools（`overlays()`）の担当です。
- **規則 R1（own key は私有）。** プロパティ単位でマウントされたコンポーネントで、コンポーネント自身が `state` に宣言したキーはマッピングに覆われません。v1 ではマッピングが黙って影を落とせました。ランタイムは `wcs/mount-own-key-shadow` で warn します。直し方は冗長な既定値の削除です。
- **`mount=` は静的です。** マウントパスに `*`・`$`・`#`・`@` は使えません（`wcs/mount-path-invalid`・error）。初期化後の `mount` 変更は無視されます — 2.1.0 からコンソール warn が出ます — 要素を取り除いて新しいパスの要素を足してください。
- **1 コンポーネント 1 マウントスコープ。** 同じコンポーネントの別 prop を 2 つの `<wcs-state bind-component>` で配線すると raise します。台帳はコンポーネントごとに 1 本です。
- **`setInitialState()` による丸ごと再 set** は、接ぎ木のあるツリーでは raise します。個別パスを書いてください。
- **性能** は、コンポーネントもボリュームも無いページでは不変です（実測ゲート済み）。行がコンポーネントのリストは速くなりました（create 1k −24%・update −45%・ヒープ −1.5KB/行）。

## 5. ツール

| ツール | 変わること |
|---|---|
| `@wcstack/lint` / VS Code 拡張 | `wcs/named-state-deprecated` は **error**（1.33 では warning）。`wcs/mount-path-invalid` を新設。拡張の `@` State 名補完は無くなった |
| `wcs-schema`（`@wcstack/typescript`） | `--state=` の代わりに `--mount=<path>`。出力は `schemaVersion` 2・単一 `stateSchema`。`--merge` は書き込むスロット（schema 全体、または `--mount` の部分木）だけを置き換える |
| manifest 付きの `wcs-validate` | `schemaVersion` 1 の manifest は移行ヒント付きで拒否 — 再生成する |
| `@wcstack/testing` | `state()` は引数なし。ボリュームは接頭辞で読む。`mount()` は DOM のマウント、`mount=` は State のマウント |
| `@wcstack/devtools` | hook protocol v2。2.x の `@wcstack/state` が必要。`overlays(rootNode)` が新しいマウント行の元。無いランタイムでは節ごと非表示 |
| `@wcstack/server` | `extractStateData()` 削除（`Ssr.extractStateData()` を使う）。`<wcs-ssr>` に `name` は無い。`Ssr.find(root)` が `findByName` の後継 |
| `wcstack/auto`・CDN ピン | 全パッケージ同時リリース。`@wcstack/*` のタグは全部同じ版に揃える。リリースごとの SRI ダイジェストは GitHub Release ページと [sri.ja.md](./sri.ja.md) |

## 6. チェックリスト

```text
[ ] npx @wcstack/lint <全 html>          → error ゼロ
[ ] name="…" → mount="…"（name="default" は削除）
[ ] path@x → x.path ; path@default → path（data-wcs, {{ }}, <!--@@:-->, spread, 省略パス）
[ ] Light DOM bind-component: shadow root かホスト配線
[ ] $streams / $commandTokens / $eventTokens / $on はルート State に置く（ボリュームに置かない）
[ ] テスト: state("x") → state() + "x." 接頭辞
[ ] wcs-schema emit 再実行（schemaVersion 2・ボリュームは --mount）
[ ] server: extractStateData → Ssr.extractStateData ; Ssr.findByName → Ssr.find
[ ] devtools: 2.x の state と 2.x のビルドを組で使う
[ ] @wcstack/* のピンを 1 つの版に揃える
```

## 7. 1.x 後期にも変わったもの

1.32.0 より前から上げる場合、次は minor リリースで入った変更で、v2 のリネームとは独立に影響します。

- **1.32.0 — `config.locale` の既定が `<html lang>`** に（旧 `'en'`）。`lang` が英語以外のページでは `|date` / `|time` / `|datetime` / `|locale` の出力が変わります。旧出力を保つなら `config.locale` を明示します。
- **1.32.0 — `indexes` 省略時の `$getAll(path)`** は全件ではなく囲んでいるループ文脈を既定にします。`[]` は引き続き全件。ループ外で共有ワイルドカードがある場合は throw します。
- **1.32.0 — `<wcs-route>` の `static wcBindable`**（`params` / `typedParams` / `active`）を削除。router 側の `params` / `typedParams` / `searchParams` / `routeName` にバインドしてください。`wcs-route:*` イベントは引き続き発火します。
- **1.32.0 — same-match ナビゲーション**: 同じルートへのクエリだけの遷移では guard の再実行・コンテンツの再スタンプ・view transition の要求をしなくなりました。
- **1.31.0 — バリデータの severity**: `wcs/nested-assign`・`wcs/array-mutation`・`wcs/array-index-assign` が error になりました。
- **1.33.0 — `stateSchema` の消費**: state を宣言した manifest があると、未知のパスは error（`wcs/path-nonexistent`）になり、manifest は HTML から最も近い `wcstack.manifest.json` が自動発見されます。
