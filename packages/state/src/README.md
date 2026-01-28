# 初期化プロセス

## 概要
DOMContentLoaded時に以下の2フェーズで初期化を実行

## フェーズ1: 構造的要素の収集と置換
目的: テンプレート要素を解析し、プレースホルダーに置換

### 処理対象
`<template data-bind-state="...">` 要素:
- `if: stateName` - 条件分岐
- `elseif: stateName` - 条件分岐（else if）
- `else:` - 条件分岐（else）
- `for: stateName` - ループ

### 処理内容
1. TreeWalkerで全`<template>`要素を探索
2. 各テンプレートに対して：
   - UUIDを生成
   - `template.content`（DocumentFragment）を`fragmentByUUID`に保存
   - `data-bind-state`属性を解析し`parseBindTextResultByUUID`に保存
   - コメントノード `<!--wcs-xxx:UUID-->` を作成し`<template>`を置換
3. 再帰的にtemplate.content内も処理

## フェーズ2: バインディングの初期化
目的: バインド対象要素を収集し、state要素と接続
if/forなどのIContentに対しても実体化時にも実行する

### 処理対象
- コメントノード: `<!--wcs-text:path-->`, `<!--wcs-if:UUID-->`, `<!--wcs-for:UUID-->`, `<!--wcs-elseif:UUID-->`, `<!--wcs-else:UUID-->`
- 属性バインド: `<element data-bind-state="propName: stateName">`

### 処理内容
1. バインド対象ノードを収集
2. 各ノードの`data-bind-state`を解析しbindingInfoを生成
3. イベントハンドラー（`onXxx`）を登録
4. 双方向バインディング（input/select要素）を設定
5. bindingInfoをstate要素に登録
6. 初期値を適用
7. 構造的要素（if/for）の内部も再帰的に処理

## データ構造
- `fragmentByUUID`: UUID → DocumentFragment
- `parseBindTextResultByUUID`: UUID → ParseBindTextResult
- `bindingInfo`: ノード、プロパティ名、ステート名、パスなどを含む