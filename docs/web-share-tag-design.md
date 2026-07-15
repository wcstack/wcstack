# 設計メモ: `@wcstack/share`（`<wcs-share>`）

> **⚠ 更新（architecture-hardening 昇格）**: 本書 §2 / §8 / §11–§13 が記述する
> 単一 `_gen` 世代ガードと `_api()` ヘルパーは、共有 io-core（`OperationLane` +
> `platformCapability`）への昇格に伴い置換された。現行 `ShareCore` は:
> - **並行制御** = `OperationLane("share", "exhaust")`。進行中の2回目の `share()` は
>   ticket 化されず即 no-op（`navigator.share` を呼ばない）。旧設計は「プラットフォームが
>   2回目を `InvalidStateError` で弾く」前提だったが、それは進行中の1回目の
>   `error`/`loading` を破壊するバグを生んでいた（exhaust がこれを解消）。`dispose()` は
>   lane の owner generation を進めて in-flight を無効化する（旧 `_gen++` 相当）。
> - **capability/error taxonomy** = 利用直前 probe（`web.share`）で unsupported を
>   `capability-missing` として検出し、追加的な bindable プロパティ `errorInfo`
>   （`WcsIoErrorInfo`）を公開する。既存 `error`/`cancelled` の shape は不変。
>
> 以下の本文は実装前の論点整理のスナップショットとして歴史的経緯のため保持する。

- **状態**: 実装済み（`@wcstack/share` として公開済み）。本文書は実装前に行った論点整理と決定事項のスナップショットであり、実装後も設計意図の参照用に保持している。以降の `hidden@error` / `text@error.message` 等の `@` 表記は説明用の擬似記法であり、実際の `data-wcs` 構文ではない点に注意（実装では `command.share: $command.doShare` のような明示的なプロパティ名構文を使う。README.md/README.ja.md 参照）。
- **対象 WebAPI**: Web Share API（`navigator.share(data)`、`navigator.canShare(data)`）
- **位置づけ**: [io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) バッチ3（薄い一発commandパターン）の1本目。EyeDropper / Contact Picker / Credential Management に先立ち、**このバッチの共有アーキタイプを初めて実装で確立するノード**。既存25パッケージに前例の無い新規アーキタイプであり、本書の決定がバッチ内の後続ノードにそのまま流用される。
- **前提資産**: `fetch`（単一`_gen`・try/catch・never-throwの`_doFetch`骨格、[FetchCore.ts](../packages/fetch/src/core/FetchCore.ts)）、`spec-proposal-command-token-arguments.md`（command-token引数の位置引数素通し規範）、[async-io-node-guidelines.md](./async-io-node-guidelines.md)（Core/Shell分離・wc-bindable・never-throw・同値ガード・`_gen`世代ガード・SSR）。

---

## 0. 大前提: 「状態を持たないcommand専用ノード」という新しい形

既存の双方向ノード（fetch/geolocation/notification等）は「複合的な設定を伴う継続的な状態」を持つが、Web Share は違う。`navigator.share(data)`は**呼ぶ→ダイアログ→resolve/reject**の一撃で完結し、監視すべき継続的な状態が存在しない。

| | 他の双方向IOノード（例: fetch） | `<wcs-share>` |
|---|---|---|
| 状態の性質 | `url`/`method`等の設定＋`value`/`loading`/`error`の継続的観測 | `value`/`loading`/`error`/`cancelled`のみ。設定入力（inputs）は実質無い |
| command | 繰り返し呼べる（`fetch()`は何度でも） | 同じく繰り返し呼べるが、**1呼び出し=1ダイアログ**で並行が起こらない |
| observable surface | 複数フィールド＋派生getter | `value`（成功結果）＋`loading`（進行中）＋`error`（真の失敗）＋`cancelled`（ユーザー起因の中断）の4つで閉じる |

`FetchCore`から**AbortController・`abort()`コマンドを削った簡約版**が土台になる（§2）。これは「状態が薄いcommand専用ノード」というバッチ3全体の雛形を確立する意味を持ち、[io-node-candidate-implementation-notes.md](./io-node-candidate-implementation-notes.md) グループC・12「Web Share」が挙げる「`properties`が実質空に近い、command専用でmonitorの逆パターン」という論点への回答がこのノードの存在意義そのものである。

---

## 1. 存在意義 — 何を解決するノードか

- **共有UIの宣言化**: 「共有」ボタンのクリックで`navigator.share()`を呼び、成功/失敗/キャンセルを`data-wcs`属性だけで出し分ける（`hidden@loading`でボタンを無効化、`text@error.message`でエラー表示等）。命令的な`addEventListener`＋`try/catch`を書かずに済む。
- **他ノードとの合成**: `value`（共有した`title`/`url`等の再現ではなく、成功したという事実そのもの）を受けて、`<wcs-timer>`と組んでトースト通知を数秒で消す、といった宣言的な後続処理が自然に書ける。
- **キャンセルと失敗の区別**（§3）が、UI上で「ユーザーが単に閉じただけ」を赤いエラー表示にしないための必須機能になる。

---

## 2. アーキタイプの由来 — FetchCoreの`_doFetch`を簡約する

`FetchCore._doFetch`（[FetchCore.ts:180-316](../packages/fetch/src/core/FetchCore.ts#L180-L316)）が持つ要素を仕分ける。

**残すもの**:
- **単一`_gen`世代ガード**（[FetchCore.ts:54, 195, 232, 290](../packages/fetch/src/core/FetchCore.ts#L54)）: FetchCoreでは非同期開始時に世代番号を捕捉かつ更新し（`const gen = ++this._gen`）、resolve/catch時に`gen !== this._gen`なら状態を書かず即returnする。dispose後や高速reconnect後の書き込みを防ぐ、ガイドライン§3.4のMUST。ただし本ノードでは後述のとおり呼び出しごとの追い越し（supersession）が発生しないため、`_gen`の更新（`++`）は`dispose()`時のみ行い、`share()`側は`const gen = this._gen`と捕捉するだけに留める。
- **`_setLoading`/`_setError`的な同値ガード付きsetter**（[FetchCore.ts:109-123](../packages/fetch/src/core/FetchCore.ts#L109-L123)相当）: `_setValue`/`_setLoading`/`_setError`/`_setCancelled`をそれぞれ`CustomEvent`で`bubbles: true`発火する私有setterとして持つ。
- **never-throwのtry/catchラップ**（[FetchCore.ts:213-315](../packages/fetch/src/core/FetchCore.ts#L213-L315)の`try { ... } catch (e) { ... }`構造）: `share()`は例外を投げず、失敗時は`_setError`（または`_setCancelled`、§3）を呼んで`null`を返す。
- **finally不要点は簡略化**: fetchの`finally`（[FetchCore.ts:311-315](../packages/fetch/src/core/FetchCore.ts#L311-L315)）は`AbortController`の後始末のためのものなので、後述のとおりWeb Shareには対応物がない。

**削るもの**:
- **`AbortController`（`_abortController`フィールド、[FetchCore.ts:48, 159-164, 189-191, 312-314](../packages/fetch/src/core/FetchCore.ts#L48)）**: Web Share APIの`navigator.share()`はAbortSignalを受け取るオプションを持たない。呼び出し元が進行中の共有ダイアログを中断させる手段はプラットフォームに存在しない（ユーザーがダイアログを閉じる/Escで閉じる以外に中断経路が無い）。
- **`abort()`コマンド（[FetchCore.ts:159-164](../packages/fetch/src/core/FetchCore.ts#L159-L164)、`commands`宣言[FetchCore.ts:38](../packages/fetch/src/core/FetchCore.ts#L38)）**: 中断手段が無い以上、コマンドとして公開しても呼び出し元に約束できる効果が無い。宣言しない。

**残る骨格**は「`_gen`を捕まえる→`_setLoading(true)`→`try { await navigator.share(data); _setValue(...); } catch (e) { AbortErrorならcancelled、それ以外はerror } finally { gen一致なら_setLoading(false) }」という単純な形に閉じる。1インスタンスにつき1操作という前提は、共有ダイアログがシステム全体で同時に1つしか開けない（[EyeDropperの`InvalidStateError`同様の多重起動制約とも符合する、MDN仕様確認済み]）ため自然に成立し、fetchのような「新規呼び出しが旧呼び出しを追い越してabortする」仕組み自体が不要になる。

---

## 3. `cancelled`を`error`から分離する — **決定: 独立したbooleanとevent**

Web Share APIはユーザーが共有シートを閉じる/Escでキャンセルすると`navigator.share()`の返すPromiseが`AbortError`でrejectする。これを`error`に含めるか、独立させるかが本ノード最大の設計判断。

- **却下: `AbortError`を`error`に含める** ~~（cancelled状態を持たず、全ての失敗を`error`に一本化する）~~ — 実装は最も単純だが、`hidden@error`のように「エラー時にUIを隠す/警告色にする」という束縛をしたとき、**日常的なユーザーキャンセル（単に共有シートを閉じただけ）が、`NotAllowedError`（gesture外呼び出し）のような本物のプラットフォーム障害と区別がつかなくなる**。ユーザーが「やっぱりやめよう」と閉じるたびに赤いエラー表示が出るのはUXとして明確に誤り。
- **決定: `cancelled`を独立したboolean/eventに分離する** ✅ — `catch (e)`内で`e.name === "AbortError"`を判定し、`_setCancelled(true)`（`wcs-share:cancelled-changed`）を発火して`error`には触れない。それ以外の例外（`NotAllowedError`/`TypeError`/`DataError`等）だけが`_setError`（`wcs-share:error`）に流れる。`hidden@error`はキャンセル時に反応せず、真の障害だけを拾える。

`cancelled`は状態性のプロパティ（同値ガード対象）として扱う。次の`share()`呼び出し開始時に`_setCancelled(false)`へリセットしてから実行する（前回キャンセルの痕跡が次回成功時にも残り続けるのを防ぐ）。

---

## 4. wcBindable 仕様（バッチ計画で確定済み）

```typescript
static wcBindable: IWcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "value",     event: "wcs-share:complete",         getter: e => e.detail.value },
    { name: "loading",   event: "wcs-share:loading-changed" },
    { name: "error",     event: "wcs-share:error" },
    { name: "cancelled", event: "wcs-share:cancelled-changed" },
  ],
  commands: [
    { name: "share", async: true },
  ],
};
```

- `value`: 共有が成功したという事実を表すペイロード（`navigator.share()`自体は戻り値を持たない`Promise<void>`なので、`value`は「呼び出し元が渡した`data`をエコーバックしたオブジェクト」など、成功時に確定するアプリ側の合図として設計する。素の`undefined`を`value`にするとイベント発火の意味が薄くなるため、Shell層で「渡した`data`」を成功シグナルとして詰め直す）
- `commands: [{ name: "share", async: true }]`: **単一command**。バッチ3の他3ノードと同様、このノードは`commands`が1個で閉じる。

---

## 5. `share()`の引数 — 単一オブジェクト引数として位置引数1個を渡す

`share`コマンドは`{title, text, url, files}`というオプションオブジェクト**1個**を位置引数として受け取る。

```
command.share: $command.doShare
```
```typescript
// state 側
this.$command.doShare.emit({ title: "記事タイトル", url: location.href });
```

[spec-proposal-command-token-arguments.md](./spec-proposal-command-token-arguments.md) が規範化する「`emit(...args)`は購読側の command メソッドへ**位置引数として変更なしに転送される**」（同文書§3-1、[spec-proposal-command-token-arguments.md:63](./spec-proposal-command-token-arguments.md#L63)）は、この呼び出しにもそのまま適用される。`emit({ title, url })`は`share({ title, url })`として届き、binderが引数を分解・包装し直すことはない。

これは**このバッチ最初の「単一のオプションオブジェクトを1個の引数として渡すcommand」**である点に注意する。既存の`fetch`コマンドは`fetch(url, options)`という**2つの位置引数**（1個目がプリミティブなURL文字列、2個目が複数フィールドのoptionsオブジェクト）を渡すのに対し、`share(data)`は**引数そのものが1個の複数フィールドオブジェクト**であり、位置引数の個数が違う。ただし規範上の扱いは同じで、位置引数素通しの契約が「1個であること」を特別扱いしているわけではない。Contact Picker（[contact-picker-tag-design.md](./contact-picker-tag-design.md)）はこのバッチで初めて複数位置引数（2個）を取るcommandになる。

---

## 6. `canShare(data)`の扱い — **決定: 同期プレーンメソッドとして公開**

`navigator.canShare(data)`は`share()`呼び出し前に「このデータを共有できるか」を判定する**同期**メソッド（Promiseを返さない、副作用も無い）。wcBindableの`properties`/`commands`に含めるかどうかが論点。

- **却下: `properties`に加える（例: `{name:"shareable", event:...}`）** ~~— `canShare`は`data`引数を要求する述語関数であり、「引数無しで観測できる継続的な状態」というobservable propertyの型に合わない。呼ぶたびに引数（共有したいdata）が変わるものを`event`駆動の状態として宣言するのは無理がある~~
- **却下: `commands`に`{name:"canShare"}`として加える** ~~— commandは「起動して結果はeventで受け取る」非同期の発火が前提の設計（`async?: boolean`ヒントもそのため）であり、同期・戻り値を直接使いたい`canShare`をcommand-token経由に乗せると、呼び出し元は`$command.canShare.emit(data)`の戻り値配列から同期的に値を取り出す不自然な形になる~~
- **決定: Shellの同期プレーンメソッドとして公開する** ✅ — `wcsShareElement.canShare(data)`という素のインスタンスメソッドとして直接呼べるようにする。プラットフォームメソッド自体が同期・副作用無しのため、**never-throwラップは不要**と明記する（例外を投げるとすればブラウザ実装のバグに等しく、素の呼び出しでよい）。wc-bindable protocolの管掌外（`static wcBindable`に載らない）であることをREADMEで明記する。

---

## 7. `abort`コマンドは持たない

§2で述べたとおり、`navigator.share()`にAbortSignalを渡す手段は無い。呼び出し元が進行中の`share()`呼び出しを中断させるプラットフォーム機構が存在しないため、`abort`コマンドを宣言しない。ユーザーが共有シートを自分で閉じた場合の結果は§3の`cancelled`で表現される。

---

## 8. unsupported判定 — **決定: `share()`呼び出し時に即`error`（`supported`フラグは持たない）**

[network-tag-design.md](./network-tag-design.md)は「対応/非対応の二値問題で継続的な遷移が無いAPI」に対して明示的な`supported: boolean`派生プロパティを採用した（[network-tag-design.md:98-100](./network-tag-design.md#L98-L100)）。Web Shareでも同じ判断軸で検討し、**今回は`supported`フラグを持たない**方を選ぶ。

- **却下: `supported: boolean`プロパティを追加する** ~~（networkの先例に倣う）~~ — networkは「監視専用ノードで、commandが無いため`supported`が唯一のフォールバック手がかり」だった。Web Shareは逆に**commandが主役のノード**であり、`share()`を呼んだ瞬間に`typeof navigator.share !== "function"`を判定して`error`に落とせば、利用者が実際に得たい情報（「このボタンを押したら共有できるか」）を１アクションで得られる。事前に`supported`を問い合わせる中間ステップを増やす効用が薄い。
- **決定: `share()`内部でAPI解決に失敗したら即`_setError`** ✅ — ガイドライン§3.7のAPI呼び出し時解決（キャッシュ禁止）に従い、`_api()`ヘルパーで`typeof globalThis.navigator?.share === "function"`を毎回チェックする。無ければ`_setError({ message: "Web Share API is not supported in this browser." })`を発火して即`null`を返す（`navigator.share`自体を呼ばない、`_gen`も進めない＝非同期処理を開始しないため世代を消費する意味が無い）。
- 利用者が事前にボタンを隠したい場合は`§6`の`canShare`または生の`typeof navigator.share`チェックをJS側で行う経路が残っており、宣言的に「対応可否で出し分けたい」需要は薄いと判断する。

---

## 9. autoTriggerは不要

`share()`自体が実際のuser gesture文脈内から起動される必要がある。これは呼び出し元（クリックハンドラ等）の責務であり、ノード側が「クリックされたら自動的に`share()`を呼ぶ」オートトリガーを持っても、そのトリガー自体がgesture文脈を継承していなければ`NotAllowedError`になる。これは[io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md)バッチ1のFullscreen（[io-node-batch-implementation-plan.md:61](./io-node-batch-implementation-plan.md#L61)「`requestFullscreen()`はuser gesture必須」）と全く同じ制約であり、Fullscreenがautoトリガーを持たない（`data-<name>target`によるクリック起動ショートカットを持たない）のと同じ理由で、本ノードもautoTriggerを持たない。

呼び出し元は`command.share: $command.doShare`を実際のクリックイベントハンドラ相当（`event.share: $event.userClicked`のようなevent-tokenでのユーザークリックを受けての即時emit）に直結させる設計をREADMEで例示する。

---

## 10. Shell属性・inputs

- **inputsは実質無い**。`share(data)`の`data`はcommand引数として毎回渡されるものであり、Shell属性として宣言的に固定する設計にはなじまない（`title`/`url`は呼び出しごとに変わる値であり、`fetch`の`url`属性のような「設定を貼っておいて後から呼ぶ」パターンとは性質が違う）。
- `<wcs-share>`自体は`display: none`（他のIOノードと同じくレイアウトに影響しない）。

---

## 11. テスト方針（happy-dom）

happy-domは`navigator.share`/`navigator.canShare`を持たないため`__tests__/mocks.ts`で全モック。`FakeNavigatorShare`的なスタブ関数を`navigator.share`に`Object.defineProperty`でinstall/removeする。

- `share()`成功時に`value`（成功シグナル）と`loading`（true→false）が正しく遷移すること
- `AbortError`で`cancelled`が`true`になり、`error`は変化しないこと（§3の分離が機能していることの直接テスト）
- `AbortError`以外（`NotAllowedError`等）で`error`が設定され、`cancelled`は`false`のままであること
- 次回`share()`呼び出し開始時に前回の`cancelled`/`error`がリセットされること
- `navigator.share`不在時に即`error`（`"unsupported"`相当のメッセージ）になり、`loading`が`true`にすらならないこと（§8）
- `_gen`世代ガード: dispose後に解決した`share()`のPromiseが状態を書き換えないこと
- never-throw: `share()`が例外を投げず常にresolveすること（reject経路も含め全パスで）
- `canShare(data)`が同期的に呼べ、例外を投げないこと（プラットフォームメソッドの単純委譲）
- `observe()`の冪等性、SSR（`connectedCallbackPromise`が即settleすること。非同期probeを持たないため`ready`は`fetch`同様`Promise.resolve()`固定）

---

## 12. 決定事項まとめ

| 論点 | 決定 |
|---|---|
| §2 アーキタイプ | `FetchCore._doFetch`から`AbortController`/`abort()`を削った簡約版。単一`_gen`・never-throw try/catch・同値ガード付きsetterは維持 |
| §3 cancelled/error分離 | **独立させる**。`AbortError`は`cancelled`（boolean/event）、それ以外の失敗のみ`error` |
| §4-5 wcBindable | `value`/`loading`/`error`/`cancelled`の4 properties、`share`単一async command。引数は`{title,text,url,files}`オブジェクト1個（位置引数1個） |
| §6 `canShare` | wcBindable外の**同期プレーンメソッド**として公開。never-throw不要（同期・副作用無しのため） |
| §7 abortコマンド | **持たない**（プラットフォームに中断手段が無い） |
| §8 unsupported判定 | `supported`フラグは持たず、`share()`呼び出し時に`typeof navigator.share !== "function"`を判定して即`error` |
| §9 autoTrigger | **不要**（Fullscreenと同じuser gesture制約。呼び出し元の責務） |
| パッケージ/タグ | `@wcstack/share` / `<wcs-share>` / Shell `WcsShare` |

---

## 13. 実装順の推奨

1. `ShareCore`（`_gen`＋`_setLoading`/`_setValue`/`_setError`/`_setCancelled`＋`share()`のtry/catch。`AbortController`を持たない分`FetchCore`より実装量は少ない）。
2. Shell `<wcs-share>`（属性なし、`display:none`、`canShare`同期メソッドの委譲、connect/disconnectライフサイクル）。
3. Fake double（`navigator.share`/`navigator.canShare`のスタブ関数）とテスト一式（§11）。
4. example: 「記事の共有ボタン」を目玉に。`hidden@error`（真の失敗のみ表示）と`cancelled`時は何も表示しない、という§3の分離を実演する。
5. README ja/en（user gesture必須・abortコマンド無し・`canShare`は同期プレーンメソッドである旨を明記）。
6. 本書の決定（§2の簡約パターン、§3の`cancelled`分離、§8の`supported`フラグ不採用）を[eyedropper-tag-design.md](./eyedropper-tag-design.md) / [contact-picker-tag-design.md](./contact-picker-tag-design.md)の起草時にそのまま踏襲する。
