# wc-bindable SPEC 改訂提案: undefined 書き込みの扱いを規範化する

- **提案先**: wc-bindable-protocol リポジトリ（SPEC.md, protocol = `"wc-bindable"`, version 1）
- **提案元の文脈**: wcstack（@wcstack/state の binder ＋ @wcstack/fetch ほか wc-bindable 準拠タグ群）
- **状態**: wcstack 側は参照実装まで完了（2026-06-11、未リリース）。本文書は SPEC への規範文言追加の提案とその根拠をまとめたもの
- **TL;DR**: binder は `undefined` を properties / inputs に書いては**ならない**（MUST NOT — 書き込み自体をスキップ）。明示クリアは `null` で表現する。要素は `undefined` への防御を**推奨**（SHOULD）

---

## 1. なぜ SPEC に書く必要があるのか

wc-bindable は「要素が宣言し（`static wcBindable`）、binder が配線する」契約である。spread のような一括配線（wcstack では `...: target`）は、binder が `properties + inputs` を**機械的に列挙**して N 本の個別バインディングへ展開する。

機械列挙である以上、データソース（state）側が列挙された全パスに値を持っている保証はどこにもない。未定義パスの値は JavaScript 上 `undefined` であり、**これを要素プロパティへ「書く」か「書かない」かは、現行 SPEC が何も言っていないため binder の解釈に委ねられている**。

この無言には2つの帰結がある:

1. **binder ごとに挙動が割れる**。同じ要素・同じ state でも、配線に使う binder によって壊れたり壊れなかったりする。相互運用プロトコルとしての価値を直接損なう。
2. **要素作者が最悪ケース防御を全員強いられる**。binder が undefined を書いてくるかもしれない世界では、すべての wc-bindable 要素の全 setter が undefined 防御を書かなければ安全にならない。契約で一度決めれば済むことが、実装者全員への暗黙の義務に転化する。

つまりこれは個別実装のバグ修正ではなく、**プロトコルの語彙の欠落**である。だから SPEC に書く。

## 2. 実際に起きた故障（evidence）

wcstack の examples/state-fetch で顕在化した。`<wcs-fetch>` は inputs として `url / method / target / manual / body / trigger` を宣言し、setter は属性へ自己反映する（`inputs[].attribute` ヒントの存在が示す通り、**属性反映 setter は wc-bindable 要素のごく普通の実装パターン**である）。state slot が一部の input を初期化していないと、spread が `undefined` を書き込み、`setAttribute` の文字列化を経て以下の実害になった:

| input | `el.x = undefined` の結果 |
|---|---|
| `url` | 属性が文字列 `"undefined"` になり **`/undefined` へ自動 fetch が発火** |
| `method` | 属性 `"undefined"` → getter が `"UNDEFINED"` を返し、不正 HTTP メソッドとして `fetch()` が TypeError |
| `target` | `undefined !== null` の分岐をすり抜けて `setAttribute("target", "undefined")` → `#undefined` 要素への innerHTML 置換モードに化ける |
| `manual` | falsy 扱いで `removeAttribute` → **HTML 著者が明示的に書いた `manual` 属性を binder が黙って剥がし、自動 fetch が解禁される** |
| `body` | 内部の `!== null` 判定（「body が与えられた」の判定）を誤通過し、GET リクエストに `Content-Type: application/json` が付く |
| `trigger` | `!!value` の偶然で無害（防御ではなく偶然） |

特に悪質なのは `manual` のケースで、**マークアップ上の明示的な著者意図を、誰も書いていない値（undefined）が破壊する**。当時の回避策は「state slot で全 input をデフォルト値込みで初期化する」という運用ルールであり、1つ忘れるだけで上記のどれかが静かに起きる footgun だった。

## 3. 決定したセマンティクス

JavaScript の語彙に揃える:

- **`undefined` = 「不在・無意見」**。state がその端子に意見を持たない。→ binder は**書き込み自体をスキップ**し、要素の現在値（多くは要素既定値）を保つ。
- **`null` = 「明示クリア」**。→ binder は通常の値として**そのまま書く**。要素 setter は null を「属性削除」等の意味で解釈してよい（`<wcs-fetch>` の `target = null` → `removeAttribute` は現役の意味を持つ）。

この区別はエコシステムの確立した慣習と一致する: React は undefined の prop を「属性を設定しない/削除」と扱い、Lit は `nothing` / undefined で属性削除、Vue も null/undefined で属性を外す。また wc-bindable 自体の `inputs[].attribute` ミラー規約の wcstack 実装も、既に「undefined → 属性削除（書かない側の語彙）」を採用しており、プロトコル内部で語彙が割れていた状態だった。

帰結として、state 著者は**実際に使う端子だけ初期化すればよくなる**。「宣言された全 input の防御的初期化」という運用ルールは不要になり、wcstack の example からも撤去済み。

## 4. 提案する規範文言（SPEC.md 追記案）

inputs / binder behavior を規定している節への追記案。英語正文＋日本語参考訳:

```markdown
### Undefined values

A binder MUST NOT write the JavaScript value `undefined` to an element
property declared in `properties` or `inputs`. When the bound data source
resolves to `undefined` (for example, the state object does not define
that path), the binder MUST skip the write entirely, leaving the
element's current value untouched. This rule also applies to the
`inputs[].attribute` mirror: a skipped write mirrors nothing.

`null` is an ordinary value: a binder MUST deliver `null` as-is. Authors
express "explicitly clear this input" with `null`, and "no opinion — keep
the element's default" with `undefined` / absence.

Elements SHOULD additionally harden their input setters against
`undefined` (for example, normalize `undefined` like `null`, or to the
property's default). Conforming binders never deliver `undefined`, but
direct JavaScript assignment can.

Note (non-normative): because `undefined` writes are skipped, a data
source that transitions from a defined value to `undefined` leaves the
element holding the last written value. To clear, write `null`.
```

> **参考訳**: binder は `properties` / `inputs` に宣言された要素プロパティへ JavaScript の `undefined` を書き込んではならない（MUST NOT）。束縛されたデータソースが `undefined` に解決される場合（例: state オブジェクトがそのパスを定義していない）、binder は書き込みを完全にスキップし、要素の現在値に触れない（MUST）。この規則は `inputs[].attribute` ミラーにも適用される — スキップされた書き込みは何もミラーしない。
> `null` は通常の値であり、binder はそのまま届ける（MUST）。著者は「この input を明示的にクリアする」を `null` で、「無意見 — 要素既定値を保つ」を `undefined`／不在で表現する。
> 要素はさらに input setter を `undefined` に対して防御することが望ましい（SHOULD）。準拠 binder は `undefined` を届けないが、直接の JavaScript 代入では届きうる。
> 注（非規範）: `undefined` の書き込みはスキップされるため、定義済み→`undefined` に遷移したデータソースは、要素に最後に書かれた値を残す。クリアするには `null` を書くこと。

### 関連箇所への波及（SPEC 側で合わせて確認したい点）

- **Composite Profile**（SPEC-extensions § 4）: composed name（`"s3.progress"` 等）経由のフラットなプロパティ書き込みにも同一規則が適用される旨を一文添えるのが望ましい。
- **バージョニング**: 本追記は「これまで undefined を書いていた binder」を非準拠にする規範追加である。version 1 のままの clarification（従来挙動は未定義だったので破壊ではない、と整理する）か、改訂版として明記するかは SPEC のバージョニングポリシーに従って判断が必要。wcstack としては clarification 扱いを推す — undefined 書き込みに依存して**意味のある**動作をしていた実装は事実上存在し得ない（DOM プロパティへの undefined 書き込みは常に文字列化バグの種）ため。

## 5. 検討した代替案と不採用理由

| 案 | 不採用理由 |
|---|---|
| spread（一括配線）に限って undefined をスキップ | 同一プロパティでも配線方法（spread か明示か）でセマンティクスが分岐する。プロトコルの規則としては筋が悪い |
| 要素既定値を state へ逆充填（binder が初回に element → state を書く） | 「state が真実の源」という単方向モデルと衝突。computed getter（書き込み不可）や readonly レンダリング時の状態変異と非整合。暗黙の state 変異は驚きが大きい |
| `inputs[].default` を SPEC に追加し、undefined 時は binder がデフォルトを書く | プロトコル表面積が増えるだけで「スキップして要素既定値を生かす」と等価以下。要素の既定値は要素自身が一番よく知っている |
| 要素防御を MUST にし、binder は自由のまま | 義務が全要素作者に分散する。配線側（binder は数えるほどしかない）で一度規定する方が圧倒的に安い |

## 6. 参照実装と検証結果（wcstack 側、実装済み）

- **binder**: `@wcstack/state` — `applyChangeToProperty` の冒頭で `typeof newValue === "undefined"` なら書き込み・属性ミラー・SSR 反映のすべてをスキップ。debug 設定時は `console.debug` でスキップを通知。テスト 1457 本通過（undefined スキップ／null 回帰／ミラー非接触／SSR／「属性反映 setter を持つ要素を一部初期化 slot で spread 配線」の統合回帰テストを含む）。
- **要素側防御（SHOULD の実例）**: `@wcstack/fetch` — `url` / `method` / `target` setter は `value == null` で `removeAttribute`、`body` setter は `value ?? null` に正規化。テスト 151 本通過。
- **E2E**: examples/state-fetch を「全 input 初期化なし」の slot に書き換えた上で、実ブラウザ（Chromium/Playwright）で 16/16 チェック通過 — `undefined` を含むリクエストゼロ、意図しない自動 POST ゼロ、HTML の `manual` 属性維持、一覧/詳細/フィルタ/POST 作成の全動作確認。

## 7. この提案が成立すると何が変わるか

- **state/データソース著者**: 宣言された全 input の防御的初期化が不要になる。使う端子だけ初期化し、クリアは `null` で書く。
- **要素著者**: setter の undefined 防御は「必須の自衛」から「推奨の保険」に格下げされる。属性反映 setter を素朴に書いても準拠 binder 経由では壊れない。
- **binder 実装者**: undefined スキップという1行相当の規則を負う。複数 binder 間での挙動互換が保証される。
