# 設計メモ: `@wcstack/network`（`<wcs-network>`）

- **状態**: 実装済み。本文書は実装前に行った論点整理と決定事項のスナップショットであり、実装後も設計意図の参照用に保持している。以降の `hidden@slowConnection` / `hidden@!supported` 等の `@` 表記は説明用の擬似記法であり、実際の `data-wcs` 構文ではない点に注意（`!` 否定は state に存在せず、実装では `|not` フィルタを使う。README.md/README.ja.md 参照）。
- **対象 WebAPI**: Network Information API（`navigator.connection`、`NetworkInformation` の `change` イベント）
- **位置づけ**: [io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) バッチ4（最小monitorパターン）の1本目。バッチ内で最も実装リスクが低い候補として最初の着手対象に選定済み。
- **前提資産**: `permission`（単一イベント→派生getter、`_permGen`世代ガード、unsupportedフォールバック、Core/Shell分離）。ただし本ノードは非同期probeを持たないため`_permGen`相当の世代ガードが**不要**という重要な差異がある（§5）。

---

## 0. 大前提: 「賭け」の性質を持つノード — unsupportedが常態

他の候補（permission/geolocation等）は「対応ブラウザが大半で、unsupportedは例外的なフォールバック」だが、Network Information API は**Firefox・Safariが最初から`navigator.connection`を実装していない**。Chromium系（Chrome/Edge/Opera/Samsung Internet）限定であり、モバイルSafariユーザー・Firefoxユーザーにとっては**常にunsupported**である。

| | `permission` | `<wcs-network>` |
|---|---|---|
| unsupportedの位置づけ | 稀な例外（対応ブラウザが大半） | **常態**（主要ブラウザの一角が最初から未実装） |
| 設計への含意 | フォールバック処理で足りる | **「動けば儲けもの」の漸進的強化としてのみ設計してよい**。README・exampleは常にunsupported時の既定動作（良好な接続を仮定する等）を示す |

この前提が以降の全論点を規定する。「効くブラウザでは効く、効かないブラウザでは何もしない」以上の期待を持たせない設計にする。

---

## 1. 存在意義

- **適応的な読み込み制御**（adaptive loading）: `effectiveType`が`"2g"`/`"slow-2g"`の時に画像品質を落とす・プリフェッチを止める、`saveData`が`true`の時に自動再生動画を止める、といった宣言的な出し分け（`hidden@slowConnection`のような派生bindingを想定）
- **既存ノードとの組み合わせ**: `<wcs-fetch>`の`url`をcomputedにし、`saveData`に応じて低解像度APIエンドポイントに切り替える、といった構成が自然に書ける
- 対応していないブラウザでは常に既定値（「良好な接続」を仮定）にフォールバックするため、**壊れるのではなく「何もしない」**という漸進的強化の教材にもなる

---

## 2. 公開するstateの範囲 — **決定: 4フィールドに限定**

`NetworkInformation`には`effectiveType` / `downlink` / `downlinkMax` / `rtt` / `saveData` / `type`（wifi/cellular/ethernet等の物理接続種別）が存在するが、初版では以下4つに絞る。

| フィールド | 採用 | 理由 |
|---|---|---|
| `effectiveType` | ✅ | 実用上最も使われる指標（"slow-2g"/"2g"/"3g"/"4g"）。対応も比較的安定 |
| `downlink` | ✅ | 概算帯域（Mbps）。品質切り替えの閾値判定に使える |
| `rtt` | ✅ | 概算往復遅延（ms） |
| `saveData` | ✅ | データセーバーモードのON/OFF。ユーザーの明示的意図を反映する最も信頼できるシグナル |
| `downlinkMax` | ❌ 除外 | 実用上の使用例が乏しく、初版のスコープ外 |
| `type` | ❌ 除外 | 対応がさらに不安定（fingerprinting対策でブラウザによって意図的に粗い値/非公開にされている）。指標としての信頼性が低く初版から外す |

---

## 3. 単一イベント構造 — **決定: 全フィールドを1つの`change`イベントにまとめる**

`permission`の「1プロパティ→複数派生getter」と対称的に、本ノードは「複数フィールド→1つのイベント」という§4.2の典型形になる。

```typescript
static wcBindable: IWcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "effectiveType", event: "wcs-network:change", getter: e => e.detail.effectiveType },
    { name: "downlink",      event: "wcs-network:change", getter: e => e.detail.downlink },
    { name: "rtt",           event: "wcs-network:change", getter: e => e.detail.rtt },
    { name: "saveData",      event: "wcs-network:change", getter: e => e.detail.saveData },
    { name: "supported",     event: "wcs-network:change", getter: e => e.detail.supported },
  ],
  commands: [],
};
```

- ネイティブの`navigator.connection`は単一の`change`イベントで全フィールドの変化を通知する実装なので、Core側もこれに倣い**スナップショットを1つのCustomEventにまとめて発火**する（個別フィールドごとのイベントに分解しない）
- `supported`（後述§5）も同じイベントに同居させ、`hidden@!supported`（擬似記法。実構文は`hidden: supported|not`）のような条件分岐を1本のbindingで書けるようにする

---

## 4. 同値ガードの単位 — **決定: スナップショット全体の比較**

ネイティブAPIの`change`イベントはブラウザ側が「実際に変化した時だけ」発火する契約だが、ガイドライン§3.3のMUSTを満たすため、Core側でも防御的にスナップショット全体（`{effectiveType, downlink, rtt, saveData}`。実装では§6で追加された`supported`を含む**5フィールド**を比較）を浅い比較し、フィールド単位ではなく**丸ごと同一なら再dispatchしない**。フィールドごとの個別追跡は行わない（実装を複雑にする割に実利が薄い）。

---

## 5. `_gen`世代ガードは不要 — **既存パターンとの重要な差異**

`permission`/`geolocation`等の`_permGen`は「非同期`query()`がdispose後に解決してtorn-down要素へ書き込む」レースを防ぐためのもの。本ノードは:

- `navigator.connection`の取得も`addEventListener('change', ...)`の購読も**完全に同期**
- 解決を待つ非同期probeが一切存在しない

ため、§3.4の`_gen`世代ガードが対象とする「非同期処理の古い世代が生き残る」状況がそもそも発生しない。**`_gen`フィールド自体を持たない**（もしくは将来の一貫性のためだけに`0`固定で残すかは実装時に判断、実質的な意味は無い）。`ready`は`fetch`/`upload`同様、非同期probeが無いため`Promise.resolve()`固定。

この点は本ノードがバッチ4の中でも「最も薄い」ことの直接的な理由であり、最初の着手対象に選んだ根拠でもある。

---

## 6. unsupported判定とAPI解決 — **決定: 呼び出し時解決＋明示的`supported`フラグ**

```typescript
private _api(): NetworkInformation | undefined {
  const nav = globalThis.navigator as any;
  return (typeof nav !== "undefined" && nav.connection) ? nav.connection : undefined;
}
```

- §3.7 MUSTに従い、コンストラクタでキャッシュせず`observe()`の都度解決する
- `permission`の4値`state`のような段階的な状態は無い（これは「対応/非対応」の二値問題であり、権限のプロンプト・拒否のような遷移が存在しない）ため、**`supported: boolean`という単純な派生プロパティ**を1つ追加するだけで足りる
- unsupported時: `effectiveType`/`downlink`/`rtt`/`saveData`は全て`null`固定、`supported`は`false`

---

## 7. secure-context — **決定: 制約なし**

`geolocation`/`permission`のようなsecure-context必須の制約はNetwork Information APIには無い。README/設計上、他ノードのような「HTTPS必須」の注記は不要。

---

## 8. commands / autoTrigger — **決定: 無し（純粋monitor）**

- `navigator.connection`に副作用を起こすメソッドは存在しない（読み取り専用）。`permission`と同じく`commands: []`
- autoTriggerも該当しない（起動すべきアクションが無い）

---

## 9. Shell属性 — **決定: 属性なし（バッチ中最小のShell）**

`permission`は`name`（必須）＋descriptor系属性を要したが、`navigator.connection`はグローバルに1つしか存在せず、監視対象を指定するパラメータが一切無い。

- **`<wcs-network>`は属性を持たない**。`connectedCallback`で無条件に購読を開始するだけ
- `inputs: []`。バッチ4の中でも最も単純な形になる

---

## 10. テスト方針（happy-dom）

happy-domは`navigator.connection`を持たないため全モック。

- `FakeNetworkInformation extends EventTarget`に`effectiveType`/`downlink`/`rtt`/`saveData`を可変プロパティとして持たせ、`change`イベントを手動発火できるヘルパを用意
- `navigator.connection`はネイティブ環境では読み取り専用の場合があるため、`Object.defineProperty(navigator, "connection", { value: fake, configurable: true })`でinstall/remove
- 観点:
  - `navigator.connection`不在時に`supported: false`・各フィールド`null`
  - `change`発火で全フィールドが更新され、1つの`wcs-network:change`イベントで観測できる
  - 同値（全フィールド不変）の`change`連続発火で再dispatchされない（§4の同値ガード）
  - dispose後に`change`リスナーが解除されていること（購読解除の確認、`_gen`相当の世代ガードが無いため、ここは素直なlistener removeの確認で足りる）
  - observe()の冪等性（二重呼び出しでlistenerが二重登録されない）

---

## 11. 決定事項まとめ

| 論点 | 決定 |
|---|---|
| §2 公開state | `effectiveType` / `downlink` / `rtt` / `saveData` の4フィールド（`downlinkMax`/`type`は除外） |
| §3 イベント構造 | 1つの`wcs-network:change`にスナップショット全体を載せる |
| §4 同値ガード | スナップショット全体の浅い比較 |
| §5 `_gen`世代ガード | **不要**（非同期probeが存在しないため） |
| §6 unsupported | 呼び出し時解決＋`supported: boolean`派生プロパティ |
| §7 secure-context | 制約なし |
| §8 commands/autoTrigger | 無し（純粋monitor） |
| §9 Shell属性 | 無し（バッチ中最小） |
| パッケージ/タグ | `@wcstack/network` / `<wcs-network>` / Shell `WcsNetwork` |

---

## 12. 実装順の推奨

1. `NetworkCore`（`_api()`呼び出し時解決＋スナップショット比較＋`change`購読）。`_gen`が不要な分、`permission`より実装量は小さい
2. Shell `<wcs-network>`（属性無し、`display:none`、connect時に無条件購読）
3. Fake double（`FakeNetworkInformation`）とテスト一式
4. example: 「低速回線時に画像を`loading`プレースホルダーに切り替える」を目玉に。`hidden@!supported`（擬似記法。実構文は`hidden: supported|not`）で非対応ブラウザでは要素ごと隠す例も併記し、「常態としてのunsupported」という§0の前提を実演する
5. README ja/en（対応ブラウザの限定・secure-context不要・常にフォールバック前提で設計すべき旨を明記）
