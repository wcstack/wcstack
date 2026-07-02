# 設計メモ: `@wcstack/fullscreen`（`<wcs-fullscreen target="...">`）

- **状態**: 設計検討中（未実装）。本文書は実装前の論点整理と決定事項のスナップショット。
- **対象 WebAPI**: Fullscreen API（`Element.requestFullscreen()` / `document.exitFullscreen()` / `document.fullscreenElement` / `document` への `fullscreenchange` イベント）
- **位置づけ**: [io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) バッチ1（target解決パターン）の参照実装（1本目）。Picture-in-Picture・Pointer Lockはこのノードの基本パターンをそのまま流用する差分ドキュメントとして書く（[picture-in-picture-tag-design.md](./picture-in-picture-tag-design.md) / [pointer-lock-tag-design.md](./pointer-lock-tag-design.md)）。
- **前提資産**: `intersection`（`target`属性→要素解決の3モード、`_safeQuery`によるnever-throwクエリ、Core/Shell分離）、`fetch`/`upload`（Core単位1個の`_gen`世代ガード、never-throwなasync command）、`permission`（`error`プロパティへの失敗集約、4値stateとの対比材料）。

---

## 0. 大前提: 「自分自身」でなく「参照先の要素」を操作するノード

`intersection`/`resize`と同じ**例外路線**（[io-node-candidate-implementation-notes.md](./io-node-candidate-implementation-notes.md) グループB）に属する。他の大半のIOノード（geo/clipboard/wakelock等）は「Shell要素自身が状態の主体」だが、Fullscreen APIは`element.requestFullscreen()`という**要素に対するメソッド**であり、Shell自身をfullscreen化したいことは稀（典型ユースケースは画像ギャラリー・動画プレイヤー・特定のカードUIを画面いっぱいに広げること）。したがって`<wcs-fullscreen>`は非表示の制御タグとして存在し、`target`属性で指し示した別の要素に対して`requestFullscreen()`/`exitFullscreen()`を実行する。

この「操作対象は自分ではなく参照先」という構造は、`intersection`の`_resolveTarget()`（[Intersect.ts:243-267](../packages/intersection/src/components/Intersect.ts#L243-L267)）が確立した3モード解決規則とそのまま同型であり、本ノードはそれをコピーするだけで済む。詳細な転用理由は§1で述べる。

---

## 1. `target`解決 — **決定: `intersection`の3モードをそのまま転用**

### 1.1 参照実装の引用

```typescript
private _resolveTarget(): { element: Element | null; display: string } {
  const target = this.target;
  if (target === "self") return { element: this, display: "block" };
  if (target !== "") {
    const scope = this.getRootNode() as Document | ShadowRoot;
    return { element: this._safeQuery(scope, target), display: "none" };
  }
  const child = this.firstElementChild;
  if (child) return { element: child, display: "contents" };
  return { element: this, display: "block" };
}
```
（[Intersect.ts:243-267](../packages/intersection/src/components/Intersect.ts#L243-L267)。`_safeQuery`のnever-throwラップは[Intersect.ts:281-287](../packages/intersection/src/components/Intersect.ts#L281-L287)）

`_safeQuery`は`scope.querySelector(selector)`を`try/catch`で包み、不正セレクタ（`#`・`:::`等の構文エラー）を例外でなく`null`（＝未解決）に落とす（[Intersect.ts:281-287](../packages/intersection/src/components/Intersect.ts#L281-L287)）。これも一字一句コピーする。

### 1.2 なぜFullscreenにそのまま転用できるか

`_resolveTarget()`が解決するのは「このノードがどの`Element`に対して操作/観測を行うか」という抽象で、Fullscreen固有の意味は一切含まれていない。IntersectionObserverは`observer.observe(element)`という形で対象要素を受け取るのに対し、Fullscreen APIは`element.requestFullscreen()`という形で対象要素それ自身がメソッドの主体になる——**呼び出し方向が違うだけで、「どの要素が対象か」を決める工程は同一**である。具体的には:

- **`target="self"`**: Shell自身をfullscreen化したい稀なケース（例: `<wcs-fullscreen target="self">`をラッパーごと拡大する）。`intersection`と同じく明示指定なので`display:block`でレイアウトボックスを持たせる。
- **`target="#selector"`**: 最も典型的なケース（例: `<img id="hero">`や`<video>`を指してfullscreen化）。intersectionのscrollspy用途と同じ「参照ポインタなので自分は不可視」の扱いで`display:none`。
- **省略時（先頭の子要素）**: `<wcs-fullscreen><img src="..."></wcs-fullscreen>`のようにラップして使う。intersectionの遅延読み込みラッパーと同じ`display:contents`（自分がボックスを持たずレイアウトを乱さない）。

つまり両ノードとも「対象は自分自身なのか、セレクタで指す別要素なのか、それとも子要素に委ねるのか」という**3択の解決規則**が先に必要で、後段の「その要素に対して何をするか」（IntersectionObserverに登録する／`requestFullscreen()`を呼ぶ）が違うだけである。`_safeQuery`のnever-throw保証も、fullscreenが「不正なセレクタでエラーを投げてconnectedCallback/attributeChangedCallbackを壊す」ことを防ぐという同じ目的を果たす。よってこのアーキタイプはコピーしてそのまま使い、Fullscreen固有の差分は「解決した要素に対して何をするか」の層（§2以降）にのみ現れる。

Picture-in-Pictureも同様に「参照先の`<video>`要素」を操作するため同じ転用が効くが、対象タグの検証が1つ増える（[picture-in-picture-tag-design.md](./picture-in-picture-tag-design.md) 参照）。Pointer Lockも同型（[pointer-lock-tag-design.md](./pointer-lock-tag-design.md) 参照）。

---

## 2. `active`状態の判定方法 — **決定: `document.fullscreenElement === target`の都度比較**

```typescript
static wcBindable: IWcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "active", event: "wcs-fullscreen:change", getter: (e: Event) => (e as CustomEvent).detail.active },
  ],
  inputs: [{ name: "target", attribute: "target" }],
  commands: [
    { name: "requestFullscreen", async: true },
    { name: "exitFullscreen", async: true },
  ],
};
```

- `document.fullscreenElement`はdocument全体でただ1つの値しか持てない（同時にfullscreen化できる要素は高々1つ）。Coreは`fullscreenchange`受信時に「`document.fullscreenElement === this._resolvedTarget`」を比較し、一致すれば`active: true`、不一致（他要素がfullscreen化された、またはfullscreen解除された）なら`active: false`を`_setActive()`（同値ガード付き）で反映する。

### 2.1 重要な注意点: 複数インスタンス下での自己判定

`fullscreenElement`はdocument全体で単一の値しか持たないため、**複数の`<wcs-fullscreen>`インスタンスが同時にページ上に存在する場合、各インスタンスは「documentが今fullscreenかどうか」ではなく「自分が解決したtargetがfullscreenElementと一致するかどうか」を見なければならない**。

具体例: `<wcs-fullscreen target="#a">`と`<wcs-fullscreen target="#b">`が同時に存在し、`#a`がfullscreen化された場合、前者は`active: true`、後者は`active: false`を報告すべきである。もし実装が「documentがfullscreenかどうか」だけを見て両方に同じ値を流すと、`#b`側の利用者は自分のtargetがfullscreenでないにもかかわらず`active: true`のUIを見せられてしまう。Core側の`fullscreenchange`リスナー内での比較式は必ず**自身が保持する解決済みtarget要素**を使う（毎回`_resolveTarget()`を呼び直すのではなく、直近の`requestFullscreen`/`observe`で解決した要素を保持しておき、それと比較する）。

---

## 3. `requestFullscreen()`のuser gesture制約 — **決定: never-throwでcatchし、責務は呼び出し元にあると明記**

`requestFullscreen()`はuser gesture（クリック等のユーザー操作起点のコールスタック）内で呼ばれないと`NotAllowedError`でreject する仕様。本ノードはこれを:

- **never-throw**で扱う。`try/catch`（`await`の`reject`を捕捉）し、`error`プロパティに格納する。呼び出し元（Promiseチェーン）は例外で落ちない。
- **README/設計上の明記**: ノード自身はgestureを生成できない。command-token経由でこの`requestFullscreen`commandを呼ぶ場合、その起動元（例: `<button command.click:$command.requestFullscreen>`のクリックハンドラ）自体が実際のuser gestureに由来していなければならない。setTimeout内やPromiseの`.then()`の奥で呼ぶと、command-tokenを介していてもgesture文脈が失われrejectされる——これはブラウザの仕様上の制約であり、wcstack側で回避する手段はない。

このtrade-offは他のgesture依存API（Web Share・EyeDropper・Idle Detectionのrequest系、バッチ2/3参照）と共通の壁であり、本ノードがこの制約を最初に文書化する対象になる。

---

## 4. ベンダープレフィックス吸収 — **決定: API解決層（呼び出し時解決）で標準名とレガシー名を両方プローブ**

一部のSafariバージョンには`webkitRequestFullscreen`/`webkitExitFullscreen`/`webkitFullscreenElement`/`webkitfullscreenchange`のようなベンダープレフィックス実装が残る可能性がある。ガイドライン§3.7の「API解決は呼び出し時」原則に従い、コンストラクタでキャッシュせず、呼び出しの都度プローブする。

```typescript
private _requestFullscreenFn(el: Element): (() => Promise<void>) | undefined {
  const e = el as any;
  return e.requestFullscreen ?? e.webkitRequestFullscreen;
}

private _exitFullscreenFn(): (() => Promise<void>) | undefined {
  const d = document as any;
  return d.exitFullscreen?.bind(document) ?? d.webkitExitFullscreen?.bind(document);
}

private _fullscreenElement(): Element | null {
  const d = document as any;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

private _fullscreenChangeEventName(): string {
  return "onfullscreenchange" in document ? "fullscreenchange" : "webkitfullscreenchange";
}
```

- 標準名を優先し、無ければレガシー名にフォールバックする（`??`チェーン）。
- キャッシュしない: テストがAPIをinstall/removeで差し替え可能にし、unsupported環境（`requestFullscreen`も`webkitRequestFullscreen`も無い）を正しく`error`/`unsupported`扱いできるようにする。
- `document`の`fullscreenchange`購読も同様に標準名/レガシー名を解決してから`addEventListener`する。

---

## 5. `fullscreenchange`の購読先 — **決定: `document`に張る（target要素にではない）**

`fullscreenchange`イベントは`document`に対して発火する（target要素に対してではない）。したがってCoreのリスナーは常に`document.addEventListener(eventName, handler)`で張り、ハンドラ内で`this._fullscreenElement() === this._resolvedTarget`を比較して「自分のtargetの変化かどうか」を判定する。

これは§2の「複数インスタンス問題」の実装面の裏付けでもある——document単位のイベントを購読する以上、各インスタンスは受信のたびに自分の関心事（自分のtarget）でフィルタしなければならず、フィルタを怠ると全インスタンスが同じイベントに反応してしまう。

`intersection`のIntersectionObserverが要素単位でコールバックを受け取れる（§1.2で述べた「対象要素そのものにイベントが来る」モデル）のとは対照的な非対称性であり、この点は`_resolveTarget()`の転用では解決されない、Fullscreen固有の追加作業である。

---

## 6. `_gen`世代ガード — **決定: Core単位で1つ（fetch/uploadと同型）**

```typescript
private _gen = 0;
```

`document.fullscreenElement`はdocument全体で1つの状態しか持ちえないため、「複数の対象を並行して監視する」ような複雑さは発生しない。1つの`<wcs-fullscreen>`インスタンスにつき、進行中の`requestFullscreen()`/`exitFullscreen()`呼び出しは（gesture結果を待つ）高々1つが自然であり、[FetchCore](../packages/fetch/src/core/FetchCore.ts#L54)や`upload`と同じ「Core単位で1つ」のシンプルな世代ガードで十分。`dispose()`で`_gen++`し、disconnect後にresolve/rejectしたPromiseの結果が状態を書き換えないようにする。

```typescript
async requestFullscreen(): Promise<void> {
  const gen = ++this._gen;
  const { element } = this._resolveTarget(); // Shell側解決結果をCoreへ渡す設計、または同等の解決をCore内で保持
  const fn = element ? this._requestFullscreenFn(element) : undefined;
  if (!fn) {
    this._setError({ message: "Fullscreen API is not supported." });
    return;
  }
  try {
    await fn.call(element);
    if (gen !== this._gen) return; // stale
    this._setError(null);
  } catch (e: any) {
    if (gen !== this._gen) return; // stale
    this._setError(e); // NotAllowedError（gesture外呼び出し）等
  }
}
```

---

## 7. `exitFullscreen()`が何もfullscreenでない時の挙動 — **決定: silent no-op（resolve）**

- **決定: 何もfullscreenでない状態で`exitFullscreen()`を呼んだら、何もせずresolveする** ✅ — プラットフォームのネイティブ`document.exitFullscreen()`自体が、fullscreen中の要素が無い場合に`Promise`をrejectする（`InvalidStateError` [WHATWG仕様上は成功時と同じresolve契約だが実装依存でrejectするケースがある]）ことがあるが、本ノードはこれを利用者からは観測させない。呼び出し前に`document.fullscreenElement`（レガシー込み）を確認し、`null`なら即座に`resolve`して終える。
- ~~案: 何もfullscreenでない時にexitを呼ぶのはエラーとして`error`に流す~~ — 不採用。理由: (1) 「何もfullscreenでない」は`active`プロパティで既に観測可能な状態であり、`exitFullscreen()`を安全に何度呼んでも良い「べき等な後片付けコマンド」として扱う方が呼び出し側の分岐が減る。(2) never-throw原則と整合させるなら「エラーでない」が最も自然な既定——プラットフォーム自身の`exitFullscreen()`も「fullscreenを解除する」という意図の宣言であり、既に解除済みなら目的は達成されているとみなせる。

```typescript
async exitFullscreen(): Promise<void> {
  const gen = ++this._gen;
  if (this._fullscreenElement() === null) return; // 既にfullscreenでない: silent no-op
  const fn = this._exitFullscreenFn();
  if (!fn) return; // unsupported: silent no-op（requestと違い、意味的にはすでに「非fullscreen」）
  try {
    await fn();
    if (gen !== this._gen) return;
    this._setError(null);
  } catch (e: any) {
    if (gen !== this._gen) return;
    this._setError(e);
  }
}
```

---

## 8. `error`プロパティの扱い — **決定: 単純な`error`のみ。permissionの4値のような複合状態は不要**

`permission`パッケージは`"prompt" | "granted" | "denied" | "unsupported"`という4値stateを持つが、本ノードはそこまでの複雑さを必要としない。

- **理由1: 状態遷移のモデルが違う。** permissionは「ユーザーの意思決定を待つ多段階の状態機械」（未決定→決定待ち→許可/拒否、という永続的な状態）である。一方Fullscreenのgesture拒否は**単発の呼び出し失敗**であり、「今fullscreenであるかどうか」（`active`）と「直近の呼び出しが失敗したかどうか」（`error`）は独立した2つの軸で十分表現できる。`prompt`に相当する「ユーザーの意思決定待ち」の状態がFullscreen APIには存在しない（gestureが無ければ即rejectするだけで、待機状態にはならない）。
- **理由2: `unsupported`は`error`に自然に吸収できる。** API不在時は`requestFullscreen`関数解決が`undefined`になり、これも「呼び出しに失敗した」という`error`の一種として扱って矛盾がない（`permission`のように「監視だけしたいのに何も起きない」という別カテゴリの状態を作る必要がない——本ノードはcommandが呼ばれて初めて動くノードであり、常時監視が主目的ではないため）。
- **結論**: `error: any`（`null`で「直近エラーなし」）の単純なフィールド1つ。`active`（bool）と`error`の2軸の直交で十分に利用者の分岐要求（「fullscreen中か」「直前の要求は失敗したか」）を満たす。

---

## 9. Shell属性・autoTrigger

- **属性**: `target`のみ（`intersection`と同型のattribute-mirrored input）。`root`/`root-margin`/`threshold`のような追加設定は無い（Fullscreen APIに対応する概念が無い）。
- **autoTrigger**: 標準搭載しない。`requestFullscreen()`はgesture文脈が必須なため、`data-fullscreentarget`のようなクリック起動ショートカットを提供しても、そのショートカット自体がクリックイベントハンドラ内で実行される限りgesture文脈は保たれる（クリックイベントリスナー内の同期呼び出しである限り問題ない）。ただし本ノードの最有力な起動経路はcommand-tokenであり（`command.click:$command.requestFullscreen`をボタンに貼る運用が主眼）、`autoTrigger.ts`相当の専用属性は初版では見送る。将来的にトリガー属性の需要が出れば`worker`/`notification`のパターンを流用して追加できる。

---

## 10. SSR / `ready`

- 非同期probe（`query()`のような初期化待ち）が存在しないため、`ready`は`Promise.resolve()`固定（`intersection`/`fetch`と同型）。
- `observe()`相当のライフサイクルメソッドは「`fullscreenchange`リスナーを`document`に張るだけ」で同期完了するため、`connectedCallbackPromise`も即settleする。

---

## 11. テスト方針（happy-dom）

happy-domは`Element.prototype.requestFullscreen`等を持たないため全モック。

- `FakeFullscreenDoc`ヘルパで`document.fullscreenElement`を可変にし、`requestFullscreen`/`exitFullscreen`をスタブ関数として要素・documentに注入。`fullscreenchange`を手動`dispatchEvent`できるようにする。
- 観点:
  - `target="self"` / セレクタ / 子要素省略の3モード解決（`intersection`の対応テストをそのまま踏襲）。
  - 不正なセレクタ（構文エラー）で例外が飛ばず`null`解決になること（`_safeQuery`）。
  - `requestFullscreen()`成功時に`fullscreenchange`経由で`active: true`になること。
  - gesture外呼び出しを模した`reject`（`NotAllowedError`）でnever-throw・`error`に格納されること。
  - 標準API不在・レガシー(`webkitRequestFullscreen`)のみ存在の両パターンで解決できること。
  - **複数インスタンス同時存在**: `#a`をtargetにしたインスタンスと`#b`をtargetにしたインスタンスが同一`fullscreenchange`を受けても、`#a`がfullscreen化された場合は前者のみ`active: true`になること（§2.1の直接的な検証）。
  - 何もfullscreenでない状態での`exitFullscreen()`がsilent no-op（`error`が立たず、reject/例外も出ない）であること。
  - `_gen`世代ガード: disconnect後に`requestFullscreen()`のPromiseがresolve/rejectしても状態を書き換えないこと。
  - `observe()`/`dispose()`の冪等性（`document`リスナーが二重登録されない、dispose後の再observeで復活する）。
  - unsupported環境（`requestFullscreen`/`webkitRequestFullscreen`ともに無い）で`requestFullscreen()`が`error`へ落ちること。

---

## 12. 決定事項まとめ

| 論点 | 決定 |
|---|---|
| §1 target解決 | `intersection`の`_resolveTarget()`/`_safeQuery`を無改変で転用 |
| §2 active判定 | `document.fullscreenElement === 解決済みtarget`の都度比較。複数インスタンスは各自の解決済みtargetと比較する必要がある |
| §3 gesture制約 | never-throwでcatch。「呼び出し元がuser gesture由来である責務」をREADMEに明記、ノード自身はgestureを生成できない |
| §4 ベンダープレフィックス | API解決層（呼び出し時、非キャッシュ）で標準名→レガシー名の順にプローブ |
| §5 fullscreenchange購読先 | `document`（target要素にではない）。ハンドラ内で自己判定 |
| §6 `_gen`世代ガード | Core単位で1つ（fetch/uploadと同型） |
| §7 exitFullscreen()のno-op | **silent no-op（resolve）**。エラー化は不採用（プラットフォーム自体の挙動・never-throwと整合） |
| §8 error表現 | 単純な`error`のみ。permissionの4値stateは不要（状態機械のモデルが異なる・unsupportedはerrorに吸収可能） |
| §9 autoTrigger | 初版では無し。command-token（`command.click:$command.requestFullscreen`）が主経路 |
| パッケージ/タグ | `@wcstack/fullscreen` / `<wcs-fullscreen target="...">` / Shell `WcsFullscreen` |

---

## 13. 実装順の推奨

1. `FullscreenCore`（`_resolveTarget`相当の解決結果を受け取る形、API解決層、`_gen`、`document`購読、`active`/`error`の同値ガード付きsetter）。
2. Shell `<wcs-fullscreen target="...">`（`intersection`の`_resolveTarget()`/`_safeQuery()`をそのままコピー、`display`切り替え、connect/disconnectライフサイクル）。
3. Fake double（`FakeFullscreenDoc`: `fullscreenElement`可変・`requestFullscreen`/`exitFullscreen`スタブ・`fullscreenchange`手動発火）とテスト一式（§11）。
4. example: 画像ギャラリーの「全画面表示」ボタン（`command.click:$command.requestFullscreen`）、`hidden@!active`で終了ボタンを出し分け。
5. README ja/en（gesture制約の明記、ベンダープレフィックス対応状況、複数インスタンス時のactive判定の注意）。
6. Picture-in-Picture・Pointer Lockの設計ドキュメントは本書を参照する形で起草（[picture-in-picture-tag-design.md](./picture-in-picture-tag-design.md) / [pointer-lock-tag-design.md](./pointer-lock-tag-design.md)）。
