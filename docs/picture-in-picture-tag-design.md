# 設計メモ: `@wcstack/picture-in-picture`（`<wcs-pip target="...">`）

- **状態**: 設計検討中（未実装）。本文書は実装前の論点整理と決定事項のスナップショット。
- **対象 WebAPI**: Picture-in-Picture API（`HTMLVideoElement.requestPictureInPicture()` / `exitPictureInPicture()` / `document.pictureInPictureElement` / `enterpictureinpicture` / `leavepictureinpicture`）
- **位置づけ**: [io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) バッチ1（target解決パターン）の2本目。**[fullscreen-tag-design.md](./fullscreen-tag-design.md) と同じ基本パターン**を採用する差分ドキュメント。`target`解決の詳細な根拠・`_resolveTarget()`の転用理由・`_gen`世代ガードの考え方・`error`の扱いの是非は再導出せず、fullscreen-tag-designを参照する。
- **前提資産**: [fullscreen-tag-design.md](./fullscreen-tag-design.md)（本ノードの基本形）、`intersection`（`_resolveTarget()`/`_safeQuery()`原典）。

---

## 0. 基本パターンの継承

以下はfullscreen-tag-designと**同一の決定**であり、本書では繰り返さない。差分がある箇所のみ以下の各節で扱う。

- `target`属性による3モード解決（`self`/セレクタ/子要素省略）と`_safeQuery`のnever-throwラップ（[fullscreen-tag-design.md §1](./fullscreen-tag-design.md#1-target解決--決定-intersectionの3モードをそのまま転用)）
- `document`単位の状態を都度比較する設計（`pictureInPictureElement`もdocument全体で1つ、[fullscreen-tag-design.md §2](./fullscreen-tag-design.md#2-active状態の判定方法--決定-documentfullscreenelement--targetの都度比較)）
- API解決は呼び出し時・非キャッシュ（[fullscreen-tag-design.md §4](./fullscreen-tag-design.md#4-ベンダープレフィックス吸収--決定-api解決層呼び出し時解決で標準名とレガシー名を両方プローブ)）
- `_gen`世代ガードはCore単位で1つ（[fullscreen-tag-design.md §6](./fullscreen-tag-design.md#6-_gen世代ガード--決定-core単位で1つfetchuploadと同型)）
- `error`は単純な1フィールドのみ、permissionの4値stateは不要（[fullscreen-tag-design.md §8](./fullscreen-tag-design.md#8-errorプロパティの扱い--決定-単純なerrorのみpermissionの4値のような複合状態は不要)）
- SSR: `ready`は`Promise.resolve()`固定（[fullscreen-tag-design.md §10](./fullscreen-tag-design.md#10-ssr--ready)）

---

## 1. wcBindable仕様

```typescript
static wcBindable: IWcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "active", event: "wcs-pip:change", getter: (e: Event) => (e as CustomEvent).detail.active },
  ],
  inputs: [{ name: "target", attribute: "target" }],
  commands: [
    { name: "requestPictureInPicture", async: true },
    { name: "exitPictureInPicture", async: true },
  ],
};
```

`document.pictureInPictureElement === 解決済みtarget`で`active`を判定する。fullscreenの`document.fullscreenElement`比較と一字一句同型（[fullscreen-tag-design.md §2](./fullscreen-tag-design.md#2-active状態の判定方法--決定-documentfullscreenelement--targetの都度比較)）で、`pictureinpicturechange`相当のイベント（後述§3）受信時に自身の解決済みtargetと比較する。

---

## 2. このノード固有の制約 — **決定: targetは`<video>`要素でなければならない**

Fullscreenと異なり、Picture-in-Picture APIは`HTMLVideoElement`のインスタンスメソッドとしてのみ定義されている。任意の`Element`には存在しない。

- **決定: `_resolveTarget()`の解決結果に対して`tagName === "VIDEO"`検証を追加する** ✅。`intersection`由来の3モード解決自体は無改変で使うが、その戻り値の`element`を使う前に本ノード固有の型チェックを1段挟む。

```typescript
private _resolveVideoTarget(): { element: HTMLVideoElement | null; display: string } {
  const { element, display } = this._resolveTarget(); // intersection由来、無改変
  if (element !== null && element.tagName !== "VIDEO") {
    // 不一致はnever-throwでerrorへ。要素そのものは無視し「未解決」と同じ扱いにする。
    return { element: null, display };
  }
  return { element: element as HTMLVideoElement | null, display };
}
```

- **不一致時の扱い**: 例外を投げない（never-throw原則）。`error`プロパティに`{ message: "target must be a <video> element." }`のような情報を格納し、`element: null`として以降の解決失敗パス（fullscreenの「targetが見つからない」パスと同じ）に合流させる。
- `requestPictureInPicture()`/`exitPictureInPicture()`のcommand呼び出し時にこの検証を通し、`<video>`でなければ即座に`error`をセットしてresolveする（gesture制約チェックより前に行ってよい——型不一致は環境非依存の恒久的なエラーであり、gesture文脈の有無とは独立した別の失敗理由）。

---

## 3. イベント購読先 — `document`（fullscreenchangeと同型、ただしイベント名が異なる）

Picture-in-Picture APIのイベントは`enterpictureinpicture`/`leavepictureinpicture`で、これは**`fullscreenchange`と違い`document`にではなく対象の`<video>`要素自身に発火する**（Fullscreenの非対称性、[fullscreen-tag-design.md §5](./fullscreen-tag-design.md#5-fullscreenchangeの購読先--決定-documentに張るtarget要素にではない)とは逆）。

- Coreは解決済みtarget（`<video>`要素）に対して`enterpictureinpicture`/`leavepictureinpicture`をそれぞれ`addEventListener`する。targetが再解決されるたび（`target`属性変更等）、旧targetのリスナーを外し新targetに張り直す。
- ただし`document.pictureInPictureElement`自体はdocument全体で1つの値であるため、§0で述べた「複数インスタンス下での自己判定」の注意（fullscreenと同一の理由）は本ノードにも当てはまる。`enterpictureinpicture`はtarget要素に発火するため実装上は「自分のvideoで発火したか」の判定は容易だが、`document.pictureInPictureElement`を直接ポーリングするような実装を選んだ場合は`fullscreenchange`と同じ自己フィルタが必要になる。イベントリスナーをtarget要素に張る設計を採る限り、この曖昧さは生じない。

---

## 4. スコープ決定 — **決定: v1は古典API（`<video>`限定）のみ。Document Picture-in-Picture APIは対象外**

Picture-in-Pictureには2つの別提案が存在する:

- **古典的Picture-in-Picture API**（`video.requestPictureInPicture()`）— `<video>`要素専用。ブラウザ対応が安定している。
- **Document Picture-in-Picture API**（`documentPictureInPicture.requestWindow()`）— 任意のDOMツリーを別ウィンドウのPiPとして表示できる新しい提案。動画に限らずどんなUIでもPiP化できるが、API形状（別`Window`オブジェクトを取得し、そこへDOMを移動する）が本バッチの「target解決→document-levelイベント監視」というアーキタイプと全く異なる。

- **決定: v1スコープは古典API（video限定）のみとする** ✅。理由:
  - 本バッチ（Fullscreen/PiP/Pointer Lock）が共有する`_resolveTarget()`アーキタイプと自然に整合するのは古典APIの方であり、Document PiP APIを混ぜるとcommands/propertiesの形が別物になり本バッチの一貫性が崩れる。
  - 対応ブラウザ・ユースケース（動画プレイヤーの折りたたみ表示）としても古典APIで十分にカバーできる需要が大きい。
- ~~Document Picture-in-Picture APIも同時にサポートする~~ — 不採用。将来候補としてバックログに残すが、着手するなら別ノード（例: `<wcs-doc-pip>`）として切り出すべきで、本ノードのスコープには含めない。

---

## 5. 複数インスタンス注意事項

`document.pictureInPictureElement`は`document.fullscreenElement`と同様、document全体で1つの値しか持てない。複数の`<wcs-pip>`インスタンスが同時に存在する場合、各インスタンスは「documentが今PiP中か」ではなく「**自分が解決したtarget（`<video>`）が`pictureInPictureElement`と一致するか**」を見なければならない。判定ロジック・注意点は[fullscreen-tag-design.md §2.1](./fullscreen-tag-design.md#21-重要な注意点-複数インスタンス下での自己判定)と同一であり、本ノードでは対象要素へのイベント購読（§3）によって実質的に自然に解決される（他のvideoの`enterpictureinpicture`は自分のリスナーに届かないため）。

---

## 6. テスト方針（happy-domの差分のみ）

fullscreen-tag-designのテスト観点（§11参照。3モード解決・gesture外reject・`_gen`ガード・複数インスタンス・SSR等）をそのまま流用し、以下を追加する。

- **`tagName !== "VIDEO"`検証**: `target`が`<div>`等を指す場合、`requestPictureInPicture()`が即`error`になり例外を投げないこと。
- `<video>`要素への`enterpictureinpicture`/`leavepictureinpicture`の手動`dispatchEvent`で`active`が追従すること。
- `target`属性変更でリスナーの張り替えが行われる（旧video要素にリスナーが残らない）こと。

---

## 7. 決定事項まとめ

| 論点 | 決定 |
|---|---|
| 基本パターン | [fullscreen-tag-design.md](./fullscreen-tag-design.md) と同一（target解決・API解決層・`_gen`・error表現・SSR） |
| §2 target制約 | `tagName === "VIDEO"`検証を追加。不一致はnever-throwで`error`へ |
| §3 イベント購読先 | target要素自身（`enterpictureinpicture`/`leavepictureinpicture`）。fullscreenchangeの`document`購読とは逆 |
| §4 スコープ | v1は古典API（`<video>`限定）のみ。Document Picture-in-Picture APIは将来候補・対象外 |
| §5 複数インスタンス | fullscreenと同一の注意（`pictureInPictureElement`もdocument全体で1値） |
| パッケージ/タグ | `@wcstack/picture-in-picture` / `<wcs-pip target="...">` / Shell `WcsPip` |

---

## 8. 実装順の推奨

1. `PipCore`（`FullscreenCore`をコピーし、`fullscreenElement`→`pictureInPictureElement`、`document`購読→target要素購読に差し替え、`tagName === "VIDEO"`検証を追加）。
2. Shell `<wcs-pip target="...">`（`intersection`由来の`_resolveTarget()`/`_safeQuery()`はfullscreenの実装をそのまま再利用）。
3. Fake double（`FakeVideoElement` + `document.pictureInPictureElement`可変化）とテスト一式（§6の差分を中心に、fullscreenのテストスイートを土台に複製）。
4. example: `<video>`プレイヤーのPiP切り替えボタン、`camera`/`recorder`パッケージとの連携（録画プレビューをPiPで見る）シナリオを目玉に。
5. README ja/en（`<video>`限定である旨、Document Picture-in-Picture APIは対象外である旨を明記）。
