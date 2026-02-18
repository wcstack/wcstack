# 初期化シーケンス

## 1. `<wcs-state/>`コンポーネントのロード

`bootstrapState()` → `registerComponents()` で登録。
`customElements.define("wcs-state", State);`

## 2. `<wcs-state/>`の`connectedCallback`

HTML内に`<wcs-state/>`の定義があれば呼ばれる。

2-1. `_initializeBindWebComponent()`
  `bind-component`属性がある場合、親コンポーネントから状態オブジェクトを取得し`setInitialState()`でセット。
  親コンポーネントの特定は`parentNode`で行う:
  - ShadowDOM直下: `parentNode`がShadowRoot → `parentNode.host`が親コンポーネント
  - LightDOM: `parentNode`がElement → それが親コンポーネント
  親がカスタム要素でない場合はエラー。
  LightDOMの場合、名前空間が上位スコープと共有されるため`name`属性が必須。

2-2. `_initialize()`（状態のロード）
  以下の優先順位で状態を読み込む:
  - `state`属性 → インラインJSON
  - `src`属性 → `.json`ファイル or `.js`ファイル
  - `json`属性 → JSON文字列
  - `<script type="module">` → インナースクリプト
  - いずれもない場合 → `setInitialState()` APIによる外部セットを待機

  読み込み後:
  - `name`属性を決定（デフォルト: `'default'`）
  - `stateElementByNameByNode`（`WeakMap<Node, Map<string, IStateElement>>`）に登録
  - そのrootNodeへの初回登録時、`queueMicrotask`で`buildBindings()`を起動

2-3. `_bindWebComponent()`
  `bind-component`属性がある場合、外部コンポーネントとのバインディングを確立。

2-4. `_resolveInitialize()`
  `initializePromise`を解決し、buildBindingsの初期化待ちを解放。

2-5. `_callStateConnectedCallback()`
  状態に`$connectedCallback`が定義されていれば呼び出す。

## 3. 初期化起動（`buildBindings.ts`）

DocumentとShadowRootで処理が分岐する。

Document: waitForStateInitialize → convertMustacheToComments → collectStructuralFragments → initializeBindings
ShadowRoot: 上記に加え、initializeBindings前に`waitInitializeBinding(host)`が入る

3-1. `waitForStateInitialize()`
  ルート内の全`<wcs-state/>`を取得し、各要素の`initializePromise`が解決されるまで待機。

3-2. `convertMustacheToComments()`
  `{{ expression }}`形式のMustache構文をコメントノード（`<!--@@: expression-->`）に変換。

3-3. `collectStructuralFragments()`
  `data-wcs`属性(if/else/elseif/for)を持つ`<template/>`を全てFragmentにしコメントに置き換える。
  bindingの部分情報をfragmentに紐づける。

3-4. `waitInitializeBinding()`（ShadowRootのみ）
  ホスト要素のバインディング初期化完了を待機。

3-5. `initializeBindings()`
  - `data-wcs`属性を持つ要素・コメントを収集し、完全なbinding情報を取得
  - ループコンテキスト設定
  - ノード置換・イベントハンドラ（通常・双方向・ラジオ・チェックボックス）アタッチ
  - 絶対ステートアドレス作成・バインディング登録
  - `applyChangeFromBindings()`で全バインディングの初期値を適用

