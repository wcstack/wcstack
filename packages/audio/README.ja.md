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

4.17（未リリース）から、ページの `AudioContext` はそのジェスチャまで作りません。それより前に作った context は開始できず、Chromium と Firefox はページの読み込み時に警告を出していました（「The AudioContext was not allowed to start…」「An AudioContext was prevented from starting automatically…」）。それまでの `state` は、ジェスチャ前のこれまでと同じく `suspended`（`running` は false、`suspended` は true）と読めます。最初の `resume()` や `noteOn()` でも作るので、`resume-on-gesture="off"` のページは自分の `command.resume` で始まり、ジェスチャ前に届いた音（MIDI キーボードからなど）も落ちません。`<wcs-audio>` が接続した時点でページが既にジェスチャを受けていれば（クリックで入ったルートなど）、すぐに作ります。自分で渡した `createContext`（`OfflineAudioContext` など）は、これまでどおり接続時に呼びます。

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

`createContext` を差し替えれば `OfflineAudioContext` へレンダリングできます — ユーザージェスチャ不要・実時間より高速・決定的な出力。本パッケージ自身のブラウザテストは、この方法でパッチが可聴であることを検証しています。ヘッドレスの Core はジェスチャを待ちません。最初の `setPatch()` で context を作るので、既定の（実時間の）context なら `setPatch()` と `resume()` をユーザー操作の中から呼んでください。

## タグ一覧

| タグ | Web Audio | 属性 |
|-----|-----------|------|
| `<wcs-audio>` | `AudioContext`（共有）+ master gain + リミッター | `volume`（0〜1） `limiter` `resume-on-gesture` |
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

**`null` と `undefined`。** 入力はすべて属性に対応します。プロパティへの書き込みは属性へ反映され、属性がそれをグラフへ届けます（live 更新で、rebuild はしません）。どの入力も `null` を「クリア」として扱います。属性を外し、入力は既定値に戻ります（`volume` は 0.8、`limiter` と `resumeOnGesture` は on、ノードのパラメータと設定値はそれぞれの既定値 — たとえば `<wcs-osc>` の `frequency` は 440、`type` は `sine`）。`undefined` は「値が無い」で、属性を最初の書き込みの前の状態 — マークアップに書かれた値、無ければ属性なし — に戻します。どちらの場合も音が追従します。どちらも文字列 `"null"` / `"undefined"` として書くことはなく、リミッターを外すこともありません（`@wcstack/state` は `undefined` を書きませんが、React 19 は値のあった prop を外したときに書き、直接の代入でも届きます）。

## live 更新と rebuild

| 変更 | 効果 |
|---|---|
| `AudioParam` の属性・プロパティ（`frequency` / `detune` / `gain` / `q` / `time` / `feedback` / `rate` / `<wcs-lfo>` の `depth`） | **live** — 約 20ms のランプで、発音中のボイスを含む全インスタンスに適用 |
| `AudioParam` でない設定値（`type` / `mix` / `amount` / エンベロープの `attack` `decay` `sustain` `release` `depth` / `glide` / `transpose` / `fft` / `smoothing`） | **live** — 発音中のボイスを含む全インスタンスに適用。`type` / `mix` / `amount` は即座に、エンベロープの時間・`glide`・`transpose` は次の音か次のエンベロープの段から |
| 構造属性（`out` / `param` / `note` / `master` / `id` / `poly`） | **rebuild** |
| audio タグの追加・削除・移動 | **rebuild** |
| それ以外の DOM 変更 | **何もしない** |

最後の行が重要です。スライダーの間に `<div>` を1つ足しただけで楽器が黙ってはいけません。rebuild は microtask で束ねられ、変化のないパッチの再投入はコストゼロです。

**rebuild は発音中のボイスを切ります。** この断絶は耳に聞こえます。構造は宣言するものであって、アニメーションさせるものではありません。束ねるのは live な値、構造はマークアップに書きます。

4.17（未リリース）から、rebuild が発音中のボイスを切ったときは `<wcs-audio>` ごとに 1 回知らせます。`console.warn` の `[wcs/audio-voices-cut]` で、何を変えたか（タグと属性、またはタグの追加・削除）と、何声切ったかを言います。よくある原因は、構造属性を state に束ねたこと — select で動かす `<wcs-voice data-wcs="poly: polyphony">`、`data-wcs="attr.out: route"` — か、audio タグを `if:` / `for:` の下に置いたことです。意図して構造を変えるなら、先に `allNotesOff` を呼んでください。何も鳴っていなければ何も言いません。

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
- **`noteOn` はそのルートの全体に届きます。** `<wcs-audio>` の中の `<wcs-voice>` はどれも各音を鳴らします — 1 つのルートに置いた 2 つの voice は重なって鳴り、2 つの楽器にはなりません。live グラフの `note` 付き oscillator とエンベロープも同じです。2 つの楽器（メロディとベース、ピアノとパッド）は 2 つの `<wcs-audio>` ルートにし、それぞれが自分の `noteOn` / `noteOff`・`volume`・`voices` を持ちます。これは安上がりです。ページに 1 つの context を共有するので、ルートを 1 つ足しても増えるのはマスター gain とリミッターで、`AudioContext` は増えません。
- **リミッターは耳の保護で、既定で有効です。** 4.17（未リリース）から、-18 dBFS（振幅 ≒ 0.126）から 4:1 で圧縮し、その後ろのハードな天井が、パッチや `volume` によらず全サンプルを -6 dBFS（振幅 0.501）以下に保ちます。上の 8 声パッチで 8 音の和音を velocity 1・既定の volume で弾いても天井の下に収まります — 4.16 のリミッター（threshold だけを設定した compressor）では約 +5 dBFS に達していました。-18 dBFS より小さい信号は、そのままの大きさで通ります（compressor の自動メイクアップゲインは打ち消しています）。`limiter="off"` は両方の段を外します。振幅を測るときに使ってください。
- **`volume` は 0〜1 です。** 4.17（未リリース）から、範囲外の値は拒まずに端へ丸めます。`volume="80"` は 1 として鳴り、1 と読め、`-1` は 0 になります。属性は書いた値のまま残ります。小さいパッチを大きくするには中の gain を上げてください。結果はリミッターが天井の下に収めます。
- **文書から外れると音が止まり、それを知らせます。** `<wcs-audio>` が外されると（`if:` の枝が消える、ルートを離れる）、ボイスは止まり、4.17（未リリース）からはそれで変わったものを publish します。`voices` は 0、`state` は `suspended`（`running` は false）になるので、それらに束ねたページは楽器が止まったことを表示します。戻ってきたら、`state` は再び context の状態を読みます。
- **`<wcs-env>` は文脈で役割が変わります**: チェーン上なら VCA、`param` 付きならそのパラメータを整形します。
- **`<wcs-env>` を持たない voice パッチ**には暗黙の 5ms アタックが付くのでクリック音が出ず、ノートオフで解放されるので鳴りっぱなしにもなりません。
- **ボイスの回収は audio クロック基準**で、タイマーは使いません — バックグラウンドタブではタイマーが1分間隔まで絞られる一方オーディオは鳴り続けるため、タイマー方式だと押鍵ごとにボイスが漏れます。
- **単位**: `glide` は秒、`detune` はセント、`transpose` は半音、`time` は秒。
- **SSR**: サーバーには `AudioContext` が無いので状態は `unsupported` になり、タグは何も描画しません。

## アクセシビリティ

**WCAG 1.4.2 Audio Control（レベル A）**: 3 秒を超えて自動再生される音声には、システム音量と独立に一時停止・停止・ミュートできる仕組みが要る — スクリーンリーダーのユーザーは、あなたの音声*越しに*リーダーを聞かなければならない。実際にはブラウザの autoplay ポリシーが正しい方向へ押してくれる（context はジェスチャまで suspended で始まる）ので、それを保つこと: 音は明示的なユーザー操作から始め、可視の停止コントロールに `suspend` コマンド（またはグラフを生かしたまま消音する `allNotesOff`）を配線する。復帰は `resume`。

## ライセンス

MIT
