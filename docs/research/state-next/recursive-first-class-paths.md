# 調査: 再帰パス `**` の第一級化

- 調査日: 2026-09-23
- 対象: `wcstack-next-major` の現在の作業ツリー。v2.x で導入した機構の現存実装を調査した。v2 のリリースタグとの差分比較ではない。
- 状態: 設計提案。製品コードの変更なし。

## 1. 結論

**可能。推奨は、再帰パスを共通のパスモデルで正式に表現し、各操作の境界で固定長の実行アドレスへ解決する構成。** 現行の `PathInfo` に `**` をそのまま混ぜる変更とは区別する。

「第一級化」を次の二つに分ける。

1. **パス表現・操作の第一級化**: 通常パスと再帰パスを同じ解析・解決インターフェースで扱い、読み書き、明示的解決、宣言、HTML で各操作の意味を定める。実現性は高い。具体アドレスを使う現在のキャッシュ・依存管理は再利用できる。
2. **実行アドレス・依存グラフまでの第一級化**: 深さごとの具体パスを生成せず、再帰パス自身をエンジンのキーにする。原理的には可能だが、固定長パスを前提にしたアドレス、リスト、依存展開の再設計になる。最初の到達点には勧めない。

第一級のパスであっても、未束縛のパス族は単一の値ではない。通常の `*` と同様、単一値を得るには行を決める必要がある。トップレベルの `this["nodes.**.value"]` を暗黙の全件取得に変更する必要はない。

## 2. 現在の境界

[旧設計 D2](../../state-recursive-path-design.md) は、`**` をオーサリング層に留めることを意図的に選択している。[実装計画](../../state-recursive-path-impl-plan.md) でも `$resolve`、setter、HTML、watch は初版の対象外だった。

現在の経路は次のとおり。

```text
"nodes.**.value" + $recursion + 文脈の深さ
  → "nodes.*.children.*.value" など
  → PathInfo + ListIndex
  → 読み書き / キャッシュ / 依存管理
```

| 消費者 | 現在の対応 |
|---|---|
| 再帰 getter 宣言 | 対応。深さごとに通常 getter を遅延生成 |
| `this["nodes.**.value"]` | 再帰 getter、アンカー配下の行 getter・行イベント等の文脈で対応 |
| `$getAll(path)` | 文脈の深さへ束縛し、既存の列挙に委譲 |
| `$getAll(path, [])` | アンカー全体を全深さ列挙 |
| `$setAll(path, [], value)` | 葉属性への定数ブロードキャストのみ |
| `$resolve`、直接代入、`$postUpdate`、`$dependOn` | `**` は非対応 |
| 再帰 setter | 宣言時に拒否 |
| HTML、`$watch`、`$listKeys` | `**` は非対応 |

根拠:

- [PathInfo.ts](../../../packages/state/src/address/PathInfo.ts): `**` を intern 前に拒否。
- [recursion/addressHooks.ts](../../../packages/state/src/recursion/addressHooks.ts): get と二つの一括 API の入口だけを拡張。
- [recursion/bind.ts](../../../packages/state/src/recursion/bind.ts): 最内側の評価フレームから深さを取る。
- [recursion/registry.ts](../../../packages/state/src/recursion/registry.ts): 深さ別 getter 生成と衝突・書き込み禁止の管理。
- [parseStatePart.ts](../../../packages/state/src/bindTextParser/parseStatePart.ts): HTML 解析時点で固定長 `PathInfo` を要求。

## 3. 制限のうち、解除できるもの

### 3.1 `$resolve` の可変長添字は、現行の宣言範囲なら一意に解釈できる

アンカーの `*` 数を A、反復部分の `*` 数を R、接尾辞の `*` 数を S、完全指定された添字数を N とすると、再帰深さは次で求められる。

```text
depth = (N - A - S) / R
```

現行は A = R = 1 なので `depth = N - 1 - S`。非負整数であることを検査し、その深さの具体パスを既存の `$resolve` に渡せる。

```js
// 以下は提案する対応形。現行 API は ** を拒否する。
this.$resolve("nodes.**.value", [0]);       // nodes.*.value / depth 0
this.$resolve("nodes.**.value", [0, 2]);    // nodes.*.children.*.value / depth 1
this.$resolve("nodes.**.value", [0, 2], 7); // 同じ一つの葉へ書く

// 最後の添字は tags 用。再帰の深さへ算入しない。
this.$resolve("nodes.**.tags.*.name", [0, 2, 1]); // depth 1
```

したがって「行ごとに添字の本数が違う」こと自体は `$resolve` 対応を不可能にしない。これは旧 D9 の再検討に値する。対象は現行の単一再帰宣言・単一 `**` であり、複数 `**` の場合は本数だけでは深さの配分が決まらない。

ただし、既存の [getListIndexByIndexes.ts](../../../packages/state/src/proxy/methods/getListIndexByIndexes.ts) は既に存在する台帳を必要とする。**初回の読み書きでも使える完成形には、対象経路上のリスト台帳の準備と差分基準の整合が必要**。毎回全木を `$getAll` して準備する実装は避ける。

### 3.2 `$setAll` mapper / spread は実装不可能ではない

[setAllRecursive.ts](../../../packages/state/src/recursion/setAllRecursive.ts) の禁止理由は API 契約と使いやすさの判断。

- JavaScript の `(current, ...indexes)` 自体は可変長添字を受け取れる。単一 `**` なら上の式で深さも復元できる。
- 明示的な `{ depth, indexes, path }` のようなコンテキストを渡す API も選べるが、新しいシグネチャは必須条件ではない。
- spread の順序は既に深さ優先・行きがけ・添字昇順に定義されている。ただし構造変更による割り当て先のずれ、値数の照合などの仕様が必要。
- mapper 内の副作用・ユーザー setter が木を変更する場合、先に集めたアドレスが失効する。対象列挙と書き込みの二相化だけでは解決しない。

### 3.3 単一行への書き込みと構造の一括書き換えは別問題

文脈内の直接代入は、読みと同様に `**` を束縛して `setByAddress` へ渡すことで対応できる。現行の set trap は正規化 hook より先に `getResolvedAddress` へ進むため、入口の追加が必要。

再帰 setter は、生成 accessor の descriptor に setter を持たせ、評価アドレスを積む既存 setter 経路を利用する案が考えられる。ただし未実体化の具体パスへの初回書き込み、readonly 判定、衝突検査、生成物の世代管理まで変更する必要がある。禁止条件を消すだけでは実装にならない。

ノードや children の**全深さ一括置換**は、祖先の置換で子の対象アドレスが失効する別の問題。第一級化の初期段階でも現在の禁止を維持できる。

## 4. 推奨する内部モデル

以下の名前は設計案で、既存 API ではない。

```ts
type PathExpression = FixedPathExpression | RecursivePathExpression;

// 操作の違いを明示する。
resolveOne(expression, contextOrIndexes); // → 具体的な IStateAddress
enumerate(expression, selection);        // → 具体的な IStateAddress[]
matchFamily(expression, concretePath);   // → 一致と再帰深さ
```

- 構文解析は、state が未確定でも再帰パスを表現できるようにする。
- `$recursion` の解釈は state の宣言・世代に属する。同じ `nodes.**.x` でも state ごとに反復部分が違い得るため、解決済み再帰式を文字列だけで大域 intern しない。
- 固定長 `PathInfo`、具体アドレス、キャッシュの identity は維持する。未束縛 `**` に固定の `wildcardCount` を割り当てない。
- 束縛・列挙・族照合を共通化し、API ごとの特別扱いを減らす。
- 再帰未使用の state は通常経路のままにし、現在の feature 分割を保つ。第一級であることと全利用者への常時ロードは別。

これなら再帰パスは共通のパス体系の正式な種別になる。実行時に具体アドレスへ落とすことは、その第一級性を妨げない。

## 5. 残る消費者の設計課題

| 領域 | 実現方法と主な課題 | 相対的な変更規模 |
|---|---|---|
| `$resolve` | 完全添字から深さを確定。台帳の初期化も扱う | 小〜中 |
| 直接代入・`$postUpdate`・`$dependOn` | 現在行への束縛を共通化。全深さ操作とは混同しない | 小〜中 |
| 再帰 setter | getter と同様の生成。初回書き込みと readonly 検査を対称化 | 中 |
| `$setAll` mapper | 行ごとの可変長添字、構造変更時の扱いを定義 | 中 |
| `$listKeys` | 具体リストパスを再帰族と照合し、キー指定を返す。通常宣言との重複規則が必要 | 中 |
| `$watch` | 全深さの族として購読。深さの増加、親リスト置換、旧値、削除行を扱う | 中〜大 |
| HTML | 解析結果に再帰式を保持し、行文脈確定後に具体化。再束縛・双方向更新・SSR にも対応 | 中〜大 |
| 再帰テンプレート | 任意深さの DOM 生成・破棄と文脈伝搬。HTML に `**` を許すこととは別機能 | 大 |
| 内部アドレスまで `**` 化 | 固定長 arity、依存グラフ、キャッシュ、スコープ相対添字の再設計 | 非常に大 |

watch は現在、具体パスの完全一致で宣言を引き、宣言時に静的依存を登録する。既知の深さを一度展開するだけでは、後から生まれた深さを取りこぼす。書き込みバッチとの族照合だけでも、親リスト置換からの子の通知は完成しない。通常のワイルドカード computed watch にも初期評価の制約があるため、再帰版の eager/lazy 契約を明記する。

HTML の通常バインドは、一つの行に束縛されるなら定義しやすい。一方 `for: nodes.**` は、全ノードを平坦に並べるのか、階層を再帰描画するのかが未定義。後者をパスの第一級化だけで実現したと扱わない。現行の自己参照コンポーネント描画も引き続き成立する。

`$getAll(path, [0])` のような**部分添字**は、完全指定の `$resolve` と異なる。深さを固定した残りの列挙と、特定のノード以下の全深さ列挙を区別する選択規則が必要。既存の「省略＝文脈束縛、`[]`＝全体」の意味は維持するのが安全。

さらに `$scan` / `$stream` のパス指定、`$eqPath` 等の鍵付き依存、mount / bind-component、公開型・エディタの型面も監査対象。現在の再帰パスの型は広い `any` と readonly の索引なので、実行時対応だけで型対応を完了としない。

## 6. 内部アドレスまで直接第一級化する場合の障害

現在は [wildcardLevel.ts](../../../packages/state/src/list/wildcardLevel.ts) が `ListIndex` の長さを「スコープ基底 + 固定の wildcardCount」として扱う。[calcWildcardLen.ts](../../../packages/state/src/address/calcWildcardLen.ts) と [walkDependency.ts](../../../packages/state/src/dependency/walkDependency.ts) は固定パスの共有ワイルドカードから展開・親への縮約を決める。

また、親の total と子の total は現在は**異なる具体パス**で、依存辺を張れる。これを一つの `nodes.**.total` にまとめると、パスレベルでは自己辺になる。現在の自己依存除外・トポロジカル順序・循環検出をそのまま使えない。再帰の深さの変化と行の祖先関係を持つ依存辺が必要になる。

この再設計には、深さ別 getter・PathInfo の生成数を減らせる可能性がある。ただしメモリ・速度の改善は未測定。第一級の表現を追加するだけでは既存のグローバル PathInfo intern は減らず、128 ワイルドカード段の上限、評価スタックの上限、共有非空 children 配列の制限も自動的には解除されない。

## 7. 推奨する実施順

1. 共通パス表現と `resolveOne` / `enumerate` / `matchFamily` の契約を決める。単一アンカー・単一 `**`・明示的 `$recursion` は維持する。
2. `$resolve` と文脈内の書き込み・通知・依存宣言を対応させる。未走査の木の初回操作も受け入れ条件にする。
3. 再帰 setter と `$listKeys`、続いて `$watch` の族対応を行う。増深・木の置換・再設定のライフサイクルを検証する。
4. HTML の行束縛を導入する。全深さ `for` や再帰テンプレートは別の契約として判断する。
5. 必要な性能測定の結果が出た場合に、具体パス生成を廃する内部エンジンの再設計を検討する。

各段階で runtime、[recursionValidator.ts](../../../packages/vscode-wcs/src/service/recursionValidator.ts)、静的 parser、lint、manifest、日英 README、公開型を揃える。`data-wcs` の対応範囲を変える場合は別リポジトリの wcstack-app skill も更新する。

## 8. 実測

現在の作業ツリーで以下を実行した。

```text
packages/state> npm test -- recursion PathInfo.test.ts
10 files / 506 tests passed
```

これは既存の拒否仕様と既知不具合を固定する characterization test も含む。通過を「すべての既知不具合がない」という意味では扱わない。SSR 統合テストから既存の binding-path-missing 警告が出た。

さらに一時的な調査テストで、`splitRecursivePath` → `depth = indexes.length - 1 - suffixArity` → `concretePathAt` → 既存 `$resolve` のアダプタを検証した。

| 検証 | 結果 |
|---|---|
| `[0]` / `[0,0]` / `[0,0,0]` から深さ 0 / 1 / 2 の value を読む | `1 / 10 / 100` |
| `nodes.**.tags.*.label` の接尾辞の `*` を差し引く | root / child を正しく区別 |
| 最深の value を `100 → 500` にする | 全体 `133 → 533`、親 `131 → 531`、中間 `110 → 510` |
| 読み・描画前に深い `$resolve` を行う | `ListIndexes not found`。文字列変換だけでは未対応 |

4 tests passed。成功する3件では先に通常の再帰読みで台帳を準備した。このプローブは `$resolve` の第一級化を製品実装したものではない。調査後に一時テストは削除し、製品コードと既存テストは変更していない。
