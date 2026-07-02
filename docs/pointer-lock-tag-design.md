# 設計メモ: `@wcstack/pointer-lock`（`<wcs-pointer-lock target="...">`）

- **状態**: 設計検討中（未実装）。本文書は実装前の論点整理と決定事項のスナップショット。
- **対象 WebAPI**: Pointer Lock API（`Element.requestPointerLock()` / `document.exitPointerLock()` / `document.pointerLockElement` / `document` への `pointerlockchange` イベント）
- **位置づけ**: [io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) バッチ1（target解決パターン）の3本目、**バッチ内で最も優先度が低い**。[fullscreen-tag-design.md](./fullscreen-tag-design.md) を基本パターンとして参照し、`target`解決・API解決層・`_gen`世代ガード・`error`表現の再導出は行わない。
- **前提資産**: [fullscreen-tag-design.md](./fullscreen-tag-design.md)（本ノードの基本形。`pointerlockchange`も`document`に発火する点でfullscreenchangeと同型）、`intersection`（`_resolveTarget()`/`_safeQuery()`原典）。

---

## 0. なぜ優先度が低いか

Fullscreen/PiPは動画プレイヤー・画像ギャラリーといった**wcstackの典型的な宣言的SPA構築の対象範囲内**で広く使われるユースケースを持つ。一方Pointer Lock APIの用途はほぼ排他的に**ゲーム・canvas/WebGL描画UIにおけるマウスの相対移動量取得**（FPS視点操作・お絵描きツールのパン操作等）に限られ、宣言的なデータバインディングでUIを組み立てるという本プロジェクトの主眼からは外れている。

- ゲーム/描画UIはそもそも命令的な`requestAnimationFrame`ループで状態を持つことが多く、`state`の宣言的バインディングと組み合わせる動機が他のIOノードほど強くない。
- 本バッチ内（Fullscreen/PiP/Pointer Lock）で比較すると、Fullscreen/PiPは「コンテンツをどう見せるか」という表示レイヤの制御に閉じるのに対し、Pointer Lockは「入力をどう解釈するか」という別レイヤの関心事であり、単独ノードとしての需要の確度が相対的に低い。

このため、**実装着手はバッチ内の実需要確認後に行うべき**と位置づける（[io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) バッチ1の実装順「Fullscreen → Picture-in-Picture → Pointer Lock」の末尾に対応）。設計自体はFullscreen/PiPと同型で先に確定できるため、本書はその下敷きとして先に用意しておく。

---

## 1. 基本パターンの継承

以下はfullscreen-tag-designと**同一の決定**であり、本書では繰り返さない。

- `target`属性による3モード解決（`self`/セレクタ/子要素省略）と`_safeQuery`のnever-throwラップ（[fullscreen-tag-design.md §1](./fullscreen-tag-design.md#1-target解決--決定-intersectionの3モードをそのまま転用)）
- `document`単位の状態を都度比較する設計（`pointerLockElement`もdocument全体で1つ、[fullscreen-tag-design.md §2](./fullscreen-tag-design.md#2-active状態の判定方法--決定-documentfullscreenelement--targetの都度比較)）
- `pointerlockchange`は`fullscreenchange`と同じく**`document`に対して発火する**（target要素にではない）。Coreのリスナーは`document`に張り、`document.pointerLockElement === 解決済みtarget`で自己判定する（[fullscreen-tag-design.md §5](./fullscreen-tag-design.md#5-fullscreenchangeの購読先--決定-documentに張るtarget要素にではない)と同型。Picture-in-Pictureの「target要素自身に発火する」非対称パターンとは異なり、こちらはfullscreenと同じ挙動）
- API解決は呼び出し時・非キャッシュ（[fullscreen-tag-design.md §4](./fullscreen-tag-design.md#4-ベンダープレフィックス吸収--決定-api解決層呼び出し時解決で標準名とレガシー名を両方プローブ)）。Pointer Lockにも一部ブラウザでベンダープレフィックス（`webkitRequestPointerLock`等）の実装が残る可能性があり、同じ吸収層を用いる。
- `_gen`世代ガードはCore単位で1つ（[fullscreen-tag-design.md §6](./fullscreen-tag-design.md#6-_gen世代ガード--決定-core単位で1つfetchuploadと同型)）
- `error`は単純な1フィールドのみ（[fullscreen-tag-design.md §8](./fullscreen-tag-design.md#8-errorプロパティの扱い--決定-単純なerrorのみpermissionの4値のような複合状態は不要)）。`requestPointerLock()`もuser gesture文脈が必須で、gesture外呼び出しはreject → never-throwで`error`へ（[fullscreen-tag-design.md §3](./fullscreen-tag-design.md#3-requestfullscreenのuser-gesture制約--決定-never-throwでcatchし責務は呼び出し元にあると明記)と同型の制約・同型の責務分担）

---

## 2. wcBindable仕様

```typescript
static wcBindable: IWcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "active", event: "wcs-pointer-lock:change", getter: (e: Event) => (e as CustomEvent).detail.active },
  ],
  inputs: [{ name: "target", attribute: "target" }],
  commands: [
    { name: "requestPointerLock", async: true },
    { name: "exitPointerLock" },
  ],
};
```

- `active`は`document.pointerLockElement === 解決済みtarget`の都度比較（fullscreenの`active`と同型）。`detail`は`{ active }`形式（bare booleanではない）でfullscreenの`active`イベント形状と一致させる。
- `exitPointerLock()`は仕様上Promiseを返さない同期API（`document.exitPointerLock()`はvoidを返す）ため`async`フラグを付けない——fullscreen/PiPの`exitXxx`（Promiseベース）との差異はここのみ。command自体はnever-throwで`try/catch`する（同期呼び出しでも例外を投げうる実装があるため防御的に包む）。
- 何もロックされていない状態での`exitPointerLock()`は、fullscreenの`exitFullscreen()`と同じ理由でsilent no-opとする（[fullscreen-tag-design.md §7](./fullscreen-tag-design.md#7-exitfullscreenが何もfullscreenでない時の挙動--決定-silent-no-opresolve)を参照、再導出しない）。

---

## 3. スコープ決定 — **決定: v1では`movementX`/`movementY`を公開しない**

Pointer Lock中は`mousemove`イベントの`movementX`/`movementY`（前フレームからの相対移動量）が取得できるようになるが、これは本ノードの`properties`には含めない。

- **決定: v1のobservable surfaceには`movementX`/`movementY`を含めない** ✅。
  - 理由: `mousemove`は高頻度イベント（環境によっては数百Hz相当で発火しうる）であり、これを他の宣言的プロパティ（`active`等）と同じ「同値ガード付きイベント→state反映」の形にそのまま混ぜると、毎フレームstateの再計算・DOM反映が走りうる。本ノードの宣言的surfaceの単純さ（`active`のON/OFFのみ）を壊し、パフォーマンス問題（過剰な再描画・reactiveなwatcherの発火過多）を招くリスクが高い。
  - `wc-bindable-protocol`の`properties`は「値が変わったら`state`側へ伝播する」ことを前提にした設計であり、高頻度・大量データの垂れ流しに向いた仕組みではない。既存ノードでも高頻度データ（例: `resize`の連続リサイズ、`intersection`の連続スクロール）は同値ガードや`once`ラッチで発火頻度を抑えている前例があり、Pointer Lockの生の`movementX`/`movementY`をそのまま流すのはこの設計哲学と相容れない。
- ~~`movementX`/`movementY`を`properties`に含め、毎`mousemove`ごとに`wcs-pointer-lock:move`のようなイベントで流す~~ — 不採用（今回のスコープでは）。理由は上記の高頻度問題に加え、そのような値は多くの場合`canvas`への直接描画や命令的なゲームループで消費されるものであり、宣言的バインディングを介す必然性が薄い。
- **将来追加する場合の設計方針**: 需要が具体化した場合は、既存の`@wcstack/debounce`/`@wcstack/throttle`パッケージとの組み合わせを前提に設計すべきである。例えば「生の`movementX`/`movementY`イベントを`wcs-pointer-lock:move`として発火し、利用側が`filter`パイプラインや`throttle`ノードを介して間引く」構成であれば、本ノードの責務（ロック状態の管理）と間引きの責務（`throttle`）を分離でき、`async-io-node-guidelines.md`の「debounce/throttleは利用者責務にする」方針（§1「同値ガードのみで十分か」の論点）とも整合する。この場合でも既定でOFF（`movement`購読は明示的な属性やcommandで opt-in させる）にし、購読していないインスタンスに不要なオーバーヘッドを負わせない設計にすべき。

---

## 4. Shell属性・autoTrigger

fullscreenと同型（[fullscreen-tag-design.md §9](./fullscreen-tag-design.md#9-shell属性autotrigger)）。`target`属性のみ、autoTriggerは初版では持たない。`requestPointerLock()`もgesture文脈必須のため、起動経路はcommand-token（`command.click:$command.requestPointerLock`）を主とする。

---

## 5. テスト方針（happy-domの差分のみ）

fullscreen-tag-designのテスト観点（§11参照。3モード解決・gesture外reject・`_gen`ガード・複数インスタンス・SSR等）をそのまま流用し、以下の差分のみ追加する。

- `exitPointerLock()`が同期APIとして扱われる（`async: true`を持たない）ことの確認。ただしCore内部は例外を握るため、同期例外を投げる偽実装でもnever-throwが保たれることをテストする。
- `movementX`/`movementY`が`properties`/イベントのどこにも現れないこと（スコープ外であることの回帰確認）。
- `pointerlockchange`の`document`購読・自己判定（`pointerLockElement === 解決済みtarget`）が複数インスタンス下で正しく分離されること（fullscreenの複数インスタンステストと同型）。

---

## 6. 決定事項まとめ

| 論点 | 決定 |
|---|---|
| 優先度 | バッチ内最低。用途がゲーム/canvas・WebGL限定でwcstackの宣言的SPA主眼から外れるため、実装は実需要確認後 |
| 基本パターン | [fullscreen-tag-design.md](./fullscreen-tag-design.md) と同一（target解決・document購読・API解決層・`_gen`・error表現） |
| §2 active判定 | `document.pointerLockElement === 解決済みtarget`の都度比較 |
| §2 exitPointerLock | 同期API（`async`なし）。何もロックされていない時はsilent no-op |
| §3 movementX/Y | **v1スコープ外**。高頻度イベントであり宣言的surfaceに混ぜるとパフォーマンス問題。将来追加時は`debounce`/`throttle`パッケージとの組み合わせ前提で設計 |
| §4 autoTrigger | 初版では無し。command-tokenが主経路 |
| パッケージ/タグ | `@wcstack/pointer-lock` / `<wcs-pointer-lock target="...">` / Shell `WcsPointerLock` |

---

## 7. 実装順の推奨

**バッチ内の実装順は最後**（Fullscreen → Picture-in-Picture → Pointer Lock）。着手は実需要確認後とする。着手する場合の手順:

1. `PointerLockCore`（`FullscreenCore`をコピーし、`fullscreenElement`→`pointerLockElement`、`exitPointerLock`を同期API扱いに変更）。
2. Shell `<wcs-pointer-lock target="...">`（`intersection`由来の`_resolveTarget()`/`_safeQuery()`はfullscreenの実装をそのまま再利用）。
3. Fake double（`document.pointerLockElement`可変化、`pointerlockchange`手動発火）とテスト一式（§5の差分を中心に、fullscreenのテストスイートを土台に複製）。
4. example: canvas/WebGLの視点操作デモ（`command.click:$command.requestPointerLock`でロック開始、`Esc`キーでの自動解除は仕様側の挙動なので`pointerlockchange`経由で`active`が追従することを示す）。
5. README ja/en（用途がゲーム/描画UI限定である旨、`movementX`/`movementY`は将来課題である旨を明記）。
