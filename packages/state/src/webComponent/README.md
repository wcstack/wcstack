# webComponent/ — `bind-component`

**正本は [`packages/state/README.md`](../../README.md) の "Web Component Binding" 節。**
ここは実装側の補足のみを置く。

`<wcs-state bind-component="<prop>">` がコンポーネント直下にあると、
`State._initializeBindWebComponent` が親要素の `<prop>` を state のソースとして取り込み、
`bindWebComponent()` がそのプロパティを proxy に差し替える。

## ファイル

| ファイル | 役割 |
|---|---|
| `bindWebComponent.ts` | 分岐の入口。outer proxy を要素に defineProperty し、`$stateReadyCallback` を呼ぶ |
| `innerState.ts` | 子側の state proxy。ローカル getter/setter → マッピング → ローカル値 の順で解決する |
| `outerState.ts` | 公開プロパティ（`element[prop]`）の proxy。read / write とも子の state proxy へ素通し |
| `MappingRule.ts` | 親パス ↔ 子パスの対応表。プライマリ規則から部分パスの規則を派生させる |
| `meltFrozenObject.ts` | `Object.freeze` された初期 state を書き込み可能に複製する |
| `stateElementByWebComponent.ts` / `completeWebComponent.ts` | 台帳 |

## 2 つの分岐

`bindWebComponent` は **`<prop>.*` バインディングが 1 件以上あるか**で分岐する
（`data-wcs` 属性の有無ではない — 属性だけあってマッピングが 0 件だと
outer proxy が死ぬため。§1.2）。

分岐が決めるのは**子の state の中身だけ**で、公開面の意味論は両者で同一（§1.1 / G1）。

- **mapped**（`<my-c data-wcs="state.msg: user.name">`）— 値の正本は親 state。
  子の state は innerState proxy になり、マップされたパスの read / write は親 state に解決する。
- **plain**（親からのバインドなし）— 値の正本は子の state。melt 済みのローカル state。

## 親 → 子の通知は公開プロパティを通らない

親 state が変わったときに子へ送るのは「そのパスを読み直せ」という通知だけで、値は運ばない
（正本は親側にあり、子は innerState のマッピング経由でライブに読むため）。
`applyChangeToWebComponent` が `getStateElementByWebComponent` で子の state 要素を直接引いて
`$postUpdate(残余パス)` を呼ぶ。`element[prop]` には一切触らない — 公開 API と内部チャネルを
同じ proxy が兼ねていたのが §1.1 の原因だった。

このチャネルが選ばれるのは `isWebComponentComplete(要素, stateProp)` が真のとき、つまり
`bindWebComponent` が公開プロパティを差し替え終えたあと。完了前は `applyChangeToProperty` が
まだ素のオブジェクトである state プロパティに初期値を積み、`bindWebComponent` が melt して取り込む。
**この台帳のキーは stateProp 名**であり state 要素ではない（§1.7 — 以前は内側の `IStateElement` を
キーに記録して親スコープの `IStateElement` で照会しており、同じ型なので型検査を素通りしたまま
判定が恒久 false になっていた）。

子が**マップ先より深いサブパス**を読んだ場合（規則は `state.user: user` だが子は `user.name` を読む）、
`MappingRule` がその場で規則を導出し、同時に対応するバインディングを
**プライマリを所有する `BindingSession`** に登録する。これで親がそのサブパスへ書いたときにも
通知が届く。セッション経由にしているのは、台帳登録・teardown・ノード削除時の破棄を
既存のライフサイクルに乗せ、絶対アドレス台帳のエントリが要素を強参照したまま残らないようにするため。

## Light DOM

Shadow DOM を持たないコンポーネントでも使えるが、名前空間が上位スコープと共有されるため
`name` 属性が必須（`<wcs-state bind-component="state" name="light-user">`）。
バインドは `@light-user` で state 名を明示する。

## DCC との排他

`bind-component` と DCC はコンポーネントごとにどちらか一方だけを使う。
`bind-component` のコンポーネントは `static wcBindable` を持たない ＝ wc-bindable の producer では
ないため、spread（`...: obj`）と command token は使えない。宣言されたプロパティ面ではなく
**パス**で配線するのがこの機構であり、これは意図的な設計。
機構の選び方と対応表は
[`packages/state/README.md` の「Choosing a Component Mechanism」](../../README.md#choosing-a-component-mechanism)。

## 設計の経緯

実装と設計の食い違いの記録は
[`docs/architecture-hardening/15-state-component-mechanism-consistency.md`](../../../../docs/architecture-hardening/15-state-component-mechanism-consistency.md)
に集約してある。この機構に関わるのは §1.1（公開 proxy の一本化 = G1）、§1.2（分岐条件）、
§1.7（G1 で分離した内部チャネルを選ぶゲートが壊れており、親起点の変更が届いていなかった件）。
