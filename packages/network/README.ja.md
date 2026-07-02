# @wcstack/network

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
    };
  </script>
</wcs-state>

<wcs-network data-wcs="effectiveType: effectiveType"></wcs-network>

<img data-wcs="src.attr: lowQuality|iif('/thumb.jpg','/full.jpg')">
```

### 2. データセーバーを尊重する

```html
<wcs-network data-wcs="saveData: saveData"></wcs-network>
<video data-wcs="autoplay.attr: !saveData" muted loop></video>
```

### 3. 非対応環境では回線品質 UI を隠す

```html
<wcs-network data-wcs="supported: netSupported; effectiveType: effectiveType"></wcs-network>
<div data-wcs="hidden: !netSupported">回線: <span data-wcs="textContent: effectiveType"></span></div>
```

## 観測可能プロパティ（出力）

| プロパティ       | イベント             | 説明 |
| ---------------- | -------------------- | ---- |
| `effectiveType`  | `wcs-network:change` | `"slow-2g"` / `"2g"` / `"3g"` / `"4g"`、非対応環境では `null`。 |
| `downlink`       | `wcs-network:change` | 概算ダウンリンク帯域（Mbps）、非対応環境では `null`。 |
| `rtt`            | `wcs-network:change` | 概算往復遅延（ms）、非対応環境では `null`。 |
| `saveData`       | `wcs-network:change` | ユーザーがデータセーバーモードを有効にしていれば `true`、非対応環境では `null`。 |
| `supported`      | `wcs-network:change` | 実在する `navigator.connection` が見つかれば `true`、それ以外は `false`。 |

5 つすべては単一の `wcs-network:change` イベントから派生します（ネイティブ API が全フィールドを1つの `change` イベントで報告するのと同じく、スナップショット全体を1つのイベントにまとめて発火します）。

`downlinkMax` と接続種別（wifi/cellular等）の `type` は意図的に公開していません — 理由は `docs/network-tag-design.md` §2 を参照（実用上の使用例が乏しい、`type` はfingerprinting対策によりブラウザ間で信頼性が低い）。

## コマンド

**無し。** `navigator.connection` は read-only で、呼ぶべきアクションがありません。`<wcs-network>` は純粋なモニタです。

## 属性 / 入力

**無し。** `navigator.connection` は単一のグローバルであり、インスタンスごとに設定すべきものがありません。

## 注意・制限

- **Firefox と Safari は `navigator.connection` を実装していません。** これらのブラウザでは `supported` は `false` のまま、他の4プロパティは `null` のままです — これを例外ケースでなく常態として設計してください。
- **`_gen` 世代ガードが無い。** 他の大半の wcstack IO ノードと異なり、`navigator.connection` の `change` イベント購読・購読解除は完全に同期的です。dispose() とレースしうる非同期probeの解決が存在しません。詳細は `docs/network-tag-design.md` §5。
- **再接続で再購読。** 要素を取り外して再挿入すると、切断時に `change` リスナーを解除し、再接続時に（その時点の `navigator.connection` に対して）再確立します。
- **SSR（`@wcstack/server`）。** `static hasConnectedCallbackPromise = true` を宣言し `connectedCallbackPromise` を公開しますが、`observe()` が同期的なため、この promise は常に即座に settle します。
- **同値ガード。** ブラウザが万一同じ値で `change` を重複発火しても、フィールド単位の防御的比較により冗長な dispatch を抑止します。

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
