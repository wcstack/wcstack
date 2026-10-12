# `<wcs-outlet>` を置く場所

**English**: [router-outlet-placement.md](./router-outlet-placement.md)

## 規則

`<wcs-router>` は、**自分のすぐ後の要素**が `<wcs-outlet>` なら、そこにルートを描きます。そうでなければ `<wcs-outlet>` を作り、自分のすぐ後に置きます。それ以外の場所にある `<wcs-outlet>`（`<main>` の中、router の中、別の要素の後）は使われません。

```html
<main>
  <wcs-router><template>…</template></wcs-router>
  <wcs-outlet></wcs-outlet>   <!-- router のすぐ後: 使われる -->
  <aside>…</aside>
</main>
```

2 つの間の空白・テキスト・コメントは関係ありません。別の要素を挟むと規則から外れます。

規則から外れてもページは動きますが、作者の意図した場所ではありません。ルートは router のすぐ後に描かれ（router が `<body>` の先頭にあればヘッダーより上）、作者が置いた `<wcs-outlet>` は空のままです。4.0.4 より前は、それを何も報告しませんでした。

## 経緯

| いつ | commit | 何が |
|---|---|---|
| 2026-01-17 | `0fa46ef9` | 最初の router。router は 1 文書に 1 つで、outlet は文書の中の最初の `<wcs-outlet>`（`document.querySelector`）、無ければ `<body>` の末尾に作った。outlet はどこに置いても動いた。 |
| 2026-04-10（v1.8.6） | `15ac3bc4` | マルチ Router 対応（マイクロフロントエンド: `basename` の違う router を複数置く）。文書全体で探すと、どの router も同じ最初の outlet をつかむので、router ごとに自分の outlet と組ませるために探す範囲を狭めた: router の**次の兄弟要素**、無ければ router の直後に作る。 |
| その後 | — | SSR の採用（[ssr-router-design.md](./ssr-router-design.md) §4）も同じ位置を前提にした: クライアントは、outlet があるはずの場所でサーバーが描いた `<wcs-outlet data-wcs-ssr>` を引き継ぐ。 |
| 2026-10-12 | — | チュートリアル Part 3 を書く中で見つけた: router を `<body>` の先頭に、outlet を `<main>` の中に置いたら、ページがヘッダーの上に描かれた。 |

2026-04 の変更はマルチ Router のためのものでしたが、router が 1 つのページの振る舞いも黙って変えていました。

- **規則がどこにも書かれなかった。** README から「router は 1 文書に 1 つ」が消え、「`basename` が違えば複数を共存できる」が加わったが、「outlet は router の直後に置く」は加わらなかった。outlet の節は「HTML に書く。無ければ router が作る」のままだった。CHANGELOG は v1.8.6 より後から始まるので、記載も無い。
- **コメントがコードより多くを言っていた。** `_getOutlet` のコメントは「router の兄弟・子孫から outlet を探す」だったが、見ているのは次の兄弟だけだった。
- **もう 1 つの場合を試すものが無かった。** テストは「outlet が router の直後にある」「無いので router が作る」を扱い、「別の場所にある」は扱わなかった。examples は outlet を router の直後に置いていた — ただし `examples/router-i18n` は router の**中**、`<template>` の後に置いていた。使われていなかったが、router が作った outlet がすぐ隣に入ったので、見た目は同じだった。
- **作ることが間違いを見えなくした。** 無い outlet を router が作るのは便利のための仕組みだが、「次の兄弟だけ」と組み合わさって、間違った場所の outlet と outlet が無いことの区別がつかなくなった。エラーも警告も出ない。
- **AI 向けのスキル**は「描く先は `<wcs-outlet>`（書かなければ自動で作られる）」としか書いておらず、それが作るページも同じ罠に落ちえた。

## 決定（2026-10-13）

**A — 規則は変えず、間違いを知らせ、規則を書き残す。**

- router は実行時に、outlet ごとに 1 回、code `[wcs/router-outlet-misplaced]` で警告し、使わない outlet を名指す（`packages/router/src/misplacedOutletWarning.ts`）。挙動は変えない。
- `wcs-validate` と VS Code 拡張は、同じ code を warning として outlet の位置に報告する（`packages/vscode-wcs/src/service/documentEnvValidator.ts`）。
- router の README、この文書、AI 向けのスキルに規則を書く。`examples/router-i18n` は outlet を router の外へ出す。

実需が出るまでは見送るもの:

- **B — 探す範囲を広げる**: 次の兄弟が outlet でなければ、同じ root の中の、どの router も使っていない `<wcs-outlet>` を使う。router が 1 つのページは置き場所を問わなくなるが、router が複数なら組ませる順番の規則が要り、SSR の採用は隣の位置を前提にしている。
- **C — 明示的に結ぶ**: `<wcs-router outlet="main-outlet">` のような属性。曖昧さは無いが、API が増える。

## 検査の判定

router が outlet にするのは、自分のすぐ後の `<wcs-outlet>` か、自分のすぐ後に作ったものかのどちらかです。だから**直前の兄弟要素が `<wcs-router>` でない `<wcs-outlet>` は、どの router にも使われません**。どちらの検査も、直後に `<wcs-outlet>` を持たない router があるとき — その router が自前の outlet を作り、ページがそこに描かれる場合 — に、そういう outlet を報告します。

- **実行時**: router が outlet を作ろうとするときに走る。見るのは router 自身の root（文書か、router が入っている shadow root）だけなので、shadow root の中の router は文書の outlet を報告しない。outlet ごとに 1 回。文書に入っていない router は何も調べない。
- **静的**: HTML のタグの並びで判定する — `</wcs-router>` の次のタグが開始タグならそれが router の次の兄弟（終了タグなら次の兄弟は無い）、`<wcs-outlet>` の前のタグで直前の兄弟が router かを見る。`<script>` / `<style>` の中身と HTML コメントは数えない。

どの router もすぐ後に自分の outlet を持つページの、余った outlet は報告しません。router はそこで何も作らず、この検査の扱う形ではないからです。
