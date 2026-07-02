# 設計メモ: Generic Sensor族（`@wcstack/accelerometer` / `gyroscope` / `magnetometer` / `ambient-light-sensor`）

- **状態**: 設計検討中（未実装）。本文書は実装前の論点整理と決定事項のスナップショット。
- **対象 WebAPI**: Generic Sensor API のうち `Accelerometer` / `Gyroscope` / `Magnetometer` / `AmbientLightSensor`（[io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) バッチ5）
- **位置づけ**: バッチ5で決定済みの通り、この4クラスは**共通の`Sensor`基底に基づく1つのCoreアーキタイプ**を共有するため、本書は**その共有アーキタイプを1回だけ文書化する統合ドキュメント**である。**本書は将来実装される4パッケージ全ての共有設計ソースとして機能する**。実際に各パッケージ着手時に起草する `docs/accelerometer-tag-design.md` / `docs/gyroscope-tag-design.md` / `docs/magnetometer-tag-design.md` / `docs/ambient-light-sensor-tag-design.md` は、本書の§2（差分表）が示すフィールドだけを変えたほぼそのままのコピーになる想定であり、ゼロから論点整理をやり直す必要はない。これは[async-io-node-guidelines.md](./async-io-node-guidelines.md) §1 MUST（1パッケージ1tag-design.md）を将来満たしつつ、ほぼ同一内容を4回書く無駄を今の時点で避けるための判断であり、[io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) バッチ5の節で既に決定済みの前提（4パッケージに分ける・1つのCoreアーキタイプを共有する）に沿う
- **前提資産**: `permission`（`_permGen`世代ガード・`"unsupported"`フォールバック・Core/Shell分離・[[event-token-protocol]]専用ノードの先例）、`fetch`（`_gen`世代ガード・never-throwのtry/catch構造）、[io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) バッチ2（Idle Detectionの`permission`ノード合成パターン）

---

## 0. 大前提: プラットフォームAPI自体がガイドラインと最初から噛み合っている

4クラス（`Accelerometer` / `Gyroscope` / `Magnetometer` / `AmbientLightSensor`）は全て共通の`Sensor`基底クラス形状を継承する:

- コンストラクタは `{ frequency }` オプションを取る（Hz、サンプリングレート指定）
- `.start()` / `.stop()` メソッドを持つ
- 新しいサンプルが得られるたびに `'reading'` イベントを発火する
- **注目すべき点として、失敗は例外ではなく `'error'` イベントで通知する**

最後の点が本バッチ最大の特徴である。[async-io-node-guidelines.md](./async-io-node-guidelines.md) §3.6 の never-throw MUST は、通常「プラットフォームAPIは例外を投げうるので、Core側でtry/catchして`error`プロパティに変換する」という**Core側の防御**として機能する。ところがGeneric Sensor APIは、`start()`後の失敗（センサー未搭載・読み取り中の異常等）を最初から`'error'`イベントとして設計しており、Core側は単にこのイベントを中継するだけでnever-throwを満たせる。**プラットフォームAPI自体の設計がガイドラインと最初から噛み合っている稀なケース**であり、実装は他バッチより素直になる（ただし§5で述べる通り、コンストラクタ自体は例外を投げうるため、そこだけは能動的なtry/catchが必要）。

---

## 1. Accelerometerのフル参照設計（`@wcstack/accelerometer`, `<wcs-accelerometer>`）

4パッケージの中で最も需要が広い（傾き検出・シェイクジェスチャー等）ため、これを参照実装として完全に作り込む。他3パッケージは§2の差分表を適用するだけで足りる。

### 1.1 observable surface — **決定: 1イベント+派生getter×3 + 独立したerrorイベント**

```typescript
static wcBindable: IWcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "x", event: "wcs-accelerometer:reading", getter: (e: Event) => (e as CustomEvent).detail.x },
    { name: "y", event: "wcs-accelerometer:reading", getter: (e: Event) => (e as CustomEvent).detail.y },
    { name: "z", event: "wcs-accelerometer:reading", getter: (e: Event) => (e as CustomEvent).detail.z },
    { name: "error", event: "wcs-accelerometer:error" },
  ],
  inputs: [{ name: "frequency" }],
  commands: [{ name: "start" }, { name: "stop" }],
};
```

- `x`/`y`/`z`は`reading`イベント1つから派生する3つのgetterであり、`network`の「複数フィールド→1つのイベント」型（[network-tag-design.md:46-63](./network-tag-design.md#L46-L63)）と同型。ネイティブAPIの`reading`イベント自体が「1回のサンプルで3軸が同時に更新される」契約なので、フィールドごとに個別イベントへ分解しない
- `error`は`reading`とは別イベント（`wcs-accelerometer:error`）として独立させる。`reading`（同値ガード対象外＝毎回発火）と`error`（状態遷移）は性質が異なるため同じイベントに同居させない
- `commands: []`ではない点が`permission`/`network`との違い。本ノードは`start`/`stop`という2つのcommandを持つ、双方向（command-token + event-token）ノードである

### 1.2 inputs — **決定: `frequency`のみ**

- `frequency`（Hz、サンプリングレート）を唯一の設定入力とする。属性連動入力（[async-io-node-guidelines.md](./async-io-node-guidelines.md) §4.3の「属性連動入力」区分）として`get`は`getAttribute`、`set`は属性reflect
- `Sensor`コンストラクタの`{ frequency }`オプションへそのまま渡す。数値変換・範囲検証はブラウザ側の実装依存（不正値はコンストラクタかセンサー側で`error`に落ちる想定）で、Core側で追加のバリデーションは行わない

### 1.3 commands — **決定: `start` / `stop`のみ**

```typescript
start(): void { /* new Accelerometer(...) を try/catch で構築 → .start() */ }
stop(): void  { /* 現在のセンサーインスタンスの .stop() */ }
```

- 両コマンドとも同期メソッド（`async: true`は付けない）。`Sensor.start()`/`.stop()`自体が同期呼び出しで、結果は非同期の`reading`/`error`イベントとして後から届く

### 2番目の決定: Permissions APIとの合成 — **決定: `<wcs-permission>`との合成を推奨し、重複実装しない**

`navigator.permissions.query({ name: "accelerometer" })` が存在するため、権限状態の監視は独立実装せず、**[io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) バッチ2のIdle Detectionが確立した「`<wcs-permission>`との合成」パターンをそのまま適用する**。

- **決定**: `<wcs-accelerometer>`自体は権限状態(`prompt`/`granted`/`denied`)を自前で持たない。利用者は`<wcs-permission name="accelerometer">`を併置し、`granted`派生getter（[permission-tag-design.md:63-76](./permission-tag-design.md#L63-L76)）でUIの出し分け（例: 「センサーへのアクセスを許可してください」バナーの`hidden@granted`）を行う
- **却下した代替案**: `<wcs-accelerometer>`内部で`navigator.permissions.query({name:"accelerometer"})`を自前実装し、`permissionState`のような独自プロパティを公開する案。Idle Detection（[io-node-batch-implementation-plan.md:114-115](./io-node-batch-implementation-plan.md#L114-L115)）で「既存の`<wcs-permission name="idle-detection">`に委譲でき、権限状態の二重実装を避けられる」という判断が既に下されており、Accelerometer系でも同じ論理がそのまま成立する。`permission`パッケージの`_permGen`世代ガード込みの実装（[PermissionCore.ts:52-58](../packages/permission/src/core/PermissionCore.ts#L52-L58)）を4パッケージ分（実質16パッケージ、Gyroscope等を含む）に複製するのは重複コストが高く、`<wcs-permission>`という横断基盤プリミティブの存在意義（[permission-tag-design.md:27-34](./permission-tag-design.md#L27-L34)「対応タグの無い権限の監視」）とも整合しない
- **この決定の含意**: これでIdle Detection（バッチ2）とGeneric Sensor族（バッチ5）という**2つの独立した候補が同じ合成パターンに帰着した**。[io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md)の「未決事項」節（[io-node-batch-implementation-plan.md:312](./io-node-batch-implementation-plan.md#L312)）は「Generic SensorとIdle Detectionが共有する『`permission`ノードとの合成』パターンを、ガイドライン本体に正式な推奨パターンとして書き足すべきか」を未決事項として残しているが、本書の決定はこれを追認する2件目の実例である。**2件の独立した合成実績が揃った今、この論点は「検討中」から「ガイドライン本体（`async-io-node-guidelines.md` §3.7近辺、API解決の節）に正式な推奨パターンとして昇格させるべき」段階に移ったと考えられる**。ガイドライン改訂自体は本書のスコープ外だが、次に権限依存の候補（Web Bluetooth等）を実装する際は、まずこの2件を参照して合成パターンを踏襲すべきである

### 1.4 対応環境 — **決定: unsupported/deniedを既定状態として想定**

- Chromium/Android実機がメインの対応環境。デスクトップ（特にSafari/Firefox）は未実装または`SecurityError`になりやすい
- **決定**: どのexampleを書く場合も、unsupported/denied状態が既定であることを前提に設計する。[network-tag-design.md](./network-tag-design.md) §0が確立した「unsupportedは例外でなく常態」という前提をここでも踏襲し、「効く環境では効く、効かない環境では何もしない」漸進的強化としてのみ振る舞いを設計する
- unsupported判定は[async-io-node-guidelines.md](./async-io-node-guidelines.md) §3.7 MUSTに従い呼び出し時解決: `typeof globalThis.Accelerometer === "function"`をコンストラクタ呼び出し直前に毎回チェックする（キャッシュしない）

### 1.5 `_gen`世代ガードの要否 — **決定: 不要（ただしコンストラクタのtry/catchは必須）**

- **`start()`/`stop()`自体には`_gen`世代ガードは不要**と判断する。理由は[network-tag-design.md](./network-tag-design.md) §5と全く同じ: `start()`/`stop()`は購読/購読解除の同期的なトグルであり、resolve時に解決状態を比較すべき非同期probe（`query()`のようなPromiseベースの処理）を持たない。`reading`/`error`イベントの購読登録・解除自体が同期的に完結するため、disconnect後に古い世代の非同期処理がすり抜けて torn-down 要素へ書き込む、という`_gen`が本来防ぐべき競合の隙間がそもそも存在しない
- **ただし例外的な注意点**: `new Accelerometer({ frequency })` という**コンストラクタ自体**は、権限拒否やfeature-policyによるブロック時に**同期的に例外を投げうる**（`SecurityError`等）。これは`start()`/`stop()`呼び出しとは別のタイミング（インスタンス生成時点）で発生するため、`_gen`ガードの不要性とは無関係に、never-throw原則（[async-io-node-guidelines.md](./async-io-node-guidelines.md) §3.6 MUST）を満たすためのtry/catchが単独で必要になる。**生の`new Accelerometer(...)`を直接呼んではならない**。必ず次のような構築ヘルパーで包む:

```typescript
private _createSensor(frequency?: number): Accelerometer | null {
  const Ctor = (globalThis as any).Accelerometer;
  if (typeof Ctor !== "function") {
    this._setError({ error: "unsupported", message: "Accelerometer is not supported" });
    return null;
  }
  try {
    return new Ctor(frequency !== undefined ? { frequency } : undefined);
  } catch (e: any) {
    // SecurityError（権限拒否・feature-policyブロック等）は同期例外として飛んでくる。
    // fetch の _doFetch と同じ try/catch 構造（FetchCore.ts:213, 287）で never-throw を満たす。
    this._setError({ error: e?.name ?? "error", message: e?.message ?? String(e) });
    return null;
  }
}
```

  この構造は`fetch`パッケージの`_doFetch`が`try { ... } catch (e: any) { this._setError(e); }`で例外を吸収する構造（[FetchCore.ts:213-213](../packages/fetch/src/core/FetchCore.ts#L213), [FetchCore.ts:287-301](../packages/fetch/src/core/FetchCore.ts#L287-L301)）と同じ形であり、「非同期処理のtry/catch」ではなく「同期的なコンストラクタ呼び出しのtry/catch」という点だけが異なる

---

## 2. 差分表: Gyroscope / Magnetometer / AmbientLightSensor

以下3パッケージは§1のAccelerometer参照設計から、下表の項目だけを差し替えれば成立する。Core/Shellの構造・`_gen`不要の判断・Permissions API合成の判断・never-throwのコンストラクタガードは全て共通で変わらない。

| 項目 | Gyroscope | Magnetometer | AmbientLightSensor |
|---|---|---|---|
| (a) グローバルクラス名 | `Gyroscope` | `Magnetometer` | `AmbientLightSensor` |
| (b) readingフィールド | `x` / `y` / `z`（角速度、deg/s相当） | `x` / `y` / `z`（磁束密度、µT） | 単一スカラー `illuminance`（lux） |
| (c) permission名文字列 | `"gyroscope"` | `"magnetometer"` | `"ambient-light-sensor"` |
| (d) タグ / パッケージ名 | `<wcs-gyroscope>` / `@wcstack/gyroscope` | `<wcs-magnetometer>` / `@wcstack/magnetometer` | `<wcs-ambient-light-sensor>` / `@wcstack/ambient-light-sensor` |

補足:

- Gyroscope / Magnetometerの`properties`は`x`/`y`/`z`+`error`の4件で、Accelerometerと文字通り同型（イベント名の`wcs-accelerometer:`部分のみ`wcs-gyroscope:`/`wcs-magnetometer:`に置換）
- AmbientLightSensorのみ`properties`が`illuminance`+`error`の2件になる（`x`/`y`/`z`は存在しない）。派生getterではなく単一フィールドなので「1イベント+派生getter」パターンは不要で、`{ name: "illuminance", event: "wcs-ambient-light-sensor:reading", getter: e => e.detail.illuminance }`の1本のみ

### AmbientLightSensorに関する追加フラグ — **対応状況が悪化しており実装優先度は最低**

AmbientLightSensorは、fingerprinting対策を理由に一部ブラウザで対応が悪化・削除されている実態がある（Firefoxは実装見送り、Chromiumも既定で無効化されていた時期がある等、対応状況は流動的）。これは§1.4で述べた「Chromium/Android中心でデスクトップは弱い」という4クラス共通の傾向をさらに一段悪化させた、**バッチ中最も対応が弱いメンバー**である。

- **決定**: AmbientLightSensorは4パッケージの中で実装優先度を最低に置く。着手前に対応表（MDN / caniuse等の一次情報）を必ず再確認し、対応状況次第では実装そのものを見送る判断もありうる（[async-io-node-guidelines.md](./async-io-node-guidelines.md)冒頭「執筆時点の把握であり、着手時に一次情報で再検証すること」という原則をここで強く適用する）

---

## 3. テスト方針（happy-dom）

happy-domは`Accelerometer`/`Gyroscope`/`Magnetometer`/`AmbientLightSensor`のいずれも実装しないため、全モックが前提になる。

**共有アーキタイプの利点**: 4パッケージ全てに使い回せる単一のFake doubleストラテジーが成立する。

```typescript
class FakeSensor extends EventTarget {
  constructor(private readingFields: Record<string, number>, private options?: { frequency?: number }) { super(); }
  start(): void { /* テストごとに reading/error を手動 dispatch できるようにするだけで、start() 自体は no-op でよい */ }
  stop(): void {}
  // テストヘルパーから呼び、reading イベントを合成発火する
  emitReading(values: Record<string, number>): void {
    this.dispatchEvent(new CustomEvent("reading", { detail: values }));
    Object.assign(this, values);
  }
  emitError(name: string): void {
    this.dispatchEvent(new CustomEvent("error", { detail: { error: { name } } }));
  }
}
```

- `readingFields`をテストごとにパラメータ化する（Accelerometerなら`{x,y,z}`、AmbientLightSensorなら`{illuminance}`）だけで、4パッケージ全てのテストスイートが同じFake基盤を再利用できる。これは「1つのCoreアーキタイプを共有する」という本書冒頭の決定がテストコードにも波及する具体的な利点であり、4パッケージ分のテストを独立に設計し直す必要がない
- 観点（[async-io-node-guidelines.md](./async-io-node-guidelines.md) §8「必ずテストすること」に準拠）:
  - `typeof globalThis.<GlobalClassName> === "function"`が偽の環境で`unsupported`相当の`error`になること
  - コンストラクタが同期的に例外を投げるケース（`SecurityError`を投げる`FakeSensor`のサブクラス、またはコンストラクタ関数自体をthrowするスタブに差し替える）で、never-throwが保たれ`error`イベントに変換されること
  - `reading`イベントでx/y/z（またはilluminance）が正しく更新されること、同値ガードは`reading`には適用されない（毎回発火するイベント性）こと
  - `stop()`後に`reading`が来ても状態を更新しない（listener解除の確認）こと
  - `observe()`（`start()`相当）の冪等性: 二重呼び出しでセンサーインスタンスが二重生成されない
  - `dispose()`後の`start()`で正しく再購読できること
  - `frequency`属性が`Sensor`コンストラクタのオプションに正しく渡ること

---

## 4. 決定事項まとめ

| 論点 | 決定 |
|---|---|
| §0 プラットフォームAPIとnever-throw | `'error'`イベント通知が最初からnever-throw MUSTと一致。稀な好例 |
| §1.1 observable surface | `x`/`y`/`z`は1つの`reading`イベントからの派生getter、`error`は独立イベント |
| §1.2 inputs | `frequency`のみ |
| §1.3 commands | `start` / `stop`のみ（双方向ノード） |
| Permissions API連携 | **`<wcs-permission name="<sensor>">`との合成を推奨、`<wcs-accelerometer>`等の内部では権限監視を実装しない** |
| §1.4 対応環境 | Chromium/Android中心。unsupported/deniedを既定状態として設計 |
| §1.5 `_gen`世代ガード | **不要**（`start`/`stop`は同期的な購読トグルで非同期probeが無い） |
| §1.5 コンストラクタの例外 | **必須**: `new <GlobalClassName>(...)`は同期的に例外を投げうるためtry/catchで包む。生の`new`を直接呼ばない |
| §2 4パッケージの分割方針 | 1タグ1責務の慣習通り4パッケージに分割。共有Coreアーキタイプは本書1本で文書化 |
| §2 AmbientLightSensorの優先度 | **最低**。fingerprinting対策で対応状況が悪化・削除されつつあり、着手前に対応表の再確認必須 |
| §3 テスト戦略 | `FakeSensor extends EventTarget`をreadingフィールドでパラメータ化し4パッケージ共有 |
| パッケージ/タグ | `@wcstack/accelerometer` `<wcs-accelerometer>` / `@wcstack/gyroscope` `<wcs-gyroscope>` / `@wcstack/magnetometer` `<wcs-magnetometer>` / `@wcstack/ambient-light-sensor` `<wcs-ambient-light-sensor>` |

---

## 5. 実装順の推奨

1. **Accelerometer**（最も適用範囲が広い＝傾き検出・シェイクジェスチャー等の実用例が多い）を参照実装として最初に完成させる。本書§1の設計をそのままコードに落とし、Core/Shell/Fake doubleの3点セットを確立する
2. **Gyroscope** — Accelerometerのコードをコピーし、§2差分表の(a)(b)(c)(d)だけを置換して複製する
3. **Magnetometer** — 同上。Gyroscopeと同型（x/y/z）なので、Gyroscopeの複製作業を再度なぞるだけで足りる
4. **AmbientLightSensor** — 最後に着手する。**着手前に現在の対応状況（fingerprinting対策による削除・無効化の動向）を一次情報で再確認し、対応状況次第では実装優先度をさらに見送る（後続バッチに先送りする）可能性がある**という留保付きで進める

各パッケージ着手時には、本書の該当箇所（Accelerometerは§1全体、他3つは§2差分表＋§1の共通部分）を移植する形で`docs/<name>-tag-design.md`を起草する（[async-io-node-guidelines.md](./async-io-node-guidelines.md) §1 MUST）。ゼロから論点整理をやり直す必要はなく、本書が「答え合わせ済みの下敷き」として機能する。
