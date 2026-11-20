# 設計メモ: `<wcs-animation>`（Web Animations API）— 見送り

- **状態**: 見送り（2026-11-21、著者）。実装しない。見直すときの出発点として、提案・調査・実験の結果を残す。
- **対象 WebAPI**: Web Animations（`Animation` と `KeyframeEffect`。`new Animation(new KeyframeEffect(target, keyframes, timing))`）
- **関連**: [v4-direction-2026-10.md](./v4-direction-2026-10.md) §6（やらないこと）、[state-engine-rewrite/native-commands.ja.md](./state-engine-rewrite/native-commands.ja.md) §4.2・§6（`animate` の保留）、[view-transition-design.ja.md](./view-transition-design.ja.md) §10（非目標）、[io-node-candidate-screening.md](./io-node-candidate-screening.md) §1（3 ゲート）、[async-io-node-guidelines.md](./async-io-node-guidelines.md)
- **再現**: 実験のスクリプトと出力は [spikes/waapi-animation/](./spikes/waapi-animation/README.md)

---

## 0. 一言で

作れる。ただし提案の形のままでは黙って壊れる箇所が 4 つある（§4.1）。4.x の指針は新しい I/O ノードのパッケージを足さないと決めていて、需要の証拠も無い。だから見送った（§7）。

## 1. 提案

`<wcs-animation>` が `Animation` を 1 つ持ち、state が既存の command token で `play()` / `pause()` / `reverse()` / `cancel()` / `finish()` を呼ぶ。対象要素とコマンドの配線は HTML に書き、state は「いつ再生するか」だけを決める。

```html
<div id="card">カード</div>

<wcs-animation for="card"
  data-wcs="
    keyframes: pulseFrames;
    timing: pulseTiming;
    command.play: $command.playPulse;
    command.pause: $command.pausePulse;
    command.reverse: $command.reversePulse;
    playState: pulsePlayState
  ">
</wcs-animation>

<button data-wcs="onclick: showFeedback">再生</button>
<button data-wcs="onclick: $command.pausePulse">一時停止</button>
<button data-wcs="onclick: $command.reversePulse">逆再生</button>
```

```js
export default {
  $commandTokens: ["playPulse", "pausePulse", "reversePulse"],
  pulseFrames: [{ scale: "1" }, { scale: "1.08" }, { scale: "1" }],
  pulseTiming: { duration: 220, easing: "ease-out" },
  pulsePlayState: "idle",
  showFeedback() {
    this.$command.playPulse.emit();
  },
};
```

- インスタンスは最初のコマンドで作り、以後は同じものにコマンドを渡す。`pause()` で止めた位置から `play()` で再開し、`reverse()` で途中から向きを変える。
- 出力は `playState`（state）と、`finish`・`cancel`（出来事）。
- 「押すたびに先頭から」が要るなら、`play()` の意味を変えずに `restart()` を足す。

## 2. 作れるか

- **配線**: 提案の構文は 4.0 でそのまま書ける。`command.<method>: $command.<name>`（要素が `wcBindable.commands` で宣言する）、`onclick: $command.<name>`（DOM イベントから token を emit する）、`this.$command.<name>.emit()`（state README の「Command Token (Method Binding)」）。
- **3 ゲート**（[io-node-candidate-screening.md](./io-node-candidate-screening.md) §1）: fullscreen と同じグループ B（別の要素を対象にする）として通る。
  - Gate 1: Core は `document` に触れずに書ける。`new Animation(effect)` で timeline を省くと `document.timeline` になる（P11）。対象要素は fullscreen と同じく引数で受ける。
  - Gate 2: `playState` を 1 つの state 出力に、`finish` / `cancel` を `semantics: "event"` の出力にできる。
  - Gate 3: コマンドはすべて同期。投げる場合（P4・P5・P15）を捕まえれば never-throw にできる。
- **ブラウザ**: MDN の表記で、`Animation` は 2020 年 3 月から、`persist()` と `commitStyles()` は 2020 年 7 月から全ブラウザで使える。
- **state の core**: 触らない（別パッケージ）。`core.min.js` の予算に影響しない。
- **テスト**: happy-dom 20.10.6 には `Animation`・`KeyframeEffect`・`Element.animate` が無い（`getAnimations()` の宣言だけ）。単体テストは偽の WAAPI を注入し（raf のスケジューラの注入と同じ形）、挙動は Playwright で確かめることになる。SSR（happy-dom）では未対応として扱う。

## 3. 実験の結果

Chromium 149 と Firefox 151 で、全項目が一致した。WebKit は実験の環境で起動しなかった（Playwright の `spawn UNKNOWN`）ので未確認。出力は [spikes/waapi-animation/](./spikes/waapi-animation/README.md)。

| # | 確かめたこと | 結果 |
|---|---|---|
| P1 | `Animation` のイベント | `finish`・`cancel`・`remove` の 3 つだけ |
| P2 | `play()` / `pause()` のイベント | 何も来ない。`play()` の直後は `running`（`pending: true`）、`pause()` の直後は `paused`（`pending: true`）。`cancel()` では `cancel` が来る |
| P3 | `reverse()` が終わった後の `play()` | `playbackRate` は -1 のまま。逆向きに再生される |
| P4 | 無限に繰り返すアニメーション（未再生）への `reverse()` | `InvalidStateError` |
| P5 | 無限に繰り返すアニメーションへの `finish()` | `InvalidStateError` |
| P6 | `fill: "forwards"` で終わった後に inline の `opacity` を書く | inline は `1`、画面（computed）は `0.2` のまま |
| P7 | 終わったアニメーション（forwards）の `duration` を `updateTiming()` で伸ばす | `finished` から `running` に戻る。イベントは来ない |
| P8 | 同じ要素・同じプロパティに forwards のアニメーションをもう 1 つ再生する | 先のほうに `remove` が来て `replaceState` が `removed` になる。`play()` し直しても `removed` のまま |
| P8b | 削除された先のほうを、後のほうを `cancel()` してから再生し直す | 画面に効かない（不透明度は 1。効いていれば 0.8）。作るときに `persist()` しておけば効く |
| P9 | 再生中に対象要素を文書から外す | `running` のまま進み、`finish` も来る |
| P10 | キーフレームに Proxy を渡す | 動く |
| P11 | timeline を省く | `document.timeline` になる |
| P12 | 再生前に `pause()` する | `paused`・`currentTime: 0` で、最初のキーフレームで止まる（opacity 0 → 1 なら要素が見えなくなる） |
| P13 | 再生前に `cancel()` する | `cancel` は来ない |
| P14 | 再生中に `play()` する | 先頭に戻らない（`currentTime` はそのまま） |
| P15 | 順番が逆の `offset`・負の `duration` | `KeyframeEffect` のコンストラクタが `TypeError` を投げる |
| P16 | `finish()` する | `playState` はその場で `finished`。`finish` イベントは後から来る |

## 4. 提案のままでは困る点

### 4.1 黙って壊れる 4 つ

1. **`playState` の変化を知らせるイベントが無い**（P1・P2・P7）。コマンドの後、`finish` / `cancel` / `remove` の後、入力（`keyframes` / `timing`）を変えた後に読み直して出すしかない。DevTools のアニメーションパネルや `document.getAnimations()` からの操作は見えない。`currentTime` は外部の時計の値なので出力しない（[async-io-node-guidelines.md](./async-io-node-guidelines.md) §1）。
2. **`reverse()` の後の `play()` が逆向きに再生される**（P3）。提案の例で「逆再生」の後に「再生」を押すと、逆向きに動く。`play` を WAAPI の意味のままにするなら README で知らせ、`restart()` の向き（先頭から順方向か、今の向きのままか）を決める必要がある。
3. **`fill: "forwards"` が `style.*` の結び付けに勝つ**（P6）。アニメーションの効果はカスケードで inline style より上にあるので、state が `style.opacity` を書いても画面は変わらず、何も知らせない。終了時に `commitStyles()` してから `cancel()` する手はあるが、state の外から style 属性を書くことになる。
4. **同じインスタンスを使い回すと、再生しても見えなくなる**（P8・P8b）。同じ対象・同じプロパティに forwards のアニメーションが重なると、ブラウザが先のほうを自動削除する。削除されたインスタンスは、`play()` すると `playState` が `running` になり `finish` も来るのに、画面に効かない。作るときに `persist()` するか、`replaceState` が `removed` なら作り直す。

### 4.2 そのほかの論点

- **対象の指定**: 提案の `for="card"`（id）は慣例と違う。既存の 6 タグ（fullscreen・pip・pointer-lock・intersect・resize・infinite-scroll）は `target` を使い、省略すると最初の子要素（`display: contents`）、セレクタ、`self` の 3 通りに解決する（`packages/fullscreen/src/components/Fullscreen.ts` の `_resolveTarget`）。id は `for:` の行の中で重複するので、子要素を包む形がよい。`for` は data-wcs の構造ディレクティブの名前とも紛らわしい。
- **行ごとの再生**: command token は購読者の全員に同じ呼び出しを配る（state README の「Emitting a Command from a DOM Event」）。「在庫が変わった行だけ光らせる」は `$command` では書けない。行のパスに結べる入力が要る（`<wcs-fetch>` の `trigger` が前例）。
- **描画の後**: `if:` の中の要素を出した直後に emit すると、まだ描かれていない対象に届く（[native-commands.ja.md](./state-engine-rewrite/native-commands.ja.md) §4.5 の focus と同じ）。対象はコマンドのときに解決し、`$renderedCallback` から emit する。
- **reduced-motion**: 装飾なので、view-transition と同じく既定でスキップするのが筋（[view-transition-design.ja.md](./view-transition-design.ja.md) の G4。raf は機能的な出力なので既定で動かす — raf の README の「Why `reduced-motion` defaults to `run`」）。スキップを `finish()` にすれば、`playState` はその場で `finished` になり `finish` も後から来るので、「終わったら次へ」の流れが保てる（P16）。
- **失敗**: P4・P5・P15 は never-throw で `error` / `errorInfo` に置く。どちらも束ねていないページでは、4.25 の `[wcs/io-error-unobserved]` が警告する。
- **切断**: `dispose()` は変えた `playState` を出して知らせる（[timing-and-firing-contract.md](./timing-and-firing-contract.md) §22）。切断で `cancel()` したときに `cancel` の出来事を出すかは決める必要がある。対象を外しても再生は進む（P9）。
- **出来事の受け方**: `finish` / `cancel` は `semantics: "event"` の property にし（[async-io-node-guidelines.md](./async-io-node-guidelines.md) §3.3.1）、state は `eventToken.<prop>:` と `$on` で受ける。

## 5. 今の wcstack と CSS でできること

[view-transition-design.ja.md](./view-transition-design.ja.md) §1 のとおり、値の遷移（`class.*` / `style.*` ＋ CSS transition）と入場（`@starting-style`）は CSS だけでできる。

| やりたいこと | 今（CSS ＋ 結び付け） | `<wcs-animation>` |
|---|---|---|
| 一時停止・再開 | ○ `style.*` で `animation-play-state` を結ぶ | ○ |
| 終わったら state へ知らせる | ○ `onanimationend:` | ○ |
| 開閉の 2 状態を途中で反転 | ○ class の切り替え ＋ CSS transition（transition は途中から戻る） | ○ |
| 押すたびに先頭から（入力エラーで揺らすなど） | × class を外し、次のフレームで付け直す必要がある | ○ |
| 3 つ以上のキーフレームを途中で逆再生 | × | ○ |
| キーフレームを state のデータから作る | △ CSS 変数まで | ○ |
| 再生状態を読む | × | △ この要素から操作した分だけ |

## 6. 比べた案

- **native-commands の表に `animate` を足す**（`packages/state/src/native/commands.ts`。add-on なので core は増えない）。採らない。`onclick: $command.x` の経路では第 1 引数が `Event` なので引数なしで呼ばれ、`animate()` は `TypeError` になる。state から emit すれば、`emit()` の戻り値で `Animation` が state に渡り、state が対象要素への参照（`effect.target`）を持つことになる（command token は、state と要素が互いに参照を持たないことが前提）。`playState` も読めない。
- **CSS の書き方を文書にする**（先頭からやり直す書き方など）。[v4-direction-2026-10.md](./v4-direction-2026-10.md) §3.3「足さずに直す」と同じ向き。要るなら別に決める。

## 7. 見送った理由

1. **方針**: [v4-direction-2026-10.md](./v4-direction-2026-10.md) §6 の「やらないこと」に「新しい I/O ノードのパッケージを増やすこと」がある。[go-to-market-2026-08.md](./go-to-market-2026-08.md) §7 は「需要の Issue が立つまで凍結」。新しいパッケージは 2026-09-06 の media-query が最後。
2. **需要**: 継ぎ目アプリの記録（[seam-apps.md](./seam-apps.md)）にも [誤りの目録](./mistake-catalogue.md) にも、アニメーションで困った記録が無い。先頭からやり直す回避策の実例は、fw-inventory の React 側でセルの `key` を変えているもの（`examples/fw-inventory/src/react/ProductList.tsx`）だけ。
3. **沈黙**: §4.1 の 4 つは、どれもパッケージを足すと持ち込まれる、黙って壊れる箇所。4.x が減らしているものと向きが逆。
4. **費用**: パッケージ本体（Core / Shell、偽の WAAPI でカバレッジ 100/97/100/100）、実装前の設計文書、README の英日、3 ブラウザの e2e、wcstack-skill の参照の更新、以後のリリースごとの足並み。core のバイト数は使わない。

## 8. 見直す条件と、そのときの直し

見直すのは、外の作者から需要の Issue が来たときか、継ぎ目アプリで作者が「先頭からやり直す」「途中で逆再生する」に困った記録が出たとき。動きのある UI（正誤の演出など）を含む継ぎ目アプリを作れば、需要を確かめられる。

作るときは、提案を次のように直してから [async-io-node-guidelines.md](./async-io-node-guidelines.md) §1 の設計文書に進む。

- `for` をやめて `target`（3 通りの解決）にする
- 行ごとに使える `trigger` のような入力を足す
- `playState` はコマンド・イベント・入力の変更の後に読み直して出す。外からの操作は映らないと書く
- 作るときに `persist()` する（または、削除されていたら作り直す）
- `fill: "forwards"` が `style.*` に勝つことを README に書く。`commitStyles()` を使うかを決める
- reduced-motion は既定でスキップ（`finish()`）にする
- `play` / `reverse` は WAAPI の意味のままにし、`restart()` の向きを決める
- `error` / `errorInfo` を持たせる
- 切断で何を出すか（`playState`、`cancel` の出来事）を決める
- WebKit で §3 の実験をやり直す
