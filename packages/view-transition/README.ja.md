# @wcstack/view-transition

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/view-transition` は wcstack のページに**退場と移動のアニメーション**を与える。フレームワークが消した DOM に対して CSS だけでは届かない、ちょうどその 2 つを担当する。

English: [README.md](./README.md)

```html
<script type="module" src="https://esm.run/@wcstack/view-transition/auto"></script>

<wcs-view-transition></wcs-view-transition>
```

opt-in はこれだけ。以後、`@wcstack/router` のルート差し替えと `@wcstack/state` のリスト／分岐更新が [View Transition](https://developer.mozilla.org/docs/Web/API/View_Transition_API) の中で行われ、見た目は `::view-transition-*` に対する CSS で書く。

`<wcs-view-transition>` は I/O ノードではなく**ポリシーノード**である。何も描画せず、データもバインドせず、アニメーションの中身も書かない。決めるのは「その DOM 変更をアニメーションさせるか」と「2 つがぶつかったらどうするか」だけ。アニメーション自体は CSS に残す。

- **入力**: `for` / `mode` / `naming` / `naming-limit` / `reduced-motion` / `types` / `disabled`
- **出力**: `active` / `error`
- **コマンド**: `skip()`

## このパッケージ抜きで既にできていたこと

インストールの前に知っておく価値がある。問題の 3 分の 2 はもともとパッケージを必要としていない。

```css
/* 入場: 新しく挿入された行／分岐は JS 無しでアニメーションする */
li {
  transition: opacity 0.2s, transform 0.2s;
  @starting-style { opacity: 0; transform: translateY(-4px); }
}
```

`class.x:` / `style.y:` バインドは生きた要素へ書き込むので、値の変化には通常の CSS transition がそのまま効く。`@starting-style` は**入場する**要素に効く — 新規の `for` 行と mount する `if` 分岐がまさにそれ。

CSS が届かないのは**退場**。wcstack は削除ノードを同期で detach するので、次の描画時点でアニメーションさせる相手が居ない。並べ替えも `insertBefore` の列で中間状態が無いため、**移動**を補間できない。このパッケージはそこを担当する — ブラウザが変更前の状態をスナップショットするので、退場する要素は変更後まで生き残る必要がない。

## インストール

```bash
npm install @wcstack/view-transition
```

## クイックスタート

### ルート遷移だけ

```html
<wcs-view-transition for="router"></wcs-view-transition>

<style>
  ::view-transition-old(root) { animation: fade-out 0.2s both; }
  ::view-transition-new(root) { animation: fade-in 0.2s both; }
</style>
```

`for="router"` にすると `@wcstack/state` の更新タイミングは一切変わらない（[契約](#契約)参照）。

### 移動とフェードをするリスト行

```html
<wcs-view-transition naming="auto"></wcs-view-transition>

<ul>
  <template data-wcs="for: todos">
    <li>{{ .title }}</li>
  </template>
</ul>

<style>
  /* 自動命名された行はすべて wcs-row グループクラスを共有する */
  ::view-transition-group(*.wcs-row) { animation-duration: 0.25s; }
  ::view-transition-old(*.wcs-row) { animation: fade-out 0.25s both; }
  ::view-transition-new(*.wcs-row) { animation: fade-in 0.25s both; }
</style>
```

## 属性

| 属性 | 値 | 既定 | 意味 |
|---|---|---|---|
| `for` | `router` / `state`（空白区切り） | `router state` | どの参加者をアニメーションさせるか。 |
| `mode` | `latest` / `queue` / `exhaust` | `latest` | 遷移実行中に変更が来たときの挙動 — [排他](#排他)参照。 |
| `naming` | `manual` / `auto` | `manual` | `view-transition-name` を誰が付けるか — [命名](#命名)参照。 |
| `naming-limit` | 整数 | `200` | 自動命名の上限。 |
| `reduced-motion` | `skip` / `animate` | `skip` | `skip` は `prefers-reduced-motion: reduce` を尊重し、アニメーション無しで適用する。 |
| `types` | 空白区切り | — | 対応環境で `startViewTransition({ types })` へ渡す（`:active-view-transition-type()` 用）。 |
| `disabled` | boolean | 無し | 不活性。全変更が即時適用される。バインド可能なので state からアニメーションを切れる。 |

1 ドキュメントに `<wcs-view-transition>` は 1 つ。2 つ目は警告して不活性になる（排他を提供するために存在するものが排他を奪い合っては本末転倒なので）。

## 契約

他のすべてが従属する規則: **DOM 変更は、アニメーションがどうなろうと、ちょうど 1 回適用される。** 未対応ブラウザ、非表示タブ、`prefers-reduced-motion`、`disabled`、衝突、`startViewTransition` の throw — どれも「変更は適用された」で終わる。アニメーションが再生できなかったせいで古い DOM が残ることはない。

タグを足す前に知っておくべき帰結が 2 つ。

1. **`for="state"`（既定で有効）は state の drain を非同期にする。** 現在の drain は microtask で着地するが、遷移の中ではフレームで着地する。state に書いてから `await Promise.resolve()` で DOM を読むコードは、代わりに遷移を待つ必要がある。`$updatedCallback` は影響を受けない（バインディング適用直後に発火する）。drain を完全に元のままにしたいなら `for="router"`。
2. **参加は要素単位ではなくドキュメント単位。** 1 つの updater がページ上の全 `<wcs-state>` をまとめて drain するので、`for="state"` は全部に効く。

遷移がスキップされ、変更が現行どおり同期適用されるのは: `startViewTransition` が無い環境、`document.hidden` が true のとき（バックグラウンドタブには描画機会が無く、遷移を張ると見に戻るまで DOM が凍る）、`reduced-motion="animate"` でない状態で `prefers-reduced-motion: reduce` のとき、`disabled` のとき、そして SSR 中。

## 排他

遷移は入れ子にできないので、誰かが調停しなければならない。同一 microtask のリクエストは**1 つ**の遷移へ合流し（ルート変更とそれが引き起こす state drain は互いを潰さず一緒にアニメーションする）、後から衝突したときの挙動を `mode` が決める。

| `mode` | 遷移実行中に来たとき |
|---|---|
| `latest` | 実行中をスキップして新しい方をアニメーションする（既定）。 |
| `queue` | 連結。実行中が終わってから開始する。 |
| `exhaust` | アニメーションせず即時適用する。 |

`exhaust` が落とすのは*アニメーション*であって DOM 更新ではない。また 3 モードとも、実行中の遷移がスナップショットを撮る前に届いたリクエストはその遷移に合流するので、変更の順序が入れ替わることはない。

`skip()` は実行中の遷移を即座に終わらせる。その遷移が運んでいた DOM 変更は行われる。

## 命名

`view-transition-name` はブラウザがスナップショットを撮る**前**に要素へ付いている必要があり、変更中に付けることはできない。したがって「変わったものだけ命名する」は原理的に不可能で、2 つの戦略から選ぶことになる。

**`manual`（既定）** — 自分でバインドし、モーフさせたいものにだけ名前を付ける:

```html
<template data-wcs="for: todos">
  <li data-wcs="style.viewTransitionName: .cssName">{{ .title }}</li>
</template>
```

**`auto`** — `@wcstack/state` がリスト行と `if` 分岐の最初の要素に mount 時へ名前を付け、`view-transition-class`（`wcs-row` / `wcs-branch`）も添えるので CSS からグループをまとめて指せる。名前は *content* に付いて回るため、プールから再利用された行は同じ名前を保つ — 実際に DOM がしたことと一致する。

自動命名には `naming-limit`（既定 200）の上限がある。命名された要素は 1 つずつスナップショットグループになり、数百個あると遷移は目に見えて重くなるため。上限を超えると命名を止め、コンソールに一度だけ通知する。大きなリストは `manual` で意図的に命名すべき。

**`auto` はロード順に依存する。** 名前は content の mount 時に割り当てられるので、このタグが upgrade した時点で既にページに載っていた行・分岐には付かない — 後から見直す仕組みは無い。arbiter が先に install されるよう、このパッケージの script タグを `@wcstack/state` より**前**に置くこと。さもないと初回描画の分は行ごとに morph せず、ルートのスナップショットに含まれる。`manual` は名前が普通のバインディングなので、この順序制約を持たない。

## state からのバインド

```html
<wcs-view-transition
  data-wcs="disabled: animationsOff; active: transitionRunning"
></wcs-view-transition>
```

`active` は遷移実行中かどうか、`error` は最後の開始失敗（どちらも observable）。`disabled` / `mode` / `naming` / `types` / `participants` は書き込み可能な input で、`skip` は command token として使える。

## 直接利用（DOM 無し）

```js
import { ViewTransitionCore } from "@wcstack/view-transition";

const core = new ViewTransitionCore();
core.naming = "auto";
core.install();               // ページの arbiter になる
await core.run(() => { /* DOM を変更する */ });
```

`install()` は core をよく知られたグローバル Symbol に載せる。`@wcstack/state` と `@wcstack/router` はこのパッケージを import せずにそこから見つける。プロトコルは [docs/view-transition-design.ja.md](https://github.com/wcstack/wcstack/blob/main/docs/view-transition-design.ja.md) §4 に規定があり、独自 arbiter を載せたい採用者向けに `getTransitionRunner` / `runTransition` / `TRANSITION_RUNNER_KEY` を export している。

## デモ

[`examples/list-transitions`](./examples/list-transitions/) — 入場・退場・移動を 1 ページで並べ、チェックボックスで arbiter を止めて差を見られるようにしたデモ。ビルド不要で `index.html` を開くだけ。

## ブラウザ対応

same-document View Transition は Chromium 111+ と Safari 18+ で利用可能。Firefox は未対応。そこを含め API が無い環境では、全変更が即時適用され、アニメーションもエラーも起きない — ページは普通に動き、ただアニメーションしないだけ。

## ライセンス

MIT
