# state のスクリプトが書くもの — 本体ごとの書き込み集合から作る検査

- **状態**: 調査と実装、2026-11-07。著者が推奨の範囲・core の変更・この文書を同日に採った（§5）。作業は 4.17 の minor に入る（§6）。
- **English**: [script-write-checks.md](./script-write-checks.md)

問いは、setter やメソッドがどんな代入をするかを lint が AST から知れるなら、`@wcstack/state` で何を検査できるか、だった。この文書は、すでにあったもの、本体ごとの書き込み集合が足すもの、決めたこと、作ったものを記録する。

## 1. すでにあったもの

lint はすでに書き込みを読んでいた。[scriptAst.ts](../packages/vscode-wcs/src/service/scriptAst.ts) は getter・setter・メソッドの本体を acorn で歩き、`this` を通して state に届くものを集める: 複合代入と `++` / `--` は書く読み（`written: true`）として、4.16 の `writes` オプションでは単純代入の左辺と `$setAll` / `$update` のパス（`form: 'write'` / `'api-write'`）として。これを使う規則は 2 種類だった:

- **パスはあるか**: `wcs/write-path-missing`（4.4 でトップレベル、4.16 で入れ子）。
- **書き込みは proxy を通るか**: `wcs/nested-assign`・`wcs/array-mutation`・`wcs/array-index-assign`（スクリプトへの正規表現）。

どれも書き込みを 1 つずつ見ていた。本体が書くものと getter が読むものを突き合わせるものは無かった。

## 2. 書き込み集合が足すもの

呼び出し可能なものごとに、書くパスを（呼ぶメソッドを通して）すべて集め、getter の読み取り集合（`wcs/getter-cycle` のためにすでに集めている）と突き合わせる。このグラフで 4 つのことが決まる。ランタイムが何も名指さずに知らせていたか、まったく知らせていなかったものだ:

| code | 誤り | 4.17 より前のランタイム | 4.17 から（ランタイム / lint） |
|---|---|---|---|
| `wcs/getter-write` | getter が評価中に書く（本体でも、呼ぶメソッドの中でも） | `#8` `This state is readonly.` を投げる — パスも getter も無い | パスと getter を名指す / error |
| `wcs/path-readonly` | スクリプトが setter の無い getter に書く（`this.total = 0`） | `"total" is a getter without a setter` を投げる、code なし。lint は双方向の束縛だけを見ていた | code と直し方 / スクリプトの書き込みも error |
| `wcs/setter-cycle` | setter が自分のパスに書く、setter どうしが互いに書く | ガードが無く、何も名指さない `RangeError` でスタックが溢れる | diagnostics の後付けが 64 段で循環を名指して投げる / 自分への書き込みは error、2 つ以上の循環は warning |
| `wcs/setter-unobserved` | setter の書き込みのどれも、その getter が読まない | 黙る: getter は元の値のままで、双方向の入力はそこへ戻る | diagnostics の後付けが setter ごとに 1 回警告 / warning |

最後のものが、「沈黙ゼロ」の指針（[v4-direction-2026-10.md](./v4-direction-2026-10.md)）がいちばん求めるものだ。何も言っていなかった。

## 3. 近似の 2 つの向き

検査は逆向きの事実に立つので、集合も逆向きに近似する。

- **「書き込みがある」**（`getter-write`・`setter-cycle`）: 取りこぼす側。入れ子の関数の中の書き込み — getter が返すハンドラ、後で走るコールバック — は本体の実行中に走るとは限らないので数えない（AST の `nested: true`）。分岐の中の書き込みは数える: その分岐が走れば、ランタイムは投げる。
- **「どの書き込みも読みに届かない」**（`setter-unobserved`）: 両側を拾いすぎる側。入れ子かどうかを問わずすべての書き込み、`$untracked` の中も含めたすべての読み（追跡されない読みも起き、setter 自身の着地が getter をもう一度評価させる）。追えないものがあれば、その setter には黙る: `this[key]`、関数に渡した・spread した `this`、リテラルでない API のパス、state が宣言しないメソッドの呼び出し（AST の `form: 'opaque'`）。

`path-readonly` は、入れ子かどうかを問わず書き込みを報告する: 走れば投げる。宣言がすべて読める必要があるので、トップレベルに spread のある state（setter を持ち込みうる）では黙る。

書き込みが読みに届くのは、一方のパスが他方と同じか、その下にあるとき（数値の段と `*` はどの段とも合う）: `user.name` への書き込みは `user` を読む getter に届き、`names` への書き込みは `names.first` を読む getter に届く。setter のパスへの書き込みは、ランタイムと同じく、その setter が書くものも数える。

## 4. ランタイムと lint を一緒に

指針は層を順位づける: 設計で消す、次に実行時に知らせる、次に lint、次に文書。だから検査ごとにランタイムの側を持ち、ランタイムの側はできるかぎり core の外に置く:

- **`getter-write`** は core が要る: core は引数なしで `#8` を投げていた。1 つのメソッド `Engine.refuseWrite(path)` が 3 か所の検査（`$update`・`write`・`$setAll`。recursion の後付けも呼ぶ）を置き換え、パスと評価中の getter（`top`）を渡す。diagnostics の後付けは `[wcs/getter-write] "count" is written while the getter "total" is evaluated: a getter only reads. …` と描き、readonly のコールバックは `cannot write "count": this state is readonly.` と言う。core は 15 B 増える（上限 20,480 B のうち 20,392 → 20,407 B）。
- **`path-readonly`**: `#2` の文面に code・直し方・lint の案内が付く。core は 0 B。
- **`setter-cycle`** と **`setter-unobserved`**: diagnostics の後付けが、作者の setter の呼び出しを 1 回ずつ囲む。`beforeWrite`（何も引き受けない）が呼び出しを積み、`written` が書き込みを積んである呼び出しすべてに足し、setter 自身の着地 — `direct` が false で `element` を渡す唯一の着地 — が降ろす。入れ子が 64 段に達すると、循環を添えて `[wcs/setter-cycle]` を投げる。呼び出しが終わったとき、何かを書いていて、getter が何かを読んでいて（`sources`）、どの書き込みも getter の読み取りの閉包（その sources と、その中の getter の sources）のパスの上にも下にも無ければ、setter ごとに 1 回 `[wcs/setter-unobserved]` を警告する。drain がスタックを空にする。core は 0 B。後付けは約 600 B 増え、リリースの再記録までは 384 B の slack として与える。

## 5. 決定（2026-11-07）

著者は 3 つの推奨を採った:

1. **4.17 の範囲**: `getter-write`（lint とランタイムの文面）、スクリプトの書き込みへの `path-readonly`、`setter-cycle`、`setter-unobserved`。外したもの: 行の文脈の無いところでの `*` パスへの書き込み（束縛の場所と呼び出しグラフが要る。ランタイムはパスを名指して `no row` を投げる）、誰も読まない書き込み（info で騒がしい）、ループの中の複合代入への `$update` の提案（書き方の好みで「足さずに直す」に反する）、ルートを置き換えるスクリプトが無いときの `wcs/getter-untracked-read` の error への格上げ（既存のページの `--errors-only` を落とす。先に測る）。
2. ランタイムの `getter-write` の文面のための **core の変更**、数 B 以内（測って 15 B）。
3. 4.15・4.16 の調査と同じく、**この文書**から始め、決定を記録する。

## 6. 作ったもの

- `packages/state`: `Engine.refuseWrite`、`#2` と `#8` の文面、`features/diagnostics.ts` の setter の囲み。`__tests__/script-writes.test.ts`。
- `packages/vscode-wcs`（したがって `@wcstack/lint`・`@wcstack/typescript`・拡張）: `scriptAst.ts` のオプション `resolveWrites`・`untracked`・`opaque` と `nested` の印、`scriptWriteValidator.ts`、`__tests__/scriptWrite.test.ts`。
- [mistake-catalogue.ja.md](./mistake-catalogue.ja.md): 4 項目。双方向の束縛の項目は code 付きで知らせるものになった。
- リポジトリのページ（`examples/`、継ぎ目アプリ、各パッケージの `examples/`）は、4 つの code のどれにも報告されない。
