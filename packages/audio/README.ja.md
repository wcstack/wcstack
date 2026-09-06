# @wcstack/audio

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/audio` は Web Audio API を HTML にします。マークアップとして書くモジュラーなオーディオグラフです。

見た目を持つ UI ウィジェットではなく、シンセサイザーでもありません。Web Audio の上に立つ**非同期プリミティブノード**の集合を、wcstack のやり方で — 宣言的に、ビルド不要・依存ゼロで — 配線したものです。

```html
<wcs-audio>
  <wcs-osc type="sawtooth" frequency="220">   <!-- 音源             -->
    <wcs-biquad type="lowpass" frequency="800">  <!-- …フィルタを通り -->
      <wcs-gain gain="0.5"></wcs-gain>        <!-- …減衰して出力へ  -->
    </wcs-biquad>
  </wcs-osc>
</wcs-audio>
```

**構造は宣言、値は反応。** グラフの形はマークアップに置き、そこを流れる数値は `@wcstack/state` から来ます。

```html
<wcs-biquad id="vcf" data-wcs="frequency: cutoff; q: resonance"></wcs-biquad>
```

## 2つのルールで全パッチが書ける

1. **入れ子が信号チェーン。** 親タグの出力が入れ子の子それぞれに流れ込むので、信号はマークアップを*下へ*流れます。葉のタグ（チェーンの子も `out` も持たないもの）はマスター出力へ繋がります。

2. **入れ子で表せないものは id で配線する。**
   - `out="bus"` — その id の要素へ音を送る。多対一なので、複数のチェーンが1つの gain で合流できます。
   - `out="vcf.frequency"` — 任意の `AudioParam` を駆動する。
   - `param="frequency"` — modulator の短縮形。*親*のパラメータを駆動します（フィルタの中に入れた LFO、オシレータの中に入れたビブラート）。

ポリフォニーは属性1つです。パッチを `<wcs-voice poly="8">` で包むと、そのサブツリーがテンプレートになります — 押鍵ごとに新しいグラフが1つ、リリーステールと最古ノートのスティール付きで作られます。voice の外ではグラフは live かつモノフォニック（last-note priority・レガート・任意の `glide`）です。

## ライブハンドルはどこにあるか

すべての `AudioNode` は Core が所有・破棄し、**プロトコル境界を越えません**。`@wcstack/worker` / `@wcstack/websocket` / `@wcstack/broadcast` が各々のハンドルを扱うのと同じです。要素が publish するのは値だけ — コンテキストの状態、発音数、警告、エラーです。

理由は [ADR-14](../../docs/architecture-hardening/14-handle-graph-wiring.ja.md) に記録しています。要約すると、**グラフのトポロジは値ではない**。diff できず、シリアライズできず、リアクティブなストアに置くべきものではありません。だからパッチは**記述（descriptor）**であり — グラフ構築時に1度だけ読まれます — DOM はそれを書く1つの方法にすぎません。`AudioGraphCore` は同じ記述を plain object としても受け取ります。だからこれは要素の抜け殻ではなく、本物のヘッドレスサーフェスです。

## インストール

```bash
npm install @wcstack/audio
```

## クイックスタート

### 1. 音の出るパッチ

```html
<script type="module" src="https://esm.run/@wcstack/audio/auto"></script>

<wcs-audio volume="0.5">
  <wcs-osc type="sine" frequency="440">
    <wcs-gain gain="0.2"></wcs-gain>
  </wcs-osc>
</wcs-audio>
```

音は最初のクリックかキー入力から始まります — ブラウザはそれ以前にページが音を出すことを許しません。`<wcs-audio>` は最初のジェスチャでコンテキストを resume します。自分で制御したい場合は `resume-on-gesture="off"` にして `command.resume` を撃ってください。

### 2. state で駆動する8声シンセ

```html
<script type="module" src="https://esm.run/@wcstack/audio/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      cutoff: 1400, resonance: 4, lfoDepth: 0, activeVoices: 0,
      $commandTokens: ["play", "stop"],
    };
  </script>

  <wcs-audio volume="0.7"
    data-wcs="command.noteOn: $command.play; command.noteOff: $command.stop; voices: activeVoices">

    <wcs-voice poly="8">
      <wcs-osc type="sawtooth" note detune="-7" out="vcf"></wcs-osc>
      <wcs-osc type="sawtooth" note detune="7" out="vcf"></wcs-osc>
      <wcs-osc type="square" note transpose="-12" out="vcf"></wcs-osc>

      <wcs-biquad id="vcf" type="lowpass" data-wcs="frequency: cutoff; q: resonance">
        <wcs-lfo type="sine" rate="4" param="frequency" data-wcs="depth: lfoDepth"></wcs-lfo>
        <wcs-env attack="0.01" decay="0.25" sustain="0.55" release="0.35" out="bus"></wcs-env>
      </wcs-biquad>
    </wcs-voice>

    <wcs-gain id="bus" gain="0.8">
      <wcs-delay time="0.28" feedback="0.35" mix="0.2"></wcs-delay>
    </wcs-gain>
  </wcs-audio>

  <input type="range" min="80" max="8000" data-wcs="value: cutoff">
  <p data-wcs="textContent: activeVoices"></p>
</wcs-state>
```

```js
state.$command.play.emit(60, 0.9);   // ノート番号・ベロシティ
state.$command.stop.emit(60);
```

### 3. ヘッドレス — DOM を使わないパッチ

```js
import { AudioGraphCore } from "@wcstack/audio";

const core = new AudioGraphCore();
core.setPatch({
  nodes: [{
    kind: "osc", key: "o1", params: { frequency: 440 },
    children: [{ kind: "gain", key: "g1", params: { gain: 0.2 } }],
  }],
});
await core.resume();
core.setParam("o1", "frequency", 880);   // live 更新・rebuild しない
core.dispose();
```

`createContext` を差し替えれば `OfflineAudioContext` へレンダリングできます — ユーザージェスチャ不要・実時間より高速・決定的な出力。本パッケージ自身のブラウザテストは、この方法でパッチが可聴であることを検証しています。

## タグ一覧

| タグ | Web Audio | 属性 |
|-----|-----------|------|
| `<wcs-audio>` | `AudioContext`（共有）+ master gain + リミッター | `volume` `limiter` `resume-on-gesture` |
| `<wcs-voice>` | 押鍵ごとのグラフ生成 | `poly` |
| `<wcs-osc>` | `OscillatorNode` | `type` `frequency` `detune` `note` `transpose`（半音） `glide`（秒） |
| `<wcs-noise>` | ループするホワイトノイズ | — |
| `<wcs-biquad>` | `BiquadFilterNode` | `type` `frequency` `q` `gain` `detune` |
| `<wcs-gain>` | `GainNode`。他のチェーンが `out` で合流する名前付きバスも兼ねる | `gain` |
| `<wcs-delay>` | `DelayNode` + feedback + dry/wet | `time` `feedback` `mix` |
| `<wcs-shaper>` | `WaveShaperNode`（ソフトクリップ） | `amount` |
| `<wcs-env>` | ADSR。チェーン上なら VCA、`param` 付きならそのパラメータのエンベロープ | `attack` `decay` `sustain` `release` `depth` `param` |
| `<wcs-lfo>` | `OscillatorNode` + depth gain（常に modulator） | `type` `rate` `depth` `param` |
| `<wcs-analyser>` | `AnalyserNode`。データのみ・描画しない | `fft` `smoothing` `master` |

どのタグも、該当する場合は配線属性 `id` / `out` / `param` / `note` を取れます。

## live 更新と rebuild

| 変更 | 効果 |
|---|---|
| 数値属性・プロパティ（`frequency` / `gain` / `attack` …） | **live** — 発音中のボイスを含む全インスタンスに適用 |
| 構造属性（`out` / `param` / `note` / `id` / `poly`） | **rebuild** |
| audio タグの追加・削除・移動 | **rebuild** |
| それ以外の DOM 変更 | **何もしない** |

最後の行が重要です。スライダーの間に `<div>` を1つ足しただけで楽器が黙ってはいけません。rebuild は microtask で束ねられ、変化のないパッチの再投入はコストゼロです。

**rebuild は発音中のボイスを切ります。** この断絶は耳に聞こえます。構造は宣言するものであって、アニメーションさせるものではありません。

## 値が可聴になる時刻について

書き込みは同期に受理され、getter は直ちに新しい値を返します。**その値が可聴になる時刻は規定しません** — コンテキストのレンダークォンタムと出力レイテンシに依存し、どちらもメインスレッドの sync / microtask / task という語彙では表現できないためです。パラメータ変更はクリック音を防ぐため約 20ms で平滑化され、実効値は読み戻しません（`frequency` は最後に書いた値を返します）。

## `:state()` による CSS スタイリング

```css
wcs-audio:state(running)     { --led: limegreen; }
wcs-audio:state(suspended)   { --led: goldenrod; }
wcs-audio:state(unsupported) { --led: dimgray; }
wcs-audio:state(error)       { --led: crimson; }
```

デバッグ中は `debug-states` 属性を付けると `data-wcs-state-*` にもミラーされます。

## オシロスコープを描く

`<wcs-analyser>` はデータを出すだけで描画しません（wcstack の I/O ノードは描画を持ちません）。`@wcstack/raf` と自前の canvas を組み合わせてください。

```html
<wcs-raf data-wcs="eventToken.tick: onTick"></wcs-raf>
<wcs-analyser id="scope" master data-wcs="command.sample: $command.grab; eventToken.frame: onFrame"></wcs-analyser>
```

`sample()` は毎回**新しく確保した**配列を返すので、フレームを保持しても安全です。

## 注意点

- **コンテキストは共有です。** ブラウザは同時 `AudioContext` 数を制限するため、ページ上の全 `<wcs-audio>` が1つを使います。`Symbol.for` レジストリ経由なのでバンドルが2コピー読み込まれても1つに収束します。マスター gain とリミッターはルートごとに持ちます。
- **リミッターは思ったより早く効きます。** 閾値は -18 dBFS（振幅 ≒ 0.126）で、フルスケールよりかなり下です — それが狙いで、耳の保護のためです。振幅を測る用途なら閾値より下に収めるか `limiter="off"` にしてください。
- **`<wcs-env>` は文脈で役割が変わります**: チェーン上なら VCA、`param` 付きならそのパラメータを整形します。
- **`<wcs-env>` を持たない voice パッチ**には暗黙の 5ms アタックが付くのでクリック音が出ず、ノートオフで解放されるので鳴りっぱなしにもなりません。
- **ボイスの回収は audio クロック基準**で、タイマーは使いません — バックグラウンドタブではタイマーが1分間隔まで絞られる一方オーディオは鳴り続けるため、タイマー方式だと押鍵ごとにボイスが漏れます。
- **単位**: `glide` は秒、`detune` はセント、`transpose` は半音、`time` は秒。
- **SSR**: サーバーには `AudioContext` が無いので状態は `unsupported` になり、タグは何も描画しません。

## アクセシビリティ

**WCAG 1.4.2 Audio Control（レベル A）**: 3 秒を超えて自動再生される音声には、システム音量と独立に一時停止・停止・ミュートできる仕組みが要る — スクリーンリーダーのユーザーは、あなたの音声*越しに*リーダーを聞かなければならない。実際にはブラウザの autoplay ポリシーが正しい方向へ押してくれる（context はジェスチャまで suspended で始まる）ので、それを保つこと: 音は明示的なユーザー操作から始め、可視の停止コントロールに `suspend` コマンド（またはグラフを生かしたまま消音する `allNotesOff`）を配線する。復帰は `resume`。

## ライセンス

MIT
