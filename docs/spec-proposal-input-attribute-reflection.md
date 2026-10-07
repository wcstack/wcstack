# wc-bindable SPEC 改訂提案: 入力の `attribute` ヒントを consumer は書かない

- **提案先**: wc-bindable-protocol リポジトリ（SPEC-extensions.md「Extension 1 — Input/Command Invocation」の「The `attribute` hint」、protocol = `"wc-bindable"`, version 1）
- **提案元の文脈**: wcstack（@wcstack/state の binder と、wc-bindable 準拠の I/O ノード群）
- **状態**: wcstack 側は 4.0 で実装済み（2026-10-08、`research/state-engine`。4.0.0-rc.8 で公開予定）。本文書は、仕様に足す規範文言の提案とその根拠
- **TL;DR**: 入力を書く consumer は、要素の**プロパティ**を書く。`attribute` ヒントが名指す属性は書かない（SHOULD NOT）。プロパティを属性に反映するのはコンポーネントの責任で、書き方（boolean は属性の有無、列挙のキーワード、JSON など）もコンポーネントが決める

---

## 1. なぜ仕様に書く必要があるのか

SPEC.md は `inputs` を「ツール・文書生成・リモートプロキシのための入力インターフェースの宣言」とし、暗黙のデータの流れは作らないと定めている。SPEC-extensions の「The `attribute` hint」は、このヒントを「マークアップの属性がどの入力プロパティに対応するか」の宣言と位置づけ、属性 → プロパティの反映はコンポーネント自身（`observedAttributes` / `attributeChangedCallback`）の責任としている。core はこのフィールドを解釈しない。

逆向き — consumer がプロパティを書いたあと、ヒントの属性にも値を書くこと — については何も書かれていない。書かれていないので、binder の解釈に任されている。実際に @wcstack/state 3.x は、入力を書くたびにヒントの属性へ値を写していた（`String(value)`、オブジェクトは JSON、`null` は属性を外す）。この沈黙には 3 つの帰結がある。

1. **値の書き方が binder ごとに割れうる。** 属性に写す binder とそうでない binder（@wcstack/signals の `bindNode`、`@wc-bindable/*` のアダプタはプロパティだけを書く）があり、写す binder どうしでも書き方を決める根拠が無い。
2. **コンポーネント自身の反映とぶつかる。** 属性を公開面に持つコンポーネントは、setter で自分の書き方のとおりに反映する。binder があとから別の書き方で上書きすると、コンポーネントが読む値が変わる。
3. **どの書き方にも当てはまらない属性がある。** HTML の真偽属性（有無で読む）、`"true"` / `"false"` を値に取る列挙属性（`aria-*`・`draggable`・`spellcheck`）、「`"off"` でない限り on」の属性 — 1 つの書き方は、必ずどれかで間違う。

書き方を決められるのは、その属性の意味を知っているコンポーネントだけである。だから仕様で「consumer は書かない」と決める。

## 2. 実際に起きた故障（evidence）

wcstack の I/O ノードで、`attribute` ヒントを持つ入力は 113 ある。そのうち 103 は setter が自分で属性を反映している（`toggleAttribute`、`"on"` / `"off"` など）。binder の書き込みは、その正しい反映を上書きしていた。

| 場面 | 起きたこと |
|---|---|
| `<wcs-wakelock data-wcs="active: isPlaying">`、`isPlaying` が `false` | binder が `active="false"` を書き、属性の有無で読む `<wcs-wakelock>` は `active` を真と読んで wake lock を取り続けた（3.x では true → false に戻したとき、4.0.0-rc.6 では読み込み直後から） |
| `<wcs-camera data-wcs="keepAlive: recording">` | 同じく `keep-alive="false"` が真と読まれ、録画していないのに非表示でカメラを止めなかった |
| 要素の側で値が変わる双方向の入力（`<conf-counter data-wcs="value: count">` が 5 → 9） | 3.x の出力は `value="5"` のまま（プロパティは 9）。binder は自分が書いた値しか写さないので、属性が古い値で残る |
| 4.0.0-rc.7 の試み: boolean を真偽属性として写す（true は `""`、false は外す） | 有無で読む要素は直るが、`getAttribute(x) === "true"` で読む要素が壊れる。`<wcs-audio limiter>`（`"off"` でない限り on）の `false` は表せず、宣言からヒントを外すしかなかった |

最後の行が示すように、binder の書き方を直す方向では解決しない。

## 3. 決定したセマンティクス

- consumer は入力をプロパティとして書く（既存の規範どおり）。
- consumer は `attribute` ヒントの属性を書かない・外さない・書き換えない。
- 属性をプロパティと揃えておきたいコンポーネントは、setter で自分で反映する。書き方はコンポーネントが決める。
- ヒントの意味は変わらない: マークアップで書く属性の名前を、ツール（補完・検査・文書生成）に伝える宣言。

## 4. 提案する規範文言（SPEC-extensions.md「The `attribute` hint」への追記案）

> The optional `attribute: string` field on an input descriptor names the HTML attribute that corresponds to the input property in markup. It is a declaration for tooling, documentation and markup authoring.
>
> A consumer that sets an input MUST set it through the element's property. A consumer SHOULD NOT write, rewrite or remove the attribute named by the hint as a consequence of setting the input. Reflecting a property to its attribute — and the encoding used to do so (presence for a boolean, an enumerated keyword, JSON, …) — is the component's responsibility, typically in the property's setter; only the component knows how the attribute is read. A component whose attribute is part of its public surface (CSS selectors, `attributeChangedCallback` consumers, DevTools) SHOULD reflect the property itself.
>
> This extension does not prescribe any automatic attribute → property reflection either; that remains the component's own `observedAttributes` / `attributeChangedCallback` responsibility.

**参考訳**: 入力記述子の省略できる `attribute: string` は、マークアップでその入力プロパティに対応する HTML 属性を名指す。ツール・文書・マークアップを書くための宣言である。入力を設定する consumer は、要素のプロパティを通して設定しなければならない（MUST）。入力を設定したことを理由に、ヒントが名指す属性を書いたり、書き換えたり、外したりすべきではない（SHOULD NOT）。プロパティを属性に反映すること、およびその書き方（boolean は有無、列挙のキーワード、JSON など）はコンポーネントの責任で、通常はプロパティの setter で行う。属性の読み方を知っているのはコンポーネントだけだからである。属性を公開面に含むコンポーネント（CSS セレクタ、`attributeChangedCallback` の利用者、DevTools）は、自分で反映すべきである（SHOULD）。

### 関連箇所への波及

- wcstack の [undefined 書き込みの提案](./spec-proposal-undefined-write-skip.md)の規範文言にある「This rule also applies to the `inputs[].attribute` mirror: a skipped write mirrors nothing.」は、consumer が属性を書かない前提では不要になる。上流に取り込まれていれば、その一文を外す。
- `version` は上げない: 宣言の形は変わらず、consumer の振る舞いについての注意の追加（SHOULD NOT）である。

## 5. 検討した代替案と不採用理由

| 案 | 不採用の理由 |
|---|---|
| 型の無いヒントの書き方を仕様で決める（文字列は `String`、boolean は真偽属性、オブジェクトは JSON） | 1 つの書き方は、真偽属性・`"true"` / `"false"` の列挙属性・既定 on の属性のどれかで必ず間違う（§2 の rc.7 の行） |
| ヒントに型を持たせる（`boolean` / `string` / `enum` / `json`、既定 on の値の対応など）、consumer がそれに従って書く | 型の体系と型ごとの書き方の規則が仕様に入る。コンポーネントが setter で持つ反映の処理を、宣言として二重に書かせる構造は残り、宣言が誤れば同じ食い違いが起きる。core が解釈しない記述的なヒントを、consumer が従う規範のデータの流れに変えることになり、「暗黙のデータの流れを作らない」方針とぶつかる |
| 要素が setter で反映しないときだけ consumer が書く | 判定が実行時の推測（書いた後に属性が変わったか）に頼り、同じ値の書き込みや初期の適用で誤る |

型付きのヒントは、ツール（補完・検査）のための**記述**としてなら、後から足しても互換を壊さない。consumer の書き込みとは切り離して検討できる。

## 6. 参照実装と検証結果（wcstack 側）

- `@wcstack/state` 4.0: 入力はプロパティだけを書く（`packages/state/src/dom/wc.ts`。3.x の `mirrorAttribute` を外した）。
- 契約のテスト（`packages/state/__tests__/coverage-element-wc.test.ts`）: ヒントの属性を書かないこと（オブジェクト・文字列・boolean・`null`）、要素の setter が自分の書き方で反映した属性（有無で読む boolean、`"on"` / `"off"`）を上書きしないこと。3.x の出力と食い違う 6 つの場面は、意図した差として記録した（`packages/state/conformance/scenarios.ts` の `differs`）。
- 実ブラウザの e2e（`e2e/`）: wake lock を focus の間だけ取る（`examples/state-pomodoro`）、プレイ中だけ取る（`examples/state-tilt-maze`）、録画中だけカメラを生かす（`examples/state-camera-record-upload`）。
- `<wcs-audio>` の `limiter` / `resumeOnGesture` は、ヒントを持ったまま `"on"` / `"off"` を setter で反映する（rc.7 で外したヒントを戻した）。

## 7. この提案が成立すると何が変わるか

- 既存の consumer: @wcstack/signals と `@wc-bindable/*` のアダプタは、もともと属性を書かないので変わらない。@wcstack/state は 4.0 からこの規則に従う。
- コンポーネント: setter で反映しているものは変わらない。属性だけを読み、binder が属性を書くことに頼っていたもの（setter を持たない、または `attributeChangedCallback` でしか入力を受け取らない）は、反映する setter を持つ必要がある。
