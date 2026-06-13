# command-token-protocol 改訂提案: command 起動の「引数転送」を規範化する

- **提案先**: command-token-protocol の仕様（`command.<methodName>: $command.<tokenName>` バインディングと `$command.<name>.emit()` の規範を定める層）。あわせて wc-bindable-protocol の `commands` 宣言（SPEC.md / SPEC-extensions.md）との接点を整理する。
- **提案元の文脈**: wcstack（@wcstack/state の command-token 実装＋ @wcstack/broadcast / websocket / clipboard / fetch ほか wc-bindable 準拠タグ群）。
- **状態**: wcstack 側は**実装・ドキュメント・実例まで完了済み**（未リリースの新規仕様ではない）。本文書は既存挙動を相互運用契約として SPEC に規範化する提案。
- **動機ケース**: `@wcstack/speech`（設計中、`docs/speech-tag-design.md`）の `<wcs-speak>` が `command.speak: $command.say` で**テキスト引数を渡して**発話を起動する「案2」を採用予定。ただし調査の結果、これは新機能ではなく**既存の引数転送挙動そのもの**であり、SPEC が黙っている点だけが残課題と判明した。
- **TL;DR**: `emit(...args)` に渡された引数は、購読側要素の command メソッドへ**位置引数として変更なしに転送される**（MUST）。binder は引数を加工・包装・切り詰めしてはならない。これは既に wcstack で動作し examples で使われているが、command-token-protocol の規範文言に無いため、独立実装間での相互運用が保証されていない。

---

## 1. なぜ SPEC に書く必要があるのか

command-token は「state がメソッドを起動し（emit）、要素がそれに応答する（subscribe）」型付き pub/sub 契約である。プロパティバインディングが**データの流し込み**を担うのに対し、command-token は**メソッド起動**を担う。

メソッド起動である以上、多くの実用ケースは**起動と同時に引数（ペイロード）を渡す**必要がある:

- `<wcs-speak>.speak(text)` — 読み上げるテキスト
- `<wcs-broadcast>` の送信メソッド — タブ間に流すメッセージ
- `<wcs-ws>.sendMessage(data)` — WebSocket で送る文字列
- `<wcs-clipboard>.writeText(text)` — クリップボードに書く文字列
- `<wcs-fetch>.fetch(url, options)` — 取得先とオプション

これらが成立するには「emit の引数が要素メソッドへどう届くか」が**契約として固定**されていなければならない。ところが現行の規範記述は次の2点を**いずれも明文化していない**:

1. **引数転送のセマンティクス**。emit に渡した値が、順序・個数・同一性を保って要素メソッドの引数になるのか。binder が途中で1引数に丸めたり、配列に包んだり、最初の1個だけ渡したりしないことが保証されているか。
2. **wc-bindable の `commands` 宣言は名前しか持たない**。`IWcBindableCommand` は `{ name, async? }` のみで**引数シグネチャを宣言しない**。要素作者・binder 実装者・コード生成ツールが「この command は何を受け取るか」をどう知るのかが未定義。

この無言の帰結は undefined-write 問題（`docs/spec-proposal-undefined-write-skip.md`）と同型である:

- **binder ごとに挙動が割れうる**。同じ state・同じ要素でも、配線に使う binder によって引数が届いたり届かなかったり、丸められたりする。**相互運用プロトコルとしての価値を直接損なう**。
- **依存している実装が既に存在する**。broadcast / websocket / clipboard / fetch のタグは「引数が素通しで届く」前提で既に動いており、別 binder がこの前提を破ると**サイレントに壊れる**。

つまりこれは新機能の追加ではなく、**既に普遍的に依存されている挙動の、語彙の欠落**である。だから SPEC に書く。

## 2. 既に動いている挙動（evidence）

引数転送は wcstack の実装・ドキュメント・examples の三層で**既に確立**している。

**ドキュメント**（@wcstack/state README）:
> - state は `this.$command.<tokenName>.emit(...args)` で emit する
> - **emit に渡した引数はそのまま要素のメソッドへ転送される**
> - 1つの token は複数の要素へファンアウトでき、subscribe 順は保持される

**実例**（examples、いずれも引数付き emit が本番デモで稼働）:

| 例 | コード | 渡している引数 |
|---|---|---|
| state-cross-tab-todo | `this.$command.announce.emit({ who, kind, text })` | オブジェクトのペイロード |
| state-websocket | `this.$command.wsSend.emit(JSON.stringify({ ... }))` | 文字列のペイロード |
| state-fetch | `state.$command.refreshList.emit()` | 引数なし（0個） |
| README 例 | `this.$command.fetchUsers.emit("/api/users", { method: "GET" })` | 2引数（位置） |

**参照実装**:
- `token/Token.ts` の `emit(...args)` は、購読関数を subscribe 順に `fn(...args)` で呼び出し、戻り値を同順の配列で返す。
- `apply/applyChangeToCommand.ts` の subscriber は `Reflect.apply(method, el, args)` で、**受け取った args をそのまま要素メソッドへ適用**する。引数の加工・切り詰め・包装は一切行っていない。

挙動は存在し、依存もされている。欠けているのは「他実装もこう振る舞わねばならない」という規範だけである。

## 3. 規範化すべきセマンティクス

以下を command-token-protocol の規範として固定する。

1. **位置引数の素通し転送（中核）**。`emit(a, b, c)` は、購読する各要素の command メソッドを `method(a, b, c)` として呼ぶ。順序・個数・各値の同一性（structured clone もコピーもせず参照そのもの）を保つ。binder は引数を変換・包装・切り詰めしてはならない（MUST NOT）。
2. **個数の不一致は JavaScript の通常意味**。emit の引数がメソッドの仮引数より多ければ余剰は無視され、少なければ不足分は `undefined`。binder はパディングも切り詰めもせず、ただ全引数を渡す。
3. **ファンアウトは同一引数**。1 token に複数要素が購読する場合、**全要素へ同じ引数群**が渡る。subscribe 順に呼ばれる。
4. **戻り値**。emit は各購読呼び出しの戻り値を subscribe 順の配列で返す（MAY 利用）。command メソッドの戻り値（同期値 or Promise）は破棄されず、この配列を通じて呼び出し側が参照できる。
5. **非同期 command は await されない**。`commands[].async` は記述的ヒントであり、emit は Promise を待たない。async メソッドの Promise は戻り値配列にそのまま入る。エラーハンドリング（reject の扱い）は呼び出し側の責務。
6. **`undefined` 引数の扱いは §undefined-write とは別レイヤ**。undefined-write 規則は `properties`/`inputs` への**書き込み**を対象とする。command の**引数**は通常の値であり、`emit(undefined)` は `method(undefined)` として素通しする（引数スキップではない）。両規則は対象が異なるため衝突しない。

## 4. 提案する規範文言（SPEC 追記案）

command バインディングを規定する節への追記。英語正文＋日本語参考訳:

```markdown
### Command invocation arguments

When a command token is emitted with arguments — `emit(arg0, arg1, ...)` —
a conforming binder MUST invoke each subscribed element's command method
with those same arguments, by position and in order, unchanged. The binder
MUST NOT coerce, wrap, clone, reorder, pad, or truncate the argument list:
`emit(a, b)` results in `method(a, b)`, passing the same value references.

Argument-count mismatch follows ordinary host-language semantics: surplus
emit arguments beyond the method's parameters are ignored, and missing
arguments are `undefined`. The binder neither pads nor truncates.

When multiple elements subscribe to one token, every subscriber receives
the identical argument list, invoked in subscription order.

The emit operation MUST return each subscriber's return value, in
subscription order. A command method's return value (including a Promise
from an async command) is not discarded. Binders MUST NOT await async
commands on the emitter's behalf; the `commands[].async` hint is
descriptive only, and an awaited Promise, if any, surfaces through the
returned array.

This rule is independent of the undefined-write rule, which governs writes
to `properties` / `inputs`. A command argument is an ordinary value:
`emit(undefined)` invokes `method(undefined)`; arguments are never skipped.
```

> **参考訳**: command token が引数付きで emit された場合（`emit(arg0, arg1, ...)`）、準拠 binder は購読する各要素の command メソッドを、それらの引数で**位置・順序を保ったまま変更なしに**呼び出さなければならない（MUST）。binder は引数列を強制変換・包装・複製・並べ替え・パディング・切り詰めしてはならない（MUST NOT）。`emit(a, b)` は `method(a, b)` となり、同一の値参照が渡る。
> 引数個数の不一致はホスト言語の通常意味に従う: メソッド仮引数を超える余剰引数は無視され、不足分は `undefined`。binder はパディングも切り詰めもしない。
> 複数要素が1 token を購読する場合、全購読者へ同一の引数列が、subscribe 順に渡る。
> emit 操作は各購読者の戻り値を subscribe 順の配列で返さなければならない（MUST）。command メソッドの戻り値（async command の Promise を含む）は破棄されない。binder は emit 側で async command を await してはならない（MUST NOT）。`commands[].async` ヒントは記述的でしかなく、await すべき Promise があれば戻り値配列を通じて表面化する。
> 本規則は undefined-write 規則（`properties`/`inputs` への書き込みを規定）とは独立である。command の引数は通常の値であり、`emit(undefined)` は `method(undefined)` を呼ぶ —— 引数がスキップされることはない。

## 5. wc-bindable `commands` 宣言との接点

現行 `IWcBindableCommand` は `{ name: string; async?: boolean }` のみで、**引数シグネチャを宣言しない**。本提案は **command を引数シグネチャレスのまま据え置く**ことを推す:

- 転送契約が「位置引数の素通し」である以上、binder は引数の型・個数を知る必要がない。動的 JavaScript のメソッド呼び出しと同じく、契約は純粋な pass-through で閉じる。
- これは現行実装（`Reflect.apply(method, el, args)` は宣言を参照しない）と一致し、追加のプロトコル表面を生まない。

ただしツール／コード生成／リモートプロキシ向けの**記述的メタデータ**として、`inputs[].attribute` や `commands[].async` と同格の**非規範ヒント** `commands[].args?`（引数名や型の記述）を**任意で**許す余地は残す。core はこれを解釈しない（SPEC-extensions の既存ヒントと同じ扱い）。

## 6. 検討した代替案と不採用理由

| 案 | 不採用理由 |
|---|---|
| 引数は常に1個（ペイロードオブジェクト）に固定 | `emit("/api/users", { method })` のような複数位置引数の既存実例・README を破壊する。JavaScript メソッドの自然な多引数性を捨てる理由がない |
| binder が引数を structured clone してから渡す | 要素へ参照を渡す現行挙動・実装と非整合。クローンは broadcast/worker のように**要素側が**境界で行う関心事であり、binder の責務にすると二重クローン・不要コピーを強制する |
| `commands[].args` を**規範**にし、binder が宣言通りに整形 | プロトコル表面が増え、素通しと等価以下。要素メソッドのシグネチャは要素自身が一番よく知っており、JS の呼び出し意味論で十分 |
| 引数転送を spread 同様 command にも広げる議論 | 別レイヤの話。command は名前指定の単一メソッド起動であり、pub/sub 境界を明示する設計（commands は spread 対象外）と無関係 |

## 7. 参照実装と検証結果（wcstack 側、実装済み）

- **emit プリミティブ**: `@wcstack/state` `token/Token.ts` — `emit(...args)` が subscribe 順に `fn(...args)` を呼び、戻り値を同順配列で返す。command/event token が共有。
- **binder**: `apply/applyChangeToCommand.ts` — subscriber が `Reflect.apply(method, el, args)` で受領引数を素通し適用。要素 GC / disconnect 時は lazy purge。
- **実利用タグ**: broadcast（`announce` 相当の送信）/ websocket（`sendMessage`）/ clipboard（`writeText`）/ fetch（`fetch(url, options)`）が引数付き起動で稼働。
- **examples（E2E 実証）**: state-cross-tab-todo（オブジェクト引数）/ state-websocket（文字列引数）/ state-fetch（0 引数）/ README 例（2 位置引数）が実ブラウザで動作。

## 8. バージョニングと成立後の変化

- **バージョニング**: 本追記は「これまで引数を素通ししていた実装」を成文化する **clarification**。従来挙動は SPEC が黙っていただけで、引数を**加工して**意味のある動作をしていた準拠実装は事実上存在しない（pass-through 以外は全て上記実例を壊す）。よって version 据え置きの clarification 扱いを推す。
- **state/データソース著者**: 「emit の引数はそのまま届く」が**保証**になり、binder 差で壊れない前提でコードを書ける。
- **要素著者**: command メソッドを素直な多引数シグネチャで書いてよい。binder が引数を歪めないことが契約で担保される。
- **binder 実装者**: 「位置引数を素通しし、戻り値を返し、await しない」という小さな規則を負う。これにより複数 binder 間の command 起動互換が保証される。

---

## 関連文書

- `docs/spec-proposal-undefined-write-skip.md` — 同型の「黙っている挙動を規範化する」提案（書き込み側）。本提案は起動引数側の対。
- `docs/speech-tag-design.md` — 本提案の動機ケース（`<wcs-speak>` の引数付き発話起動「案2」）。
- `docs/timing-and-firing-contract.md` — 発火タイミング契約（参照）。
