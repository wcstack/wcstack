# 設計メモ: `@wcstack/tilt`（`<wcs-tilt>`）

- **状態**: 実装済み（`packages/tilt`、`@wcstack/tilt`）。本文書は実装前の論点整理と決定事項のスナップショットとして書かれたが、実装後もおおむね本書の決定通り。逸脱事項: (1) §3 の擬似コードにあった `_setError` は初版実装から欠落していたが、品質レビューで是正し `error`/`wcs-tilt:error` を公開状態に追加した（§2/§9 反映済み）。(2) §10.4 の「水準器 UI」example は未作成（スコープ外、README の Quick Start が最小例を兼ねる）。
- **対象 WebAPI**: Device Orientation API（`window` への `'deviceorientation'` イベント、`event.alpha`/`.beta`/`.gamma`/`.absolute`）。iOS 13+ Safari では加えて静的 `DeviceOrientationEvent.requestPermission()`（Promise、要 user gesture）。Device Motion（`'devicemotion'`）は同型の gesture-gate 問題を共有するが、本書は Orientation を主眼に記述する（Motion は別タグ `<wcs-motion>` として同一パターンで後続実装する想定、[io-node-candidate-implementation-notes.md](./io-node-candidate-implementation-notes.md) #6 参照）。
- **位置づけ**: [io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) バッチ2（gesture-gated permission パターン）の2本目。`<wcs-idle>`（[idle-detection-tag-design.md](./idle-detection-tag-design.md)）と同じ「静的で user gesture 文脈が必須の `requestPermission()` command を公開する」という共有アーキタイプに乗るが、**permission 状態を自前で追跡せざるを得ない**という亜種であることが最大の特徴。
- **前提資産**: `permission`（4値 permission state・Core/Shell 分離・never-throw・secure-context 明記）、`<wcs-idle>`（同一バッチの先行実装、gesture-gated `requestPermission()` の参照実装）。

---

## 0. 大前提: このノードは `<wcs-permission>` と合成できない — だから自前で追跡するしかない

[idle-detection-tag-design.md](./idle-detection-tag-design.md) §0 で確立した「機能ノードが request し、permission ノードが observe する」という合成パターン（[permission-tag-design.md](./permission-tag-design.md) §0 の再帰的適用）は、Device Orientation/Motion には**適用できない**。

理由は明確な非対称性にある。Idle Detection には `navigator.permissions.query({name: "idle-detection"})` という Permissions API 上のエントリが実在し、`<wcs-permission>` がそれを監視できた。Device Orientation/Motion には、これに相当する Permissions API のエントリが**存在しない**。iOS Safari 固有の `DeviceOrientationEvent.requestPermission()` は、それ自身が呼ばれて初めて許可状態を確定させる独立した静的メソッドであり、その結果（`"granted"` / `"denied"`）は `IdleDetector` の場合と異なり `navigator.permissions.query()` から外部的に問い合わせる手段が無い。ブラウザ内部にしか許可状態が存在せず、**唯一の手がかりは `requestPermission()` 自身の戻り値だけ**である。

| | `<wcs-idle>` / Idle Detection | `<wcs-tilt>` / Device Orientation |
|---|---|---|
| 対応する Permissions API エントリ | あり（`{name: "idle-detection"}`） | **なし** |
| permission 状態の問い合わせ手段 | `<wcs-permission>` から独立して何度でも監視できる | **`requestPermission()` の戻り値だけ**が唯一の手がかり |
| 状態追跡の実装 | `<wcs-permission name="idle-detection">` に委譲、`<wcs-idle>` 自身は持たない | **`<wcs-tilt>` がローカルに保持・公開するしかない** |
| 合成できるか | できる（§0 参照） | **できない** |

**決定 1（ローカル追跡）**: `<wcs-tilt>` は `permissionState` を自前のプロパティとして持つ。`requestPermission()` が resolve した値（`"granted"` / `"denied"`）、またはそもそも gating が存在しないブラウザでの既定値（§3）を Core 内部の private フィールドに保持し、`wcs-tilt:permission-changed` イベントで publish する。これは `<wcs-permission>` との重複実装ではなく、**代替手段が存在しないための已むを得ない対応**である。

> `<wcs-idle>` 側ドキュメントでは「なぜ状態追跡を重複させないか」を論じたが、本ノードでは逆に「なぜ同じ手（他ノードへの委譲）が使えないか」が第一級の設計論点になる。この対比は [io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) §バッチ2 が「バッチとして揃えられない部分」と明記した通りであり、バッチ内の2ノードが「合成パターンの確立」と「合成できない場合のローカル追跡」という対の実例を成す。

---

## 1. 存在意義 — 何を解決するノードか

- **デバイスの傾き・向きに応じた宣言的な UI 変化**: パララックス演出、水準器アプリ、ゲームのステアリング入力、VR/AR 風の視点操作などを `alpha`/`beta`/`gamma` の束縛だけで実現する。
- **iOS の gesture-gate を隠蔽する定型パターンの提供**: iOS 13+ Safari では明示的なユーザー操作なしに `deviceorientation` イベントを購読しても値が一切飛んでこない（無音で失敗する）。この差異を吸収し、「対応していればそのまま動く／iOS では明示ボタンが要る」という分岐を宣言的な `permissionState` 監視だけで扱えるようにする。
- **既存ノードとの組み合わせ**: `hidden: permissionState|ne(granted)`（iOS で許可されるまでは傾き演出用の要素を隠す。`data-wcs` は `prop: path|filter` 形式——`@` はプロパティ側の否定演算子ではなく `path@stateName` の状態インスタンス指定、`!` 先頭否定は存在しない構文なので、実際に動く例は `eq`/`ne` フィルタで表す）、`<wcs-idle>` と並べて「gesture-gated permission パターン」の2つ目の実例として README を相互参照させる。

---

## 2. 公開する state

```typescript
static wcBindable: IWcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "alpha",          event: "wcs-tilt:change" },
    { name: "beta",           event: "wcs-tilt:change" },
    { name: "gamma",          event: "wcs-tilt:change" },
    { name: "absolute",       event: "wcs-tilt:change" },
    { name: "permissionState", event: "wcs-tilt:permission-changed" },
    { name: "error", event: "wcs-tilt:error" },
  ],
  inputs: [],
  commands: [
    { name: "requestPermission", async: true },
    { name: "start" },
    { name: "stop" },
  ],
};
```

- `alpha` / `beta` / `gamma`: ネイティブ `DeviceOrientationEvent` の同名フィールドをそのまま publish（単位は度）。3つとも同じ `wcs-tilt:change` イベントに載せ、1回の `deviceorientation` 発火につき1回だけ dispatch する（`network` の「複数フィールド→1つのイベント」という構造、[network-tag-design.md](./network-tag-design.md) §3 と同型）。
- `absolute`: `event.absolute` の単純な boolean パススルー（§7 で詳述）。
- `permissionState`: `"granted" | "denied" | "unknown"` の3値。**geo/permission/idle が採用する4値（`prompt`/`granted`/`denied`/`unsupported`）とは意図的に異なる語彙**にする。理由: Device Orientation の gating はブラウザによって「そもそも存在しない」（＝問い合わせる概念自体が無い）ケースが大半で、これは Permissions API の `"unsupported"`（API はあるが対象権限を認識しない）とは意味が異なる。「gating が無いのでプロンプト自体が発生しない」ことを表すのに `"unknown"` を使う（§3 で詳述、非 iOS ブラウザの既定値）。`"prompt"` は使わない——iOS で `requestPermission()` を呼ぶ前の状態を表すのに使いたくなるが、呼ぶ前は単に「まだ聞いていない」だけであり、ブラウザ側に確認可能な `"prompt"` 状態が存在するわけではないため、紛らわしさを避けて初期値も `"unknown"` に統一する。
- `permissionState` は独立イベント `wcs-tilt:permission-changed` で publish する（`alpha`/`beta`/`gamma`/`absolute` の高頻度な `wcs-tilt:change` とは別イベント。permission 状態は低頻度で意味のある変化だけなので、混ぜると `hidden: permissionState|eq(granted)` のような束縛のたびに無関係な傾き変化まで再評価されるコストが生じる）。
- `error`: never-throw（[async-io-node-guidelines.md](./async-io-node-guidelines.md) §3.6 MUST）に従い、`requestPermission()` の失敗（gesture 文脈外呼び出し等の reject）を例外で投げず `error` プロパティに流す。`<wcs-idle>` と同様、実際の失敗オブジェクトをそのまま保持し、`wcs-tilt:error` で publish する。同値ガードは参照比較（`===`）——新しい reject のたびに新規オブジェクトなので、失敗のたびに発火する（[timing-and-firing-contract.md](./timing-and-firing-contract.md) §8.4、screen-orientation §7.4 と同型）。例外なく settle した `requestPermission()`（granted / 素の denied / 非 gating 環境の即 granted）は stale な error を `null` にクリアする（idle の supersession と同じ）。§3 参照。

---

## 3. `requestPermission` — 正確なフォールバック挙動を決定

```typescript
async requestPermission(): Promise<string> {
  const DOE = (globalThis as any).DeviceOrientationEvent;
  if (typeof DOE?.requestPermission !== "function") {
    // gating が存在しないブラウザ（Android Chrome、デスクトップ全般など）。
    // 許可を求める概念自体が無いので、購読して構わないという意味で即 "granted" とする。
    this._setError(null);   // settle した結果は stale な error を supersede する（idle と同じ）
    this._setPermissionState("granted");
    return "granted";
  }
  try {
    const result: string = await DOE.requestPermission();   // "granted" | "denied"
    // 例外なく settle した結果——granted も素の "denied" も——は、
    // 以前の試行の stale な error（gesture 文脈外 reject 等）を supersede する。
    this._setError(null);
    this._setPermissionState(result === "granted" ? "granted" : "denied");
    return result;
  } catch (e) {
    // gesture文脈外呼び出し等のreject。never-throwでdeniedへ倒す。
    this._setError({ error: e });
    this._setPermissionState("denied");
    return "denied";
  }
}
```

**決定 2（フォールバック挙動）**: `typeof DeviceOrientationEvent?.requestPermission === "function"` で分岐する。

- **関数が存在する（iOS 13+ Safari）場合**: 実際に `DeviceOrientationEvent.requestPermission()` を呼び、その戻り値（`"granted"` / `"denied"`）をそのまま `permissionState` に反映する。gesture 文脈外からの呼び出しで reject した場合は never-throw で `"denied"` に倒す（`<wcs-idle>` の `requestPermission()` と同じ扱い、[idle-detection-tag-design.md](./idle-detection-tag-design.md) §4.1）。
- **関数が存在しない（Android Chrome・デスクトップ全般など、gating の無いブラウザ）場合**: 実際には「聞く」動作が起きないため、`requestPermission()` を呼んだその場で即座に `"granted"` として resolve する。これにより、利用者コードは「まず `requestPermission()` を呼んでから `start()` する」という単一のフローだけを書けばよく、iOS かどうかで呼び出し元のロジックを分岐させる必要が無くなる（gating の有無の吸収こそが本ノードの存在価値、§1）。

この正確な分岐（関数の有無で「実際に問い合わせる」か「即granted」かを切り替える）が、本ノードの中核ロジックである。

---

## 4. `start` / `stop`

```typescript
start(): void {
  this.stop();   // 二重購読防止（冪等）
  window.addEventListener("deviceorientation", this._onOrientation);
}

stop(): void {
  window.removeEventListener("deviceorientation", this._onOrientation);
}
```

- `start()`/`stop()` が管理する購読そのものは、Idle Detection の `start()`（`detector.start()` の await を伴う）と異なり**完全に同期**（`addEventListener` を張るだけで、待ち合わせる Promise が無い）。**この購読経路に限っては** `network`（[network-tag-design.md](./network-tag-design.md) §5）と同じ理由で `_gen` 世代ガードが不要——stale な resolve が torn-down 要素に書き込むレースがそもそも発生しない。
- ただし本ノードは `network` と異なり、`requestPermission()`（§3）という **async な probe を実際に持つ**（`await Ctor.requestPermission()`、[TiltCore.ts](../packages/tilt/src/core/TiltCore.ts)）。それでも `_gen` を要しないのは「非同期 probe が無いから」ではなく、その post-await 書き込みが `permissionState`/`error` という**購読・リソース管理を伴わないベニンな値設定＋dispatch**に留まるため。`_gen` が守るべきなのは「stale な非同期処理の完了が、生存中のリソース（購読・`AbortController` 等）や後続の呼び出しと衝突する」ケースであり、torn-down 要素への単純な値書き込みはその衝突を起こさない（`<wcs-idle>` の `requestPermission()` と同型の扱い、[idle-detection-tag-design.md](./idle-detection-tag-design.md) §4.1／本書 §2）。**訂正（品質レビュー）**: 初版は「非同期 probe が一切存在しないため」という `network` の理由をそのまま `_gen` 不要の根拠として流用していたが、これは事実誤認だった——`requestPermission()` という非同期 probe は存在する。結論（`_gen` 不要）自体は変わらないが、根拠は上記の「post-await 書き込みが benign」に置き換える。
- `dispose()` は `stop()` を呼ぶだけでよい。
- `start()` 自体は「許可されていない状態で呼んでも例外にはならない」（iOS では単にイベントが飛んでこないだけ、無音の失敗）。`start()` それ自体に never-throw 上の懸念は無いが、「許可される前に呼んでも無意味」という運用上の注意点は README に明記する（§6）。

---

## 5. secure context（HTTPS）必須 — network との対比

**決定 3**: Device Orientation/Motion API は secure context（HTTPS または `localhost`）を必須とする。非 secure context では `deviceorientation` イベント自体が発火しない（ブラウザによっては購読しても常に無音）。

この制約は `geolocation`/`permission` と同様だが、[network-tag-design.md](./network-tag-design.md) §7 が明記した「Network Information API には secure-context 制約が無い」とは対照的である。同じ「バッチ横断で共有される薄いmonitorパターン」であっても、secure-context 要否は**API ごとに個別に確認すべき**であり、「バッチ4/5等のノードに普遍的な話ではない」ことを本書で明示しておく。新規ノードを設計する際、既存の類似ノードの secure-context 要否をそのまま転用してはならない——各 Web API の仕様を個別に確認する必要がある、という教訓をここに記録する。

README には「HTTPS（または localhost）で配信されていない場合、`deviceorientation` イベントは発火しない。`permissionState` は `requestPermission()` を呼ばない限り `"unknown"` のまま変化しない——ただし gating の無いプラットフォームでは、非 secure context でもフォールバック（§3、[TiltCore.ts](../packages/tilt/src/core/TiltCore.ts) の関数不在分岐）が実際には何も問い合わせずに即 `"granted"` を返すため、`requestPermission()` は secure-context の検出手段にならない」旨を明記する。**訂正（品質レビュー）**: 初版のここの指示文言は「`permissionState` は `"unknown"` のまま変化しない」と無条件に書いており実装と不一致だった（gating 無しプラットフォームでは非 secure context でも `requestPermission()` が `unknown`→`granted` に変化させることを実行実証済み）。`<wcs-motion>` を同一パターンで後続実装する際（冒頭参照、詳細は [io-node-candidate-implementation-notes.md](./io-node-candidate-implementation-notes.md) #6）は、この訂正後の条件付き文言を転写すること。

---

## 6. connect 時の自動 `start()` — **決定: しない（`<wcs-idle>` と並行、ただし非iOSでは開いた問題）**

`<wcs-idle>` 側の決定（[idle-detection-tag-design.md](./idle-detection-tag-design.md) §6）と同じ理由で、`<wcs-tilt>` も `connectedCallback` での自動 `start()` は行わない。

**決定 4**: `connectedCallback` は `start()` を自動的に呼ばない。`start()` は `requestPermission()` の後、利用者が明示的に呼ぶ。

理由:

1. iOS では、許可前に `deviceorientation` を購読しても**確実に無音で失敗する**（イベントが一切飛んでこない）。gesture 文脈外の `connectedCallback` から自動購読しても得るものが無い。
2. `requestPermission()` → `start()` という順序を踏むフローを一貫させたい。connect 時に無条件で `start()` すると、iOS では「動いていないように見える」状態が発生し、利用者が「なぜ動かないのか」を診断しづらくなる。明示的な `start()` 呼び出しを要求することで、「許可されていないから止まっている」ことが利用者コードの構造上明らかになる。

**ただし、これは `<wcs-idle>` ほど明確な結論ではない。** Idle Detection は Chromium 限定 API であり「gesture-gate が無いブラウザでの自動起動」という選択肢自体が存在しなかった。Device Orientation は非 iOS ブラウザ（Android Chrome、デスクトップ全般）では gating が最初から存在しない（§3）。これらのブラウザに限れば、`connectedCallback` で無条件に `start()` しても実害はなく、むしろ「対応していれば自動的に動く」という他の monitor 系ノード（geo, network 等）の慣習に沿った体験になる。

**未決の開いた問題として明記する**: プラットフォーム能力（`typeof DeviceOrientationEvent?.requestPermission === "function"` の有無）に応じて自動起動するかどうかを分岐させる案は魅力的だが、

- 「iOS では自動起動しない・それ以外では自動起動する」という条件分岐は、Shell の `connectedCallback` に環境依存の分岐ロジックを持ち込むことになり、他の全ノードが「connect すれば同じように動く」という一貫性から外れる特別扱いになる。
- SSR との整合（`connectedCallbackPromise` が環境によって「即 resolve」か「実際に何かを待つ」かが変わりうる）も追加で検討が必要になる。
- iOS とそれ以外で挙動が分かれること自体を利用者にどう可視化するか（ドキュメント上の注意書きで済ませるか、`permissionState` の初期値だけで判別させるか）も未決。

したがって、本書では**この分岐を無理に決定しない**。初版は「常に自動起動しない・明示的な `requestPermission()` → `start()` を要求する」という統一的でシンプルな挙動を採用し（決定 4）、プラットフォーム分岐の是非は実装着手時に改めて精査すべき open issue として残す。

---

## 7. ブラウザ間の非一貫性 — `absolute` フィールドの扱い

Device Orientation API はブラウザ間で以下の非一貫性が知られている（執筆時点の把握であり、**実装時に一次情報（MDN / spec）で再検証すべき**）:

- 角度の精度・更新頻度がブラウザ・OS・センサーハードウェアによって異なる。
- `event.absolute`（値が地磁気に対する絶対方位かどうかを示す boolean）の扱いがブラウザによって不定・省略されることがある。

**決定 5**: `absolute` はプロパティとして公開する。単純な boolean パススルー（`event.absolute` をそのまま `wcs-tilt:change` の detail に載せるだけ）とし、Core 側で正規化・補正のロジックは持たない。

理由: パススルーの実装コストは最小限（他のフィールドと同じ扱いに1行足すだけ）であり、公開しておけば「絶対方位かどうかを気にする利用者」だけがこの値を参照すればよい。一方で公開しないと、後から必要になった際に破壊的変更なしに追加するのが難しくなる（`wcBindable.properties` への追加自体は非破壊だが、例やREADMEの記述整合を取り直すコストがある）。低コストで前倒しできる決定として先に確定させる。

**ただし、この決定は実装時に再検証すべき項目として明記する**: `absolute` の値がブラウザによって `undefined` になる、あるいは常に `false` 固定になるなど、実用上ほとんど意味を持たない実装があれば、パススルーだけでは利用者に誤解を与える可能性がある。実装時に主要ブラウザ（Chrome/Safari/Firefox）で実際の値を確認し、必要なら README に「ブラウザによって信頼性が異なる」旨の注記を追加する。

---

## 8. テスト方針（happy-dom）

happy-dom は `DeviceOrientationEvent` を持たないため、`__tests__/mocks.ts` で**グローバルの `DeviceOrientationEvent` クラス自体をモック**する必要がある（`IdleDetector` と同様、単なるオブジェクトプロパティの差し替えでは足りない。`globalThis.DeviceOrientationEvent` を install/remove する。`requestPermission` は静的メソッドとしてクラスに生やす）。

```typescript
class FakeDeviceOrientationEvent extends Event {
  alpha: number | null; beta: number | null; gamma: number | null; absolute: boolean;
  constructor(type: string, init: any) { super(type); Object.assign(this, init); }
}
// iOS相当のテストケースでのみ静的requestPermissionを生やす
(FakeDeviceOrientationEvent as any).requestPermission = vi.fn(async () => "granted");
```

観点:

- `typeof DeviceOrientationEvent?.requestPermission !== "function"` の環境（Android Chrome 相当）で `requestPermission()` を呼ぶと、実際には何も問い合わせず即座に `"granted"` を返し `permissionState` が `"granted"` になる（§3 の分岐確認）。
- `requestPermission` が生えている環境（iOS 相当）で、resolve 値が `permissionState` に正しく反映される（`"granted"`/`"denied"` の両方）。
- `requestPermission()` の reject（gesture 文脈外呼び出し相当）が never-throw で `"denied"` に倒れる。
- `deviceorientation` イベント発火で `alpha`/`beta`/`gamma`/`absolute` が更新され、1回のイベントにつき `wcs-tilt:change` が1回だけ dispatch される。
- `stop()` 後に `deviceorientation` を発火させても状態が変わらない（listener 解除の確認）。
- `start()` の冪等性（二重呼び出しで listener が二重登録されない）。
- `connectedCallback` 直後に `start()` が自動的に呼ばれていないこと（§6 決定 4 の検証）。
- secure context 外（`window.isSecureContext === false`）で `deviceorientation` が発火しない想定のケース（ネイティブ環境の挙動をそのまま信頼し、Core 側で追加のガードを設けるかどうかは実装時に判断——happy-dom では `isSecureContext` を直接制御してテストする）。

---

## 9. 決定事項まとめ

| 論点 | 決定 |
|---|---|
| §0 permission 状態の追跡 | **`<wcs-tilt>` がローカルに `permissionState` を保持**（対応する Permissions API エントリが無いため合成不可） |
| §2 `permissionState` の語彙 | 3値 `"granted" \| "denied" \| "unknown"`（geo/permission の4値とは意図的に異なる） |
| §2 公開 state | `alpha`/`beta`/`gamma`/`absolute` を1つの `wcs-tilt:change` に、`permissionState` は別イベント `wcs-tilt:permission-changed`、`error` は別イベント `wcs-tilt:error`（never-throw、§3.6 MUST） |
| §3 `requestPermission` フォールバック | `typeof DeviceOrientationEvent?.requestPermission === "function"` で分岐。無ければ即 `"granted"` |
| §4 `_gen`世代ガード | **不要**（購読(`start`/`stop`)は完全に同期で対象外。`requestPermission()`はasync probeを実際に持つが、post-await書き込みが購読・リソース管理を伴わないbenignな値設定+dispatchに留まるため同じく不要——`network`の「async probeが一切存在しない」根拠の流用は誤りだったため§4で訂正） |
| §5 secure context | **必須**（network とは対照的。バッチ横断で普遍的な話ではないことの実例） |
| §6 connect 時自動 start | **しない**（`<wcs-idle>` と並行の決定）。ただし非iOSでの自動起動の是非は**未決の開いた問題**として残す |
| §7 `absolute` | プロパティとして公開（単純パススルー、低コスト）。ただし実装時に主要ブラウザで再検証すべき |
| パッケージ/タグ | `@wcstack/tilt` / `<wcs-tilt>` / Shell `WcsTilt`（Screen Orientation の `<wcs-orientation>` との名前衝突回避、[io-node-candidate-implementation-notes.md](./io-node-candidate-implementation-notes.md) #6） |

---

## 10. 実装順の推奨

1. `TiltCore`（`_api()` 呼び出し時解決 ＋ `requestPermission` の分岐ロジック ＋ `start`/`stop` ＋ `permissionState` のローカル保持）。`_gen` は不要なため `<wcs-idle>` より実装量は小さい。`<wcs-idle>` の `requestPermission` 実装をコピーし、静的メソッドの有無チェックの分岐だけ書き足す形が最短。
2. Shell `<wcs-tilt>`（属性無し、display:none、`connectedCallback` では何も自動起動しない、`disconnectedCallback` で `stop()`）。
3. Fake double（`FakeDeviceOrientationEvent`、静的 `requestPermission` の有無を切り替えられる2パターンのテスト環境）とテスト一式。
4. example: **水準器 UI**（`beta`/`gamma` を CSS transform に束縛して傾きを可視化）を目玉に。iOS 実機を想定した「許可をリクエスト」ボタン付きのフローと、非iOSでの自動的な granted 扱いの両方を1つの example コードで分岐なく書けることを示す。
5. README ja/en（secure-context 必須・iOS 13+ の gesture-gate と `requestPermission()` フォールバック挙動・`absolute` の信頼性がブラウザ依存である旨・connect 時に自動 start しない設計上の理由・非iOSでの自動起動が未決である旨）。
