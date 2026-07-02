# 設計メモ: `@wcstack/screen-orientation`（`<wcs-screen-orientation>`）

- **状態**: 設計検討中（未実装）。本文書は実装前の論点整理と決定事項のスナップショット。
- **対象 WebAPI**: Screen Orientation API（`screen.orientation`、`ScreenOrientation` の `change` イベント、`.type` / `.angle` / `.lock(type)` / `.unlock()`）
- **位置づけ**: [io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) バッチ4（最小monitorパターン）の2本目。`Network Information`（`<wcs-network>`、[network-tag-design.md](./network-tag-design.md)）を先に実装し、その「単一イベント→派生getter」「`_gen`不要」の型を土台に、本ノードは**commandを持つ側**としてバッチ4を完結させる。
- **前提資産**: `permission`（単一state→複数派生boolean getterの型、`_permGen`世代ガード、Core/Shell分離）、`network`（querty不要・完全同期購読という「バッチ4の薄さ」の型、`_gen`省略の判断基準）、`fetch`（単一`_gen`によるcommand側の世代ガード、[FetchCore.ts:54](../packages/fetch/src/core/FetchCore.ts#L54)・[FetchCore.ts:195](../packages/fetch/src/core/FetchCore.ts#L195)）。

---

## 0. 大前提: バッチ4の中で「唯一commandを持つ」メンバー

[io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) バッチ4は「単一イベント→派生getter、極小Core」という共有アーキタイプを持つが、`network`が純粋monitor（`commands: []`）だったのに対し、本ノードは`lock()`/`unlock()`という2つのcommandを持つ。バッチ4内での位置づけは以下の3点に整理できる。

| | `<wcs-network>` | `<wcs-screen-orientation>` |
|---|---|---|
| 方向性 | monitor専用（`commands: []`） | **双方向**（monitor + command） |
| インスタンス設定属性 | 無し（`inputs: []`） | **無し**（本書§3で明示） |
| 監視の同期性 | 完全同期（`_gen`不要） | 監視は完全同期（`_gen`不要）だが**commandは非同期**（§5） |
| バッチ4内の役割 | 最速の練習台（純粋monitorの繰り返し） | monitor+commandの組み合わせを初めて確認する一本 |

このうち「インスタンスごとの設定属性が一切不要」という点は`network`と完全に共通する。両ノードは`screen.orientation`／`navigator.connection`という**window/screenスコープの単一グローバル**を対象にしており、バッチ1（Fullscreen / Picture-in-Picture / Pointer Lock）が要求する`target`属性→要素解決（[io-node-batch-implementation-plan.md:26-42](./io-node-batch-implementation-plan.md#L26-L42)、`_resolveTarget()`）が本ノードには一切登場しない。「対象を指定する」という設計問題そのものが存在しないノード、という点でバッチ1とは対照的な位置にある。

一方、「monitorは同期・commandは非同期」という非対称性は`network`には無かった新しい論点であり、これが本書の主題になる（§5）。

---

## 1. 存在意義 — 何を解決するノードか

- **向き固定UI**: ゲーム・動画プレイヤー・写真ビューアなど、特定の向きでのみ意味を持つUIを`hidden@!portrait`のような宣言的bindingで出し分ける。
- **向き固定の要求**: フルスクリーン中の動画再生やゲームで`lock("landscape")`を呼び、離脱時に`unlock()`する、という一時的な向き固定のワークフロー。
- **横断的な組み合わせ**: `<wcs-fullscreen>`（バッチ1）と組んで「フルスクリーンに入ったら横向きにlockする」という構成が自然に書ける（両者とも`target`/インスタンス設定を持たない薄いノードなので配線がシンプルになる）。

---

## 2. 公開する state — **決定: `type`/`angle` に加え `portrait`/`landscape` の派生 getter を追加**

バッチ計画で確定済みの基本形（[io-node-batch-implementation-plan.md:234-246](./io-node-batch-implementation-plan.md#L234-L246)）:

```typescript
static wcBindable: IWcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "type",  event: "wcs-orientation:change" },
    { name: "angle", event: "wcs-orientation:change", getter: e => e.detail.angle },
  ],
  commands: [
    { name: "lock", async: true },
    { name: "unlock" },
  ],
};
```

これに加え、以下2つの派生 boolean getter を**追加することを推奨する**。

```typescript
{ name: "portrait",  event: "wcs-orientation:change", getter: e => e.detail.type.startsWith("portrait") },
{ name: "landscape", event: "wcs-orientation:change", getter: e => e.detail.type.startsWith("landscape") },
```

### 追加する理由

- **既存パターンとの整合**: `permission`は`state`という単一4値プロパティから`granted`/`denied`/`prompt`/`unsupported`という4つの派生booleanを切り出している（[PermissionCore.ts:28-32](../packages/permission/src/core/PermissionCore.ts#L28-L32)）。async-io-node-guidelines §4.2 は複合状態を「1イベント＋派生getter」に分解することをSHOULDとして明記しており（[async-io-node-guidelines.md:215-222](./async-io-node-guidelines.md#L215-L222)）、`type`（4値の文字列）から真偽値を導く本ノードはこのパターンの典型的な適用対象である。
- **bindingの単純化**: `portrait`/`landscape`が無いと、利用者は`hidden@type|ne('portrait-primary')|and(...)`のような多段フィルタか、computed propertyを自前で書く必要がある。派生getterを1つ用意すれば`hidden@!portrait`のような一行bindingで足りる。ユースケース（§1の「向き固定UI」）の大半は「縦か横か」の二値判定であり、`portrait-primary`と`portrait-secondary`の区別まで必要とする場面は少ない。
- **実装コストがほぼゼロ**: `type`イベントに同居する派生getterを2つ追加するだけであり、Core側の状態やイベント発火ロジックに変更は要らない（`network`の`supported`と同じ「同じイベントに同居させるだけ」のパターン、[network-tag-design.md:66](./network-tag-design.md#L66)）。
- **`type`自体は引き続き公開する**: `portrait-primary`と`portrait-secondary`を区別したい高度なユースケース（例: 通知バーの表示位置切り替え）のために、生の`type`プロパティも残す。`portrait`/`landscape`は利便性のための追加であり、`type`の代替ではない。

unsupported時（§6）は`type`が`null`になるため、`portrait`/`landscape`の getter は`e.detail.type?.startsWith(...) ?? false`のように null 安全にする。

---

## 3. targetは不要 — インスタンスごとの設定属性が一切不要な2番目のノード

`screen.orientation`は`document`や`navigator.connection`と同じく、ページに1つしか存在しないグローバルなプラットフォームオブジェクトである。要素固有の「何を監視するか」というパラメータが存在しない。

- バッチ1（Fullscreen / Picture-in-Picture / Pointer Lock）は`target`属性→要素解決（`_resolveTarget()`、[io-node-batch-implementation-plan.md:26-42](./io-node-batch-implementation-plan.md#L26-L42)）を全メンバーが共有し、「どの要素に対する操作か」を毎回指定させる。
- `permission`は`name`属性（＋descriptor extras）で「どの権限か」を指定させる（[permission-tag-design.md:46-60](./permission-tag-design.md#L46-L60)）。
- `network`と本ノードは、監視対象がそもそも1つしかないため、**指定する余地自体が無い**。`<wcs-screen-orientation>`は属性を持たないタグとして接続するだけでよい。

このため`network-tag-design.md §9`（[network-tag-design.md:117-122](./network-tag-design.md#L117-L122)）と同じ結論になる: **`inputs: []`、Shell属性なし**。バッチ4はこの点で「インスタンスごとの設定が一切不要」という共通項を持つ2ノードで構成されており、バッチ1の`target`依存ノードとは設計の対極に位置する。

---

## 4. `lock()` の引数 — 受け付ける値の範囲

`ScreenOrientation.lock(orientation)`の引数は仕様上 `OrientationLockType` という文字列union だが、TypeScriptの`lib.dom.d.ts`には`ScreenOrientation.lock()`自体が型定義されていない（実験的APIのため。`unlock()`のみ存在する、[lib.dom.d.ts:30224-30229](../packages/state/node_modules/typescript/lib/lib.dom.d.ts#L30224-L30229)）。一次仕様（[Screen Orientation API — W3C](https://www.w3.org/TR/screen-orientation/)）に基づく`OrientationLockType`の全体集合は以下。

| 値 | 意味 |
|---|---|
| `"any"` | 制約なし（回転自由） |
| `"natural"` | デバイスの自然な向き |
| `"landscape"` | 横向き（primary/secondaryのどちらでもよい） |
| `"portrait"` | 縦向き（primary/secondaryのどちらでもよい） |
| `"portrait-primary"` | 縦向き・正位置 |
| `"portrait-secondary"` | 縦向き・反転 |
| `"landscape-primary"` | 横向き・正位置 |
| `"landscape-secondary"` | 横向き・反転 |

- **決定**: `lock(orientation: string)`はこの8値のunion型として型付けする（`OrientationLockType`という型エイリアスを`types.ts`に定義。`lib.dom.d.ts`に無いため自前定義が必要）。ただし**バリデーションはしない**（値のチェックは行わず、そのまま`screen.orientation.lock(orientation)`へ素通しする）。未知の文字列を渡した場合はブラウザ側が`TypeError`相当で reject するので、§5のnever-throwで吸収すれば足りる。型はDX（補完・タイポ検出）のためのものであり、実行時ガードではない — command-token 経由の呼び出し（`command.lock: 'landscape'`のような文字列引数）はTypeScriptの型検査を経由しないため、実行時に不正値が渡る余地はいずれにせよ残る。
- headless利用時のシグネチャは`lock(orientation: OrientationLockType): Promise<void>`。実装は`_setError(null)`してから`await screen.orientation.lock(orientation)`をtry/catchするだけで、成功/失敗どちらも例外を外へ漏らさない。

---

## 5. `lock()`/`unlock()` は best-effort command — 対応が狭いことを明示する

多くのデスクトップブラウザは`screen.orientation.lock()`を`NotSupportedError`でrejectする（モバイル限定、または特定のfullscreen文脈内でのみ動作する実装が一部にある。例: Chromiumはfullscreen要素が無い状態でのlockを拒否することがある）。

- **never-throwで吸収**: `lock()`のreject（`NotSupportedError` / `SecurityError` / その他）は`error`プロパティへ流し、例外として外へ漏らさない。呼び出し元コードでのtry/catchを要求しない。
- **`unsupported`状態にはしない**: `network`の`supported: boolean`のような二値の対応判定とは異なり、「lockが効くかどうか」は実行してみないと分からない（デスクトップ・モバイル・fullscreen文脈の有無など、環境依存の要因が複合するため事前判定が信頼できない）。`error`が非nullかどうかで呼び出し元が失敗を判定する、通常のcommand失敗パターンに寄せる。
- **README上の明記（MUST）**: 「`lock()`はモバイル文脈以外では失敗するのが普通のbest-effort commandである」という警告をREADMEに明記する。利用者が「動かないのはバグでは」と誤認しないための注記であり、`unlock()`（同期・戻り値なし・reject無し）とは信頼性の性質が異なることも併記する。

---

## 6. `_gen` 世代ガードの非対称性 — monitor半分は不要、command半分は必要

async-io-node-guidelines §3.4 は`_gen`世代ガードをMUSTとするが、本ノードは**監視とcommandで扱いが分かれる**という、バッチ4の中でも独自のニュアンスを持つ。これを独立したサブセクションとして明示する。

### 6.1 監視（`change`購読）には `_gen` 不要

`screen.orientation`の取得も`addEventListener('change', ...)`の購読も[network-tag-design.md §5](./network-tag-design.md#L76-L86)と全く同じ理由で完全に同期である。

- `screen.orientation`は呼び出し時に即座に解決するプロパティ参照であり、非同期probeが存在しない。
- `addEventListener`はブラウザが自発的に`change`を発火するだけで、Core側が能動的に何かを待つ処理ではない。
- したがって「disposeした後に非同期処理が解決してtorn-down要素へ書き込む」という`_gen`が守るべきレースそのものが発生しない。`network`と同様、監視系統には世代番号を持たせない。

### 6.2 `lock()` command には単一 `_gen` パターンが必要

`lock()`/`unlock()`はcommandとして非同期のin-flight状態を持つ。`lock()`はPromiseを返し、resolve/rejectまで時間がかかりうる。ここに`fetch`/`upload`と同型の「Core単位の単一`_gen`」パターンが必要になる。

- **理由**: 古い`lock()`呼び出しが進行中に、新しい`lock()`呼び出しや`unlock()`が発生しうる。旧`lock()`の解決（成功でも失敗でも）が、その後に確定した新しい状態を上書きしてはならない。例: `lock("landscape")`を呼んだ直後にユーザーが向きを戻す操作をして`unlock()`を呼んだ場合、先に呼ばれた`lock("landscape")`が後から解決して`error`をクリアする、といった逆転が起きてはならない。
- **実装形**: `FetchCore`の単一`_gen`（[FetchCore.ts:54](../packages/fetch/src/core/FetchCore.ts#L54)、[FetchCore.ts:195](../packages/fetch/src/core/FetchCore.ts#L195)）と同型。`lock()`開始時に`const gen = ++this._gen`を捕捉し、resolve/reject時に`gen !== this._gen`なら状態を書き換えずに終える。`unlock()`は同期API（後述）だが、呼ばれた時点で`this._gen++`し、in-flightな`lock()`を無効化する（`FetchCore.dispose()`が`this._gen++`してから`abort()`する構造、[FetchCore.ts:74-76](../packages/fetch/src/core/FetchCore.ts#L74-L76)と同じ考え方）。
- **`dispose()`との関係**: `dispose()`も`_gen++`する。disconnect後に`lock()`が解決しても状態を書き換えない。

### 6.3 非対称性のまとめ

| | 監視（`change`購読） | `lock()`/`unlock()` command |
|---|---|---|
| 性質 | 完全同期 | `lock()`は非同期、`unlock()`は同期 |
| `_gen`要否 | **不要**（`network`と同型） | **必要**（`fetch`/`upload`と同型） |
| 根拠 | 非同期probeが存在しない | in-flightなlockの解決が後発状態を上書きしうる |

同じCoreクラス内で「監視には世代番号が要らず、commandには要る」という非対称な設計になる点が、バッチ4を通じて初めて現れる興味深い局面であり、`permission`/`network`のような純粋monitorノードだけを見ていては気づけない論点である。実装時は`_gen`を監視ロジックからは完全に切り離し、`lock()`/`unlock()`のためだけに存在するフィールドであることをコメントで明記する。

---

## 7. unsupported と API 解決 — 呼び出し時解決・キャッシュしない

```typescript
private _api(): ScreenOrientation | undefined {
  return (typeof screen !== "undefined" && screen.orientation) ? screen.orientation : undefined;
}
```

- §3.7（MUST）に従い、コンストラクタでキャッシュせず観測・command双方の呼び出し時に解決する。`screen.orientation`は古いブラウザ（旧Safari等）でundefinedになりうるため、テストでのinstall/remove差し替えにも必要。
- **unsupported時の既定値**: `type`/`angle`は`null`固定。`lock()`/`unlock()`は例外を投げず、`error`に`{ message: "unsupported" }`相当を設定して resolve/no-opする（`lock()`はPromiseとして解決、`unlock()`は同期関数として即座に戻る）。
- `portrait`/`landscape`はunsupported時`type === null`となるため、`false`に落ちる（§2のnull安全なgetter）。
- `network`の`supported: boolean`のような明示的な対応判定プロパティは設けない。`type === null`であることが「unsupportedかどうか」の判定手段になる（`permission`の4値`state`のような専用状態も、`network`の`supported`フラグも、本ノードには不要 — API自体の有無は`type`のnull性で十分表現できるため）。

---

## 8. secure-context — 制約なし

Screen Orientation APIはsecure-context必須のリストに含まれない（`geolocation`/`permission`のような制約は無い）。`network`と同じく、README上「HTTPS必須」の注記は不要。

---

## 9. commands / autoTrigger — **決定: autoTriggerなし。ただしcommand-token経由の起動は通常通り可能**

- `screen.orientation`自体がEventTarget実装（実際のプラットフォーム仕様、[lib.dom.d.ts:30209](../packages/state/node_modules/typescript/lib/lib.dom.d.ts#L30209)）なので、Coreは合成イベントのラップなしで直接`addEventListener('change', ...)`できる。
- **autoTrigger（クリック起動ショートカット）は無い**。`lock()`はuser gestureの有無に関わらず呼び出せる（Fullscreen APIのような明示的なgesture要件はScreen Orientation仕様には無い）が、本ノードは`data-orientationtarget`のようなクリック委譲の対象にはしない。バッチ4は「最小monitor」パターンであり、バッチ3（薄い一発command）のようなワンクリック起動の主要ユースケースを持たない。
- **明確化**: autoTriggerが無いことは、`lock()`がstateから起動できないことを意味しない。command-tokenプロトコル（`$commandTokens` / `command.lock:`）経由で通常通り呼び出せる。両者は別の経路であり、「クリック一発で完結するショートカットUI」を提供しないだけで、「stateの`command.lock: 'landscape'`のような宣言的束縛から起動する」通常のcommand-token連携は他ノードと同様に機能する。

---

## 10. Shell属性 — 属性なし

`network`（[network-tag-design.md §9](./network-tag-design.md#L117-L122)）と同じく、`<wcs-screen-orientation>`は属性を持たない。

- `inputs: []`。`connectedCallback`で無条件に`change`購読を開始するだけ。
- `lock`/`unlock`はcommandであり属性ではないため、Shellの「属性連動入力」（§4.3の分類）には該当しない。command-token経由、またはheadless利用時のメソッド直接呼び出しで駆動する。

---

## 11. テスト方針（happy-dom）

happy-domは`screen.orientation`を持たないため全モック。

- `FakeScreenOrientation extends EventTarget`に`type`/`angle`を可変プロパティとして持たせ、`change`イベントを手動発火できるヘルパを用意。`lock`/`unlock`はスタブメソッド（`lock`は呼び出しごとにresolve/rejectを制御できるcontrollable Promiseにする）。
- `Object.defineProperty(screen, "orientation", { value: fake, configurable: true })`でinstall/remove（`network`の`navigator.connection`差し替えと同型）。
- 観点:
  - `screen.orientation`不在時に`type`/`angle`が`null`、`portrait`/`landscape`が`false`。
  - `change`発火で`type`/`angle`/`portrait`/`landscape`が同時に更新され、1つの`wcs-orientation:change`イベントで観測できる。
  - `type`が`"portrait-primary"`/`"portrait-secondary"`のとき`portrait`が`true`かつ`landscape`が`false`（逆も同様）。
  - `lock()`成功時に`error`が`null`のまま維持される。
  - `lock()`のreject（`NotSupportedError`相当）がnever-throwで`error`に吸収される（呼び出し元のPromiseは reject せず resolve する契約なら、その旨も検証）。
  - **`_gen`世代ガード**: `lock()`呼び出し中に`unlock()`または新しい`lock()`が呼ばれた場合、旧`lock()`の解決が新しい状態を上書きしない（§6.2の非対称性の直接的な検証）。dispose後に`lock()`が解決しても状態を書き換えない。
  - 監視側は`_gen`を持たないため、dispose後の`change`購読解除は素直なlistener removeの確認で足りる（`network`と同型、`_gen`相当の世代ガードが無いことの確認）。
  - `observe()`の冪等性（二重呼び出しでlistenerが二重登録されない）。
  - unsupported環境での`lock()`/`unlock()`が例外を投げず`error`に`"unsupported"`相当を設定する。

---

## 12. 決定事項まとめ

| 論点 | 決定 |
|---|---|
| §2 公開state | `type` / `angle`（バッチ計画で確定済み）に加え、派生boolean `portrait` / `landscape` を**追加**（permissionの4値パターンと同型） |
| §3 target | **不要**。`network`と並びバッチ4で「インスタンス設定属性が一切不要」な2メンバー。バッチ1のtarget依存ノードと対照 |
| §4 `lock()`引数 | `OrientationLockType`（8値union、`lib.dom.d.ts`に無いため自前定義）として型付け。実行時バリデーションはせずブラウザのrejectに委ねる |
| §5 `lock()`の対応範囲 | best-effortコマンド。never-throwで`error`へ吸収。「モバイル文脈以外では失敗するのが普通」とREADMEに明記。`unsupported`状態にはしない |
| §6 `_gen`世代ガード | **非対称**: 監視（`change`購読）は不要（`network`と同型・完全同期）。`lock()`/`unlock()`commandはCore単位の単一`_gen`が必要（`fetch`/`upload`と同型） |
| §7 unsupported/API解決 | 呼び出し時解決（キャッシュしない）。unsupported時`type`/`angle`は`null`固定、`lock()`/`unlock()`は例外を投げず`error`("unsupported"相当)を返す |
| §8 secure-context | 制約なし |
| §9 autoTrigger | **なし**。ただし`lock()`はcommand-token経由でstateから通常通り起動できる（別経路であることを明記） |
| §10 Shell属性 | 無し（`network`と並びバッチ中最小） |
| パッケージ/タグ | `@wcstack/screen-orientation` / `<wcs-screen-orientation>` / Shell `WcsScreenOrientation` |

---

## 13. 実装順の推奨

1. `ScreenOrientationCore`（`_api()`呼び出し時解決＋`change`購読＋`type`/`angle`/`portrait`/`landscape`の派生getter）。監視部分は`network`のコピーに近い分量で済む。
2. `lock()`/`unlock()`commandと単一`_gen`世代ガード（§6.2）を追加。`fetch`の`_gen`実装（[FetchCore.ts](../packages/fetch/src/core/FetchCore.ts)）を土台に、監視ロジックとは独立したフィールドとして実装する。
3. Shell `<wcs-screen-orientation>`（属性無し、`display:none`、connect時に無条件購読）。
4. Fake double（`FakeScreenOrientation`）とテスト一式。§6.2の`_gen`非対称性のテストを重点的に書く。
5. example: 「フルスクリーン中は横向きにlockする」を目玉に。`<wcs-fullscreen>`（バッチ1）と組み合わせ、`hidden@!landscape`で向き外れ時のみ警告バナーを出す構成を併記する。
6. README ja/en（secure-context不要・`lock()`はbest-effortでモバイル限定が実態・`unsupported`ではなく`error`で失敗表現する旨を明記）。
