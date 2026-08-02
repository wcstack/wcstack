# GTM 2026-08 評議会 一次成果物（10 エージェント・2026-08-01）

> [go-to-market-2026-08.md](./go-to-market-2026-08.md) の改訂根拠となった 10 エージェント評議会の生の分析結果。
> 構成: レッドチーム 3（配線層・jsfb・買い手）→ 実調査 2（OSS 突破事例・日本チャネル）→ 具体化 4（コピー・楔デモ・AI 配布・ファネル）→ 最終監査 1。
> 本文の結論・決裁事項は戦略本体に統合済み。ここは出典・実物コピー・設計詳細の参照用。

---

# レッドチーム報告: 中核ベット(1)「配線層への振り替え」の反証

**結論: ベット(1)の根拠事実「直接競合が存在しない」は偽であり、しかも実在する競合の実績がこのカテゴリの需要不在を実証している。振り替えの方向性（漸進導入・決裁者の個人化）自体は耐えたが、現ドラフトのままの採用は推奨しない。条件付き採用に落とすべき。**

---

## ① 反証に成功した点（重大度順）

### S1.【最重大】「直接競合が存在しない」は事実として偽

「Web API を宣言的にラップするスタンドアロン custom element」というカテゴリはすでに存在し、複数の実装者がいる。2026-08-01 に実調査で確認:

- **georapbox スイート**（ソロ作者 George Raptis）: `<capture-photo>`(getUserMedia)、`<eye-dropper>`、`<web-share>`、`<picture-in-picture>`、`<resize-observer>`、`<mutation-observer>`、`<clipboard-copy>`、`<files-dropzone>` — wcstack の I/O ノードとタグ単位でほぼ一対一対応する。MIT・各タグにホスト済みデモあり・npm 公開済み。
- **大手の同型物**: GitHub 自身の `<clipboard-copy>`、GoogleChromeLabs の `<dark-mode-toggle>`、Ionic の `@ionic/pwa-elements`（`<pwa-camera>` = カメラの custom element ラッパー、企業バック付き）。
- **awesome-standalones**（66 コンポーネント）に Clipboard / Web Share / Web Bluetooth / Visual Viewport 系ラッパーが既収載。つまり「振りかけ型 Web API ラッパータグ」は 2021 年に CSS-Tricks で紹介記事が出る程度には確立済みのカテゴリ。

ドラフト §2-2 の「この土俵には直接競合が存在しない（最近縁は保守終了した Polymer iron/platinum）」は調査不足。生きている近縁が複数いる。

### S2.【最重大・S1より深刻】実在競合の実績が「需要不在」を実証している

georapbox は**ドラフトの Tier 0〜2 をほぼ全て実行済みの自然実験**である — タグごとのホスト済みデモ、整った README、awesome リスト掲載、複数年の継続。その結果が: リポジトリ 13〜49 stars、`capture-photo-element` に依存する npm パッケージ **0 件**。企業バックの `@ionic/pwa-elements` ですら依存プロジェクト 14 件。

つまり「競合がいない」のではなく、**参入した者が全員 ~50 stars の天井に張り付いている市場**である。ドラフトが提案する打ち手を先に打った先行者の到達点が実測でこれなら、「競合不在＝空白の機会」という読みより「競合不在＝需要不在の婉曲表現」という読みの方がデータと整合する。ベット(1)はこのベースレート（帰無仮説）に一度も言及していない。

### S3.【重大】買い手①には、より低コストの現職が両側から挟撃している

§2-2 の比較表は「自分で書く useEffect + 200 行」を対抗馬に置くが、**実際の対抗馬はそれではない**:

- **既存 React/Vue アプリ持ち（買い手①の主形態）**: VueUse は 200+ 関数で `useWebSocket`（自動再接続込み）・`useGeolocation`・`useUserMedia`・`useBluetooth` 等を既にカバー。React 側は react-use / @uidotdev/usehooks / react-use-websocket（**週間 ~38 万 DL**）。彼らの実際の選択肢は「200 行手書き」ではなく「`npm i react-use-websocket` して 1 フック」— 自分のイディオム・型付き・プロトコル学習ゼロ。対する wcstack 経路は「CDN script + タグ + 自作アダプタ（§7 で自認する通り第三者検証なし）+ wcBindable/data-wcs 規約の学習 + React↔CE 境界の罠（コロン付きイベント名が Angular で書けない等、既知の制約クラス F）」。**§2-2 の表は第 3 列（現職フックライブラリ）を書けば買い手①で負ける**。
- **HTML ファースト / ノービルド層（買い手①のもう一方の形態）**: htmx / Alpine(+intersect 等のプラグイン) / Datastar が「既存 HTML に属性を振りかける」土俵を既に占有。特に Datastar は fetch + SSE + signals を ~11KB で宣言的に提供し 2026 年に勢いがある — `wcs-fetch` / `wcs-sse` / state と正面重複する。

つまり「直接競合が存在しない」のは、市場境界を「バインディングプロトコル付き custom element 型ラッパー」という **wcstack だけが収まる形に引いたから**であり、買い手の目線で引き直すとどのペルソナにも現職がいる。

### S4.【重大】Polymer iron/platinum の死因は「売り方」ではなくモデルへの市場の審判

iron-ajax の廃止経緯を確認した: Polymer 4 での 2-way binding 廃止に連動し、コミュニティ全体が LitElement / vanilla HTMLElement（コード側での合成）へ移行した結果である。つまり「HTML を配線面にする宣言的データバインディング」は、**Google の配布力（Polycasts・カタログ・I/O）をもってしても一度市場に否認されたモデル**。ドラフトは iron/platinum を「保守終了した最近縁」と距離の証拠に使うが、その死因こそベット(1)への反証材料になっている。（注: 死因の一部は Polymer 固有のランタイム密結合であり、FW 非依存の wcstack には当たらない — ここは推測を含む。ただし「JS/TS で生きる開発者には属性文字列配線より型付きコード配線が勝つ」という教訓部分は Polymer 固有ではない。）

### S5.【中〜重大】ベット(1)はベット(2)と矛盾し、工芸資産を売り物から切り離す

- ドラフト自身の最高レバレッジ施策 = js-framework-benchmark 提出は **state/signals（格下げした側）のショーケース**である。jsfb から来た訪問者はフレームワーク比較文脈で到着するのに、LP は「フレームワークではなく配線層です」と迎える。**槍の穂先が、降格した商品を宣伝している**。この不整合はドラフト内で未処理。
- プロジェクトの技術的最深部（パス代数・reactive proxy・LIS・性能改善の全記録）は state/signals にあり、I/O ノードは各 Web API の薄いラッパー = **最も複製されやすいコモディティ面**。堀（プロトコルと reactive core）を裏に回してコモディティを店頭に出す構図であり、しかも作者の動機は「作る楽しさ」= その最深部に向いている。売り物と工芸の乖離は 6 ヶ月スパンで意欲枯渇リスクを高める（ドラフト自身が最頻死因と認定しているもの）。

### S6.【中】「事例不要」は過大主張

個人開発者でも `npm i` / CDN 追加の瞬間に stars と最終更新は見る。カメラや WebSocket 経路をタグに預けるなら bus factor は依然関心事であり、**star 5 という数字自体が可視の反証材料として買い手の画面に出る**。「決裁者は本人」は正しいが「事例不要」ではなく「事例の閾値が下がる」が正確。§2-2 の表のこのセルは楽観に倒れている。

---

## ② 反証できなかった点（ベットが耐えた点)

1. **§2-1 の診断（フレームワークとして売る土俵では原理的に勝てない）は崩せなかった。** 比較軸がエコシステム・事例・bus factor になるという分析は正しく、「現状維持がより良い」という反証は成立しない。
2. **「一貫したシステムとしての競合は不在」は部分的に真。** georapbox は単発の寄せ集めでプロトコルを持たない。39 タグ + 統一 wc-bindable プロトコル + state/signals 統合 + 20 FW アダプタ + SSR という**面としての一貫性**を持つ製品は確認できなかった。ただし注意: この差別化要素（プロトコル・統合）は、ベット(1)が格下げした「フレームワーク性」そのものである。
3. **漸進導入・決裁者の個人化という侵入トポロジー自体は健全。** htmx が実証済みの経路であり、方向は正しい。
4. **買い手②（日本の業務系・日本語ドキュメント・ノービルド）は最も挟撃が薄い。** VueUse も Datastar も日本語一次ドキュメントを持たない。ここだけは「競合不在」が実測でも概ね成立する（需要の実在は未検証、と明記の上で）。
5. **振り替えの直接コストは低く可逆。** 書き換えは 3 箇所・数時間で、失敗しても戻せる。「高くつくから止めろ」という反証は成立しない。

---

## ③ 修正提案: **条件付き採用**（棄却はしない）

1. **「直接競合が存在しない」の文言を削除し、ベースレートを直視する記述に差し替える。** 「同カテゴリの先行者（georapbox 等）は単発・無プロトコルで ~50 stars に留まる。我々の仮説は『統一プロトコルによる合成可能性がこの天井を破る』である」— これなら誠実で、かつ検証可能な仮説になる。現文言のままだと HN / 詳しい読者に一撃で突かれる（§7 でアダプタに施した誠実化と同じ処置が必要）。
2. **売り物を「タグ単体」でなく「タグ + 無 JS 配線」のペアに再定義する。** タグ 1 個の土俵は VueUse/georapbox が勝つ。差別化が成立する最小デモは「**タグ 2 個を JS ゼロで配線する**」（例: `wcs-geo` → `wcs-ws` を data-wcs 1 行で）。state を「上位パスに格下げ」ではなく「配線面として最初の 1 画面に出す」。堀を店頭に戻す。
3. **買い手優先順位を入れ替える。** 買い手①のうち React 経路は最も挟撃が濃い（現職フック + 自作アダプタの信頼問題）ため主戦場から外し、**買い手②（日本・ノービルド・HTML 中心）と非 React の HTML ファースト層を第一に**。React 楔（施策 2-2）は残すなら比較対象を「手書き 200 行」でなく react-use-websocket 等の現職に正しく設定し、「npm/ビルドを持たないページ」条件でのみ勝ちを主張する。
4. **ベット(2)との整合を明文で解決する。** (a) jsfb が売るのは signals と認め、signals を旗艦・I/O ノードをそのエコシステムとして語る、または (b) jsfb 流入用に「速い reactive core は配線層の土台」というブリッジ文を LP に置く。どちらかを選ばずに両ベットを走らせると漏斗が分裂する。
5. **ベット(1)専用の反証条件を 6 ヶ月ゲートに追加する。** 例: 「デモホスト + npm README 最適化後、jsDelivr ヒットの伸びが I/O タグでなく state/signals に集中したら、配線層フレーミングは誤りとして逆転させる」。現行ゲートは製品定義に対して無差別で、この振り替えの成否を判別できない。

Sources:
- [georapbox/custom-elements](https://github.com/georapbox/custom-elements) / [capture-photo-element](https://github.com/georapbox/capture-photo-element) / [picture-in-picture-element](https://github.com/georapbox/picture-in-picture-element) / [web-share-element](https://github.com/georapbox/web-share-element) / [@georapbox/capture-photo-element (npm)](https://www.npmjs.com/package/@georapbox/capture-photo-element)
- [davatron5000/awesome-standalones](https://github.com/davatron5000/awesome-standalones) / [Awesome Standalone (CSS-Tricks)](https://css-tricks.com/awesome-standalone-web-components/)
- [ionic-team/pwa-elements](https://github.com/ionic-team/pwa-elements) / [@ionic/pwa-elements (npm)](https://www.npmjs.com/package/@ionic/pwa-elements)
- [VueUse useWebSocket](https://vueuse.org/core/usewebsocket/) / [useGeolocation](https://vueuse.org/core/usegeolocation/) / [LogRocket: VueUse 概観](https://blog.logrocket.com/supercharge-vue-js-nuxt-js-apps-vueuse/)
- [react-use-websocket (npm trends)](https://npmtrends.com/react-use-websocket) / [react-use-websocket (npm)](https://www.npmjs.com/package/react-use-websocket) / [TanStack Query and WebSockets (LogRocket)](https://blog.logrocket.com/tanstack-query-websockets-real-time-react-data-fetching/)
- [Polymer/polymer#5240 (Polymer 4 deprecation)](https://github.com/Polymer/polymer/issues/5240) / [Death to @polymer, long live LitElement (DEV)](https://dev.to/btopro/death-to-polymer-long-live-litelement-and-htmlelement-36j7) / [iron-ajax (webcomponents.org)](https://www.webcomponents.org/element/@polymer/iron-ajax/elements/iron-ajax)
- [Datastar](https://data-star.dev/) / [starfederation/datastar](https://github.com/starfederation/datastar) / [htmx: Alternatives](https://htmx.org/essays/alternatives/) / [HTMX 4.0 vs Datastar 2026](https://kishansavaliya.com/blog/hypermedia-htmx-4-datastar-2026)
- [HTML Web Components (CSS-Tricks)](https://css-tricks.com/html-web-components-make-progressive-enhancement-and-css-encapsulation-easier/) / [Jeremy Keith: Extensible web components](https://adactio.medium.com/extensible-web-components-e794559b8c2e)
---

# レッドチーム報告: ベット(2)「js-framework-benchmark 公式提出が最高レバレッジ」の反証

## ① 反証に成功した点

**1. 「載れば見つけてもらえる」は定量的に反証される — jsfb は発見装置として機能した実績がほぼない。**
実調査の結果、jsfb は現在 **186 実装**の長尾テーブルであり(dlightjs / hellajs / qingkuai / mettle など無名実装が多数)、「React/Vue/Solid の隣に名前が並ぶ」は実態としては「181 個の無名実装の隣に並ぶ」である。決定的なのは上位常連の追跡調査:

- **mikado**: 約7年間トップ級 + Show HN 済み → **star 852 / fork 37 / npm 週間 DL 554**(2026-07 実測)。wcstack のミラー汚染 DL(1,060)より少ない。
- **ivi**: 約10年トップ級、作者 localvoid は「How to win in Web Framework Benchmarks」を書いた jsfb 界の著名人 → **star 799**。

**ベンチ首位を10年維持しても採用はほぼゼロ**が実証結果である。「上位に載る」より遥かに好条件の2例がこれなら、無名の signals が上位に載っても発見は起きないと推定するのが合理的(推測ではなく上記2点からの外挿)。

**2. Solid の事例は精査すると逆の教訓を出す — 「自分で叫ばずに済む」の反証。**
ドラフトが暗黙に依拠しているであろう成功例 Solid は、**2018 年時点で既にベンチを制覇していたのに 2021 年頃まで無名**だった。突破の実体は Carniato 本人の数年にわたる大量の技術記事・配信であり、記録上も「マーケは困難で、技術ブログと配信に頼った」とされる。ベンチは**配布チャネルではなく、本人が書く記事の弾薬**だった。つまり成立する因果は「提出 → 発見」ではなく「提出 → 自分の記事の証拠数値 → 読者の信頼」。ドラフトの核心的な売り文句「星乞いも記事投下も不要」は、唯一の成功例によって直接否定される(記事投下こそが必須だった)。

**3. 観客の不一致 — ベット(1)(3)との矛盾は実在し、ドラフト自身の論理で刺さる。**
jsfb が「買い手が自発的に見に行く比較文脈」であること自体は真(Nolan Lawson も選定判断への過大な影響力を認める)。しかしその観客は**新規にフレームワークを選定する人 = §3-4 で「追わない」と明示した買い手**である。
- 買い手①(既存アプリに1タグ)の比較対象は、ドラフト自身の定義(§2-2)により「自分で書く useEffect + 200 行」であり、10k 行テーブルの create/swap 性能は購入理由と無関係。
- 買い手②(日本の業務系)も jsfb を読まない。
- しかも提出されるのは signals = 反応コアであり、**主商品の I/O ノードはベンチに 1 ミリも現れない**。
§2-1 の「その軸では 5,250 テストも 41 パッケージも 1mm も効かない」という論理は、そのまま「配線層の買い手にはベンチ数値も 1mm も効かない」として跳ね返る。jsfb 提出は「勝てないと宣言した土俵に自ら再入場し、追わないと決めた観客に向けて、売らないと決めた商品(reactive core)を演じる」行為である。

**4. 「最高レバレッジ」の論証は費用と効果の混同。**
§8 決定 1 の実際の論拠は「作業完了済み・作る必要がない」= **限界費用が低い**ことであって、効果が高い証拠は文書中に一切ない。費用最小 ≠ 効果最大。しかも費用はゼロではない: Chrome リリースごとの公式ラン追随・依存固定・harness 変更対応という永続する小さな税があり、提出時は krausest 本人が VPS で再ビルド + isKeyed + 構造検証を行い、無名実装が vanilla/solid 級を出せば event delegation / RAF / recycling の sticky フラグ文化を持つ専門家(localvoid 級)の精査対象になる。state はプーリングで isKeyed 自動テスト合格(自社実証)だが、**自動テスト合格 ≠ 人間レビュー合格**であり、keyed 意味論はコミュニティで紛争履歴のある領域。「提出しない場合 Tier 1 の実効は半減する」(§8)は無根拠の断定であり、Tier 1 の実効はカタログ登録(買い手①に近い観客)と比較表が担っている。

**5. 機会費用で負ける。**
同じ時間・注意の投下先として、Tier 0-4(npm README 最適化 = AI 9 ラン実測で唯一「全文が生で返る」面)、Tier 1-2(webcomponents.org 等 = 「Web Components を探している人」という買い手①隣接の観客)、Tier 2-1(5 スタック比較記事 = 買い手の唯一の質問に直接回答)は、いずれも観客が買い手定義と一致している。jsfb だけが観客不一致。「最高レバレッジ」の格付けは実測と整合しない。

## ② 耐えた点

1. **期待値が負にはならない。** 作業完了済みで限界費用が本当に小さく、撤退も容易(放置すればアーカイブされるだけ)。「やる価値がない」とまでは反証できなかった。
2. **逆宣伝リスクは signals 先行なら小さい。** signals は実測 vanilla/solid 級で、載って恥ずかしい数値ではない。「state=React 級の中位が逆宣伝」という攻撃は、ドラフトが signals 先行を選んだ時点で半分防がれている。
3. **信頼装置としての価値は本物。** Tier 1-3(LP 比較表)・Tier 2-1(比較記事)・将来の Show HN で「第三者の場で計測された数値」として引用できることは、自前ベンチと桁違いの信頼を持つ。Solid の実経路もこれ。**配布チャネルとしては死んでいるが、引用元としては生きている。**
4. **永続性・防御価値。** jsfb は 10 年物のインデックス済み高権威資産で消えない。「Web Components のバインディングは遅い」という将来の攻撃への一次資料になる。AI の学習・検索コーパスに権威文脈で入る可能性もある(ただしこれは推測。9 ラン実測は「検索に出るか」が全てで、効果は未検証)。

## ③ 修正提案

- **提出自体は実行してよい**(費用ほぼゼロ + 信頼装置価値)。ただし**「最高レバレッジ」の格付けと Tier 1 筆頭の座を剥奪**し、「Tier 1-3 / Tier 2-1 の弾薬製造(支援施策)」に降格する。実行順序上も他施策をブロックしない位置に置く。§8 の「提出しない場合 Tier 1 の実効は半減」は削除する。
- **提出物は signals のみ。state は提出しない** — until: (a) 中位数値を物語に変える文脈(「宣言的 DSL バインディング層込みでこの速度」という比較記事)が先に存在する、かつ (b) プーリングの keyed 意味論を人間レビューで争う準備ができる、まで。
- **主張しないこと**: 「fastest」系の自己宣伝をしない(専門家精査を招き、上位常連の慣行との比較で相対化される)。signals の数値を wcstack 全体、特に I/O ノードの性能主張に転用しない(I/O ノードは測られていない)。数値は常に「jsfb 公式・Chrome バージョン・keyed」の出典リンク付きで、スクリーンショット単独で使わない。
- **主張してよい上限**: 「反応コア(signals)は公式ベンチで vanilla/solid 級。配線層のオーバーヘッドを心配する必要はない」という**不安除去の一文**まで。性能を購入理由に昇格させない。
- **until 条件付きの成功判定**: 提出後 Chrome 2 バージョン分の公式ランで、referral 流入・star・外部 issue に計測可能な変化がなければ「発見装置」としての期待を正式に破棄し、以後は引用素材としてのみ扱う。維持コストが月 1 時間を超えたらアーカイブを受け入れる(6 ヶ月ゲートで売り込み停止した場合、1 年不活動アーカイブ規定により自然退場することも織り込んでおく)。

Sources:
- [krausest/js-framework-benchmark (GitHub)](https://github.com/krausest/js-framework-benchmark)
- [公式結果ページ](https://krausest.github.io/js-framework-benchmark/)
- [frameworks/keyed ディレクトリ](https://github.com/krausest/js-framework-benchmark/tree/master/frameworks/keyed)
- [Wiki: Process for merging a pull request](https://github.com/krausest/js-framework-benchmark/wiki/Process-for-merging-a-pull-request)
- [Nolan Lawson: The greatness and limitations of the js-framework-benchmark](https://nolanlawson.com/2024/10/13/the-greatness-and-limitations-of-the-js-framework-benchmark/)
- [localvoid: How to win in Web Framework Benchmarks](https://medium.com/@localvoid/how-to-win-in-web-framework-benchmarks-8bc31af76ce7)
- [Issue #796: explicit requestAnimationFrame flag](https://github.com/krausest/js-framework-benchmark/issues/796) / [Issue #801: explicit event delegation flag](https://github.com/krausest/js-framework-benchmark/issues/801)
- [nextapps-de/mikado](https://github.com/nextapps-de/mikado) / [Mikado Show HN (2020)](https://news.ycombinator.com/item?id=22853497) / [localvoid/ivi](https://github.com/localvoid/ivi)
- [Grokipedia: Ryan Carniato](https://grokipedia.com/page/Ryan_Carniato) / [CoderPad interview with Ryan Carniato](https://coderpad.io/blog/development/interview-with-creator-of-solidjs-ryan-carniato/) / [ryansolid: How I wrote the fastest JavaScript UI framework](https://ryansolid.medium.com/how-i-wrote-the-fastest-javascript-ui-framework-37525b42d6c9)
---

# レッドチーム報告: 中核ベット(3)「買い手の定義と優先順位」への反証

## ① 優先順位への反証

### 反証1: 優先順位1位「既にアプリを持っている個人開発者」はセグメントではなく属性である。到達チャネルが定義できない

「既にアプリを持っている」は開発者のほぼ全員に当てはまる記述であり、**共通の生息地・共通のメディア・共通の検索クエリを持たない**。セグメントの成立条件は「その集団だけが読む場所」か「その集団だけが打つクエリ」の少なくとも一方だが、ドラフトはどちらも示していない。ドラフト自身の 9 ラン実測が「検索に出なければどうにもならない」と結論している以上、**固有クエリなき優先セグメントは自己矛盾**である。

さらに深刻なのは、この層が実際に打つクエリの着地点だ。React アプリに WebSocket を足したい人が打つのは「react websocket hook」であり、着地するのは react-use-websocket / VueUse / react-use といった**確立済みのフックライブラリ**である。ドラフト §2-2 の「自分で書く useEffect 200 行との比較」は藁人形であり、買い手の現実の代替は「`npm i react-use-websocket` して 5 行」だ。「直接競合が存在しない」は“Web Components の配線層”という自己定義の土俵でのみ真であり、**買い手の検索現実ではフレームワークごとのフック集が事実上の競合**として鎮座している。しかも React/Vue アプリへの導入経路は「タグ 1 個」ではなく「@wc-bindable アダプタ（第三者検証ゼロ・ドラフト §7 が自認）＋ wcstack パッケージ＋ data-wcs 構文学習」の三段であり、フック 1 行に対して摩擦で負ける。

**「1 タグから刺せる」という商品定義が最も効くのは、フレームワークのランタイムが存在しないページ**——つまりサーバーレンダリング HTML——であって、既存 SPA ではない。ドラフトは商品定義（ベット 1）を正しく変えたのに、買い手定義（ベット 3）を旧商品のまま置いている。これがベット間の不整合の核心。

なお同 1 位に束ねられた「社内ツール実装者」は別人格である（バックエンド寄り・React 職能なし・ダッシュボード/管理画面が主戦場）。こちらは有望だが、束ねたせいで打ち手が個人開発者向けに希釈されている。推測として付記: 企業内ネットワークでは CDN がプロキシで遮断される例が珍しくなく、「CDN 一発」の売り文句は社内ツール文脈でそのままでは通らない（単一 ESM ファイルの自己ホストで回避可能だが、その導線は現状どこにも書かれていない）。

### 反証2: 優先順位2位「日本の業務系フロントエンド」は意思決定構造を無視しており、Zenn/Qiita では組織に届かない

業務系（SIer・受託・情シス）のライブラリ選定は個人の裁量ではなく、**標準化ガイドライン・保守継続性・EOL 保証・サポート主体の複数性**で決まる。作者 1 名・外部ユーザー 0・bus factor 1 は、技術品質と無関係にこの審査で落ちる。ドラフト §2-2 の武器「事例不要・決裁者は本人」は、まさに業務系では成立しない前提であり、**ベット 2 位はベット全体の論理（事例不要の導入経路を売る）と矛盾している**。

Zenn/Qiita が届くのは組織ではなく個々のエンジニアであり、その個人が裁量で入れられるのは結局「社内ツール・保守案件の片隅」——つまり 1 位セグメントに還元される。**2 位は独立セグメントではなく、1 位に日本語という地理属性を被せたもの**にすぎない。

また「buildless・日本語ドキュメントが利点に反転する唯一の市場」という主張は、**Vue が既に同じポジションを 10 年占有している**事実を無視している。Vue は日本語ドキュメント完備で CDN 直読みのビルドレス利用が可能であり、日本の業務系がまさにその理由で Vue を選んできた。「唯一の市場」ではなく「Vue の既得地」である。ただし日本市場に固有の実クエリは存在する: **脱 jQuery**。レガシー保守の現場で jQuery が大量残存していることは検索結果でも裏が取れており、「jQuery を剥がしたいがビルドパイプラインは入れられない保守案件」は、業務系の中で唯一クエリが立つ細分市場だ。狙うならセグメント名は「日本の業務系」ではなく「脱 jQuery 保守」であるべき。

### 反証3: 「AI エージェント＝長期の賭け」への格下げは、カテゴリ錯誤の上に立っている

まず事実関係（数値は SEO 系ブログ由来を含むため方向性のみの証拠として扱う）: 2026 年時点で新規コードの 4 割前後が AI 生成とされ、年末に 6 割との予測もある。ドキュメントサイトのトラフィックの半分近くが AI エージェント由来という報告もある。つまり**ライブラリ選定の相当部分が既に AI を経由している**。これは「長期」ではなく現在進行形だ。

ドラフトの格下げ根拠は 9 ラン実測（検索に出なければ到達しない）だが、これは**「今日の到達性が低い」ことの証明であって「チャネルの価値が低い」ことの証明ではない**。しかも到達性の欠陥は、ドラフト自身が Tier 0 に置いた施策（npm README 最適化——`npm view` が全文を生で返すことは実測済み——、llms.txt 敷設済み、カタログ登録、jsfb 掲載）で数日〜数週間で修理可能な種類のものだ。修理可能な欠陥を理由に恒久的な順位を下げるのは論理の取り違えである。

さらに AI チャネルには人間チャネルにない決定的な性質がある。**AI は star 数・求人・キャリア価値・bus factor で差別しない**（学習データの頻度バイアスで人気ライブラリに寄る傾向はあるが、コンテキストに与えられたドキュメントは読む）。ドラフト §2-1 が「人間の買い手には 1mm も効かない」と切り捨てた資産——5,250 テスト・53 設計文書・manifest ベースの検証可能性・網羅的 README——は、**AI の選定基準にはそのまま効く**。人間市場で無価値な資産が唯一換金できる面を 3 位に置くのは資産配分として誤り。

根本の錯誤はカテゴリにある。1 位・2 位は「買い手（人間）」だが、AI エージェントは買い手ではなく**チャネル（新しい流通中間層）**だ。買い手リストの 3 位に置くから「長期の賭け」に見える。チャネルとして扱えば、全 Tier 0 施策に AI 可読性要件を焼き込む（費用ほぼゼロ・効果は横断）が正解であり、順位づけの対象ですらない。

### 反証4: 「追わないリスト」が浅い。捨てる判断をした市場より、検討すらされなかった市場が問題

「新規 SPA スタートアップ・欧米エンタープライズを追わない」は正しいが、htmx が実証した「サーバーレンダリング＋ちょい動的」市場、キオスク/サイネージ、CMS テーマ作者など、**配線層という新商品定義に最も適合するセグメントが検討の痕跡なく欠落**している。商品定義を変えたのに買い手候補の母集団を再列挙していない。

---

## ② 欠落セグメントの評価表

凡例: ◎高 ○中 △低 ✗不適。「到達」= ソロ・時間のみ・自分で叫ばない制約下での実効チャネル有無。

| セグメント | 実在性 | 到達可能性 | wcstack 適合度 | 推奨度 | 根拠・備考 |
|---|---|---|---|---|---|
| **(a) サーバーレンダリング派**（Rails/Django/Laravel/PHP + htmx/Alpine 利用層） | ◎ 実証済み市場。Alpine.js は Wappalyzer 計測で 37 万サイト、htmx は State of JS 2025 で最高評価帯 | ◎ 明確な水場（awesome-htmx、各 FW のコミュニティ、Laravel News 等）と固有クエリ（「htmx websocket」「alpine.js camera」）。**競合フック集が存在しない検索面** | ◎ FW ランタイム不在ページ＝「タグ 1 個」が文字通り成立する唯一の環境。htmx はサーバ通信、Alpine は UI 状態を扱い、**デバイス/ブラウザ API（camera/geo/speech/wakelock/ws）は両者の空白**＝競合でなく補完で入れる。懸念: LP/README が「SPA を作る」文脈で書かれており、この層には敵性言語 | **◎ 最優先候補** |
| (b) 教育者・プログラミング学習 | ○ ビルド不要教材の需要はあるが分散 | △ 教育者の水場はあるがカリキュラム改定は年単位で遅い | △ buildless は合うが、教育の主流は「素の標準を教える」であり独自 DSL（data-wcs）はむしろ忌避対象。業界標準でないものは課程に載らない | △ 専用施策は打たない。CodePen 即動サンプルの副産物で拾えれば十分 |
| **(c) 社内ダッシュボード/キオスク/サイネージ** | ◎ 静かだが大きい常設ブラウザ市場（Pi + ブラウザ構成が定番） | ○ ソリューション型クエリ（「javascript kiosk wake lock fullscreen」等）が立つ。コミュニティは分散だが検索面で拾える | ◎ **wakelock/fullscreen/idle/network/screen-orientation/sse/ws/timer/raf はキオスク用品一式そのもの**。長時間無人稼働ページは依存ゼロ・ビルド無しの価値が最大化する。宣言的 wakelock タグの競合は実質不在 | **○〜◎ 「キオスク・スターターキット」1 ページ（Tier 2-3 ロングテールの旗艦）として実装** |
| (d) ノーコード/ローコード脱出口 | ○ 需要は実在するが定義が曖昧 | ✗ 水場がプラットフォーム内に閉じており外部 OSS が届かない | △ script+タグ貼付は技術的には好適だが、利用者は HTML デバッグ能力を欠きサポート負債化する | ✗ 追わない |
| (e) ブラウザ拡張・Electron・PWA | ◎ 開発者人口は大きい | ○ コミュニティ明確 | **分裂**: 拡張は MV3 のリモートコード禁止で **CDN 一発の売りが原理的に死ぬ**（単一ファイル同梱なら可・依存ゼロは審査で利点）。Electron は Node 直叩きできるためブラウザ API ラッパーの需要が薄い。PWA は notification/SW 対応など適合良好 | △ PWA 文脈は主戦線 (a)(c) に自然に内包。拡張向けは「単一ファイル vendoring」導線を README に 1 節書く程度 |
| (f) 政府・自治体・長期保守案件 | ○ SBOM・サプライチェーン監査要件は実在し増加傾向（推測含む） | ✗ 調達は Zenn を読まない。SIer 経由の間接到達のみで営業サイクルは年単位 | 表面上◎（依存ゼロ＝SBOM 1 行）だが、**この層が最も重視する「組織的継続性」が bus factor 1 で即死**。依存ゼロを最も評価する市場が、wcstack に最も欠けるものを最も要求するというパラドックス | ✗ 直販は追わない。ただし「依存ゼロ＝監査対象 1 パッケージ」は (a)(c) の買い手のセキュリティレビュー向け**メッセージ資産**として LP に 1 行載せる価値あり |
| (g) 【追加発掘】CMS テーマ/プラグイン作者（WordPress/Shopify） | ○ テーマ作者はエンドユーザーにビルド環境を要求できない＝ドロップイン タグと構造的適合 | ○ テーマ開発コミュニティは明確 | ○ (a) の亜種。ライセンスと同梱形態の明文化が前提 | △〜○ (a) に内包して扱う |
| (h) 【追加発掘】脱 jQuery 保守（日本） | ◎ レガシー jQuery の大量残存は検索でも裏取り可 | ○ 「jQuery 代替 ビルド不要」系クエリ＋Zenn。個人裁量で入る保守現場 | ○ ビルド導入不可の保守案件で React/Vue 移行の対抗馬になれる唯一の細分市場 | ○ 「日本の業務系」はこれに縮小して残す |

---

## ③ 修正した優先順位の提案

**構造の修正**: 「買い手（人間セグメント）」と「チャネル」を分離する。AI は買い手リストから外し、チャネル要件として全施策に焼き込む。

**買い手の優先順位（修正案）**:

1. **サーバーレンダリング派＋ちょい動的層**（htmx/Alpine/Livewire の隣・CMS テーマ作者含む）— 実証済み市場・固有クエリあり・競合フック集不在・「タグ 1 個」が文字通り成立する唯一の環境。楔は「htmx/Alpine と同居するデモ＋ awesome-htmx 等への登録」。**ただし LP/README の SPA 文脈をこの層向けに書き分けることが前提条件**。
2. **社内ツール/ダッシュボード/キオスク実装者** — ドラフト旧 1 位のうち到達チャネルを定義できる半分だけを残したもの。「キオスク・スターターキット」ページを Tier 2-3 ロングテールの旗艦にする。CDN 遮断環境向けに単一ファイル自己ホスト導線を明記。
3. **脱 jQuery 保守（日本）** — 「日本の業務系フロントエンド」をこの細分に縮小。Zenn 漏斗はここにのみ効く。SIer 組織市場は追わない（追わないリストへ移す）。
4. **既存 React/Vue アプリ持ち** — 廃止はしないが 4 位に降格。競合（VueUse/react-use 等のフック集）が強く、アダプタは第三者検証ゼロで摩擦が三段ある。位置づけは「主戦場」ではなく「技術的証明」（Tier 2-2 のデモ 1 本で足りる）。

**チャネル横断要件（順位づけしない・全 Tier 0 施策に焼き込む）**: AI エージェント可読性 — npm README 生テキスト最適化・llms.txt 維持・manifest/カタログ登録・wcstack-skill 追随。費用は数日、効果は買い手 1〜4 全員に横断。「長期の賭け」という格下げを撤回し「即時・低コスト・横断チャネル」に再分類する。

**追わないリスト（追加）**: 教育市場・ノーコード脱出口・政府/自治体直販・SIer 組織調達。

**最重要の一点**: ドラフトはベット 1 で商品を「配線層」に正しく差し替えたが、ベット 3 の買い手 1 位は旧商品（フレームワーク併用前提の SPA 保有者）のまま残っている。配線層の自然な買い手は「FW を持っている人」ではなく「**FW を持っていない・入れたくない人**」であり、それは htmx が既に地図を描いた市場である。買い手定義をそこへ合わせない限り、ベット 1 の振り替えは半分しか効かない。

**証拠の限界**: AI 生成コード比率（41%→60% 予測）は SEO 系集計ブログ由来で精度は低く方向性のみの証拠。Alpine の 37 万サイトは Wappalyzer 計測。日本の CDN 遮断慣行・SBOM 要件の広がりは推測を含む（本文に明記済み）。

Sources:
- [AI Coding Adoption 2026: 50 Statistics From 7 Surveys](https://www.digitalapplied.com/blog/ai-coding-adoption-statistics-2026-50-data-points)
- [AI Coding Assistant Statistics — getpanto.ai](https://www.getpanto.ai/blog/ai-coding-assistant-statistics)
- [htmx in 2026: When You Don't Need React — DEV Community](https://dev.to/pockit_tools/htmx-in-2026-when-you-dont-need-react-and-when-you-absolutely-do-2mf4)
- [Is HTMX Worth Learning in 2025? — WeAreDevelopers](https://www.wearedevelopers.com/en/magazine/537/is-htmx-worth-learning-in-2025-537)
- [Websites using Alpine.js — Wappalyzer](https://www.wappalyzer.com/technologies/javascript-frameworks/alpine-js/)
- [Alpine.js guide 2026 — daily.dev](https://daily.dev/blog/alpine-js-the-ultimate-guide/)
- [Best llms.txt Platforms — Fern](https://buildwithfern.com/post/best-llms-txt-implementation-platforms-ai-discoverable-apis)
- [Best AI Documentation Tools in 2026 — Mintlify](https://www.mintlify.com/library/best-ai-documentation-tools)
- [jQuery フル活用のレガシーフロントエンドからの脱却 — Zenn](https://zenn.dev/kiwi/articles/bb73fc7ed9fa8d)
- [jQueryとは終わった技術なのか — ウェブスタッフ](https://www.webstaff.jp/guide/trend/jquery/)
---

調査完了。以下が最終報告です。

---

# ソロ発フロントエンド OSS の無名→認知 事例調査（2026-08-01）

## 結論（先に要点）

6 事例（htmx / Alpine.js / VanJS / Datastar / Shoelace / Hono、補強として SolidJS）を調査した結果、共通構造は次の 4 点。

1. **最初の 1000 stars は自分のチャネルからは生まれない。** 全事例で転換イベントは「第三者の場」（HN フロントページ、他人のカンファ講演、Fireship、ベンチマーク、プラットフォーム公式ブログ）で起きている。ドラフトの bet(2)（jsfb 提出＝自分で叫ばない配布）はこの構造と完全に整合し、**SolidJS が直接の先行実証**。
2. **技術が同じでも「語彙と物語」がなければ 6 年無風**（htmx の前身 intercooler.js が実証）。ドラフト bet(1)（売り物の再定義）は正しい方向だが、事例上は「定義の変更」だけでは足りず、**対比構造を持つ看板エッセイと数値化された一言**が伴って初めて機能している。
3. **隣接する既存コミュニティへの寄生が最速**（Alpine→Laravel/Tailwind、Datastar→htmx Discord、Hono→Cloudflare Workers）。wcstack に該当する水場は Web Components コミュニティと日本語圏で、bet(3) の買い手優先順位②（日本の業務系）は Hono の初期構造と整合する。
4. **時間軸は年単位。** HN スパイク一発で得た star は定着しない（VanJS）。Shoelace は 3 年以上、Solid は 3 年、htmx は前身込み 9 年。6 ヶ月ゲートは撤退条件としては健全だが、「認知の成否判定」としては事例上短すぎる可能性がある（推測ではなく事例の時間軸からの帰納）。

---

## 事例別詳細

### 1. htmx（Carson Gross・ソロ）

**ゼロ→初期認知の転換イベント**
- 前身 intercooler.js（2013）は技術的にほぼ同一のまま **約 6 年間無名**。2020-11 に htmx 1.0 として改名・jQuery 依存除去。
- 最大の転換点は **DjangoCon EU 2022 の第三者講演**「From React to htmx on a real-world SaaS product」（Contexte 社 David Guillot）。React 撤去で **コード 67% 減（21,500→7,200 LOC）・JS 依存 96% 減（255→9）・ビルド 88% 短縮**という定量スライドが「mother of all htmx demos」として拡散し、htmx 自身がこれをエッセイ化して常設した。
- 2023: GitHub Accelerator 第 1 期採択、Fireship の動画で YouTube 層に到達。

**看板エッセイの構造**
htmx.org/essays に数十本を常設。構造は一貫して「**現代 SPA の複雑性 vs 素朴なハイパーメディア**」の対比で、(a) 語彙の発明（Locality of Behavior / HDA / 「REST の意味の転倒」）、(b) 歴史への参照（Fielding 論文・2004 vs 2019 のアーキ比較ミーム）、(c) 実世界移行事例の定量化、の 3 点セット。加えて Twitter ではミーム運用（「批判は増幅して肯定に転じる」を Big Sky Dev Con 2024 の講演 "A Theory of Open Source Marketing" で明言）。真面目な主張はエッセイと ACM 論文に、拡散はミームに、と面を分離している。

**失敗した/やらなかった施策**
intercooler 期の 6 年が「同一技術・物語なし」の対照実験になっている。有料マーケ・SEO 施策は無し。

**再現可能 / 不能**
- 再現可能: エッセイ常設・語彙の発明・第三者事例の定量フォーマット・「負を正に増幅する」応答姿勢・10 年続ける一貫性。
- 再現不能: React 疲れという時流（2022-23）、Fireship に拾われる運、英語ネイティブのミーム筆力、大学教員という時間的余裕。

### 2. Alpine.js（Caleb Porzio・ソロ）

**転換イベント**
2019-11 v0.1 → 12 月 v1.0。数週間で立ち上がったが、これは **Laravel コミュニティに既設の聴衆があった**ため: Livewire（2019）作者として既知、元 Tighten 社員、2020-01-14 に Adam Wathan（Tailwind 作者）の Full Stack Radio へ出演、2020-03 に CSS-Tricks 記事。TALL スタック（Tailwind+Alpine+Laravel+Livewire）への組み込みで制度化された。

**看板の構造**
エッセイではなく **1 行のカテゴリ定義文**: 「**jQuery のように使えて、Vue のように書けて、Tailwind に着想を得た**」（CSS-Tricks 記事タイトルとして定着）。既知の 3 点を座標にして新カテゴリを 1 文で規定した。

**やらなかったこと**
長期間ドキュメントは README 一枚。ロゴも名前も当初は付けない方針だった。それでも伸びた＝聴衆との距離が整備品質より支配的だった（本人談の再構成・推測含む）。

**再現可能 / 不能**
- 再現可能: 既知の座標 3 点で自分を定義する 1 行、隣接コミュニティの未充足ニーズ（ビルド不要の軽量リアクティビティ）を狙い撃つこと。
- 再現不能: 発射前から持っていた聴衆と人脈（Wathan・Laravel 界隈）。**wcstack が最も欠く資産であり、Alpine 型の即時立ち上がりは wcstack には期待できない**。

### 3. VanJS（Tao Xin・ソロ・聴衆ゼロ）

**転換イベント**
2023-05 の HN フロントページ（「World's smallest reactive UI framework・1.0kB」）。聴衆ゼロのバックエンド出身者が、**数値で検証可能な超一級の一言（最小 1.0kB・50〜100 倍小さい）＋サイト上の対 React/Vue 比較表**だけで到達した。翌月にも再度 HN 入り。

**構造**
エッセイなし。「世界最小」という **反証可能な superlative** が主張の全て。

**失敗（帰納される教訓）**
HN スパイク後、star は付いたがエコシステム・コミュニティの定着は限定的（現在の利用規模は小さいまま。これは推測を含む評価）。**スパイクは認知をくれるが採用をくれない**。wcstack ドラフトの「Tier 0-2 が揃うまで Show HN を撃たない」は、この失敗パターンの正しい回避策。

**再現可能 / 不能**
- 再現可能: 数値化された一言・比較表・サーバ不要デモ。聴衆ゼロでも HN は実力で通ることの実証。
- 再現不能: 「世界最小」の座は既に埋まっている。wcstack は別軸の superlative が要る。

### 4. Datastar（Delaney Gillilan・ソロ）

**転換イベント**
htmx コミュニティへの寄生。作者は htmx Discord の常連（HN コメントでも「datastar の連中は htmx Discord にいつもいる」と観測されている）で、htmx ユーザーの不満（Alpine 併用の必要性）を正面から解決する形で設計。自サイトに **「htmx Sucks」という挑発的比較エッセイ**を置き、htmx の土俵の議論をそのまま流入経路にした。Talk Python 等ポッドキャスト巡回、1.0 で財団設立。ベンチマーク主張（signals が既存最速比 60 倍・作者主張）をフックに使う。

**再現可能 / 不能**
- 再現可能: 隣接コミュニティの水場に住み、そこで既に起きている論争に対して比較文書で答えること。挑発的タイトルは実測で裏を取れる場合のみ機能する。
- 再現不能: htmx という急成長中の宿主の存在。wcstack の宿主候補は Web Components 界隈（open-wc / Lit コミュニティ / webcomponents.org）と日本語圏だが、htmx ほどの上昇気流はない（推測）。

### 5. Shoelace（Cory LaViska・ソロ → Font Awesome 買収）

**転換イベント**
単発イベントなし。**数年がかりのスロー・バーン**（2017 開始、2020 に Web Components ベースへ v2 全面書き換え、2022 に Font Awesome が作者側に接触して買収）。買収前に **jsDelivr 月間 1 億ヒット**へ到達。フレームワーク非依存 UI コンポーネントという明確な検索需要の「正解の座」を、ドキュメント品質と CDN 一発配布で取り続けた結果。

**wcstack への含意**
- jsDelivr ヒットを真値 KPI とするドラフト §5 は、Shoelace の成長経路とまさに同型（CDN 直配布の WC 製品の実利用は jsDelivr に出る）。
- ただし Shoelace は「UI コンポーネント集」という**検索需要が既に存在するカテゴリ**だった。wcstack の「I/O 配線層」はカテゴリ自体を新設する必要があり、その分ロングテール検索面の整備（ドラフト 2-3）が代替手段になる。
- 再現不能要素: 買収による資金化は運と時流。

### 6. Hono（和田裕介・日本人ソロ）— 日本発の初期突破

**転換イベント**
2021-12-15 初コミット。**新興ランタイム（Cloudflare Workers）にまともなフレームワークが無いという真空**を埋めた。初期ユーザーは CF Workers コミュニティそのもの。v2 で Deno/Bun 対応に広げたことを作者自身が「Workers 専用のままなら伸びなかった」と回顧（Cloudflare 公式ブログ）。その後 Cloudflare 自身が製品（D1/KV/Queues 等)に採用し、作者は 2023 年に Cloudflare 入社。Prisma/Supabase/Vercel 等が例示に採用する「プラットフォーム側からの被参照」が配布装置になった。国内では Workers Tech Talks を各都市で自主開催し、2024 年に Hono Conference 開催。

**日本人ソロ開発者として再現可能な要素**
- **リポジトリと README は初日から英語**、日本語の発信（ブログ/Zenn/YAPC 講演）は国内コミュニティの維持に併用する二層構造。
- タグライン「Ultrafast」＋ベンチマークを README 冒頭に置く数値訴求。
- 再現不能: Cloudflare Workers という上昇気流のタイミング、プラットフォーマーによる公式採用と雇用。

### 補強: SolidJS（Ryan Carniato）— bet(2) の直接実証

- js-framework-benchmark を発見したことが公開の直接動機（2018-04 OSS 化）。ベンチ最上位に載ったことで「無名ソロの自作フレームワーク」が議論のテーブルに乗った。
- ただし (a) **速すぎて「チート」を疑われ、検証に約 1 年を要した**、(b) ベンチだけでは伸びず、数年にわたる長文技術ブログ（"How we wrote the fastest JS framework" 等）との併用で v1.0（2021）に到達。**ベンチはドアオープナーであり成長エンジンではない**。

---

## wcstack が模倣すべき打ち手 Top5（事例根拠つき）

### 1. jsfb 公式提出を即決裁・実行する（根拠: SolidJS・htmx の「第三者の場」原則）
無名ソロが自分の主張抜きで比較文脈に載る唯一の恒久面。ドラフト 1-1 をそのまま支持する。ただし Solid の経験から、好成績はまず疑われる。
**30 日アクション**: 提出 PR に実装ノート（最適化手法の説明・非チート性の自己開示）を同梱する。maintainer との往復を最優先タスク化し、疑義対応を「信用構築の場」として扱う（Carson の「負を正に増幅」）。

### 2. 数値化された一言（quantified superlative）を確定し全面に統一する（根拠: VanJS「1.0kB」・Hono「Ultrafast」）
現 H1 は思想文で数値がない。反証可能な数値の一言が第三者の場（HN/カタログ/npm）で生き残る。候補軸: 「**39 Web APIs as HTML tags. 0 build. 0 dependencies.**」（39/0/0 は全て検証可能）。
**30 日アクション**: LP H1 直下・ルート README 冒頭・npm description の 3 面を同一文に統一（ドラフト決定 2 の実装と同時に実施。作業数時間）。

### 3. 看板エッセイ 1 本を「対比の定量表」で書く（根拠: htmx エッセイ群＋Contexte 講演の 67% フォーマット、Alpine の 1 行定義）
htmx の教訓は「技術同一でも語彙がなければ 6 年無風」。書くべきは思想の再演ではなく、**「自分で書く useEffect + MediaRecorder + 再接続管理 200 行」vs「タグ 1 個」の LOC・依存数・行数の実測表**（Contexte スライドの縮小自作版）。素材は既存の websocket-chat 5 スタック実装にあり、新規開発ゼロで書ける（ドラフト 2-1 の前倒し）。
**30 日アクション**: 5 スタック比較から React vs state/signals の定量表（LOC/依存/ビルド有無）を抽出し、まず英語版を LP と README に常設（＝配布しない常設面。Zenn 配布・Show HN はドラフト Tier 3 の順序を維持）。1 行定義文も併設: 「Used like HTML, wired like a framework」型の 3 点座標文を作る。

### 4. 隣接コミュニティの水場に住所を持つ（根拠: Datastar→htmx Discord、Alpine→Laravel、Hono→CF Workers）
wcstack の宿主候補は (a) Web Components 界隈（open-wc Community Libraries / webcomponents.org / awesome-standalones への登録＝ドラフト 1-2、Lit Discord / Web Components コミュニティでの回答活動）、(b) 日本語圏（Zenn の「脱ビルド」「Web 標準」文脈）。登録は被リンクと検索面、常駐は最初の外部 issue の母集団になる。
**30 日アクション**: カタログ 3 箇所へ登録（各 30 分）。加えて WC 系 Discord/フォーラムで週 1 回、他人の質問に回答する枠を固定（売り込みではなく回答。Datastar 型の信用蓄積）。

### 5. 日本語圏をホーム、英語をデフォルトにする二層構造の徹底（根拠: Hono）
Hono は英語リポジトリ＋日本語コミュニティ運営で「国内ロックイン」を回避しつつ初期の熱量を国内から得た。wcstack は日本語ドキュメント完備が既に強み（bet(3) ②と整合）。ただし Hono 型の「プラットフォーム真空」は wcstack には無いため、真空の代替は「I/O 配線という無競合カテゴリ」自体になる（ドラフト §2-2 の主張を支持。ただしカテゴリ新設は検索需要ゼロからの立ち上げであり、Shoelace 型の既存需要より時間がかかると推測される）。
**30 日アクション**: npm README 最上部の 1 タグ導入例（ドラフト 0-4）を英語で統一 → その上で Zenn に日本語の看板エッセイ初版を投下し、反応を漏斗計測（GoatCounter 敷設後）。国内の反応が Tier 3 英訳版の品質管理になる。

### 補足: 事例が示す「やってはいけない」
- **HN 一発を今撃つ**（VanJS の定着失敗パターン＋現 LP はデモ 0。ドラフトの Tier 3 順序厳守は正しい）。
- **アダプタ 20 個を実績として語る**（Datastar の挑発が成立するのは裏が取れる場合のみ。ドラフト §7 の自己開示方針は htmx の「負を正に」原則とも一致し正しい）。
- **6 ヶ月で認知の成否を断定する**こと自体は要注意。事例の中央値は「無風期間 2〜6 年」。6 ヶ月ゲートは「売り込み活動の撤退条件」としては維持し、「プロジェクト価値の判定」とは切り分けて運用すべき。

---

Sources:
- [htmx lore (htmx.org)](https://htmx.org/essays/lore/)
- [htmx essays 一覧](https://htmx.org/essays/)
- [A Real World React -> htmx Port (Contexte 事例)](https://htmx.org/essays/a-real-world-react-to-htmx-port/)
- [DjangoCon Europe 2022: From React to htmx (pretalx)](https://pretalx.evolutio.pt/djangocon-europe-2022/talk/MZWJEA/)
- [A Theory of Open Source Marketing by Carson Gross (Big Sky Dev Con 2024, YouTube)](https://www.youtube.com/watch?v=zGyAWH5btwY)
- [Complexity bad: An interview with Carson Gross (InfoWorld)](https://www.infoworld.com/article/2336201/complexity-bad-an-interview-with-carson-gross.html)
- [Htmx (Wikipedia)](https://en.wikipedia.org/wiki/Htmx)
- [I Reviewed 1,000s of Opinions on HTMX (Konfig)](https://konfigthis.com/blog/htmx/)
- [Full Stack Radio 132: Caleb Porzio - Just Enough JavaScript with Alpine.js](https://fullstackradio.com/132)
- [Alpine.js: The JavaScript Framework That's Used Like jQuery, Written Like Vue, and Inspired by TailwindCSS (CSS-Tricks)](https://css-tricks.com/alpine-js-the-javascript-framework-thats-used-like-jquery-written-like-vue-and-inspired-by-tailwindcss/)
- [From Terrible Employee to Open Source Entrepreneur: Caleb Porzio (Tighten)](https://tighten.com/insights/bol-ep2-caleb-porzio-livewire-and-alpinejs/)
- [Alpine.js with Caleb Porzio (PodRocket)](https://podrocket.logrocket.com/alpinejs)
- [VanJS: smallest reactive UI framework (Hacker News, 2023-05)](https://news.ycombinator.com/item?id=36067983)
- [VanJS: A Minimalist 'Vanilla JavaScript' UI Framework (The New Stack)](https://thenewstack.io/vanjs-a-minimalist-vanilla-javascript-ui-framework/)
- [vanjs-org/van (GitHub)](https://github.com/vanjs-org/van)
- [Datastar: Modern web dev, simplified (Talk Python #537)](https://talkpython.fm/episodes/show/537/datastar-modern-web-dev-simplified)
- [htmx Sucks (Datastar)](https://data-star.dev/essays/htmx_sucks)
- [HN コメント: datastar と htmx Discord](https://news.ycombinator.com/item?id=44055088)
- [Shoelace Joins Font Awesome (Blog Awesome)](https://blog.fontawesome.com/shoelace-joins-font-awesome/)
- [From Shoelace to Web Awesome (JS Party #322)](https://changelog.com/jsparty/322)
- [The story of web framework Hono, from the creator of Hono (Cloudflare Blog)](https://blog.cloudflare.com/the-story-of-web-framework-hono-from-the-creator-of-hono)
- [Hono[炎] Ultrafast web framework (YAPC 2022 スライド)](https://yusukebe.github.io/slides/yapc2022-hono/)
- [Dev Discussions: Ryan Carniato of SolidJS (CoderPad)](https://coderpad.io/blog/development/interview-with-creator-of-solidjs-ryan-carniato/)
- [How we wrote the Fastest JavaScript UI Framework, Again! (Ryan Carniato)](https://levelup.gitconnected.com/how-we-wrote-the-fastest-javascript-ui-framework-again-db097ddd99b6)
---

調査完了。以下、最終報告です。

---

# wcstack 日本市場チャネル計画（2026-08-01 実調査に基づく）

## 結論（3 行）

1. **今週やるべき一手が 1 つだけある: TSKaigi Sendai 2026 の CFP が 8/7（金）締切で現在募集中**（7/8 開始・20分/5分枠・条件は「TypeScript に関する話題」のみ・初登壇歓迎）。wcstack は TypeScript モノレポであり、「HTML 内インラインスクリプトに型を付ける言語サービス（vscode-wcs）」は製品売り込みにならない知見共有ネタとして成立する。
2. 日本語圏の言説温度は wcstack に**追い風**: 「React やめたい」ではなく **「useEffect つらい」が 2025〜2026 の現役の痛点**（企業テックブログが 2026-02 まで継続的に発信）で、ドラフトの売り文句「useEffect ではなく HTML タグで」と正確に一致する。かつ Web Components は「6 度目の元年を経てやっと日常の光景」（CARTA、2025-12）と実用期の評価。**「脱 React」を叫ぶ必要はなく、「useEffect の隣に 1 タグ」で書けばよい**。
3. 主戦場は **Zenn（トレンド入り＝一次情報×滞在時間のアルゴリズム）→ はてブ テクノロジー面（3 ブクマ/約1h で新着、10〜15 でカテゴリ人気入り）→ カンファレンス（TSKaigi 系・JSConf JP 2026 の CFP 監視）** の三段。業務系（買い手②）へは Qiita と gihyo.jp/CodeZine への寄稿持ち込みが別導線。

## 調査所見（前提の検証結果）

- **「フレームワーク疲れ」「ビルド疲れ」という語そのものの日本語バズは確認できなかった**（推測でなく検索結果ベース）。実在する痛点言説は (a) [useEffect は最終手段（UPSIDER、2026-02）](https://tech.up-sider.com/entry/20260224_React)・[useEffect の 46% が不要だった事実](https://izanami.dev/post/60697a35-66ed-4c1d-88d0-cd68fccd4217) 等の **useEffect 批判系**、(b) [jQuery レガシーからの段階的脱却系](https://zenn.dev/kiwi/articles/bb73fc7ed9fa8d)。業務 OSS プリザンターが [jQuery→vanilla+Web Components へ移行中](https://qiita.com/pmc-ko/items/bf5f1822152cef7db873)という買い手②の実在証拠もある。
- **Zenn トレンドのアルゴリズム**は非公開だが、公式 issue で「鮮度・流入元・文字数あたり滞在時間」を考慮と明言（[zenn-roadmap issue #9](https://github.com/zenn-dev/zenn-roadmap/issues/9)）。伸びる記事の共通項は「数字入りタイトル・一次情報（実体験）・図解」（[200本投稿の知見](https://zenn.dev/collabostyle/articles/858875b235cdd6)）。
- **はてブ掲載条件**（[非公式まとめ](https://u-ff.com/hatena-bookmark-requirement/)・公式発表なし）: 短時間（諸説・約1h）に 3 ブクマ→カテゴリ新着、10〜15→カテゴリ人気、20〜30→総合ホットエントリー。**セルフブックマーク 1 個は公式に許可**。互助会・相互ブクマはスパム判定。個人 OSS がはてブ tech 面経由で離陸した実例あり（[yohamta 氏・Star 2.3k の記録](https://zenn.dev/yohamta/articles/25581c19b45c5f): TypeScript Deep Dive ja が「ある日突然はてブ tech トレンド入り→定常流入化」）。
- **「日本語ドキュメント完備」訴求の先行例は Hono**。日本の商用メディアが採用理由として「日本語公式ドキュメントの充実＝言語障壁がない」を明記（[itrend の Hono 解説](https://itrend.kikkakeagent.co.jp/articles/131)）。前例があるので wcstack の README.ja 完備は買い手②向けに堂々と訴求してよい。
- **カンファレンス実勢**（2026-08-01 時点）:
  - **TSKaigi Sendai 2026**（11/1 仙台）: [CFP 7/8〜8/7・結果 8 月末](https://tskaigi.hatenablog.com/entry/tskaigi-sendai-2026-cfp)。**唯一今開いている窓**。
  - **JSConf JP 2026**: [jsconf.jp/2026 のページが存在するが中身は未公開](https://jsconf.jp/2026/)。2025 年は 11/16 開催・CFP は 6 月頃だったため、**2026 CFP は今〜9 月に開く可能性が高い（推測）— X @jsconfjp の監視を推奨**。
  - フロントエンドカンファレンス福岡 2026（9/12 九産大）: CFP は 5 月開始→**おそらく締切済（未確認）**。
  - フロントエンド・PHP カンファレンス北海道（今年は 6/6 開催済・CFP は前年 12 月〜2 月）、名古屋（5/9 開催済）→ **次窓は 2026 年 12 月〜2027 年**。
  - 採択傾向: TSKaigi の CFP 文言は「日々の経験や気づきの共有」を明示的に求めており、**プロダクト宣伝プロポーザルは土俵違い**。設計知見として出すこと。

---

## ① チャネル評価表

| チャネル | 到達力 | コスト | wcstack 適合度 | 備考 |
|---|---|---|---|---|
| **Zenn 記事** | 高（トレンド入り時。tech 読者の主流面） | 中（1 本 1〜2 日） | **高** — 個人開発「作った」文化・一次情報が伸びる設計 | 一次情報×図解×数字タイトル。製品紹介は「知見の従」で書く |
| **Qiita 記事** | 中〜高（SEO 強・業務系読者が Zenn より厚い） | 中 | 中 — 宣伝色に敏感。買い手②向け実務ハウツーに限定 | jQuery 脱却・業務画面系クエリはこちらが刺さる |
| **はてブ tech 面** | 高（定常流入化の実例あり） | 低（記事の従属変数） | 中 | セルフブクマ 1 個のみ可。狙って積む手段は互助会以外に無い＝記事品質勝負 |
| **X（旧 Twitter）** | 中（フォロワー依存・大アカウント紹介が本レバー） | 低 | 中 | [Ephe の 400 star は大アカウント紹介起点](https://zenn.dev/kirohi/articles/227345b7ed54d5)。自力ポストは着火剤に留まる |
| **TSKaigi 系登壇** | 中（現地数百人＋スライド二次拡散） | 高（準備 3〜5 日） | **高** — TypeScript 型システム知見として出せる資産（manifest 型検査・vscode-wcs）が既にある | **Sendai CFP 締切 8/7** |
| **JSConf JP 2026 登壇** | 高（国内 JS 最大格・録画/資料が永続資産） | 高 | 高 — Web 標準テーマと親和 | CFP 未公開・監視対象 |
| **地域 FE カンファ（北海道/名古屋/福岡）** | 中 | 高（遠征） | 高 | 次窓は 2026 末〜2027。90 日内は対象外 |
| **connpass LT 会** | 低〜中 | 低 | 高 — wcs-camera / tilt-maze 等**デモ映え資産**が既にある | 登壇実績づくり＋カンファ CFP の素振りとして |
| **gihyo.jp / CodeZine / Software Design 寄稿** | 中〜高（**SIer・技術選定層に届く数少ない面**） | 高（編集往復） | 高（買い手②専用導線） | [持ち込み連載の実例あり](https://fc0.vc/activity/writing/gihyojp_1.html)。Zenn 実績 2〜3 本を名刺に持ち込む |
| **Publickey** | 高（企業 IT 意思決定層） | 低（ただし掲載は先方判断） | 低〜中 | 個人 OSS 単体では載りにくい（推測）。jsfb 掲載や v2.0 級の節目がネタ化条件 |
| **Cybozu Frontend Weekly / TechFeed 等キュレーション** | 中 | ゼロ（良記事の副産物） | 中 | 狙って取れないが、拾われると Zenn 外へ波及 |

---

## ② 最初の 90 日の具体的コンテンツ計画（2026-08-01 〜 10-30）

**前提: ドラフト Tier 0（デモホスト・LP リンク・npm README）が記事より先。** 記事から LP へ流しても行き止まりなら焼畑になる。以下は Tier 0 完了を Week 2 と仮定した計画。

### Week 1（〜8/7）— 締切駆動
- **TSKaigi Sendai 2026 CFP 提出**（締切 8/7・これだけは Tier 0 より先）。
  - 案A（20分）: **「HTML の中の TypeScript に型を付ける — インラインスクリプト言語サービスを 1 人で作った話」**（vscode-wcs。TS Compiler API / LSP 知見が主役、wcstack は題材）
  - 案B（5分）: **「`static wcBindable` — カスタム要素の“バインド可能面”を型で宣言するプロトコル設計」**
  - 成功指標: 提出すること自体（不採択のデメリット無しと主催が明言）。採択なら 11/1 登壇＋スライド公開で二次拡散。
- JSConf JP 2026 の CFP 監視を開始（X @jsconfjp / jsconf.jp/2026）。

### Week 2–4 — Tier 0 完了 → 初弾
- **記事 1（Zenn）**: 「**同じ WebSocket チャットを vanilla / React / Vue / Web Components で 5 回書いて分かったこと**」
  - 既存資産 `examples/websocket-chat`（5 スタック実装済）の記事化＝ドラフト Tier 2-1 の前倒し。書くのは文章だけ。
  - 狙うクエリ: 「WebSocket 再接続 React」「WebSocket チャット 実装 比較」
  - 成功指標: Zenn いいね 50 / はてブ 10（カテゴリ人気入り）/ LP 流入計測（GoatCounter 敷設済が前提）
  - 構成: 冒頭に 5 実装の行数・再接続処理の比較表（図解）→ 各実装の一次情報 → 最後に 1 段落だけ wcstack。**タイトルに wcstack を入れない**。

### Week 5–7
- **記事 2（Zenn）**: 「**useEffect を書く前に HTML タグを 1 個足す — 既存 React アプリに Web Components を混ぜる 3 つの規則**」
  - adapter 着地（PR#117 系）＋ `docs/framework-adapter-integration.md` の 3 規則の記事化＝ Tier 2-2 の楔デモを兼ねる。
  - 狙うクエリ: 「React Web Components 連携」「useEffect 外部システム 同期」
  - 成功指標: いいね 30 / 「アダプタは全部自作」と明記した上で否定的反応が出ないこと（正直開示のテスト）
- **記事 3（Qiita・買い手②向け）**: 「**jQuery が現役の業務画面に、ビルド無しで SSE 通知を足す最短手順**」
  - 狙うクエリ: 「jQuery 共存 モダン化」「業務システム リアルタイム通知」
  - 成功指標: Qiita いいね 30 / 検索流入の継続（Qiita は SEO 持久戦面）

### Week 8–10
- **記事 4（Zenn・「作った」系）**: 「**getUserMedia と MediaRecorder の後始末が嫌すぎて、39 個の Web API を全部タグにした**」
  - 個人開発ストーリー枠。camera-record-upload のホスト済デモに直リンク（デモ映え最強の資産）。
  - 狙うクエリ: 「MediaRecorder 使い方」「getUserMedia カメラ 録画 実装」
  - 成功指標: はてブ 20+（総合ホットエントリー圏）・**外部発 issue/discussion 1 件**（ドラフト §5 の最重要指標のテスト）
- **connpass LT 1 本**（東京の JS/フロントエンド系 or オンライン LT）: tilt-maze か camera デモの実演 5 分。カンファ登壇の素振り＋録画資産。

### Week 11–13
- **記事 5（Zenn）**: 「**IntersectionObserver を宣言的に書きたいだけだった — `<wcs-intersect>` の設計と“display:none を壊さない”話**」
  - Tier 2-3 ロングテール戦略の記事版。1 タグ深掘り型のテンプレを確立し、以後 39 タグへ横展開可能に。
  - 狙うクエリ: 「IntersectionObserver 無限スクロール 実装」
- **gihyo.jp / CodeZine へ持ち込み打診**: Zenn 実績 3〜4 本を添えて「脱ビルド・Web 標準でつくる業務フロントエンド」系の短期連載企画書。成功指標: 返信獲得（掲載は 90 日外でよい）。
- JSConf JP 2026 CFP が開いていれば提出: 「**フレームワークの間に立つ小さなプロトコル — 20 フレームワーク相互運用を 1 人で検証した話**」（ドラフト §7 の正直路線をタイトルに織り込む）。

### 横断ルール
- 投稿間隔は 2〜3 週に 1 本（連投しない）。各記事の末尾に LP とホスト済デモへのリンク、GoatCounter で記事→LP 転換率を計測。
- 各記事公開直後にセルフブクマ 1 個（公式許可の範囲）＋ X ポスト 1 本。それ以上のブースト工作はしない。
- 90 日ゲート: 記事 5 本で「外部発 issue ≥1 or jsDelivr 月間ヒット 500 超」に届かなければ、記事の型（比較系/作った系/実務ハウツー系）のどれが LP 転換したかを見て 1 本に絞る。

---

## ③ やってはいけないこと（日本市場特有の地雷）

1. **相互ブクマ・互助会・複数垢ブクマ** — はてブのスパム判定基準に明記。判定されると以後この面が恒久に閉じる。セルフブクマ 1 個までが白線。
2. **「React 代替」「新フレームワーク」を名乗る記事タイトル** — ドラフト §2-1 の「勝てない土俵」が、はてブの辛口ブコメ文化では最速で顕在化する（「作者しか使ってない」「star 5」との落差を突かれる）。**「useEffect の隣に 1 タグ」の枠から出ない**。逆に「1 人で 7 ヶ月作った」の正直開示は日本の個人開発文化では好意的に働く（推測・ただし yohamta/Ephe 等の先行記事はいずれも正直開示型）。
3. **Qiita での宣伝色の強い記事・同型記事の量産** — Qiita は宣伝のみ記事への読者反発が強い。Qiita に置くのは検索持久戦用の実務ハウツーだけにし、「作った」系ストーリーは Zenn に置く。
4. **AI 量産風・絵文字過多・網羅まとめ型の模倣** — Zenn のトレンドは一次情報・滞在時間を重み付けする設計（公式 issue 明言）で、この型は乗りにくい上に、乗っても信用を削る。
5. **カンファレンス CFP に製品プロポーザルを出す** — 採択されるのは経験・知見の共有（TSKaigi の CFP 文言が明示）。プロダクト名はタイトルから外し、問題と設計判断を主役にする。採択後のスライドで名乗れば十分。
6. **アダプタ 20 個を「エコシステム」として日本語記事でも提示する** — ドラフト §7 の HN 向け注意は、はてブ・Zenn コメント欄でも同様に成立する。「20 FW 分の公式アダプタを自分で書いて検証した」と書く方が記事としても強い。
7. **Tier 0（動くデモ・LP 導線）完了前に記事を撃つ** — Zenn トレンドは一発勝負性が高く、行き止まり LP に流すのは弾の浪費。ドラフト Tier 3 の順序厳守はの Zenn 初弾にもそのまま適用する（唯一の例外は締切のある TSKaigi CFP）。
8. **投稿タイミングの最適化に凝る** — 曜日・時刻の効果に検証可能な根拠は見つからなかった（諸説のみ）。変数を増やすより記事品質と間隔管理に時間を使う。

## 主要出典

- [TSKaigi Sendai 2026 CFP（公式ブログ）](https://tskaigi.hatenablog.com/entry/tskaigi-sendai-2026-cfp) / [TSKaigi 2026 公式](https://2026.tskaigi.org/)
- [JSConf JP 2026（プレースホルダ確認）](https://jsconf.jp/2026/) / [JSConf JP 2025](https://jsconf.jp/2025/)
- [フロントエンド・PHP カンファレンス北海道 2026（fortee）](https://fortee.jp/frontend-phpcon-do-2026) / [同 CFP 延長告知](https://note.com/kotomi1338/n/n5172fc29912e) / [FEC 名古屋 2026](https://fortee.jp/fec-nagoya-2026) / [FEC 福岡 2026 開催告知](https://note.com/sakupi01/n/n4e997b62c825)
- [Zenn トレンド算出の調整（公式 issue #9）](https://github.com/zenn-dev/zenn-roadmap/issues/9) / [トレンド入りする記事を書く技術（200 本の知見）](https://zenn.dev/collabostyle/articles/858875b235cdd6)
- [はてブ新着/人気エントリーの条件（非公式検証）](https://u-ff.com/hatena-bookmark-requirement/)
- [個人開発 OSS で Star 2.3k までの記録（yohamta）](https://zenn.dev/yohamta/articles/25581c19b45c5f) / [弱小 OSS が Star を集める方法](https://zenn.dev/kirohi/articles/227345b7ed54d5)
- [2025 年は Web Components 元年だった？？（CARTA）](https://techblog.cartaholdings.co.jp/entry/2025/12/03/163425)
- [useEffect は最終手段（UPSIDER）](https://tech.up-sider.com/entry/20260224_React) / [useEffect の 46% が不要だった事実（izanami）](https://izanami.dev/post/60697a35-66ed-4c1d-88d0-cd68fccd4217) / [useEffect を減らす実践（Zenn）](https://zenn.dev/shigerufukada/articles/2b72426151cfc6)
- [jQuery レガシー脱却ポエム（Zenn）](https://zenn.dev/kiwi/articles/bb73fc7ed9fa8d) / [プリザンターの jQuery→Web Components 移行調査（Qiita）](https://qiita.com/pmc-ko/items/bf5f1822152cef7db873)
- [Hono 採用理由に日本語ドキュメント（itrend）](https://itrend.kikkakeagent.co.jp/articles/131) / [Hono 日本語版ドキュメントの話（Zenn）](https://zenn.dev/akku/articles/hono-ja-writing) / [Hono 作者インタビュー（KAKEHASHI）](https://kakehashi-dev.hatenablog.com/entry/2026/04/02/111000)
- [gihyo.jp 持ち込み連載の実例（fc0）](https://fc0.vc/activity/writing/gihyojp_1.html) / [CodeZine](https://codezine.jp/)
---

以下、リポジトリ実物（ルート README.md / README.ja.md / packages/state/README.md / packages/fetch/README.md / packages/websocket/README.md / 全 package.json description / docs/go-to-market-2026-08.md）を確認した上での売り文句一式。コード例は全て既存 README に実在する構文のみ使用（`url: usersUrl` のゲッター経由・`users.*.name` 等。リテラル URL を data-wcs に直書きする構文は存在しないため使っていない）。

---

# 1. LP サブコピー（H1「What if the browser had these built in?」直下）

**推奨案（ja）**
> WebSocket・カメラ・SSE・位置情報 — Web API の配線を、グルーコードではなく HTML タグ 1 個で。
> ビルド不要・ランタイム依存ゼロ。いま動いている React / Vue アプリにも、タグ 1 個から足せます。

**推奨案（en）**
> WebSocket, camera, SSE, geolocation — wire Web APIs with an HTML tag instead of glue code.
> No build step, zero runtime dependencies. Start with a single tag inside the app you already have.

**変種（React 層に寄せる場合・ドラフト§2-3 準拠）**
- ja: 「WebSocket・カメラ・SSE・位置情報を、`useEffect` ではなく HTML タグで。」
- en: "WebSocket, camera, SSE, geolocation — as HTML tags, not `useEffect`."

改善点: ドラフト案の「useEffect ではなく」は React 開発者にしか刺さらない（買い手②の jQuery/バニラ層には無意味）ため、LP 本体は「グルーコード」に広げ、useEffect 版は React 文脈の広告文（Zenn/HN/アダプタページ）用に温存。「1 タグから」は可逆性（=導入リスクの低さ)の含意なので両案とも維持。

---

# 2. ルート README 冒頭の最初の1スクリーン

（`npm view` で生読みされる前提: H1 直後に価値1文→即コードブロック。現在最上部にある AI エージェント向け IMPORTANT ブロックは1行リンクに縮めて畳む提案 — 現状は初見の人間/AI 双方にとってコードより先に注意書きが来ている）

**en（README.md）**

```markdown
# wcstack

**What if the browser had these built in?**

Fetch, WebSocket, SSE, camera, geolocation, IntersectionObserver — wcstack turns 30+ Web APIs
into zero-dependency custom elements. The tag owns the imperative lifecycle (abort, reconnect,
cleanup); your page stays declarative markup. No build step — one CDN script per tag.

    <script type="module" src="https://esm.run/@wcstack/state/auto"></script>
    <script type="module" src="https://esm.run/@wcstack/fetch/auto"></script>

    <wcs-state>
      <script type="module">
        export default {
          users: [],
          loading: false,
          get usersUrl() { return "/api/users"; },
        };
      </script>
    </wcs-state>

    <!-- URL changes re-fetch automatically; in-flight requests are aborted -->
    <wcs-fetch data-wcs="url: usersUrl; value: users; loading: loading"></wcs-fetch>

    <template data-wcs="if: loading"><p>Loading...</p></template>
    <ul>
      <template data-wcs="for: users">
        <li data-wcs="textContent: users.*.name"></li>
      </template>
    </ul>

No `fetch()`, no `async/await`, no loading/error glue in your JavaScript. The tag does the I/O;
the results land in bindable state.

- **30+ I/O tags** — `<wcs-fetch>` `<wcs-ws>` `<wcs-sse>` `<wcs-camera>` `<wcs-geo>` `<wcs-intersect>` … [full list](#packages)
- **Standards only** — plain custom elements, zero runtime dependencies, no bundler
- **Works inside React / Vue / Svelte / Solid** — every tag speaks [wc-bindable-protocol](https://github.com/wc-bindable-protocol/wc-bindable-protocol); thin adapters (written by the wcstack author — not a third-party ecosystem) wire outputs into framework state. [The 3 rules](./framework-adapter-integration.md)
- **Opt-in upper layers** — like the binding style? [`@wcstack/state`](../packages/state/), [`@wcstack/router`](../packages/router/) and [`@wcstack/signals`](../packages/signals/) scale it to a whole app

🌐 [Live demos](https://wcstack.github.io) · 📦 [npm](https://www.npmjs.com/org/wcstack) · 🤖 AI agents: start at [AGENTS.md](../AGENTS.md)
```

**ja（README.ja.md）**

```markdown
# wcstack

**もしブラウザにこれが最初からあったら？**

fetch・WebSocket・SSE・カメラ・位置情報・IntersectionObserver — wcstack は 30 以上の Web API を
依存ゼロのカスタム要素にします。abort・再接続・後始末といった命令的なライフサイクルはタグが持ち、
ページは宣言的なマークアップのまま。ビルド不要、タグごとに CDN の script 1 行です。

    （コードブロックは en 版と同一）

JavaScript 側に `fetch()` も `async/await` も loading/error の配線コードも書きません。
I/O はタグがやり、結果はバインド可能な状態として届きます。

- **30+ の I/O タグ** — `<wcs-fetch>` `<wcs-ws>` `<wcs-sse>` `<wcs-camera>` `<wcs-geo>` `<wcs-intersect>` …（[一覧](#パッケージ)）
- **Web 標準だけ** — 素のカスタム要素・ランタイム依存ゼロ・バンドラー不要
- **React / Vue / Svelte / Solid の中でも** — 全タグが wc-bindable-protocol を実装。薄いアダプタ（wcstack 作者の自作です — 第三者エコシステムではありません）で FW の状態に配線できます。[3 つのルール](./framework-adapter-integration.md)
- **上位レイヤーは opt-in** — 気に入ったら `@wcstack/state`（data-wcs バインディング）・`@wcstack/router`・`@wcstack/signals` でアプリ全体へ

🌐 [ライブデモ](https://wcstack.github.io) · 📦 npm · 🤖 AI エージェントはまず [AGENTS.md](../AGENTS.md)
```

設計判断: (1) 最初のコードは `<wcs-fetch>`（全買い手が痛みを知る API・サーバ不要で読める・fetch README の Quick Start と同一構文で嘘がない）。(2) 「What if…」H1 と Five Rules・Core Insight は削除せず 2 スクリーン目以降に温存（思想は購入理由でないが差別化資産）。(3) アダプタ自作の開示を bullet 内に恒常組み込み — HN で突かれる前に常設で言う。

---

# 3. npm description（ルート `wcstack` パッケージ・214 字制限）

**en（211 字・実測）**
```
Web API wiring as HTML tags: fetch, WebSocket, SSE, camera and 30+ more as zero-dependency custom elements. No build step - one CDN script tag. Use standalone or inside React/Vue. Guide: npm view wcstack readme.
```

**ja 参考版（151 字・npm は通常 en のみだが指示により併記）**
```
Web API の配線を HTML タグで: fetch・WebSocket・SSE・カメラなど30以上を依存ゼロのカスタム要素に。ビルド不要、CDN の script タグ1行。単体でも、既存の React/Vue アプリの中に1タグからでも。ガイド: npm view wcstack readme
```

検索キーワード設計: "Web API" / "HTML tags" / "custom elements" / "fetch" / "WebSocket" / "zero-dependency" / "no build" / "React" / "Vue" を先頭 120 字に集中。現行 description の `npm view wcstack readme` 誘導（AI 到達実測で唯一の生テキスト面）は末尾に維持した。個別パッケージの現行パターン（"Declarative X component for Web Components. Framework-agnostic … via wc-bindable-protocol."）は既に配線層準拠で書き換え不要と判断。

---

# 4. エレベーターピッチ 30 秒版

**(a) React 開発者向け**

ja: 「WebSocket を開いて、再接続を管理して、unmount で片付ける useEffect — コピペで増殖して誰も触りたくないやつです。あれをカスタム要素にしました。`<wcs-ws>` を置くと接続・再接続・後始末はタグが持ち、メッセージと接続状態がプロパティで出てきます。React アダプタは私の自作で、第三者エコシステムではありません。ただし中身は素のカスタム要素なので、気に入らなければタグを 1 個消すだけで元に戻ります。ビルド設定は一切変わりません。」

en: "You know that useEffect that opens a WebSocket, manages reconnects, and cleans up on unmount — the one everyone copy-pastes and nobody wants to touch? I turned it into a custom element. Drop in `<wcs-ws>`: the tag owns connection, reconnection, and cleanup, and messages come out as properties. The React adapter is mine — it's not a third-party ecosystem. But underneath it's a plain custom element, so backing out means deleting one tag. Your build config never changes."

**(b) jQuery / バニラの業務系開発者向け**

ja: 「いまサーバが返している HTML に、script タグを 1 行足すだけです。npm もビルド環境も要りません。fetch や WebSocket、カメラが HTML タグになって、通信中フラグやエラーは属性で画面につながります。jQuery と同居できますし、既存画面は 1 ミリも書き換えません。ドキュメントは全パッケージ日本語版があります。まず一番面倒な非同期処理を 1 箇所、タグに置き換えるところから試せます。」

en: "Add one script tag to the HTML your server already returns. No npm, no build pipeline. Fetch, WebSocket, and camera become HTML tags, with loading flags and errors wired to the page through attributes. It coexists with jQuery and you don't rewrite a single existing screen. Every package has full Japanese and English docs. Start by replacing your single most painful piece of async code with one tag."

**(c) 技術選定するテックリード向け**

ja: 「フレームワークの置き換え提案ではありません。Web API の配線層です。導入単位はタグ 1 個、撤退もタグ 1 個の削除で、データ層との契約は標準のプロパティとイベントだけなのでロックインが構造的に薄い。リスクは先に言います: 作者は私 1 人、外部ユーザーはまだほぼいません。代わりに全 41 パッケージにテスト 5,000 件超と日英ドキュメント、設計文書があり、中身は標準の Custom Elements なので最悪でも読んで捨てられます。評価コストはデモを 30 秒触るだけです。」

en: "This is not a framework replacement proposal — it's a wiring layer for Web APIs. The adoption unit is one tag; so is the exit. The contract with your data layer is standard properties and events, so lock-in is structurally thin. Risks up front: I'm a solo author and there are almost no external users yet. In exchange: 5,000+ tests across 41 packages, full EN/JA docs, design documents — and since it's standard Custom Elements underneath, worst case you can read it and throw it away. Evaluation cost is 30 seconds with a live demo."

---

# 5. Zenn 記事タイトル案 5 本

1. **「useEffect の WebSocket 再接続、HTML タグ 1 個に置き換えてみた」**（en: I replaced my useEffect WebSocket reconnection logic with a single HTML tag）— 買い手①の楔。
2. **「同じ WebSocket チャットを 5 通り（vanilla / React / Vue / あと 2 つ）で書いて比べた」**（en: I built the same WebSocket chat five ways and compared them）— Tier 2-1。examples/websocket-chat が既にあり書くのは文章だけ。
3. **「jQuery のままでいい業務画面に、リアクティブな部品をタグ 1 個だけ足す方法」**（en: Adding one reactive tag to a legacy jQuery screen — without touching the rest）— 買い手②直撃。
4. **「ビルド不要で fetch・カメラ・WebSocket を HTML タグにする配線層を、1 人で 7 ヶ月作っている」**(en: I've spent 7 months solo building a buildless wiring layer that turns Web APIs into HTML tags) — ソロ開発物語型。Zenn で最もクリックされる型だが誇張ゼロで書ける。
5. **「39 個の Web API をぜんぶカスタム要素にしてわかった、宣言的にできる境界・できない境界」**（en: What wrapping 39 Web APIs as custom elements taught me about the limits of declarative）— MediaStream 生ハンドル問題・permission 二相など実設計知見があり技術層に強い。

---

# 6. Show HN

**タイトル（72 字・80 字制限内）**
```
Show HN: Wcstack - fetch, WebSocket, camera as zero-dependency HTML tags
```

**本文（en）**

```
For about the past year and a half I've been building wcstack: custom elements that wrap
Web APIs - fetch, WebSocket, SSE, camera/MediaRecorder, geolocation, IntersectionObserver,
clipboard, sensors, and about 30 more - as declarative HTML tags.

    <wcs-fetch data-wcs="url: usersUrl; value: users; loading: loading"></wcs-fetch>

The element owns the imperative lifecycle (abort on URL change, reconnection, cleanup on
disconnect) and exposes results as bindable properties, so the page reads as markup instead
of effect/cleanup glue.

Self-imposed constraints, which are most of the fun: one CDN script per package, no build
step, zero runtime dependencies, everything is a standard custom element, and expressions
live only where HTML already allows extension (data-* attributes and text nodes).

How the pieces interoperate: each tag declares its surface through a small protocol
(static wcBindable: properties / events / commands). An optional reactive layer binds to
that, and so do per-framework adapters (React, Vue, Svelte, Solid, and others). Full
disclosure: I wrote those adapters myself - they are thin, but they are not a third-party
ecosystem, so weigh them accordingly.

Honest status: I'm one person, and this has essentially no users yet (single-digit GitHub
stars). What it does have: 5,000+ tests, EN/JA docs for every package, and live demos that
run straight from a CDN with nothing to install: https://wcstack.github.io

Comparisons, offered up front: the closest prior art is Polymer-era iron-ajax/platinum
elements (long discontinued). htmx shares the "HTML as the interface" idea but targets
server round-trips; these tags wrap browser APIs client-side. If you're starting a large
SPA, use React/Vue - this is deliberately a wiring layer you adopt (and remove) one tag at
a time. Numbers for the optional reactive layers are in js-framework-benchmark.

I'd especially appreciate feedback on the binding protocol (how tags declare
properties/events/commands) and on whether tag-per-API is the right granularity.
```

**本文（ja 参考訳・要旨）**: 「約 1 年半、Web API をカスタム要素として包む wcstack を作ってきた。タグが命令的ライフサイクル（abort・再接続・後始末）を持ち、結果はバインド可能なプロパティで出る。縛りは CDN 1 行・ビルド不要・依存ゼロ・全部標準カスタム要素。相互運用は wcBindable プロトコル経由で、FW アダプタは全部自作（第三者エコシステムではない）。正直な現状: 作者 1 人・ユーザーほぼゼロ（star 1 桁）。ある物: テスト 5,000+・日英ドキュメント・インストール不要のライブデモ。比較: 最近縁は Polymer 時代の iron-ajax（終了済み）、htmx は思想が近いがサーバ往復向きでこちらはブラウザ API のクライアント側配線。大規模 SPA 新規なら React/Vue をどうぞ — これはタグ 1 個ずつ入れて 1 個ずつ抜ける配線層。プロトコル設計と「1 API = 1 タグ」の粒度への意見が欲しい。」

注: 本文は戦略 Tier 3 の前提（jsfb 公式提出済み・LP にデモ稼働済み）で書いた。**未提出のまま投稿するなら "Numbers … js-framework-benchmark" の 1 文を削除すること**（リンク先が無い主張は HN で即死する）。

---

# 7. 誇張リスク自己申告（敵対的レビュー）

| 表現 | リスク | 処置 |
|---|---|---|
| 「30+ / 39 / 41」の数字群 | ルート README は "Forty-one runtime packages"、CLAUDE.md の I/O ノード列挙は 35、共通コンテキストは 39。**出荷前に必ず再カウントして 1 つの数字体系（推奨: 41 packages / 30+ Web APIs の控えめ側）に統一**。数字の不一致は HN で最初に見つかる類の傷 | 全コピーで「30+」の控えめ表記に統一済み |
| 「zero dependencies」 | README 自身が「except happy-dom for SSR」と但し書き済み。無条件の「依存ゼロ」は虚偽になり得る | 全コピーで「zero **runtime** dependencies」表記。SSR 文脈では但し書き必須 |
| 「Works inside React / Vue」 | アダプタは全て作者自作・org star 1・CDN ヒット 0。無注記なら第三者検証と誤認される（戦略§7 の指摘通り） | README bullet・HN 本文・ピッチ(a) すべてに自作開示を**恒常内蔵**した。削らないこと |
| 「1 タグから既存アプリに」 | 技術的成立は PR#117 でつい先日。**実演デモ（Tier 2-2）が無い間は「できます」でなく「できるようになった」までに留める**のが安全。HN 投稿時点ではデモ必須 | ピッチでは「backing out = タグ 1 個削除」という可逆性の方に重心を置いた |
| 「グルーコードを書かない / No glue code」 | 状態定義（getter 等）は書く。「一切書かない」は反例を挙げられる | 「loading/error の配線コードを書かない」「UI 層に書かない」と対象を限定 |
| 「直接競合が存在しない」（ドラフト§2-2） | 内部戦略文書用の言葉。対外では悪魔の証明を要求される | 全コピーで不使用。代わりに HN 流儀どおり近縁（Polymer iron / htmx）を自分から提示 |
| 「テスト 5,250 件」 | 件数は変動する。固定数の明記は将来ずれる | コピーでは「5,000+」表記に丸めた |
| Zenn 案 4 の「7 ヶ月」 | 公開履歴と突合可能な数字。投稿時点の実期間に更新すること | 投稿時に要更新 |
| HN 本文の jsfb 言及 | 公式提出前に書くと虚偽 | 条件付き削除の注記を本文直下に明記済み |

**参照した実ファイル**: `c:\Users\kikuzawa\Documents\git\wcstack\wcstack\docs\go-to-market-2026-08.md` / `README.md` / `README.ja.md` / `packages\state\README.md` / `packages\fetch\README.md` / `packages\websocket\README.md` / `packages\wcstack\package.json`（現行 npm description）
---

# 楔デモ設計「既存 React アプリに wcstack タグを1個」

**結論: 最初の1タグは `<wcs-ws>`（websocket）。** 理由は「useEffect 自前実装の痛みが最大 × デモ映え最大 × 権限プロンプト不要」の交点にあり、かつ `examples/websocket-chat/react/`（App.tsx・README・dist ビルド済み）が既に存在し**新規開発ほぼゼロで転用できる**ため。唯一の弱点（サーバ必須）は動線設計で吸収する。ゼロインフラ代替第1候補は `<wcs-intersect>`。

---

## 1. 採点表と Top3 選定

採点軸: **A**=useEffect 自前実装の痛み（行数・エッジケース・クリーンアップ漏れ）／**B**=デモ映え／**C**=権限プロンプト不要で即動く（サーバ不要含む）。各5点。

| タグ | A 痛み | B 映え | C 即動く | 計 | 備考 |
|---|---|---|---|---|---|
| **`<wcs-ws>`** | **5**（堅牢版 ~55行・エッジ7クラス、下記） | **5**（リアルタイム・自動再接続の実演） | **3**（権限は不要だがサーバ必須） | **13** | ★第1候補。既存 react example 転用可 |
| **`<wcs-intersect>`** | **3**（~40行。options オブジェクトの identity 罠で effect が再接続ループする既知の footgun） | **4**（スクロールで lazy-load が目に見える） | **5**（完全静的・権限なし） | **12** | ★ゼロインフラ第1候補・LP 埋め込み向き |
| **`<wcs-broadcast>`** | **2**（BroadcastChannel 自体は簡単。close 漏れ・StrictMode 程度） | **5**（「このリンクを2タブで開け」→タブ間同期の魔法） | **5**（サーバ・権限とも不要） | **12** | ★第3。痛み訴求は弱いが 30 秒体験は最強 |
| `<wcs-camera>` | 5（track.stop() 漏れ=LED 点きっぱなしが物理観測される） | 5 | 1（権限プロンプト） | 11 | **初手失格だが「2クリック目」デモの本命**（GTM 0-2 と整合） |
| `<wcs-fetch>` | 4 | 2 | 5 | 11 | **土俵が悪い**: React Query/SWR が支配する領域で「自前 useEffect との比較」が成立しない |
| `<wcs-storage>` | 3（storage イベントの同一タブ非発火など） | 3 | 5 | 11 | broadcast と役割重複 |
| `<wcs-geo>` | 4 | 3 | 1（権限） | 8 | |
| `<wcs-sse>` | 3（EventSource は再接続半自動で痛みが ws より軽い） | 3 | 2 | 8 | |
| `<wcs-resize>` / `<wcs-timer>` | 2 / 1 | 2 / 3 | 5 / 5 | 9 | 痛みが無いものは楔にならない |

**Top3 = ws / intersect / broadcast。** 3本の役割: **ws が記事の主役**（痛み訴求）、**intersect が LP 埋め込みの 30 秒体験**（インフラゼロ）、**broadcast が「2タブで開け」の追い実演**（口コミ向き）。

**ws を第1とする決定的理由**: (1) Before の痛みが「再接続」という**誰もが一度は書いて漏らした経験のあるコード**であること。(2) react example の README が既に「no await, no Promise, no Suspense」という強いフックを持つ。(3) 自動再接続は**「あなたが書いた行数: 0」を実演できる**唯一の題材（DevTools でオフライン→復帰）。ただし後述の relay 運用を許容しない判断なら、第1タグは `<wcs-intersect>` に差し替え（設計は同型・完全静的）。

---

## 2. Before / After 実コード

### Before — 素の React + WebSocket（自動再接続つき最低限堅牢版・約55行）

```tsx
// useChatSocket.ts — これが「1タグ」が置き換える対象
import { useState, useEffect, useRef, useCallback } from "react";

const RECONNECT_INTERVAL = 3000;
const MAX_RECONNECTS = 10;

export function useChatSocket(url: string) {
  const [message, setMessage] = useState<unknown>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Event | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const closedByUsRef = useRef(false);

  useEffect(() => {
    closedByUsRef.current = false;
    retriesRef.current = 0;

    const connect = () => {
      setLoading(true);
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        retriesRef.current = 0;            // (6) 成功時のリトライ計数リセット
        setConnected(true); setLoading(false);
      };
      ws.onmessage = (e) => {
        let data: unknown = e.data;
        try { data = JSON.parse(e.data); } catch { /* (5) 非JSONはそのまま */ }
        setMessage(data);
      };
      ws.onerror = (e) => setError(e);
      ws.onclose = () => {
        setConnected(false); setLoading(false);
        if (closedByUsRef.current) return;  // (2) 意図的closeで再接続ループしない
        if (retriesRef.current >= MAX_RECONNECTS) return;
        retriesRef.current += 1;
        timerRef.current = window.setTimeout(connect, RECONNECT_INTERVAL);
      };
    };
    connect();

    return () => {
      closedByUsRef.current = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current); // (1) タイマー漏れ
      wsRef.current?.close();               // (3) StrictMode 二重マウントの後始末
    };
  }, [url]);                                // (7) url変更時の張り替え

  const send = useCallback((data: unknown) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return; // (4) CONNECTING中sendはthrow
    ws.send(typeof data === "string" ? data : JSON.stringify(data));
  }, []);

  return { message, connected, loading, error, send };
}
```

### After — `<wcs-ws>` + `@wc-bindable/react`（アプリコード約15行）

```tsx
// main.tsx — 規則1: 静的 import で render 前に定義を済ませる
import "@wcstack/websocket/auto";
```

```tsx
// Chat.tsx
import { useWcBindable } from "@wc-bindable/react";
import type { WcsWebSocket, WcsWsValues } from "@wcstack/websocket";

function Chat() {
  const [wsRef, ws] = useWcBindable<WcsWebSocket, WcsWsValues>({
    message: null, connected: false, loading: false, error: null,
  });

  return (
    <>
      <wcs-ws ref={wsRef} url={WS_URL}
        auto-reconnect="" reconnect-interval="3000" max-reconnects="10" />
      <p>{ws.loading ? "Connecting…" : ws.connected ? "Connected" : "Disconnected"}</p>
      <pre>{JSON.stringify(ws.message)}</pre>
    </>
  );
}
```

（送信は `examples/websocket-chat/react/src/App.tsx` と同じく要素 ref への `el.send = ...` 代入。実物 220 行の App.tsx がそのまま完成版デモになる。）

### 消えるエッジケース（Before のコメント番号と対応・記事の中核表）

| # | Before で自前管理 | 漏らすと起きること |
|---|---|---|
| 1 | 再接続タイマーの clearTimeout | アンマウント後に再接続→unmounted setState 警告・ソケット漏れ |
| 2 | 「自分が閉じた」フラグ | クリーンアップの close が onclose を呼び**無限再接続ループ** |
| 3 | StrictMode 二重マウント | 開発中だけ二重接続・接続フラップ |
| 4 | readyState ガード | CONNECTING 中の send が `InvalidStateError` で throw |
| 5 | JSON parse + 非 JSON fallback | 生文字列/парス失敗で UI が壊れる |
| 6 | リトライ計数のリセット | 成功後の切断で残回数が枯れている |
| 7 | url 変更時の張り替え | 古い接続が残る・二重受信 |

**約55行 → 約15行。上の7クラスは要素の中に消える。** さらに構造的な利点として、React の StrictMode は effect を二重実行するが **DOM ノードは再マウントしない**ため、接続の所有者が effect ではなく DOM 要素である `<wcs-ws>` は StrictMode の影響を受けない（adapter の bind/unbind が二重に走るだけで冪等）。これは記事の「なぜ効くのか」の核になる論点（デモで要実証確認の上で書く）。

---

## 3. デモ形態と 30 秒動線

**形態: StackBlitz（GitHub 直接インポート）を主、LP 静的ホストを従。**

- StackBlitz は `stackblitz.com/github/wcstack/wcstack/tree/main/examples/websocket-chat/react` 形式でリポジトリのサブディレクトリを直接開ける → **デモの正本 = リポジトリ**になり別途メンテ不要。買い手は package.json・main.tsx の 1 行 import・App.tsx を**編集可能な実物**として見る。「既存 React アプリに足す」というメッセージには、コードが見える形態が必須（静的ホストだけでは「足し方」が伝わらない）。
- CodeSandbox はミラーとして任意（優先度低）。
- **サーバ問題の解決（順位つき・いずれも要実測検証）**: ①デモ用 wss エンドポイントを無料枠（Deno Deploy / Cloudflare Workers 等）に常設 — echo+broadcast 対応で現デモ無改変に最も近い。②公的 echo（`wss://ws.postman-echo.com/raw` 等）に URL を向ける — 運用ゼロだが第三者依存・broadcast 不可。③StackBlitz WebContainer 内で `shared/server.js` を起動 — 成立すれば完全自己完結だが WebContainer の WS サーバ対応は**未検証（推測）**。①を推奨。デモが死ぬこと自体が「buildless を謳って動くものが無い」矛盾の再演になるため、②を①のフォールバック URL としてコードに両方書いておく。

**30 秒動線:**

```
0秒   記事/LP の「Open in StackBlitz」をクリック
~10秒 起動・自動接続 → ステータスドットが緑「Connected」（この時点で価値提示済み）
15秒  メッセージ送信 → echo が返る
20秒  画面内バナー「DevTools の Network を Offline に → 戻すと自動再接続します。
      あなたが書く再接続コード: 0 行」
30秒  エディタペインに App.tsx の <wcs-ws> 15 行が開いた状態（initialPath 指定）
2クリック目: 「同じやり方でカメラも」→ camera-record-upload デモ（権限プロンプトはここで初めて）
```

ゼロインフラ版（intersect）は wcstack.github.io に静的ページ 1 枚: スクロールすると画像が lazy-load され、右パネルに Before(40行)/After(数行) を並置。LP `#examples` の行き止まり修理（GTM 0-2）と兼用できる。

---

## 4. 記事構成と 5 スタック比較記事との役割分担

**タイトル案**: 「React の WebSocket 再接続処理、実は HTML タグ 1 個で消せる」／英訳時 “Delete your useEffect WebSocket code: one Web Component tag”

構成（Zenn 想定・GTM Tier 2-2）:
1. **導入**: Before の 55 行を先に全文貼る。「これ、どこかで書いたことありませんか。そして #2 のフラグ、漏らしたことありませんか」
2. **After**: import 1 行 + タグ 1 個 + 15 行。行数と「消えた7クラス」の表
3. **なぜ効くか**: 接続の所有者を effect から DOM 要素へ移す、という一段抽象の説明（StrictMode 論点含む）。フレームワーク置換ではなく**タグ 1 個の追加**であること、Vue/Svelte/Angular でも同じタグであることを 1 段落
4. **正直な制約**（§5 の内容。隠さず本文に置く）
5. **使わない方がいい場合**: React 専用でよければ react-use-websocket 等の成熟したフックがある。これは「同じタグを複数 FW・素の HTML・CDN 1 行で使い回したい」「依存を増やしたくない」人向け — 競合を隠すと HN/ブコメで先に指摘されて信用を失う
6. **試す**: StackBlitz リンク（30 秒動線）
7. **次**: 5 スタック比較記事・camera デモへのリンク

**役割分担**: 楔記事は**縦**（1 つの FW で Before/After を深く・買い手①「本人決裁の個人開発者」を変換する）。5 スタック比較記事（websocket-chat 流用・GTM 2-1)は**横**（同一タグが 5 環境で動く移植性の証明・比較検討者と検索流入を受ける）。楔記事の「本当に他でも動くのか?」という疑いに 5 スタック記事が答え、5 スタック記事の「で、自分のアプリにはどう入れるのか?」に楔記事が答える相互リンク構造。公開順は楔→5スタック（変換導線を先に敷く）。

---

## 5. 正直性の担保（開示の場所と文面）

| 開示事項 | 場所 | 文面の方針 |
|---|---|---|
| **アダプタは全て作者の自作**（org star 1・第三者検証なし） | 記事本文§4 と デモ README の両方。**脚注にしない** | 「@wc-bindable の 20 アダプタは wcstack 作者が自分で書いたもので、第三者の検証を受けていません。React 用のコアは小さく、読んでから使えます（リンク）」— GTM §7 の通り、正直に言えばそれ自体が強い |
| **制約 6 クラスのうち React に効く 3 つ** | 記事本文§4 に要約表 + `docs/framework-adapter-integration.md`（3 規則の正本）へリンク。6 クラス全列挙は正本側に任せ本文では膨らませない | (A) 遅延 upgrade で bind が沈黙 → 規則1「静的 import」をコードに焼き込み済みと明示 ／ (B) accessor シャドウイングは v1.24 で修正済みと**修正事実ごと**開示 ／ (F) コロン付きイベント名は JSX で直接書けない → `addEventListener` 経路（正本 §4） |
| **event semantics の同値 dedupe**（正本 §5: adapter は `semantics` 未解釈） | デモ README の「既知の注意」 | 同一 payload 連続の `message` は値 store で落ちうる。チャットデモはタイムスタンプ付与で回避している旨を明記 |
| **デモ用 wss は当方運営 / 第三者 echo** | StackBlitz 内バナー | 「デモ用エンドポイントです。可用性保証なし。ローカル実行は README 参照」 |
| **競合の存在** | 記事§5「使わない方がいい場合」 | react-use-websocket / react-intersection-observer を名指しで挙げる |

関連ファイル（絶対パス）:
- 正本 3 規則: `c:\Users\kikuzawa\Documents\git\wcstack\wcstack\docs\framework-adapter-integration.md`
- 転用元デモ: `c:\Users\kikuzawa\Documents\git\wcstack\wcstack\examples\websocket-chat\react\src\App.tsx`（`main.tsx` の静的 import が規則1の実演になっている）
- GTM 戦略: `c:\Users\kikuzawa\Documents\git\wcstack\wcstack\docs\go-to-market-2026-08.md`（本設計は Tier 2-2 の具体化。前提として Tier 0-1 リリース発車が必要 — StackBlitz は npm 上の v1.24 系 adapter 対応版を引くため）

**要検証 2 点（推測を含む箇所）**: ①StackBlitz WebContainer 内 WS サーバの成立可否、②公的 echo エンドポイントの現行可用性。いずれも動線 §3 の選択肢①（自前 relay 常設）なら回避できる。
---

# AI 採用チャネル設計 — 分析結果

## 結論（TL;DR）

1. **ドラフトの「AI = 買い手3位・長期」は概念の混同があり、分割が必要。**「AI が自律的にフレームワークを*選ぶ*」経路は確かに長期（3位維持で妥当）。しかし「買い手①②が AI に*書かせる*」経路は 2026 年時点で新規コードの 26.9〜46% を占める現在形の実勢であり、これは買い手セグメントではなく**買い手①②の到達・実装成功率ゲート**。9ラン実測の 4/9 失敗は「長期の賭けの不発」ではなく「今日の買い手①を漏斗の入口で 44% 取りこぼしている」と読むべき。
2. **AI に届く面は「帯域 × 到達契機」で二層に割れる。**発見フェーズ（検索スニペット・npm README 生読み）と実行フェーズ（skill / AGENTS.md / エラーメッセージ）は別の機構で、相互に代替不能。llms.txt は実測・業界データ双方で死に面（500M ボット訪問中 llms.txt 直接取得 408 件、主要 AI 企業のコミットゼロ）。
3. **lint 0/9 の壁を破る設計は 2 つ実在する**: (a) スキル内の指示化（受動的文書と能動的指示は別機構 — ただし未実測、次回プローブで検証）、(b) **エラーメッセージ内誘導**（コンソール出力は Bash 同様の全帯域面で、AI がエラー時に必ず読む唯一のインストール不要チャネル）。自前 MCP サーバーは費用対効果で見送り、**Context7 登録**（MCP 視聴数 #1 のドキュメントサーバー）で代替。
4. wcstack の構造的優位は「文脈内学習経路」に集中している（閉じた DSL・1ファイル完結・manifest 検証可能）。学習データ収載は施策ではなく結果であり、レバーは検索到達（実測済みボトルネック）と文脈内品質の 2 本のみ。

---

## 検討 5（先に扱う — 全体を再枠組みするため）: 格付け再評価

2026 年の実勢（出典は末尾）:

| ソース | 数値 | 定義 |
|---|---|---|
| Sonar 調査 (2026-01) | コミットされたコードの **42%** が AI | committed code |
| GitHub | プラットフォーム上のコードの **46%** を AI アシスタントが生成、Gartner は 2026 年末 60% を予測 | AI-assisted 含む広義 |
| 実測系（420万開発者、2025-11〜2026-02） | 本番コードの **26.9%** が AI 著 | AI-authored 狭義 |
| Google 社内 (2026-04) | 新規コードの 75%（エンジニア承認込み） | 社内・広義 |

定義揺れ（AI-generated vs AI-assisted の混同）を割り引いても、**狭義で 1/4、広義で半分**が AI 経由。ここから導かれる再評価:

- **「AI が自律的に FW を選定する」買い手**: 2026 年時点でもフレームワーク*選定*は人間主導が支配的（推測: 選定を任せた場合 AI は学習量の多い React に回帰するため、学習データ未収載の wcstack が自律選定される確率はほぼゼロ）。→ **3位・長期は妥当。維持**。
- **「人間が選定し AI が実装する」経路**: これは買い手①（個人開発者・社内ツール）の**今日の標準ワークフロー**。9ラン実測はまさにこのシナリオ（人間が「wcstack で」と指定 → AI が資料を探して実装）であり、検索1語目空振りで約半数が脱落する。**これは買い手3位の問題ではなく、買い手1位の成約率の問題**。
- **提案: ドラフト §3 の買い手③を 2 行に分割する。**「③-a AI 実装チャネル（買い手①②の到達媒体・**今すぐ**）」「③-b AI 自律選定（長期・種まきのみ）」。Tier 0-4（npm README 最適化）は ③-a の施策として明示的に位置づけ直す。

---

## 検討 2: 「AI に届く置き場所」優先順位マップ

軸は **帯域**（全文が生で届くか）× **到達契機**（発見フェーズで自発到達するか、採用決定後にしか存在しないか）。実測 9 ランとの整合を明記。

| 面 | 帯域 | 到達契機 | 実測根拠 | 優先度 |
|---|---|---|---|---|
| **WebSearch 結果** | スニペットのみ | 発見の唯一の関門 | 検索≥3回→到達5/5、≤2回→0/4。全てを支配 | **最上位（ただし施策は敷設済み・反映待ち）** |
| **npm README（`npm view` 生読み）** | **全文・生**（1578行実測） | AI が自発的に叩く（情報取得系 6 発火/9ラン） | 唯一の「人間と AI が同一全文を読む面」 | **1位** |
| **エラー/コンソール出力** | 全文・生 | エラー時に必ず読む・インストール不要 | プローブ未計測（greenfield のため）。推測だが機構的確度は高い | **2位（新設）** |
| **in-repo AGENTS.md / skill** | 全文注入（ハーネスが verbatim で読む — WebFetch 要約とは別機構） | **採用決定後のみ**。発見価値ゼロ | 未実測。AGENTS.md は Linux Foundation 標準・約30エージェントがネイティブ読取 | 3位（実行品質担当） |
| **GitHub README** | WebFetch 経由は要約（コードブロックのみ生存） | 検索から到達・学習クロールの正本 | コードブロック生存 2/2、散文・コメント消失 | 4位（コードブロック第一で維持） |
| **LP** | 要約（同上） | 検索ターゲット | 同上。禁止パターンのコメント 0/2 で消失 | 5位（インデックス役に徹する） |
| **MCP（Context7 経由）** | ツール結果=全帯域 | インストール済みユーザーのみ | 未実測。Context7 は MCP #1・ThoughtWorks Radar "Trial" | 6位（登録のみ・自前構築なし） |
| **llms.txt** | 要約で消える（verbatim 指定でも要約された実測あり） | 主要 AI 企業のコミットゼロ・500M 訪問中 408 取得 | 実測・業界データ双方で死亡確認 | 最下位（ファイル残置・投資ゼロ） |

**設計原則**: 正本は npm README（=GitHub README と同一ソース）に一本化し、他の面は生成・抜粋にする。散文で書いたものは AI に届かない — **コードブロックが唯一の輸送形式**（実測）。

---

## 検討 1: wcstack-app スキルの配布戦略

現状確認（実リポジトリ検分済み）: `wcstack/wcstack-skill` はプラグイン形式で公開済み・plugin.json v1.24.0・`/plugin marketplace add` 2 コマンドで導入可。`.agents/` ディレクトリは空。

**構造的な限界を先に認める**: スキルは「wcstack を使うと決めた後」にしか入らない。**発見チャネルではなく実行品質チャネル**。9ランのコールドスタート AI は誰もスキルを持っていなかったし、持ちようがない。よって配布戦略の目的は「発見」ではなく (a) 採用済みユーザーの成功率最大化、(b) ディレクトリ掲載による被リンク・検索面の獲得（副次）。

1. **Claude Code プラグインマーケット**: 公式マーケットプレイス + サードパーティ集約サイト（claudemarketplaces.com、tonsofskills.com=471 プラグイン/3,069 スキル、aitmpl.com 等）が存在。各 30 分で登録申請。効果確度は低〜中だが Tier 1-2（カタログ登録）と同じロジックで、費用がほぼゼロ。
2. **横展開の要否 — 形式は AGENTS.md 一本に集約**: 2026 年時点で AGENTS.md は Linux Foundation 管理の公開標準となり、Cursor / Copilot / Windsurf / Zed / Gemini CLI / Aider など約 30 エージェントがネイティブ読取（6 万リポジトリ超で採用）。**`.cursorrules` / `.windsurfrules` / `copilot-instructions.md` の個別整備は不要**（AGENTS.md で全カバー）。作るべきは:
   - **配布用 AGENTS.md スニペット**: SKILL.md のチートシート + silent-failure matrix を 1 コードブロックに圧縮し、README/LP に「あなたのリポジトリの AGENTS.md にこれを貼る」形で提示。**リダイレクト（「〜を読め」）は原理的に機能しない（実測）ため、内容実体をインラインで持つこと**。
   - examples の各ディレクトリに AGENTS.md 実物を同梱（コピーで持ち出せる + 学習クロールの corpus になる）。
3. **同期規約**: CLAUDE.md 既存規約（プロトコル変更時に skill 追随）に AGENTS.md スニペットを追加対象として明記。二重管理を避けるため、スニペットは SKILL.md から機械抽出できる構成が望ましい。

---

## 検討 3: MCP サーバー化と lint の壁

**自前 MCP サーバー（docs + lint）は見送りを推奨。** 理由:
- インストールが必要 = スキルと同じ「採用決定後」ゲート。発見価値ゼロ。
- 構築 2〜4 週 + 保守が恒常発生。外部ユーザー 0 の現在、利用者は作者のみ。
- 代替がある: **Context7 への登録**（2026 年の MCP #1 ドキュメントサーバー・#2 の約 2 倍の視聴数・既存インストールベースに乗れる・保守ゼロ）。数時間で完了。効果確度は中（日本市場での Context7 普及率は未確認 — 推測）。

**lint 0/9 の壁の構造**: 実測の核心は「情報取得系コマンドは AI が自発的に叩く（6 発火）が、文書に手順として書かれたコマンドは実行しない（0/9）」という**受動文書と能動指示の非対称性**。壁を破る設計は 2 つ:

1. **スキル/AGENTS.md 内での指示化**（確度: 中・未実測）: 「HTML を書き終えたら `npx @wcstack/lint` を実行せよ」を SKILL.md のワークフロー必須ステップに昇格。スキルはシステム的に注入される*能動指示*であり、0/9 の計測対象だった*受動文書*とは機構が異なる。ただしこの仮説自体が未実測 — **次回プローブで「スキル装着アーム」を追加して検証する**（測定コスト 0.5 日）。
2. **エラーメッセージ内誘導**（確度: 高・最重要）: state のバインディング解析エラー・警告に「正しい構文の提示（did you mean `class.done:` — `class:` は不正）+ `npx @wcstack/lint` への言及」を埋め込む。コンソール/実行時出力は AI が**誤った瞬間に必ず読む全帯域面**で、インストールも事前知識も不要。9ランの実誤りパターン（`$index` 発明・`class:` 誤用・`*` の template 外使用・ハンドラへのフィルタ）は全て構文近傍の発明であり、パーサが検出して誘導可能な類型。lint を「実行してもらう」のではなく**ランタイム自身を文書化する**発想の転換。工数 2〜5 日（state パーサのエラーメッセージ監査）。

「manifest ベース linter を AI コード検証器として売る」線は、この 2 つが実測で効果を示してから。現時点で外販を語る材料がない。

---

## 検討 4: 「AI が選ぶフレームワーク」3 経路の構造分析

| 経路 | 時間軸 | wcstack の位置 | 今打てる手 |
|---|---|---|---|
| **(a) 学習データ収載** | 2027〜28 年（カットオフ遅延 12〜24 ヶ月 + クロール可能な corpus の存在が前提） | 外部ユーザー 0 = クロール対象がほぼ無い。**施策ではなく人間採用の遅行結果**。ショートカット不能 | corpus の種まきのみ: 19 examples・41 ロングテールページ（Tier 2-3）・**5 スタック比較記事は「React コード ↔ wcstack コード」の対訳ペアで、翻訳タスクの理想的学習信号**（Tier 2-1 の AI 面での再評価） |
| **(b) 検索到達** | 週〜月（インデックス反映待ち） | **実測済みの唯一のボトルネック**。1語目ヒットで全ラン到達見込み | 敷設済み（sitemap/JSON-LD/Search Console）→ 反映確認後に再プローブ。**追加: 41 ロングテールページは AI の検索クエリ形状（「camera recording web component」等の API 形）に正確に一致**するため、AI チャネル観点で Tier 2-3 の優先度を上げる根拠になる |
| **(c) 文脈内学習容易性** | **今** | **唯一の構造的優位**。閉じた DSL・宣言的属性・1 HTML ファイル完結（アプリ全体がコンテキストウィンドウに収まる）・manifest で機械検証可能。実測でも資料到達後は概ね err0 で動くアプリを生成 | npm README 最適化（Tier 0-4）・スキル・silent-failure matrix・エラーメッセージ誘導。**「AI が 1 ファイルで全体を保持できる」は売り文句としても成立**（LP/README への追記候補・推測込みなので控えめに） |

結論: (a) はレバーではない。(b) が全経路のゲート（実測）。(c) が差別化の実体。投資配分もこの順の逆 — (c) と (b) に全額、(a) は副産物として回収。

---

## 優先順位付きアクションリスト

| # | 施策 | 工数 | 効果確度 | 実測との整合 |
|---|---|---|---|---|
| **P0-1** | npm README 最適化（=ドラフト Tier 0-4 を再確認・格上げ）。最上部に 1 タグ導入コードブロック + 検証コマンド。上位 5 パッケージ（wcstack 無スコープ/state/fetch/signals/router）先行、残りは機械生成 | 1〜2 日 | 高 | 全文生読み実測済み・自発発火 6 回/9ラン |
| **P0-2** | **AGENTS.md 配布スニペット**: チートシート+silent-failure matrix を 1 コードブロック化し README/LP に掲載 + examples に実物同梱。個別 .cursorrules 等は**作らない** | 0.5 日 | 中〜高 | コードブロックは要約を通過（2/2）・リダイレクトは死ぬ（実測）・AGENTS.md は約30エージェント標準 |
| **P0-3** | SKILL.md に lint 実行を必須ワークフローステップとして追記 + plugin version 追随 | 1 時間 | 中（未実測仮説） | 受動文書 0/9 とは別機構。次回プローブで検証対象 |
| **P1-1** | **エラーメッセージ内誘導**: state バインディング解析エラーに正構文提示 + lint 言及を埋込 | 2〜5 日 | **高** | コンソールは全帯域・インストール不要・実誤り 4 類型は全てパーサ検出可能域 |
| **P1-2** | **Context7 登録**（自前 MCP の代替） | 0.5 日 | 中 | MCP #1 ドキュメントサーバーの既存基盤に乗る。日本市場普及率は未確認（推測） |
| **P1-3** | プラグインディレクトリ登録（claudemarketplaces.com / tonsofskills.com 等） | 各 30 分 | 低〜中 | Tier 1-2 カタログ登録と同ロジック・費用ほぼゼロ |
| **P1-4** | **再検証プローブ**: インデックス反映確認後、①素のコールドスタート ②スキル装着 ③`npm view wcstack`（無スコープ・未検証経路）の 3 アーム | 0.5 日 | —（計測） | 「支配要因は検索」の再確認 + P0-3 仮説の検証 |
| **P2-1** | 41 ロングテールページ（Tier 2-3 の優先度引上げ）: AI の API 形クエリに一致 + 学習 corpus | 数日（manifest から機械生成） | 中 | 検索が全て（実測）の帰結。人間 SEO と AI 到達の一石二鳥 |
| **P2-2** | 5 スタック比較記事に「対訳ペア」framing を追加（Tier 2-1 の AI 面再評価） | 記事執筆内で追加コスト 0 | 中（学習信号としては推測） | corpus 種まき |
| **Kill/Defer** | 自前 MCP サーバー（外部ユーザー >0 かつ Context7 不足が確認されるまで）／llms.txt への追加投資（残置のみ）／個別ツール rules ファイル／create-wcstack（0/9 実測・据置） | — | — | — |

### ドラフトへの反映提案（2 点）

1. **§3 買い手③を分割**: 「③-a AI 実装チャネル = 買い手①②の到達媒体（今すぐ・Tier 0-4/P0-2/P1-1 が担当）」「③-b AI 自律選定（長期・corpus 種まきのみ）」。現行の 3 位格付けは ③-b に対してのみ妥当。
2. **Tier 0 に P0-2（AGENTS.md スニペット）、Tier 1 に P1-1（エラーメッセージ誘導）と P1-2（Context7）を追加**。いずれも「自分で叫ばない配布」の原則（§4 Tier 1 の思想）に合致する。

Sources:
- [How Much Software Is Written by AI in 2026? | Second Talent](https://www.secondtalent.com/resources/how-much-software-written-by-ai/)
- [AI-Generated Code Statistics 2026 | NetCorp](https://www.netcorpsoftwaredevelopment.com/blog/ai-generated-code-statistics)
- [Is 30% of code in 2026 really written by AI? — Lenz](https://lenz.io/c/ai-code-generation-2026-537534ce)
- [AI Code Generation Statistics 2026 | Uvik](https://uvik.net/blog/ai-code-generation-statistics/)
- [AGENTS.md vs CLAUDE.md vs Cursor Rules vs Copilot (2026) | Codersera](https://codersera.com/blog/agents-md-vs-claude-md-vs-cursor-rules-comparison-2026/)
- [AGENTS.md Spec 2026 | Morph](https://www.morphllm.com/agents-md-guide)
- [Claude Code Plugin Marketplace Guide (2026) | Agensi](https://www.agensi.io/learn/claude-code-plugin-marketplace-guide)
- [claude-code-plugins-plus-skills (tonsofskills.com) | GitHub](https://github.com/jeremylongshore/claude-code-plugins-plus-skills)
- [Claude Marketplaces directory](https://claudemarketplaces.com/)
- [The Context7 MCP Server | ChatForest](https://chatforest.com/reviews/context7-mcp-server/)
- [The State of MCP Registries | SafeDep](https://safedep.io/the-state-of-mcp-registries/)
- [The State of llms.txt in 2026 | aeo.press](https://ai.aeo.press/the-state-of-llms-txt-in-2026)
- [Does llms.txt Actually Work? The 2026 Data | aiseousa](https://aiseousa.com/blog/what-is-llms-txt-does-it-work)
---

# wcstack ファネル通し歩き — 断絶診断レポート

**結論**: ドラフトの Tier 0 は「3分時点のデモ不在」と「npm リンク欠落」は塞ぐが、**戦略核 (§2-2「1タグ導入」) の入口ボタンがファネル上のどこにも存在しない**という最大の断絶を塞がない。さらに一次取得で **npm latest は既に 1.24.0**（0-1 は発射済みの可能性大）である一方、**LP のリリースバッジが v1.22.6 のまま 2 マイナー古い**ことが判明した。「生きているか」シグナルが逆噴射している。

---

## 0. 通し歩きで新たに判明した一次事実

| 事実 | 出典 | 含意 |
|---|---|---|
| npm dist-tags latest = **1.24.0**（state / websocket とも） | registry.npmjs.org 実取得 | Tier 0-1（リリース発車）は**既に完了している可能性が高い**。ドラフト §1 の「22 コミット未リリース」は陳腐化 |
| LP バッジ表示は **v1.22.6** | LP 実取得 | 手動更新で 2 マイナー取り残し。構造問題（リリース CI が LP を更新しない） |
| LP は**英語のみ**・日本語導線ゼロ | LP 全リンク列挙に ja 無し | 買い手②「日本の業務系」の根拠「日本語ドキュメント完備」がファネル上**不可視** |
| LP に `state/` `signals/` のサブページが実在（構文リファレンス級の内容） | wcstack.github.io/state/ 実取得 | 資産はある。ただしそこにも live demo / npm リンク無し |
| ルート README にバッジ 0 個（CI / npm version / coverage いずれも無し） | README.md 実読 | 5,250 テストという最強の信頼資産が可視化されていない |
| `@wcstack/state` npm README は冒頭 40 行が哲学、うち 1 節が **「Do Not Compare This to Existing Frameworks」** | packages/state/README.md | Tier 1-3「比較表を自分で出す」と**正面矛盾**。HN 懐疑派には「比較を拒否 = 負ける自白」と読まれる |
| ルート README の adapter 節は `@wc-bindable/react, /vue, /svelte…` を**自作と明記せず**提示 | README.md L361-379 | §7 で kill 済みの「エコシステム偽装」リスクが README 本文に残存 |
| 静的デモ 8 本は CDN 未ピン（`esm.run/@wcstack/x/auto` = latest 追従） | examples 実読 | ホスト後、将来リリースで公開デモが壊れうる |
| I/O ノード README（websocket 例）は Install→Quick Start が上部にあり、npm 面として既に比較的良い。弱いのは state | packages/websocket/README.md | 0-4 の主対象は**主商品 39 ノードではなく state**（哲学先行） |

---

## 1. ファネル図（3 ペルソナ統合）

```
[認知]                [着地]              [30秒]                 [3分]                  [30分]                [導入]                 [発信]
Zenn/HN/検索/AI ──→ LP or README ──→ 「何が手に入るか」──→ 動くものを見る ──→ 手元で動かす ──→ 既存アプリに1タグ ──→ star/issue
                         │                  │                      │                     │                    │                     │
 (a)Zenn日本人 ──→ 英語LP ✗断絶4    H1=思想のみ △        デモ0 ✗断絶1      QuickStartコピペ○   入口ボタン無し ✗断絶2   質問導線無し ✗断絶11
 (b)HN懐疑派  ──→ README(star5)    バッジ0 ✗断絶8      「See it in action」  state READMEで        adapter第三者感        比較・ベンチ0
                                    AI banner が1行目 △   =静的コード ✗断絶1   「比較するな」✗断絶5   ✗断絶6                (Tier1で対応)
 (c)AI+非技術者 ─→ 検索1語目勝負 →  jsDelivr#1 ○ →      npm README全文 ○      構文正本が哲学の      lint は実行されない
                   (実測:半数脱落)    GitHub→AGENTS.md      (唯一の生テキスト面)   奥 ✗断絶9            前提で設計 ✗断絶9
```

各時点で得られるもの（現状）:
- **30秒**: 思想（What if…）は伝わる。「自分の何が楽になるか」は伝わらない（§2-3 の 1 文が未設置）
- **3分**: **全ペルソナ共通でゼロ**。クリックして動くものが 1 つもない
- **30分**: (a)(b) は Quick Start コピペで動く。(c) は npm README のコードブロック密度に依存

---

## 2. 断絶リスト（重大度順）

| # | 重大度 | 断絶 | 誰が落ちるか | Tier 0 で塞がるか |
|---|---|---|---|---|
| 1 | 致命 | **3分時点の「動くもの」が全経路でゼロ**。LP「See it in action」は静的コードのみ | 全員 | ○ 0-2 で塞がる |
| 2 | 致命 | **「既存アプリに1タグ」経路の着地点が無い**。戦略核 §2-2 の買い手①が押すボタンが LP にも README 上部にも無い（adapter 節は README 最下部・LP からは不可達） | 買い手①（最優先） | **✗ 塞がらない**。0-2〜0-4 のどれにも入っていない |
| 3 | 重大 | **LP リリースバッジが v1.22.6 のまま**（npm は 1.24.0）。更新が手動な限り再発する | (b) 懐疑派が最初に見る鮮度シグナル | **✗**。0-1 は npm への発射であり LP 側は対象外 |
| 4 | 重大 | **日本語導線ゼロ**（LP 英語のみ・ルート README 英語のみ・README.ja への入口無し） | 買い手②全員。Zenn→英語 LP は転換を落とす（推測） | **✗** |
| 5 | 重大 | **state npm README が哲学先行 + 「Do Not Compare」節**が Tier 1-3（自ら比較表を出す）と矛盾 | (b)、および npm 面を読む (c) | △ 0-4 の範囲次第。「冒頭に例を足す」だけでは矛盾節が残る |
| 6 | 重大 | **adapter 20 個の第三者感**。README 本文が自作と明記していない（§7 で kill 済みのリスクが本文に残存） | (b)。HN 前に必須 | **✗**。どの施策にも未割当 |
| 7 | 中 | LP に npm / 各パッケージリンクが無い | 全員 | ○ 0-3 |
| 8 | 中 | **信頼シグナル可視化ゼロ**: CI/npm/カバレッジのバッジ無し・「作者はソロで7年目」的な正直な自己紹介無し・CHANGELOG 導線無し | (b) | **✗**（安価なのに未割当） |
| 9 | 中 | **AI 経路の構文正本が遠い**。実測（9ラン）で「書いたコマンドは実行されない・散文は要約で落ちる・コードブロックは通る」のに、data-wcs 完全構文はスキル（要インストール）と長文 README の奥。npm README に構文チートシートのコードブロック塊が無い | (c) | △ 0-4 の具体化次第 |
| 10 | 小 | ホスト予定デモが CDN 未ピン → 将来リリースで公開デモが静かに壊れる | 将来の全員 | ✗（0-2 に 1 行追加で足りる） |
| 11 | 小 | **30分後の「次」が無い**: 質問・報告の導線（issue テンプレ / Discussions ※有効か未確認）が無い。最重要指標「外部 issue 0→1」の受け皿が未整備 | 全員 | ✗ |
| 12 | 小 | ホスト 8 本のうち tilt-maze はスマホ必須・camera/notification は権限プロンプト。初手 3 本（pomodoro/color-palette/devtools-playground）の明記はドラフト済みで妥当。tilt 用に QR コードがあると良い | デスクトップ閲覧者 | △ |

---

## 3. Tier 0 への追加・修正提案

**修正（既存 4 施策）**:
- **0-1 改**: npm latest=1.24.0 を確認し「発射済み」なら消化。代わりに **「LP バッジのリリース CI 自動更新」** を 0-1 の残タスクとする（断絶 3。手動更新は必ず再発する）。
- **0-2 改**: ホスト時に **CDN 参照を `@1.24` にピン**（断絶 10）。各デモに「View source（このページを保存すれば動く）」バナー — buildless の証明はソースが読めること自体。LP の各コードタブ直下に「Run live →」ボタンを対で置く。
- **0-4 改**: 対象を明確化 — 39 I/O ノードの README は既に Install/Quick Start が上部にあり合格圏。**手術が要るのは state**: (i) 冒頭を「1タグ例コードブロック」に、(ii) **「Do Not Compare」節を削除または「いつ選ぶ/選ばないか」に書換**（断絶 5・Tier 1-3 との整合）、(iii) 構文チートシートをコードブロックの塊として上部に（断絶 9・AI 実測に基づく）。

**追加（新規・いずれも数時間以内）**:
- **0-5: LP とルート README 上部に「Add one tag to your existing app」節**（断絶 2）。React/Vue タブ + `docs/framework-adapter-integration.md` への直リンク。**戦略核の決定 2 を承認するなら、これが Tier 0 の本丸**であり、現ドラフトには存在しない。
- **0-6: 日本語導線**（断絶 4）。最小構成 = LP ヘッダに「日本語 →」リンク + ルート `README.ja.md` 新設（各パッケージ README.ja は既にあるので目次役のみ）。Zenn 記事（Tier 3）の着地先を日本語面にできるようになる。
- **0-7: 正直化 2 点セット**（断絶 6・8）。adapter 節に「20 FW アダプタは全て作者自身が書いた公式アダプタ」の 1 文、README 冒頭に CI / npm version / テスト数バッジ + 「ソロ開発・外部コントリビュート歓迎」の 1 行。§7 の kill 判断を README 本文に反映するだけで、HN での最大の攻撃面が消える。
- **0-8: 受け皿**（断絶 11）。GitHub Discussions 有効化（未確認なら確認）+ 質問用 issue テンプレ。「外部 issue 0→1」を最重要指標に据えるなら、投函口の整備は計測の前提。

---

## 4. 計測設計（GoatCounter 前提）

**敷設**: LP + `state/` `signals/` サブページ + ホストする全デモ（同一 `wcstack.github.io` 配下に置けばカウンター 1 個で済む）。GoatCounter は cookie 無し・IP 非保存で、一般に同意バナー不要とされる。LP フッターに計測の 1 行明記 + データ公開設定（GoatCounter はダッシュボードを public にできる — OSS なら公開が信頼シグナルにもなる）。

**ファネル各段の測り方**:

| 段 | 指標 | 取得法 |
|---|---|---|
| S1 着地 | LP ユニーク訪問・**referrer 別**（zenn / news.ycombinator / google / npm / jsdelivr / github） | GoatCounter 標準。Tier 3 の「一発」の効果測定はこれが無いと不可能 |
| S2 興味（30秒生存） | `state/` `signals/` サブページ到達率、CTA クリック | サブページはページビューで取れる。CTA（Get Started / Run live / npm リンク）は `goatcounter.count()` のイベント送出を数行の JS で付与 |
| S3 体験（3分） | **デモ転換率 = /demos/* view ÷ LP view**、デモ内「View source」クリック | 同一カウンター内のパス別集計 |
| S4 実行（30分・サイト外） | jsDelivr 月間ブラウザヒット（既存 §5 指標と同一） | サイト計測では取れない。CDN ヒットを「手元で動かした」の代理指標とする（推測を含む代理であることを明記して運用） |
| S5 導入 | jsDelivr ヒットの**週次持続**（単発スパイクと分離） | jsDelivr stats API |
| S6 発信 | stars・**外部発 issue/discussion（最重要）** | GitHub API |

**運用**: 手動巡回をやめ、`scripts/metrics.mjs` 1 本で GoatCounter API + jsDelivr API + GitHub API を叩いて週次 1 行のスナップショットを吐く（6 ヶ月ゲート判定 2027-02-01 の証跡を自動で積む）。npm README への計測（トラッキングピクセル的バッジ）は行わない — npm 面の代理は jsDelivr で足りる。

**注意**: S2 のイベント計測は GoatCounter の外部スクリプト読込が必要。LP は自前ホストなので問題ないが、プライバシー明記との整合上、スクリプトは LP とデモのみに置き、ドキュメントサブページは pageview のみでも成立する。

---

## 5. 総括

Tier 0 の 4 施策は断絶 12 件中 **2 件を完全に、2 件を部分的に**塞ぐに留まる。特にドラフト自身が戦略核と定義した「1タグ導入経路」（断絶 2）に Tier 0 の施策が 1 つも割り当てられていないのは、戦略と実行の不整合。逆に 0-1 は既に発射済みの公算が高く（npm 1.24.0）、浮いた工数をそのまま 0-5（1タグ入口）と 0-7（正直化）に回せば、Tier 0 の週内完了は現実的と判断する。

**参照ファイル**: `c:\Users\kikuzawa\Documents\git\wcstack\wcstack\docs\go-to-market-2026-08.md` / `README.md`（L361-379 adapter 節・バッジ無し）/ `packages\state\README.md`（L25-37 「Do Not Compare」節）/ `packages\websocket\README.md`（L38-70 良形の npm 面）/ `examples\README.md`（静的 8 本の在庫）/ `examples\state-pomodoro\index.html` L53-56・`examples\state-color-palette\index.html` L48-51（CDN 未ピンの実例）
---

# 最終監査報告（wcstack GTM 2026-08 ドラフト + 9エージェント分析）

## 1. 矛盾判定表

| # | 矛盾 | 当事者 | 軍配と判定理由 | 処置 |
|---|---|---|---|---|
| M1 | 「直接競合が存在しない」(§2-2) vs georapbox / @ionic/pwa-elements / awesome-standalones の実在 | ドラフト vs レッドチーム配線層 | **レッドチーム**。一次調査で実在確認済み。しかも先行者の到達点（~50 stars・依存0件）がベースレートとして未考慮 | §2-2 の文言を「先行者は単発・無プロトコルで ~50 stars に留まる。我々の仮説は統一プロトコルがこの天井を破ること」に差替 |
| M2 | **コピー班の Show HN 本文が M1 の死んだ主張を再生産**（"the closest prior art is Polymer-era iron-ajax (long discontinued)"） | コピー班 vs レッドチーム配線層 | **レッドチーム**。この一文のまま HN に出すと georapbox を知る読者に一撃で刺される。コピー班はレッドチーム結果を見ずに書いている | Show HN 本文の比較段落を書き直し、georapbox 系を名指しで先に挙げ「単発 vs プロトコルで合成可能」の差分を自分から言う |
| M3 | jsfb =「最高レバレッジ」「提出しないなら Tier 1 半減」(§8) vs 「発見装置としては死亡実証（mikado/ivi）・引用元としてのみ生存」 | ドラフト vs レッドチーム jsfb | **レッドチーム**。ただし事例研究班（SolidJS = ドアオープナーだが成長エンジンでない・記事併用必須）と完全に収束しており、両班の結論は同一: **提出は実行、格付けは降格** | 提出は即決裁で実行（費用ゼロ・弾薬価値）。「最高レバレッジ」「半減」の文言削除。位置づけを「Tier 1-3 / 2-1 の弾薬製造」へ。実装ノート同梱（Solid のチート疑惑教訓） |
| M4 | jsfb 提出物の範囲: ドラフトは「signals 先行」（state 後続含意） vs 「state は until 条件を満たすまで提出しない」 | ドラフト vs レッドチーム jsfb | **レッドチーム**。state の中位数値は文脈（DSL込みでこの速度、という記事）が先に無いと逆宣伝。keyed 意味論の人間レビュー紛争リスクも実在 | 提出は signals のみ。state は比較記事公開後に再判断 |
| M5 | ベット(1)とベット(2)の内部矛盾: 主商品を I/O ノードに降格したのに、最高レバレッジ施策は降格した state/signals のショーケース | ドラフト内部（レッドチーム配線層 S5 が指摘） | **指摘が正しい**。ドラフト未処理 | LP にブリッジ文を常設: 「速い reactive core は配線層の土台。オーバーヘッドの心配は不要」まで（性能を購入理由に昇格させない） |
| M6 | 買い手1位: 「既存アプリ持ち個人開発者（React 経路含む）」 vs 「配線層の自然な買い手は FW を持たない人（SSR/htmx/Alpine 層）。React 経路は VueUse/react-use-websocket に挟撃され4位」 | ドラフト vs レッドチーム買い手 | **概ねレッドチーム**。「1タグ」が文字通り成立するのは FW ランタイム不在ページという構造論は正しい。ただし日本チャネル班の一次調査（useEffect 疲れが 2026 年現役の痛点・企業テックブログ継続発信）が React 経路の記事需要を実証しており、完全降格は過剰 | 優先順位改訂: ①SSR/ノーFW 層（htmx/Alpine 隣接・キオスク/社内ダッシュボード含む） ②脱jQuery 保守（日本・「業務系」から縮小） ③React 楔（主戦場でなく技術的証明: デモ1本+記事1本に限定、比較対象は react-use-websocket と正直に明記） |
| M7 | **楔デモ班・コピー班・日本チャネル班の具体化 3 本が React 楔を主役に設計**（M6 で降格された経路） | 具体化3班 vs レッドチーム買い手 | **折衷**。具体化物は既存資産転用でほぼゼロコストかつレッドチーム自身「廃止はしない・デモ1本で足りる」と認めている | 成果物は全部使う。ただし投下順を変更: LP 埋め込みの初手は `<wcs-intersect>` 静的デモ（ゼロインフラ・ノーFW 層にも見せられる）、React ws 楔は記事2本目 |
| M8 | AI の格付け: 「買い手3位・長期」 vs 「買い手でなくチャネル。実装経由は現在形（コードの1/4〜半分）」 | ドラフト vs レッドチーム買い手+AI配布班 | **両班（完全収束）**。9ラン実測の 4/9 失敗は「長期の賭けの不発」でなく「買い手①の成約率を今日 44% 失っている」の読みが正しい | §3③ を分割: ③-a AI実装チャネル（今すぐ・Tier 0 に焼き込み: npm README / AGENTS.md スニペット / エラーメッセージ内誘導） ③-b AI自律選定（長期・corpus 種まきのみ） |
| M9 | Tier 0-1「リリース発車（22コミット未リリース）」 vs npm latest = 1.24.0 実測 | ドラフト vs ファネル班 | **ファネル班**（一次取得）。ただし 1.24.0 に adapter 系が本当に入っているかは monorepo 側で最終確認すべき | 0-1 を消化済み扱いにし、残タスクを「LP バッジのリリース CI 自動更新」（現在 v1.22.6 表示で逆噴射中）に差替。浮いた工数を 0-5/0-7（下記）へ |
| M10 | **戦略核「1タグ導入」の入口ボタンが Tier 0 のどの施策にも割り当てられていない** | ドラフト内部（ファネル班が指摘） | **指摘が正しい**。戦略と実行の最大の不整合 | ファネル班 0-5（LP/README 上部に「Add one tag to your existing app」節）を Tier 0 の本丸として追加 |
| M11 | Tier 1-3「比較表を自分で出す」 vs state npm README の「Do Not Compare This to Existing Frameworks」節 | ドラフト vs リポジトリ実物（ファネル班発見） | **ファネル班**。比較拒否と比較表提示の同居は HN で「負ける自白」と読まれる | 同節を「いつ選ぶ/選ばないか」に書換（作者の思想文書に触るため要決裁 → D5） |
| M12 | 数字の不統一: 41 packages / 39 I/O ノード / 「30+」/ CLAUDE.md の35 | ドラフト・コピー班・事例研究班・共通コンテキストの間 | **コピー班の処置（控えめ側に統一）が正しい**。事例研究班の「39 Web APIs. 0 build. 0 dependencies.」は 0 dependencies が SSR の happy-dom 但し書きと衝突し虚偽リスク | 出荷前に全数再カウントし「41 packages / 30+ Web API tags / zero **runtime** dependencies」で全面統一 |
| M13 | llms.txt: メモリ・ドラフトで資産扱い vs 「死に面（500M 訪問中取得 408 件）」 | 既存前提 vs AI配布班 | **AI配布班**。実測（verbatim 指定でも要約された）とも整合 | ファイル残置・追加投資ゼロ。AI 面の投資は npm README / エラーメッセージ / AGENTS.md へ |
| M14 | Tier 順序（Tier 0 が最優先） vs TSKaigi Sendai CFP 締切 8/7 | ドラフト vs 日本チャネル班 | **日本チャネル班**。締切のある窓は Tier 順序の唯一の例外として妥当（提出自体にコスト以外のダウンサイドなし） | 今週のタスクに CFP 提出を追加（→ D4） |
| M15 | 6ヶ月ゲートの意味: 「売り込み停止判定」 vs 「事例の無風期間中央値は 2〜6 年」 | ドラフト vs 事例研究班 | **折衷**（§3 で詳述）。ゲート維持だが判定対象を限定 | ゲートを「能動的売り込み活動の継続判定」に限定し「プロジェクト/カテゴリ価値の判定」から切離す文言を明記 |
| M16 | デモ用 WS relay 常設（Deno Deploy 等） vs 「金銭施策なし・運用負担最小」制約 | 楔デモ班 vs 制約 | **緊張あり・未解決**。無料枠でも可用性責任と監視が恒常発生。デモが死ぬこと自体が「buildless を謳って動かない」の再演 | 決裁事項化（→ D8）。妥協案: intersect 静的デモを主・ws は公的 echo をフォールバックにコード内両記 |

## 2. 欠落論点（ドラフト+9分析のどこにもない）

1. **【最重大・時限】npm サプライチェーン防御が GTM の前提から抜けている。** メモリに「2026-08 の npm 2FA バイパス変更前に Trusted Publishing (OIDC) 移行（36+1 pkg）」が⚠残のまま。露出を増やす施策の直前に、41 パッケージの publish 経路が旧 token のまま。乗っ取られた場合「依存ゼロ・信頼できる配線層」の売りは恒久に死ぬ。**Tier 0 と同格・今月中**。
2. **セキュリティ開示体制ゼロ。** camera / clipboard / credential / websocket を扱う I/O 層なのに SECURITY.md・脆弱性報告窓口・対応 SLA の記載が皆無。HN 投下前に必須（懐疑派の定番チェック項目）。
3. **バス係数1の「緩和策」が皆無。** 全班が「正直に開示する」で止まっており、緩和（メンテナ後継方針・org 化・「作者不在時はフォーク歓迎、MIT + 全設計文書公開が保険」という一文）を誰も設計していない。開示は信用を守るが、緩和文言は採用障壁を下げる。1段落で書ける。
4. **名前空間の防衛が未点検。** @wcstack scope・無スコープ wcstack・@wc-bindable scope・wc-bindable-protocol org・wcstack.github.io は押さえているが、類似 scope のスクワット・wcstack.com が第三者である件の恒久方針（買わない宣言と誘導文言）・GitHub org 名の整理が論じられていない。露出直前に 1 時間で棚卸しすべき。
5. **時間予算の総和チェックがない。** 9 班の提案総和（Tier 0 拡張 8 項目 + CFP + 記事 5 本 + デモ 3 本 + 登録 5 箇所 + エラーメッセージ監査 2〜5 日 + 計測整備）は「時間の 2〜3 割は自由開発枠」制約下の 90 日供給を明らかに超過。**週あたり売り込み可能時間を先に宣言し、それで施策を削る工程が欠落**。燃え尽き対策の実効性はゲートではなくここで決まる。
6. **semver / 破壊的変更ポリシーの表明がない。** 「1タグ入れて既存アプリで運用」を売るなら、data-wcs 構文・wcBindable プロトコルの安定性保証（何を semver 対象とみなすか）が買い手の実質的関心。CDN 未ピンでデモが壊れる問題（ファネル班断絶10）は同根。
7. **成功時のスケール設計がない。** 外部 issue 0→1 を最重要指標にしながら、1→10 になった時の対応方針（応答 SLA を約束しない宣言・PR 受け入れ基準・41 パッケージ一斉バージョンの維持コスト）が未定義。CONTRIBUTING 整備は Tier 3 直前で良いが、「約束しないことの明文化」は受け皿（0-8）と同時が安全。
8. **ライセンス実務の細部。** MIT 自体は問題ないが、CMS テーマ/拡張への同梱・vendoring 条件（レッドチーム買い手が触れた導線）の明文化、npm 各 package.json の license 欄統一確認が未実施。
9. **HN/英語圏でのリアルタイム応答体制。** Show HN は投下後数時間のコメント応答が生死を分けるが、時差（JST）と作者の英語応答をどう回すかが未設計。投下時刻の設計（JST 深夜=米国朝）と定型応答の事前準備で足りるが、誰も触れていない。
10. **競合監視の定常化。** Datastar・georapbox・VueUse の動きを四半期で見る 30 分の定点観測が無い。M1 の教訓（調査不足で「競合不在」と書いた）の再発防止。

## 3. 6ヶ月ゲート評価

**結論: ゲートの存在自体は正しい（最大の燃え尽き対策という設計思想は9班の誰も崩せていない）。ただし現行の判定条件には 5 つの欠陥がある。**

1. **実行ゲートと成果ゲートが未分離。** Tier 0〜2 が未完了のまま 2027-02-01 を迎えた場合、測っているのは「売り込みの失敗」ではなく「未実行」。前段に実行チェックリスト（例: 2026-10-01 までに Tier 0 全消化 + jsfb 提出 + 記事 2 本）を置き、それを満たした場合のみ成果ゲートを発動する二層構造にすべき。
2. **jsDelivr 1,000 の根拠が無く、スパイク耐性も無い。** 272→1,000（3.7 倍）は恣意的で、Zenn バズ 1 回で単発達成し得る。ファネル班 S5 の「週次持続」で定義し直す（例: 直近 8 週の週次中央値換算で月 1,000 相当）。中間マイルストーン（90 日で 500）も置く。
3. **外部 issue 0→1 は受け皿未整備では測定前提が壊れている。** Discussions 有効化・issue テンプレ（ファネル班 0-8）はゲートの前提条件であり、Tier 0 に繰り込むこと。
4. **撤退対象の粒度が粗い。** 事例研究の中央値（無風 2〜6 年）に照らし、撤退するのは「能動的売り込み（記事・CFP・登録営業）」のみと明記する。常設面（LP・npm README・カタログ掲載・jsfb 掲載・デモ）は撤退後も複利で働く資産であり、撤去しない。「工芸ゲームに全振り」への移行はプロジェクト価値の否定ではないことを文言で固定する（そうしないとゲート発動自体が燃え尽きの引き金になる）。
5. **ベット別の反証条件が無い。** 現行ゲートは無差別で、どのベットが間違っていたかを判別できない。追加すべき最小セット: (a) jsDelivr ヒットの伸びが I/O タグでなく state/signals に集中したら配線層フレーミングを逆転（レッドチーム配線層 提案5）、(b) jsfb 提出後 Chrome 2 バージョン分で計測可能な流入変化ゼロなら「発見装置」期待を正式破棄し引用素材扱いに固定（レッドチーム jsfb）、(c) 記事 5 本の型別 LP 転換率で日本チャネルの継続型を 1 本に絞る（日本チャネル班 90 日ゲート）。判定の証跡はファネル班 `scripts/metrics.mjs` の週次スナップショットで自動化。

## 4. 決裁事項一覧（ドラフトの 2 点では不足。計 10 点）

| # | 決裁事項 | 期限 | 元の 2 点との関係 |
|---|---|---|---|
| D1 | **jsfb 公式提出（signals のみ・実装ノート同梱・「最高レバレッジ」格付けは撤回）** | 即時 | ドラフト決定1の修正版。state 提出は比較記事公開後に別途決裁 |
| D2 | **配線層への振り替え（条件付き）**: 「直接競合不在」文言差替・売り物は「タグ+無JS配線」ペア・jsfb ブリッジ文・ベット別反証条件の追加、の 4 条件込みで承認 | 即時 | ドラフト決定2の修正版 |
| D3 | **買い手優先順位の改訂**: ①SSR/ノーFW 層（キオスク・社内ダッシュボード含む） ②脱jQuery 保守（日本） ③React 楔（証明用に縮小） + AI を買い手からチャネルへ再分類（③-a/③-b 分割） | 即時 | 新規（ベット3 の変更。ドラフトは決裁対象にしていなかったが、M6-M8 により実質変更となるため要決裁） |
| D4 | **TSKaigi Sendai 2026 CFP 提出** | **8/7 締切・今週** | 新規・時限。唯一 Tier 0 に先行してよい例外 |
| D5 | **state README「Do Not Compare」節の書換**（「いつ選ぶ/選ばないか」へ） | Tier 0 内 | 新規。作者の思想文書に触るため機械的修正にせず決裁 |
| D6 | **Trusted Publishing (OIDC) 移行を Tier 0 同格に格上げ**（2026-08 の npm 2FA 変更前・41 パッケージ） | **今月中** | 新規・時限。欠落論点 1 |
| D7 | **Tier 0 の改訂承認**: 0-1 を「LP バッジ CI 自動更新」に差替、0-5 1タグ入口節 / 0-6 日本語導線 / 0-7 正直化2点（adapter 自作明記+バッジ）/ 0-8 受け皿（Discussions+SECURITY.md 含む）を追加、数字体系統一（M12） | 今週 | 新規（ファネル班+コピー班の反映） |
| D8 | **デモ用 WS relay を常設運用するか**（する: 楔デモの説得力最大 / しない: intersect 主役に差替） | Tier 2 着手前 | 新規。M16 |
| D9 | **6ヶ月ゲートの再定義承認**（二層化・週次持続定義・撤退対象の限定・ベット別反証条件・metrics.mjs 自動証跡） | 即時 | 新規。§3 の 5 修正 |
| D10 | **週あたり売り込み時間予算の宣言と施策の間引き**（9 班提案の総和は供給超過。予算を先に切り、Tier 2 以降の記事本数・登録箇所をそれに合わせて削る） | 今週 | 新規。欠落論点 5。燃え尽き対策の実効性はここで決まる |

小件（決裁不要・実行時に処理）: FUNDING.yml の有無を決めて閉じる（ドラフト自身の宿題）／CDN 参照の `@1.24` ピン／Show HN 投下条件チェックリスト（jsfb 済み・デモ稼働・受け皿整備・英語応答体制・投下時刻設計）を Tier 3 の発射条件として文書化／名前空間棚卸し 1 時間／競合定点観測を四半期カレンダー化。

**総括**: ドラフトの 3 ベットのうち、方向はいずれも生存したが無修正で生き残ったものは無い。(1) は「競合不在」の事実誤認を差し替えて条件付き採用、(2) は実行維持・格付け降格、(3) は買い手 1 位の差し替えと AI の再分類が必要。最大の統合上の欠陥は「戦略核（1タグ導入）に Tier 0 の施策が割り当てられていない」（M10）と「サプライチェーン防御の時限タスクが GTM の外に取り残されている」（欠落 1）の 2 点であり、いずれも今週の作業計画に直結する。
