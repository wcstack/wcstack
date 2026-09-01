# 実装計画: 名前付き State の廃止とマウントによるツリー拡張

- **状態**: 2026-09-01 起草。設計の正本は [state-mount-design.md](./state-mount-design.md)（以下「設計書」）。本書はその §3〜§9 を着手可能なタスク粒度・受け入れ条件・完了条件に展開した手順書。設計書の要確認 6 件のうち **D4（R1）/ D8（絶対参照なし）/ D11（ルート必須）/ 属性名 `mount` は 2026-09-01 に著者が決定**。**同日のアーキテクチャレビューで D19〜D22 が追加され、Phase 1 は R1 込み（D19）に改稿**。残る D12 は Phase 2 で確認する。**Phase 0 は完了**（§1-2）。**Phase 1 着手（2026-09-01）**。
- **届ける相手**: v2.0.0 の全利用者。Phase 1 だけは **v1.x の minor で先行出荷**する（非破壊・追加のみ）。
- **前提**: app-testing の積み上げ 7 本は **main 着地済み**（PR#214〜#219・2026-09-01 に `git branch --merged main` で確認）。Phase 2 以降はいつでも切れる。
- **ブランチ**: v2 は破壊的変更なので **統合ブランチ `v2`** を main から `--no-track` で切り、Phase 2〜5 の PR は `v2` に向ける。Phase 1 と deprecation は main 向け。コミットは `git commit -F`。dist を生成したら**戻してからコミット**する。
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
