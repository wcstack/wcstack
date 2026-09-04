# 設計: 名前付き State の廃止とマウントによるツリー拡張

- **状態**: 2026-09-01 起草。同日、著者が **D4（R1）/ D8（絶対参照なし）/ D11（ルート必須）/ 属性名 `mount`** を決定し、Phase 0 のベースライン計測と目標構文の e2e（fixme）を着地させた（[state-mount-impl-plan.md](./state-mount-impl-plan.md) §1）。**同日のアーキテクチャレビュー**（致命 2・重要 8）を受けて **D19〜D22 を追加し、D7 / D10 / D14 / D15 / D16 / D18 を改稿**した（状態列に「レビュー」と付した決定はレビューの推奨案を採用したもので、著者が差し戻せる）。残る要確認は **D12**（実装で確認）だけ。**Phase 1 実装済み（2026-09-01・R1 込み）**。**2026-09-02〜03 に Phase 2〜5 の実装をすべて `v2` ブランチで完了**（[impl-plan §3-0-1](./state-mount-impl-plan.md) に全スライス記録・§7 に実測）。D12 も実装で確認済み。残るは著者レビュー・リリース作業（P5-3〜P5-5）と wcstack-skill 追随のみ。**次期メジャー（v2.0.0）の目玉機能**。
- **対象**: `@wcstack/state` の core（`address/` / `binding/` / `bindings/` / `webComponent/` / `proxy/` / `bindTextParser/`）。追随が要るのは `@wcstack/server`（SSR スナップショットのキー）、`@wcstack/testing`（`state(name)`）、`@wcstack/typescript`（manifest の `states[name]`）、`vscode-wcs` / `@wcstack/lint`（`@name` の構文）、devtools hook protocol（`keys(name, rootNode)`）、wcstack-skill の references。
- **一言で**: 「**State は 1 つの rootNode に 1 本のツリー。拡張はマウントで行い、名前では行わない**」。`<wcs-state name="x">` と `path@x` を廃止し、`<wcs-state mount="x">` と `x.path`、および `<my-c data-wcs="state: path">`（丸ごとマウント）に置き換える。
- **不変条件（この設計の一文）**: **マウントされたコンポーネントのバインディングは、その位置にテンプレートを展開してパスに接頭辞を付けたものと区別できない。** 台帳は 1 本、アドレスは絶対、橋渡しは存在しない。**唯一の例外は私有キーと getter**（展開したテンプレートには存在しないもの）で、それらはオーバーレイ専用のアドレス空間に載り、スコープの外からは見えない（D20）。
- **動機**: 著者の提示した 4 点 — かっこいい／コードの単純化／メモリ消費の削減／高速化。§7 で 4 点を検証可能な仮説に落とし、**成立する範囲を正直に限定する**（コンポーネントの無いページでは後 2 つはほぼ不変）。
- **関係する既存設計**: [state-cross-state-read-design.md](./state-cross-state-read-design.md)（名前付きを前提に越境を増やす案 — **本設計と両立しないので閉じる**）、[architecture-hardening/15](./architecture-hardening/15-state-component-mechanism-consistency.ja.md)（bind-component の欠陥史 §1.1〜§1.13 — 本設計はその機構ごと置き換える）、[state-bind-component-nested-for-design.md](./state-bind-component-nested-for-design.md)（Δ / base listIndex — 絶対アドレス化で不要になる）、[i18n-design.md](./i18n-design.md) D4（`@i18n` 参照 — `i18n.` 接頭辞へ移行）。

---

## 0. 決定レコード

### 0-1. 品質特性の優先順位（本書の全決定はこの順に従う）

1. **予測可能性** — 無言の取り違えを作らない。解決規則は静的で、実行時のデータ形状（非同期ロードの前後）で意味が変わってはならない（D4・D8・D11）。
2. **表面の単純さ**（＝「かっこいい」の実体）— 1 ページの状態は 1 本のツリーとして読める。名前空間という第二の軸を持たない（D1・D2・D5）。
3. **実装の単純さ** — 台帳は 1 本。state 要素同士を橋渡しする層（inner/outer proxy・派生規則・相乗り登録・越境スタック）を持たない（D6・D7）。
4. **ホットパス不変** — コンポーネントもボリュームも無いページに代償を払わせない（D18）。
5. **移行可能性** — v1 の形から機械的に置換でき、lint と実行時 warn が導く（D16・D17）。

順序の帰結: 2 を 3 より上に置いたので、表面の一貫性のために core を書き直す（逆なら「`state: path` を足して name は残す」で終わる）。1 を最上位に置いたので、D4 は互換性より静的規則を優先する（R4 を採るなら 1 と 5 の順序を入れ替えたことになる）。

**前提条件（順位ではなく制約）**: **回帰ゼロ**。ADR-15 §1.7〜§1.13 で直した形は全て受け入れマトリクスに写像され（[impl-plan §7-8](./state-mount-impl-plan.md)）、v2 でも緑であること。機構を消すときに機構のテストも消えるので、挙動を固定していたテストは新 API へ移植してから消す。

### 0-2. 決定表

「状態」列: **決定**（合意提案として閉じている）／**要確認**（著者判断待ち）／**未決**。

| # | 論点 | 決定（提案） | 状態 |
|---|---|---|---|
| **D1** | 何を作るか | **1 rootNode = 1 ツリー**。`<wcs-state>` の `name` 属性と `path@name` 構文を**廃止**。ツリーの拡張は**マウント**のみ（§2） | 決定 |
| **D2** | マウントの種類 | 2 種。**ボリューム**（`<wcs-state mount="path">`: データを持ち込む）と**コンポーネント**（`<wcs-state bind-component>` ＋ ホストの `data-wcs="state: path"`: 既存サブツリーの上に getter と私有キーを重ねる）。プリミティブは **chroot（接頭辞翻訳）1 つ**で、両者はその 2 つの使い方（§4-2 / §4-3）。代替「ボリュームだけ（コンポーネントもワイルドカードパスに置くボリュームとみなす）」は、コンポーネントはデータを持ち込まず既存サブツリーに**重ねる**ものなので棄却（接ぎ木は空きスロットにしか置けない — D3） | 決定 |
| **D3** | ボリュームの意味論 | **接ぎ木**。ルートの空きスロットに state オブジェクトを置き、getter / `$` 宣言は接頭辞付きでルート台帳に登録する。マウント先が既にルートに存在すれば **throw**。マウントパスは**静的**（`*` 不可）（§4-2） | 決定 |
| **D4** | コンポーネントの解決規則 | **R1: own data key ＝ 私有、getter / メソッド ＝ chroot 評価、それ以外 ＝ ツリー**。私有キーがマウント先のキーを隠すときは**バインド時に warn**（＋ lint）。代替 R2〜R4 は §4-3 | 決定（2026-09-01・著者） |
| **D5** | マウント表の記法 | ホストの `data-wcs` に **`state: path`（ルートマウント）** と **`state.sub: path`（部分マウント）**。複数可、**最長接頭辞一致**。新属性は作らない（§3-2）。代替「ホスト側の新属性（`mount="path"`）」は、`for` の shorthand（`state: .`）と listIndex の継承が `data-wcs` の外に出てしまうので棄却 | 決定 |
| **D6** | アドレス | **登録時に接頭辞を合成した絶対アドレスをルート台帳に登録**する。派生規則・相乗り登録・越境スタック・inner/outer proxy は**持たない**（§5-2） | 決定 |
| **D7** | スコープ解決 | バインディングの state は **DOM の位置**で決まる（document / ShadowRoot / コンポーネントスコープ）。名前では決めない。**スコープ根は親側の静的マークアップで決まる**: `data-wcs` に `state` / `state.*` エントリ（マウント表）を持つ要素がスコープ根。子の `<wcs-state bind-component>` が現れるタイミングには依存しない（§5-1）。Light DOM コンポーネントの `name` 必須は消える（§3-3） | 決定（2026-09-01・レビューで精密化） |
| **D8** | コンポーネント内からの絶対パス | **v2.0 では不可**（chroot は厳格）。コンポーネントが要るものはホストがマウントする。`/` 接頭辞による絶対参照は **2.x の候補**として構文上の余地だけ残す（§2-3） | 決定（2026-09-01・著者） |
| **D9** | `$1` / `$updatedCallback` / `$getAll` / `$setAll` / `$resolve` / `$watch` / `$streams` / `$listKeys` | **スコープ相対**。コンポーネントの作者は自分がリストの中に置かれるかを知らずに書く（§4-6）。代替「絶対（Δ 込み）」は、同じコンポーネントを `for` の内外どちらにも置けなくなるので棄却 | 決定 |
| **D10** | コンポーネント getter / 私有キーの可視性 | **スコープ内のみ**。D20 のアドレス空間の帰結（親スコープの `items.*.upper` は予約セグメントを含まないのでツリーの未存在パス）。親から子の getter を読む形は v2.0 では**しない**（§8） | 決定（非目標・レビューで D20 の帰結に） |
| **D11** | ルートの存在 | **ルート `<wcs-state>` は必須**（空でよい）。ボリュームだけのページは暗黙ルートを作らず **throw** する（§4-8） | 決定（2026-09-01・著者） |
| **D12** | ready | `State.getBindingsReady(root)` は **マウント配下（コンポーネントスコープ）まで待つ**。今日の「コンポーネントのスコープは対象外」を解消する（§4-8） | **要確認**（実装で確認） |
| **D13** | DCC | **不変**。`defineDCC` の `:not([name])` セレクタを落とすだけ。DCC はマウントではなく wc-bindable の producer のまま（§6） | 決定 |
| **D14** | SSR | スナップショットは **1 rootNode に 1 本**（ボリュームの**データ**は接ぎ木済みの形で含める）。`<wcs-ssr name>` は消える。hydrate 時もボリューム要素は**モジュールをロードする**（getter / メソッド / `$` 宣言は src にしかない）が、データは接ぎ木せずスナップショットの部分木を**採用**する。D3 の衝突検査は、宣言済みボリュームが所有するスロットに対して hydrate 時は掛けない。`enable-ssr` はルートに集約（§4-2 / §6） | 決定（2026-09-01・レビュー。server 側は Phase 3 で実装確認） |
| **D15** | ツールの manifest | `wcstack.application.states[name].stateSchema` → **単一 `stateSchema`**（ボリュームはその部分木）。`@wcstack/typescript` / `@wcstack/testing` は **1.x で `states[name]` のまま初回 publish してよい**（app-testing 計画の予定どおり）。2.0 で `schemaVersion: 2` に上げ、`wcs-schema check` は v1 manifest に移行ヒントを出す。`testing.state(name?)` は 1.x で name を任意化しておく（§6） | 決定（2026-09-01・レビュー） |
| **D16** | 移行の経路 | **v1.x minor で deprecation** → **v2.0 で削除**。1.x の主経路は **lint**（`wcs/named-state-deprecated`・warning・移行ガイドへのリンク）と README 告知。実行時の `console.warn` は **`config.debug` 下だけ**（`mount=` は 2.0 にしか無く、1.x で warn しても利用者は動けない — 代替の無い warn は既定で出さない）。Phase 1（`state: path`・**R1 込み** — D19）は v1.x で先行出荷する（§9） | 決定（2026-09-01・レビューで改稿） |
| **D17** | バージョン | **全パッケージを 2.0.0 に揃える**（[feedback: バージョン揃え]）。`wcstack` エントリと skill の plugin version も追随 | 決定 |
| **D18** | ホットパス | マウントの無いページで増えるのは **ルート handler の boolean 分岐 1 つ**（`hasMounts`）。スコープ根の解決（§5-1）は、rootNode にスコープ根が無ければ `getRootNode()` に短絡する（今日と等価・祖先走査を載せない）。`jsfb-verify.mjs` が ±ノイズ内であることを受け入れ条件にする（§7） | 決定 |
| **D19** | Phase 1 の意味論 | Phase 1（v1.x）の `state: path` ルートマウントは **v1 機構の上で R1 を実装する**（own data key は私有・マウント先に同名キーがあれば warn）。v1 の innerState は getter → マッピング → ローカルの順で解決し、ルート規則は全キーをカバーするので、素直に載せると **R2 の挙動**（own key が全てツリーに隠される）になり、2.0 の R1 と同じマークアップで逆に解決する無言の反転が生じる。部分マウント（`state.sub: path`）は既存挙動（マッピングが勝つ）を 1.x で維持し、own key と衝突していれば「2.0 では私有になる」warn を出す（§4-3 / §9-2） | 決定（2026-09-01・レビュー） |
| **D20** | 私有キー・getter のアドレス空間 | オーバーレイが所有するエントリ（私有キー・コンポーネント getter）は、マウントパスの直下に**予約セグメント**を挟んだ絶対アドレスで台帳に載る（`users.*.#m3.editing` — `#m3` はマウント記録の id・`#` はパス文法で書けない文字）。ツリーのアドレスとは構造的に衝突せず、ルート handler のオーバーレイ dispatch は**予約セグメントを含む読み書きだけ**に掛かる（最長接頭辞照会をあらゆる読みに掛けない）。私有キーの書き込みはこのアドレスでルート updater を通る（バインドと getter キャッシュが無効化される）。代替「台帳の鍵に scopeId を足す」は全照会に次元が増えるので棄却（§5-3） | 決定（2026-09-01・レビュー） |
| **D21** | 私有状態の寿命 | 私有オブジェクトは**マウントインスタンス**（`(mountPathInfo, listIndex)`）に属し、要素には属さない。行の swap では listIndex が行と一緒に動くので私有状態は行に付いて回り、行の差し替えでは新しい listIndex に**初期スナップショット**（バインド時の own data key の浅い複製）から作り直され、行の削除で捨てられる。要素寿命にすると行 content のプール再利用で別の行の私有状態を引き継ぐ（§4-3）。Phase 1（v1 機構）は要素寿命のままで、差は「swap / replace 後の私有キーの残存」だけ — v1 の既存挙動なので 1.x では不変、2.0 で改善として扱う | 決定（2026-09-01・レビュー） |
| **D22** | ボリュームのスロット予約 | `<wcs-state mount="p">` は接続時に登録簿にスロット `p` を**予約**する（pending）。予約下のパスの読みは `undefined` で、pathDiagnostics の warn は出さない（ロード前の一時状態は「未宣言」ではない）。D3 の衝突検査は「ルートデータとボリューム宣言の両方が揃った時点」で掛ける。深いマウント（`a.b`）で `a` が無ければ `{}` を作る。ルート側から `this.a = {...}` でマウントポイントを含む親を丸ごと書く形は throw。`mount` 属性の実行時変更は無視＋warn（§4-2） | 決定（2026-09-01・レビュー） |

---

## 1. 現状 — 名前付き State の実像（コード調査・2026-09-01）

### 1-1. 名前付き State はグローバルではない

登録簿は **rootNode ごとの flat な `Map<name, IStateElement>`** である（[stateElementByName.ts:9](../packages/state/src/stateElementByName.ts#L9)）。`@name` はバインド先ノードの `getRootNode()` で引いた登録簿から兄弟 state を選ぶだけで、**Shadow DOM 境界を越えない**（[applyChange.ts:188](../packages/state/src/apply/applyChange.ts#L188)）。つまり今の名前付き State は Unix の `/` ではなく **Windows のドライブレター**に相当する。「別の名前空間を作る」機能であって、「どこからでも届く」機能ではない。

### 1-2. 名前が担っている 4 つの役割

| 役割 | 現状 | 本設計での置き換え |
|---|---|---|
| (a) 1 ページに複数ソース（`src` 2 本・「島」） | [examples/router-i18n](../examples/router-i18n/index.html#L260)（リポジトリで唯一の実使用） | **ボリューム** `<wcs-state mount="i18n" src=...>` — 島はそのまま成立する（§3-1） |
| (b) Light DOM `bind-component` の `name` 必須 | [State.ts:298](../packages/state/src/components/State.ts#L298)。理由は登録簿が rootNode-flat で、同じ root に無名を 2 つ置けないから | **DOM 祖先によるスコープ解決**（D7）。同名 2 個を同一スコープに置けない制限（README「リストの行には Shadow DOM を使え」）も消える |
| (c) README 原則 #2「Component ↔ Component は `@stateName`」 | [README.md:49-55](../packages/state/README.md#L49) | 「**ホストがマウント表を書く**」に書き換える（§2-2） |
| (d) ツール群の name 次元 | manifest `states[name]`・vscode-wcs の索引キー `(stateName, path)`・`testing.state(name)`・SSR `findByName`・devtools `keys(name, rootNode)` | 全て **path 次元だけ**になる（§6） |

### 1-3. bind-component の現在の機構 ＝ 2 本の state と橋渡し

`webComponent/` は 12 ファイル **999 行**で、その大半が「子の state 要素と親の state 要素を橋渡しする」ためにある（[webComponent/README.md](../packages/state/src/webComponent/README.md)）。

| ファイル | 行 | 役割 | 本設計 |
|---|---|---|---|
| `innerState.ts` | 179 | 子側 proxy。getter → マッピング → ローカル の順で解決、越境時に loopContext を組み直す | **削除**（chroot proxy に統合） |
| `outerState.ts` | 56 | `element.state` の公開 proxy。子 proxy へ素通し | **削除**（`element.state` は chroot proxy そのもの） |
| `MappingRule.ts` | 253 | プライマリ規則＋サブパス読みごとの**派生規則と派生バインディングの生成・購読者登録** | **削除**（登録時に絶対化するので派生が要らない） |
| `crossBoundaryAddress.ts` | 56 | Proxy トラップで落ちる listIndex を動的スコープで越境させる | **削除** |
| `outerListPath.ts` | 139 | 子の `for` パスを親の listPaths / elementPaths へ伝播 | **削除**（台帳が 1 本） |
| `baseListIndex.ts` | 95 | Δ（ホストが親の `for` の何段目にいるか）の算出 | **削除**（絶対パスのワイルドカード数 ＝ listIndex 段数） |
| `completeWebComponent.ts` / `stateElementByWebComponent.ts` | 73 | 台帳 | **縮小**（マウント記録 1 つに） |
| `bindWebComponent.ts` / `meltFrozenObject.ts` / `types.ts` | 85 | 入口 | **改稿** |

さらに core 側に散っている橋渡しの痕跡:

- `BindingSession` の相乗り登録 `outerPatternPathInfo` / `outerPatternPathInfosRest`（[BindingSession.ts:84-95](../packages/state/src/bindings/BindingSession.ts#L84)、[:996-1017](../packages/state/src/bindings/BindingSession.ts#L996)）— 境界の枚数ぶん同じ行バインディングを台帳に積む（§1.8 / §1.11）
- proxy の `hasMappedComponentState` 分岐 ×6（[getByAddress.ts:90](../packages/state/src/proxy/methods/getByAddress.ts#L90)、[setByAddress.ts:137](../packages/state/src/proxy/methods/setByAddress.ts#L137)、[isCacheable.ts:19](../packages/state/src/proxy/methods/isCacheable.ts#L19) 等）— **mapped な state はキャッシュを持てない**
- `list/wildcardLevel.ts`（57 行）の末尾起点 `at(i - W)` 解決 — 相対パスの段数と listIndex 段数のズレを吸収するためだけにある
- `applyChangeToWebComponent.ts`（63 行）— 値を運ばない再読込通知チャネル

そして **`data-wcs="state: user"`（丸ごと）は無言の no-op** として固定されている（[integration.bindComponentDelivery.test.ts:126-133](../packages/state/__tests__/integration.bindComponentDelivery.test.ts#L126)、[applyChangeToWebComponent.ts:32](../packages/state/src/apply/applyChangeToWebComponent.ts#L32)）。「サブツリーをマウントする」形は今日存在しない。

### 1-4. コードベースは既に名前から離れている

- `$watch` は `@stateName` 越境を**拒否**する（[processWatchDeclaration.ts:66](../packages/state/src/watch/processWatchDeclaration.ts#L66)）
- クロス state 読み取り設計は「最初の実需を失って優先度低下」のまま未決
- i18n は辞書の正本を ES モジュールに置き、辞書 state は「`@i18n` で引くためだけの射影」と明記済み（[i18n-design.md:144](./i18n-design.md#L144)）

名前付き State に残っている実需は「(a) 複数ソース」だけで、それはボリュームで足りる。

前提として明記する: この結論はリポジトリ内の調査によるもので、npm 利用者の `@name` 使用は把握できない。緩和は D16 の deprecation 期間（1.x の lint warning ＋ README 告知）で、2.0 の parse error が移行先を示す。

---

## 2. モデル — Unix 類推の精密化

### 2-1. 語彙

| 語 | 定義 |
|---|---|
| **ツリー** | 1 つの rootNode（document / ShadowRoot）に 1 本ある状態の木。台帳（依存グラフ・購読者・listIndex・キャッシュ）はツリーに 1 組 |
| **ルート** | ツリーを所有する `<wcs-state>`（`mount` も `bind-component` も無いもの）。rootNode に **ちょうど 1 つ** |
| **スコープ** | バインディングが「どのツリーの、どの接頭辞の下で」解決されるかの単位。document / ShadowRoot / `bind-component` ホストの DOM サブツリー |
| **マウントポイント** | ツリー上のパス。ボリュームなら静的、コンポーネントならワイルドカードを含みうる（`items.*`） |
| **ボリューム** | `<wcs-state mount="path">`。**データを持ち込む**マウント。state オブジェクトがツリーの `path` に接ぎ木される |
| **コンポーネントマウント** | `<wcs-state bind-component="state">` ＋ ホストの `data-wcs="state: path"`。ツリーの既存サブツリーの上に、コンポーネントの **getter と私有キー**を重ねる（オーバーレイ） |
| **chroot** | コンポーネントスコープの相対パス解決。スコープ内の `title` は絶対 `items.*.title` |

### 2-2. Unix との対応

| Unix | wcstack v2 | wcstack v1 |
|---|---|---|
| 単一ツリー `/` | rootNode ごとのルート `<wcs-state>` | `default` state |
| `mount /dev/sdb1 /mnt/data` | `<wcs-state mount="data" src="...">` | `<wcs-state name="data">` ＋ `path@data` |
| `/etc/fstab`（誰が何処にマウントするかを親が書く） | ホストの `data-wcs="state: path"` | `state.sub: path`（プロパティ単位のみ） |
| `chroot`（プロセスから見た `/` の付け替え） | コンポーネントスコープ | inner/outer proxy ＋ MappingRule |
| overlayfs の upper 層 | コンポーネントの own data key（私有）と getter | mapped は親、それ以外はローカル |
| ドライブレター `C:` `D:` | **廃止** | `@name` |
| どのプロセスからも絶対パスで `/` に届く | **v2.0 では無し**（D8） | 無し（Shadow 境界を越えない） |

### 2-3. 類推が切れるところ（正直に）

1. **絶対パス**。Unix の単一ツリーが成立するのは、どのプロセスからも `/etc/passwd` に届くからでもある。v2.0 の chroot は厳格で、コンポーネントは自分のマウント先しか見えない。横断的関心事（theme / auth）はホストが `state.theme: theme` でマウントする。これは「マウント表がコンポーネントの唯一の結合点」を守るための選択で、Unix より **コンテナ**に近い。絶対参照（`/theme.mode`）は構文上衝突しない（`/` はパス文字に無い）ので 2.x の候補として残す。
2. **島**。無関係なスニペットを 2 つ貼る形は、v1 でも無名 2 つは "already registered" で throw していた。v2 ではボリューム 2 つ＋空ルートで成立する（§3-1）。**悪化しない**。
3. **可変な横断的関心事**。i18n は不変なので ES モジュールで決着した。auth のような可変データは D8 の帰結としてホスト経由になる。絶対アドレス化（D6）により **多段の境界を越えても登録は 1 回**なので、v1 で痛かった §1.11 / §1.12 の「段ごとの相乗り」問題は再発しない。

---

## 3. 表面（構文）

### 3-1. ボリューム — `name` の直接の置き換え

```html
<!-- v1 -->
<wcs-state name="i18n" src="/i18n/state.js"></wcs-state>
<wcs-state src="/app.js"></wcs-state>
<h1 data-wcs="textContent: t.app.title@i18n"></h1>

<!-- v2 -->
<wcs-state src="/app.js"></wcs-state>
<wcs-state mount="i18n" src="/i18n/state.js"></wcs-state>
<h1 data-wcs="textContent: i18n.t.app.title"></h1>
```

- `mount` は**ドット区切りの静的パス**（`settings.theme` のような深いマウントも可）。`*` は不可
- ルートが `i18n` を宣言していたら throw（マウント先は空きスロットでなければならない — Unix はディレクトリの中身を隠すが、それは無言の取り違えなので採らない）
- 島: `<wcs-state></wcs-state>`（空ルート）＋ `<wcs-state mount="a" src="a.js">` ＋ `<wcs-state mount="b" src="b.js">`

### 3-2. コンポーネントマウント — 丸ごとと部分

```html
<!-- v1: プロパティ単位でしか配線できない -->
<my-list data-wcs="state.items: rows; state.title: heading"></my-list>
<template data-wcs="for: users">
  <user-card data-wcs="state.name: .name; state.email: .email"></user-card>
</template>

<!-- v2: 丸ごとマウント -->
<my-list data-wcs="state: rows"></my-list>          <!-- 中では items → rows は不要、パスは rows 直下 -->
<template data-wcs="for: users">
  <user-card data-wcs="state: ."></user-card>       <!-- 行そのものをマウント。中の name は users.*.name -->
</template>

<!-- 部分マウント（複数可・最長接頭辞一致） -->
<my-panel data-wcs="state.user: session.user; state.theme: theme"></my-panel>
```

- `state: path` はルートマウント（コンポーネントの `/` ＝ ツリーの `path`）。`state.sub: path` は `sub` 以下のマウント。**両者を併用**できる（`state: rows; state.theme: theme` — Unix で `/` の下に `/mnt/theme` をマウントするのと同じ）
- マウントパスは**ワイルドカードを含んでよい**（`state: items.*`）。listIndex はホスト要素のループ文脈から来る（今日と同じ）
- **新しい属性は作らない**。マウント表は `data-wcs` の既存文法の一般化（`state` 単独が今日 no-op だった穴を埋める）
- `state:` がマウント表として解釈されるのは、要素が `bind-component` のホストであるときだけ（今日と同じく完了台帳 `isWebComponentComplete` がゲート）。`state` という wc-bindable プロパティを持つ普通の要素への `state: path` はプロパティバインドのまま

### 3-3. Light DOM — `name` が消える

```html
<!-- v1 -->
<wcs-state bind-component="state" name="my-light"></wcs-state>
<div data-wcs="text: message@my-light"></div>

<!-- v2 -->
<wcs-state bind-component="state"></wcs-state>
<div data-wcs="text: message"></div>
```

スコープは DOM の位置で決まる（D7）。Light DOM コンポーネントを**リストの行に置ける**ようになる（v1 の README が「Shadow DOM を使え」と逃がしていた形）。

### 3-4. 廃止する構文・API

| 廃止 | 場所 | 代替 |
|---|---|---|
| `<wcs-state name="x">` | 属性 | `<wcs-state mount="x">` |
| `path@x` / `path@default` | `data-wcs`・`{{ }}`・spread `...: obj@x`・shorthand `.name@x` | `x.path` / `path` |
| `@` を含む `$updatedCallback` のパス表記（`path@name`） | [updatedCallback.ts:48](../packages/state/src/proxy/apis/updatedCallback.ts#L48) | 絶対パス（コンポーネント内は相対） |
| `State.getBindingsReady(root)` の「コンポーネントスコープは対象外」注記 | README | D12 |
| `<wcs-ssr name>` | SSR | 1 ツリー 1 本（D14） |
| `testing.mount().state(name)` | `@wcstack/testing` | `state()`（ルート）。ボリュームはルートのパスで読む |
| `wcs-schema --state=<name>` / manifest `states[name]` | `@wcstack/typescript` | `--mount=<path>` / 単一 `stateSchema`（D15） |
| devtools `keys(name, rootNode)` / `state:element-registered {name}` | hook protocol v1 | protocol v2: `keys(rootNode)` / `{ mount, rootNode, element }` |
| `wcs/manifest-state-collision` | vscode-wcs / lint | 消滅（衝突する軸が無い） |

---

## 4. 意味論

### 4-1. 解決規則（コンポーネントスコープ内の読み・書き・`in`）

パス `p` の先頭セグメント `s` について、順に:

1. `s` がコンポーネント state オブジェクトの **getter / setter / メソッド** → chroot proxy を `this` にして評価（依存は絶対アドレスで追跡される）
2. `s` がコンポーネント state オブジェクトの **own data key** → **私有**。コンポーネント要素ごとに 1 つ。ツリーには載らない
3. それ以外 → **ツリー**。`p` に最長接頭辞一致するマウント表のエントリで翻訳し、絶対アドレスで読み書きする
4. マウント表に一致が無い場合は 2 通り:
   - (4a) マウント表そのものが空（`state: ...` も `state.sub: ...` も無い plain 形）→ コンポーネント自身がルート（今日の plain 分岐と同じ・独立したツリー）
   - (4b) マウント表は非空だが一致するエントリが無い（部分マウントだけのコンポーネントで、どのマウント接頭辞にも含まれないキーを読み書きした）→ **throw**（今日の `"no mapping rule and no local state property"` と同じ。ルートマウントがあれば 3 で必ず一致するので、ここに来るのは部分マウントだけの形）

書き込みで 3 に落ち、ツリーにそのキーが無い場合は**ツリーに作る**（マウント先にファイルを作るのと同じ）。今日の `raiseError("no mapping rule and no local state property")` が残るのは 4b だけになる。

### 4-2. ボリューム（接ぎ木）

- ロード完了時に `root[mountPath] = volumeObject` を置き、volume の getter / setter / `$watch` / `$streams` / `$listKeys` を **接頭辞付きでルート台帳に登録**する。ボリューム自身は台帳を持たない
- volume の getter の `this` は **chroot proxy**（`this.lang` は `i18n.lang`）。ルートの getter から `this["i18n.t"]` と読めば依存が張られる — **クロス state 読み取り設計が要求していた 12 のゲートは、ツリーが 1 本になることで消滅する**
- `$connectedCallback` / `$updatedCallback` はボリュームごとに残り、chroot で呼ばれる。`$updatedCallback` には自分の接頭辞配下の更新だけが相対パスで届く
- 初期化順序: ルートのバインディング構築はルート登録で始まる（今日と同じ）。ボリューム要素は**接続時にスロットを予約**し（D22）、`i18n.t.x` へのバインドはロード完了まで `undefined` を読む（予約下なので pathDiagnostics は沈黙する）。接ぎ木時に `mountPath` 起点の更新通知が走る。**ロード順に依存しない**
- 衝突検査（D3）の時点: ルートデータとボリューム宣言の両方が揃ったとき。ルートのロード完了時に予約済みスロットがルートデータに存在すれば throw、ボリューム接続時にルートが済んでいて同名キーがあれば throw
- 深いマウント `a.b` で `a` がルートに無ければ `{}` を作る（`a` があって `b` があれば throw）。ルート側から `this.a = {...}` でマウントポイントを含む親を丸ごと書く形は throw（ボリュームの getter 登録が指す対象が消えるため）
- hydrate（D14）: ボリューム要素はモジュールをロードする（getter / メソッド / `$` 宣言のため）が、データは接ぎ木せずスナップショットの部分木を採用する。予約済みスロットに対する衝突検査は掛けない。`enable-ssr` はルートに集約する

### 4-3. コンポーネント（オーバーレイ）— D4 の候補

| 案 | 規則 | 静的 | ルートマウント下の私有 state | 既存例（`state = { message: "" }` ＋ mapped）| 非同期ロードの罠 |
|---|---|---|---|---|---|
| **R1（提案）** | own data key ＝ 私有（ツリーを隠す）。getter ＝ chroot | ✅ | ✅ | ❌ 既定値がツリーを隠す → **warn ＋ lint で削除を促す** | ✅ 無い |
| R2 | マウント表のエントリ優先、未カバーのキーだけ私有 | ✅ | ❌ ルートマウントでは全キーがカバーされ私有を持てない | ✅ | ✅ |
| R3 | ツリーにキーがあればツリー、無ければ私有（動的） | ❌ | ✅ | ✅ | ❌ `<wcs-fetch>` 後に来るキーを私有が隠し続ける |
| R4 | `$local: ["editing"]` を明示宣言。未宣言の own data key は既定値（マウント時は無視） | ✅ | ✅ | ✅ | ✅ |

R1 を採る理由: 一文で言える（「**自分で書いたキーは自分のもの。書いていないキーはマウント先のもの**」）、新しい宣言が要らない、Unix のマウントと同じ向き（上に載せた側が勝つ）。代償は既存の mapped コンポーネントの既定値がツリーを隠すことで、これは**バインド時にマウント先の値がオブジェクトで同名キーを持てば `console.warn`**（[pathDiagnostics](../packages/state/src/pathDiagnostics.ts) と同じ「バインド確立時 1 回・ホットパス外」）と lint（`wcs-schema` の `stateSchema` ＋ マウントパスで静的に検出できる）で導く。R4 は優先順位 1 と 5 を入れ替える案で、既存例を無傷にしたいなら採る。**著者判断 → R1 に決着（2026-09-01）**。

**私有状態の寿命（D21）**: 私有オブジェクトはマウントインスタンス `(mountPathInfo, listIndex)` ごとに 1 つで、要素ごとではない。行コンポーネント `state: .` が `state = { editing: false }` を持つとき、swap で行が動けば `editing` は行に付いて回り（listIndex は行と一緒に動く）、`replaceRows` で新しい行になれば初期スナップショットから作り直される。要素寿命にすると行 content のプール再利用で「別の行の `editing`」を引き継ぐ（無言の取り違え）。初期スナップショットはバインド時に own data key を浅く複製したもの。Phase 1（v1 機構）は要素寿命のまま（v1 の既存挙動）で、2.0 で改善として扱う。

**Phase 1 での R1（D19）**: v1 機構の innerState は getter → マッピング → ローカルの順なので、ルート規則をそのまま載せると own key が全てツリーに隠される（R2）。Phase 1 はルート規則を持つコンポーネントに限って own data key を先に見る（私有）ようにし、2.0 と同じ意味論で出荷する。部分マウントだけのコンポーネントは既存挙動（マッピングが勝つ）を維持し、own key と衝突していれば warn で 2.0 の反転を予告する。

### 4-4. ワイルドカードとリスト

- 絶対パスのワイルドカード数 ＝ listIndex の段数。`state: items.*` の下で `for: children` を回すと `items.*.children.*`（2 段）で、ホスト行の listIndex が親、内側の行が子。**Δ の帳簿は要らない**（`baseListIndex.ts` / `wildcardLevel.ts` の `at(i - W)` が消える）
- `$1` / `$2` / イベントハンドラの indexes / `$updatedCallback` / `$getAll` は **スコープ相対**（D9）: `$n` → `listIndex.at(Δ + n - 1)`、Δ ＝ マウント接頭辞のワイルドカード数。この 1 箇所の引き算だけが Δ を知る
- 行 content のプール再利用（§1.9 の罠）: コンポーネントのバインディングは絶対アドレス `(pattern, listIndex)` で台帳に載るので、**素の入れ子 `for` の行と同じ経路**で付け替わる。専用の再読込（`_reloadMappedPathsAfterReconnect`）は要らない

### 4-5. 入れ子マウント

接頭辞は登録時に**全段合成**する。3 枚の境界を越えても台帳登録は 1 回。中間コンポーネントが親の `for` の中にいても（§1.12 の形）、絶対パスにワイルドカードが増えるだけ。

### 4-6. `$` API の接頭辞翻訳

| API | v2 の振る舞い（コンポーネントスコープ／ボリューム） |
|---|---|
| `$getAll(path, indexes)` / `$setAll` / `$resolve` | 相対パス → 接頭辞合成 → ルート API。省略時の文脈既定（`[...$n]`）は Δ を除いたスコープ内の添字 |
| `$postUpdate(path)` | 相対 → 絶対 |
| `$updatedCallback(paths)` | 自分の接頭辞配下だけを**相対**で受ける |
| `$watch` | 相対で宣言、ルート台帳に絶対で登録。`@` の拒否コードは消える |
| `$streams` | 相対で宣言、データはツリーの `prefix.path` に落ちる |
| `$listKeys` | 相対で宣言、ルートの ListKeyMap に絶対で登録 |
| `$connectedCallback` / `$disconnectedCallback` / `$stateReadyCallback` | スコープごとに残る（ライフサイクルは要素のもの） |
| `$commandTokens` / `$eventTokens` / `$command.*` / `$on` | 宣言（`$commandTokens` / `$eventTokens` / `$on`）は**ルートに置く** — マウント／ボリュームでは実行しない（無言に捨てず warn で誘導・実装注記 2026-09-04。当初案「スコープごとに残す」は per-scope トークン台帳の設計が別途要るため未実装）。テンプレート側の `$command.*` の**参照**（バインディングのパス）はルート宣言のトークンに解決される（`$` 頭のパスは翻訳しない） |
| `$1` / `$2` / `$wildcardIndexes` | スコープ相対（§4-4） |

**実装注記（2026-09-04）**: 宣言面（`$watch` / `$streams` / `$listKeys` / `$updatedCallback`）の相対サポートは**ボリュームのみ**（`$streams` はボリュームでも未対応 — 宣言は raise）。マウントされた**コンポーネントスコープ**は宣言面を実行せず、(tag, prop) につき 1 回の warn でルート／ボリュームへ誘導する（webComponent/mount.ts の `warnMountedDollarDeclarations`）。

### 4-7. 診断（無言の取り違えを作らない）

| 状況 | 反応 |
|---|---|
| ルートが 2 つ | throw（今日の "already registered" と同じ） |
| `mount` 先がルートに既にある | throw → **実装は `console.error` に隔離**（graftIsolated — connectedCallback 内 throw は初期化待ちを永久未解決にするため。1 ボリュームに閉じる・実装注記 2026-09-04） |
| ボリュームのロード失敗（`src` の 404・JSON パースエラー・inline script の import 失敗） | `console.error` に隔離（graft 失敗と同じ着地 — 接ぎ木は載らず予約だけが残る。予約成立**前**の設定エラーは従来どおり resolve 済み throw で fail-fast。未解決のまま投げると waitForStateInitialize がページ全体を無言でウェッジし、再入ガードが再接続の復旧も塞ぐため。実装注記 2026-09-05） |
| `mount` に `*` | throw |
| ボリュームがあるのにルートが無い | throw（D11）→ **実装は loud エラー（`console.error`・パース完了後にルート候補の要素が無ければ 1 回）**。理由は上と同じ throw 不可の制約。接ぎ木は保留のままなので、後からルートを動的に足せば成立する（実装注記 2026-09-04） |
| 私有キーがマウント先の既存キーを隠す | `console.warn` 1 回（バインド時）＋ lint |
| `state: path` と `state.sub: path` が同じ `sub` を二重に指す | throw（今日の "Duplicate mapping rule" と同じ） |
| コンポーネント内から存在しないツリーパスを読む | `undefined`（pathDiagnostics の warn は今日のまま） |
| 部分マウントだけのコンポーネントで、どの接頭辞にも含まれないキーを読み書き | throw（§4-1 の 4b） |
| 予約済み（ロード前）のボリュームスロット配下を読む | `undefined`・warn 無し（D22） |
| ルート側から接ぎ木済みマウントポイントを**含む親**を丸ごと書く（`mount="a.b"` で `this.a = {...}`） | throw（D22 後段 — 接ぎ木データが無言で消えアクセサだけ宙に浮くため。スロット自身への書き込みはデータ差し替えとして通る） |
| `mount` 属性の実行時変更 | 無視＋warn（再マウントは非目標） |
| 親スコープから `items.*.upper`（子の getter / 私有キー）を読む | ツリーの未存在パスとして `undefined`＋pathDiagnostics の warn（D10 / D20） |
| `@` を含むパス | v1.x: lint warning（実行時は `config.debug` 下で warn 1 回） → v2: **parse error**（移行ヒント付き） |
| 同一コンポーネントに 2 本目の `<wcs-state bind-component>`（別 prop） | throw（**1 コンポーネント 1 マウントスコープ** — 2 本目を受けると 1 本目の収集済みスコープが無言で死ぬため。実装注記 2026-09-04） |
| 接ぎ木済みボリューム / マウント記録の居るツリーへの `setInitialState()` 再 set | throw（D22 同型 — 丸ごと再 set は接ぎ木データ・quoted-path アクセサ・マーカー台帳・合流済み宣言面を無言で捨てるため。変更したいパスを個別に書く。実装注記 2026-09-04） |
| マウントされたコンポーネントのワイルドカード終端アクセサ（`get "tags.*"()` がツリーのリストへ翻訳される形） | throw（マーカー終端パスはオーバーレイが getter を影にして未評価の proxy が値になるため。私有配列上の同形（own key `tags` あり）は私有アンカーとして従来どおり通る。実装注記 2026-09-04） |

### 4-8. 初期化と ready

- ルート登録で rootNode のバインディング構築が始まる（今日の `setStateElementByName` 初回登録と同じ役割）
- コンポーネントスコープのバインディングは **マウント表が確定するまで保留**し、確定してから絶対アドレスで登録する。**暫定の接頭辞で登録してから直すことはしない**（§1.7 / §1.9 / nested-for §8.1 で 3 度踏んだ「順序違いの取り違え」を構造的に塞ぐ）
- `getBindingsReady(root)` はマウント配下の保留が解けるまで resolve しない（D12）。reject の配管は今日のまま（無言ハングを作らない）

---

## 5. 実装アーキテクチャ

### 5-1. 登録簿

```
scopeRoot(Node: Document | ShadowRoot | mount host) → IStateElement | MountRecord
```

- ルート／plain コンポーネント → その要素（ツリーを所有）
- マウントされたコンポーネント → マウント記録（id ＋ 親ツリーのルート ＋ 接頭辞 ＋ 私有スナップショット ＋ オーバーレイ表）
- **スコープ根の判定は親側の静的マークアップ**（D7）: `data-wcs` に `state` / `state.*` エントリを持つ要素。親スコープの TreeWalker（`getSubscriberNodes`）はこの判定でサブツリーを除外できるので、子の `<wcs-state bind-component>` が connectedCallback / upgrade でいつ現れても、親が内側ノードを接頭辞無しで束ねることは無い（ADR-15 §1.13 と同じ「順序違い」クラスを構造で塞ぐ）。`state:` の無いホスト（plain 形）は今日どおり子宣言の独立ツリー
- ノードからの解決: rootNode にスコープ根が 1 つも無ければ `getRootNode()` に短絡（今日と等価・D18）。あれば祖先を辿って最初のスコープ根。**バインディング登録時に 1 回**だけ行い、結果は binding に持つ（`absoluteStateAddressByBinding` が今日も同じ場所でキャッシュしている）

### 5-2. 絶対アドレス化

`IAbsolutePathInfo` から `stateName` が消え、`(rootElement, pathInfo)` になる。`BindingSession.registerAddress` は接頭辞合成済みの絶対パスで `addBindingByPattern` / `addBindingByAbsoluteStateAddress` を **1 回**呼ぶ。`outerPatternPathInfo` / `outerPatternPathInfosRest` は消える。

### 5-3. chroot proxy とオーバーレイ表

- **chroot proxy**: `get(prop)` → §4-1 の規則。ツリー行きは `root.createState` の中で絶対アドレスを読む。getter 評価の receiver として使うので、依存追跡はルートの `pushAddress` に絶対アドレスで載る
- **オーバーレイのアドレス空間（D20）**: マウント記録は id を持ち（`m3`）、私有キーと getter は `<mountPath>.#m3.<key>` の絶対アドレスで台帳に載る（行コンポーネントなら `users.*.#m3.editing`、listIndex はマウント接頭辞のワイルドカードぶん）。`#` はパス文法で書けない文字なのでツリーのアドレスと衝突しない。chroot proxy は §4-1 の規則 1 / 2 に当たったキーをこのアドレスに翻訳し、規則 3 のキーをツリーの絶対アドレスに翻訳する。私有配列を `for` で回せば `users.*.#m3.drafts.*`（ワイルドカードが増えるだけ）
- **オーバーレイ表**: `(mountPathInfo, listIndex) → { component, privateObject, chrootProxy }`。ルート handler は `hasMounts` が真で、かつ読み書きのパスが予約セグメントを含むときだけオーバーレイへ委譲する（getter は chroot proxy を `this` に評価・私有キーは privateObject を読み書き）。予約セグメントを含まない読みは今日と同じ経路。**親スコープの `users.*.editing` は予約セグメントを含まないので、ツリーの未存在パスとして `undefined`**（D10 はこの帰結）
- **私有キーの更新経路**: chroot proxy の set → ルートの `setByAddress(users.*.#m3.editing, [i])` → オーバーレイへ委譲 → updater が同アドレスを enqueue → そのアドレスのバインディングと、それを読んだ getter（`users.*.#m3.label`）のキャッシュが無効化される。ツリーのキャッシュ機構をそのまま使う
- **オーバーレイ表の寿命（D21）**: エントリは行の listIndex と同寿命。`for` の差分で listIndex が消えれば捨て、新しい listIndex には初期スナップショットから privateObject を作る。要素の付け替え（プール再利用）は `element → 現在のマウントインスタンス` の対応を更新するだけ

### 5-4. ホットパス

- マウント無し: `hasMounts === false` の分岐 1 つ。キャッシュ・依存 walk・LIS・BindingOwner ファンアウト対策は無改造
- マウント有り: 子側のキャッシュ禁止（`isCacheable`）が消え、ルートのキャッシュがそのまま効く。越境スタックの push/pop、派生バインディングの生成、相乗り登録、2 段 proxy ホップが消える

### 5-5. 削除・縮小・新規（実測・2026-09-03）

| 区分 | 対象 | 行（実測） |
|---|---|---|
| 削除 | v1 橋渡し機構（P2-7: `innerState` / `MappingRule` / `crossBoundaryAddress` / `applyChangeToWebComponent` / 相乗り台帳ほか） | **−1,327**（src のみ・テスト込みで −3,618） |
| 削除 | `stateName` 配管・`@` パーサ・登録簿の名前次元・deprecation 機構（Phase B） | 上記正味に含む |
| 新規 | マウント記録＋変換（mount.ts 563）・オーバーレイ表（overlay.ts 315）・**ボリューム（volume.ts + volumeShared.ts 469 — v1 に無い新機能**）・スコープ（mountScope 91）・厳格 R1 の私有面（ownKeyShadow + preCompletionWrites 203） | +1,810（webComponent/ のみ） |
| **正味** | packages/state/src 全体（分岐点比） | **+1,339**（+2,857 / −1,518）。`webComponent/` は 999 → 1,869 |

**「core 正味 −750 行」仮説は不成立**。理由は数えれば明快で、(1) ボリューム（`mount=`）は v1 に存在しない新機能（469 行）、(2) 厳格 R1（D19）の私有キー機構と宣言面（$watch/$updatedCallback のボリューム翻訳）も新規容量である。**成立したのは構造の主張のほう** — 橋渡し層（inner/outer proxy・派生規則・相乗り登録・越境スタック）は 1,327 行まるごと消え、台帳は 1 本、ADR-15 §1.7〜§1.13 の機構は全廃止（§0 表は「廃止（state-mount）」に更新済み）。行数は「単純化の代理指標」として機能しなかった、が本書の記録である。

---

## 6. 周辺パッケージへの影響

| パッケージ | 影響 | 規模 |
|---|---|---|
| `@wcstack/state` README（英・日）/ SPEC | 原則 #2・Named State 節・Light DOM 節・「Choosing a Component Mechanism」・`$` blank-out 注記（[README.md:1830](../packages/state/README.md#L1830)）・`getBindingsReady` 注記 | 日本語 README に 60 箇所 |
| `@wcstack/server` | `Ssr.findByName` → rootNode 単位。スナップショットに接ぎ木済みボリュームの**データ**を含める。hydrate ではボリューム要素がモジュールをロードしつつ、データはスナップショットの部分木を採用する（D14） | 中 |
| `@wcstack/testing` | 1.x で `state(name?)`（name 任意）にしておき、2.0 で `state()`（name 指定は error）。`mount()` という関数名は state の `mount` と衝突するが、どちらも各領域の慣用なので**改名しない**。README で 1 行区別する | 小 |
| `@wcstack/typescript` | 1.x は `states[name]` のまま初回 publish。2.0 で manifest `states[name]` → 単一 `stateSchema`（`schemaVersion: 2`）。`wcs-schema --state` → `--mount=<path>`（ボリュームの型を部分木として merge）。`check` は v1 manifest に移行ヒント（D15） | 中 |
| `vscode-wcs` / `@wcstack/lint` | `@` の字句・`stateNameRange`・索引キー `(stateName, path)` → `path`・`manifest-state-collision` 削除。v1.x では `wcs/named-state-deprecated`（warning）、v2 では parse error。R1 の「私有キーがツリーを隠す」lint | 13 ファイル |
| devtools hook protocol | v2: `keys(rootNode)` / `read(rootNode, path)`、イベント payload から `name` を除去、予約接頭辞 `wcs-devtools*` の規範は廃止（[devtools-hook-protocol.md:282](./devtools-hook-protocol.md#L282)）。**オーバーレイの可視化**: 私有キーと getter はツリーに載らないので `overlays(rootNode)`（マウント記録と各インスタンスの私有キー）を足す | 小（UI はツリー 1 本＋オーバーレイで描ける） |
| `@wcstack/router` / I/O ノード群 / `signals` | **無し**（名前を知らない。router×state 契約は wcBindable 経由） | — |
| DCC | `:not([name])` を落とす（D13） | 1 行 |
| `wcstack` エントリ / skill | references の構文更新、plugin version 2.0 | 小 |
| examples / `__e2e__` | `router-i18n`（`@i18n` 15 箇所 ＋ `name="i18n"` 1 箇所）**のみ**。`__e2e__` に `<wcs-state name=` は無く、他の examples の `@` はすべて CSS（`@keyframes` / `@media`）か `@wcstack` の文字列。README の `bind-component` 例は `state: path` へ | 小 |

---

## 7. 期待効果の検証（4 つのメリットを仮説にする）

| メリット | 仮説 | 計測 | ゲート |
|---|---|---|---|
| かっこいい | §3 の before/after が README の冒頭で一段落に収まる。「名前空間」という語が README から消える | レビュー | 主観（著者） |
| コードの単純化 | core 正味 −750 行（§5-5）。`webComponent/` が 999 → ≈300 行。ADR-15 §1.7〜§1.13 の機構が**全部消える** | `wc -l`・ADR-15 §0 表の「実装」列を「廃止」に書き換えられるか | 実測で更新 |
| メモリ | **コンポーネントを行に持つリスト**で 1 行あたりの保持量が下がる（inner/outer proxy ×2・MappingRule の Map ×3・派生 IBindingInfo・相乗り台帳エントリが消える）。**コンポーネントの無いページはほぼ不変**（`stateName` は intern された文字列参照 1 本） | `e2e/bench/memory-profile.mjs` を `__e2e__/list-component`（行コンポーネント）で before / after | 行コンポーネント: 減少を報告。plain: ±ノイズ |
| 高速化 | 同じく**コンポーネント経路**で: 越境 push/pop・派生登録・2 段 proxy ホップ・キャッシュ禁止が消える。**plain ページ（jsfb）は不変** | `e2e/bench/jsfb-verify.mjs`（plain）＋ list-component 版ベンチ（新設） | jsfb: ±ノイズ内（D18）。list-component: 退行ゼロ、改善は実測値を報告 |

「メモリ削減」「高速化」を**無条件の売り文句にはしない**。成立する範囲（コンポーネントを使うページ）を README に書く。

**ベースライン（2026-09-01・v1.32 の機構・[impl-plan §1-3](./state-mount-impl-plan.md)）**: 行をコンポーネントにすると plain jsfb に対して create1k **32.1 → 106.5 ms（×3.3）**、heap run1k **5.65 → 13.13 MB（＋7.5 KB / 行）**、clear 後も 12.32 MB を保持。この差分が Phase 2 の削減対象で、削れた量が「メモリ削減・高速化」の実測値になる。

**after（2026-09-03・v2 全 Phase 完了時・同一マシン）**:

| 仮説 | 実測 | 判定 |
|---|---|---|
| 高速化（コンポーネント経路） | list-component create1k **169.4 → 128.6 ms（−24%）**・update **−45%**（同一セッション A/B・impl-plan §3-0-1 slice 7）。全 Phase 後の確認値 125.6 ms | **成立** |
| メモリ（行コンポーネント） | heap run1k **13.13 → 11.59 MB（−1.5 MB ≒ −1.5 KB/行）**・update5 13.38 → 11.81 | **成立（減少）** |
| plain 不変（D18） | jsfb 同一セッション A/B: create1k 40.6→37.75・replace1k 22.8→15.5・clear10k 73.9→70.1（v2 側が全指標同等以上）。memory-profile は全項目 ±2% | **成立** |
| コードの単純化 | §5-5 のとおり**行数では不成立**（ボリューム＝新機能の分だけ正味 +1,339）。橋渡し層の全廃（−1,327）と台帳 1 本化は成立 | **構造で成立・行数で不成立** |
| かっこいい | README から「名前空間」「Named State」の語が消え、原則 #2 は「ホストが書くマウント表」1 文になった | 著者レビュー待ち |

---

## 8. 非目標（v2.0）

- 親スコープからコンポーネント getter を読む（`items.*.upper`）— D20 のアドレス空間では予約セグメントを含まない読みなのでツリーの未存在パス。2.x で入れるなら「予約セグメント無しの読みでもオーバーレイ表を引く」規則を足す（D10）。表は `(mountPathInfo, listIndex)` キーなので後から足せる
- コンポーネント内からの絶対参照 `/path`（D8）
- ボリュームのワイルドカードマウント・動的な再マウント（`mount` 属性の実行時変更は無視＋warn）
- DCC のマウント化（ADR-15 §2.5 / §3 の命名規約統一）— DCC は wc-bindable のまま
- `signals` パッケージへの波及
- ライブ i18n 切替（i18n-design D1 の棄却は維持。ボリューム化で `i18n.lang` を getter 入力にできるので、復活経路はむしろ広がる）

---

## 9. 移行（v1 → v2）

### 9-1. 対応表

| v1 | v2 |
|---|---|
| `<wcs-state name="x" src="...">` | `<wcs-state mount="x" src="...">` |
| `text: path@x` | `text: x.path` |
| `text: path@default` | `text: path` |
| `...: obj@x` / `.name@x` | `...: x.obj` / `.name`（`@` 無し） |
| Light DOM `bind-component` の `name` ＋ `@name` | どちらも削除 |
| `state.a: p; state.b: q` | そのまま動く（部分マウント） |
| — | `state: p`（新設・丸ごと） |
| `state = { message: "" }`（mapped の既定値） | R1 なら削除（warn が指す） |
| `testing.state("x")` | `testing.state()` ＋ パス `x.…` |
| `wcs-schema --state=x` | `wcs-schema --mount=x` |

### 9-2. 経路（D16）

1. **v1.x minor**（次のリリースに同乗可）: `state: path` ルートマウントを**既存機構の上で・R1 込みで**先行出荷（[impl-plan Phase 1](./state-mount-impl-plan.md)・D19）。lint に `wcs/named-state-deprecated`（warning・移行ガイドへのリンク）、README に告知。実行時の `console.warn` は `config.debug` 下だけ（D16）。部分マウントと own key の衝突には「2.0 では私有になる」warn（実行時・タグ × キーで 1 回）
2. **v2.0.0**: 削除。移行ガイドは §9-1 をそのまま載せる。全パッケージ 2.0.0（D17）、`wcstack@2.0.0` ピン版数 5 箇所、skill plugin 2.0

---

## 10. 未解決の論点

1. ~~**D4（R1 か R4 か）**~~ — **決着（2026-09-01）: R1**。既存の mapped コンポーネントの既定値は warn ＋ lint で削除を促す
2. ~~**D8**~~ — **決着（2026-09-01）: 2.0 では絶対参照なし**。「マウント表が唯一の結合点」を維持
3. ~~**D11**~~ — **決着（2026-09-01）: ルート必須**。要素の無いルートの保持者は作らない
4. **D12** — `getBindingsReady` がマウント配下を待つときの reject 配管と、router の binder プロトコルとの相互作用（`<wcs-head>` の早期 bind）
5. ~~**D14**~~ — **決着（2026-09-01・レビュー）**: データはスナップショット・関数はモジュール。hydrate は採用、接ぎ木しない。`enable-ssr` はルートに集約（ボリューム単位の opt-out は非目標）。server 側は Phase 3 で実装確認
6. ~~**`mount` の語**~~ — **決着（2026-09-01）: `mount`**。`@wcstack/testing` の `mount()` とは領域が違うので README で 1 行区別する
7. **命令的 API** — `State.mount(element, path)` のような JS 側の入口を用意するか（HTML だけで足りるなら作らない）
8. ~~**私有キー・getter のアドレス**~~ — **決着（2026-09-01・レビュー）: D20**（予約セグメント `#<id>`）
9. ~~**Phase 1 と R1 の両立**~~ — **決着（2026-09-01・レビュー）: D19**（Phase 1 で R1 を実装。部分マウントは既存挙動＋予告 warn）
10. ~~**私有状態の寿命**~~ — **決着（2026-09-01・レビュー）: D21**（マウントインスタンス寿命。Phase 1 は要素寿命のまま）
11. ~~**ボリュームのロード前**~~ — **決着（2026-09-01・レビュー）: D22**（スロット予約・衝突検査は両方が揃った時点）

---

## 11. 調査で確認した事実の所在

- 登録簿: [stateElementByName.ts:9](../packages/state/src/stateElementByName.ts#L9) / 名前解決の rootNode 依存: [applyChange.ts:188](../packages/state/src/apply/applyChange.ts#L188) / `@` のパース: [parseStatePart.ts:40](../packages/state/src/bindTextParser/parseStatePart.ts#L40) / 区切り定義: [define.ts:33](../packages/state/src/define.ts#L33)
- Light DOM の `name` 必須: [State.ts:298](../packages/state/src/components/State.ts#L298) / 再接続時の名前再登録: [State.ts:476-480](../packages/state/src/components/State.ts#L476) / SSR の name: [State.ts:498-501](../packages/state/src/components/State.ts#L498)、[Ssr.ts:141-149](../packages/state/src/components/Ssr.ts#L141)
- 丸ごとマウントが no-op: [applyChangeToWebComponent.ts:32](../packages/state/src/apply/applyChangeToWebComponent.ts#L32)、[integration.bindComponentDelivery.test.ts:126](../packages/state/__tests__/integration.bindComponentDelivery.test.ts#L126)
- 橋渡し機構: [webComponent/README.md](../packages/state/src/webComponent/README.md)、[BindingSession.ts:996](../packages/state/src/bindings/BindingSession.ts#L996)、[isCacheable.ts:19](../packages/state/src/proxy/methods/isCacheable.ts#L19)、[wildcardLevel.ts](../packages/state/src/list/wildcardLevel.ts)
- DCC のセレクタ: [defineDCC.ts:50](../packages/state/src/dcc/defineDCC.ts#L50)
- ツール: [typescript/src/manifest.ts:24](../packages/typescript/src/manifest.ts#L24)、[wcsSchema.ts:4](../packages/typescript/src/cli/wcsSchema.ts#L4)、[testing/src/mount.ts:52](../packages/testing/src/mount.ts#L52)、[vscode-wcs referenceIndex.ts:100](../packages/vscode-wcs/src/core/index/referenceIndex.ts#L100)、[wcstack-manifest-schema.md:33](./wcstack-manifest-schema.md#L33)、[devtools-hook-protocol.md:86](./devtools-hook-protocol.md#L86)
- 実使用: [examples/router-i18n/index.html:260](../examples/router-i18n/index.html#L260)（`@i18n` 15 箇所）。state の `__tests__` で `<wcs-state name=` 21 箇所・`name=`/`@` を含むテストファイル 48・`stateName` を参照するテストファイル 76
- ベンチ: [e2e/bench/jsfb-verify.mjs](../e2e/bench/jsfb-verify.mjs)、[e2e/bench/memory-profile.mjs](../e2e/bench/memory-profile.mjs)
