# 設計: アクセシビリティ — ルート遷移・リスト再配置・モーション・読み上げ

- **状態**: 2026-08-28 初稿・同日アーキテクチャレビュー反映（判定順序の明文化・`focus="heading"` の規定・`wcs-link` × data-wcs 制限・fallback 強制 e2e）→ **同日、全 Phase 実装完了（PR #194〜#202・main マージ済み・未リリース）**。全論点を実装読解で裏取り済み（8 方面並列検証・訂正 3 件を §0-2 に記録）。D1 / D2 / D6 は推奨案どおり裁定済み — 全決定確定。手順と実施記録は [a11y-impl-plan.md](./a11y-impl-plan.md)。
- **対象**: `@wcstack/router`（scroll / focus / `aria-current` / 読み上げ）、`@wcstack/state`（リスト再配置の `moveBefore`）、`@wcstack/raf`（`prefers-reduced-motion`）、`vscode-wcs` + `@wcstack/lint`（静的検査）、examples（教材の底上げ）、Web API 地雷系 8 パッケージの README。
- **一言で**: 「**修理は既定オン、意見はオプトイン**」。壊れているもの（フォールバック経路のスクロール・`aria-current` 欠落・リスト移動のフォーカス破壊）は黙って直る。意見が入るもの（フォーカスの移動先・読み上げ文言）は属性で明示したときだけ動く。
- **前提**: 正解はすべて Web 標準側に既にある — Navigation API の intercept 既定・`Node.moveBefore()`・`prefers-reduced-motion`・`aria-current`。自前機構は最後の手段。a11y は新しい軸ではなく、5 つのルールの「HTML セマンティクスを維持する」の未払い分である。
- **依存**: なし。新規パッケージは作らない（D8）。`view-transition` の `reduced-motion` 実装（`ViewTransitionCore.ts:58-67`）を先例として参照する。

---

## 0. 決定レコード

「状態」列は **決定（提案）**（合意提案として閉じている） / **要確認**（著者判断待ち） / **未決** を区別する。

| ゲート | 論点 | 決定（提案） | 状態 |
|---|---|---|---|
| **D1** | 既定かオプトインか | **修理（fallback scroll / `aria-current` / `moveBefore`）は既定オン・追加のみ。ポリシー（focus 移動先・読み上げ）は `<wcs-router>` の属性オプトイン。** ポリシータグ `<wcs-a11y>` は作らない（§2） | **決定**（2026-08-28 裁定） |
| **D2** | 読み上げ文言のソース | **`document.title`**。静的 `<wcs-head><title>` は commit 時点で確定していることを実装読解で確認済み（§3-4）。バインド title には binder キューの遅延窓があるため、「**commit 時の `document.title` のスナップショット**」と規定し、後追い再読み上げはしない。route ごとの明示文言属性は棄却（§3-4） | **決定**（2026-08-28 裁定） |
| **D3** | タイミング規範 | フォーカス・読み上げは「**mutation 適用後・commit 後**」（`applyRoute` の committed 判定の後）。「アニメーション完了後」は**現 transition-runner では表現不可能** — `run()` の promise は mutate 適用時に解決する契約（`transitionRunner.ts`）。プロトコル拡張は非目標（§10） | 決定（提案） |
| **D4** | guard 拒否時 | **何もしない**。`applyRoute` の返り値を `Promise<boolean>`（committed）に変え、呼び出し側でゲートする（§3-2） | 決定（提案） |
| **D5** | `moveBefore` | `createContent.ts:105` の **1 文だけ**に same-parent ガード付きで導入（§4）。他の挿入箇所は触らない。**if 分岐のフォーカス消失は `moveBefore` では直らない**（unmount は本当に削除する）— 対象外（§10） | 決定（提案） |
| **D6** | reduced-motion | `<wcs-raf reduced-motion="pause">`（**既定 `run`・オプトイン**）。suspended の**第二原因**としてモデル化（visibility と同型・§6）。MQL change 購読は**必須**（start 時チェックのみだと恒久ウェッジ）。**timer は保留**（polling への適用根拠が弱い） | **決定**（2026-08-28 裁定・timer 保留で確定） |
| **D7** | `<wcs-link>` | `aria-current="page"` を active class と同時に**既定オン**。属性転送は「anchor 生成時の一括コピー（`aria-*` prefix + 固定名）+ 固定名の observedAttributes 追随」（§5。初版は 5 名、2026-09-06 レビューで `lang` / `dir` を加えて 7 名）。動的 `aria-*` は **data-wcs バインド経由も含めて**追従しない明記された制限（§5）。**素の `<a>` への推奨格上げはしない**（fallback ブラウザで全画面遷移になる） | 決定（提案） |
| **D8** | 新規パッケージ | **作らない**。i18n D7 と同じ裁定。ポリシータグ切り出しは実需 2 件目（state 側の告知需要）が出るまで保留 | 決定（提案） |
| **D9** | 静的検査 | 第一弾は **`wcs/aria-attr-unknown`**（`attr.aria-*` のタイポ検出・**warning**）のみ（§8）。「wcs-link 近傍の aria-current」は**ルールにしない**（生成 anchor は author markup に無い — D7 のランタイム修正が正解）。aria-hidden 配下 focusable 検査は非目標 | 決定（提案） |
| **D10** | README | 地雷系 8 パッケージに "Accessibility" 節を追加。WCAG 条項・essential 例外・停止手段を明記（§9） | 決定（提案） |
| **D11** | 検証手段 | DoD は「**Chromium の Playwright で assert 可能な範囲**」（`activeElement` 同一性 / `scrollY` / ARIA 属性）。SR 実機（NVDA / VoiceOver）は自動化せず、手動検証手順を docs に残す | 決定（提案） |
| **D12** | 非目標 | §10 参照（axe 組込・SR 自動テスト・if 分岐フォーカス復元・アニメーション完了後フック 等） | 決定（提案） |

### 0-1. 品質特性の優先順位

**本設計が最適化する順序。以降のすべての決定はこの順位に照らして読む。**

1. **既定で正しい** — 修理系は設定なしで直る
2. **標準委譲** — ブラウザが持つ機構を自前で再実装しない
3. **非破壊** — 既存挙動の変更はゼロ、追加のみ
4. **意見の明示** — フォーカス先・文言は author の意思表示があるときだけ
5. **教材の正しさ** — examples はコピーされる前提の教材

**判定の順序**: 決定はまず §2 の二分法（修理か意見か）で分類し、その後にこの順位を適用する。**順位そのものは逆転しない。**

- `aria-current` が既定オン: 意見ではなく事実の表明＝**修理** → 1 が適用。§2 の定義（直ったことが破壊にならない）を満たすものだけが修理を名乗れるため、3 とも衝突しない。
- fallback scroll が既定オン（挙動変更あり）: 同じく**修理**（ブラウザ既定として期待できたはずの挙動の欠落）→ 1 が支配。3 の「非破壊」は意見系の**追加**に課す制約であって、修理を妨げない。
- `reduced-motion` の既定が `run`: raf の tick は装飾でなく**機能出力**であり、これを止めるのは修理ではなく**意見** → 4 が適用され、既定は「何もしない」。view-transition が `skip` 既定を選べたのは、落とすものが装飾だけ＝修理側だから。

### 0-2. 検証で判明した訂正（2026-08-28・初期分析からの差分）

1. **outlet の shadow root 既定はオフ**（`config.enableShadowRoot: false`・`config.ts:29`）。初期分析の「既定で張る」は誤り。ただし属性/`setConfig` でオンにできるため、**live region を outlet 配下に置かない**という配置判断は変わらない（§3-4）。
2. **`aria-labels` はコメント内**（`examples/state-cross-tab-todo/index.html:309`）。実バインド（:313 / :315）は正しい単数形。lint 候補としての実例は消えたが、「黙って無効になるタイポ」クラス自体は D9 の対象のまま。同ファイルの実欠陥は「**削除ボタンの accessible name が素の todo 文言**」の方（§7 の 7 番）。
3. **Navigation API 経路は既に正しい**。`intercept()` のオプション省略時の仕様既定は `scroll: "after-transition"` / `focusReset: "after-transition"` — push でトップへ、traverse で位置復元、フォーカスは `[autofocus]` か body へ。**欠陥はフォールバック経路（pushState / popstate）に限定される**。

---

## 1. 現状の棚卸し

### 1-1. 壊れているもの（既定で直す）

| 事象 | 場所 | 帰結 |
|---|---|---|
| フォールバック経路がスクロールしない | `Router.ts:207-209`（pushState 後に何もしない） | Navigation API の無いブラウザで push 遷移後も前ページのスクロール位置のまま |
| `aria-current` が無い | `Link.ts:177-183`（`active` class のみ） | 現在地がスクリーンリーダーに伝わらない |
| リスト再配置がフォーカスを破壊 | `createContent.ts:105`（`insertBefore` は取り外し→挿入） | 並び替えで「ユーザーが今触っている行」が blur。iframe 再読込・動画停止も同根 |
| tilt-maze にキーボード代替が無い | `examples/state-tilt-maze` / `signals-tilt-maze` | WCAG 2.5.4（Motion Actuation・レベル A）違反の教材 |
| tilt-maze の `role="status"` が毎フレーム更新の HUD を包む | 同上 `:327` / `:372` | 読み上げの洪水（逆方向の事故） |

### 1-2. 既に正しいもの（明文化だけが要る）

- **Navigation API 経路の scroll / focus**（§0-2 訂正 3）— コードに意図が書かれておらず、`NavigateEventLike`（`Router.ts:12-18`）はオプションを表現すらできない。後から `scroll: "manual"` を足す変更が黙って壊す。
- **view-transition の `prefers-reduced-motion`**（既定 `skip`・never-throw な `matchMedia` ガード・`ViewTransitionCore.ts:58-67`）— リポジトリ内で唯一の正解実装。規範の先例。
- **`attr.aria-*` バインド構文** — `attr.` / `class.` / `style.` で aria は全部宣言的に書ける。`examples/router-spa:245` に動的 `attr.aria-label` の実例あり。**利用者が正しく書く手段は全部揃っている**（例外は `<wcs-link>` ホスト上のバインド — 生成 anchor に届かない。§5）。
- **I/O ノードの停止手段** — timer / raf / speech は `pause` / `resume` を、websocket / sse は `close` を既に command として露出している（WCAG 2.2.2 の部品は揃っている）。
- **examples の好例** — cross-tab-todo（スコープした live banner）・custom-states（`role="alert"`）・intersect-scroll / pomodoro（低頻度テキストへの `role="status"`）。house style として引用可能。

### 1-3. 無いもの（オプトインで足す・規範で埋める）

ルート遷移の読み上げ、フォーカス移動ポリシー、raf の reduced-motion、a11y lint ルール、8 パッケージの README 節、そして**プロジェクトとしての a11y 規範文書そのもの**（`timing-and-firing-contract.md` に focus / scroll / 告知の規範は皆無であることを確認済み）。

---

## 2. 規範: 修理は既定オン、意見はオプトイン

この二分法は §0-1 の優先順位に**先行する判定規則**である（分類が先、順位はその後 — §0-1「判定の順序」）。

- **修理**とは「ブラウザ既定として期待できたはずの挙動の欠落」。fallback scroll（`pushState` が奪ったスクロールリセット）、`aria-current`（`active` class と同じ事実の ARIA 表現）、`moveBefore`（取り外しを伴わない移動という標準の新機構）。これらは**設定なしで直り、直ったことが破壊にならない**。
- **意見**とは「author の設計判断を代行するもの」。フォーカスをどこへ動かすか・何を読み上げるかはページの構造に依存する。**既定は「何もしない」= ブラウザ標準**であり、属性を書いたときだけ router が代行する。
- **標準の正解を使う**。`intercept` オプション・`moveBefore`・`prefers-reduced-motion`・`aria-current`・`role="log"`。自前の focus トラップやフォーカス履歴スタックは作らない。
- **タイミング規範**（D3）: フォーカス移動と読み上げは **commit 後**（guard 通過・mutation 適用済み・`router.path` 更新の地点）。初回描画（`lastRoutes.length === 0`）では**決して**動かない — ページロードはブラウザの担当（view-transition の「初回は包まない」と同じ規則・同じ理由）。この規範を新設する Phase で `timing-and-firing-contract.md` へ追記する（同書 §6 の保守規約が要求）。

---

## 3. router — scroll / focus / 読み上げ

### 3-1. Navigation API 経路の明文化（挙動変更ゼロ）

`Router.ts:235` の `navEvent.intercept({ handler })` に仕様既定を明示的に書く:

```ts
navEvent.intercept({
  handler: async () => { /* 既存 */ },
  // 仕様既定の明示。scroll: push はトップへ / traverse は位置復元、
  // focusReset: [autofocus] か body へ。ここを "manual" にする変更は
  // a11y 契約の変更である（docs/a11y-design.md §3-1）。
  scroll: "after-transition",
  focusReset: "after-transition",
});
```

`NavigateEventLike`（`Router.ts:12-18`）を両オプション込みに広げる。既定値の明示なので観測可能な挙動は変わらないが、委譲が**意図**であることがコードに刻まれ、README に「router のアクセシビリティ契約」として書ける根拠になる。

### 3-2. フォールバック経路の scroll（修理・既定オン）

- `applyRoute` の返り値を `Promise<boolean>` に変える（`applyRoute.ts:44` を `return false` に、`:47` の後に `return true`）。**現状 `Promise<void>` のため、呼び出し側から guard 拒否が見えない**ことが修理の前提を塞いでいる。
- `Router.navigate()` の else 分岐（`Router.ts:208` の `await applyRoute(...)` の後）で、**committed === true のときだけ** scroll する。`to` に `#hash` は来ない設計（Link は pathname のみ生成）なので v1 は scroll-to-top のみ。
- **`_onPopState`（`Router.ts:249-256`）は触らない**。traverse のスクロールは `history.scrollRestoration`（既定 `auto`）によるブラウザ復元が正解で、ここに scroll-to-top を足すのは逆に破壊。
- view-transition arbiter 導入ページでは、committed は mutate 適用時（アニメーション完了前）に立つため scroll はアニメーション中に走るが、新スナップショット取得前の DOM 変更として取り込まれるだけで順序問題はない。scroll をアニメーション完了に同期させる要求は「遷移完了後フック」と同じくプロトコル拡張であり非目標（D3 / §10）。
- フォールバック scroll は window 全体をトップへ送る。サブ領域だけを司るマルチ router 構成でも同じだが、これは Navigation API 経路の仕様既定（`scroll: "after-transition"`）が同構成で行う挙動と同一であり、経路間の一貫性（優先順位 2: 標準委譲）を取る。

### 3-3. `aria-current="page"`（修理・既定オン）

`Link._updateActiveState` の一致分岐（`Link.ts:179` / `:181`）に `setAttribute("aria-current", "page")` / `removeAttribute("aria-current")` を併記するだけ。パス比較ロジック・全呼び出し経路（connect / 3 つのナビゲーションイベント / fallback click / 属性変更）は既存を無変更で流用でき、鮮度保証は `active` class と同一になる。

### 3-4. `focus=` / `announce=`（オプトイン・D1/D2 裁定済み）

**属性面**（`<wcs-router>` に追加）:

| 属性 | 値 | 意味 |
|---|---|---|
| `focus` | （なし・既定） | 何もしない = ブラウザ標準 |
| | `"heading"` | commit 後、挿入されたルート内容の最初の `h1`〜`h6` に `tabindex="-1"` を付けて `focus()`（Comment placeholder の兄弟として挿入されるため**安定した箱が無い** — 内容から探すのが唯一の現実解） |
| `announce` | （なし・既定） | 読み上げなし |
| | `"title"` | commit 後、live region に `document.title` を書き込む |

**`focus="heading"` の規定**（D1 裁定の対象仕様）:

- **探索範囲**: マッチした route チェーンの**最深（リーフ）route が挿入した内容**を document order で走査し、最初の `h1`〜`h6`。ネスト layout で複数 route が同時に入れ替わっても、読者が「新しい画面」と認識する単位はリーフ。祖先 route の内容へは遡らない。
- **見出し不在時**（2026-09-06 レビュー反映で改訂 — 初版の「何もしない」は誤り）: router が**仕様既定の focusReset を自前で再現する** — 最初の `[autofocus]` 要素へ、無ければ blur で `<body>` へ落とす。初版の「旧フォーカス要素が遷移で消えていればブラウザが body へ落とすので収束する」は、旧フォーカス要素が**生き残る**最も一般的なケース（layout の永続ナビの `<wcs-link>` クリック）で成り立たない — `focusReset: "manual"` を渡した以上、ブラウザ既定は止まっており、自前で落とさない限りフォーカスは前画面のナビに取り残される。`focus="heading"` を使う author は各ルート内容の**冒頭**に見出しを置く — README の利用条件として明記する（focus のスクロールインは push 遷移の scroll-to-top に負けるため、下方の見出しは画面外フォーカスになる）。
- **可視性**: 探索は**可視の**見出しに限る（`checkVisibility` — 未実装環境は可視扱い）。`hidden` / `display:none` の見出しへの focus() は no-op で、「manual だけ渡して何もしない」と同じ穴になるため。
- **値の正規化**: `focusPolicy` / `announcePolicy` getter は有効値（`"heading"` / `"title"`）以外をすべて null に正規化した union で露出する。空文字・タイポは「ポリシーなし」= 仕様既定へ委譲され、intercept の focusReset 決定と適用側の判定が割れる余地を構造的に塞ぐ（2026-09-06 レビューの blocking 対応）。

**announce の代替案（棄却）**: route ごとの明示文言属性（`<wcs-route announce-label>` 等）は、`<wcs-head>` で一元化・i18n 済みの title と二重管理になるため棄却。将来の必要は `announce=` の値追加で拡張できる（値を enum にしたのはその余地）。

**live region の設計**（検証済みの根拠つき）:

- **`<wcs-router>` の直下**に `_initialize` 時（空のまま）生成し、`disconnectedCallback` で撤去する。根拠: (a) 告知より**前**から DOM に居ないと SR に読まれない → announce 時の遅延生成は両配置とも不可。(b) outlet 配下はナビゲーションごとに破棄され、オプトインで shadow root にもなる。(c) `document.body` 直下は router の寿命を超えて漏れ、マルチ router で共有・競合する。(d) `<wcs-router>` は display:none でも inert でもなく（検証済み — 自身を隠すのは Head と Link だけ）、`<template>` 以外の子を持っても `_getTemplate` / `_getOutlet` は壊れない。
- 見た目は **sr-only クリップ**（`position:absolute; clip-path` 系）。**`display:none` は禁止**（live region が死ぬ）。
- `aria-live="polite"`（examples の house style は `role="status"` — どちらでも良いが `role="status"` に揃える）。

**タイミング契約**（検証済み）: mutate() 内の挿入で `<wcs-head>` の connectedCallback が**同期**に走り、`document.title` の差し替えは transition promise の解決より前・`routerNode.path = path`（commit）より前に完了している。よって **`applyRoute` の committed 判定直後**が announce の正しい置き場で、(1) guard 拒否では何も読まれず、(2) 静的 title は必ず新しい値が読まれる。**announce の書き込みは mutate() の外**（view transition に含めない・プレーンな DOM 更新）。

**既知の限界**（D2 の「スナップショット」規定の理由）: バインド title（`<title data-wcs>`）は挿入**後**に binder に渡され、state 未ロードのページではキューに積まれるだけなので、commit 時点で古い/空のことがある。また i18n のロケール切替のように**ナビゲーション無しで title が変わっても再読み上げしない**。どちらも仕様として README に明記する。

### 3-5. 初回・guard 拒否・マルチ router

- **初回描画（`lastRoutes.length === 0`）はフォーカスも読み上げもしない**。view-transition の「初回は包まない」と同一の判定・同一の理由。
- guard 拒否（committed === false）は scroll / focus / announce すべて抑止（D4）。
- マルチ router: live region は router ごとに持ち、自分の `applyRoute` が commit したときだけ書く。`_isOwnPath` ゲートは既存のまま効く。
- `focus=` を指定したときだけ、Navigation API 経路では `focusReset: "manual"` を渡す（渡さないとブラウザの after-transition リセットと**二重処理**になる — 検証済み）。

---

## 4. state — `moveBefore` によるフォーカス保存

### 4-1. 対象は 1 文だけ

物理的に「接続済みノードを移動する」文は全リポジトリで **`createContent.ts:105`** の `parentNode.insertBefore(node, anchor.nextSibling)` のみ（`Content.mountAfter` 内・reorder settle walk `applyChangeToFor.ts:307-308` から到達）。LIS 最適化（swap 移動 997→2）の**残った 2 回が正確に「今触っている行」を壊す**構図。

ただしこの 1 文は **4 つのノード状態を共有**している: (a) 接続済み reorder 移動、(b) clone フラグメント由来の新規ノード（root 違い）、(c) プール/unmount 済みの親なしノード、(d) バッチフラグメント内での入れ子 for。(b)(c)(d) に `moveBefore` を使うと `HierarchyRequestError` — だから**ノード単位ガード**が必須:

```ts
// moveBefore は「同一 connected tree・同一親ツリー」を要求する。
// same-parent 判定は「同 root かつ親が非 null」を同時に証明し、
// それがちょうどフォーカス保存が意味を持つ接続済み reorder の場合と一致する。
if (node.parentNode === parentNode && typeof parentNode.moveBefore === "function") {
  parentNode.moveBefore(node, anchor.nextSibling);
} else {
  parentNode.insertBefore(node, anchor.nextSibling);
}
```

**触らない場所**（検証済みの否定リスト）: `appendTo`（`createContent.ts:62` — 切断済みバッチフラグメントへの追加）、一括 `insertBefore(fragment,...)`（`applyChangeToFor.ts:331` — moveBefore は DocumentFragment を受けない）、SSR コメント挿入、fullDelete のアンカー再追加（`:173` — その時点で切断済み）。

### 4-2. 保たれる不変条件

- `markObserverSkipOnAdd` は**両分岐の前で維持**する — `moveBefore` も仕様上 childList mutation record を出す。
- LIS の「swap 移動 ≤ 2」契約テスト（`list.stableListOrder.test.ts:339` の `insertBefore` spy）は **moveBefore にも spy を張って**維持する。張らないと実ブラウザ側の契約が黙って外れる。
- `e2e/bench/jsfb-verify.mjs` の keyed-swap 検出（mutation record 依存）は動くはずだが、変更後に**再実行して数値を確認**する。

### 4-3. テスト戦略（happy-dom 20.3.7 に moveBefore が無い）

vitest では新分岐が**到達不能**（fallback のみ実行）→ カバレッジ閾値 100/97 を割る。コンテナに moveBefore スタブ（insertBefore に委譲しつつ呼び出しを記録）を立てる unit テストで分岐を覆い、実ブラウザの挙動は e2e（Chromium 133+）で「**行 swap を `document.activeElement` の同一性が生き残る**」ことを assert する。

### 4-4. 対象外（重要な線引き）

if 分岐の切替（`applyChangeToIf.ts:35-36` → `unmount`）・行削除・fullDelete のフォーカス消失は **`moveBefore` では直らない** — これらは本当にノードを削除する。フォーカスの capture / restore 機構はパッケージに一切存在せず、足すなら「どこへ復元するか」という別の設計問題。需要が観測されるまで非目標（§10）とし、§12 に未解決として残す。

---

## 5. `<wcs-link>` — aria-current と属性転送

`aria-current` は §3-3。属性転送は複合方式（検証済みのトレードオフ比較から）:

1. **anchor 生成時の一括コピー**（`Link.ts:102-106` の間）: `aria-` prefix 一致 + 固定 7 名（`title` / `rel` / `target` / `download` / `hreflang` / `lang` / `dir`）をホストから複写。`lang` / `dir` は SR の読み上げ言語・方向に直結するため 2026-09-06 レビューで追加（多言語ナビで anchor に届かないと読み上げが崩れる）。**`to` / `style` / `class` は除外**（ホストは `display:none`、class は `active` 契約を汚す）。
2. **固定 7 名だけ observedAttributes に追加**（`Link.ts:11`）し、`attributeChangedCallback` にミラー分岐（`:161-169` の null ガード維持）。
3. `aria-*` は**開集合**なので attributeChangedCallback では原理的に追えない（observedAttributes は定義時静的評価）。「接続後の動的 `aria-*` 変更は追従しない」を**明記された制限**とする。disconnect が anchor を破棄し reconnect が再生成するため、移動では再同期される。MutationObserver 追加は実需が出るまでやらない。

**data-wcs バインドとの相互作用**（明記された制限の具体例）: `<wcs-link data-wcs="attr.aria-label: ...">` は**生成 anchor に届かない**。state/binder はホスト属性を接続後に動的に書くが `aria-*` は observedAttributes に載せられず、state ロードが anchor 生成より遅ければ一括コピー時点でも属性は無い。§1-2 の「attr.aria-* で正しく書ける」は wcs-link ホストには適用されない — 回避は静的属性で書くこと。README に具体例つきで明記し、lint 第二弾候補（§8）に積む。「MutationObserver は実需まで作らない」はこの相互作用を**承知の上**の棄却であり、実需の観測は README / lint への反応で行う。

**素の `<a>` への推奨格上げをしない理由**（検証済み）: Navigation API ブラウザでは素の `<a href="/about">` も `_onNavigateFunc` が拾い SPA 遷移になるが、**それが成り立つのは Navigation API があり basename 配下のときだけ**。フォールバックブラウザで router が張るのは popstate リスナのみで、クリック横取りは `wcs-link` の click ハンドラ（`Link.ts:120-133`）が唯一の SPA 経路。README には「Navigation API 環境では素の `<a>` も動く（条件 2 つ付き）」を情報として書き、推奨は `wcs-link` のまま。

---

## 6. `@wcstack/raf` — `prefers-reduced-motion`（オプトイン）

### 6-1. モデル: suspended の第二原因

RafCore には既に **desired/actual 分離**（`running` = ユーザー意図 / `suspended` = 実際の停止・wakelock 型）と visibility による停止機構がある。reduced-motion は **pause() の再利用ではなく suspended の第二原因**として足す:

```
suspended = running && (hidden || reducedGate)
```

- `pause()` を流用しない理由: `_paused` はユーザー意図（`start()`/`stop()` がクリアする）。環境条件と混ぜると `resume()` が OS 設定を上書きできてしまう。
- reduce オンで既存の `_clearHandle()` がアーム済みフレームを取り消し、オフで `_lastTs = null` + 再アーム（**dt=0 境界** — visibility 復帰と同じ G3 規範）。`elapsed = Σdt` なので停止期間は自動的に加算されない。

### 6-2. ライブ購読は必須

`matchMedia("(prefers-reduced-motion: reduce)")` の **change イベント購読を `observe()` で張り `dispose()` で外す**（`_visibilityDoc` と同じライフサイクル）。start 時チェックだけの実装は**恒久ウェッジ**を作る: reduce 中に start したループは `running=true` のままフレームが一つも飛ばず、reduce 解除を検知する機会が永遠に来ない。

### 6-3. 属性とテスト

- 属性名は view-transition と同じ **`reduced-motion`**、値は制御対象が違うので **`"pause" | "run"`（既定 `run`）**。未知値→既定への正規化は view-transition の setter 慣行を踏襲。
- `matchMedia` は **RafScheduler と同型の注入**にする（happy-dom の MQL change 配送が当てにならないため、テストが preference とその変化を直接制御できることが 100/97 カバレッジの前提）。
- **suspended の意味が「visibility のみ」から広がる** — README / raf-tag-design メモの更新が必要（追加的変更だが挙動ノート 1 行の対象）。
- **timer は保留**（D6 要確認）: TimerCore には suspended 概念も ambient 購読も無く、誠実にやると出力面の拡張（suspended プロパティ新設）まで要る。prefers-reduced-motion が polling を止める根拠も弱い。実需が出たら raf の型をなぞる。

---

## 7. examples — 底上げリスト（教材レバレッジ順・検証済み）

1. **state-tilt-maze** (`:338`): board に `tabindex="0"` + `aria-label`、既存 data-wcs に `onkeydown: keyDown; onkeyup: keyUp; onblur: keyClear` を追記。モジュールスコープの `KEYS` Set で押下管理し、`step()` で矢印キーから `simBeta/simGamma` を ±TILT_MAX へランプ（keys-held を `dragging` と同扱いにしてセンサーより優先）。**物理は無変更** — キーボードは既存 sim-tilt チャネルに乗る第三入力。`onkeydown#prevent` は**使わない**（Tab まで殺す）— ハンドラ内で Arrow 系のみ preventDefault。
2. **signals-tilt-maze** (`:379`): 同設計。board の `h()` props に `tabIndex: 0` + `onKeyDown/onKeyUp/onBlur`。
3. **両 tilt-maze の `role="status"` 剥がし** (`:327` / `:372`): 毎フレーム更新の HUD を包んでいる（読み上げの洪水 + Reset ボタンが live region 内）。phase 告知が欲しければ低頻度の controlText チップだけに付け直す。
4. **websocket-chat 全 5 スタック**: メッセージログコンテナに `role="log"`（追記が polite に読まれる）。react / vue は **checked-in dist の再ビルドが必要**。
5. **router-i18n** (`:2`): `<html lang="en">` を静的既定に（交渉スクリプトが上書き。i18n の例自身が lang 無しという皮肉の解消）。
6. **state-sse-dashboard**: Pause/Resume トグル追加（WCAG 2.2.2）。**両ペインの EventSource を同時に止める**（このデモの主題は 2 イディオム比較なので片方だけ止めると嘘になる）。
7. **state-cross-tab-todo** (`:315`): 削除ボタンの accessible name を「Delete + todo 文言」に。プレフィックスを付けるフィルタは存在しないので、ワイルドカード getter（`get "list.*.deleteLabel"()`）で state 側に計算を置く（house rule どおり）。
8. **state-notification-chat**: メッセージリストに `role="log"`（デスクトップ通知は permission ゲートで代替にならない）。
9. **state の最小デモ 3 つ**（async-fetch / simple-list / spread）: 見出しゼロ → `<title>` に合わせた `<h1>` を追加。
10. **cart** (`:115`): h2 始まりの見出し階層を h1 に。

---

## 8. 静的検査 — `wcs/aria-attr-unknown`

- **配置**: 検査は vscode-wcs の validator core（新規 `service/ariaValidator.ts`、`core/validateDocument.ts` の単一エントリに配線）。`@wcstack/lint` は dist のバイトコピーなので**配布コストゼロで CLI にも届く**。
- **内容**: `attr.aria-*` バインドの属性名を WAI-ARIA の静的リストと照合し、既存の editDistance ヘルパで「did you mean `aria-label`」を出す。既存の parse surface（`parseBindingExpression` のオフセット付き property）だけで書ける — 新パーサ不要。
- **severity は warning**。exit code 契約（error のみ 1）と repo 全体 CI ゲート（--errors-only）に触れない。**error 昇格するときは `packages/lint/scripts/smoke-test.mjs:106-119` の対ケース更新が必須**（#180/#183 の再発防止線）。
- **診断コードは append-only の公開契約** — 名前（`wcs/aria-attr-unknown`）は publish 前に確定する。ARIA リストには出典と更新手順のコメントを付ける（builtinTags.generated.ts と同じ流儀）。
- 第二弾候補（保留）: 「error/loading パスのバインドに同一要素の `role="status"` / `aria-live` が無い」— 囲い open-tag 抽出という小さな新 surface が要る。v1 では作らない。
- 第二弾候補（保留・その 2）: 「`<wcs-link>` 上の `attr.aria-*` バインド」を warning（生成 anchor に届かない — §5 の相互作用）。既存の parse surface で書けるが、D7 の実需観測を先に行う。

---

## 9. README "Accessibility" 節 — 地雷系 8 パッケージ

宣言的に薄く包む設計は**プラットフォーム API の a11y 責任も包んで見えなくする**。以下に節テンプレ（条項 / essential 例外 / 停止・代替手段）を追加する:

| パッケージ | WCAG 条項 | 書くべき核心 |
|---|---|---|
| screen-orientation | **1.3.4 Orientation (AA)** | `lock()` してよいのは essential な場合だけ。README は失敗条件に詳しいのに**この一文だけが無い** |
| pointer-lock | 2.1.2 No Keyboard Trap | Esc 脱出はブラウザ保証だがアプリ側 UI にも脱出手段を |
| fullscreen | 2.1.2 / 2.4.3 | Esc 脱出・フォーカスの行方 |
| tilt / accelerometer / gyroscope / magnetometer | **2.5.4 Motion Actuation (A)** | 代替入力と無効化手段が**必須**。tilt-maze（§7-1）を参照実装として挙げる |
| audio / speech | 1.4.2 Audio Control (A) | 自動再生の扱い・停止 command の紹介 |
| notification / idle | 2.2.1 Timing Adjustable | タイミング調整手段 |
| timer / raf / sse / websocket | 2.2.2 Pause, Stop, Hide | **既にある** `pause`/`resume`/`close` command を a11y 文脈で紹介し直すだけ |

---

## 10. 非目標

- **WCAG 2.x 準拠レベル（A / AA）の達成・主張**（§9 の README が引く個別条項は各パッケージの利用上の注意であり、wcstack としての準拠保証ではない）
- **axe 等の外部 a11y チェッカの組込**（依存ゼロ方針。examples の検証にも入れない — 素の assert で足りる）
- **スクリーンリーダーの自動テスト**（D11 — 手動手順を docs に残す）
- **if 分岐・行削除でのフォーカス復元**（capture/restore 機構の新設。需要観測まで — §12）
- **focus trap / フォーカス履歴ユーティリティの提供**
- **`aria-hidden` 配下 focusable の静的検査**（汎用 HTML ツリーパーサが要る。regex 走査で意図的に済ませている設計に反し、静的属性版は axe / html-validate の領分）
- **transition-runner プロトコルの拡張**（「アニメーション完了後」フック — D3）
- **timer の reduced-motion**（D6 保留）
- **`<wcs-a11y>` ポリシータグ**（D8 — 実需 2 件目まで）
- **`<wcs-link>` の動的 `aria-*` 追従**（MutationObserver — 明記された制限とする）

## 11. 段階

[a11y-impl-plan.md](./a11y-impl-plan.md) に展開。Phase 0（契約の明文化・挙動ゼロ）→ 1（router 修理）→ 2（state moveBefore）→ 3（focus/announce・D1/D2 裁定済み）→ 4（raf reduced-motion・D6 裁定済み）→ 5（examples）→ 6（lint）→ 7（README / docs）。0→1 のみ順序依存、2 / 5 / 6 / 7 は独立で並行可能。

## 12. 未解決の論点

1. ~~D1 / D2 / D6 の裁定~~ — **2026-08-28 に推奨案どおり裁定済み**（全 Phase 着手可能）。
2. **if 分岐のフォーカス復元** — unmount は本当に削除するので moveBefore の外。復元先の設計問題ごと需要待ち。
3. **バインド title の再読み上げ** — announce は commit 時スナップショット（D2）。ナビゲーション外の title 変化に追従する需要が出たら別途。
4. ~~フォールバック経路の実ブラウザ検証~~ — **解決済み（T0-4 で成立を実測）**。`getNavigation()` は呼び出しごとに `window.navigation` を動的参照する（`Navigation.ts:19-20`）ため、Playwright の `addInitScript` で `window.navigation` を undefined の own property で影にすると Chromium のままフォールバック経路（wcs-link click → pushState / back → popstate）を踏めた。A3 は実ブラウザ e2e で固定済み。WebKit project は不要。
