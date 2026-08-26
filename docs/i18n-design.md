# 設計: i18n / l10n — 多言語対応

- **状態**: 2026-08-27。**Phase 0 完了**（参照実装 `examples/router-i18n/` が browser で 20/20 green）。同日のレビューで **D1（ライブ切替）を降ろして再構成**し、Phase 0 の実測で **D9 を basename へ反転**した。§0 の決定レコードが正本。手順は [i18n-impl-plan.md](./i18n-impl-plan.md)。
- **対象**: `@wcstack/state`（規範と既存フィルタの修理）、`@wcstack/router` / `@wcstack/server`（連携）。**新規パッケージは作らない**（D7 決定・§8-2）。
- **一言で**: 「**翻訳はフィルタではなくパスである**」。ただし D1 を降ろした今、この決定を支えているのは依存グラフではなく**診断可能性**である（§2）。
- **前提**: **ロケールは起動時に確定する。切替はナビゲーション（`/en/...` への遷移）で行う。** リロードなしの切替は非目標（§0-2 / §11）。
- **依存**: **なし。** 初稿は [state-cross-state-read-design.md](./state-cross-state-read-design.md) に従属していたが、D1 を降ろしたことで**この依存は消えた**。i18n は単独で着地する（§0-2）。

---

## 0. 決定レコード

「状態」列は **決定**（合意提案として閉じている） / **要確認**（著者判断待ち） / **未決** を区別する。

| ゲート | 論点 | 決定（提案） | 状態 |
|---|---|---|---|
| **D1** | 切替の方式 | **ライブ切替は採らない**。ロケールは起動時に確定し、切替はナビゲーションで行う（§0-2） | 決定（**2026-08-27 に反転**） |
| **D2** | メッセージの表現 | **state のパス**。`\|t` フィルタも `t()` 関数呼び出しも採らない（§2） | 決定 |
| **D3** | 辞書の正本 | **ES モジュール**。`<wcs-state name="i18n">` はその射影を載せるだけ。実効ロケール 1 言語ぶん（§4） | 決定 |
| **D4** | 参照方法 | テンプレートは `@i18n`、getter は**辞書モジュールを直接 import**。クロス state 読み取りは**要らない**（§5） | 決定 |
| **D5** | 動的キー | 行 getter で import した辞書を引く。パス内添字は不可という既定の制約は変えない（§6） | 決定 |
| **D6** | 複数形・語形・書式 | 独自 ICU / MessageFormat は実装せず `Intl.*` に寄せる。ロケール固定なのでインスタンスは**モジュールレベルで作り置く**（§7） | 決定 |
| **D7** | ロケール決定の実装形 | **パッケージを作らない**。交渉・`lang`/`dir` 反映・`setConfig`・redirect はすべて **head の同期スクリプト**が担う。カスタム要素にはしない（§8-2） | 決定（**2026-08-27**） |
| **D8** | 既存フィルタ | 焼き込みを修理し、`config.locale` を**正規の仕組み**として位置づける。**既定は `<html lang>`**（実装済み）。不変条件は「`<html lang>` が state のロードより前」（§10） | 決定（**2026-08-27 に既定を追加**） |
| **D9** | router 連携 | **ロケールは router の basename に置く**（`<base href="/ja/">`）。`/:lang` ルートパラメータは採らない — basename 内のリンクは router に intercept され、言語が変わらないまま何も壊れて見えないため（§9-1）。未対応ロケールの redirect も head スニペットの責務 | 決定（**2026-08-27 に Phase 0 の実測で反転**） |
| **D10** | SSR | **ハイドレーション前にロケールが確定していること**。`<html lang>` が正（§9-3） | 決定 |
| **D11** | 非目標 | 抽出ツール / `{{ }}` 内の関数呼び出し / 独自 ICU / 訳文への markup 埋め込み / 同梱辞書のマージ / **ライブ切替**（§11） | 決定 |
| **D12** | 静的検査 | 未定義メッセージキーを検出する。**辞書が素のデータになったので既存のパス存在検査がそのまま効く**（§12） | 決定（初稿の「暫定」から昇格） |
| **D13** | ロケールの決定順 | **URL > 明示選択(storage) > `navigator.languages` 交渉 > fallback**。決定は起動時 1 回（§8-1） | 決定 |
| **D14** | 訳漏れの扱い | 素のデータなのでバインド確立時に `wcs/binding-path-missing` が出る。描画は空 ＋ 警告 ＋ lint 誘導（§4-1 / §12） | 決定 |

初稿からの差分: 旧 D14（切替の中間状態）は D1 の反転で**消滅**、旧 D15（訳漏れ）を D14 に繰り上げた。旧 D7（タグの責務）は D7（実装形）に置き換えた。

**2026-08-27 の追記（実装確認による反映）**: D7 を候補 A（パッケージを作らない）で確定。**D9 は 2 度動いた** — まず redirect 担当を router guard から head スニペットへ移し（guard は redirect 先を動的に決められない・§9-1-2）、次に Phase 0 の実測で **`/:lang` ルートパラメータから basename へ反転した**（basename 内のリンクは intercept され、言語が変わらないまま何も壊れて見えない・§9-1-1）。

**Phase 0 完了（2026-08-27）**: 参照実装 `examples/router-i18n/` が Playwright で 20/20 green。§4〜§7 の形はすべて書いたとおり動いた。崩れた前提と修正は [i18n-impl-plan.md](./i18n-impl-plan.md) の Phase 0-結果に記録した（D9 の反転、`<wcs-state src>` の URL 解決バグ、deep freeze、構造レンダリングの置き場）。

### 0-1. 品質特性の優先順位

**本設計が最適化する順序。以降のすべての決定はこの順位に照らして読む。**

1. **不変条件の保全** — 「更新されるものは依存グラフに載っている」。これを破る決定は、他にどんな利点があっても採らない
2. **予測可能性 / 診断可能性** — 失敗は loud に、症状は原因の近くに出す
3. **性能** — 変わったものだけ更新する
4. **記述量（DX）** — 宣言の少なさ

順位が実際に効く場所:

- **§2（フィルタ案の棄却）は 2 で決まる**。D1 を降ろした結果、フィルタでも「動く」ようになった。それでも採らない理由は診断可能性である（初稿は 1 を主根拠にしていた。§2 参照）
- **§4（辞書の形）は 4 と 2 が両立する**。ライブ切替を降ろすと辞書は素のデータでよく、宣言も要らず、検査も効く。初稿にあったトレードオフ（粒度の未決）は消滅した
- **§10（`config.locale`）は 2 で決まる**。起動順序の事故を黙って残さないことが目的で、性能の話ではない

### 0-2. D1 を降ろした理由と、再検討のトリガ

初稿はライブ切替（リロードなしの言語切替）を前提に置き、それが設計をほぼ一意に決めていた。**実要求が見いだせなかったため降ろす（2026-08-27）。**

**降りたことで消えるもの:**

- **クロス state 読み取り（[別書](./state-cross-state-read-design.md) Phase 1–3）への依存**。これが最大の効果で、i18n はもう単独で着地する。評価スタックのモジュール化という state core 最大の性能リスクを、i18n の都合で引き受けずに済む
- 辞書を依存グラフに載せるための `t.*` ゲッター宣言と、その粒度の未決
- 切替中の中間状態、`pending`、`Intl` インスタンスの配送経路
- shadow DOM のスコープ問題（§5）— 辞書をモジュールにできるので DOM スコープと無関係になる

**残るもの:** ロケール交渉、`lang` / `dir` 反映、router 連携、SSR のロケール確定、既存フィルタの修理、静的検査。**これらは切替方式と無関係**なので初稿のまま生きている。

**再検討のトリガ**（この前提が崩れたら本節ごと見直す）:

- 入力途中のフォーム・スクロール位置・開いているダイアログを保ったまま切り替えたい、という具体要求が出たとき
- URL にロケールを載せられない画面（ログイン後のダッシュボード等）で切替 UI が要るとき
- 1 ページに複数ロケールの領域が同居する埋め込み用途が出たとき

**復活経路は塞がっていない。** ライブ切替は「辞書を state のパスにする」という D2 の上にしか作れず、その D2 は維持している。辞書 state に `lang` を持たせて `t` を getter にすれば、初稿の形にそのまま戻せる（＋クロス state 読み取り）。**今回の縮小は将来の option を消していない。**

---

## 1. 現状の棚卸し

i18n の仕組みは**無い**。あるのは l10n の断片だけである。

| 資産 | 実体 | 評価 |
|---|---|---|
| `config.locale`（既定 `'en'`） | [config.ts:45](../packages/state/src/config.ts#L45)。`setConfig` で変更可 | グローバル・非リアクティブ。**D1 を降ろした今はこれが正しい形**（§10） |
| ロケール依存フィルタ **4 種** | `locale` / `date` / `time` / `datetime`（[builtinFilters.ts](../packages/state/src/filters/builtinFilters.ts)） | 起動時 1 言語なら動く。ただし焼き込みが順序に弱い（§1-1） |
| 外部 state ソース | `<wcs-state src="....json">` / `src="....js"`（[State.ts:236-247](../packages/state/src/components/State.ts#L236)） | **辞書の配送路として今日使える** |
| router | lang セグメント・hreflang の概念なし | 未着手 |
| server | `<html lang>` を書くだけ | 未着手 |
| `packages/vscode-wcs` の messages | **拡張自身の UI 言語**。アプリの i18n とは無関係 | 混同しないこと |

### 1-1. 壊れているのは「切替できないこと」ではなく「起動順序に弱いこと」

```js
const date = (options?:string[]): FilterFn<string> => {
  const opt = options?.[0] ?? config.locale;   // ← 外側 ＝ バインド構築時に 1 回だけ
  return (value: unknown): string => value.toLocaleDateString(opt);
}
```

`IFilterInfo.filterFn`（[binding/types.ts:9](../packages/state/src/binding/types.ts#L9)）はバインド構築時に一度生成され、以後同じ関数が使い回される。**ロケールはクロージャに焼き込まれる。**

ライブ切替を採らないなら、焼き込むこと自体は害ではない。**実際に事故るのは順序**である。ロケールを決めて `setConfig({locale})` を呼ぶのが遅れると、それより前に構築されたバインドは既定の `'en'` を焼き込んでいる。しかも `config.locale` の変更は依存グラフに載らないので、後から直しても再描画されない。症状は「**同じページの中で日付だけ英語**」で、原因（呼び出し順序）から遠い場所に出る。

したがって修理は「ライブ切替のため」ではなく「**順序事故を黙って残さないため**」に行う。修理と不変条件の明文化はセットである（§10）。

---

## 2. 規範: 翻訳はフィルタではなくパスである

一番書きたくなる形はこれである。

```html
<!-- 採らない -->
<h1 data-wcs="text: 'greeting'|t"></h1>
```

**D1 を降ろした結果、この形は「動かない」わけではなくなった。** ロケールが起動時固定ならフィルタにロケールを焼き込んでも正しく、依存グラフの問題も起きない。初稿の主根拠（ロケールという第二の依存をグラフに登録できない）は、もう効かない。

それでも採らない。**理由が入れ替わる。**

- **辞書の置き場が無くなる**。フィルタから辞書を引くには**グローバルな辞書レジストリ**が要る。`<wcs-state>` にも ES モジュールにも載らないデータができ、D3 と衝突する
- **訳漏れが見えなくなる**（優先順位 2）。`'greeting'` は文字列リテラルであってパスではない。パスなら、バインド確立時の存在検査が `wcs/binding-path-missing` を出し（[pathDiagnostics.ts](../packages/state/src/pathDiagnostics.ts)）、lint も IDE も同じ語彙で同じ場所を指せる。フィルタ引数の文字列は三面のどこからも見えない
- `data-wcs` の規範「**端点指定と線上変換のみ許容、計算は state 側に押し出す**」に反する。辞書引きは変換ではなく参照解決である

**結論が切替方式に依存していないことが重要である。** 前提（D1）を反転させても結論は変わらず、根拠だけが差し替わった。根拠が 1 本折れても立っている ＝ **D2 は D1 より安定した決定**であり、将来 D1 を復活させても書き直しにならない。

### 決定

**メッセージ辞書はパスとして引ける形に置き、参照はただのパスにする。**

```html
<wcs-state name="i18n" src="/i18n/state.js"></wcs-state>

<h1 data-wcs="text: t.greeting@i18n"></h1>
```

`@stateName` によるクロス state バインドは**既にある**ので、テンプレート側はこれで完結する（[state-cross-state-read-design.md](./state-cross-state-read-design.md) §2）。**新規コードはゼロ**である。

---

## 3. 層の分割

| 層 | 責務 | 実装コスト |
|---|---|---|
| **層 0: 辞書モジュール** | メッセージの**正本**。`import` で誰からでも読める（§4） | **新規コードゼロ**。規約とドキュメントだけ |
| **層 1: 辞書 state** | 層 0 の射影。テンプレートから `@i18n` で引くためだけに存在する | **新規コードゼロ**。`<wcs-state src>` で足りる |
| **層 2: ロケール決定** | 交渉・`lang`/`dir` 反映・`config.locale` 設定・未対応ロケールの redirect（§8） | 数十行の **head 同期スクリプト**。パッケージにはしない（D7） |
| **層 3: フィルタと `config.locale`** | 既存 l10n 資産の修理と規範化（§10） | state 内の小修正 |

**層 0 と層 1 を分けるのが今回の再構成の核である。** 辞書の正本をモジュールに置くと、getter からは `import`、テンプレートからは `@i18n` という 2 経路が**どちらも今日のコードで**成立する。クロス state 読み取りも、shadow DOM のスコープ遡上も要らない（§5）。

---

## 4. 辞書の形

### 4-1. 正本は ES モジュール

```js
// /i18n/catalog.js  ← 辞書の正本。誰でも import できる
const lang = document.documentElement.lang || "en";

const [current, fallback] = await Promise.all([
  import(`./${lang}.js`),
  import("./en.js"),
]);

export { lang };
export const t = mergeAndDeepFreeze(fallback.default, current.default);
```

- **ロケールは `<html lang>` から読む**。これは SSR ではサーバーが、静的ページでは head のスニペット（§8）が、DOM 解析前に書いている。**モジュール評価時点で必ず確定している**のがこの形の要点
- **fallback はロード時に deep merge する**。ロケールが動かないので、実行時に 1 キーずつ fallback を辿る必要が無い。shallow merge では足りない — パスは階層で解決されるため、`t.form.submit` を書くには `form` がネストしたオブジェクトである必要がある
- **deep freeze した plain object にする**。`Object.freeze` は浅いので、根だけ凍らせても `t.orders` は書き換え可能なまま残り、そこに誰かが getter を足せてしまう（Phase 0 の実測で判明）。理由は 2 つあり、後者のほうが見落とされやすい。(a) 辞書は不変なので誤書き込みを即エラーにできる。(b) **訳漏れ診断の前提**である — 実行時のパス存在検査は **getter に当たった時点で `UNKNOWN` を返して打ち切る**（[pathDiagnostics.ts:161](../packages/state/src/pathDiagnostics.ts#L161) 付近の `typeof descriptor.get === "function"` 分岐）。辞書が value descriptor だけで構成されている限り検査は最後まで進み `missing` を確定できる。**辞書に getter を 1 つ足すだけで §12 の診断がその枝ごと静かに死ぬ**（§4-3 / §12）
- 動的 `import()` とトップレベル `await` を使う。バンドラもビルドも要らない（buildless 原則）

### 4-2. state はその射影

```js
// /i18n/state.js  ← <wcs-state name="i18n" src="/i18n/state.js">
import { lang, t } from "./catalog.js";
export default { lang, t };
```

`<wcs-state src="....js">` は module の default export を state にする（[State.ts:242](../packages/state/src/components/State.ts#L242)）。**辞書のためのゲッターは 1 つも要らない。**

初稿にあった「`t.*` を 1 つずつ宣言するか、`t` をオブジェクトごと 1 パスにするか」という粒度の未決は、**依存グラフに載せる必要が無くなったので消滅した**。素のデータなので、パス存在検査もそのまま効く（§12）。

### 4-3. 訳漏れの扱い（D14）

素のデータなので、`t.typo@i18n` はバインド確立時に既存の診断で報告される。

```
[wcs/binding-path-missing] Bound path "t.typo" does not exist on state "i18n". Did you mean "t.title"? …
```

描画は空になるが、**警告が原因そのものを指す**（1 パス 1 回・`console.warn`・lint 誘導。[pathDiagnostics.ts](../packages/state/src/pathDiagnostics.ts)）。初稿は「キー文字列を描画して目視で気づく」形にしていたが、素のデータでは既存の三面共有診断がそのまま働くので、**i18n 専用のフォールバックも専用の診断コードも要らない**。

fallback のマージ（§4-1）があるため、実運用で空になるのは「**どの言語にも無いキー**」＝ 打ち間違いだけである。言語間のキー集合の突合は §12 が担う。

---

## 5. 参照方法

| 参照元 | 形 | 状態 |
|---|---|---|
| テンプレート | `data-wcs="text: t.greeting@i18n"` | **既存機能**。今日動く |
| state の getter | `import { t } from "/i18n/catalog.js"` | **標準の ESM**。今日動く |
| shadow DOM を持つコンポーネントの中 | 同上（**モジュールなので DOM スコープと無関係**） | 今日動く |

**初稿で最大の障害だった shadow DOM のスコープ問題が消える。** state 名は rootNode（Document / ShadowRoot）ごとに登録されるので、shadow の内側から document 直下の `<wcs-state name="i18n">` は見えない。この制約は今も変わらないが、**コンポーネント側は同じ `catalog.js` を import すればよい**。モジュールキャッシュにより実体は 1 つで、正本は 1 箇所のままである。

したがってクロス state 読み取りのスコープ遡上も、`$refs` 宣言も、i18n には要らない。

---

## 6. 動的キーの翻訳

「行の `status` コードをラベルに変える」。パスは正規化キーなので `t[item.status]` のような添字は書けない（既定の制約。変えない）。**行 getter で解決する。**

```js
import { t } from "/i18n/catalog.js";

export default {
  items: [],
  get "items.*.statusLabel"() {
    return t.status[this["items.*.status"]];   // 辞書は import 済み。越境しない
  },
};
```

```html
<template data-wcs="for: items">
  <li data-wcs="text: items.*.statusLabel"></li>
</template>
```

初稿はここでクロス state 読み取り（`this.$refs.i18n`）を要求していた。**辞書が不変なので、依存を張る必要がそもそも無い**のがポイントである。「計算は state 側に押し出す」という既存規範とも同じ方向を向いている。

---

## 7. 複数形・語形・書式

**独自の ICU MessageFormat パーサは実装しない。** zero-runtime-dependency と「最新 ECMAScript を使う」という 2 つの規範の両方に反する。

ロケールが固定なので、**フォーマッタはモジュールレベルで作り置ける**。初稿にあった「`Intl` インスタンスをどう配送するか（タグのキャッシュ / state / フィルタ引数）」という未決は消滅した。state に非シリアライズ値を入れずに済むので、SSR の直列化とも衝突しない。

```js
// /i18n/format.js
import { lang } from "./catalog.js";

export const nf     = new Intl.NumberFormat(lang);
export const plural = new Intl.PluralRules(lang);
export const rtf    = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
```

```js
import { t } from "/i18n/catalog.js";
import { plural } from "/i18n/format.js";

get "cart.summary"() {
  const n = this.cart.length;
  return t.cart[plural.select(n)].replace("{n}", n);
}
```

**将来**: `Intl.MessageFormat`（MessageFormat 2.0）が提案段階を抜けたら、それをそのまま露出する。**先回りして似たものを自作しない**。自作すると、標準が来たときに移行できない独自資産になる。

言語切替 UI の言語名表示には `Intl.DisplayNames` を使う（自前の言語名テーブルを持たない）。

---

## 8. ロケールの決定

やることは 4 つしかなく、**4 つとも head の同期スクリプトが担う**（D7・§8-2）。

1. **交渉** — `navigator.languages` × 対応ロケール一覧 × fallback から実効ロケールを決める。`Intl.getCanonicalLocales` と `Intl.*.supportedLocalesOf` で最小の lookup マッチングを行う（`Intl.LocaleMatcher` は提案段階なので依存しない）
2. **`document.documentElement` の `lang` / `dir` 反映**
3. ~~`config.locale` を実効ロケールに合わせる~~ — **不要になった**。`bootstrapState` が `locale` 既定を `<html lang>` から採るようにしたので（2026-08-27）、2 番を済ませた時点でフィルタのロケールも決まっている。スニペットの手順は 3 つになった
4. **URL にロケールが無い / 未対応のとき、正しい URL へ redirect する** — `location.replace` で、**DOM 解析前に**。router の guard ではない（§9-1-2）

### 8-1. 決定順（D13）

`lang` を決めうる入力は 4 つある — URL、明示選択（`localStorage`）、`navigator.languages`、fallback。

**決定: URL（`/:lang`）> 明示選択 > `navigator.languages` 交渉 > `fallback`。**

- 実効ロケールの決定は**起動時に 1 回だけ**。以後変わらない（D1）
- URL にロケールがあるならそれが正。**ユーザーがリンクを共有したときに言語が変わらない**ことがこの順位の理由
- URL に無い（`/` への初回訪問など）ときだけ、明示選択 → 交渉の順に落ちる。結果は redirect で URL に反映する（URL が正である状態に収束させる）
- SSR ページでは**サーバーが書いた `<html lang>` が URL と同じ地位**を持つ。クライアントがそれを上書きしてはならない（§9-3）

`dir`（RTL）は当面、対応ロケール一覧の宣言（`ja,en,ar:rtl` 相当）から取る。`Intl.Locale` の text info はブラウザ差があるため、それに依存しない道を既定にする（§14-1）。

### 8-2. 決定: パッケージを作らない（D7）

初稿は `<wcs-i18n>` という新パッケージを立てていた。**採らない。** 層 2 は `<head>` の同期スクリプトとして配る。

```html
<script>
  // 対応ロケールと fallback だけを持つ数十行のスニペット
  // 1) 交渉 → 2) lang / dir → 3) setConfig → 4) 不正ロケールなら location.replace
</script>
```

**カスタム要素にしないのは、好みではなく実行タイミングの問題である。**

- 上の 1〜3 は**辞書モジュールが評価されるより前**に終わっていなければならない（§4-1 は `<html lang>` を読む）。カスタム要素は定義がロードされて upgrade された後に動くので、**構造的に間に合わない**
- 4（redirect）は実行が遅いほど無駄な描画とネットワークが増える。DOM 解析前の `location.replace` なら**描画もフェッチも一切発生しない**
- 「1 タグ 1 プラットフォーム API」に照らしても、ここに固有の Web API は無い。`Intl` と `navigator.languages` は関数呼び出しで足り、**監視すべき状態を持たない**。タグは状態を観測し続けるためのものであって、起動時に 1 回だけ走る手続きの置き場ではない

**棄却した候補 B（`@wcstack/i18n` を作る）**: 本体を「`<script>` に貼るブートストラップ関数」にし、カスタム要素は `lang` / `dir` / `supported` を `wcBindable` で露出する薄い観測タグに留める案。**唯一の利点は CDN 一発の導線**だが、それは設計上の必要ではなく訴求上の都合であり、パッケージ 1 個ぶんの運用（個数の記載箇所・バージョン整列・SRI・README 英日）を恒久的に負う対価に見合わない。

**この決定が残していた唯一の弱点（テストの置き場）は塞がった。** スニペットは `e2e/tests/router-i18n.spec.ts` が実ブラウザで検証する。単体テストでは同期スクリプトの実行順序も `location.replace` も `<base>` も見えないので、e2e のほうが忠実度でも勝る（§14-2）。

---

## 9. 連携

### 9-1. router

言語切替がナビゲーションになったので、**router が i18n の主役**である。

**ロケールは router の basename に置く。ルートパラメータにはしない。**（2026-08-27・Phase 0 の実測で反転）

- **`/:lang` を採れない理由**は下の 9-1-1。ひとことで言うと、basename の内側にある言語リンクは router に intercept され、**言語が変わらないまま何も壊れて見えない**
- basename は head スニペットが `<base href="/ja/">` を書いて渡す（§8 の 3 番）。`basename` 属性を使うと「`<wcs-router>` がパース済みで、かつ upgrade 前」という狭い窓を狙うことになる
- **ルートパターンからロケールが消える**（`/`・`/about`）。組み込みパラメータ型がユーザー拡張できない（[types.ts:40](../packages/router/src/types.ts#L40)、`RouteCore` が `Object.keys(builtinParamTypes)` で検査）ことも、ロケールセグメントの型検証も、**論点ごと消滅する**
- アプリ内リンクもロケールを持たない（`<wcs-link to="/about">` が basename を前置する）。「現在のパスからロケールセグメントを差し替えるヘルパ」も要らない
- 言語切替 UI は**ただのリンク**である（`<a href="/en/products">`）
- 制約 1 つ: `<base>` を使う以上、**ページ上の URL をすべて絶対にする**
- **未対応ロケールの redirect は router では書けない**（9-1-2）。head スニペットの責務
- 初稿の「basename とは分離する（1 デプロイ 1 言語になる）」は、basename を**実行時に**決めるこの形には当たらない。1 つのデプロイが全言語を配る

#### 9-1-1. `/:lang` を採れない理由

`<wcs-router>` は **basename 配下の同一オリジンナビゲーションをすべて** `intercept()` に渡す（[Router.ts:222-243](../packages/router/src/components/Router.ts#L222)）。素の `<a>` クリックも Navigation API 経由でここに来る。

ロケールがルートパラメータだと、言語リンク `/en/products` は basename（空）の内側にあるので **intercept される**。するとページはリロードされず、辞書モジュールは再評価されず、**言語は変わらない**。しかも例外もエラーも出ない — 一番たちの悪い壊れ方をする。

basename が `/ja` なら `/en/products` は `_isOwnPath` を外れ、router は intercept を辞退し、ブラウザが本物のナビゲーションを行う。**「ただのリンクで切り替わる」は basename のおかげで成立する。**

#### 9-1-2. redirect を guard に置けない理由（2026-08-27 の訂正）

初稿は「未対応ロケールの URL は guard で fallback ロケールへ redirect する」としていた。**これは書けない。**

router の guard は **redirect 先を動的に決められない**。`GuardCancel` に載る `fallbackPath` は `<wcs-route guard="...">` の**静的な属性値**がそのまま渡るだけで（[RouteCore.ts:364](../packages/router/src/core/RouteCore.ts#L364)、[showRouteContent.ts:37-40](../packages/router/src/showRouteContent.ts#L37)）、guard ハンドラの戻り値は真偽値のみでパスを返す口が無い。したがって `/xx/products` → `/en/products` のように**残りのパスを保ったままロケールだけ差し替える**ことは表現できない。`guard="/en"` と書けば `products` は失われる。

**解決: redirect は head スニペットが `location.replace` で行う**（§8 の 4 番）。これは代替案ではなく上位互換である。

1. head スニペットは DOM 解析前に走るので、**無駄な描画とネットワークが一切発生しない**。guard による redirect は route 解決まで進んでから引き返す
2. アプリ内リンクは常に正しいロケールを含む（切替 UI がただのリンクなので）。不正なロケールが入ってくる経路は**外部リンク・直打ち・ブックマークだけ**で、これらはすべてフルロード ＝ head スニペットを通る
3. SPA 内ナビゲーションで不正ロケールに到達しうるのはアプリ側のバグであり、静的 fallback（`guard="/en"`）で受け止めれば防御深度として十分

**したがって router の guard は「あってもよい保険」であって、i18n の必須部品ではない。**

#### 9-1-3. 構造レンダリングは router の外に置く

i18n 固有ではないが、多言語ページを書く人が最初に踏むので明記する。

`<wcs-route>` の中に置いた `<template data-wcs="for:">` / `if:` は**描画されない**。state がバインドを組み立てる時点でルートのノードは inert な `<template>` の中にあり、内側の構造フラグメントが登録されないためである。一方**ルート内の素のバインドは動く**（`<wcs-head>` の翻訳済み `<title>` も、静的ページの `@i18n` バインドも動く）ので、境界が見えにくい。

分担は `examples/router-spa` が既に確立している。**router は `path` を publish し、state がその外側の `<template data-wcs="if: …">` でデータ駆動の DOM を描く。**

### 9-2. `<wcs-head>`

**訂正（2026-08-27・Phase 2）**: 初稿は「`title` / `meta` は既存のバインドで `@i18n` を参照すれば翻訳できる。追加機構は不要（Phase 0 で実証済み）」としていた。**実証していなかった** — Phase 0 の検査は `document.title` を一度も見ていない。実際に確認すると**動かない**。

`<wcs-head>` は子要素を `cloneNode(true)` で `document.head` に反映する。`data-wcs` 属性はコピーされるが、**クローンは state がバインドしたノードとは別のノード**なので、バインドは決して届かない。結果は「翻訳されない」ではなく「**`<title>` が空になる ＝ ページからタイトルが消える**」で、untranslated より悪い。

したがって `<wcs-head>` 内のバインドによる翻訳は**現時点では成立しない**。Phase 3 の課題として [i18n-impl-plan.md](./i18n-impl-plan.md) に記録した。デモは `<wcs-head>` を置かず、document 自身の静的な `<title>` を残している。

`hreflang` も**今日書ける**。`<wcs-head>` は子要素を `cloneNode(true)` で head に反映するので属性はそのまま通り、`link` の重複判定キーは `link:{rel}:{href}:{media}` である（[Head.ts:117](../packages/router/src/components/Head.ts#L117)）。href が言語ごとに違う代替リンクはキーが衝突しない。

**実際のギャップは 1 点だけ**: `x-default` を代表ロケールと同じ href で併記すると、`rel` / `href` / `media` が同一になってキーが衝突し、片方が落ちる。キーに `hreflang` を含めれば済む。

ロケールごとに URL が分かれる（D9）ので、**`hreflang` は SEO 上ここで初めて意味を持つ**。ライブ切替を採っていたら 1 URL に複数言語が同居して、そもそも書きようがなかった。

### 9-3. SSR

**不変条件: ロケールはハイドレーション前に確定していること。** サーバーは URL の `:lang`（無ければ `Accept-Language`）から実効ロケールを決め、`<html lang>` に書く。クライアントの辞書モジュールはそれを読む（§4-1）ので、**両者がずれる余地が構造的に無い**。

D1 を降ろしたことで、初稿にあった SSR の課題 2 件が消えた。

- クロス state 読み取りの遡上を hydrate 経路（`hydrateBindings` の `getStateElementByName`）にも通す必要 → **不要**
- SSR の state 抽出（[Ssr.ts:161](../packages/state/src/components/Ssr.ts#L161)）が `$refs` を読む getter を raw な `this` で評価して壊れる問題 → **`$refs` を使わないので発生しない**

残るのは 1 点。辞書を state に射影している以上（§4-2）、**SSR の初期 JSON に辞書 1 言語ぶんが載る**。クライアントは `catalog.js` を import するので内容は二重に配られる。許容するか、SSR では `t` を state に載せず module 直読みに寄せるかは未決（§14-3）。

---

## 10. 既存フィルタと `config.locale`

D1 を降ろした結果、**`config.locale` は「降格した旧機構」ではなく、ロケールを 1 つ持つための正規の場所**になった。

| 対象 | 決定 |
|---|---|
| `locale` / `date` / `time` / `datetime` の焼き込み | **修理済み**（2026-08-27）。明示引数だけを構築時に確定し、既定の `config.locale` は適用のたびに読む |
| `setConfig({locale})` による再描画 | **しない**。グローバル設定は依存グラフに載らない。載せる裏口は作らない |
| `config.locale` の既定 | **`<html lang>`**（実装済み・2026-08-27）。明示 `bootstrapState({ locale })` が優先。不正な BCP-47 タグは警告して既定へ |
| 不変条件 | **`<html lang>` が state モジュールのロードより前に確定していること**。head のスニペット（§8）か、素のマークアップで満たせる |
| ライブ切替下でのフィルタ利用 | **該当なし**（D1 を降ろしたため）。フィルタは通常どおり使ってよい |
| `config.locale` の位置づけ | 「このページのロケール」。README に明記する |

**修理の目的は順序事故を消すこと**であって、切替を可能にすることではない。呼び出しごとに解決すれば、設定が多少遅れても**それ以降に構築されるバインドは正しくなる**（既に構築済みのものは再描画されないので直らない — だから不変条件も併記する）。修理と不変条件はセットで初めて意味を持つ。

**不変条件が守りやすい形に変わった点が重要である。** 「設定関数を早く呼ぶ」は順序の約束にすぎず、破っても静かに壊れる。既定を `<html lang>` にしたことで、条件は「**属性が state のロードより前にある**」になった。head の同期スクリプト（あるいはサーバーが書いた `<html lang>`）は module script より必ず先に走るので、これは構造的に満たされる。守るべき約束が 1 つ減ったのではなく、**守れる形の約束に置き換わった**。

**棄却した代替**: 「焼き込みのまま据え置き、`config.locale` 依存のフィルタを deprecate する（明示引数 `|date('ja-JP')` のみ支持）」。`|date` の既定が「このページのロケール」であること自体は仕様として自然で、壊れているのは順序に弱いことだけである。deprecate は既存ページに引数の追加を強いて黙って壊すので採らない。

---

## 11. 非目標

- **ライブ切替**（リロードなしの言語切替）— D1。再検討のトリガは §0-2
- **ビルド時のメッセージ抽出ツール** — buildless 原則に反する。代わりに静的検査（§12）で埋める
- **`{{ }}` や `data-wcs` 内での関数呼び出し**（`t('key')`）— `data-wcs` は配線であって DSL ではない
- **独自 ICU / MessageFormat 実装**（§7）
- **訳文への markup 埋め込み** — 訳文は**テキストとして扱う**。`html:` バインドに流さない。外部由来の文字列を innerHTML に入れる経路は XSS そのもので、CSP / Trusted Types の作業（[csp.md](./csp.md)）と正面から衝突する。強調やリンクが要る場合はメッセージを分割し、テンプレート側で組む
- **コンポーネント同梱辞書のマージ** — 第三者コンポーネントが自前のメッセージを持ち込む経路は扱わない。**アプリの単一カタログが正**。名前空間が要るならキーの命名規約（`t.myComponent.*`）で足りる範囲に留める
- **多段フォールバック連鎖** — `lang` → `fallback` の 1 段だけ。ロード時 deep merge で済ませる（§4-1）
- **ambient / グローバル state**（[state-cross-state-read-design.md](./state-cross-state-read-design.md) §4）

---

## 12. 静的検査

抽出ツールを作らない代わりに、**訳漏れを検査で捕まえる**。[static-wiring-dx-design.md](./static-wiring-dx-design.md) の延長として自然に載る。

**D1 を降ろしたことでこの検査は成立条件を得た。** 初稿では、辞書が getter の向こう側にあるため実行時のパス存在検査が `UNKNOWN` で打ち切られ（[pathDiagnostics.ts:161](../packages/state/src/pathDiagnostics.ts#L161)）、静的検査も「カタログの所在が分からない」という問題を抱えていた。素のデータになった今、**バインド確立時の検査は追加実装ゼロで効く**（§4-3）。静的側で足すのは次の 2 つ。

- `@i18n` を参照するバインドのパスが、辞書モジュールのキーに存在するか（`import` を辿ってキー集合を得る）
- **言語間でキー集合が一致しているか** — fallback で埋まってしまう訳漏れは実行時には見えないので、ここが唯一の検出点

**成立条件は「辞書に getter が 1 つも無いこと」である。** 実行時の検査は getter に当たると `UNKNOWN` で打ち切るので、辞書に getter を 1 個足すと**その枝の訳漏れが実行時にも静的にも見えなくなる**。§4-1 が辞書を `Object.freeze` した plain object と規定しているのはこのためでもあり、**利便のために辞書へ getter を導入する変更は、この節の検査を壊す**と理解しておくこと。

**罠**: 挙動の正本は `packages/vscode-wcs` だが、契約テストを lint 側にしか置かないと、壊れるのが次のビルド時になり CI マトリクスに乗らない。**契約テストは両側に置く**。過去に同型の事故が 2 回ある。

---

## 13. 段階

初稿は 6 フェーズで、うち 1 つ（クロス state 読み取り）が state core の大改造だった。**D1 を降ろして 5 フェーズになり、core に触る作業は無くなった。**

| Phase | 内容 | 成果物 | 依存 |
|---|---|---|---|
| **0** | 辞書モジュール ＋ `<wcs-state src>` ＋ `/:lang` のパターンを examples とドキュメントで示す。**新規コードゼロ** | `examples/` に多言語デモ、規約（ファイル配置・キー命名・deep merge ヘルパ）、本書の確定 | なし |
| **1** | 既存フィルタの焼き込み修理 ＋ 不変条件（ロケール確定はバインド構築前）を README に明記 | state の小修正 | なし |
| **2** | head スニペットの実装（交渉 / `lang`・`dir` / `setConfig` / redirect）。**新規パッケージは作らない**（D7） | README（英日）とデモのテンプレート ＋ `negotiate()` のテスト（置き場は §14-2） | Phase 0 |
| **3** | router 連携（`/:lang` を `slug` で受ける、切替リンクのヘルパ）、SSR 連携、`hreflang` の `x-default` キー修正。**redirect は Phase 2 で済んでいる** | router / server | Phase 2 |
| **4** | 静的検査（§12） | vscode-wcs / lint | Phase 0 |

**Phase 0 を飛ばさないこと。** この形は今日のコードで動くので、まず実際に多言語ページを 1 枚作る。特に確認したいのは、

- `<html lang>` → 辞書モジュール → `<wcs-state src>` の**評価順序が実際に成立するか**（§4-1 の前提。autoloader と併用したときが要注意）
- deep merge ヘルパをどこに置くか（利用者が書くのか、`@wcstack/state` が持つのか）
- shadow DOM を持つコンポーネントから同じ `catalog.js` を import する形の使い勝手（§5）

初稿と違い、**Phase 0 の適用範囲に制限は無い**（shadow DOM の内側でも今日動く）。ここで洗い出した痛点がそのまま以降の設計になる。

---

## 14. 未解決の論点

1. **`dir`（RTL）の決定源**（§8-1）— 宣言か `Intl.Locale` の text info か
2. ~~head スニペットのテスト置き場~~ — **解決**（2026-08-27）。`e2e/tests/router-i18n.spec.ts` に置く。e2e は examples をローカル dist で回す実ブラウザスモークで、新しい基盤が要らず、**同期スクリプトが module より先に走ることまで含めて**検証できる。D7（パッケージを作らない）の唯一の弱点はこれで塞がった（[i18n-impl-plan.md](./i18n-impl-plan.md) Phase 2-結果）
3. **SSR ペイロード**（§9-3）— 辞書 1 言語ぶんが初期 JSON に載るのを許容するか、SSR では state に射影せず module 直読みに寄せるか
4. **deep merge ヘルパの置き場**（§4-1）— 利用者が書く / `@wcstack/state` の stateLoader に足す / 規約として fallback マージ自体をやめる
5. **辞書の配布形式**（§4）— ES モジュール（`.js`）を正本にしたが、翻訳者が触るのは JSON のほうが自然という要求が出たら、`.json` を正本にして `catalog.js` が読む形に反転する余地がある

初稿にあった未決のうち、**5 件は D1 を降ろしたことで消滅した**（`t` の粒度 / カタログのロード主体 / フォーマッタの配送経路 / SSR の `$refs` getter 評価 / クロス state 読み取り側の未決 5 件への従属）。さらに **1 件（ロケール決定の実装形）は D7 の確定で解消**し、代わりにその副産物（テスト置き場）が 2 番に入った。

手順は [i18n-impl-plan.md](./i18n-impl-plan.md)。
