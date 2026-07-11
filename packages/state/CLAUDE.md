# CLAUDE.md — @wcstack/state

## Language

ユーザーへの応答は常に日本語で行うこと。コード・コミットメッセージ・変数名などは英語のまま。

## Package Overview

`@wcstack/state` はリアクティブな状態管理パッケージ。`<wcs-state>` カスタム要素と `data-wcs` 属性による宣言的データバインディングを提供する。ランタイム依存ゼロ。

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
│   └── *.ts                # data-wcs 属性値のパース
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
├── stream/                 # $streams (非同期プロデューサー → fold → リアクティブプロパティ)
│   ├── types.ts            # StreamStatus, IStreamDefinition, IStreamEntry, StreamSource
│   ├── processStreamsDeclaration.ts  # $streams 宣言のバリデーション・registry 登録・値プロパティ実体化
│   ├── streamRegistry.ts   # WeakMap registry (status/error の正本), abort/clear
│   ├── streamRuntime.ts    # 起動・restart 手順、status/error 反映、依存駆動 restart の drain リスナー
│   ├── argsTrace.ts        # args の依存捕捉 (readonly proxy トレース、自己依存/wildcard 検査)
│   ├── consumeSource.ts    # チャンク消費ループ (AsyncIterable / ReadableStream getReader フォールバック)
│   ├── streamNamespace.ts  # $streamStatus / $streamError の read-only namespace proxy
│   ├── lastNotified.ts     # 通知 dedup 台帳 (最後に通知した観測値)
│   └── activeStateElements.ts  # 起動中 stateElement 集合 (restart 対象の走査元)
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
3. DOM 走査 → `data-wcs` 属性と `<!--wcs-*-->` コメントノードを収集
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

#### Spread (`...`)

wc-bindable 対応カスタム要素に対して `...: target` で properties + inputs を一括配線:
- `bindingType: 'spread'` として一旦パース → `bindTextParser/expandSpread.ts` で `wcBindable.properties + inputs` を読み propName ごとの個別エントリに展開
- 後勝ちで explicit binding が spread を上書き（`config.debug` 時 `console.debug` で通知）
- カスタム要素未登録時は `IDeferredSpreadEntry` を `customElements.whenDefined()` 待ちで保持し、登録後 `processDeferredNode` で再展開（`parseResults` を closure capture することで happy-dom の upgrade 時属性消失を回避）
- filter は禁止、`@stateName` は伝播、右辺の `*` は途中可
- commands と event token は spread 対象外（pub/sub 境界を明示）

**Composite Profile 対応** (COMPOSITE.md / SPEC-extensions § 4):
- composite shell は `target.constructor.wcBindable` で synthesized declaration を露出するため、spread は composite-aware なコードを持たずに透過対応
- composed name `<sourceId>.<sourceName>` (例: `"s3.progress"`) は単一セグメントとして扱い、要素側ではフラットなプロパティキー (`element["s3.progress"]`) として書き込み
- state path 側は `targetBase.s3.progress` の nested アクセスとして解決されるため、state を `{ s3: { progress: 0 } }` のように nested 構造で持てば自然に通る
- Tier claim symbol (`Symbol.for("wc-bindable.composite.tiers")`) は spread では参照しない — T1 (observation) / T2 (writable inputs) は通常のプロパティ代入で透過対応、T3 / commands は spread 対象外の方針通り
- 回帰防止テスト: `__tests__/integration.spreadComposite.test.ts`

**wcBindable 未宣言の要素**:
- `expandSpread` は即エラー (`raiseError`) で失敗させる方針
- CSBC の契約原則: spread には wcBindable contract が必須。native HTML 要素や非対応 custom element は `value: x; checked: y` のような明示配線で個別に書く
- 将来的に native 要素フォールバックが必要になった場合は別構文 (例: `...native: el`) として opt-in 導入する余地は残す

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
- `BindingType`: `'text' | 'prop' | 'event' | 'for' | 'if' | 'elseif' | 'else' | 'radio' | 'checkbox' | 'spread'`
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
- バインド属性名: `data-wcs`
