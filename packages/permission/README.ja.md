# @wcstack/permission

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/permission` は wcstack エコシステム向けのヘッドレスなパーミッション状態コンポーネントです。

視覚的な UI ウィジェットではありません。
`@wcstack/geolocation` が端末の位置をリアクティブな state に変えるのと同じように、ブラウザのパーミッション許可状態をリアクティブな state に変える **非同期プリミティブノード** です。

`@wcstack/state` と組み合わせると、`<wcs-permission>` はパス契約で直接バインドできます:

- **入力サーフェス**: `name`、`user-visible-only`、`sysex`
- **出力 state サーフェス**: `state`、`granted`、`denied`、`prompt`、`unsupported`

これにより、パーミッションに応じた UI（バナー・ゲート・機能ヒント）を、UI 層で `navigator.permissions.query()` や `change` リスナーの配線を書かずに、HTML 上で宣言的に表現できます。

`@wcstack/permission` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core**（`PermissionCore`）が query・4 値 state・live `change` 追従を担当
- **Shell**（`<wcs-permission>`）がその state を DOM 属性とライフサイクルに接続
- **Binding Contract**（`static wcBindable`）が観測可能な `properties` を宣言（そして意図的に **コマンドを持たない**）

## なぜ存在するか — read-only でコマンドの無いノード

他の wcstack IO ノード（`<wcs-geo>`、`<wcs-ws>`、`<wcs-clipboard>` …）はいずれも「何かを実行し」つつ state を報告します。Permissions API はそれらと違い **read-only** です。`query()` はあっても標準の `request()` がありません。この API から許可を求めることはできず、許可要求は機能そのものの呼び出し（`getCurrentPosition()`、`Notification.requestPermission()` …）の副作用として起こります。

したがって `<wcs-permission>` は純粋な **要素 → state** プロデューサです。*監視する* だけで、*求めない*。**コマンドを一切持たない初の wcstack ノード** であり、command-token は適用されず event-token のみが成立します。許可を取りに行くのは機能ノード（`<wcs-geo>` など）の責務で、本ノードは現在の許可状態を live なバインド可能 state として反映するだけです。

パーミッションの変化は `change` リスナーの購読ではなく **状態遷移** になります。

> **secure context 必須。** Permissions API は secure context（HTTPS、または `localhost`）でのみ動作します。API が存在しない場合や、要求した権限名をブラウザが拒否する場合（対応はブラウザ差が大きい: Firefox は `clipboard-read` 非対応、Safari は複数の名前を欠く）、`<wcs-permission>` は例外を投げず `state = "unsupported"` を報告します。

## インストール

```bash
npm install @wcstack/permission
```

## クイックスタート

### 1. 許可状態を監視して UI をゲートする

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/permission/auto"></script>

<wcs-state>
  <script type="module">
    export default { granted: false };
  </script>
</wcs-state>

<wcs-permission name="geolocation" data-wcs="granted: granted"></wcs-permission>

<!-- 監視結果のブール 1 つ: 許可されるまで表示。 -->
<div data-wcs="hidden: granted">続行するには位置情報を許可してください。</div>
```

### 2. 4 値の state

```html
<wcs-permission name="camera"
  data-wcs="state: camState"></wcs-permission>
```

`state` は `"prompt"` / `"granted"` / `"denied"` / `"unsupported"` で、ユーザーがブラウザ設定で許可を変えると live に更新されます。

### 3. 追加メンバーを取る descriptor

一部の権限は名前だけでは足りません。対応するブール属性を使います:

```html
<!-- push: query({ name: "push", userVisibleOnly: true }) -->
<wcs-permission name="push" user-visible-only data-wcs="state: pushPerm"></wcs-permission>

<!-- midi: query({ name: "midi", sysex: true }) -->
<wcs-permission name="midi" sysex data-wcs="state: midiPerm"></wcs-permission>
```

### 4. 監視役と取得役を並置する

`<wcs-permission>` が監視し、`<wcs-geo>` が要求する。ボタンが駆動するのは機能ノードで、permission ノードではありません。

```html
<wcs-permission name="geolocation" data-wcs="granted: granted; denied: denied"></wcs-permission>
<wcs-geo manual data-wcs="command.getCurrentPosition: $command.locate; latitude: lat"></wcs-geo>

<button data-wcs="onclick: locate; disabled: denied">現在地を取得</button>
```

完全なデモは `examples/state-permission-banner` を参照。

## 属性 / 入力

| 属性                | 型      | 既定値 | 説明                                                                 |
| ------------------- | ------- | ------ | -------------------------------------------------------------------- |
| `name`              | string  | `""`   | query する権限名（例: `geolocation`、`notifications`、`camera`）。必須 — 空の `name` は query せず `state = "unsupported"` に倒れます。 |
| `user-visible-only` | boolean | `false`| descriptor に `userVisibleOnly: true` を追加（`push` 権限用）。       |
| `sysex`             | boolean | `false`| descriptor に `sysex: true` を追加（`midi` 権限用）。                 |

## 観測可能プロパティ（出力）

| プロパティ    | イベント               | 説明                                                                |
| ------------- | ---------------------- | ------------------------------------------------------------------- |
| `state`       | `wcs-permission:change`| `"prompt"` / `"granted"` / `"denied"` / `"unsupported"`、live 追従。 |
| `granted`     | `wcs-permission:change`| `state === "granted"` のとき `true`。`hidden@granted` 等に便利。     |
| `denied`      | `wcs-permission:change`| `state === "denied"` のとき `true`。                                |
| `prompt`      | `wcs-permission:change`| `state === "prompt"` のとき `true`。                                |
| `unsupported` | `wcs-permission:change`| この環境で query できないとき `true`。                              |

5 つすべては単一の `wcs-permission:change` イベントから派生します（ブール群は `state` と連動）。

## コマンド

**無し。** Permissions API は read-only で、呼ぶべき `request()` がありません。許可の取得は機能ノードの責務（例: `<wcs-geo>` の `getCurrentPosition`）です。`<wcs-permission>` は純粋なモニタです。

## 注意・制限

- **属性は接続時に読み取り、監視はしない。** `<wcs-permission>` は `observedAttributes` / `attributeChangedCallback` を実装しません。descriptor（`name` ＋追加メンバー）は接続時に固定され、接続後に `name` を命令的に変えても再 query しません。別の権限を監視するには別要素を使う（または再接続する）。
- **再接続で再 query。** 要素を取り外して再挿入すると `connectedCallback` が再実行され、query を再発行して `change` を再購読します（切断時に購読を解除するのと対称）。切断時にまだ解決していない in-flight な query は無効化され、その後に解決しても `state` を更新せず `change` リスナーも張りません。したがって素早い 切断→再接続 でも古い購読が残ることはありません。
- **SSR（`@wcstack/server`）。** `static hasConnectedCallbackPromise = true` を宣言し `connectedCallbackPromise` を公開するため、サーバレンダラは接続時 query の settle を待ってからスナップショットします。
- **サイレント失敗処理（zero-log）。** wcstack のゼロ依存方針に沿い、`<wcs-permission>` はログも例外も出しません。Permissions API が無い場合、権限名が拒否される場合、`name` 属性が未指定/空の場合はいずれも静かに `state = "unsupported"` に解決します。`unsupported`（または `state`）をバインドして反応してください。

## `:state()` による CSS スタイリング

`<wcs-permission>` は相互排他な 4 つの出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `granted` | `wcs-permission:change` が `"granted"` で発火 |
| `denied` | `wcs-permission:change` が `"denied"` で発火 |
| `prompt` | `wcs-permission:change` が `"prompt"` で発火 |
| `unsupported` | `wcs-permission:change` が `"unsupported"` で発火 |

この 4 つは**相互排他**です。1 回の `wcs-permission:change` イベントで 4 つ全てが
同時に更新されるため、常にどれか 1 つだけが on になります。

```css
wcs-permission:state(denied) ~ .fallback { display: block; }
wcs-permission:state(granted) ~ .fallback { display: none; } /* デフォルト */
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-permission>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-permission:not(:defined)` と
組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["granted"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-granted` / `data-wcs-state-denied` / `data-wcs-state-prompt` /
  `data-wcs-state-unsupported` 属性にミラーします。
  Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-permission name="geolocation" debug-states></wcs-permission>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## ヘッドレス利用（`PermissionCore`）

Core は DOM 非依存で、`@wc-bindable/core` の `bind()` と直接使えます:

```typescript
import { PermissionCore } from "@wcstack/permission";

const perm = new PermissionCore({ name: "geolocation" });
perm.addEventListener("wcs-permission:change", (e) => {
  console.log((e as CustomEvent).detail); // "prompt" | "granted" | "denied" | "unsupported"
});

await perm.ready;        // 初回 query が settle 済み
console.log(perm.granted);

// 後始末:
perm.dispose();          // live な `change` リスナーを外す
```

## ライセンス

MIT
