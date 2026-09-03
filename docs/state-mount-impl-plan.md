# 実装計画: 名前付き State の廃止とマウントによるツリー拡張

- **状態**: 2026-09-01 起草。設計の正本は [state-mount-design.md](./state-mount-design.md)（以下「設計書」）。本書はその §3〜§9 を着手可能なタスク粒度・受け入れ条件・完了条件に展開した手順書。設計書の要確認 6 件のうち **D4（R1）/ D8（絶対参照なし）/ D11（ルート必須）/ 属性名 `mount` は 2026-09-01 に著者が決定**。**同日のアーキテクチャレビューで D19〜D22 が追加され、Phase 1 は R1 込み（D19）に改稿**。残る D12 は Phase 2 で確認する。**Phase 0 は完了**（§1-2）。**Phase 1 着手（2026-09-01）**。
- **届ける相手**: v2.0.0 の全利用者。Phase 1 だけは **v1.x の minor で先行出荷**する（非破壊・追加のみ）。
- **前提**: app-testing の積み上げ 7 本は **main 着地済み**（PR#214〜#219・2026-09-01 に `git branch --merged main` で確認）。Phase 2 以降はいつでも切れる。
- **ブランチ**: v2 は破壊的変更なので **統合ブランチ `v2`** に Phase 2〜5 の PR を向ける。**実際には Phase 1 がまだ main に無いため、`v2` は `feature/state-mount-phase0`（Phase 0+1 の先端）から `--no-track` で切った（2026-09-02）** — Phase 1 の契約テストの上で Phase 2 を書くため。Phase 0+1 の PR が main に入ったら `v2` に main を merge して追随する。Phase 1 と deprecation は main 向け。コミットは `git commit -F`。dist を生成したら**戻してからコミット**する。
- **バージョン**: v2.0.0 で**全パッケージを揃える**（設計書 D17）。新規パッケージは作らない。

---

## 0. 全体方針

### 0-1. Phase の順序とその理由

| Phase | 内容 | 向き先 | 依存 |
|---|---|---|---|
| **0** | 要確認の決着・ベースライン計測・受け入れマトリクス・目標構文の e2e ページ | main（docs） | — |
| **1** | `state: path` ルートマウントを**既存機構の上で**実装＋ deprecation warn | main（v1.x minor） | 0 |
| **2** | 単一ツリー化（絶対アドレス・chroot proxy・オーバーレイ・橋渡し機構の削除） | `v2` | 0, 1 |
| **3** | ボリューム `mount=` ＋ 名前次元の撤去 | `v2` | 2 |
| **4** | ツール・ドキュメント・examples・skill の追随 | `v2` | 3, 積み上げ 7 本の着地 |
| **5** | 計測・移行ガイド・リリース | `v2` → main | 4 |

**1 を 2 の前に置く理由**: 丸ごとマウントの**契約テスト**を既存機構の上で先に書くと、Phase 2 の書き直しがそのテストを緑に保つことで検証される。Phase 1 のコード自体は Phase 2 で消えるが、テストは残る。
**Phase 1 は R1 込み（D19）**: v1 機構の innerState は getter → マッピング → ローカルの順で、ルート規則は全キーをカバーするので、素直に載せると own key が全てツリーに隠される（R2）。同じマークアップが 1.x と 2.0 で逆に解決する無言の反転を避けるため、Phase 1 はルート規則を持つコンポーネントで own data key を先に見る（M14 / M15 を Phase 1 の受け入れに含める）。私有状態の寿命（D21）だけは v1 機構の要素寿命のまま — v1 の既存挙動なので 1.x では不変、2.0 で改善として扱う。
**3 を 2 の後に置く理由**: 名前を消すには名前付きテスト（21 箇所）の移行先が要り、それは `mount=`（Phase 3 のボリューム）である。ボリュームは Phase 2 の chroot proxy を使う。逆順にすると Phase 2 が `stateName` 配管を生かしたまま core を書き直す羽目になる。

### 0-2. 共通 DoD

各 Phase、触ったパッケージについて:

1. `npm test` green（既存テスト含む）
2. `npm run test:coverage` の閾値維持（100/97/100/100 が baseline）
3. `npm run lint` pass
4. `npm run build` が通る（dist は戻す）
5. **state core に触る Phase（1 / 2 / 3）**: `e2e/bench/jsfb-verify.mjs` が Phase 0 のベースラインに対して ±ノイズ内（設計書 D18）
6. テストは実装と同時に書く。記述は日本語。受け入れ条件は §7 のマトリクス ID を各タスクに付す
7. **回帰ゼロ**（設計書 §0-1 の前提条件）: §7-8 の ADR-15 → マトリクス対応表の各行に生き残るテストがある。機構のテストを消すときは、挙動を固定していたものを先に移植する（P2-0）

### 0-3. 3 度踏んだ罠を構造で塞ぐ（Phase 2 の設計規律）

ADR-15 §1.7 / §1.9 / nested-for §8.1 は全て「**別経路で流れる通知の順序違い**」だった。Phase 2 では:

- コンポーネントスコープのバインディングは、マウント表が確定するまで**登録しない**（保留）。暫定の接頭辞で登録してから直すことはしない
- バインディング初期化中の例外は `getBindingsReady` の reject に配管する（今日の規律を維持）
- 台帳は 1 本なので「親の通知と子の `for` が別経路」という形そのものが無くなる
- 私有キー・getter は予約セグメント付きの絶対アドレス（D20）に載せ、ルート handler の dispatch は予約セグメントを含む読み書きだけに掛ける — 最長接頭辞照会をあらゆる読みに掛けない
- スコープ根は親側の静的マークアップ（ホストの `state` / `state.*` エントリ）で決める（D7）。子の `<wcs-state bind-component>` の出現タイミングに依存しない

---

## 1. Phase 0 — 規約の確定とベースライン（docs・計測）

### 1-1. 決めること（設計書の要確認）

| # | 論点 | 決めないと止まる Phase |
|---|---|---|
| D4 | R1（own data key ＝ 私有）か R4（`$local` 宣言）か | 2 |
| D8 | コンポーネント内からの絶対参照 `/path` を 2.0 に入れるか | 2（入れるなら chroot proxy の 1 分岐） |
| D11 | ボリュームだけのページに暗黙ルートを許すか | 3 |
| D12 | `getBindingsReady` がマウント配下を待つか | 2 |
| D14 | SSR スナップショットを 1 ツリー 1 本にするか | 3（server） |
| 語 | 属性名 `mount`（`at` / `path` も候補） | 1（deprecation メッセージが指す語） |

### 1-2. タスク

| ID | タスク | 成果物 |
|---|---|---|
| P0-1 | ~~設計書の要確認 6 件を決め、§0-2 の「状態」列を更新~~ **済み（2026-09-01）**: D4=R1 / D8=不可 / D11=ルート必須 / 語=`mount`（設計書 §0-2・§10 反映済み）。D12 は Phase 2 の P2-4、D14 は Phase 3 の P3-9/P3-10 で確認 | 設計書 |
| P0-2 | [state-cross-state-read-design.md](./state-cross-state-read-design.md) の状態行に「本設計（state-mount-design.md）で閉じた」を追記 | docs |
| P0-3 | ~~ベースライン計測~~ **済み（2026-09-01・main `99ae8afb` の dist・ローカル Chromium・`e2e/bench-results/` は gitignore なので数値はここに記録）**。jsfb（`jsfb-verify.mjs`、keyed 判定 true・recycledOnRun 1000）: create1k **32.1 ms** / replace1k 19.55 / update10k 12.9 / select1k 0.1 / swap1k 0.8 / remove1k 2.8 / append1kTo10k 53.6 / clear10k 58.8。heap（`memory-profile.mjs`、MB）: ready 0.98 / run1k 5.65 / replace5 6.23 / update5 5.93 / creation10k 35.82 / clear10k 13.21。Phase 5 はこの値と比較する（同じマシン・同じコマンド） | 本書 |
| P0-4 | ~~list-component ベンチの新設~~ **済み**: [`e2e/bench/list-component.mjs`](../e2e/bench/list-component.mjs) ＋ [`packages/state/__e2e__/benchmark-component/`](../packages/state/__e2e__/benchmark-component/index.html)（jsfb ページの行を `bind-component` コンポーネントに置き換えたもの。ホスト側は計測時点では v1 の `state.row: .`。**Phase 1 の P1-12 で `state: .` に切り替え済み** — 以後の before / after は §2-2 の同一セッション比較で取る）。計測は create1k / update（行 990 の label）/ select（行 2 への行フィールド書き込み）/ swap / clear と heap（ready / run1k / update5 / clear1k、`--big` で creation10k）。**ベースライン値は下の「P0-4 ベースライン」** | JSON |
| P0-5 | ~~目標構文の e2e ページ~~ **済み**: [`e2e/fixtures/mount-root.html`](../e2e/fixtures/mount-root.html)（`state: user; state.theme: theme`）/ [`mount-row.html`](../e2e/fixtures/mount-row.html)（`for` の行に `state: .`＋中の `for`）/ [`mount-light.html`](../e2e/fixtures/mount-light.html)（Light DOM・name 無し・行にも置く）/ [`mount-volume.html`](../e2e/fixtures/mount-volume.html)（`mount="i18n"`・ルートより先に配置）、spec は [`e2e/tests/state-mount.spec.ts`](../e2e/tests/state-mount.spec.ts) の 13 件。**全件 `test.fixme` で止めてあり**（red を main に入れない）、理由文字列に外す Phase を書いてある（Phase 1: mount-root / mount-row、Phase 2: mount-light、Phase 3: mount-volume） | HTML ＋ spec（fixme） |
| P0-6 | ~~`__e2e__` / examples の名前使用箇所の精査~~ **済み（2026-09-01）**: `__e2e__` に `<wcs-state name=` は無し。examples は `router-i18n/index.html` の `name="i18n"` 1 箇所 ＋ `@i18n` 15 箇所のみ（他の `@` は `@keyframes` / `@media` / `@wcstack`）。残る精査対象は README（英・日）と `__tests__`（§9） | 本書 §9 |
| P0-7 | §7 の受け入れマトリクスを確定 | 本書 |

### 1-3. P0-4 ベースライン（list-component・2026-09-01・main `99ae8afb` の dist・ローカル Chromium）

`node bench/list-component.mjs --label before-mount`（timing は median of 5、heap は median of 3、ページエラーゼロ）。比較用に同じマシンで同時刻に取った plain jsfb（P0-3）を並べる。

| 計測 | plain jsfb（`benchmark/`） | 行＝コンポーネント（`benchmark-component/`） | 比 |
|---|---|---|---|
| create1k | 32.1 ms | **106.5 ms**（min 101.7 / max 147.6） | ×3.3 |
| update（every 10th row field） | 12.9 ms（10k 行） | **3.0 ms**（1k 行） | — |
| select（行フィールド書き込み 2 本） | 0.1 ms | **0.3 ms** | ×3 |
| swap | 0.8 ms | **1.4 ms** | ×1.8 |
| clear | 58.8 ms（10k） | **8.2 ms**（1k） | — |
| heap ready | 0.98 MB | 0.97 MB | — |
| heap run1k | 5.65 MB | **13.13 MB** | +7.5 MB ≒ **7.5 KB / 行コンポーネント** |
| heap update5 | 5.93 MB | 13.38 MB | |
| heap clear1k | —（clear10k 13.21） | **12.32 MB** | clear 後もほぼ保持（プール ＋ 行ごとの台帳） |

読み方: 行コンポーネント 1 つあたり **≈ 75 µs の生成コストと ≈ 7.5 KB のヒープ**が、inner/outer proxy・MappingRule・相乗り台帳・子 state 要素の分として上乗せされている。Phase 2（単一ツリー化）はこの差分を削る対象で、Phase 5 の P2 / P3 はこの表と比較する。plain 側（P1 / P4）は不変がゲート。

**完了条件**: 要確認ゼロ（D12 / D14 は実装 Phase へ送った）。ベースライン値が本書にある。e2e 目標ページが fixme で存在する。→ **2026-09-01 達成**（ブランチ `feature/state-mount-phase0`）。

---

## 2. Phase 1 — `state: path` ルートマウント（v1.x・非破壊）

**狙い**: 今日 no-op の `data-wcs="state: user"` を「丸ごとマウント」として成立させる。既存の MappingRule の上で最小差分で実装し、**契約テストを残す**。同時に deprecation を仕込む。

### 2-1. タスク

| ID | タスク | 場所 | 受け入れ |
|---|---|---|---|
| P1-1 | ~~プライマリ規則に「内側パスが空（ルート）」を許す~~ **済み（2026-09-01）**: `IMappingRule.isRoot`。`propSegments.length === 1` をルート規則として `buildPrimaryMappingRule` に載せ、派生は `outer + inner` の連結。`applyChange` の 1 セグメント除外を撤去（残余空がルート規則の意味を持ったため）。**完了前の初期適用**: 宣言済み（`markWebComponentStatePropDeclared`）なら書かない、宣言前に走ったら置き換え前のオブジェクトを控えて子の初期化で戻す（`webComponent/preCompletionWrites.ts` — happy-dom は template clone が upgrade 済みで挿入前に適用が走るため必須） | `webComponent/MappingRule.ts`、`apply/applyChange.ts`、`completeWebComponent.ts`、`preCompletionWrites.ts`、`State.ts` | M1, M2 |
| P1-2 | ~~親→子の再読込通知~~ **済み**: 残余パスが空なら子の登録済みパス（`IStateElement.boundPaths`）の先頭セグメント全部へ `$postUpdate`（`webComponent/rootReloadPaths.ts`）。再接続の読み直しも同じ集合 | `apply/applyChangeToWebComponent.ts`、`State.ts` | M3 |
| P1-3 | ~~`state: .` を shorthand 展開に通す~~ **済み（確認のみ）**: `expandShorthandInStatePart` は単独の `.` を `<forPath>.*` に展開するので無改造で通る | `structural/expandShorthandPaths.ts` | M4 |
| P1-4 | ~~root 規則と部分規則の併用と重複検出~~ **済み**: 導出は最長接頭辞一致（部分規則が勝つ）。同じ内側パスを 2 つの規則が指す形は構築時に throw | `MappingRule.ts` | M5, M6 |
| P1-5 | ~~子の `for` がルートマウント配下の配列を回す~~ **済み**: `state: .`（行）＋ 子 `for: tags` と `state: group` ＋ 子 `for: children` の形を固定。配列そのものをルートにマウントする形は Phase 2 | 既存 §1.8 機構 | M7 |
| P1-6 | ~~deprecation（D16 改稿）~~ **済み**: `src/deprecation.ts`。`name` 属性（`bind-component` は除く）／`@` を含むパスのパース時に **`config.debug` 下で 1 回**（種別 × 対象）。既定では出さない | `deprecation.ts`、`components/State.ts`、`bindTextParser/parseStatePart.ts` | N0 |
| P1-7 | ~~lint / vscode-wcs: `wcs/named-state-deprecated`~~ **済み**: `service/namedStateValidator.ts`（warning）。`name` 属性値・`data-wcs` の `@name`・mustache の `@name` を指す。Light DOM の `bind-component` は除く。`@default` は「外せ」。フィルタ引数の `@` は対象外。lint パッケージのスモーク 13 件緑 | `vscode-wcs/src`（13 ファイル → 5 ファイル） | T0 |
| P1-8 | ~~README（英・日）~~ **済み**: 「Whole-object Mount（`state: path`）」節を Host Usage の直後に追加、Named State 節に deprecation 告知、Loop with Components に `state: .` | README ×2、`src/webComponent/README.md` | — |
| P1-9 | ~~テスト~~ **済み**: `integration.bindComponentDelivery.test.ts` の no-op を反転。新設 `integration.bindComponentRootMount.test.ts`（M1〜M5・M7・M10・M13〜M17・P1-11）＋単体 8 本。state 2652 件緑・カバレッジ 99.54 / 98.56 / 100 / 99.75 | `__tests__` | M1–M7, M14–M16 |
| P1-10 | ~~R1 on v1（D19）~~ **済み**: `innerState._isPrivateKey`（先頭セグメントで判定・部分規則が覆うキーは除く）。`ownKeyShadow.ts` がバインド時に `[wcs/mount-own-key-shadow]` を 1 回（タグ × プロパティ × キー） | `webComponent/innerState.ts`、`ownKeyShadow.ts`、`bindWebComponent.ts` | M14, M15 |
| P1-11 | ~~部分マウントと own key の衝突~~ **済み**: 既存挙動不変・予告 warn 1 回。完了前の積みで注入されたキーは作者のものとして扱わない（`preCompletionWrites.recordInjectedKey`） | `ownKeyShadow.ts`、`apply/applyChangeToProperty.ts` | N0 |
| P1-12 | ~~中間計測~~ **済み**: `benchmark-component/` を `state: .`（中は `id` / `label` / `selected`）に切り替え。数値は §2-2 | `e2e/bench`、`__e2e__/benchmark-component` | P2 |

**完了条件**: 共通 DoD。P0-5 の `mount-root` / `mount-row` e2e が green（fixme を外す。`mount-light` / `mount-volume` は fixme のまま）。jsfb ±ノイズ内。→ **2026-09-01 達成**（e2e 8/8 green・Chromium。数値は §2-2）。

### 2-2. Phase 1 の計測（2026-09-01・ローカル Chromium・同一セッション A/B）

P0 のベースライン（§1-2 P0-3・§1-3）は別セッションの値で、create1k のサンプルは 18〜56 ms と広い。実測するとこのセッションは全体に遅く（jsfb ×1.25 前後）、別セッション比較はゲートにならない。ゲート判定は**同一セッションの A/B** で行った。

**jsfb（plain・D18 / P1 のゲート）**: `git stash push -u -- src` → build → 計測 ×2 → pop → build → 計測 ×2 で HEAD（Phase 0 まで）と Phase 1 の dist を交互に計測。

| ms | HEAD dist（run1 / run2） | Phase 1 dist（run1 / run2） |
|---|---|---|
| create1k | 39.25 / 40.0 | 40.15 / 40.85 |
| replace1k | 15.25 / 14.35 | 14.35 / 14.75 |
| update10k | 12.85 / 10.05 | 12.4 / 12.35 |
| append1kTo10k | 48.6 / 49.3 | 60.35 / 53.4（単独計測では 47.15〜61.95 に分散） |
| clear10k | 70.45 / 70.35 | 68.25 / 73.6 |

→ 全項目 ±ノイズ内。**P1 ✓**（plain のホットパスに載ったのは `applyChangeToProperty` の typeof 判定 1 つと `parseStatePart` の `indexOf('@')` だけ）。

**list-component（P1-12・同じ Phase 1 dist でページ形だけ A/B）**: 旧形 `state.row: .`（P0-4 の形）と新形 `state: .`（ルートマウント）。timing median of 5 / heap median of 3。

| 計測 | 旧形 `state.row: .` | 新形 `state: .` |
|---|---|---|
| create1k | 173.5 ms | **167.7 ms** |
| update | 4.5 | 4.4 |
| select | 0.4 | 0.4 |
| swap | 2.1 | 2.2 |
| clear | 11.2 | 10.9 |
| heap ready / run1k / update5 / clear1k | 0.98 / 13.26 / 13.52 / 12.46 | 0.98 / **13.26** / 13.52 / 12.4 |

→ **ルートマウント固有のコストは無い**（むしろ create1k は僅かに速く、heap は同一）。P0-4 の 106.5 ms との差は全てマシン状態。**Phase 2 の before はこの §2-2 の形（同一セッションで新旧を交互に取る）で取り直す**こと — 別セッションの絶対値比較はしない。

---

## 3. Phase 2 — 単一ツリー化（v2 core）

**狙い**: 設計書 §5。台帳を 1 本にし、橋渡し機構を削除する。この Phase では `name` はまだ残す（トップレベルのみ）。

### 3-0. 実装方式（2026-09-02・着手時に確定した機構）

不変条件「マウントされたコンポーネントのバインディングは、その位置にテンプレートを展開して接頭辞を付けたものと区別できない」を**文字どおり実装する**: 解決サイト（proxy / updater / walk / applyChangeToFor / getValue）を書き換えるのではなく、**バインディングそのものを登録時に親ツリーの形へ変換**し、既存機構をそのまま流用する。

1. **パース時の接頭辞合成**: マウントされたスコープの `collectNodesAndBindingInfos` は MountRecord を受け取り、各 `IBindingInfo`（ノードごとのオブジェクト。パース結果キャッシュは無接頭辞のまま）の `statePathName` / `statePathInfo` / `stateName` を §4-1 の規則で書き換える — getter / own data key → `<prefix>.#<id>.<key>`（D20 の予約セグメント）、それ以外 → 最長接頭辞一致で `<outer>.<rest>`。以後この binding は「親スコープにインラインで書かれた binding」と**同一の形**になり、台帳・依存グラフ・キャッシュ・LIS・プールは無改造で正しく動く。
2. **台帳のエイリアス登録**: 子スコープの rootNode（ShadowRoot）に対し `setStateElementByName(shadowRoot, parentName, parentStateElement)` 相当のエイリアスを張る（buildBindings の初回登録トリガと衝突しない形にする）。`getRootNode()` を使う全ての解決サイト（`getAbsoluteStateAddressByBinding` / `applyChangeFromBindings` / `applyChange`）が無改造で親 state element に到達する。
3. **ループ文脈の境界ホップ**: `getLoopContextByNode` が「マウントされた ShadowRoot」に達したら `shadowRoot.host` から歩き続ける（マウント記録があるときだけ）。ホスト行の listIndex [i] が子スコープに継承され、内側の `for` が [i, j] を作る — v1 の crossBoundaryAddress / baseListIndex（Δ 帳簿）はこれで丸ごと不要になる。
4. **オーバーレイ dispatch（D20）**: 親 handler の getByAddress / setByAddress は `stateElement.hasMounts && path に '#'` のときだけマウント記録を引き、私有キーは privateObject を読み書き、getter は chroot proxy を `this` に評価する（pushAddress 下なので依存エッジは親のグラフに載る＝素の wildcard getter と同じ機構）。
5. **`$n` の Δ 補正**: マーカーを含むパスの評価中は、そのマウントの Δ（接頭辞のワイルドカード数）を足して読む（設計書 §4-4 の「この 1 箇所だけが Δ を知る」）。
6. **chroot proxy（公開面）**: `element.state` は「相対キー → 変換済みパス文字列」の薄い翻訳で、読み書きは親の proxy を通す。`$` API は §4-6 の表どおり接頭辞を合成して親 API へ委譲する。

保留登録（P2-4 / D12）は「マウント記録が確定してから子スコープの walk を始める」ことで実現する（変換に必要な情報が揃うまで collection 自体を始めない — 暫定登録→修正はしない）。

#### 3-0-1. スライス進捗（v2 ブランチ・2026-09-02）

- **slice 1 済み**（`c4f79a5e`）: マウント記録（P2-2 相当）＋変換規則＋登録簿＋変換フックの配管（collect / structural / initializeBindings）。
- **slice 2 済み**（`34f58ac4`）: オーバーレイ dispatch（P2-6 相当・getByAddress の 1 点）＋chroot 公開面＋`$n` の Δ 補正（trap / 変換時）＋境界ホップ（loopContextByNode）。
- **slice 3 済み**: State.ts の配線。**ルートエントリ（`state: path` の 1 セグメント規則）を持つ Shadow DOM マウントだけが v2 経路**に乗る。部分マウントのみの形と Light DOM は v1 機構のまま（次スライスで P2-0 の仕分けと同時に移行）。RootMount 統合テスト（M1〜M17）は全て v2 経路で緑。

slice 3 で確定した挙動・発見:

1. **再初期化耐性**: `connectedCallback` で shadow の `innerHTML` を張り直すコンポーネントでは、再接続のたびに新しい `<wcs-state>` が同じ shadowRoot に入る。マウント記録は **(component, stateProp) 単位で再利用**（マーカー安定＝親側の登録簿・getterPaths が再接続で増えない）、`setStateElementAlias` は同一要素なら冪等、旧スコープは `BindingSession.dispose()` で捨てて組み直す。await 中に剥がされた `<wcs-state>` はスコープを触らず退場する（`_mountRecord` だけ立てて v1 の `_initialize` に落ちないようにする）。
2. **applyChangeToFor の白紙ガード**: `lastListValue` はアドレスキーの共有台帳なので、まだ何も描いていない binding（content 台帳が空）が描画済みアドレスに後から参加すると、差分が「既存 content の再利用」を指示して落ちる。**自分の content 台帳が空の binding は共有記録を無視して全行 add で描く**。マウント再初期化だけでなく、後着ノードの binder 適用の同型も直る一般ガード。
3. **remount 経路（shadow を一度だけ組む形）**: 同じ `<wcs-state>` の再接続は `BindingSession.rebindAddresses()`（台帳の張り直し＋ `for` の lastListValue を旧→新アドレスへ引き継ぎ）→ `applyChangeFromBindings`。再接続の connectedCallback は親の行ループ中に同期発火し、新しいループ文脈は直後の activateContent が張るため、**張り直しは queueMicrotask に遅らせる**。
4. **has の意味論**: 親 proxy の has は生オブジェクトの `Reflect.has` なので、翻訳後の複数セグメントパスを `in` で聞くと常に偽。オーバーレイ／公開面の has は **v1 innerState と同じ「規則が解決するか」**で答える（ルートマウントでは未知キーも真）。
5. **v2 マウントの `<wcs-state>` は独立ツリーを持たない**: 名前登録・state ロード・`$connectedCallback` / `$watch` / `$streams` を行わない（`$` 面の翻訳は P2-9・設計書 §4-6）。`applyChangeToWebComponent` は v2 マウントには no-op（配送は静的依存＋単一台帳が担う — v1 の再読込通知チャネルはこの経路では不要）。
6. **実欠陥の修理（v1 から潜在）**: 初期化前の `<wcs-state bind-component>` が disconnect されると `_callStateDisconnectedCallback` の `createState` が "_state is not initialized" で CE リアクションごと落ちていた。初期化前ガードを追加。
7. **カバレッジ**: slice 2 時点の 99.04 / 97.67 / 99.44 / 99.28（stmt/br/fn/line）→ slice 3 で **99.41 / 98.13 / 100 / 99.65**（全指標改善）。global 閾値（99.5/98.5/100/99.5）にはまだ届かない — ブランチ既知の負債で、P2-7 の v1 機構削除で地形が変わるためそこで締め直す。
8. **jsfb A/B（同一セッション・P2-11 の途中経過）**: before/after で符号がまちまち（append/clear は非接触なのに −20%）＝マシンノイズ支配。回帰なし。keyed 不変条件（runNewNodes 0・recycledOnRun 1000）維持。

- **slice 4 済み**: 部分マウントのみの Shadow DOM 形も v2 経路へ（ゲートは「ホスト配線が 1 本でもあるか」だけに）。Light DOM は引き続き v1。P2-0 のテスト仕分けを同時に実施 — Delivery / ListRow / NestedFor / DepthN / RowReplace / watch.bindComponent / P1-11 を v2 の意味論へ移植（既定値を落とす＝D19 の移行そのもの）。DepthN の N 枚接ぎ木（Δ>0 込み・50 本）が**特別扱いゼロ**（翻訳の合成だけ）で全緑 — v1 が §1.11/§1.12 で個別修理した多段は、v2 では構成的に成立する。

slice 4 で確定した挙動・発見:

9. **完了前の積みの抑止を部分規則へ一般化**: `skipPendingRootMount` → `skipPendingMountWrite`。宣言済みなら `state.x: path` の完了前適用も書かない（書くと厳格 R1 の privateSnapshot が親の値で汚染される）。積みが残るのは未宣言の窓だけ。
10. **宣言前の窓の上書き控え**: happy-dom は template clone を upgrade 済みにするため、fragment 内の初期適用は宣言より先に走る。既存キーの上書きは `rememberOverwrittenValue` で作者の値を控え、v2 のマウント構築が snapshot 前に復元する（`preCompletionWrites.ts`）。新規キーは従来どおり injectedKeys（→ツリー）。
11. **混在パスの既知制約**: 親側にワイルドカードが乗る部分マウントでは、内側の具体添字パス（`items.0.name` → `groups.*.children.0.name`）は「文脈と添字の混在」でエンジンが受けない。行フィールドの子側書き戻し・スコープ相対のイベント添字（getScopedIndexes）・`$getAll`/`$resolve` の接頭辞翻訳は **P2-9 に it.fails でピン留め**（ListRow 1 本・NestedFor 3 本）。
12. **カバレッジ**: slice 4 で 99.19 / 97.91 / 99.9 / 99.45 — slice 3 から微減（innerState 等の v1 機構の行使者が Light DOM だけになった）。slice 2 ベースラインは全指標で上回ったまま。P2-7 の削除で解消する。

- **slice 5 済み（P2-9a — $ 呼び出し面）**: $getAll / $setAll / $resolve / $postUpdate の接頭辞翻訳を chroot（element.state）とオーバーレイ（getter / メソッド内の this）の両面に実装。作者のスコープ相対 indexes の先頭に、翻訳で増えたワイルドカード分の文脈添字を合成する（mount.ts composeMountIndexes）。イベントハンドラの添字もスコープ相対化 — 翻訳された for のループ要素パス → shift の台帳（record.indexShiftByLoopElementPath・translateParsedForMount が埋める）を handler.ts が引き、台帳に無いループ文脈（境界ホップで借りた外側の行）は作者から見えない＝0 本。slice 4 の it.fails ピン 4 本（ListRow $getAll・NestedFor $resolve 書き戻し ×2・イベント添字）を全て反転。

  **P2-9b（未着手）**: $watch / $streams / $listKeys / $updatedCallback の相対宣言（マウントされた <wcs-state> は現状 $ 宣言を実行しない — slice 3 の 5 項）。宣言面はマウント構築時に相対→絶対でルート台帳へ登録する設計（§4-6 の表）。

- **slice 6 済み（P2-10 の前半 — 実ブラウザ e2e）**: e2e フィクスチャ 7 枚を D19 移行（既定値落とし）。**実ブラウザだけで出た実欠陥を 1 件修理** — text binding は登録前に comment が replaceNode へ差し替えられて切断される（bindings/replaceToReplaceNode.ts）ため、スコープ直下のバインディングは DOM walk でループ文脈に届かない。happy-dom は切断後も parentNode を残す非準拠で偶然通っていた。修理＝スコープ構築が行 content の初期化と同じく**直接エントリ**で文脈を渡し（buildMountScopeBindings が getLoopContextByNode(component) を initializeBindings へ）、remount 時は forEachActiveBindingNode で張り替える。マウント系 e2e 40 本＋広域 state e2e 16 本 green（fixme 5 本＝mount-light Phase 2 と mount-volume Phase 3）。jsfb keyed 不変条件維持。

- **slice 7 済み（P2-11 の list-component A/B — v2 の性能ペイオフ実測）**: 同一セッションで feature/state-mount-phase0（v1 機構＋Phase 1 の state: .）と v2 slice 6 をブランチ切替でビルドし比較。行コンポーネント（benchmark-component・1000 行）:

  | op | v1 (Phase 1) | v2 (slice 6) | Δ |
  |---|---|---|---|
  | create1k | 169.4 ms | **128.6 ms** | **−24%** |
  | update | 4.0 ms | **2.2 ms** | **−45%** |
  | select | 0.5 ms | 0.4 ms | −20% |
  | swap | 2.2 ms | 2.2 ms | ±0 |
  | clear | 10.6 ms | **7.5 ms** | **−29%** |
  | heap run1k | 13.26 MB | **11.84 MB** | **−1.42 MB** |

  橋渡し機構（innerState の再帰解決・通知チャネル・Δ 帳簿）を通らないことがそのまま数字になった。plain 行（jsfb）は不変（ゲート維持）。v1 機構の削除（P2-7）前でこの値 — 削除後に再計測する。

- **slice 8 済み（Light DOM マウントの v2 化）**: v2 ゲートを「ホスト配線が 1 本でもある bind-component」全形へ拡張。スコープ根は Shadow DOM 形＝shadowRoot／Light DOM 形＝コンポーネント要素自身（D7）。Light DOM はエイリアス不要（rootNode をホストと共有・翻訳が stateName を親に揃えるので @name 参照も自然に無効化）、ホスト走査からの除外は §1.13 の prune がそのまま担う。**name 必須は v1 の plain 形にだけ残る**（data-wcs 無し＝plain は従来位置で fail-fast、data-wcs ありはホスト配線判明後に検査）。e2e mount-light の PHASE2 fixme 2 本を解除 — L1/L2/L3 実ブラウザ green。e2e 計 51 green（残 skip は mount-volume の Phase 3 ピン 3 本のみ）。カバレッジは 98.53/97.31/99.09/98.78 に低下 — **v1 機構（innerState / MappingRule 派生 / crossBoundary / Δ 帳簿 / 通知チャネル）が最後の行使者を失った**ための想定内の谷。直後の P2-7 削除で回復させる。

- **slice 9 済み（P2-7 — v1 機構の削除）**: **−3,618 行**。削除＝innerState / MappingRule / crossBoundaryAddress / outerListPath / baseListIndex（Δ の帳簿・呼び出し側は素の listIndex に inline）/ rootReloadPaths / BindingSession の outerPattern 相乗り（§1.8/§1.11）/ State.ts の mapped 系（_hasMappedComponentState・_reloadMappedPathsAfterReconnect・_initializeLightDomComponentScope・boundPaths・bindProperty・hasRootNode）/ isCacheable・pathDiagnostics・getByAddress・setByAddress の mapped 分岐 / loopContext の Δ パラメータ / ownKeyShadow の v1 警告。**残すもの**＝plain 形（配線なし state 注入）の bindWebComponent + outerState + meltFrozenObject + stateElementByWebComponent（縮小）。applyChangeToWebComponent は「完了済みへの適用は意図的 no-op」だけの姿に。機構テスト 8 ファイル削除・4 ファイルを v2 の契約へ移植。2589 unit 緑・e2e 35 緑・**functions 100 / lines 99.62 復帰**。statements 99.38 / branches 97.88 は slices 1-2 由来のプローブ残債＋横断モジュールの行使喪失（binder / twowayHandler / Ssr / deferred-spread 等）— 仕上げのカバレッジ専用スライスで閉じる。wildcardLevel の末尾起点 slice は**削除しない**（スコープ相対の添字切り出しが v2 でも使う）。

- **slice 10 済み（カバレッジの全ゲート復帰）**: **99.56 / 98.52 / 100 / 99.76 — global 閾値（99.5/98.5/100/99.5）を全て回復**（v2 ブランチで初）。手段＝境界プローブの追加（オーバーレイのシンボル/then/非 base・$ ラッパの文脈なし/indexes 省略/読み形 readonly・preCompletionWrites の控えの往復・接尾なしアクセサとマーカー先頭のシフト・ssr-snapshot 読み手の形検査・binder の既バインド判定・handlerBindingRegistry の重複/部分解除・nameless Light DOM の unit 版・異マーカー素通り）＋**死んだ分岐の除去**（Light name 検査の到達不能な hasAttribute 操作数・noMountEntryMessage の "none" 腕・applyChangeToProperty の完了後ガード＝ルーティング不変条件で到達不能）。**happy-dom で覆えないもの**＝遅延定義の成功経路（scheduleDeferredSpreads の callback・BindingSession の waiting-definition 昇格）— happy-dom は既存要素の upgrade ができない。実ブラウザの正は e2e/state-deferred-apply.spec。rebindAddresses の pattern 腕（2 行）も未カバーのまま（構築に混在パスが要る稀形）。

- **slice 11 済み（P2-12 — ドキュメント）**: webComponent/README.md を v2 機構（不変条件・6 点の機構・R1 と積み・再初期化/プール・Light DOM・削除の経緯と性能）に全面書き直し。ADR-15 §0 の実装表に「Phase 2 slice 9 で機構ごと削除（挙動は単一ツリーの上で成立）」の supersede 注記。packages/state README（英・日）の部分マウント注記を v2 の実挙動（厳格 R1・nameless Light DOM・$ API の語彙翻訳）に更新。

- **slice 12 済み（P3-1/P3-2/P3-3 の中核 — ボリューム `mount=`）**: `<wcs-state mount="path">` の接ぎ木を実装（webComponent/volume.ts）。機構＝①データ（own key の部分木）はルートの書き込み proxy 経由で接ぎ木（通知・依存展開は通常の書き込み）②アクセサは**ルート state オブジェクトの quoted-path アクセサ**（`"i18n.t"`）として defineTreeAccessor — ワイルドカード getter と同じ機構に乗るので pushAddress 下で評価され依存がグラフに載る。`this` は chroot（receiver 翻訳・$postUpdate/$getAll/$setAll/$resolve は接頭辞翻訳）③$connectedCallback は chroot で実行（V7）。D22＝接続時にスロット予約（予約下の読みは 1 セグメントも深いパスも undefined・pathDiagnostics 沈黙・getByAddress のルート欠落 raise も予約下は素通り）。ルート登録（default）が保留ボリュームを microtask で引き取る（ロード順非依存・V5）。衝突（D3/D22 両方向）と接ぎ木失敗は 1 ボリュームに隔離（console.error — connectedCallback 内 throw の永久未解決化を避ける）。深いマウントは中間 {} を作成。**e2e state-mount 全 13 本 green（PHASE3 fixme 3 本解除・スペックの fixme はゼロに）**。未了＝$watch/$streams/$listKeys の接頭辞登録と $updatedCallback（相対）＝宣言面（P2-9b と同じ束・下記）、メソッドのツリー露出、深いマウントの親を丸ごと書く形の throw、アンマウント（切断後も接ぎ木は残る）。

  **P2-9b/P3 宣言面の設計メモ（著者確認）**: コンポーネントマウントの $watch は「同一翻訳パスに複数インスタンス」が本質的（行コンポーネント）— 現在の watchRegistry は Map<path, entry> なので**多重エントリ化**と**インスタンス絞り込み**（自分の行の変更だけ受ける？＝D21 と同じ向きなら Yes）が要る。$streams はデータがツリーに落ちるため**複数インスタンスの書き込み衝突**が起きる（行ごとの stream は何処に書く？）。ボリューム（単一インスタンス）はどちらの問題も無いので、宣言面はボリューム→コンポーネントの順で入れるのが安全。

  **P3-4 名前撤去の設計メモ（著者確認・着手前に要決着）**: **plain 形の Light DOM bind-component**（ホスト配線なし・state 注入だけ）は今日 name 必須＝名前空間で上位スコープと分離している。P3-6 で登録簿を rootNode→単数にすると、この形は「共有 rootNode に 2 つ目の独立ツリー」を置けなくなる。候補＝(a) plain light は廃止（Shadow DOM を使うか、ホスト配線を 1 本足してマウントにする）(b) コンポーネント要素自身をスコープ根にした独立ツリーとして残す（マウントと同じ D7 の判定だが「配線ゼロでも wcs-state bind-component があればスコープ根」に広げる — ホスト走査の除外規則が属性静的でなくなる点に注意）(c) name をこの形だけの互換シムとして残す（DoD の grep=0 と矛盾）。決まるまで P3-4〜P3-6 は着手しない。

  **著者決定（2026-09-03）**: 宣言面＝推奨どおり（ボリュームに実装・コンポーネントは非対応 warn）。plain Light DOM＝**廃止（a）**。

- **slice 13 済み（宣言面 — 著者決定①の実装）**: ボリュームに $watch（相対宣言→翻訳してルート台帳へ**追記**。watchRegistry にボリューム別台帳・同一パス多重可・ハンドラは chroot 包装・computed の prime 込み）／$listKeys（翻訳して mergeVolumeListKeys — 衝突は throw）／$updatedCallback（相対配送 — proxy/apis/updatedCallback が接頭辞で選別し相対パス＋スコープ添字で chroot 呼び出し・収集ゲートは enableUpdatedCallback）／$disconnectedCallback（切断時に chroot・接ぎ木は残る）。$streams は未対応のまま loud に raise（status 名前空間の設計が別途要る — 残課題）。コンポーネント側＝$watch/$streams/$listKeys/$updatedCallback は実行せず **(tag,prop) 1 回の warn**（`wcs/mount-dollar-declaration`・v1 mapped も元々非対応＝退行なし）。**$connectedCallback / $disconnectedCallback はスコープごとに実行**（this=公開 chroot・接続ごと・例外/reject 隔離。連鎖切断中は親セッションが先に死ぬためツリー読みは失敗しうる — 隔離どおり）。罠 2 件＝import 連鎖（updatedCallback→volume→watchRuntime→**updater 循環**）を volumeShared.ts（軽量共有面: 予約・chroot・ucb 台帳・保留キュー+graft ハンドラ注入）で切断／headless の行 watch は **S13 のピンどおり $listKeys が要る**（for 無しの配列代入では発火しない）。2645 unit 緑・e2e 13 緑・カバレッジ全ゲート緑（99.53/98.56/100/99.73）。

- **slice 14 済み（plain Light DOM の廃止 — 著者決定②の実装）**: 配線なし（ホストに `state[.sub]: path` が 1 本も無い）Light DOM の bind-component は **raiseError**（誘導文＝「shadow を付ける（plain Shadow 形・$ 宣言込み）」か「ホストから配線してマウント」）。name 属性の有無は無関係（name 必須の旧検査 2 箇所を廃止エラーに置換）。**巻き添え防止**＝`_failInitialization`（initializePromise 等を解決してから raise — 未解決のまま投げると waitForStateInitialize がページ全体を無言でウェッジする。`_initialized` は立てない — 切断時の後始末が未ロード state を触らないよう初期化前ガードに掛けたまま）。e2e＝専用ページ bind-component-light-dom-plain-removed.html（loud エラー＋同居 mapped が無傷）を新設し、共有フィクスチャから plain を除去（loud エラーが同居テストの errors=[] 断定を汚すため分離が必須）。これで **name の最後の消費者が消え、P3-4〜P3-6（名前撤去・登録簿の単数化）が開通**。

- **slice 15 済み（name 面の撤去 — P3-4/P3-5 の宣言面）**: `name` 属性は **fail-fast**（`_failInitialization` — 誘導文＝`mount="<旧名>"` に置き換えて `<旧名>.<path>` で読む）。バインド文の `@name` は **parse error**（parseStatePart — 同じ誘導）。deprecation 機構（src/deprecation.ts + テスト）は削除、`_initialize` から名前読み取り・警告を撤去（内部の `_name`='default' と stateName 配管は Phase B＝slice 16+ で撤去）。テスト移行＝SSR 9 ファイルの `name="default"` 一括剥がし＋named ケース 2 件を nameless へ移植／parser・spread・devtools・initializeBindings・components.State は raise ピンに転換／volumeMount の複合テストから他 state 腕を除去（その選別は Phase B で stateName 配管ごと消える）／lightDom 統合テストと DSD は nameless 化（DSD のスコープ分離はシャドウ境界がネイティブに担う — named ケースは raise ピンへ）。e2e＝light-dom フィクスチャ 2 枚を nameless 移行（plain-removed は name があると name raise が先勝ちするため nameless 必須）・state 系 64 spec 全緑。2636 unit 緑・lint 緑・カバレッジ全ゲート緑（99.53/98.53/100/99.73）。既知＝webComponent.bindWebComponent.test.ts の unhandled rejection 2 件は HEAD 由来の既存（$stateReadyCallback エラー経路・slice 15 無関係）。

- **slice 16 済み（登録簿の単数化 — P3-6）**: `stateElementByNameByNode: WeakMap<Node, Map<string, IStateElement>>` → `WeakMap<Node, IStateElement>`。API＝`getStateElement(root)` / `setStateElement(root, el|null)` / `setStateElementAlias(root, el)`（name 引数消滅）。2 つ目の `<wcs-state>` は **raise**（「1 root 1 ツリー — 追加は mount= で」）。保留ボリュームの引き取りは無条件（name==="default" ゲート消滅）。fragmentInfoByUUID は参照を 1 回に巻き上げ（per-name 再解決とノード側 raise 分岐は名前次元と一緒に消えた — テスト 1 本削除で 2635 本）。src 呼び出しサイトは codemod（括弧対応の引数スプリッタ）で 18 ファイル・テスト 71 ファイル一括変換。残修理＝name キーの vi.mock 7 ファイル（rootNode キー化＋detached サブツリー用に document フォールバック）／per-name 分岐のピン 6 本を単一登録簿の意味論へ移植（apply の stateName 分割は「同一要素で createState 2 回」に転換 — 配管ごと slice 17 で消える）。devtools イベントの name は "default" 固定（プロトコル形は維持・名前撤去は devtools 追随と一緒に）。2635 unit 緑・lint 緑・カバレッジ全ゲート緑（99.53/98.55/100/99.73）・state e2e 64 spec 全緑。

- **slice 17 済み（stateName 配管の全撤去 — P3-4/P3-5 の内部面）**: 型から削除＝IParsedBinding/IBindingInfo・IAbsolutePathInfo（stateElement 参照が正）・IApplyContext・IStateHandler・StateHandler(_stateName/createStateProxy 第3引数)・MountRecord.parentStateName・walkDependency 第1引数・STATE_NAME_SEPARATOR（@ 検査 2 箇所は "@" 直書きで存置 — parse error / watch 宣言 raise は v2 のピン）。所属判定は全て **stateElement の同一性**（updatedCallback の他ツリー ref は `path@name` 合成でなく**配送しない**へ変更）。apply のグループ分割・handler 台帳キー・propagation wire 識別・BindingSession の重複キーから name 次元を削除（分割は rootNode 境界のみ）。manifest から delimiters.stateName を削除（**vscode-wcs/lint 追随がリリース前に必要**）。devtools フック protocol から name/stateName を全削除（summary の name・keys/read/write の name 引数・全イベント payload — **packages/devtools の追随は別スライス P3-14**）。token の ownerStateName・pathDiagnostics/各 raise の文面も root 語彙へ（「No state tree found on this root …」）。stateElementByWebComponent/outerState の "stateName" は実は bind-component プロパティ名だったので stateProp へ改名。expandShorthandPaths の @ 分岐も撤去（@ は下流で loud に死ぬ）。テスト移行＝codemod 3 本（walkDependency 先頭引数・createStateProxy 第3引数・stateName 行/断定の一括除去 69 ファイル 124 行）＋名前意味論のピン 10 数本を「別ルート」意味論へ移植（apply 分割・updatedCallback 除外・wire 同一性・devtools payload）。死んだピン 2 本削除（fragmentInfo の per-node name miss・sameRootVerified の name 不一致フォールバック）。**DoD 達成＝`grep stateName|STATE_NAME_SEPARATOR` が src でゼロ**。2634 unit 緑・lint 緑・カバレッジ全ゲート緑（99.53/98.52/100/99.73）・state e2e 64 spec 全緑。

- **slice 18 済み（DCC セレクタ・SSR クライアント側の name 撤去 — P3-8/P3-9/P3-10）**: DCC の `stateTagSelector` から `:not([name])` を撤去（name 属性は存在しない — あれば fail-fast）・警告文と dcc/README を追随。SSR＝`Ssr.name` getter と `ISsrElement.name` を削除／`Ssr.findByName(root, name)` → `Ssr.find(root)`（最初の `<wcs-ssr>`）／buildSsrDocument・State の inline 生成から name 属性の付与と名前照合を撤去（冪等性検査＝「直前が wcs-ssr かどうか」だけ）。**旧 server が生成する `name="default"` 付きスナップショットも v2 クライアントは読める**（find は属性を見ない — ssr-router e2e 5 spec 緑で実証）。P3-10＝server パッケージは名前非依存を確認（プロトコルのみ・作業ゼロ。既存の waitForReady 反復回数テスト 1 件の失敗は HEAD でも再現する別問題）。テスト＝findByName 系 4 本を find へ移植・Ssr name getter テスト 2 本削除・orchestrated「別名なら生成」を「直前に先客が居れば生成しない」へ転換・DCC 警告テストは「state 無し」構成へ。2632 unit 緑・lint 緑・カバレッジ全ゲート緑（99.53/98.54/100/99.73）・state+ssr e2e 69 spec 全緑。

- **slice 19 済み（examples/router-i18n の mount 移行 — P3-13）**: `<wcs-state name="i18n" src="/i18n/state.js">` → `mount="i18n"`・バインド 15 箇所を `t.…@i18n` → `i18n.t.…` 接頭辞形へ・README（英/日）と各コメント追随。app.js は `i18n` キーを宣言していないので衝突なし。ボリュームが root（app.js の無名 state）より文書順で先だが保留キュー（V5）が吸収。**router-i18n e2e 11 spec 全緑（WCS_LOCAL=1 で作業ツリー dist を検証）**・state+ssr-router+router-state-params+router-a11y 計 80 spec 全緑。Phase B の残＝P3-14（packages/devtools のフック protocol 追随）のみ。

- **slice 20 済み（packages/devtools のフック protocol 追随 — P3-14・Phase B 完了）**: protocol/types.ts を state 側の鏡として name/stateName 全撤去（summary の name・keys/read/write の name 引数・全イベント payload・IAbsolutePathInfoLike は stateElement: unknown へ）。DevtoolsCore＝台帳キーから名前次元を削除（pathKeyOf(path)/tokenKeyOf(kind,name)/attachKeyOf(path,prop)）・**roster は rootLabelOf(rootNode) 由来のラベルで識別**（document／`<host-tag>`・重複は #n）・自己除外機構（RESERVED_STATE_NAME_PREFIX / hiddenStateNames / isHiddenStateName / hidden-states 属性）を機構ごと削除（v2 の panel は vanilla DOM で自分の state を持たない — 名前が無い以上、名前による自己識別も成立しない）。declaredScan の @name 分解も撤去（パス素通し — 壊れた宣言の可視化はランタイムの parse error）。shell＝セレクタと各行の `@name` 表示を撤去・選択キーは sourceId+label。テスト＝名前次元の scaffolding を identity（addressOf は stateElement: 旧名文字列）へ・hidden 系テスト 6 本削除・空バッチ／ShadowRoot ラベルのカバレッジテスト 2 本追加。e2e devtools-smoke の `count@default` 断定を v2 形へ。119 unit 緑・lint 緑・カバレッジゲート緑（100/98.47/100/100）・SMOKE OK。**Phase B（P3-4〜P3-14）完了 — 名前次元は runtime/protocol/tooling の全レイヤーから消滅**。

- **slice 21 済み（SSR × ボリューム — P3-9 残・D14 の採用）**: ルートが enable-ssr スナップショットから初期化されたら `State.hydratedFromSsr` が立ち、graftVolume は**スロットに既存値があれば採用**（データを接ぎ木せず・衝突検査を掛けない — モジュールは getter / $ 宣言のためロード済み）。スナップショットに部分木が無ければ通常どおり接ぎ木・非 hydrate の衝突は従来どおり raise。スナップショットへのボリュームデータ混入は**自然に成立**（接ぎ木は raw state への通常書き込み・quoted-path アクセサは enumerable:false で extractStateData に出ない）。ボリュームの enable-ssr は warn 付きで無視（D14: ルートに集約）。**発見・修理＝ボリューム初期化の設定エラー（予約衝突等）が initializePromise をウェッジさせていた** — _failInitialization と同じ規範で resolve してから throw。予約はドキュメントどおり切断後も維持（アンマウント未対応の帰結 — テストはパスを分ける）。unit +5（ssr.volume.test.ts）・2637 全緑・lint 緑・カバレッジ全ゲート緑・mount+ssr e2e 18 spec 緑。server 側（P3-10）は作業なしで成立（スナップショット生成は state 側のプロトコル実装）。

- **slice 22 済み（@wcstack/testing の name 撤去 — P4-4）**: `state(name?)` → `state()`。引数を渡すと**移行ヒント付き throw**（「mount= に載せて接頭辞で読む」）。ルート選択は「`mount` / `bind-component` 属性の無い最初の `<wcs-state>`」（ボリュームと bind-component 内側は対象外）。README（英/日）の表を v2 形に（mount()=DOM / mount==state の 1 行区別込み）。名前付きテスト 1 本を API エラーのピンへ転換。**罠＝ローカル symlink 先の committed dist が古く 9 件落ちる**（server の waitForReady 不在・router/state の鮮度）— server/router/state を再ビルドすると 14/14 緑（CI は実行前に stale dist を再ビルドする）。dist は戻してコミット。

- **slice 23 済み（vscode-wcs / lint の name 撤去 — P4-1/P4-2）**: positionalParser から `@` 字句と stateNameRange を撤去（正本パーサが @ で throw → problems 経由で error 表示）。referenceIndex の索引キー (stateName, path) → path・referencesOf/declarationOf は path 単引数。htmlParse は `stateName` → `mountPath`（mount 属性）。**候補はマウント接頭辞で単一ツリーに合流**（statePathResolver がボリューム候補へ `<mountPath>.` を前置・$ 名前空間はマウント越しに表現できないので落とす — runtime と同型）。stateAnalyzer/PathCandidate から stateName 次元を除去・mergeSchemaCandidates は path キー。wiringLens は接頭辞ベース（hover の state 名表示を撤去・src 未解析フォールバックは「resolved がその要素の守備範囲（ルート全体／mount 接頭辞下）かつ範囲に候補ゼロ」）。補完＝@ 後は出さない（bindingContext から stateName kind を撤去）。namedStateValidator は **error 昇格＋runtime と同じ文言**（bind-component の除外も撤去 — v1 の Light DOM name 必須は消えた）。messages（ja/en）を「撤去済み」表現へ。P4-2＝lint 再ビルド 14/14 スモーク緑（**named-state-deprecated の error severity を契約ケースとして追加** — #183 型のドリフト封じ）。manifest-state-collision と sidecar states[name] の形は P4-3（schemaVersion 2）で処理。vscode-wcs 631 テスト全緑・esbuild 緑。

- **slice 24 済み（manifest schemaVersion 2 — P4-3）**: application namespace は **単一 `stateSchema`**（states[name] 撤去・envelope/namespace version = 2）。`wcs-schema` は `--state` → **`--mount=<path>`**（ボリュームの型を既存 stateSchema の**部分木として merge** — 中間 object ノードを生成。`--mount` 指定時は --merge 無しでも既存を読み込む）。`--state` は移行ヒント付き usage エラー。check は v1 manifest（schemaVersion 1 / states 形）を **v1-manifest** として検出し「emit で再生成」を指す。emit の再生成は v1 の states を持ち越さない（正本は型 — D9）。読み手側（vscode-wcs）＝SUPPORTED_SCHEMA_VERSION/NAMESPACE 2・schemaVersion 1 のエラーに移行ヒント併記・**manifest-state-collision は単一スロットの衝突として存続**（「2 つの application artifact が両方 stateSchema を宣言 → 勝者なし」— 計画の「削除」からの意図的乖離: 名前キーは消えたがスロット衝突は実在する）・applicationStates(Map) 連鎖を applicationSchema(単数) へ（loader/discover/validate/runValidation/validateDocument/bindingValidator/templateSyntaxValidator/mergeSchemaCandidates）。lint スモークの manifest fixture も v2 形へ（14/14 緑）。wcstack-manifest-schema.md §2/§3/§5 を v2 に改稿。typescript 56/56・vscode-wcs 630/630 緑・両ビルド緑。

- **slice 25 済み（README・docs の追随 — P4-6/P4-7/P4-9）**: state README（英/日）＝原則 #2 と層テーブルを「ホストが書くマウント表」へ・「Named State」節を「Mounting Additional State（mount=）」に全面差し替え（v1 からの移行文込み）・構文リファレンスから `@state` 行を撤去・spread の @ 伝播 → 素パス・shorthand 表の @ 行削除・ の越境注記を「@ を含む宣言は raise」へ・**Light DOM 節を v2 形に書き換え**（name/@ 不要・ホスト配線必須・plain 廃止の誘導文・行配置可）。docs 追随＝i18n-design D4（@i18n → mount 済み注記）・state-watch-hook-design D8・state-set-all-design・device-orientation-tag-design の @ 記述・webComponent/README の @name 注記。examples/README に name 参照なし（P4-9 は対象なしを確認）。

- **slice 26 済み（devtools hook protocol v2 — P4-5）**: `DEVTOOLS_PROTOCOL_VERSION` を **2** に（state 側・devtools 側の両方 — 形が非可換に変わったので version で正直に主張）。**`overlays(rootNode)` を新設**（D20 の可視化 — マーカー `#m<id>` ごとに componentTag/stateProp/マウント表(inner→outer)/Δ/私有キー/getter キーを要約。実体は mount.ts の `getMountRecordsForStateElement`）。docs/devtools-hook-protocol.md（英/日）の keys/read/write 形と version を v2 に更新。devtools-smoke の version 断定を 2 へ。integration.mountOverlay に overlays の実測テスト（マウント有り/無し）。state 2638・devtools 121・SMOKE OK・カバレッジ全ゲート緑。


- **slice 27 済み（after 計測 — P5-1/P5-2）**: 設計書 §7 に after 表・§5-5 を実測へ置換。**高速化＝成立**（list-component create1k 169.4→128.6ms −24%・update −45%、全 Phase 後確認 125.6ms）。**メモリ＝成立**（行コンポーネント heap run1k 13.13→11.59MB ≒ −1.5KB/行）。**plain 不変＝成立**（jsfb 同一セッション A/B で v2 側が全指標同等以上: create 40.6→37.75 / replace 22.8→15.5 / clear 73.9→70.1。memory-profile ±2%。**絶対値は当日のマシン状態で ±20% 揺れる — 判定は必ず同一セッション A/B で**）。**「core 正味 −750 行」＝不成立を正直に記録**（src 正味 +1,339: ボリューム 469 行が新機能・厳格 R1 私有面 203 行が新規。橋渡し層の全廃 −1,327 と台帳 1 本化＝構造の主張は成立）。

- **slice 29 済み（2026-09-04・レビュー（code-review 7 観点）の blocking 8 件の修理）**: レビューの実測検証＝unit 5 パッケージ・e2e 116 spec（実 Chromium）・カバレッジ実測は全て主張どおり緑。その上で見つかった blocking を修理:
  1. **CI 赤 ①**: `webComponent.bindWebComponent.test.ts` の reject 系 2 テストが raiseError-in-catch の unhandled error で `npm test` を exit 1 にしていた（**slice 15 の「HEAD 由来の既存」は誤記** — main 版は throw-in-catch を明示回避しており、v2 の書き直しが導入したもの）。raiseError モックを記録型にしてメッセージ断定へ（報告経路の固定は強化）。→ state 2648 全緑・exit 0。
  2. **CI 赤 ②**: `packages/server/__tests__` が未移行（**slice 18 の「server 作業ゼロ」は src のみの話で、テストが `wcs-ssr[name=]` セレクタ・`name=` fixture・1 root 2 state のまま** — 再ビルドした v2 dist に対して 10 件赤）。v2 形へ移行（nameless ヘルパ・「name 属性なし」ピン・root＋volume の D14 集約ピン・動的追加は `mount=` へ）。→ server 94/94 緑（waitForReady の既知 1 件も stale dist 起因だった — 再ビルドで緑）。
  3. **Light DOM のイベント添字**（D9/§4-4 違反・実測 `[0,1]`）: event/handler.ts の記録解決が rootNode キーのみで、Light DOM のスコープ根（コンポーネント要素自身）を引けなかった。`findMountRecordForNode`（祖先走査・hasMounts ゲート内）を新設して Shadow/Light の意味論を揃えた。回帰テスト 2 本（inner-for＝スコープ相対 1 本・スコープ直下＝0 本）。
  4. **マウント記録のリーク**: `mountRecordsByStateElement` の内側 Map が強参照で解除経路なし → 恒久破棄（route swap / if）した要素＋Shadow サブツリーが親 state 要素の寿命で蓄積。**WeakRef 化＋FinalizationRegistry**（`cleanupCollectedMountRecord` — マーカーエントリと親 getterPaths への追加分 `addedGetterPaths` を回収）。記録の強参照は要素キーの WeakMap だけ＝記録は要素と同寿命（プール再利用は従来どおり）。読み手（getMountRecordByPath / 列挙）は deref＋遅延 prune。
  5. **D11/V6 実装**: ルート無しボリュームが無言 no-op だった → パース完了後（loading 中は DOMContentLoaded 待ち）に「ルート候補（mount/bind-component なしの `<wcs-state>`）の要素が無ければ」`console.error` 1 回（throw は connectedCallback 内で初期化待ちを永久未解決にするため不可 — graftIsolated と同じ規範。設計書 §4-7 に実装注記）。検査は要素の存在＝ルートの src ロードの遅さで誤検知しない。
  6. **D22 後段実装**: 接ぎ木済みスロットの**真の祖先**の丸ごと書きは setByAddress が throw（`hasGraftedVolumes` boolean ゲート＝D18 の形・`recordGraftedSlot`/`findGraftedSlotUnder`）。スロット自身・配下は従来どおり。graft 前の中間 `{}` 生成は接ぎ木前なのでガード外（台帳を予約と分けた理由）。
  7. **protocol 文書の v2 追随**: docs/devtools-hook-protocol.ja.md（`keys(name, rootNode)`・stateName payload 全面）と英語版の stateName 残存 9 箇所を出荷形（types.ts）に一致させ、`overlays` / `IMountOverlaySummary` を両言語に記載。
  8. **wcstack エントリ README**: 文法行の `[@state]` と Paths 表の `path@cart` / `name="cart"` 行を v2 形（`mount=` 接頭辞）へ（AI 作法の正本 — ここが v1 構文を教えると生成コードが最初の一手で fail-fast する）。
  検証＝state 2648（+10: 回帰テスト）・server 94・e2e mount/light-dom 系 green（下記）・カバレッジ/バラン維持。非 blocking の指摘（mount 属性変更の warn なし・N6 の mustache/shorthand 経路テスト・stale docs 群 ほか）はレビュー記録のとおり残し、リリース後に回す。

- **slice 30 済み（2026-09-04・「v2 同乗候補」5 件の検証と採択分の実装）**: 指摘 5 件を検証し 2 件を実装・3 件は根拠付きで不採択:
  1. ~~`<stateProp>: <path>`（propSegments 長 1）の bind 時 fail-fast~~ — **不採択（v2 本体が解消済み）**。ADR-15 が見送った当時の前提「`state: user` は無言の no-op」が v2 で消滅 — その形は**ルートマウントの正規構文**（M1）になり、誤設定系は loud（重複規則 throw・plain Light DOM raise・4b throw・name raise）。残る applyChangeToWebComponent の no-op は「配送は翻訳済みバインディングが担う」正しい意味論で、fail-fast の対象が存在しない。
  2. **`@wcstack/server` の deprecated `extractStateData()` 削除 — 採択・実装**。消費者は server 自身のテストと README の API 表のみ（`Ssr.extractStateData` が state 側の正）。関数・export・テスト 6 本・README 英日の表行を削除。リリースノートの破壊的変更表に追記。
  3. ~~`_upgradeProperty` の全パッケージ展開~~ — **不採択（前提が古い＝展開済み）**。`7775d8bf` "fix(shell): adopt inputs assigned before the element upgrades"（main / v2 双方に含まれる）で **39 パッケージ**に `src/protocol/upgradeProperties.ts`＋テスト＋Shell 配線が着地済み。未対応 5 つ（state / signals / devtools / server / vscode-wcs）は wc-bindable I/O ノードではない（要素なし or wcBindable 非宣言）。
  4. **semver・破壊的変更ポリシーの表明 — 採択・実装**。ルート README 英日に「Versioning and breaking changes」節（対象＝data-wcs 構文・wcBindable ほかプロトコル・ツール契約／対象外＝内部・文言・性能／deprecation 運用）。§10 に転記用の節を追加。
  5. ~~spread undefined 書き戻しの SPEC 明文化~~ — **リポ内は済み・残りは別リポ**。規範リファレンス（per-package README）の英日 :483 に「undefined は書き込みスキップ・クリアは null・全プロパティバインディングに適用」が規範文として存在（$setAll 側 :1027 も同旨）。残るのは **wc-bindable-protocol リポジトリの SPEC.md への規範文言追加**のみで、持ち込み用提案文書は [docs/spec-proposal-undefined-write-skip.md](./spec-proposal-undefined-write-skip.md) に完成済み（MUST NOT / null クリア / SHOULD 防御・clarification 扱い推奨）— リリース時の skill 追随と同じユーザー操作バケット。
  ついで＝server の waitForReady 反復テストの**既知フレークを修理**（slice 18 で「HEAD でも再現」と記録されていた実体＝残世代待ちの固定 30ms sleep が並列負荷で不足 → 上限付きポーリング化。修理後フルスイート 4 連続 88/88 緑）。

### 3-1. タスク

| ID | タスク | 場所 | 受け入れ |
|---|---|---|---|
| P2-1 | **スコープ登録簿**: `scopeRoot → IStateElement \| MountRecord`。スコープ根は**ホストの `data-wcs` に `state` / `state.*` エントリがある要素**（D7・親側の静的判定）。`getSubscriberNodes` はその判定でサブツリーを除外する。ノードからの解決は、rootNode にスコープ根が無ければ `getRootNode()` に短絡（D18）、あれば祖先走査 1 回で binding に持つ | `stateElementByName.ts` → `scopeRegistry.ts`（新）、`bindings/getSubscriberNodes.ts`、`binding/getAbsoluteStateAddressByBinding.ts` | L1, L2, L4 |
| P2-2 | **マウント記録**: `(component, stateProp) → { id, rootElement, mountTable: [{ innerPrefix, outerPathInfo }], privateSnapshot, overlays }`。ホストの `state[.sub]: path` から構築。最長接頭辞一致。`privateSnapshot` はバインド時の own data key の浅い複製（D21） | `webComponent/mount.ts`（新）、`bindWebComponent.ts`（改稿） | M5, M6 |
| P2-3 | **絶対アドレス化**: `BindingSession.registerAddress` が接頭辞合成済みの絶対パスで台帳登録を 1 回行う。`outerPatternPathInfo` / `outerPatternPathInfosRest` を削除。listIndex はホストのループ文脈チェーン（Δ の帳簿を持たない） | `bindings/BindingSession.ts` | M8, M9, M10 |
| P2-4 | **保留登録**: コンポーネントスコープのバインディングはマウント記録の確定まで保留。確定で一括登録。`getBindingsReady(root)` は保留が解けるまで待つ（D12） | `BindingSession.ts`、`stateElementByName.ts` | R1, R2, R3 |
| P2-5 | **chroot proxy**: 設計書 §4-1 の規則。`element.state` はこれ自身。getter 評価の receiver。私有キー・getter は `<mountPath>.#<id>.<key>` に翻訳（D20）。部分マウントだけで一致しないキーは throw（§4-1 の 4b）。`$` API の接頭辞翻訳（§4-6）と `$n` の Δ 補正 | `webComponent/chrootProxy.ts`（新）、`proxy/apis/*`、`list/wildcardLevel.ts` | M11, M12, M13, M20 |
| P2-6 | **オーバーレイ表とルート dispatch**: `(mountPathInfo, listIndex) → overlay`。ルート handler は `hasMounts` かつパスが予約セグメントを含むときだけ委譲する（D20）。私有キーは privateObject、getter は chroot proxy を `this` に評価。エントリは listIndex と同寿命（D21）— `for` の差分で作成・破棄、要素の付け替えは対応の更新だけ。R1 の warn（マウント先の値がオブジェクトで同名キーを持つ） | `proxy/methods/getByAddress.ts` / `setByAddress.ts`、`webComponent/overlay.ts`（新）、`pathDiagnostics.ts` | M14, M15, M16, M21 |
| P2-0 | **テストの仕分け**（P2-7 の前に）: `webComponent.*.test.ts` / `integration.bindComponent*.test.ts` / `applyChangeToWebComponent.test.ts` を「挙動（新 API へ移植して残す）」「機構（削除）」に分ける。§7-8 の対応表の各行に生き残るテストを 1 つ以上対応させる | `__tests__` | §7-8 |
| P2-7 | **削除**: `innerState` / `outerState` / `MappingRule`（派生部）/ `crossBoundaryAddress` / `outerListPath` / `baseListIndex` / `applyChangeToWebComponent` / `hasMappedComponentState` 分岐 ×6 / `isCacheable` の mapped 例外 / `_reloadMappedPathsAfterReconnect` / `wildcardLevel` 末尾起点 | `webComponent/`、`proxy/`、`components/State.ts` | 既存テスト緑（P2-0 で移植済みのもの） |
| P2-8 | **行プール再利用**: コンポーネントの行バインディングが素の入れ子 `for` と同じ経路で付け替わることをテストで固定（§1.9 の形・§1.12 の Δ>0 の形・3 枚境界の §1.11 の形） | `__tests__` | M17, M18, M19 |
| P2-9 | `$updatedCallback` がスコープ相対で届く／`$watch` `$streams` `$listKeys` が絶対で登録される | `watch/`、`stream/`、`list/listKeys.ts` | M12 |
| P2-10 | e2e: `component` / `list-component` / `single-component` / `mount-root` / `mount-row` / `mount-light` green。`states-population` 等の既存ページは無改造で green | `__e2e__` | — |
| P2-11 | ベンチ: jsfb ±ノイズ、list-component ベンチで退行ゼロ（改善は数値を記録） | `e2e/bench` | P1, P2 |
| P2-12 | `webComponent/README.md` を新機構の説明に書き直す。ADR-15 §0 表の「実装」列を「廃止（state-mount）」に | docs | — |

**完了条件**: 共通 DoD。`webComponent/` が設計書 §5-5 の見積り（≈300 行）に収まる、または差分の理由が README に書いてある。

### 3-2. 実装順（P2 内）

P2-1 → P2-2 → P2-5（chroot が無いと何も動かない）→ P2-3 → P2-4 → P2-6 → P2-0（仕分け）→ P2-7（削除は最後。テストが緑のまま消せることを確認しながら）→ P2-8 / P2-9 → P2-10 / P2-11 → P2-12。

---

## 4. Phase 3 — ボリューム `mount=` と名前次元の撤去（v2）

### 4-1. タスク

| ID | タスク | 場所 | 受け入れ |
|---|---|---|---|
| P3-1 | **ボリューム**: `mount` 属性のパース（静的パスのみ・`*` は throw）。ロード完了で接ぎ木（`root[mountPath] = obj`。深いマウントは中間 `{}` を作る）。getter / setter / `$watch` / `$streams` / `$listKeys` を接頭辞付きでルート台帳に登録。getter の `this` は chroot proxy。接ぎ木前の読みは予約下として `undefined`・診断無し（D22） | `components/State.ts`、`defineState.ts`、`webComponent/chrootProxy.ts`（再利用）、`pathDiagnostics.ts` | V1–V5, R5 |
| P3-2 | ボリュームの初期化順序（D22）: 接続時にスロットを**予約**。ルートロード時に予約済みスロットがルートデータにあれば throw、ボリューム接続時にルート済みで同名キーがあれば throw。接ぎ木時に `mountPath` 起点の更新通知。ルート無しで終わったら throw（D11）。ルート側からマウントポイントを含む親を丸ごと書けば throw | `scopeRegistry.ts` | V4, V6, R4 |
| P3-3 | ボリュームの `$connectedCallback` / `$updatedCallback`（相対）。`enable-ssr` はルートに集約（D14） | `components/State.ts` | V7 |
| P3-4 | **名前の撤去**: `name` 属性・`@` パース（`parseStatePart` / `expandShorthandPaths` / `expandSpread` / `{{ }}`）・`STATE_NAME_SEPARATOR`・`IParsedBinding.stateName`・`IAbsolutePathInfo.stateName`・`IApplyContext.stateName`・`StateHandler.stateName`・`updatedCallback` の `path@name`・`processWatchDeclaration` の `@` 検査・manifest `delimiters.stateName`・devtools bridge の `name` payload | src 40 ファイル | N1–N6 |
| P3-5 | `@` を含むパスは **parse error**（移行ヒント付き）。`name` 属性は **throw**（`mount` を指す） | `parseStatePart.ts`、`State.ts` | N1, N2 |
| P3-6 | 登録簿を `rootNode → IStateElement`（単数）に。「already registered」を「ルートが 2 つ」に文言変更 | `scopeRegistry.ts` | N3 |
| P3-7 | Light DOM `bind-component` の `name` 必須を撤去（[State.ts:298](../packages/state/src/components/State.ts#L298)）。`getSubscriberNodes` の除外と `_initializeLightDomComponentScope` は P2-1 のスコープ根で置き換わっていることを確認 | `State.ts`、`bindings/getSubscriberNodes.ts` | L1–L3 |
| P3-8 | DCC: `stateTagSelector` から `:not([name])` を落とす | `dcc/defineDCC.ts` | — |
| P3-9 | SSR（state 側）: `<wcs-ssr>` から `name` を落とし、rootNode 単位に。`Ssr.findByName` → `Ssr.find(root)`。スナップショットに接ぎ木済みボリュームの**データ**を含める。hydrate ではボリューム要素がモジュールをロードし、データはスナップショットの部分木を採用（接ぎ木せず・衝突検査を掛けない・D14） | `components/Ssr.ts`、`hydrateBindings.ts`、`components/State.ts` | S1, S2, S4 |
| P3-10 | SSR（server 側）: `renderToString` / `installGlobals` の名前依存を除去。ボリュームのデータをスナップショットに含める | `packages/server` | S3 |
| P3-11 | **テスト移行**: `<wcs-state name=` 21 箇所 → `mount=`、`@name` → 接頭辞。`stateName` を参照するテスト 76 ファイルの型追随 | `__tests__` | — |
| P3-12 | e2e: `mount-volume` green。既存の `__e2e__` ページは名前を使っていないので移行対象なし（P0-6）— 無改造で green を確認 | `__e2e__` | — |
| P3-13 | `examples/router-i18n`: `name="i18n"` → `mount="i18n"`、`@i18n` 15 箇所 → `i18n.` 接頭辞。Playwright 20/20 を維持 | examples | — |

**完了条件**: 共通 DoD。`grep -rn "stateName\|STATE_NAME_SEPARATOR\|'@'" packages/state/src` がゼロ。全 e2e green。jsfb ±ノイズ。

---

## 5. Phase 4 — ツール・ドキュメント・examples・skill

### 5-1. タスク

| ID | タスク | 場所 | 受け入れ |
|---|---|---|---|
| P4-1 | `vscode-wcs`: `@` の字句・`stateNameRange`・索引キー `(stateName, path)` → `path`・`manifest-state-collision` の削除。`wcs/named-state-deprecated` を v2 では error（parse error と同じ文言）。R1 なら「私有キーがマウント先を隠す」診断（`stateSchema` ＋ ホストのマウントパスから静的に） | `packages/vscode-wcs/src`（13 ファイル） | T1, T2 |
| P4-2 | `@wcstack/lint`: core の再ビルド。契約テスト（severity）の追随 | `packages/lint` | T1 |
| P4-3 | `@wcstack/typescript`: manifest `states[name]` → 単一 `stateSchema`、`schemaVersion: 2`。`wcs-schema --state` → `--mount=<path>`（ボリュームの型を部分木として merge）。`check` は v1 manifest（`schemaVersion: 1` / `states`）に移行ヒント。[wcstack-manifest-schema.md](./wcstack-manifest-schema.md) の §3 と衝突規則を更新（D15。1.x の初回 publish は `states[name]` のままでよい） | `packages/typescript`、docs | T3 |
| P4-4 | `@wcstack/testing`: `state(name?)` → `state()`（name 指定は error）。README で `mount()`（DOM）と `mount=`（state）を 1 行で区別 | `packages/testing` | T4 |
| P4-5 | devtools hook protocol v2: `keys(rootNode)` / `read(rootNode, path)` / `overlays(rootNode)`（マウント記録と私有キーの列挙 — D20 の可視化）、イベント payload、予約接頭辞規範の廃止。bridge とスモーク（`e2e/devtools-smoke.mjs`） | `docs/devtools-hook-protocol.md`、`state/src/devtools/` | T5 |
| P4-6 | `@wcstack/state` README（英・日）: 原則 #2 を「ホストがマウント表を書く」に。Named State 節 → Mount 節。Light DOM 節から `name`。「Choosing a Component Mechanism」。`$` blank-out 注記。`getBindingsReady` 注記。移行ガイド（設計書 §9-1） | README ×2 | T6 |
| P4-7 | docs の追随: [i18n-design.md](./i18n-design.md) D4、[examples-uncovered-combos.md](./examples-uncovered-combos.md)、[state-set-all-design.md](./state-set-all-design.md)、[state-watch-hook-design.md](./state-watch-hook-design.md) D8、[state-named-wildcard-index-design.md](./state-named-wildcard-index-design.md)、[device-orientation-tag-design.md](./device-orientation-tag-design.md) の `@stateName` 記述 | docs 6 本 | — |
| P4-8 | `wcstack` エントリ README（AI 向け作法）と wcstack-skill の references（`data-wcs` 構文・bind-component）。plugin version 2.0 | 別リポジトリ | — |
| P4-9 | examples: README の `bind-component` 例を `state: path` に。`examples/README.md` | examples | — |

**完了条件**: 各パッケージの共通 DoD。vscode-wcs の契約テスト（lint severity）が v2 の文言で green。

---

## 6. Phase 5 — 計測・移行ガイド・リリース

| ID | タスク | 受け入れ |
|---|---|---|
| P5-1 | after 計測: jsfb / list-component / memory-profile。設計書 §7 の表を実測値で埋める | P1–P4 |
| P5-2 | 設計書 §5-5 の見積りを実測（`wc -l`）で置き換える | — |
| P5-3 | リリースノート v2.0.0: 破壊的変更（`name` / `@` / SSR / devtools protocol / manifest / testing API）、移行ガイド、成立する範囲を明記した性能記述 | — |
| P5-4 | バージョン揃え 2.0.0（全パッケージ・`wcstack` エントリ・ピン版数 5 箇所・skill） | — |
| P5-5 | `v2` → main のマージと release.yml 実行（ユーザー操作） | — |

---

## 7. 受け入れマトリクス

### M — コンポーネントマウント

| ID | 条件 |
|---|---|
| M1 | `<c data-wcs="state: user">` の中で `text: name` が `user.name` を表示する |
| M2 | 中で `value: name` に入力すると `user.name` が変わり、親スコープの `text: user.name` が更新される |
| M3 | 親が `this.user = {...}` で丸ごと差し替えると中の全バインドが更新される |
| M4 | `for: users` の行で `<c data-wcs="state: .">` が行をマウントし、`users.2.name` の書き込みが行 2 の中だけを更新する |
| M5 | `state: rows; state.theme: theme` の併用で、`theme.mode` が中の `theme.mode` に見える |
| M6 | `state: a; state.x: b; state.x: c` は throw する |
| M7 | `state: group` の中で `for: children` を回し、親の `group.children` の追加・削除・並べ替え・行フィールド書き込みが届く |
| M8 | 3 枚の境界（コンポーネントの中のコンポーネントの中のコンポーネント）を越えて行フィールド書き込みが届く。台帳登録は各バインディング 1 回（テストで登録回数を数える） |
| M9 | 中間コンポーネントが親の `for` の中にいる（Δ>0）形で、内側の `for` が回る |
| M10 | 絶対パスのワイルドカード数 ＝ listIndex 段数（`items.*.children.*` で 2） |
| M11 | 中の `$1` はスコープ内の添字（ホストが行 3 にいても、内側 `for` の行 0 で `$1 === 0`） |
| M12 | 中の `$updatedCallback` には相対パスだけが届く。`$getAll("children.*.x")` が中から動く |
| M13 | `element.state.name` の read / write が chroot と同じ意味論（M1 / M2 と同値） |
| M14 | R1: 中の state オブジェクトの own data key `editing` はツリーに載らず、インスタンスごとに独立（**Phase 1 から**。Phase 1 は要素ごと） |
| M15 | R1: `state = { name: "" }` ＋ `state: user`（`user.name` あり）で `console.warn` が 1 回出る（**Phase 1 から**） |
| M16 | 中の getter `get upper()` が `this.name` を読み、`user.name` の変更で再評価される（依存が絶対アドレスで張られる） |
| M17 | 行 content のプール再利用: 行を差し替えた後もその行のコンポーネントが親起点の行フィールド書き込みを受け取る（§1.9 の形） |
| M18 | 切断 → 再接続を跨いで値が最新になる（専用の再読込を持たずに） |
| M19 | plain（ホストに `state:` 無し）は独立ツリーとして今日と同じに動く |
| M20 | 部分マウントだけ（`state.theme: theme`・ルートマウント無し）のコンポーネントで、どの接頭辞にも含まれないキーの読み書きは throw する（§4-1 の 4b） |
| M21 | 行コンポーネントの私有キー: swap では行に付いて回り、行の差し替えでは初期値に戻り、親スコープの `text: users.*.editing` からは見えない（D20 / D21） |

### V — ボリューム

| ID | 条件 |
|---|---|
| V1 | `<wcs-state mount="i18n" src>` の後に `text: i18n.t.x` が辞書を表示する |
| V2 | ボリュームの getter の `this.lang` が `i18n.lang` を読み、`i18n.lang` の変更で再評価される |
| V3 | ルートの getter が `this["i18n.t.x"]` を読み、依存が張られる（クロス state 読み取りが要らないことの証明） |
| V4 | `mount="a.b"`（深い）と `mount="items.*"`（throw）と ルートに `i18n` があるときの throw |
| V5 | ロード順: ボリュームが先に接続されても、ルートが先でも同じ結果 |
| V6 | ルート無し ＋ ボリュームのみ → throw（D11） |
| V7 | ボリュームの `$connectedCallback` が chroot で呼ばれる。`$updatedCallback` は接頭辞配下だけ相対で受ける |

### N — 名前の撤去

| ID | 条件 |
|---|---|
| N0 | （v1.x）`name` 属性・`@` パスで `config.debug` 下に `console.warn` が 1 回（既定では出ない）。部分マウントと own key の衝突には既定で warn 1 回。挙動は不変 |
| N1 | （v2）`text: x@y` は parse error（文言に `y.x` を含む） |
| N2 | （v2）`<wcs-state name="x">` は throw（文言に `mount="x"` を含む） |
| N3 | 同一 rootNode にルートを 2 つ置くと throw |
| N4 | `packages/state/src` に `stateName` / `STATE_NAME_SEPARATOR` が残っていない |
| N5 | `$watch` の `@` 拒否コードが消え、相対宣言が絶対で登録される |
| N6 | `{{ x@y }}` / spread `...: o@y` / shorthand `.n@y` の 3 経路とも N1 と同じ error |

### L — Light DOM

| ID | 条件 |
|---|---|
| L1 | `<wcs-state bind-component="state">`（`name` 無し）が Light DOM で動く |
| L2 | 同じ Light DOM コンポーネントを `for` の行に置ける（v1 の制限の解消） |
| L3 | Light DOM コンポーネントの外側にある同じパス名のバインドがホストのツリーに解決される（スコープ根の境界） |
| L4 | ルート walk の後に upgrade した Light DOM コンポーネント（`state:` 付きホスト）の内側ノードを、親スコープが束ねない（スコープ根は親側の静的判定・D7） |

### S — SSR

| ID | 条件 |
|---|---|
| S1 | `<wcs-ssr>` に `name` が無く、rootNode ごとに 1 本 |
| S2 | ボリュームを含むページのスナップショットが接ぎ木済みで、hydrate 後にボリュームの `src` を fetch しない |
| S3 | `examples/ssr` と router e2e 5 spec が green |
| S4 | ボリューム付きページの hydrate: throw 無し・ボリュームの getter が登録済み・データのフラッシュ無し（D14） |

### T — ツール

| ID | 条件 |
|---|---|
| T0 | （v1.x）`wcs/named-state-deprecated` が warning で出る |
| T1 | （v2）vscode-wcs / lint が `@` を error にし、`manifest-state-collision` が存在しない |
| T2 | R1 の「私有キーがマウント先を隠す」診断が `stateSchema` から出る |
| T3 | `wcs-schema emit` が単一 `stateSchema` を出し、`--mount=i18n` が部分木として merge する。`check` が drift を検出する |
| T4 | `@wcstack/testing` の `state()` がルートを返し、`state("x")` が型エラー |
| T5 | devtools hook protocol v2 の `keys(rootNode)` がマウント配下も 1 本のツリーとして列挙する。スモーク green |
| T6 | README（英・日）に「名前空間」「Named State」「`@stateName`」が残っていない |

### P — 性能・メモリ

| ID | 条件 |
|---|---|
| P1 | jsfb-verify: Phase 0 ベースラインに対して全項目 ±ノイズ内（3 回計測の中央値） |
| P2 | list-component ベンチ: 退行ゼロ。改善は数値を設計書 §7 に記録 |
| P3 | memory-profile（list-component）: 行あたり保持量が減少（数値を記録） |
| P4 | memory-profile（plain benchmark ページ）: ±ノイズ内 |

### R — 初期化と ready

| ID | 条件 |
|---|---|
| R1 | `getBindingsReady(root)` がマウント配下の初期描画完了後に resolve する（D12） |
| R2 | コンポーネントスコープの初期化中の例外が `getBindingsReady` を reject する（無言ハングなし） |
| R3 | router の `<wcs-head>` 早期 bind（binder プロトコル）が保留登録と干渉しない（router e2e） |
| R4 | ボリュームのロード順に依存せず V1 が成立する |
| R5 | ボリュームのロード前に `i18n.t.x` を読んでも pathDiagnostics の warn が出ず、接ぎ木後に値が入る（D22） |

### 7-8. ADR-15 §1.x → マトリクス対応（回帰ゼロの網・DoD 7）

| ADR-15 | 形 | マトリクス | 生き残るテスト（P2-0 で確認） |
|---|---|---|---|
| §1.1 / §1.2 | `this.state` の意味論・分岐条件 | M13, M19 | `webComponent.bindWebComponent.semantics.test.ts` |
| §1.7 | 親→子の配送 | M3 | `integration.bindComponentDelivery.test.ts` |
| §1.8 | 子の `for` が親のリストを回す | M7 | `integration.bindComponentListRow.test.ts` |
| §1.9 | 行差し替えで `for` が死ぬ | M17 | `integration.bindComponentRowReplace.test.ts` |
| §1.10 / §1.12 | 入れ子 `for`（Δ>0）・境界 2 枚 | M9, M11 | `integration.bindComponentNestedFor.test.ts` |
| §1.11 | 境界 3 枚の行フィールド書き込み | M8 | `integration.bindComponentDepthN.test.ts` |
| §1.13 | Light DOM のデッドロック | L1 | `integration.bindComponentLightDom.test.ts` |

---

## 8. リスクと対策

| リスク | 対策 |
|---|---|
| Phase 2 が大きく、途中で main と乖離する | `v2` 統合ブランチに PR を小さく積む（P2-1/2/5 → P2-3/4 → P2-6 → P2-7 …）。各 PR で既存テスト緑を維持 |
| 順序違いの取り違え（4 度目） | §0-3 の規律。保留登録をテストで固定（R1–R3） |
| R1 の既定値シャドウが既存利用者を無言で壊す | M15 の warn ＋ T2 の lint ＋ 移行ガイド。**Phase 1 の P1-11 が 1.x の時点で予告する** |
| Phase 1 と 2.0 の意味論の乖離 | D19 で R1 を Phase 1 に含める。D21（私有寿命）だけは v1 機構の要素寿命のまま — v1 の既存挙動なので 1.x では不変、2.0 で改善として記載 |
| jsfb 退行 | `hasMounts` 分岐 1 つ以外ホットパスに触らない。スコープ根解決は短絡（D18）。P2-11 で毎 PR 計測 |
| SSR の server 側との整合 | D14（データはスナップショット・関数はモジュール・hydrate は採用）を P3-9 / P3-10 で実装確認。S3 / S4 をゲートに |
| ツール 4 パッケージ ＋ skill のドリフト | Phase 4 を 1 つの PR 群にまとめ、契約テスト（lint severity・manifest schema）で固定 |
| typescript / testing の初回 publish と manifest 形 | D15: 1.x はそのまま publish、2.0 で `schemaVersion: 2`。`testing.state(name?)` を 1.x で任意化 |
| `mount` の語の衝突（testing の `mount()`） | 決着済み。README で 1 行区別 |
| ~~積み上げ 7 本との競合（parser / manifest）~~ | 着地済み（2026-09-01）。Phase 1 は main から切る |

---

## 9. 見積り

| Phase | 触るパッケージ | ファイル（概数） | 備考 |
|---|---|---|---|
| 0 | docs, e2e | 8 | 計測・目標ページ |
| 1 | state, vscode-wcs, lint | 12 | 非破壊・R1 込み（D19） |
| 2 | state | src 25 / tests 30 / e2e 6 | core −840 行 ＋ 新規 ≈450 |
| 3 | state, server | src 45 / tests 76 / e2e 7 / examples 1 | 名前撤去は機械的 |
| 4 | vscode-wcs, lint, typescript, testing, docs, examples, skill | 40 | 契約テストが網 |
| 5 | 全パッケージ（版数） | — | ユーザー操作を含む |

P0-6 の精査結果（2026-09-01 実測）:

| 場所 | `<wcs-state name=` | `@name` パス | 備考 |
|---|---|---|---|
| `packages/state/__e2e__/*/index.html` | 0 | 0 | 移行対象なし |
| `examples/**/index.html` | 1（`router-i18n`） | 15（`router-i18n` の `@i18n`） | 他 7 ページの `@` は CSS / 文字列 |
| `packages/state/__tests__` | 21 箇所 | — | `name=` / `@` を含むファイル 48、`stateName` 参照ファイル 76 |
| `packages/state/README.ja.md` | — | — | `@` / `name=` 60 箇所（英語版も同程度） |

---

## 10. リリース時の作業（ユーザー操作）

- `v2` → main のマージ、release.yml の実行
- `@wcstack/typescript` / `@wcstack/testing` の初回 publish は 1.x の予定どおり（D15）。2.0 で `schemaVersion: 2`
- wcstack-skill の PR マージ（plugin version 2.0）
- vscode-wcs の vsix publish（v2 文言の診断）
- npm の "disallow tokens" ＋ NPM_TOKEN secret 削除（既存の残件、本件とは独立）

---

## 10. リリースノート下書き（v2.0.0 — P5-3）

> リリース時に本文へ転記する。バージョン揃え（P5-4: 全パッケージ 2.0.0・`wcstack` エントリ・ピン版数 5 箇所・skill plugin 2.0）と v2→main マージ（P5-5）はユーザー操作。

### ハイライト

**State は 1 つの rootNode に 1 本のツリー。拡張はマウントで行い、名前では行わない。**

- `<wcs-state mount="path">` — ボリューム。データはツリーに接ぎ木され、`path.` 接頭辞で読む。getter / `$watch` / `$listKeys` / `$updatedCallback` / ライフサイクルはマウント相対で動く
- `<my-c data-wcs="state: path">` — 丸ごとマウント。コンポーネントのバインディングは登録時に親ツリーの絶対パスへ変換される（台帳 1 本・橋渡し層なし）
- Light DOM コンポーネントは Shadow 形と同じ書き方に（name / `@` 不要・行配置可）
- 実測: 行コンポーネント create1k **−24%**・update **−45%**・ヒープ **−1.5KB/行**。コンポーネントの無いページは不変（jsfb ±ノイズ）

### 破壊的変更

| v1 | v2 | 検出 |
|---|---|---|
| `<wcs-state name="x">` | `<wcs-state mount="x">` | 実行時 fail-fast（誘導文付き）＋ lint error |
| `path@x` / `@default` | `x.path` / `path` | parse error（誘導文付き）＋ lint error |
| plain（配線なし）Light DOM `bind-component` | shadow を付けるか、ホストから配線してマウント | 実行時 raise（誘導文付き） |
| mapped コンポーネントの own key 既定値 | 厳格 R1: 作者の own data key は私有（マッピングに覆われない） | `wcs/mount-own-key-shadow` warn |
| SSR `<wcs-ssr name>` / `Ssr.findByName` | name なし / `Ssr.find(root)`（旧 server の name 付きスナップショットも読める） | — |
| devtools hook protocol v1（name 付き keys/read/write・stateName payload） | **v2**: `keys(rootNode)` 等・`overlays(rootNode)` 新設 | version 2（first-wins） |
| manifest `states[name]`（schemaVersion 1） | 単一 `stateSchema`（schemaVersion 2）。ボリュームは `wcs-schema emit --mount=<path>` で部分木 merge | 読み手が migration hint 付き error |
| `@wcstack/testing` `state(name)` | `state()`（引数は移行ヒント付き throw） | — |
| `wcs-schema --state=` | `--mount=<path>` | usage エラー（移行ヒント付き） |
| `@wcstack/server` の `extractStateData()`（@deprecated） | `@wcstack/state` の `Ssr.extractStateData()` | 削除（import エラー） |

### 移行ガイド（機械的）

1. `<wcs-state name="x"` → `<wcs-state mount="x"`（`name="default"` は単に削除）
2. `path@x` → `x.path`・`path@default` → `path`（spread / shorthand も同じ）
3. plain Light DOM bind-component → `attachShadow` を 1 行足す（または ホストに `state: path`）
4. `testing.state("x")` → `testing.state()` ＋ パスに `x.` 接頭辞
5. `wcs-schema emit` を再実行（schemaVersion 2 へ。ボリュームは `--mount=<path>` で追加）

lint（`@wcstack/lint` / vscode-wcs）が全対象箇所を error で列挙する。

### バージョニングポリシー（v2.0.0 で初表明）

最初の破壊的リリースに合わせ、**semver の保証範囲**（`data-wcs` 構文・wcBindable ほか相互運用プロトコル・ツール契約が対象、内部構成・文言・性能は対象外）と deprecation 運用（削除前に minor で予告）をルート README（英・日「Versioning and breaking changes」節）に明文化した。リリースノートからこの節へリンクする。

### 成立範囲の明記（性能）

数値はコンポーネントを行に持つリストでの実測。**コンポーネントもボリュームも無いページの性能・メモリは変わらない**（設計制約 D18・実測ゲート済み）。
