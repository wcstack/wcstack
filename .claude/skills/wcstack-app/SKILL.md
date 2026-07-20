---
name: wcstack-app
description: wcstack（@wcstack/state・router・signals と wcs-fetch/wcs-storage 等の I/O ノード群）を使って Web アプリ・SPA・デモページを構築するスキル。CDN 一行読み込み・ビルドレス・標準 Web Components という設計原則に沿って、状態設計 → data-wcs バインディング → I/O ノード配線 → ルーティングの順で正確な構文のアプリを生成する。ユーザーが「wcstackでアプリを作って」「wcs-stateを使って」「data-wcsで書いて」「wcstackでSPA」「wcs-fetch/wcs-ws/wcs-storageで〜して」「signalsでアプリ」などを依頼した場合に使用する。
---

# wcstack アプリ構築スキル

## 概要

wcstack は「標準ファースト・ゼロコンフィグ・ビルドレス」の Web Components パッケージ群。アプリは **1 枚の HTML + CDN 一行読み込み**で完結するのが正であり、バンドラ・ビルドステップ・npm install を持ち込まないこと（ユーザーが明示的に要求した場合を除く）。

生成コードの精度は構文の正確さで決まる。**このファイルは進め方と鉄則のみ**を持ち、正確な構文は同ディレクトリの references/ に分離してある。該当フェーズに入ったら必ず対応するリファレンスを読むこと:

| ファイル | 読むタイミング |
|---|---|
| `references/state-binding.md` | `<wcs-state>`・`data-wcs`・フィルタ・command/event-token を書く前 |
| `references/router-and-scaffold.md` | SPA / ルーティング / autoloader / index.html 骨格・サーバーを書く前 |
| `references/io-node-catalog.md` | I/O ノード（wcs-fetch 等 35 タグ）の配線前・signals でアプリを書く前 |

## ワークフロー

### 1. スタック選択（state か signals か）

- **`@wcstack/state`（既定）** — HTML の `data-wcs` パス文字列で UI と状態を接続。JS にリアクティブプリミティブが現れない。フォーム・リスト・CRUD などの一般的なアプリはこちら。
- **`@wcstack/signals`** — `signal()`/`computed()`/`effect()`/`h()` を JS で直接書く。DSL を避けたい・ロジック中心・型を効かせたい場合。深いパス追跡は無い（それは state の領分）。
- 両者は**併存**（競合ではない）。ただし 1 アプリでは片方に決めるのが原則。

### 2. HTML 骨格（CDN 読み込み規約）

```html
<!-- state 系: パッケージごとに /auto 一行。I/O ノードは state より先に並べる -->
<script type="module" src="https://esm.run/@wcstack/fetch/auto"></script>
<script type="module" src="https://esm.run/@wcstack/router/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
```

- signals 系は **`@wcstack/signals/dom` 単一エントリのみ**から import する（`.` と `.dom` を CDN で混在させるとリアクティブコアが二重化して壊れる）。
- SPA なら `<head>` に **`<base href="/">` が必須**（無いとディープリンク時に basename 誤導出で壊れる）。

### 3. 状態設計（state 系）

状態は plain object の `export default`。computed はドットパス文字列キーの getter（`get "cart.total"()`、ワイルドカード `get "users.*.fullName"()`）。設計時に決めること:

- I/O ノード 1 つにつき state に 1 スロット（`listFetch: { value: null, loading: false, error: null, status: 0 }`）
- `for:` に渡すパスは配列必須なので、fetch の value 等 null になりうるものは `get rows() { return this["listFetch.value"] ?? []; }` の派生 getter を挟む
- 要素→state の出力（output-only プロパティ）には都合のよい初期値をシードしない（要素側が authority。実初期値 `null`/`false` でシード）

### 4. バインディング → I/O 配線 → ルーティング

各リファレンスを読んで書く。I/O ノードとの配線は 4 形態:

1. プロパティバインド: `data-wcs="value: users; loading: busy"`
2. spread: `data-wcs="...: listFetch"`（wcBindable 全 properties+inputs 一括。commands/event は対象外）
3. command-token（state→要素）: `data-wcs="command.fetch: $command.refresh"` + `$commandTokens`
4. event-token（要素→state）: `data-wcs="eventToken.value: responded"` + `$eventTokens` + `$on`

### 5. サーバーと動作確認

- 静的 1 ページなら不要（file:// でも動くが fetch を使うなら簡易サーバー推奨）
- SPA は「拡張子なし・非 API の GET すべてに index.html を返す」フォールバックが必須（実装例は router-and-scaffold.md §7）
- 完成後はブラウザまたは簡易サーバー起動で最低限の動作確認をする。参考実装が必要なら wcstack リポジトリの `examples/`（複合デモ）と `packages/*/examples/`（単機能デモ）を見る

## 鉄則チェックリスト（違反すると静かに壊れる）

書き終えたら必ずこの表で自己レビューする:

1. **状態更新はパス代入** — `this["user.name"] = v` ✅ / `this.user.name = v` ❌（検知されない）
2. **配列は新配列を再代入** — `toSpliced`/`concat`/`filter`/`toSorted` ✅ / `push`/`splice`/`sort` ❌
3. `onclick:` はメソッド名のみで**引数を渡せない** — 引数違いはゼロ引数ラッパーメソッドを作る
4. command バインド右辺は必ず `$command.<name>`（ベア名不可）。`eventToken.` のキーは生イベント名でなく **wcBindable プロパティ名**
5. `else:` は末尾コロン必須。複数バインディングの区切りは `;`
6. `wcs-fetch:response` は**エラー時も発火** — `$on` 側で `event.detail.status` を確認
7. **router がスタンプするノードに `data-wcs` を書かない** — state はバインド時点の DOM しか見ない。データバインドされるページは body 直下の `<template data-wcs="if: ...">` に置き、ルート内は `<wcs-head>` + 静的コンテンツのみ
8. リンクは `<a>` でなく `<wcs-link to="...">`（basename 自動付与・`active` クラス）
9. storage バインド先スロットは `undefined` で初期化（`""`/`null` だと保存値を初期書き戻しで上書き）
10. カスタムフィルタ登録 API は**存在しない** — 組み込み 40 種（references 参照）で書けない変換は getter で行う
11. 生ハンドル（MediaStream 等）は state に入れない — `eventToken` → `$command.attachStream` で要素間直結
12. `trigger` はコマンドでなくモーメンタリ入力 — `false`→`true` の書き込みで起動

## 最小テンプレート（起点）

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <script type="module" src="https://esm.run/@wcstack/state/auto"></script>
</head>
<body>
<wcs-state>
  <script type="module">
    export default {
      count: 0,
      countUp() { this.count++; }
    };
  </script>
</wcs-state>
<p>Count: {{ count }}</p>
<button data-wcs="onclick: countUp">+1</button>
</body>
</html>
```

SPA・fetch 連携・レイアウトを含むフル雛形は `references/router-and-scaffold.md` §7 の router-spa 実物骨格を起点にする。
