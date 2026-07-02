# 設計メモ: `@wcstack/eyedropper`（`<wcs-eyedropper>`）

- **状態**: 設計検討中（未実装）。本文書は実装前の論点整理と決定事項のスナップショット。
- **対象 WebAPI**: EyeDropper API（`new EyeDropper().open(options)`）
- **位置づけ**: [io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) バッチ3（薄い一発commandパターン）の2本目。**アーキタイプの汎用性を最初に証明する候補**（同計画書§実装順序）。
- **本書の性質**: [web-share-tag-design.md](./web-share-tag-design.md) と**同じアーキタイプ**（`FetchCore._doFetch`簡約版：単一`_gen`・never-throw try/catch・同値ガード付きsetter、`AbortController`/`abort()`コマンド無し）を採用する短い差分ドキュメント。`value`/`loading`/`error`/`cancelled`という4 properties構成、`cancelled`を`error`から独立させる根拠、`canShare`型の事前検証メソッドの扱い方針は**web-share-tag-design.mdを正典として参照**し、本書では繰り返さない。以下はEyeDropper固有の事実と、Web Shareとの明示的な差異のみを記す。

---

## 1. Web Shareとの共通点（再掲しない前提の確認）

- Core骨格: 単一`_gen`世代ガード、`_setLoading`/`_setValue`/`_setError`/`_setCancelled`の同値ガード付きsetter、never-throwのtry/catchラップ（[web-share-tag-design.md §2](./web-share-tag-design.md#2-アーキタイプの由来--fetchcoreの_dofetchを簡約する)）。
- `cancelled`/`error`分離の理由（ユーザーがEscキーで選択をキャンセルした場合を`error`に混ぜない）は[web-share-tag-design.md §3](./web-share-tag-design.md#3-cancelledをerrorから分離する--決定-独立したbooleanとevent)の議論がそのまま適用される。EyeDropperの`open()`も`AbortError`でrejectする（Escキー押下時、またはAbortSignal経由の中断時）。
- unsupported判定の設計思想（`supported`フラグを持たず、呼び出し時に即`error`）は[web-share-tag-design.md §8](./web-share-tag-design.md#8-unsupported判定--決定-share呼び出し時に即error供給フラグは持たない)と同型。本ノードでは判定対象が`typeof EyeDropper === "undefined"`になる（§4）。

---

## 2. `commands: [{ name: "open", async: true }]` — **決定: 引数無し＋`abort`コマンドを追加する**

Web Shareとの決定的な差異はここにある。`EyeDropper.open()`は`AbortSignal`を渡せる`{signal}`オプションを受け付ける（MDN仕様確認済み: `open()`または`open({signal})`。signalの`abort()`が呼ばれるとeyedropperモードが中断され、Promiseは`AbortError`でreject）。

- **`open`コマンド自体の引数**: `open()`は色選択という単一の操作で、Web Shareの`{title,text,url,files}`のような「呼び出しごとに変わる設定値」を必要としない。**引数無し**で宣言する（`commands: [{ name: "open", async: true }]`、command-token経由で呼ばれても引数0個でよい）。
- **`abort`コマンドを追加する** ✅ — Web Shareが「呼び出し元からの中断手段がプラットフォームに存在しない」ため`abort`コマンドを持たなかったのに対し、EyeDropperは**`{signal}`オプションで呼び出し元からの中断手段が実在する**。この非対称性が「同じアーキタイプに属する2つのノードでも、プラットフォームAPIの形が違えば`abort`コマンドの有無が変わる」ことを示す最初の実例になる。

```typescript
static wcBindable: IWcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "value",     event: "wcs-eyedropper:complete",        getter: e => e.detail.value },
    { name: "loading",   event: "wcs-eyedropper:loading-changed" },
    { name: "error",     event: "wcs-eyedropper:error" },
    { name: "cancelled", event: "wcs-eyedropper:cancelled-changed" },
  ],
  commands: [
    { name: "open",  async: true },
    { name: "abort" },
  ],
};
```

`abort`コマンドの実装は`FetchCore.abort()`（[FetchCore.ts:159-164](../packages/fetch/src/core/FetchCore.ts#L159-L164)）の形をそのまま復元する。Core内部に`_abortController: AbortController | null`を1つ持ち、`open()`開始時に生成した`AbortController`の`signal`を`EyeDropper.open({ signal })`へ渡す。`abort()`が呼ばれれば`this._abortController?.abort()`、結果は`open()`のPromiseが`AbortError`でrejectし、既存の`cancelled`分岐（§1で参照した`web-share-tag-design.md §3`の判定ロジック）にそのまま合流する（ユーザーがEscで閉じた場合も、呼び出し元が`abort`コマンドで中断した場合も、どちらも同じ`AbortError`として`cancelled`に着地する。両者を区別する必要はない — どちらも「選択は完了しなかった」という共通の意味を持つため）。

`open()`が同時に2つ実行されることは無い（`InvalidStateError`でreject、MDN仕様確認済み）ため、単一`_gen`のままでよく、`abort()`が新しい`open()`呼び出しと競合する余地は無い。

---

## 3. `value` = `{sRGBHex: string}`の結果オブジェクト

`EyeDropper.open()`は解決時に`{ sRGBHex: "#aabbcc" }`という単一プロパティのオブジェクトを返す。Web Shareと違い、これは**プラットフォームAPIが直接返す値をそのまま`value`に渡せる**（Web Shareは`navigator.share()`自体が`Promise<void>`のため、呼び出し元が渡した`data`をエコーバックする追加のひと手間が必要だったが、EyeDropperは戻り値をそのまま使える）。

```typescript
private async _open(options?: { signal?: AbortSignal }): Promise<any> {
  // ...
  const result = await new EyeDropper().open(options);
  this._setValue(result); // { sRGBHex: "#aabbcc" }
  // ...
}
```

---

## 4. Chromium限定・デスクトップ限定機能

- **対応判定**: `typeof EyeDropper === "undefined"`をAPI解決の呼び出し時チェックに使う（ガイドライン§3.7、キャッシュ禁止）。コンストラクタ内で`new EyeDropper()`できるかどうかではなく、`open`コマンド呼び出し時に毎回このチェックを行う。
- **Chromium限定**: 2026年時点でFirefox/Safariは未実装。`typeof EyeDropper === "undefined"`が常にtrueになる環境が主要ブラウザの一角を占める点は[network-tag-design.md §0](./network-tag-design.md#0-大前提-賭けの性質を持つノード--unsupportedが常態)の「unsupportedが常態」という前提と同種の注意書きをREADMEに残す。
- **デスクトップ限定機能という設計上の含意**: 画面上の任意ピクセルの色を拾うという操作は、指先で操作するモバイルのタッチ文脈ではほぼ意味を持たない（ピクセル単位の精密なポインティングがタッチでは困難、かつモバイルChromeにEyeDropperの実装が無い）。README/exampleは「デスクトップ向けのカラーピッカーUI」を前提に書き、モバイル環境での`unsupported`フォールバック（ボタンを隠す、代替のカラー入力UIを出す等）を既定の使い方として明記する。

---

## 5. Shell属性・inputs

Web Shareと同じく実質無し。`open()`に呼び出しごとの設定値は無く（`signal`はCore内部で管理するAbortControllerから供給する）、Shell属性として宣言的に固定するものが無い。`<wcs-eyedropper>`は`display: none`。

---

## 6. テスト方針（happy-domの追加観点のみ）

[web-share-tag-design.md §11](./web-share-tag-design.md#11-テスト方針happy-dom)のテスト観点（成功/cancelled/error遷移、リセット、unsupported、`_gen`ガード、never-throw、冪等性、SSR）はそのまま踏襲する。EyeDropper固有で追加すべき観点:

- `abort()`コマンドで進行中の`open()`が中断され、`cancelled`が`true`になること（Web Shareには無い経路）
- `abort()`を呼び出し前（`open()`未実行）に呼んでも何も起きない（no-op、`FakeEyeDropper`側で`AbortController`未生成状態を許容）こと
- `open()`実行中に`abort()`→`open()`を素早く連打しても、新しい`open()`の`AbortController`が古いものと混線しない（`FetchCore`の`ac`ローカル変数によるidentityチェック、[FetchCore.ts:312-314](../packages/fetch/src/core/FetchCore.ts#L312-L314)と同型の防御）こと
- `typeof EyeDropper === "undefined"`環境（`FakeEyeDropper`をグローバルから取り除いたケース）で`open()`が即`error`になり、`loading`が`true`にすらならないこと
- `{ sRGBHex }`オブジェクトがそのまま`value`に渡ること（Web Shareのような合成が不要である点の確認）

---

## 7. 決定事項まとめ

| 論点 | 決定 |
|---|---|
| アーキタイプ | Web Shareと同一（[web-share-tag-design.md](./web-share-tag-design.md)参照）。`value`/`loading`/`error`/`cancelled`の根拠もそちら |
| `open`コマンド引数 | **引数無し**（`{signal}`はCore内部のAbortControllerから供給、command-token経由では渡さない） |
| `abort`コマンド | **追加する**（Web Shareとの明示的な差異。`EyeDropper.open({signal})`がAbortSignal対応のため中断手段が実在する） |
| `value` | `{ sRGBHex: string }`（プラットフォームの戻り値をそのまま使う。Web Shareのような合成不要） |
| 対応範囲 | Chromium限定（`typeof EyeDropper === "undefined"`判定）。デスクトップ限定機能として設計・README/example共に明記 |
| パッケージ/タグ | `@wcstack/eyedropper` / `<wcs-eyedropper>` / Shell `WcsEyedropper` |

---

## 8. 実装順の推奨

1. `EyedropperCore`（Web Shareの`ShareCore`をコピーし、`AbortController`＋`abort()`コマンドを`FetchCore`から復元して追加する）。
2. Shell `<wcs-eyedropper>`（属性なし、`display:none`、connect/disconnectライフサイクル）。
3. Fake double（`FakeEyeDropper`。グローバル`EyeDropper`コンストラクタごと差し替える必要があり、`navigator.share`のような関数単体の差し替えより一段複雑）とテスト一式（§6）。
4. example: 「クリックで背景色を拾うカラーピッカーUI」を目玉に。デスクトップ限定・`unsupported`時はボタンごと隠す（`hidden@!<supported相当の利用者側判定>`）例を併記。
5. README ja/en（Chromium限定・デスクトップ向け・`abort`コマンドの存在をWeb Shareとの差異として明記）。
