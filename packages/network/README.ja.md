# @wcstack/network

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/network` は wcstack エコシステム向けのヘッドレスな Network Information コンポーネントです。

視覚的な UI ウィジェットではありません。
`@wcstack/permission` がパーミッション許可状態をリアクティブな state に変えるのと同じように、ブラウザの回線品質シグナルをリアクティブな state に変える **非同期プリミティブノード** です。

`@wcstack/state` と組み合わせると、`<wcs-network>` はパス契約で直接バインドできます:

- **入力サーフェス**: 無し — `navigator.connection` は設定すべきものを持たない単一のグローバル
- **出力 state サーフェス**: `effectiveType`、`downlink`、`rtt`、`saveData`、`supported`

これにより、適応的な読み込み制御（低速回線時の画像品質低下、データセーバー時の自動再生停止）を、UI 層で `navigator.connection` や `change` リスナーの配線を書かずに、HTML 上で宣言的に表現できます。

`@wcstack/network` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core**（`NetworkCore`）が `navigator.connection` を読み取り、live な `change` イベントを追従
- **Shell**（`<wcs-network>`）がその state を DOM ライフサイクルに接続
- **Binding Contract**（`static wcBindable`）が観測可能な `properties` を宣言（そして意図的に **コマンドも属性も持たない**）

## なぜ存在するか — wcstack で最小の Shell、そして unsupported が常態

他の wcstack IO ノードはいずれも何かしらを設定する（`target`、`name`、`url`）。`navigator.connection` は指し示す対象を持たない単一のグローバルオブジェクトなので、`<wcs-network>` は **属性を一切持ちません**。

さらに重要な点として、**Firefox と Safari は `navigator.connection` を実装していません。** 大半の IO ノードでは unsupported は稀なフォールバックですが、本ノードでは多くのユーザーにとって既定の現実です。「発火すれば使う、発火しなければ既定の挙動にフォールバックする」という漸進的強化を前提に UI を設計してください。このデータが必ず得られる前提で組んではいけません。

> **secure context 不要。** `@wcstack/geolocation` や `@wcstack/permission` と異なり、Network Information API に secure-context 制約はありません。

## インストール

```bash
npm install @wcstack/network
```

## クイックスタート

### 1. 回線品質に応じた画像品質の切り替え

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/network/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      effectiveType: null,
      get lowQuality() {
        return this.effectiveType === "2g" || this.effectiveType === "slow-2g";
      },
      get imgSrc() {
        return this.lowQuality ? "/thumb.jpg" : "/full.jpg";
      },
      // 初回スナップショットはバインド確立前に発火するため、一度だけ pull する（「注意・制限」参照）。
      async $connectedCallback() {
        await customElements.whenDefined("wcs-network");
        this.effectiveType = document.querySelector("wcs-network").effectiveType;
      },
    };
  </script>
</wcs-state>

<wcs-network data-wcs="effectiveType: effectiveType"></wcs-network>

<img data-wcs="attr.src: imgSrc">
```

このページの全例に共通するタイミング規則が1つあります: `<wcs-network>` はスナップショットを `wcs-network:change` イベントで公開しますが、*初回*のスナップショットは接続時に同期発火するため、`@wcstack/state` がバインドリスナーを張るより先に流れてしまい、バインドしたパスは*次*の回線変化からしか更新されません。上の `$connectedCallback` ブロックはその初回スナップショットを一度だけ pull しています。これが無いと、読込時点で既に低速回線だった場合にページが適応しません（「注意・制限」参照）。

### 2. データセーバーを尊重する

```html
<wcs-state>
  <script type="module">
    export default {
      saveData: null,
      // 例1と同じ初期 pull — 読込時点で既にデータセーバーONの場合があるため。
      async $connectedCallback() {
        await customElements.whenDefined("wcs-network");
        this.saveData = document.querySelector("wcs-network").saveData;
      },
    };
  </script>
</wcs-state>

<wcs-network data-wcs="saveData: saveData"></wcs-network>
<video data-wcs="autoplay: saveData|falsy" muted loop></video>
```

`saveData` は `boolean | null`（未知・非対応の間は `null`）なので、boolean 限定の `|not` ではなく null 許容の `|falsy` フィルタを使います: データセーバーが有効と*判明*しない限り autoplay を維持する、という漸進的強化の既定動作になります。`autoplay` を `attr.autoplay` でなくプロパティとしてバインドしているのは、boolean content attribute は属性バインドでは無効化（属性削除）できないためです。

### 3. 非対応環境では回線品質 UI を隠す

```html
<wcs-state>
  <script type="module">
    export default {
      netSupported: false,
      effectiveType: null,
      async $connectedCallback() {
        await customElements.whenDefined("wcs-network");
        const net = document.querySelector("wcs-network");
        this.netSupported = net.supported;
        this.effectiveType = net.effectiveType;
      },
    };
  </script>
</wcs-state>

<wcs-network data-wcs="supported: netSupported; effectiveType: effectiveType"></wcs-network>
<div data-wcs="hidden: netSupported|not">回線: <span data-wcs="textContent: effectiveType"></span></div>
```

バインドする state パスは必ず事前に宣言してください — 未宣言パスへのバインドは初期化時に例外になります。例2の `saveData` と異なり `supported` は厳密な boolean（`null` になり得ない）なので、ここでは `|not` が安全です。この例では初期 pull が*必須*です: `supported` は接続時に一度だけ確定し、安定した回線では以後 `change` が二度と発火しないため、pull が無いと対応ブラウザでも UI が永久に隠れたままになります。非対応ブラウザでは pull が `false` を読むだけなので、UI はそのまま隠れ続けます。

## 観測可能プロパティ（出力）

| プロパティ       | イベント             | 説明 |
| ---------------- | -------------------- | ---- |
| `effectiveType`  | `wcs-network:change` | `"slow-2g"` / `"2g"` / `"3g"` / `"4g"`、非対応環境では `null`。 |
| `downlink`       | `wcs-network:change` | 概算ダウンリンク帯域（Mbps）、非対応環境では `null`。 |
| `rtt`            | `wcs-network:change` | 概算往復遅延（ms）、非対応環境では `null`。 |
| `saveData`       | `wcs-network:change` | ユーザーがデータセーバーモードを有効にしていれば `true`、非対応環境では `null`。 |
| `supported`      | `wcs-network:change` | 実在する `navigator.connection` が見つかれば `true`、それ以外は `false`。 |

5 つすべては単一の `wcs-network:change` イベントから派生します（ネイティブ API が全フィールドを1つの `change` イベントで報告するのと同じく、スナップショット全体を1つのイベントにまとめて発火します）。また、`supported` が `true` の環境でも、ブラウザが該当フィールドを欠落または期待外の型で報告した場合、4 つのデータフィールドは個別に `null` へ正規化されます。

`downlinkMax` と接続種別（wifi/cellular等）の `type` は意図的に公開していません — 理由は `docs/network-tag-design.md` §2 を参照（実用上の使用例が乏しい、`type` はfingerprinting対策によりブラウザ間で信頼性が低い）。

## コマンド

**無し。** `navigator.connection` は read-only で、呼ぶべきアクションがありません。`<wcs-network>` は純粋なモニタです。

## 属性 / 入力

**無し。** `navigator.connection` は単一のグローバルであり、インスタンスごとに設定すべきものがありません。

## 注意・制限

- **Firefox と Safari は `navigator.connection` を実装していません。** これらのブラウザでは `supported` は `false` のまま、他の4プロパティは `null` のままです — これを例外ケースでなく常態として設計してください。
- **初回スナップショットはバインドに届きません。** 最初の `wcs-network:change` は `connectedCallback` 中に同期発火しますが、`@wcstack/state` のバインドリスナー確立はそれより後です（バインド構築は後続の microtask に遅延 — `docs/timing-and-firing-contract.md` §4.1 参照）。イベントは後から購読した相手に再送されないため、バインドしたパスは*次*の回線変化からしか更新されません。初期値が重要な場合（`supported` と `saveData` ではほぼ常に重要）は、クイックスタートの各例のように `$connectedCallback` で一度だけ pull してください。これは全 monitor ノード共通の wc-bindable イベント契約の性質であり、本パッケージ固有の癖ではありません。
- **`_gen` 世代ガードが無い。** 他の大半の wcstack IO ノードと異なり、`navigator.connection` の `change` イベント購読・購読解除は完全に同期的です。dispose() とレースしうる非同期probeの解決が存在しません。詳細は `docs/network-tag-design.md` §5。
- **再接続で再購読。** 要素を取り外して再挿入すると、切断時に `change` リスナーを解除し、再接続時に（その時点の `navigator.connection` に対して）再確立します。
- **SSR（`@wcstack/server`）。** `static hasConnectedCallbackPromise = true` を宣言し `connectedCallbackPromise` を公開しますが、`observe()` が同期的なため、この promise は常に即座に settle します。
- **同値ガード。** ブラウザが万一同じ値で `change` を重複発火しても、フィールド単位の防御的比較により冗長な dispatch を抑止します。

## `:state()` による CSS スタイリング

`<wcs-network>` は 2 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `save-data` | `wcs-network:change` が `saveData === true` で発火（`saveData` が `null`＝非対応の場合も含め off） |
| `supported` | `wcs-network:change` が `supported === true` で発火（`supported === false` で off） |

`effectiveType` / `downlink` / `rtt` は反映されません — 理由は `docs/custom-state-reflection-design.md` §3.2（連続値・高頻度値は `:state()` 反映の対象外）を参照してください。

```css
wcs-network:state(supported) ~ .connection-badge { display: block; }
wcs-network:not(:state(supported)) ~ .connection-badge { display: none; } /* デフォルト */

form:has(wcs-network:state(save-data)) .low-res-hint { display: block; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-network>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-network:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["supported"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-save-data` / `data-wcs-state-supported` 属性にミラーします。
  Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-network debug-states></wcs-network>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## ヘッドレス利用（`NetworkCore`）

Core は DOM 非依存で、`@wc-bindable/core` の `bind()` と直接使えます:

```typescript
import { NetworkCore } from "@wcstack/network";

const net = new NetworkCore();
net.addEventListener("wcs-network:change", (e) => {
  console.log((e as CustomEvent).detail); // { effectiveType, downlink, rtt, saveData, supported }
});

net.observe();           // 同期的 — データ取得にpromiseを待つ必要は無い
console.log(net.effectiveType);

// 後始末:
net.dispose();           // live な `change` リスナーを外す
```

## ライセンス

MIT
