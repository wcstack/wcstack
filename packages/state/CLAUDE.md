# CLAUDE.md — @wcstack/state

## Language

ユーザーへの応答は常に日本語で行うこと。コード・コミットメッセージ・変数名などは英語のまま。

## Package Overview

`@wcstack/state` はリアクティブな状態管理パッケージ。`<wcs-state>` カスタム要素と `data-bind-state` 属性による宣言的データバインディングを提供する。ランタイム依存ゼロ。

## Commands

```bash
npm run build            # clean → tsc → rollup
npm test                 # vitest run
npm run test:watch       # vitest watch
npm run test:coverage    # カバレッジ付き (100/97/100/100)
npm run lint             # ESLint on src/
npx vitest run __tests__/someFile.test.ts  # 単一テスト実行
```

## Directory Structure

```
src/
├── exports.ts              # パッケージエントリポイント (bootstrapState のみ公開)
├── bootstrapState.ts       # 初期化: registerComponents + registerHandler
├── config.ts               # グローバル設定 (属性名, コメントプレフィックス等)
├── define.ts               # 定数: DELIMITER('.'), WILDCARD('*'), MAX_WILDCARD_DEPTH(128)
├── types.ts                # IState, IConfig, ITagNames
├── components/
│   └── State.ts            # <wcs-state> カスタム要素の実装
├── address/
│   ├── PathInfo.ts         # パス解析・ワイルドカード情報
│   ├── StateAddress.ts     # パス + リストインデックスのアドレス
│   ├── ResolvedAddress.ts  # ワイルドカード解決済みアドレス
│   └── AbsoluteStateAddress.ts  # ステート名を含む絶対アドレス
├── proxy/
│   ├── StateHandler.ts     # Proxy handler (get/set/has トラップ)
│   ├── traps/              # get, set トラップの実装
│   ├── apis/               # connectedCallback, getAll, resolve, trackDependency 等
│   └── methods/            # setByAddress, getListIndex, checkDependency 等
├── binding/
│   └── *.ts                # バインディング情報とアドレス間の変換
├── bindings/
│   └── *.ts                # DOM ノード走査、バインディング収集・初期化
├── bindTextParser/
│   └── *.ts                # data-bind-state 属性値のパース
├── apply/
│   ├── applyChange.ts      # 変更適用のエントリポイント
│   ├── applyChangeTo*.ts   # Text, Attribute, Class, Style, Property, Element, SubObject, If, For
│   ├── getValue.ts         # プロキシからの値取得
│   └── getFilteredValue.ts # フィルタパイプライン適用
├── structural/
│   ├── activateContent.ts  # コンテンツのマウント/アンマウント
│   ├── createContent.ts    # template からコンテンツ生成
│   ├── collectStructuralFragments.ts  # for/if テンプレート収集
│   └── contentByNode.ts    # ノードからコンテンツ管理
├── list/
│   ├── createListIndex.ts  # リストインデックス生成
│   ├── createListDiff.ts   # 配列差分計算
│   ├── loopContext.ts       # ループコンテキストスタック
│   └── listIndexesByList.ts # リストからインデックスマップ
├── filters/
│   ├── builtinFilters.ts   # 組み込みフィルタ (eq, ne, lt, gt, uc, lc, date 等 40+種)
│   └── errorMessages.ts    # フィルタエラーメッセージ
├── event/
│   ├── handler.ts          # イベントハンドラ
│   └── twowayHandler.ts    # 双方向バインディング
├── updater/
│   └── updater.ts          # 変更通知・DOM更新
├── dependency/             # 依存関係追跡
├── stateLoader/            # 状態ロード (innerScript, jsonFile, scriptFile, scriptJson)
├── cache/                  # キャッシュ
├── hydrater/               # ハイドレーション
└── version/                # バージョン管理 (変更検知)
```

## Architecture

### Core Flow
1. `bootstrapState()` → カスタム要素登録 + イベントハンドラ登録
2. `<wcs-state>` の `connectedCallback` → 状態ロード (JSON/Script/属性)
3. DOM 走査 → `data-bind-state` 属性と `<!--wcs-*-->` コメントノードを収集
4. バインディング情報を解析 → Proxy 経由でリアクティブにDOM更新

### Binding Syntax
```
[property][#modifier]: [path][@state][|(filter | filter(args))...]
```
- `property`: DOM プロパティ名 (textContent, value, class 等)
- `#modifier`: 修飾子
- `path`: 状態パス (ドット区切り、`*` でワイルドカード)
- `@state`: 対象ステート名 (省略時は default)
- `|filter`: フィルタパイプライン

### Reactive Proxy
- `StateHandler` が ES Proxy の handler として get/set/has を実装
- get トラップで依存追跡、set トラップで変更通知
- `Mutability` は `"readonly" | "writable"`

### Structural Rendering
- `<!--wcs-for-->`: リストレンダリング (配列差分による効率的DOM更新)
- `<!--wcs-if-->` / `<!--wcs-elseif-->` / `<!--wcs-else-->`: 条件レンダリング

### Address System
- `IPathInfo`: パスのメタ情報 (セグメント、ワイルドカード位置、親パス等)
- `IStateAddress`: pathInfo + listIndex で具体的な位置を表現
- `IResolvedAddress`: ワイルドカード解決後の実パス

### Key Types
- `BindingType`: `'text' | 'prop' | 'event' | 'for' | 'if' | 'elseif' | 'else'`
- `IBindingInfo`: バインディングの完全な情報 (プロパティ名、パス、フィルタ、ノード等)
- `IListIndex`: ネストされたループのインデックス管理
- `ILoopContext`: ループコンテキスト (elementPathInfo + listIndex)

## Testing

- テストファイル: `__tests/*.test.ts`
- テスト記述は日本語
- カバレッジ閾値: statements 100%, branches 97%, functions 100%, lines 100%
- 環境: happy-dom
- セットアップ: `__tests__/setup.ts`

## Conventions

- パス区切り文字は `.` (DELIMITER)
- ワイルドカードは `*` (WILDCARD)
- ステート名省略時のデフォルトは `'default'`
- コメントノードプレフィックス: `wcs-text`, `wcs-for`, `wcs-if`, `wcs-elseif`, `wcs-else`
- バインド属性名: `data-bind-state`
