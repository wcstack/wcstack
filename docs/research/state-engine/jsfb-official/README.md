# js-framework-benchmark（公式ハーネス）: state-next と signals

計測 2026-09-26。公式リポジトリ krausest/js-framework-benchmark（`f2df01a`、2026-09-20）の `webdriver-ts` を、手元の機械でそのまま使った。

## 条件

- Windows 11、Chrome 153（`--headless=new`）、puppeteer ランナー。CPU の項目は既定の 15 回（select row は 25 回）、公式の CPU スロットル。
- 比べた実装（すべて公式の `isKeyed` 判定を通過）:

| 名前 | 中身 |
|---|---|
| `vanillajs` | 公式の参照実装（そのまま） |
| `wcstack-signals` | `packages/signals/__e2e__/benchmark/index.html`（`dom.esm.min.js`＋core チャンク） |
| `wcstack-state-next` | `packages/state/__e2e__/benchmark/index.html` を `packages/state-next/dist/auto.min.js`（core＋後付け 8 つ）で。`4955ab52` からビルド |
| `wcstack-state-next-compact` | 上と同じで、行の `<template>` の空白だけを除いたもの |
| `wcstack-state-next-core` | 上と同じページを `dist/core.min.js`（core だけ）で |
| `wcstack-state` | 同じページを現行 3.3.0 の `packages/state/dist/auto.min.js` で |

- ページは CSS とスクリプトのパスだけを書き換えた（`pages/`）。選択は、state が `selectedIndex`＋`$untrackDependency` の getter、signals が行ごとの class の effect で、どちらもリポジトリの参照ページのとおり。
- 起動（Lighthouse の 31〜34）は、ハーネスの既定の集合にも公式の結果表にも入っていないので測っていない。

## 結果

値は中央値、括弧はその表の中で最速との比、幾何平均の重みは公式の結果表（`webdriver-ts-results/src/Common.ts`）と同じ。

**CPU の加重幾何平均**（小さいほど速い）

| | vanillajs | signals | state-next | state-next-compact | state 3.3.0 |
|---|---:|---:|---:|---:|---:|
| 1 回目（`results-pass1/`） | 1.02 | 1.25 | **1.11** | — | 1.51 |
| 2 回目（`results-pass2-cpu/`） | 1.03 | 1.21 | **1.08** | 1.08 | — |

**CPU の項目ごと（2 回目、ms）**

| 項目 | vanillajs | signals | state-next | うち script（signals / state-next） |
|---|---:|---:|---:|---:|
| create rows（1k） | 60.9 | 74.5 | **61.6** | 17.0 / 6.7 |
| replace all rows（1k） | 62.5 | 77.7 | **66.8** | 22.8 / 12.5 |
| partial update（4x） | 44.3 | **44.4** | 46.4 | 2.6 / 4.8 |
| select row（4x） | 14.8 | 18.8 | **16.0** | 4.2 / 2.4 |
| swap rows（4x） | 46.1 | 52.4 | **48.8** | 6.1 / 4.7 |
| remove row（2x） | 34.3 | **26.8** | 32.9 | 2.2 / 2.6 |
| create many rows（10k） | 612.6 | 746.3 | **649.0** | 130.7 / 67.9 |
| append 1k to 1k（2x） | 65.2 | 81.0 | **67.6** | 17.0 / 7.1 |
| clear 1k rows（4x） | 20.2 | 34.4 | **22.6** | 29.4 / 18.9 |

- script（JS の時間）だけの幾何平均は signals 3.13、state-next 2.11（vanillajs を 1 とする）。paint（style・layout・paint）は 4 つとも 1.04〜1.08 でそろっていて、差はほぼすべて JS の時間から来ている。
- state-next の JS が signals より明確に遅いのは partial update だけ（2 回とも約 1.8 倍。`this[\`data.${i}.label\`] += …` の 100 回の書き込みが、パス文字列の解決を通るため）。remove row の合計の差は paint の揺れで、script は 2.6 対 2.2。
- 行の `<template>` の空白を除いても（compact）変わらない。試運転の 1 回で paint が大きく見えたのは揺れだった。

**メモリ（2 回目、3 回の中央値、MB）**

| 項目 | vanillajs | signals | state-next（全部入り） | state-next-core | state 3.3.0（1 回目） |
|---|---:|---:|---:|---:|---:|
| ready memory | 0.57 | 0.63 | 1.06 | 0.85 | 1.57 |
| run memory（1k 行） | 2.03 | 3.72 | 2.87 | **2.61** | 6.23 |
| create/clear 1k ×5 | 0.65 | 0.90 | 1.48 | 1.18 | 5.65 |
| 幾何平均 | 1.00 | **1.40** | 1.81 | 1.51 | 4.17 |

- 1,000 行を持ったときは state-next の方が軽い（signals は行ごとに signal と effect を持つ）。読み込み直後と、作成と消去を 5 回くり返した後は signals の方が軽い。

**サイズと first paint（2 回目。first paint は 5 回の中央値）**

| 項目 | vanillajs | signals | state-next（全部入り） | state-next-core |
|---|---:|---:|---:|---:|
| 非圧縮（KB） | 11.7 | 21.2 | 111.9 | 59.6 |
| 圧縮（brotli、KB） | 2.5 | 7.9 | 35.4 | 20.3 |
| first paint（ms） | 157.9 | 175.0 | 186.4 | 148.7 |

- first paint は同じ実装でも 133〜232ms に散らばり、差を読めない。1 回目の state-next 301ms・state 3.3.0 502ms は各 1 回だけの値。

## 再現

```
git clone --depth 1 --filter=blob:none --sparse https://github.com/krausest/js-framework-benchmark.git jsfb
cd jsfb && git sparse-checkout set server webdriver-ts webdriver-ts-results css frameworks/keyed/vanillajs
mkdir -p frameworks/non-keyed   # サーバの一覧が要求する
(cd server && npm ci) && (cd webdriver-ts && npm ci && npm run compile)
# pages/<名前>/ を frameworks/keyed/<名前>/ に置き、dist/ にバンドルを写し、空の package-lock.json を足す
(cd server && npm start) &
cd webdriver-ts && node dist/benchmarkRunner.js --headless --framework keyed/vanillajs keyed/wcstack-signals keyed/wcstack-state-next
node ../summarize.mjs results
```

## 4.0.0-rc.2 の計測（2026-10-04）

同じハーネス（`f2df01a`）を新しく clone して、4.0.0-rc.2・3.5.4・signals・vanillajs を 1 回のセッションで測った（`results-rc2/`、`summary-rc2.json`）。

- Windows 11、Chrome 154（`--headless=new`）、puppeteer ランナー、既定の回数と CPU スロットル。4 つとも公式の `isKeyed` を通過。ハーネスの妥当性検査も通過。
- `wcstack-state-4`（`pages/wcstack-state-4/`）と `wcstack-state-3`（`pages/wcstack-state-3/`）は、同じページ（`packages/state/__e2e__/benchmark/index.html`。getter は正式名の `$untracked`。旧名 `$untrackDependency` は 4.0 で外れた）を、それぞれ 4.0.0-rc.2 の `dist/auto.min.js`（全部入り）と v3.5.4 の `dist/auto.min.js`（タグ `v3.5.4` から）で読む。
- `wcstack-signals` は 9 月と同じページで、rc.2 のビルド（`dom.esm.min.js`＋core チャンク）。signals の src は 3.5.4 から変わっていない（版だけ）。

**CPU の加重幾何平均**（小さいほど速い）: vanillajs 1.02、signals 1.20、**4.0.0-rc.2 1.06**、3.5.4 1.44。script（JS の時間）だけの幾何平均（vanillajs を 1）: signals 2.97、4.0 2.02、3.5.4 6.25。paint は 4 つとも 1.03〜1.07。

| 項目（ms、中央値） | vanillajs | signals | 3.5.4 | 4.0.0-rc.2 |
|---|---:|---:|---:|---:|
| create rows（1k） | 57.8 | 72.7 | 82.2 | 61.0 |
| replace all rows（1k） | 62.7 | 77.2 | 93.3 | 62.1 |
| partial update（4x） | 36.9 | 40.2 | 38.6 | 39.2 |
| select row（4x） | 13.3 | 13.7 | 12.5 | 12.3 |
| swap rows（4x） | 35.6 | 39.4 | 41.1 | 37.4 |
| remove row（2x） | 28.4 | 27.0 | 35.4 | 26.2 |
| create many rows（10k） | 646.6 | 772.2 | 1048.9 | 672.9 |
| append 1k to 1k（2x） | 63.6 | 82.3 | 111.0 | 69.1 |
| clear 1k rows（4x） | 22.7 | 32.4 | 42.3 | 28.3 |

- 3.5.4 との差が大きいのは、行を作る・消す項目（create 10k は 1048.9 → 672.9ms、append は 1.75 → 1.09 倍、clear は 1.86 → 1.25 倍、remove は 1.35 → 1.00 倍）。3.5.4 の script は create 10k で 413.5ms、4.0 は 65.1ms。
- 4.0 が vanillajs から離れているのは clear（1.25 倍。script 23.2 対 18.4ms）と、script だけで見た partial update（4.0 対 signals 2.5ms。9 月と同じく、`this[\`data.${i}.label\`]` の書き込みがパス文字列の解決を通るため）。
- 9 月の 2 回目（vanillajs 1.03、signals 1.21、state-next 1.08）と比べて、CPU は揺れの範囲で変わっていない。

**メモリ（MB、中央値）**

| 項目 | vanillajs | signals | 3.5.4 | 4.0.0-rc.2 |
|---|---:|---:|---:|---:|
| ready memory | 0.55 | 0.61 | 1.73 | 1.19 |
| run memory（1k 行） | 2.03 | 3.72 | 6.32 | 2.95 |
| create/clear 1k ×5 | 0.65 | 0.91 | 5.77 | 1.65 |
| 幾何平均 | 1.00 | 1.42 | 4.42 | 2.00 |

- 1,000 行を持ったときは 4.0 が signals より軽く、3.5.4 の半分以下。読み込み直後と、作成と消去のくり返しの後は signals の方が軽い。9 月の state-next（1.06 / 2.87 / 1.48）より少し重い。

**サイズと first paint**

| 項目 | vanillajs | signals | 3.5.4 | 4.0.0-rc.2 |
|---|---:|---:|---:|---:|
| 非圧縮（KB） | 11.7 | 21.2 | 290.9 | 133.7 |
| 圧縮（brotli、KB） | 2.5 | 7.9 | 75.2 | 42.6 |
| first paint（ms、1 回） | 112.3 | 174.6 | 499.7 | 244.9 |

- 4.0 の値は全部入りの `auto.min.js`（後付けの機能をすべて含む）。9 月の state-next（`4955ab52`）の 111.9 / 35.4KB から増えた。core だけ（`/core`）のページは今回は測っていない。
- first paint は 1 回ずつの値で、9 月に同じ実装で 133〜232ms に散らばったので、差は読めない。
