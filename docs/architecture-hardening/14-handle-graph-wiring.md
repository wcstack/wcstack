# ライブハンドルのグラフを DOM で配線する（handle graph wiring）

- **作成日**: 2026-08-02
- **状態**: ✅ **採択（2026-08-02）**。G1・G2・G6 はユーザー承認済。G3・G4・G5 は推奨どおり採択（§8 参照）。実装計画は [audio-impl-plan.md](../audio-impl-plan.md)。
- **きっかけ**: [examples/synth-playground](../../examples/synth-playground/)（2026-08-01・`977f236f`）。Web Audio API を 14 個の `<wcs-*>` タグで宣言的に扱う実験。これをパッケージに格上げするかの判断が、体系レベルの決定を1つ要求している。
- **前提**: [11-react-immutable-snapshot-boundary.md](11-react-immutable-snapshot-boundary.md)（state / event / handle の分離）、[12-wc-bindable-observable-inventory.md](12-wc-bindable-observable-inventory.md)（handle 棚卸し = 231 property 中 1個）、[camera-recorder-tag-design.md](../camera-recorder-tag-design.md) §1・§2（生ハンドルを state に入れない不変条件）、[async-io-node-guidelines.ja.md](../async-io-node-guidelines.ja.md)（ノード骨格の規範）。
- **横断原則との関係**: README の横断原則 **3「値、イベント、コマンド、ライブハンドルの意味を混ぜない」** が、ここで初めて「ライブハンドルが複数あり、互いに接続される」という形で試される。

---

## 0. 何が新しいのか

既存の全 I/O ノードは次の形をしている。

> **タグは互いに独立し、タグ間の関係は state のパスだけが持つ**（Path as the Universal Contract）。

Web Audio は違う。`OscillatorNode → BiquadFilterNode → GainNode → destination` という **接続関係そのものが処理の本体**であり、しかもその関係は値ではない。camera が持ち込んだ「シリアライズ不能なライブハンドル」は 1 本だったが、audio は N 本あり、**ハンドル同士が結線される**。

| | 既存ノード | camera（2026-06） | audio（本件） |
|---|---|---|---|
| 流れるもの | シリアライズ可能な値 | `MediaStream` 1本 | `AudioNode` の有向グラフ |
| ハンドルの公開 | — | `streamReady` で公開（handle 分類の唯一の実例） | **未定（G2）** |
| タグ間の関係 | state のパス経由 | command-token 引数素通し（1本の受け渡し） | **トポロジそのもの（未定・G1）** |
| 関係の記述場所 | `data-wcs` | `data-wcs` | **未定（G1・G3）** |

新規性は「ハンドルを扱うこと」ではない。それは camera で決着済み。新規性は **「ハンドル間の接続トポロジをどこが所有し、どう記述するか」** の一点に集約される。

### 0.1 すでに体系が答えを出している部分

棚卸し（[12](12-wc-bindable-observable-inventory.md) §3）によれば、**worker / websocket / broadcast は非シリアライズなライブハンドル（`Worker` / `WebSocket` / `BroadcastChannel`）を内部に持ちながら、handle を一切公開していない**。Core が所有し、Core が破棄し、外へは値とイベントだけを出す。camera が handle を公開したのは、`MediaStream` を **別の要素（recorder / `<video>`）へ渡す必要があった**からであって、ハンドルだから公開したのではない。

→ **audio のハンドルは要素の外へ出す必要が無い**（グラフはパッケージ内で閉じる）。したがって G2 は「公開しない」に倒せる公算が大きい。これが本 ADR で最も先に確認すべき点である。

---

## 1. 決定ゲート G1 — トポロジの所有者【✅ 案D で決定】

`<wcs-osc>` が `<wcs-filter>` に繋がっている、という事実をどこが持つか。

| 案 | トポロジの所在 | 評価 |
|---|---|---|
| **A. DOM が所有** | 入れ子＝信号チェーン、`out=`/`param=` の id 参照＝それ以外の結線。synth-playground の現状 | 「HTML が配線」という核と一致。View source でパッチが読める。ただし DOM が計算グラフを兼ねる＝HTML セマンティクスの拡大解釈 |
| B. state が所有 | state にパッチ記述（配列/オブジェクト）を置き、ルートが読んでグラフを組む | トポロジが「値」になり diff / computed / JSON 永続化に乗る。だが **camera §1 で禁じた「settle しないものを値扱いする矛盾」の再来**であり、かつ HTML から配線が消える（Polymer の死因＝両端への独自ランタイム強制に接近） |
| **C. DOM が構造、state はパラメータのみ** | トポロジは DOM（案A）、`frequency` / `gain` 等の数値だけ state から流す | 現状 + wcBindable。責務分離が明快。**「構造は宣言、値は反応」**という一文で説明できる |
| D. descriptor が正本・DOM はその一表現 | Core は plain object のパッチ記述を受け取る。DOM ウォーカーはそれを生成する層 | C の上位互換。Core が DOM 非依存になり[ガイドライン §3.1 の MUST NOT](../async-io-node-guidelines.ja.md) を満たす。headless 採用者はパッチを直接組める |

- **推奨: D（＝C を Core/Shell 境界まで徹底した形）**。
  - 理由1: ガイドライン §3.1 は「Core は DOM 要素に依存してはならない（MUST NOT）」と規範化している。DOM を歩くグラフコンパイラを Core に置くと即座に違反する。descriptor tree を挟めば違反しない。
  - 理由2: Core が公開ヘッドレスサーフェス（§3.9）である以上、「パッチ＝データ構造」であることは semver 保護された公開 API として意味を持つ。
  - 理由3: テスト容易性。グラフの接続形状の検証が DOM 抜きで書ける（後述 §7）。
- **帰結**: 「トポロジは値ではないので state に置かない」は維持しつつ、「トポロジは **記述可能なデータ** ではある」を認める。この2つは両立する（値＝reactive に流れるもの、記述＝構築時に1度読まれるもの）。

> **G1 の問い**: トポロジの正本を descriptor tree とし、DOM をそのオーサリング面の一つと位置づけてよいか。

---

## 2. 決定ゲート G2 — ハンドルを wcBindable に出すか【✅ 出さない】

| 案 | 内容 | 評価 |
|---|---|---|
| **A. 出さない（内部完結）** | `AudioNode` は Core が所有・破棄。公開するのは値（`state` / `error` / `voices` 等）とイベントのみ | worker / websocket / broadcast と同じ形。**handle 棚卸しが 1 のまま増えない** ＝ [12 §5.6](12-wc-bindable-observable-inventory.md) が挙げた adapter 別の失敗モード（signals の同値 dedupe、RxJS の replay による資源保持、Qwik の serialize で `undefined` 化）を1つも増やさない |
| B. 出す | `semantics: "handle"` で `AudioNode` を公開し、要素間で渡せるようにする | 外部の Web Audio コードと繋げられる。だが handle が N 個になり、上記3つの失敗モードが N 倍で顕在化する |

- **推奨: A（出さない）**。外部連携が必要になったら、camera と同型の **command-token 引数素通し**（`command.connectTo(node)`）を後から1つ足せばよい。これは後方互換な追加であり、先に開けておく理由が無い。
- **帰結**: audio パッケージは「ライブハンドルのグラフを内部に持つが、プロトコル境界には値しか出さない」ノードになる。**体系にとっては既存の worker / websocket と同じ形**であり、新しい観測意味論を要求しない。

> **G2 の問い**: `AudioNode` を wcBindable に出さず内部完結とすることを不変条件として固定してよいか。

---

## 3. 決定ゲート G3 — 結線記法を汎用化するか【✅ ローカルに閉じる】

`out="bus"` / `out="vcf.frequency"` / `param="frequency"` という、`data-wcs` とは別系統の配線属性をどう位置づけるか。

- 前提: [feedback: data-wcs は配線・DSL ではない](../../CLAUDE.md) の判断基準どおり、`data-wcs` は「state のパスと要素の端点を結ぶ」ためのもの。**要素↔要素の直結は意味論が異なる**ので `data-wcs` には載せられない（載せると data-wcs が汎用配線 DSL に変質する）。

| 案 | 内容 | 評価 |
|---|---|---|
| **A. パッケージローカル属性として閉じる** | `out=` / `param=` は `@wcstack/audio` の語彙。他パッケージは使わない | 実例が1つしか無い段階で一般化しない（YAGNI）。将来 video graph / WebGPU で2例目が出たら改めて抽出 |
| B. 横断の汎用結線属性を今作る | `wire-out=` 等を全パッケージ共通語彙として規範化 | 抽象化の根拠となる実例が1つしか無い。誤った一般化のコストが高い |

- **推奨: A**。ただし **2点だけ横断規約に従わせる**:
  1. **id 解決は `getRootNode()` 起点**（`Document | ShadowRoot`）。fullscreen / pointer-lock / intersection / resize が既に統一している規約（[Fullscreen.ts:152](../../packages/fullscreen/src/components/Fullscreen.ts#L152) ほか）。synth-playground の `document.getElementById` は Shadow DOM 内で解決できず、この規約に未追随。
  2. **属性名は将来の抽出に備えて衝突しにくい語にする**。`out` は一般的すぎる（★ G3-a: `out` のままか `audio-out` にするか）。

> **G3 の問い**: 結線記法をパッケージローカルに閉じ、id 解決だけ既存の target 参照規約に揃える方針でよいか。`out` の属性名は据え置きか改名か。

---

## 4. 決定ゲート G4 — 外部クロックを持つノードの適用時刻契約【✅ desired のみ公開・wcstack 初】

これは synth-playground を読むまで体系に無かった論点である。

`AudioContext` は `currentTime` という **独自のクロックと独自のスレッド** を持つ。`param.setTargetAtTime(v, ctx.currentTime, 0.02)` は「今すぐ v になる」ではなく「オーディオスレッドのレンダークォンタム境界以降、指数的に近づく」。一方 [timing-and-firing-contract.md](../timing-and-firing-contract.md) の契約は **すべてメインスレッドの sync / microtask / task** で書かれている。

- 近い先例は raf §18.4「tick 由来の state 書き込みの DOM 反映はちょうど 1 フレーム遅延」。しかし audio の遅延はレンダークォンタム（128 サンプル）＋ `outputLatency` でハードウェア依存であり、**固定値として契約に書けない**。
- したがって wakelock の desired / actual 二相（§15.1「公開されるのは `held` だけ」）の**逆**を採る：

| 案 | 内容 | 評価 |
|---|---|---|
| **A. desired のみ公開・actual は非公開** | 書き込みは同期に受理され、getter は「最後に書いた desired 値」を返す。可聴になる時刻は保証しない（契約に明記） | 契約が書ける。同値ガードも desired 側で閉じる。利用者の期待とも一致（スライダーを動かした瞬間 UI は追従、音は数 ms 後） |
| B. actual を読み戻して公開 | `param.value` を読んで実効値を publish | 読み値がレンダークォンタム境界に依存し、同値ガードが機能しない。毎フレーム観測しないと意味が無く、raf の仕事になる |

- **推奨: A**。契約文言（timing-and-firing-contract.md に新節として追加）:
  > 入力プロパティへの書き込みは同期に受理され、getter は直ちに新しい値を返す（desired）。**その値が可聴になる時刻は AudioContext のレンダークォンタム境界と出力レイテンシに依存し、本契約では規定しない**。実効値（actual）は公開しない。

> **G4 の問い**: 「外部クロックを持つノードは desired のみ公開し、適用時刻を規定しない」を横断契約として timing-and-firing-contract.md に追加してよいか。

---

## 5. 決定ゲート G5 — 構造変更の発火契約【✅ 規範化する】

パラメータ変更は live に反映され、構造変更（タグの追加削除・`out=` の書き換え）はグラフ再構築を誘発する。再構築は **発音中の音を切る＝可聴な副作用** を伴う。

- 近い先例は resize §12.3「同一 element ＋同一 options で冪等 / 変更は teardown → 再構築で初回エントリを再配信」。同型だが、audio は再構築コストが**利用者に聞こえる**点が異なる。
- synth-playground の実装は `MutationObserver` を `subtree: true` で張り、**あらゆる DOM 変更でグラフ全体を再構築する**（[wcs-synth.js:538-539](../../examples/synth-playground/wcs-synth.js#L538-L539)）。コントロール用の `<div>` を1個足しただけで音が切れる。パッケージ品質では、監視粒度そのものが契約の一部になる。

- **推奨**: 次の3点を契約として明文化する。
  1. **rebuild を誘発する DOM 変更を列挙する**（audio タグの追加/削除/移動、`out=` `param=` `note` 属性の変更）。それ以外の DOM 変更は rebuild を誘発しない（MUST NOT）。
  2. **rebuild は発音中の音を切る**（audible discontinuity を伴う）。この副作用を README と契約に明記する。
  3. **rebuild は microtask で coalesce する**。synth-playground は `setTimeout(0)`（[wcs-synth.js:596](../../examples/synth-playground/wcs-synth.js#L596)）で、横断契約 §3「microtask が task に先行する」に未追随。

> **G5 の問い**: 上記3点を timing-and-firing-contract.md の新節として規範化してよいか。

---

## 6. 決定ゲート G6 — 見た目を持つタグを入れるか【✅ 入れない】

synth-playground には UI を描くタグが2つある（`<wcs-keys>` = 鍵盤、`<wcs-scope>` = オシロスコープの canvas 描画）。

- wcstack の公開パッケージで**見た目を持つのは `@wcstack/devtools` だけ**で、それは開発ツールという明示的な例外である。I/O ノード族は全て「Web 標準 API の宣言的ラッパー」であり、描画を持たない。
- 鍵盤・オシロは Web 標準 API のラッパーではなく UI ウィジェットである。ここを崩すと「wcstack は UI コンポーネント集でもある」という別の製品定義に踏み込む。

- **推奨: 入れない**。
  - `<wcs-analyser>`（`AnalyserNode` のデータだけ出す・描画しない）は入れる。描画は利用者が `<wcs-raf>` + canvas で行う。**これで「wcstack は見た目を持たない」不変条件が保たれる**。
  - `<wcs-keys>` は examples に残す（デモの一部であって製品ではない）。

> **G6 の問い**: 「I/O ノード族は描画を持たない」を明示的な不変条件として確認し、keys / scope をパッケージから外してよいか。

---

## 7. 帰結

1. **体系に新しい観測意味論は増えない**。handle 棚卸しは 1 のまま。adapter 側（React / signals / RxJS / Qwik）に追加の失敗モードを持ち込まない。
2. **新しいのは 2 点だけ**: (a) descriptor tree をパッチの正本とする Core 形状、(b) 外部クロックを持つノードの適用時刻契約（G4）。どちらも既存規範への**追加**であり、変更ではない。
3. **Core が DOM 非依存になる**ため、グラフの接続形状のテストが happy-dom 上で DOM 抜きに書ける（`connect` 呼び出しを記録するモック AudioContext に descriptor tree を食わせる）。実音の検証は既存の Playwright スモークが担う。
4. **`out=` は audio ローカル語彙**として閉じ、横断への昇格は 2 例目が出るまで保留する。

## 8. 決定ゲート一覧

| ゲート | 問い | 決定 |
|---|---|---|
| G1 | トポロジの正本を descriptor tree とし DOM をオーサリング面と位置づけるか | ✅ **案D**（2026-08-02 承認済） |
| G2 | `AudioNode` を wcBindable に出さない不変条件を固定するか | ✅ **案A・出さない**（2026-08-02 承認済） |
| G3 | 結線記法をパッケージローカルに閉じるか / `out` の属性名 | ✅ 案A（閉じる）。id 解決は `getRootNode()` 規約に揃える。`out` は据え置き |
| G4 | 「外部クロックを持つノードは desired のみ公開」を横断契約に追加するか | ✅ 案A（Yes）。§4 の契約文言を timing-and-firing-contract.md へ |
| G5 | rebuild 誘発条件・可聴副作用・microtask coalesce を規範化するか | ✅ Yes（§5 の3点） |
| G6 | 「I/O ノード族は描画を持たない」を不変条件として確認するか | ✅ **Yes・keys / scope は外す**（2026-08-02 承認済） |

**確定した不変条件**（新規ノードはこれに反してはならない）:

1. **ライブハンドルのトポロジは値ではない。state に置かず、descriptor（構築時に1度読まれる記述）として表現する。**
2. **ライブハンドルは Core が所有・破棄し、プロトコル境界に出さない。** 外部へ渡す必要が生じた場合のみ、camera と同型の command-token 引数素通しを追加する（後方互換な追加であり、先に開けない）。
3. **外部クロックを持つノードは desired のみ公開し、適用時刻を規定しない。**
4. **I/O ノード族は描画を持たない。**

> 先行タスクの [`@wcstack/midi`](../midi-tag-design.md) は本 ADR に依存しない（Web MIDI はハンドルもグラフも持たず、既存のノード骨格にそのまま収まる）。
