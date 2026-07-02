# 類似IOノード バッチ実装計画

- **対象**: [io-node-candidate-screening.md](./io-node-candidate-screening.md) / [io-node-candidate-implementation-notes.md](./io-node-candidate-implementation-notes.md) で洗い出した候補のうち、**実装パターンが共通するものをバッチにまとめ**、共有アーキタイプの実装仕様を先に確定する
- **状態**: 計画ドキュメント（非規範）。ここでの仕様確定は「バッチ内で使い回す設計の答え合わせ」であり、個別ノードの実装着手時は依然として `docs/<name>-tag-design.md` の起草が必要（[async-io-node-guidelines.md](./async-io-node-guidelines.md) §1 MUST）。本書はその起草を高速化するための下敷き
- **方針**: 各バッチに「参照実装（コピー元）」を既存パッケージから1つ指定する。ガイドライン自身が推奨する「既存パッケージをコピーして始めるのが最短」を、バッチ内の2〜4ノードに対して連鎖的に適用する
- **除外**: 複数Promiseの並行管理を要する候補（REST-node等）は別トラック（[multi-promise-io-node-design.md](./multi-promise-io-node-design.md)）。本書のバッチは全て「単一in-flight」で閉じるものだけを対象にする

---

## バッチ概要

| バッチ | メンバー | 共有アーキタイプ | 参照実装（コピー元） | 個別設計ドキュメント |
|---|---|---|---|---|
| 1. target解決 | Fullscreen, Picture-in-Picture, Pointer Lock | `target`属性→要素解決→document-levelイベント監視 | `packages/intersection` | [fullscreen](./fullscreen-tag-design.md) / [picture-in-picture](./picture-in-picture-tag-design.md) / [pointer-lock](./pointer-lock-tag-design.md) |
| 2. gesture-gated permission | Idle Detection, Device Orientation/Motion | 静的`requestPermission()`をcommandとして公開 | `packages/permission` | [idle-detection](./idle-detection-tag-design.md) / [device-orientation](./device-orientation-tag-design.md) |
| 3. 薄い一発command | Web Share, EyeDropper, Contact Picker, (Credential Management) | `value`/`loading`/`error`/`cancelled`の最小Core | `packages/fetch`（`_doFetch`の簡約版） | [web-share](./web-share-tag-design.md) / [eyedropper](./eyedropper-tag-design.md) / [contact-picker](./contact-picker-tag-design.md) / [credential](./credential-tag-design.md) |
| 4. 最小monitor | Network Information, Screen Orientation | 単一イベント→派生getter、極小Core | `packages/permission` | [network](./network-tag-design.md) / [screen-orientation](./screen-orientation-tag-design.md) |
| 5. Generic Sensor族 | Accelerometer, Gyroscope, Magnetometer, AmbientLight | 共通`Sensor`基底クラスの薄いラップ×4 | バッチ内の1つ目を相互参照 | [sensor（4パッケージ統合）](./sensor-tag-design.md) |

---

## バッチ1: target解決パターン（Fullscreen / Picture-in-Picture / Pointer Lock）

### 共有アーキタイプ

`packages/intersection`の`_resolveTarget()`をそのまま流用する（[Intersect.ts:243-267](../packages/intersection/src/components/Intersect.ts#L243-L267)）:

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

`_safeQuery`（不正セレクタをtry/catchでnullに落とすnever-throwガード）も含めてそのままコピーする。この3モード（`self`宣言的指定／セレクタ参照／子要素省略時）は、対象を持つIOノード全てに共通の解決規則として確立済み。

### per-API仕様

**Fullscreen** — `<wcs-fullscreen target="...">`
```typescript
static wcBindable = {
  properties: [
    { name: "active", event: "wcs-fullscreen:change", getter: e => e.detail.active },
  ],
  inputs: [{ name: "target", attribute: "target" }],
  commands: [
    { name: "requestFullscreen", async: true },
    { name: "exitFullscreen", async: true },
  ],
};
```
- `document.fullscreenElement === target`で`active`を判定（`fullscreenElement`はdocument全体で1要素のみ）
- `requestFullscreen()`はuser gesture必須。gesture外呼び出しのrejectはnever-throwで`error`へ
- ベンダープレフィックス実装（一部Safari）はAPI解決層で吸収

**Picture-in-Picture** — `<wcs-pip target="...">`
```typescript
static wcBindable = {
  properties: [{ name: "active", event: "wcs-pip:change", getter: e => e.detail.active }],
  inputs: [{ name: "target", attribute: "target" }],
  commands: [
    { name: "requestPictureInPicture", async: true },
    { name: "exitPictureInPicture", async: true },
  ],
};
```
- `_resolveTarget()`の解決結果に加えて`tagName === "VIDEO"`検証を挟む（不一致は`error`）
- `document.pictureInPictureElement === target`で`active`判定
- スコープ決定事項: 初版は`<video>`限定の旧API。任意DOM要素向けの新しいDocument Picture-in-Picture APIは対象外（別途検討）

**Pointer Lock** — `<wcs-pointer-lock target="...">`
```typescript
static wcBindable = {
  properties: [{ name: "active", event: "wcs-pointer-lock:change" }],
  inputs: [{ name: "target", attribute: "target" }],
  commands: [
    { name: "requestPointerLock", async: true },
    { name: "exitPointerLock" },
  ],
};
```
- `movementX`/`movementY`（高頻度mousemove由来）は初版のobservable surfaceから外し、需要確認後に`debounce`/`throttle`パッケージとの組み合わせ前提で追加する
- 優先度は3つの中で最低（用途がゲーム/描画UI限定）

### 実装順序
**Fullscreen → Picture-in-Picture → Pointer Lock**。Fullscreenが最も対応ブラウザが広く制約が少ない。PiPはFullscreenのパターンに「対象要素タグ検証」を足すだけ。Pointer Lockは需要確認後でよい。

---

## バッチ2: gesture-gated permission パターン（Idle Detection / Device Orientation・Motion）

### 共有アーキタイプ

`PermissionCore`の`_permGen`＋`_permissionSubscribed`による冪等observe/dispose（[PermissionCore.ts:52-58, 118-134, 147-156](../packages/permission/src/core/PermissionCore.ts#L52-L58)）を土台にするが、**両APIとも「非同期の権限取得が明示的な静的メソッドで、user gesture文脈が必須」という、`permission`パッケージ自体には無い要素**を追加で持つ。

```typescript
static wcBindable = {
  properties: [ /* センサー値 */ ],
  commands: [
    { name: "requestPermission", async: true },  // gesture文脈から呼ぶことをREADMEで明示
    { name: "start" },
    { name: "stop" },
  ],
};
```

**重要な非対称性（バッチ内で発見した差異）**:
- **Idle Detection**は`navigator.permissions.query({name:"idle-detection"})`が別途存在するため、状態監視は既存の`<wcs-permission name="idle-detection">`に委譲でき、`<wcs-idle>`自身は`requestPermission()`commandと`userState`/`screenState`監視だけを持てばよい（既存ノードとの合成で完結、権限状態の二重実装を避けられる）
- **Device Orientation/Motion**には対応する`navigator.permissions.query`エントリが無い（iOS Safari固有の`DeviceOrientationEvent.requestPermission()`の結果はブラウザ内部にしか無い）→ `<wcs-tilt>`は`permissionState`を**自前でローカル追跡**するしかない

同じ「gesture-gated静的requestPermission」表面を共有しつつ、状態管理の実装は分岐する。ここはバッチとして揃えられない部分として明記しておく。

### per-API仕様

**Idle Detection** — `<wcs-idle>`
```typescript
static wcBindable = {
  properties: [
    { name: "userState", event: "wcs-idle:change" },
    { name: "screenState", event: "wcs-idle:change" },
    { name: "active", event: "wcs-idle:change", getter: e => e.detail.userState === "active" },
  ],
  inputs: [{ name: "threshold" }],
  commands: [
    { name: "requestPermission", async: true },
    { name: "start", async: true },
    { name: "stop" },
  ],
};
```
- `start({threshold, signal})`のAbortSignalは`dispose()`/`stop()`で`abort()`、`_gen`は「都度新しいAbortControllerを発行」
- `threshold`はAPI仕様上60秒以上必須。不正値はcatchして`error`
- Chromium系限定 → `typeof IdleDetector === "undefined"`のunsupported分岐必須

**Device Orientation/Motion** — `<wcs-tilt>`
```typescript
static wcBindable = {
  properties: [
    { name: "alpha", event: "wcs-tilt:change" },
    { name: "beta", event: "wcs-tilt:change" },
    { name: "gamma", event: "wcs-tilt:change" },
    { name: "permissionState", event: "wcs-tilt:permission-changed" },
  ],
  commands: [
    { name: "requestPermission", async: true },
    { name: "start" },
    { name: "stop" },
  ],
};
```
- 非iOSブラウザには`requestPermission`自体が存在しない → `typeof DeviceOrientationEvent?.requestPermission === "function"`で分岐し、無ければ`permissionState`を`"granted"`固定で即購読開始
- secure context（HTTPS）必須

### 実装順序
**Idle Detection → Device Orientation/Motion**。Idle Detectionを先にやることで「`permission`ノードとの合成」という王道パターンを確立し、Device Orientationで「合成できない場合のローカル追跡」という亜種を確認する。

---

## バッチ3: 薄い一発commandパターン（Web Share / EyeDropper / Contact Picker / Credential Management）

### 共有アーキタイプ（新規）

既存25パッケージに前例が無いため、ここで初めて設計する。`FetchCore`の`_doFetch`（単一`_gen`、try/catch、never-throw）を土台に、abort機構を持たない簡約版にする。

```typescript
static wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "value", event: "wcs-share:complete", getter: e => e.detail.value },
    { name: "loading", event: "wcs-share:loading-changed" },
    { name: "error", event: "wcs-share:error" },
    { name: "cancelled", event: "wcs-share:cancelled-changed" },
  ],
  commands: [{ name: "share", async: true }],
};
```

**設計上の決定事項（以前の未決を確定させる）**:
- **`cancelled`を`error`から独立させる**。`AbortError`（ユーザーがダイアログを閉じた等）は失敗ではないため、`error`には含めない。`error`は`NotAllowedError`等の真の失敗専用
- **abort commandは持たない**。これらのAPIはブラウザ側ダイアログの結果待ちで、呼び出し元からの中断手段が無い
- `_gen`は単一（fetchと同型）。1インスタンスにつき1操作という前提は、これらのAPIがそもそもモーダルダイアログを介するため自然に成立する（ユーザーは同時に2つの共有ダイアログを開けない）

### per-API仕様

**Web Share** — `<wcs-share>`
- `commands: [{name:"share", async:true}]`、引数は`{title,text,url,files}`オブジェクト1個（command-token引数素通しにそのまま乗る）
- `canShare(data)`を事前検証用のプレーンメソッドとして公開するか（wcBindable外のヘルパー）は実装時に決定

**EyeDropper** — `<wcs-eyedropper>`
- `commands: [{name:"open", async:true}]`、引数無し、`value`は`{sRGBHex}`
- Web Shareと寸分違わぬ形。アーキタイプの汎用性を最初に証明する候補

**Contact Picker** — `<wcs-contacts>`
- `commands: [{name:"select", async:true}]`、引数は`(properties[], {multiple})`
- Android Chrome限定でunsupportedがデフォルト環境になりやすい

**Credential Management**（初版スコープ: password/federatedのみ、WebAuthnは別ノード`<wcs-webauthn>`として切り出し）
- `commands: [{name:"get", async:true}, {name:"store", async:true}]` — **アーキタイプ唯一の複数command**
- 注記: `get()`と`store()`が同一インスタンスでほぼ同時に呼ばれることは実用上考えにくい（認証フローは逐次的）ため単一`_gen`で妥協する。もし将来的に並行呼び出しの需要が出た場合は[multi-promise-io-node-design.md](./multi-promise-io-node-design.md)のパターン(a)を適用する

### 実装順序
**Web Share → EyeDropper → Contact Picker → Credential Management**。最初の2つでアーキタイプの汎用性を証明し、Contact Pickerで複数引数command、Credential Managementで複数command+重いnever-throw面を確認する。

---

## バッチ4: 最小monitorパターン（Network Information / Screen Orientation）

### 共有アーキタイプ

`PermissionCore`の「単一イベント→派生getter」構造を、クエリすら不要なレベルまで単純化する。

**Network Information** — `<wcs-network>`（純粋monitor、commands無し）
```typescript
static wcBindable = {
  properties: [
    { name: "effectiveType", event: "wcs-network:change" },
    { name: "downlink", event: "wcs-network:change" },
    { name: "saveData", event: "wcs-network:change" },
  ],
  commands: [],
};
```
- `navigator.connection`がSafari/Firefoxで未実装 → `_api()`が`undefined`を返す前提。unsupported時は全プロパティ`null`/`false`固定
- 全バッチ中**最も実装が軽い**。バッチ横断の最初の一手として最適

**Screen Orientation** — `<wcs-orientation>`（monitor + 2 command、targetは不要=document/window全体が対象なのでバッチ1とは別枠）
```typescript
static wcBindable = {
  properties: [
    { name: "type", event: "wcs-orientation:change" },
    { name: "angle", event: "wcs-orientation:change", getter: e => e.detail.angle },
  ],
  commands: [
    { name: "lock", async: true },
    { name: "unlock" },
  ],
};
```
- `lock()`は多くの実装でモバイル限定・特定条件下でのみ動作 → never-throwで`error`吸収
- `screen.orientation`自体がEventTarget実装なので`addEventListener`をそのまま使える

### 実装順序
**Network Information → Screen Orientation**。前者はcommands無しの純粋monitorとして最速で作れる練習台、後者はcommand混じりの一段複雑な形。

---

## バッチ5: Generic Sensor族（Accelerometer / Gyroscope / Magnetometer / AmbientLightSensor）

### 共有アーキタイプ

4クラスとも共通の`Sensor`基底（`.start()`/`.stop()`、`'reading'`イベント、`'error'`イベント）を持つため、**1つのCore実装を確立すれば残り3つは値フィールドの違いだけで複製できる**。

```typescript
static wcBindable = {
  properties: [
    { name: "x", event: "wcs-accelerometer:reading" },
    { name: "y", event: "wcs-accelerometer:reading" },
    { name: "z", event: "wcs-accelerometer:reading" },
    { name: "error", event: "wcs-accelerometer:error" },
  ],
  inputs: [{ name: "frequency" }],
  commands: [{ name: "start" }, { name: "stop" }],
};
```
（`AmbientLightSensor`のみフィールドが`illuminance`単一値になる差異）

- `'error'`イベントによる失敗通知（例外throwでない）がnever-throw原則とAPI設計自体で一致しており、実装は素直
- `navigator.permissions.query({name:"accelerometer"})`等、Permissions APIとの連携が必須 → バッチ2のIdle Detectionと同じ「`permission`ノードとの合成」パターンをここでも使う
- Chromium系・Android実機がメイン、デスクトップは`SecurityError`になりやすい → unsupported分岐を厚めに
- **タグ分割の方針**: `camera`/`recorder`の1タグ1責務の慣習に倣い、4パッケージに分ける（1パッケージ+`type`属性切替にはしない）。ただしコードは1つ目の実装をコピー・値フィールドだけ差し替えて複製する

### 実装順序
**Accelerometer**（最も需要が広い）を参照実装として先に完成させ、Gyroscope → Magnetometer → AmbientLightSensorの順で複製する。

---

## 全体の推奨シーケンス

バッチ横断で「新しい設計パターンを最も安く証明できる順」に並べる。

1. **Network Information**（バッチ4）— 最速の練習台。既存パターンの純粋な繰り返し
2. **Fullscreen**（バッチ1）— target解決パターンの転用を証明
3. **Screen Orientation**（バッチ4）— monitor+commandの組み合わせ
4. **Picture-in-Picture / Pointer Lock**（バッチ1残り）
5. **Web Share**（バッチ3)— 新アーキタイプ（薄い一発command）を初めて実装
6. **EyeDropper / Contact Picker**（バッチ3残り）
7. **Idle Detection**（バッチ2）— `permission`ノードとの合成パターンを証明
8. **Device Orientation/Motion**（バッチ2残り）— 合成できない亜種を確認
9. **Generic Sensor族 ×4**（バッチ5）— 1つの参照実装を複製する量産フェーズ
10. **Credential Management**（バッチ3拡張、スコープ限定）

---

## 次のアクション

各ノードの `docs/<name>-tag-design.md`（ガイドライン§1 MUST）は起草済み（上記バッチ概要表の「個別設計ドキュメント」列を参照。バッチ5のみ4パッケージ分を1本に統合）。**次に着手すべきは実際のコード実装**であり、追加の設計ドキュメントは不要。

着手順は各バッチの「実装順の推奨」節、および本書冒頭の「全体の推奨シーケンス」に従う。最初の1本には**Network Information**（[network-tag-design.md](./network-tag-design.md)、バッチ4、最も設計面のリスクが低い）を推奨する。

## 未決事項（バッチ横断で残るもの）

- バッチ3の`cancelled`/`error`の呼称・イベント名を、4ノード全体で最終的にどう揃えるか（本書では暫定で確定させたが、実装時に`config.debug`表示等の細部は要調整）
- バッチ5のタグ命名（`<wcs-accelerometer>`等）が既存の命名慣習（`<wcs-geo>`のような短縮）に照らして適切か
- Generic SensorとIdle Detectionが共有する「`permission`ノードとの合成」パターンを、ガイドライン本体（§3.7近辺）に正式な推奨パターンとして書き足すべきか
