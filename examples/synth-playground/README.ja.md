# synth-playground — HTML タグで組むモジュラーシンセ

8 ボイスのポリシンセとモノベースを、
[`@wcstack/audio`](../../packages/audio/README.ja.md) と
[`@wcstack/midi`](../../packages/midi/README.ja.md) だけで、ビルドレス・依存ゼロで
組み上げたデモです。画面上の鍵盤・PC キーボード・MIDI キーボードのどれからでも
演奏できます。

```bash
npx serve examples/synth-playground
# リポジトリ全体を配信する場合: cd e2e && npm run serve
```

音が出るのは最初のクリック / キー押下からです（ブラウザの autoplay ポリシー）。
`<wcs-midi>` は Web MIDI が必要（Chromium 系のみ）。それ以外はどこでも動きます。

> 元は 1,000 行の `wcs-synth.js` を抱えた使い捨ての実験でした。そのファイルは
> もうありません — 試作したタグは公開パッケージになり、その昇格を可能にした
> 決定は [ADR-14](../../docs/architecture-hardening/14-handle-graph-wiring.md)
> に記録してあります。

## 見どころ

**ページがそのままパッチ。** ソースを開けば楽器の全体が読めます: ネストが信号の
連鎖、`out="bus"` がグラフを跨いだ送り、`param="frequency"` が LFO を変調先の
フィルタにぶら下げます。

**構造は宣言、値はリアクティブ。** スライダーはどれも `data-wcs` で `<wcs-state>`
に束ねただけの普通の `<input>` で、state はただのプロパティ書き込みとして
オーディオノードを駆動します。このページは Web Audio API を一度も呼びません。

**普通の DOM がパッチの中に同居する。** `.controls` グリッドは `<wcs-audio>` の
中、`<wcs-analyser>` の直後にあります。そこにマークアップを足してもグラフは
再構築されません — 構造変更は鳴っているボイスを全部切ってしまうので、ルートは
mutation observer をオーディオ要素だけに絞り込んでいます。

**描画はページの仕事。** `demo-ui.js` が持つ `<demo-keys>` と `<demo-scope>` は、
意図的にパッケージの外に置いています。wcstack の I/O ノードは描画を持たないので、
`<wcs-analyser>` はデータを出し、描くのはデモ側です。

**MIDI は独立している。** `<wcs-midi>` はメッセージを state にするだけで、note-on
がこのシンセを鳴らすという判断は `$on` ハンドラが下します。2 つのパッケージが
互いに結合することはありません。

## パッチ

```
poly synth (8 voices)
  3 × wcs-osc ──out="vcf"──▶ wcs-biquad (lowpass)
                               ├── wcs-lfo   param="frequency"   (cutoff wobble)
                               └── wcs-env   out="bus"           (VCA)
  wcs-gain#bus ──▶ wcs-delay ──▶ master
  wcs-analyser[master] ──▶ demo-scope

mono bass
  2 × wcs-osc (glide) ──out="bflt"──▶ wcs-biquad ──▶ wcs-env ──▶ master
```
