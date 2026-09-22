# State 3.x 名前の提案表（B12）

起草日: 2026-09-22。[state-3x-plan.ja.md](./state-3x-plan.ja.md) の D37 に基づく名前ごとの提案。出す版は 3.2 の予定。

**この文書は決定ではない。** 行ごとに採否を決める（§3）。

## 1. 前提（決定済み）

- **エイリアス**（D4 / D38）
  - 旧名は 3.x の間は残し、4.0 で外す。
  - フィルタは登録簿の別表でエイリアスを持つ。宣言キーは state の設定時に 1 回だけ正規化し、両方の綴りを宣言したらエラーにする。
- **告知**（D39）
  - lint は、正式名を提案する info を最初から出す。
  - ランタイムの警告は 3.x の最後の minor だけにする（2.6 の `wcs/v3-migration` と同じ運用）。
- **対象の絞り方**
  - 名前が意味を取り違えさせるもの（変更操作に見える・逆操作に見える・定数に見える）と、JavaScript の標準名から外れた略語を対象にする。
  - 対になっていて慣習のある短い名前（`eq` / `ne` / `lt` / `le` / `gt` / `ge`、`mul` / `div` / `mod`、`int` / `float`、`date` / `time` / `ymd` / `hms`）は変えない。
  - フィルタを増やすこと自体は目的にしない（監査 §5.3）。

## 2. 現状の読み違い

| 名前 | 実際の働き | 読み違い |
|---|---|---|
| `inc(n)` / `dec(n)` | `value + n` / `value - n`（純粋な算術） | 値を書き換える操作に見える。`mul` / `div` と語の作りが揃わない |
| `fix(n)` | `Number.prototype.toFixed(n)` | 「直す」に読める |
| `uc` / `lc` / `cap` | 大文字化 / 小文字化 / 先頭だけ大文字 | 略語。JavaScript では `toUpperCase` / `toLowerCase` |
| `rep(n)` | `String.prototype.repeat(n)` | `replace` と紛れる |
| `rev` | 文字列の反転 | 略語 |
| `pad(n, c)` | `padStart` だけ | 片側しかないことが名前から分からない |
| `defaults(v)` | falsy（`0`・`false`・`""` を含む）を `v` に置き換える | nullish だけを置き換える手段が無い |
| `null` | `""` を `null` に変える | `null` 定数を返すフィルタに見える |
| `$trackDependency(path)` | 評価中の getter に辺を足す | `$untrackDependency` の逆操作に見える |
| `$untrackDependency(fn)` | `fn` の中の読みを追跡しない | 辺を消す操作に見える |
| `$updatedCallback` | **適用された束縛**の更新を受ける | state の更新全体を受けるように見える（受けたいときは `$watch`） |
| `$streams` | stream 宣言の表 | `$watch` / `$scan` は単数形 |
| `#ro` | 要素 → state の書き戻しを止める | readonly プロキシ（state への書き込み禁止）と語が同じ |

## 3. 提案（行ごとに決める）

| ID | 現名 | 提案 | 旧名の扱い | 推奨 |
|---|---|---|---|---|
| V1 | `inc(n)` / `dec(n)` | `add(n)` / `sub(n)` | エイリアス | **採る**。`mul` / `div` と揃い、変更操作に見えない |
| V2 | `fix(n)` | `toFixed(n)` | エイリアス | **採る**。JavaScript の名前そのまま |
| V3 | `uc` / `lc` | `upper` / `lower` | エイリアス | **採る**。`capitalize`（V4）と語の作りが揃う |
| V4 | `cap` | `capitalize` | エイリアス | **採る** |
| V5 | `rep(n)` | `repeat(n)` | エイリアス | **採る**。`replace` との取り違えを消す |
| V6 | `rev` | `reverse` | エイリアス | **採る** |
| V7 | `pad(n, c)` | `padStart(n, c)` と、新しい `padEnd(n, c)` | `pad` は `padStart` のエイリアス | **採る**。JavaScript の対そのまま |
| V8 | `defaults(v)` | 名前は変えない。nullish だけを置き換える `coalesce(v)` を足す | — | **採る**。`defaults` の falsy の意味は正しく使われているので残す。`coalesce` は SQL の COALESCE と同じ読み方 |
| V9 | `null` | `nullIfEmpty` | エイリアス | **採る**。SQL の NULLIF と同じ読み方 |
| V10 | `substr(start, length)` / `slice(start, end)` | 変えない | — | **変えない**。`substr` は JavaScript では非推奨だが、ここで名前を変えても引数の意味の違いは消えない。扱いは 4.0 で考える |
| V11 | `$trackDependency(path)` | `$dependOn(path)` | エイリアス | **採る** |
| V12 | `$untrackDependency(fn)` | `$untracked(fn)` | エイリアス | **採る**。V11 と並べても逆操作に見えない |
| V13 | `$updatedCallback` | `$renderedCallback` | エイリアス（宣言キーの正規化） | **採る**。`$connectedCallback` / `$errorCallback` と同じ `…Callback` の形で、「描画が済んだ」ことを名前で言う |
| V14 | `$streams` | `$stream` | エイリアス（宣言キーの正規化） | **採る**。`$watch` / `$scan` と単数で揃う。`$streamStatus` / `$streamError` の名前空間はそのまま |
| V15 | `#ro` | 変えない（README で「要素 → state を止める」と方向を明記する） | — | **変えない**。すべての `#ro` を書き換えさせるほどの得が無い。方向の語彙（to-element / from-element / two-way）は 4.0 で考える |

各行は、エイリアス表・lint の info・README（ja / en）の正式名への書き換え・VS Code 拡張の補完とプリアンブル・wcstack-skill の追随をひとまとまりとして入れる。

**決定（2026-09-22）**: V1〜V15 はすべて推奨どおりに決めた（ユーザー判断）。3.2 で入れる。

**追記（2026-09-22、実装）**: V1〜V14 を実装した（V10・V15 は変えない）。

- フィルタのエイリアスは `filters/filterAliases.ts` の 1 表にある。登録簿（`core/filterRegistry`）が旧名を正式名の実装・引数の個数へ解決し、manifest に `filterAliases` を足した。
- 宣言キーは `declarationAliases.ts` が、state がランタイムに入る入口で 1 回だけ正式名へ写す。入口は State の setter・ボリュームの `loadStateFromSource`・マウント記録・各宣言の処理関数で、WeakSet により冪等にしてある。
- 定数は正式名にしたので、エラー文も正式名で出る。
- 拡張は旧名を正式名と同じに解析し、`wcs/name-alias`（info）で正式名を提案する。
- 途中で、`add` / `sub`（`inc` / `dec`）の引数個数表が「省略可」だった誤りを直した（実装と README は必須）。
- サイズ（gzip、3.1.0 の基準との差）は `auto.min.js` が +392 B、`index.esm.js` が +498 B、分割形の core が +557 B。

リリース時に行うことが 2 つある。

- README 本文の例文（旧名が 56 か所）とリポジトリの examples（旧名 14 か所）を正式名へ書き換える。これらのページは CDN の最新版を読むので、3.2 の公開より前に書き換えると 3.0 / 3.1 で動かない。
- 表と定義箇所には、正式名と旧名を併記した注記を既に入れてある。

**追記（2026-09-22、3.2.0 の公開後）**: README・パッケージの docs・examples を正式名へ書き換えた（37 ファイル）。

- 数え直すと、旧名は本文の説明にも多く、フィルタが 13 か所、API と宣言キーが 322 か所あった。大半は `$streams` と `$updatedCallback` への言及で、上の「56 か所・14 か所」は例文だけの見積もりだった。
- 旧名を併記した注記（同じ行に正式名がある行）は残した。見出しの書き換えで変わった state README のアンカー（`#streams-stream` / `#streamstream`）はリンクも直した。
- 版の来歴を述べた文（「`$streams` は v1.19.0 から」）は、書き換えると誤りになるので旧名のまま残した。
- 設計文書（`docs/`）・CHANGELOG・e2e の固定ページは書き換えていない。e2e の固定ページは旧名がエイリアスとして動くことの確認にもなっている。

## 4. 決めていないこと

- 新しい名前（`add` / `sub` / `upper` …）と同名のカスタムフィルタが既にあるページ: 3.x には公開の登録 API が無い（組み込み 46 個だけ）ので衝突は起きない。登録 API を作るときに考える。
- エイリアスの名前を DevTools と manifest にどう出すか: manifest の `filters` には正式名だけを載せ、`filterAliases`（旧名 → 正式名）を足す案。実装時に決める。
