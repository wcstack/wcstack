# 設計メモ: `@wcstack/contacts`（`<wcs-contacts>`）

> **⚠ 更新（architecture-hardening 昇格）**: 本書が `@wcstack/share` から継承した
> 単一 `_gen` 世代ガードと `_api()` ヘルパーは、共有 io-core（`OperationLane` +
> `platformCapability`）への昇格に伴い置換された。現行 `ContactsCore` は:
> - **並行制御** = `OperationLane("contacts", "exhaust")`。進行中の2回目の `select()` は
>   ticket 化されず即 no-op（`navigator.contacts.select` を呼ばない）。旧設計は「プラット
>   フォームが2回目を `InvalidStateError` で弾く」前提だったが、それは進行中の1回目の
>   `error`/`loading` を破壊するバグを生んでいた（exhaust がこれを解消）。`dispose()` は
>   lane の owner generation を進めて in-flight を無効化する（旧 `_gen++` 相当）。
> - **capability/error taxonomy** = 利用直前 probe（`web.contacts`）で unsupported を
>   `capability-missing` として検出し、追加的な bindable プロパティ `errorInfo`
>   （`WcsIoErrorInfo`）を公開する。既存 `error`/`cancelled` の shape は不変。
>
> 詳細は [web-share-tag-design.md](./web-share-tag-design.md) の同等バナーと
> [share の実装](../packages/share/src/core/ShareCore.ts) を参照。以下は実装時の論点整理の記録。

- **状態**: 実装済み（`packages/contacts`）。本文書は実装時の論点整理と決定事項の記録。
- **対象 WebAPI**: Contact Picker API（`navigator.contacts.select(properties, options)`、`navigator.contacts.getProperties()`）
- **位置づけ**: [io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) バッチ3（薄い一発commandパターン）の3本目。同計画書は本ノードを「**複数引数command**」と「**Android Chrome限定でunsupportedがデフォルト環境になりやすい**」という2点の実証役に位置づける（同書§per-API仕様「Contact Picker」）。
- **本書の性質**: [web-share-tag-design.md](./web-share-tag-design.md) を基本アーキタイプとする短い差分ドキュメント。`value`/`loading`/`error`/`cancelled`の4 properties構成、`cancelled`/`error`分離の根拠、`FetchCore._doFetch`簡約版というCore骨格、`abort`コマンド無し（本ノードもWeb Shareと同じくプラットフォームに中断手段が無い）は**すべてweb-share-tag-design.mdを正典として参照**し、繰り返さない。以下はContact Picker固有の事実のみを記す。

---

## 1. Web Shareとの共通点（再掲しない前提の確認）

- Core骨格・`cancelled`/`error`分離・unsupported判定方針（`supported`フラグ無し、呼び出し時に即`error`）は[web-share-tag-design.md](./web-share-tag-design.md)のとおり。`navigator.contacts.select()`もユーザーがピッカーをキャンセルすると`AbortError`でrejectするため、`cancelled`分離の理由（ユーザーの日常的なキャンセルを真の障害と区別する）がそのまま適用される。
- **`abort`コマンドは持たない**。EyeDropper（[eyedropper-tag-design.md](./eyedropper-tag-design.md)）とは異なり、`ContactsManager.select()`にAbortSignalを渡すオプションは存在しない。呼び出し元から進行中のピッカーを中断させる手段がプラットフォームに無いため、Web Shareと同じ理由で`abort`コマンドを宣言しない。

---

## 2. `commands: [{ name: "select", async: true }]` — **2つの位置引数を取る、バッチ初のcommand**

`navigator.contacts.select(properties, options)`は2つの引数を取る:

- `properties: string[]` — 取得したいフィールド名の配列（`'name'` / `'email'` / `'tel'` / `'address'` / `'icon'`）
- `options: { multiple?: boolean }` — 複数選択を許可するか（既定`false`）

```typescript
static wcBindable: IWcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "value",     event: "wcs-contacts:complete",         getter: e => e.detail.value },
    { name: "loading",   event: "wcs-contacts:loading-changed" },
    { name: "error",     event: "wcs-contacts:error" },
    { name: "cancelled", event: "wcs-contacts:cancelled-changed" },
  ],
  commands: [
    { name: "select", async: true },
  ],
};
```

**このバッチ3メンバーの中で初めて、単一オブジェクトでなく複数位置引数を取るcommandである**点が本ノード最大の特徴。Web Share（`share(data)`、1個のオブジェクト引数）・EyeDropper（`open()`、引数無し）はいずれも「引数0〜1個」で閉じていたが、Contact Pickerは`select(properties, options)`という**2個の位置引数**を要求する。

```
command.select: $command.pickContacts
```
```typescript
// state 側
this.$command.pickContacts.emit(["name", "email", "tel"], { multiple: true });
```

[spec-proposal-command-token-arguments.md](./spec-proposal-command-token-arguments.md)が規範化する位置引数素通し規則（「`emit(a, b)`は購読側の command メソッドを`method(a, b)`として呼ぶ。順序・個数・各値の同一性を保つ。binderは変換・包装・切り詰めしてはならない」、[spec-proposal-command-token-arguments.md:63](./spec-proposal-command-token-arguments.md#L63)、規範文言は[同ファイル:75-100](./spec-proposal-command-token-arguments.md#L75-L100)）は、そもそも引数の個数を1個に限定していない。同文書が根拠に挙げる既存実例（[spec-proposal-command-token-arguments.md:51](./spec-proposal-command-token-arguments.md#L51)「README 例: `fetchUsers.emit("/api/users", { method: "GET" })` — 2引数（位置）」）が示すとおり、`fetch(url, options)`という2位置引数のcommandは既に稼働実績がある。`emit(properties, options)`が`select(properties, options)`へ**そのまま2引数として届く**ことは、既存の引数転送機構（`Token.emit(...args)`→`Reflect.apply(method, el, args)`、[spec-proposal-command-token-arguments.md:53-55](./spec-proposal-command-token-arguments.md#L53-L55)）が個数に関わらず素通しする設計であるため、**追加の対応やプロトコル変更は一切不要**。本ノードはこの規則を「1個より多い場合」で確認する最初のバッチ3メンバーという位置づけになる。

---

## 3. `value` = contactオブジェクトの配列

`select()`は解決時に、選択された連絡先の配列を返す（各要素は`properties`で指定したフィールドのみを持つオブジェクト。例: `[{ name: ["Taro Yamada"], tel: ["090-1234-5678"] }]`）。EyeDropperの`{ sRGBHex }`と同様、**プラットフォームの戻り値をそのまま`value`に渡せる**（Web Shareのような合成は不要）。

```typescript
private async _select(properties: string[], options?: { multiple?: boolean }): Promise<any> {
  // ...
  const contacts = await navigator.contacts.select(properties, options);
  this._setValue(contacts); // ContactInfo[]
  // ...
}
```

`multiple: false`（既定）でも戻り値は常に配列（要素数0または1）である点に注意し、Shell/README側で「単一選択でも`value`は配列」という契約を明記する。

---

## 4. `getProperties()`の扱い — 事前検証メソッドだが非同期、Web Shareの`canShare`とは性質が異なる

`ContactsManager`には`getProperties(): Promise<string[]>`という、実行環境がサポートするフィールド名一覧を返すメソッドが存在する（MDN仕様確認済み。将来的にプラットフォームやOSによって対応フィールドが変わりうるため用意されている）。

Web Shareの`canShare(data)`（[web-share-tag-design.md §6](./web-share-tag-design.md#6-canshareddataの扱い--決定-同期プレーンメソッドとして公開)）は同期・副作用無しのプレーンメソッドとしてwcBindable外に公開する決定だったが、`getProperties()`は**Promiseを返す非同期メソッド**であり同列には扱えない。

- **決定: v1では省略する** ✅ — `getProperties()`は「`select()`を呼ぶ前に対応フィールドを確認する」という補助的なユースケースであり、`select()`自体が呼び出し時に未対応フィールドを渡されても仕様上reject/フィルタで吸収する（ブラウザ実装依存）。事前検証を宣言的surfaceに含めるコストに対し、初版での需要は薄いと判断し、wcBindable・Shellプレーンメソッドいずれにも含めない。将来的に非同期プレーンメソッド（`Promise`を返すインスタンスメソッド、never-throwでラップしたヘルパー）として追加する余地は残す。

---

## 5. Android Chrome限定 — バッチ中最も対応が狭い

Contact Picker APIはAndroid上のChrome 80以降のみで動作し、**デスクトップは完全に非対応**（MDN仕様確認済み: `'contacts' in navigator && 'ContactsManager' in window`で判定。iOS Safari、デスクトップChrome/Firefox/Safari/Edgeいずれも未実装）。

これはバッチ3の中で最も対応範囲が狭い。Web Share（デスクトップ・モバイル問わず主要ブラウザで広く対応）、EyeDropper（Chromium系ならデスクトップ・Android問わず対応）と比べても、**「Android Chromeのみ」という単一プラットフォームの単一ブラウザに絞られる**点が際立つ。

- **設計への含意**: [network-tag-design.md §0](./network-tag-design.md#0-大前提-賭けの性質を持つノード--unsupportedが常態)の「unsupportedが常態」という前提が、バッチ3の中で最も強く当てはまるのが本ノードである。デスクトップで開発・検証しているとほぼ常に`unsupported`分岐しか目にしない。
- **README・exampleでの既定**: いかなるexample/READMEでも、**unsupportedを既定状態として想定すべき**。「Android Chromeで動けば儲けもの」という前提でUIを組む（`hidden@!<利用者側のサポート判定>`でボタン自体を隠す、あるいはメールアドレス手入力等の代替UIを常設した上でContact Pickerを補助的なショートカットとして添える）。unsupported時に何も表示されない・エラーも出さない「静かなフォールバック」をデフォルトの挙動として明記する。
- unsupported判定は[web-share-tag-design.md §8](./web-share-tag-design.md#8-unsupported判定--決定-share呼び出し時に即error供給フラグは持たない)と同型で、`select()`呼び出し時に`typeof navigator.contacts?.select !== "function"`を判定して即`error`に落とす（`supported`フラグは持たない）。

---

## 6. Shell属性・inputs

Web Share・EyeDropperと同じく実質無し。`properties`/`options`は`select`コマンドの呼び出し引数として毎回渡されるものであり、Shell属性としての宣言的固定にはなじまない。`<wcs-contacts>`は`display: none`。

---

## 7. テスト方針（happy-domの追加観点のみ）

[web-share-tag-design.md §11](./web-share-tag-design.md#11-テスト方針happy-dom)のテスト観点（成功/cancelled/error遷移、リセット、unsupported、`_gen`ガード、never-throw、冪等性、SSR）はそのまま踏襲する。Contact Picker固有で追加すべき観点:

- `select(properties, options)`の**2引数がそのままCoreメソッドに渡ること**（`Reflect.apply`による位置引数素通しの確認。`properties`配列と`options`オブジェクトが個別の引数として届き、1個のオブジェクトに合成されていないこと）
- `options`省略時（`select(properties)`のみ、1引数呼び出し）でも`multiple`が既定`false`としてプラットフォームAPI側に渡ること
- `multiple: false`でも`value`が配列であること（単一選択でも配列を維持する契約の確認）
- `navigator.contacts`不在環境（デスクトップを模した`FakeDouble`未installのケース）で`select()`が即`error`になること
- `AbortError`（ユーザーがピッカーをキャンセル）で`cancelled`が`true`になり`error`は変化しないこと

---

## 8. 決定事項まとめ

| 論点 | 決定 |
|---|---|
| アーキタイプ | Web Shareと同一（[web-share-tag-design.md](./web-share-tag-design.md)参照）。`value`/`loading`/`error`/`cancelled`の根拠もそちら |
| `select`コマンド引数 | **2つの位置引数**`(properties: string[], options: {multiple?: boolean})`。バッチ3で初の複数位置引数command |
| 位置引数素通しの確認 | [spec-proposal-command-token-arguments.md](./spec-proposal-command-token-arguments.md)の規則は個数を1個に限定しておらず、2引数でも無改造で成立する（README実例`fetchUsers.emit(url, options)`と同型） |
| `abort`コマンド | **持たない**（Web Shareと同じくAbortSignal相当の中断手段がプラットフォームに無い） |
| `value` | contactオブジェクトの配列（`multiple`の値に関わらず常に配列） |
| `getProperties()` | **v1では省略**（非同期メソッドでありWeb Shareの同期`canShare`とは性質が異なるため。将来、非同期プレーンメソッドとして追加余地を残す） |
| 対応範囲 | **Android Chrome限定**。デスクトップは完全非対応。バッチ中最も対応が狭く、unsupportedを既定状態として設計・README/example共に明記 |
| パッケージ/タグ | `@wcstack/contacts` / `<wcs-contacts>` / Shell `WcsContacts` |

---

## 9. 実装順の推奨

1. `ContactsCore`（Web Shareの`ShareCore`をコピーし、`share(data)`を`select(properties, options)`の2引数シグネチャへ差し替える。`abort`コマンドは追加しない）。
2. Shell `<wcs-contacts>`（属性なし、`display:none`、connect/disconnectライフサイクル）。
3. Fake double（`navigator.contacts`オブジェクト全体を`{ select, getProperties }`としてinstall/remove）とテスト一式（§7）。
4. example: 「連絡先から宛先を選ぶ」を目玉に。Android Chrome実機でのみ動く前提を明記し、デスクトップでは常時代替UI（手入力フォーム）を表示する「unsupportedがデフォルト」の実演にする。
5. README ja/en（Android Chrome限定・デスクトップ完全非対応・`multiple:false`でも`value`は配列である旨を明記）。
