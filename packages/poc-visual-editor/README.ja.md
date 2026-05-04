# @wcstack/poc-visual-editor

wcstack アプリ（`<wcs-state>` + `data-wcs`）を **ノードグラフとして可視化する** Visual Editor の PoC。

このパッケージはプロダクション用ではなく、設計検証のための実装です。製品化前の仮説検証フェーズで、以下を確かめるために存在します。

1. wcstack の HTML をグラフ化したとき**読めるか・意味を成すか**
2. wc-bindable プロトコルの自己記述だけで**ポート定義に十分か**
3. グラフ → HTML のラウンドトリップで**整形・コメントが壊れないか**
4. structural（`for` / `if`）やワイルドカードを**どう描けば破綻しないか**

## 設計方針

- **buildless**: バンドラ・コンパイラなし。ESM + Import Map + CDN のみ。
- **ドッグフーディング**: エディタ自身を wcstack で書く。`<wcs-state>` がエディタの状態を保持し、`data-wcs` で textarea とグラフを配線する。
- **VSCode 拡張化を急がない**: Stage 0–1 は単一 HTML として完結させ、グラフ表現とラウンドトリップの仮説検証に集中する。

## ステージ

| Stage | 形態 | 検証する仮説 | 状態 |
|-------|------|-------------|------|
| 0 | 単一 HTML、read-only | グラフ化が意味を成すか | ✅ |
| 0a | + 構造ノードのネスト + wildcard / mustache | 階層と相対パスを扱えるか | ✅ |
| 1 | + ワイヤー削除（クリック）→ HTML 再生成 | ラウンドトリップが現実的か | ✅（削除のみ） |
| 1.x | + 無効バインディングの可視化 | 編集の影響を即座に伝えられるか | ✅ |
| 2 | + Live preview iframe | エディタ出力が実際に wcstack で動くか | ✅ |
| 1+ | + 経路つなぎ替え / フィルタ編集 / 新規追加 | 構造的な編集も成立するか | 未着手 |
| 3 | VSCode Custom Editor として包む | IDE 統合の価値 | 未着手 |

現在 **Stage 2** 完了。3 カラム構成（HTML source / Graph / Live preview）で、編集したコードが iframe 内で実際に wcstack ランタイムで動くのを横目で確認できる。

## 実行方法

```bash
cd packages/poc-visual-editor
npm start
```

`http://localhost:5180/` を開くと、左に HTML 入力エリア、右にグラフ表示。`examples/` 内の HTML を貼り付けて挙動を確認できます。

## ディレクトリ

```
packages/poc-visual-editor/
├── index.html              # エディタのエントリ
├── src/
│   ├── parser.js           # HTML → グラフモデル
│   ├── render.js           # グラフモデル → SVG
│   ├── graph-canvas.js     # <pve-graph> カスタム要素
│   └── main.js             # エントリ（カスタム要素登録 + state bootstrap 確認）
└── examples/               # 入力サンプル
    ├── counter.html        # フィルタ + イベント
    ├── list.html           # structural (for) + wildcard
    ├── form.html           # 双方向 (input value / checkbox / radio)
    └── nested.html         # ネストされた structural (for + if + for)

src/preview.js              # Stage 2: <pve-preview> iframe wrapper（debounce 400ms）
```

## グラフモデル

```
StateNode (左カラム = ハブ)
   └─ output ports = data-wcs から参照される path
        ↓ Wire (data-wcs の 1 宣言 = 1 本)
ComponentNode (右カラム)
   └─ ports = property: / on*: / for:|if: バインディング
```

レイアウト:

- コンポーネントは **接続元の path 順** で並び替え（同じ path に繋がるノードを近くに配置して交差を減らす）
- 大きくなった場合は **マウスホイールでズーム / ドラッグでパン / ダブルクリック or Fit ボタンで全体表示**

ワイヤーの方向（矢印）と色:

| 方向 | 矢印 | 色 | 例 |
|------|------|-----|-----|
| `out` (state → DOM) | コンポーネント側 ▶ | 青 | `class.plus: count\|gt(0)` |
| `in` (DOM → state) | state 側 ◀ | オレンジ | `onclick: increment` |
| `inout` (双方向) | 両端 ◀▶ | シアン | `<input data-wcs="value: name">` |
| `structural` | コンポーネント側 ▶（破線） | 紫 | `<template data-wcs="for: items">` |

双方向の判定（state README の表に従う）:

- `<textarea>`: `value`
- `<select>`: `value`
- `<input>`: `value`, `valueAsNumber`, `valueAsDate`, `checked`
- 任意のタグ: `radio`, `checkbox`

その他:

- フィルタパイプライン (`|gt(0)`) はワイヤー上のインラインチップとして表示

## 対応済み（Stage 0a）

- mustache `{{ path }}` のテキストバインディングを検出してポート/ワイヤとして表示
- `<template data-wcs="for: ...">` の中身を再帰走査し、ループスコープに従って相対パス（`.name`）を解決
- ワイルドカードを含む path は state ハブ・コンポーネントポートともに **黄色イタリック** で区別表示
- structural コンテナ（`for` / `if`）の **視覚的ネスト**: 中の子コンポーネントは親の枠内にインデントして描画。半透明な紫系の背景でワイヤーが透けて見える。階層は無制限（`for: groups` の中の `for: .items` の中の `<p>` も再帰的にネスト）

## 既知の制約

- 編集機能なし（read-only ビジュアライザのみ）
- 一つのテキストノードに複数の mustache がある場合、それぞれ独立した `text` ポートになる（連結関係は失われる）
- ネストされた子へのワイヤーは親のコンテナ枠を **直線で貫通** する（明示的なルーティングはしない）。半透明背景で破綻はしないが、複雑なグラフでは混雑し得る

## 検証スクリプト

```bash
node scripts/sanity.mjs        # パース結果のダンプ + レンダラの smoke test
node scripts/test-roundtrip.mjs # 削除のラウンドトリップ自動テスト
```

- **sanity.mjs**: `examples/*.html` をパースして state path / port / wire の構造 + sourceRange + viewBox サイズを表示
- **test-roundtrip.mjs**: 各種パターン（先頭 / 末尾 / 唯一 / structural）でワイヤー削除 → 再パースし、対象が消え、他が残ることを検証
