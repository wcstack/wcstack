# Web Animations API の実験（2026-11-21）

[animation-tag-design.md](../../animation-tag-design.md) §3 の実験の記録。`<wcs-animation>` の提案（見送り）が前提にした WAAPI の挙動と、state との継ぎ目で黙って壊れる箇所を、本物のブラウザで確かめた。結果の読み方と設計への含意は設計メモに書いた。ここには**再現に要るものだけ**を置く。

## 走らせ方

`e2e/` で `npm ci` と `npx playwright install` を済ませてから、リポジトリのルートで:

```bash
node docs/spikes/waapi-animation/probe.mjs            # P1〜P16
node docs/spikes/waapi-animation/probe-removed.mjs    # P8b（自動削除の後の再生）
```

第 1 引数で e2e のディレクトリ（既定は `e2e/`。`@playwright/test` をそこから読む）、第 2 引数で `chromium` / `firefox` / `webkit` の 1 つに絞れる。どちらのスクリプトも `page.setContent()` に置いた `<div>` 1 つに `new Animation(new KeyframeEffect(...))` を作って確かめる。待ち時間は実時間（数十〜数百 ms）。

## 環境

- Playwright 1.61.1、Chromium 149.0.7827.55、Firefox 151.0（Windows 11）
- WebKit は起動しなかった（`browserType.launch: spawn UNKNOWN`、サンドボックスの外でも同じ）。**WebKit は未確認**

## 出力（Chromium と Firefox で同一。Chromium のものを載せる）

`probe.mjs`:

```
P1_onProps                     ["onfinish","oncancel","onremove"]
P2_idleBefore                  "idle"
P2_afterPlay                   {"playState":"running","pending":true}
P2_afterReady                  {"playState":"running","pending":false}
P2_afterPause                  {"playState":"paused","pending":true}
P2_eventsAfterPlayPause        []
P2_eventsAfterCancel           ["cancel"]
P3_playAfterReverse            {"rateAfterReverse":-1,"playbackRate":-1,"currentTime":103}
P4_reverseInfiniteIdle         "InvalidStateError"
P5_finishInfinite              "InvalidStateError"
P6_inlineAfterFill             {"inline":"1","computed":"0.2","playState":"finished"}
P7_updateTimingOnFinished      {"before":"finished","after":"running","events":[]}
P8_autoRemove                  {"events":["a:remove"],"aPlayState":"finished","aReplaceState":"removed"}
P8_afterReplay                 {"aPlayState":"running","aReplaceState":"removed"}
P9_detachedTarget              {"playStateWhileDetached":"running","finishFired":true,"finalPlayState":"finished"}
P10_proxyKeyframes             2
P11_defaultTimelineIsDocument  true
P12_pauseIdle                  {"playState":"paused","currentTime":0,"computedOpacity":"0"}
P13_cancelIdleEvents           0
P14_playWhileRunning           {"before":117,"after":117}
P15_badOffsets                 "TypeError"
P15_negativeDuration           "TypeError"
P16_finishSync                 {"playStateRightAfterFinish":"finished","eventFiredSynchronously":false}
P16_finishEventLater           {"stateAtEvent":"finished"}
```

`probe-removed.mjs`（`applied` は、再生し直した a を 25 % で止めたときに不透明度が 0.8 になったか — 効いていなければ 1）:

```
noPersist    {"aReplaceStateAfterB":"removed","aPlayState":"paused","aReplaceState":"removed","computedOpacity":"1","applied":false}
withPersist  {"aReplaceStateAfterB":"persisted","aPlayState":"paused","aReplaceState":"persisted","computedOpacity":"0.8","applied":true}
```

P3 の `currentTime` は、120 ms のアニメーションで `play()` から 20 ms 後の値。終点の 120 から減っているので逆向きに進んでいる。P14 の値は回ごとに変わる（前後が同じであることを見る）。
