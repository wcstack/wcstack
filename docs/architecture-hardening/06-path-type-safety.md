# パス文字列の型安全性

- **状態**: 設計提案（未採択・未実装）
- **対象**: `data-wcs`、state path、filter、command / event token、リストの wildcard path

## 問題

HTML 属性に書くパス文字列は、TypeScript の property rename や型変更から切り離される。存在しない path、
入力と出力の型不一致、filter 後の型不一致は実行時まで残り得る。一方、文字列 DSL は buildless な利用、
DevTools での可視性、タグ間の疎結合を支えており、すべてを TS 式へ置き換えるのは設計思想に合わない。

## 現状の資産と限界

- state は宣言されていない path を初期化時に拒否する。
- `define-state` は `WcsPaths<T>` と `WcsPathValue<T, P>` を提供し、TS 内の dot path を補助する。
- `packages/vscode-wcs` の analyzer / binding validator は path、command、filter と type hint を解析し、
  補完と診断を提供する。
- runtime 検証は最後の防壁になるが、HTML の編集時や CI で全参照を保証する単一の契約はまだない。
- 動的 index、wildcard、getter / setter、filter chain では、静的に得られる型精度に限界がある。

## 推奨する三層モデル

### 1. authoring 型: TypeScript の path union

TS から path を渡す API は `WcsPaths<T>` / `WcsPathValue<T, P>` を利用し、literal を保持する helper を用意する。
rename 時にコンパイラが参照箇所を示せるよう、`string` へ早期に widen しない。動的 path は明示的な
`DynamicPath` または escape hatch とし、型安全な path と見分けられるようにする。

### 2. template 型: language service と CI validator

VS Code の解析器を再利用できる headless validator を提供し、HTML、template literal、example を CI で検査する。
診断には state 名、path segment、現在型、期待型、filter ごとの変換を含める。IDE と CI が別実装にならないよう、
parser、resolver、type lattice、診断 code を共通 package に置く。

### 3. runtime 型: 構造と capability の検証

runtime は外部入力や動的 DOM のために残す。少なくとも undeclared path、危険な prototype key、書き込み不能
getter、未知の command / filter、list context 外の wildcard を接続時に拒否する。値の完全な deep schema 検査は
既定で行わず、必要な境界だけ opt-in schema / predicate を使う。

## 型情報の供給

state 宣言から次の中間表現を生成する。

- state / path 名と readable / writable / command / event の種別
- scalar、array、object、nullable、unknown の type hint
- wildcard と list item の対応
- getter / setter の有無、filter の入力・出力型

custom element 側の property / input 型は、TypeScript declaration または任意の sidecar manifest から取り込む。
wc-bindable コア宣言へ必須の型字段を追加せず、型情報がないタグは `unknown` として段階的に検査する。
型 sidecar の versioning は [プロトコル進化と互換性](08-protocol-evolution.md) と独立に管理する。

統合設計では、再利用可能な tag / filter の契約を package manifest、実アプリの state path と binding graph を
application artifact に分ける。型語彙は JSON Schema の固定 subset とし、TypeScript 固有表現を公開 artifact の
必須形式にはしない。探索順、同名衝突、override 規則を schema で決め、暗黙の last-file-wins merge は行わない。

## filter chain の扱い

各 filter は入力型、出力型、option schema を公開できるようにする。validator は左から型を畳み込み、途中の
不一致を filter 名と位置付きで報告する。ユーザー定義 filter に情報がない場合は以後を `unknown` に落とし、
誤った確定診断をしない。`not` のような意味変換と path 構文を混ぜない。

## 互換性と移行

文字列 DSL と buildless runtime は維持する。第一段階は既存 VS Code validator の共通化と CI コマンド追加で、
警告として導入する。repository 内 example が clean になった後に、undeclared path と明白な型不一致を CI error に
昇格する。sidecar 型情報は optional とし、旧タグ・旧 manifest は `unknown` で受け入れる。

## 検証条件

- state property の rename により TS、HTML、template literal の参照が CI で検出される。
- readonly getter への双方向 write、command を通常値として読む誤りを検出する。
- array wildcard、nested list、`.length`、nullable、union を固定 fixture で検証する。
- filter chain の各段階と option 不一致に安定した診断 code が付く。
- `__proto__`、`constructor`、継承名を runtime / CI の双方で拒否する。
- 型情報なしのサードパーティタグを誤って拒否しない。
- IDE と headless validator が同じ入力へ同じ診断を返す。

## 非目標

- HTML 文字列を TypeScript コンパイラだけで完全に型検査すること。
- 任意の JavaScript getter やユーザー filter の戻り値を静的に証明すること。
- build step を wcstack 利用の必須条件にすること。

## 決定ゲート

1. 共通 analyzer をどの package に切り出すか。
2. element 型 sidecar の形式と生成元を何にするか。
3. warning から error へ昇格する診断 code と時期。
4. 動的 path escape hatch の構文と監査方法。

## 関連文書

- [define-state](../../packages/state/docs/define-state.md)
- [8 論点を横断する修正設計](09-remediation-design.md)
- [プロトコル進化と互換性](08-protocol-evolution.md)
- [観測性・デバッグと wc-bindable 境界](05-observability-and-wc-bindable.md)
