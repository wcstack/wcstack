# wc-bindable SPEC 改訂提案: applier はその要素自身のイベントだけを読む

- **提案先**: wc-bindable-protocol リポジトリ（SPEC.md と SPEC-extensions の Applier profile、protocol = `"wc-bindable"`）
- **提案元の文脈**: wcstack（`@wcstack/state` の binder、`@wcstack/signals` の `bindNode`、bubble するイベントを出す I/O ノード群）
- **状態**: wcstack 側は参照実装まで完了（2026-11-21、4.27 で出す。未リリース）。著者の決定は [v4-direction-2026-10.md](./v4-direction-2026-10.md) §5.22
- **TL;DR**: 要素の `properties[].event` を聞く applier は、`event.target` がその要素でないイベント（入れ子にした要素から bubble してきた同じ名前のイベント）を、値の読み取りにも event-token の発火にも使ってはならない（MUST NOT）。要素は bubble するイベントを出し続けてよい

---

## 1. なぜ SPEC に書く必要があるのか

SPEC は「`properties` は、要素が変化したときに dispatch するイベントを名指す」と言うが、applier がどの要素のイベントを採るかは言っていない。applier は要素に `addEventListener(event, …)` を付けるので、イベントが bubble すれば、子孫が出した同じ名前のイベントもそのリスナーに届く。

wcstack の I/O ノードは 42 のパッケージでイベントを `bubbles: true` で出す（ページが祖先の要素で聞けるように）。同じタグを入れ子にするのは普通の書き方である。可視性の監視の中にサムネイルの遅延読み込みを置く、などがそうだ。このとき:

- 要素自身は子孫のイベントを捨てていた（`<wcs-intersect>` の `event.target !== this`）。
- `@wcstack/state` 4.26 まで、`@wcstack/signals` 4.26 までは捨てていなかった。外側の束縛に、内側の要素の `detail` が書かれた。

applier によって挙動が割れ、しかも何も言わずに誤った値を書く。相互運用の契約で決めるべきことである。

## 2. 実際に起きた故障

継ぎ目アプリ town-archive（写真 12,000 点の一覧）。カードは `<wcs-intersect class="seen-probe" data-wcs="eventToken.intersecting: cardVisibility">` に包まれ、その中のサムネイルを `<wcs-intersect class="thumb-probe">` が遅延読み込みする。内側の `wcs-intersect:intersecting` が外側に bubble し、外側の `cardVisibility` は内側の entry を受け取った。そのため `entry.target`（`span.thumb`）をカードとして記録した。

- 「一覧へ戻る」の後、記録した要素に `.card-link` が無いのでフォーカスが付かない（e2e で 10 回に 1 回。CI の再試行が隠していた）。
- 「見た写真」の報告とスクロール位置のアンカーも、同じ誤った entry を読んでいた。

## 3. 提案する文言

Applier profile に次を足す（番号は上流が決める。ここでは A4）:

> **A4.** An applier that listens for a property's `event` on an element MUST use only events whose `target` is that element: to read the property's value (`getter(event)`), and to fire an event token bound to the property. An event of the same name whose `target` is another element — a descendant's event that bubbled to the element — MUST be ignored. (An event dispatched inside the element's shadow tree with `composed: true` is retargeted to the element and qualifies.)

`event.target === element` は、要素に付けたリスナーでは `event.eventPhase === Event.AT_TARGET` と同じ意味になる。

## 4. 比べた案

| 案 | 長所 | 短所 |
|---|---|---|
| applier が target を見る（提案） | 要素は今のまま。どの要素にも効く | applier ごとに数行 |
| 要素が `bubbles: false` で出す | applier は今のまま | 祖先で聞くページの振る舞いが変わる。SPEC がすべての要素に求めるのは無理で、他者の要素には効かない |
| 要素が自分のイベントの伝播を止める | applier は今のまま | ページの委譲を壊す。同上 |

## 5. wcstack の実装

- `@wcstack/state`: `dom/wc.ts` の出力プロパティのリスナーと `eventToken.*` のリスナーが、`e.target !== el` のイベントを捨てる。`#prevent` / `#stop` もそのイベントに触れない。core は +17 B だったので、ほかで削って +2 B（20,476 B）に収めた。
- `@wcstack/signals`: `bindNode` の property のシグナルと `on()` が同じ規則に従う。
- 上流の `@wc-bindable/*` アダプタは、同じ規則に揃えるよう提案に含める。

## 6. 互換

子孫のイベントで外側の束縛が動くことに頼る正しいページは、知られていない。外側でも内側のイベントを聞きたいページは、束縛ではなく自分のリスナー（または `on…:` の委譲）で聞ける。`on…:` の委譲は DOM の bubble と同じ意味のままで、この規則の対象外である。
