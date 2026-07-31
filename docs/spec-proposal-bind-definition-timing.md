# wc-bindable-protocol 改訂提案: `bind()` に「まだ定義されていない」を扱わせる

- **提案先**: `@wc-bindable/core` の `bind()` / `isWcBindable()` と、SPEC.md の Discovery API contract・
  Initial sync・Teardown Contract の各節。あわせて各 framework adapter の推奨実装。
- **提案元の文脈**: wcstack（`<wcs-*>` 全 38 タグと `@wcstack/autoloader`）。CDN 一発・buildless で
  custom element を後から定義する配布形態を前提にしている。
- **状態**: wcstack 側は回避策（利用者に `customElements.whenDefined()` を要求する手順）を
  [framework アプリへの組み込み手順](./framework-adapter-integration.md) に明文化済み。本提案は、
  その回避策を利用者に強いなくても済むよう core 側に語彙を足すもの。
- **調査時点のスナップショット**: `@wc-bindable/core@0.8.0`、および upstream `main` の
  react / vue / svelte / solid / angular / qwik / signals / rxjs adapter 実装。
- **TL;DR**: `bind()` は「wc-bindable ではない対象」と「まだ upgrade していない custom element」を
  区別できず、どちらも同じ no-op cleanup を返す。結果として**公開されている 18 個の adapter が
  すべて、遅延定義された要素に対して沈黙したままバインドしない**。`syncOn: "define"` 相当の
  待機オプションを 1 つ足すだけで、adapter を個別に直さずに解消できる。

---

## 1. 問題

`bind()` は宣言が読めなければ no-op を返す。これは「discovery == bindability」という SPEC の
契約として一貫している。しかし呼び出し側から見ると、次の 2 つが同じ結果になる。

1. 対象が wc-bindable ではない（永久にバインドできない）。
2. 対象は wc-bindable な custom element だが、**まだ upgrade していない**（いずれバインドできる）。

adapter は前者を想定して早期 return する。そして 2 が起きても同じ経路を通るため、後から
upgrade しても誰も再試行しない。

```ts
// 実装を読んだ 8 adapter すべてがこの形
if (!isWcBindable(el)) return;
unbind = bind(el, onUpdate);
```

| adapter | bind を試みる時点 | 未 upgrade 時 |
| --- | --- | --- |
| react | `useEffect([el, onUpdate])` | 早期 return。`el` は不変なので再実行されない |
| vue | `onMounted` | 早期 return。再試行なし |
| svelte | action の初回 setup | 早期 return。`update` は params 変更時のみ |
| solid | directive 実行時 | 早期 return。再試行なし |
| qwik | `useVisibleTask$` | 早期 return。`track(() => ref.value)` は upgrade で再発火しない |
| angular | `ngOnInit` | 早期 return。再試行なし |
| signals / rxjs | 明示 `bind(el)` | 早期 return。呼び直しは利用者責務 |

`syncOn: "connect"` は**接続**の遅延を扱うオプションであり、**定義**の遅延には効かない。
signals / rxjs adapter は `syncOn: "connect"` を渡している最も慎重な実装だが、その手前の
`isWcBindable()` で落ちるため救われない。

### 1.1 なぜ利用者側の回避で終わらせないのか

回避策は存在する（`customElements.whenDefined()` を待ってから mount する）。しかし:

- **失敗が沈黙する**。バインドされなかったことを示す戻り値も警告も無い。利用者は「動かない」と
  しか観測できず、原因が定義タイミングだと気づく手がかりが無い。
- **18 個の adapter が同じ回避を必要とする**。core が「まだ」を表現できない限り、adapter 側で
  個別に MutationObserver や whenDefined を持つしかなく、実装ごとに差が出る。
- **遅延定義は例外的構成ではない**。Import Maps + 動的 import による autoloading は custom
  elements の標準的な配布形態のひとつで、CDN から 1 行で読み込む使い方では常態である。

## 2. 提案

### 案 A（推奨）: `syncOn: "define"`

`BindOptions.syncOn` に `"define"` を追加する。対象が未 upgrade の custom element である場合に限り、
`customElements.whenDefined(tagName)` の解決後に discovery とリスナ登録を行う。

```ts
const unbind = bind(el, onUpdate, { syncOn: "define" });
```

- 対象が既に wc-bindable なら、現行の `"call"` と同じ同期経路を通る（挙動不変）。
- 対象がダッシュを含むタグ名を持つ未定義要素なら、`whenDefined` を待ってから登録する。
- 対象がそれ以外（wc-bindable でない普通の要素）なら、現行どおり即 no-op。
- 返る cleanup は待機中に呼ばれても安全でなければならない（待機を打ち切り、登録もしない）。
- `"define"` と `"connect"` の併用が要るケースがあるため、`syncOn` を配列または
  `{ define: true, connect: true }` 形に拡張する案も検討に値する。

**互換性**: 既定値は `"call"` のままとし、明示指定した呼び出しだけが挙動を変える。未知の
`syncOn` 値を渡した古い core は現行どおり `"call"` にフォールバックすればよい（forward-compatible）。

### 案 B: `bind()` の戻り値を拡張する

no-op を返す代わりに `{ unbind, state: "bound" | "pending" | "not-bindable" }` のような
判別可能な戻り値にする。adapter は `"pending"` を見て自前で再試行できる。

- 利点: core が待機の責務を持たず、adapter が自分の lifecycle に合った再試行を選べる。
- 欠点: 戻り値の形が破壊的に変わる。18 adapter すべての改修が必要で、案 A の「core 1 箇所」より
  移行コストが大きい。

### 案 C: 別関数 `bindWhenDefined()`

`bind()` は不変のまま、待機版を別 export として足す。

- 利点: 既存 API に一切触れない。
- 欠点: 「どちらを使うべきか」の判断を全 adapter 実装者と利用者に配ることになる。実質的に
  `bind()` が罠であり続ける。

推奨は **案 A**。理由は、既定挙動を変えず、adapter の改修が 1 行のオプション追加で済み、
「まだ」を表現する語彙が core 側に残るためである。

## 3. 提案する規範文言（案 A）

> **`syncOn: "define"`** — If `target` is an element whose tag name contains a `-` and whose
> constructor does not yet expose a valid wc-bindable declaration, `bind()` MUST defer discovery
> and listener registration until `customElements.whenDefined(tagName)` resolves, then perform the
> same registration and initial sync as `syncOn: "call"`. If the declaration is already readable,
> `bind()` MUST behave exactly as `syncOn: "call"`. The returned cleanup MUST be safe to call while
> the wait is pending: it cancels the wait and registers nothing. Implementations without
> `customElements` (headless runtimes) MUST fall back to the synchronous `"call"` path.

## 4. 適合テスト条件

- 定義済み要素に `syncOn: "define"` を渡すと、`"call"` と同一の同期タイミングで初期同期が走る。
- 未定義タグに対して `bind()` した後で `customElements.define()` すると、初期 property read と
  後続イベントの両方が届く。
- 待機中に cleanup を呼ぶと、その後 `define()` してもリスナが登録されない。
- wc-bindable ではない普通の要素（ダッシュ無し）では待機せず、現行どおり即 no-op を返す。
- `customElements` が存在しない環境で例外を投げず、同期経路にフォールバックする。
- 同一要素への複数 `bind()` が互いの待機を壊さない。

## 5. 非目標

- `bind()` に汎用のリトライ・ポーリングを持ち込むこと。待つのは `whenDefined` の解決のみとする。
- 定義されない要素を無期限に監視すること（`whenDefined` は解決しなければ待ち続けるが、
  cleanup で打ち切れる）。
- observation の意味論（初期同期の内容、イベント配送順）を変えること。
- 遅延定義に伴う**入力**側の問題（upgrade 前のプロパティ代入が accessor をシャドウする件）を
  ここで解くこと。それは producer 側の責務であり、wcstack では
  [doc 13 Phase A1](./architecture-hardening/13-framework-adapter-binding-constraints.md) として
  実装済みである。

## 参照

- [framework adapter のバインド成立制約](./architecture-hardening/13-framework-adapter-binding-constraints.md)
- [framework アプリへの組み込み手順](./framework-adapter-integration.md)
- [wc-bindable SPEC（固定コミット）](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/SPEC.md)
- [`@wc-bindable/core@0.8.0` の `bind()`](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/packages/core/src/index.ts)
