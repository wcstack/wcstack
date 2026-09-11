# Recursive Tree — 深さがデータである木

[English](./README.md)

**`@wcstack/state`** の**再帰パス**のデモ。パスは深さを文字列に焼き付けるので（`nodes.*.children.*.total` は深さ 2 以外の何物でもない）、実行時に形が決まる木には集計の置き場所がありません。`$recursion` で木が繰り返す位置を宣言し、`**`（＝「いま評価している深さ」）を使うと、**1 本**の getter が全ての深さを覆います。

```js
$recursion: { "nodes.*": "children.*" },   // アンカー → 自己相似な相対サブパス

get "nodes.**.total"() {
  return this["nodes.**.value"]
    + this.$getAll("nodes.**.children.*.total").reduce((a, b) => a + b, 0);
},
```

## はじめに

ビルドも API も不要な静的ページです。`packages/state/examples/` を http で配信して（CDN の ES モジュールを読み込むため `file://` では動きません）`/recursive-tree/` を開いてください。

```bash
cd packages/state/examples
npx serve .          # 任意の静的サーバーで可
```

`$streams` デモ同梱のサーバーもこのフォルダ全体を配信します。
`node examples/streams/server.js` → http://localhost:3000/recursive-tree/。

## 見どころ

- **定義 1 本で全ての深さ** — 各行に出ている Σ は `get "nodes.**.total"()` です。ルートから、いま作ったばかりのノードまで同じ 1 本が担当します。ある深さのアクセサは**最初に読まれた時に実体化**されるので、実際に辿った深さの分だけ生えます。
- **マークアップに `**` は出てこない** — `<tree-node>` の中のパスは全て 1 段（`label` / `value` / `total` / `children`）。`**` は state 定義のためのオーサリング記号で、バインドされるパスには決して降りません。
- **描画は自己参照コンポーネント** — `<tree-node>` が自分の shadow の中で `<tree-node>` を使い、行を `data-wcs="state: ."` でマウントします。深さは DOM 側にあり、パスは平らなままです。
- **`[]` は全深さの合併** — Total / Nodes / Selected は `$getAll("nodes.**.…", [])`（深さ優先・行きがけ・添字昇順）。再帰 getter が各段をちょうど 1 回ずつ数えるので、Total は最上段の Σ の合計と一致します。
- **一括解除はブロードキャスト 1 回** — **Clear selection** は `$setAll("nodes.**.selected", [], false)`。全深さの全ノードへの 1 回の書き込みです。
- **集計は足し算だけではない** — **Height**（各行の `h`*n*）は `get "nodes.**.depth"()`。`+` を `max` に替えた同じ形です。
- **+ child** はその段に子を足します。ページがそれまで描画したどこよりも深い部分木ができ、その上にある全ての Σ と Total / Nodes / Height が、追加の配線ゼロで追従します。これが要点です。

## ポイント

- **自己参照コンポーネントには前提が 2 つ**あり、どちらも踏むと**無言で壊れます**。初期 `state` にマウント先のデータキーを宣言しないこと（own key は private でツリー側を隠す＝`docs/state-mount-design.md` の規則 R1。メソッドは可）。そして shadow root は constructor ではなく `connectedCallback` で組むこと（constructor で `innerHTML` を入れると、`<template>` の中身を inert に保たない実装では中の要素が upgrade されてコンストラクタが無限再帰します）。
- **入力契約は木です。** 同じ配列インスタンスが 2 つ以上の親から到達可能だと、走査は黙って二重計上せずに拒否します（`wcs/recursion-shared-list` / `wcs/recursion-cycle`）。循環はその特殊ケースです。
- **`**` はオーサリング層だけの記号。** `PathInfo` には決して渡らないので `$resolve` は受け取らず、`data-wcs` に書くのも未対応です（`wcs/recursion-unsupported`）。再帰評価の外で `this["nodes.**.value"]` を読むと束縛先の深さが無く、`wcs/recursion-context` になります。
- **添字の形は API ごとに違います。** 再帰 getter の中の添字省略 `$getAll` は評価中の深さに束縛、`$getAll(path, [])` は全深さの合併、非空の接頭辞は定義できないので拒否です（`wcs/recursion-getall-form`）。
- **再帰の書き込みはブロードキャストだけ**（`wcs/recursion-setall-form`）。mapper と `spread` は深さで添字の本数が変わるため不可、添字省略も不可、構造への書き込み（ノード自身・子リスト・子ノード）も不可です（`wcs/recursion-structural-write`）。構造変更は普通の書き込みのままで、**+ child** と **−** がまさにそれを 1 段のスコープの中でやっています。
- **深さには上限があります。** 展開後のパスのワイルドカード段数は `MAX_WILDCARD_DEPTH`（128）以下で、超えるとループせずアンカーと深さを名指しした `wcs/recursion-depth-exceeded` になります。

> 設計判断はリポジトリルートの `docs/state-recursive-path-design.md`、実装は `packages/state/src/recursion/` を参照してください。
