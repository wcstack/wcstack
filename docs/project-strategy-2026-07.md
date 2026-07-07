# wcstack プロジェクト戦略（2026-07）

- **日付**: 2026-07-08
- **ステータス**: 提言（採択待ち。§3 の目的関数ゲートのみ要決定）
- **作成経緯**: 多角戦略分析（現状調査 4・戦略レンズ 4・批判的検証 2 の 10 エージェント構成）の結論を、レッドチーム査読と一次事実の裏取り（git 実査・npm view・release.yml 精読）を通して統合したもの。
- **有効期限の目安**: 前提となる数値（stars / DL / 未公開パッケージ数）は 2026-07-08 時点のスナップショット。v1.16.0 リリース後は §2 の事実群を再確認すること。

---

## 0. TL;DR

戦略の核心は「新しく作る」ことではない。

1. **壊れた信頼（npm 404）と導線（動くデモ 0 本）を直す** — release.yml を冪等化して v1.16.0 を発車し、リンクグラフを修理する
2. **一度だけ正しい順序で物語を発信する** — 日本語圏で漏斗を検証してから Show HN に一発勝負
3. **工芸（規範化・完成宣言）に戻る** — そのあいだ「作る楽しさ」の時間枠（2〜3 割）を守る

## 1. 診断: プロダクトは「完成期」、提示は「ゼロ期」

一言でいうと **「製品は厚いが、漏斗（ファネル）が存在しない」**。

- **供給側は完成期**: I/O ノード量産ラインは候補が残り 5 件（Page Visibility / Web Locks / Gamepad / Beacon / Media Session）まで枯渇し逓減期。開発の重心は既に「実装」から「規範化」へ移っている（timing-and-firing-contract 全節完成、async-io-node-guidelines の normative 化、spec-proposal 2 本）。テスト約 5,250 件・README 日英完備。
- **需要側はゼロ期**: GitHub stars 5・forks 0、npm 週間 DL は @wcstack/state 53（レジストリミラー水準 ＝ organic 採用ほぼゼロ）。
- **その間に信頼を毀損する欠陥が 2 つ**:
  1. ルート README 掲載 39 パッケージ中 **15 個が npm 未公開で、リンクを踏むと 404**（§2-1）
  2. buildless / CDN 一発が核心の売りなのに、**クリックして 30 秒で動くホスト済みデモが 0 本**。wcstack.github.io（実在・英日対応）へのリンクがリポジトリ内に 1 件もなく、サイト側も静的スニペットのみ

ポートフォリオ構造は「重い 2 コア（state 約 1,471 テスト・router 約 539）＋均質な薄い I/O ノード 33 本」のバーベル型。「宣言的 Web API ラッパー custom element 集 ＋ 相互運用プロトコル」という一体型の直接競合は調査で発見できず（最近縁は保守終了した Polymer iron/platinum と緩い個人コレクション）、ニッチは空いている。

追い風は 4 潮流: (1) Import Maps / ESM CDN による buildless の実用化、(2) Shopify Polaris の CDN 配信 Web Components 全面移行が示す企業採用波、(3) HTML web components（HTML-first / light DOM）ムーブメント、(4) AI がコードを書く時代の宣言的 HTML 属性 API。Chrome 144 のネイティブ `<geolocation>` 要素（PEPC）は個別タグへの脅威であると同時に「ブラウザ自身が Web API の宣言的要素化を追認した」という最大の正当化材料。

## 2. 裏取り済みの重要事実（2026-07-08 実査）

### 2-1. 未公開 15 パッケージと「隠しコミット」

コミット `b123e9f`（2026-07-02、メッセージは「feat: add @wcstack/tilt package」）は、実際には **15 パッケージを一括追加**している:

> tilt, accelerometer, gyroscope, magnetometer, ambient-light-sensor, idle, network, share, fullscreen, picture-in-picture, pointer-lock, screen-orientation, contacts, credential, eyedropper

これらは全て npm 未公開（`npm view` で E404 確認済み）だが、ルート README とサイトには公開済みとして掲載されており、npm / esm.run リンクが 404 になる。**初見開発者が最初に踏む信頼毀損が現在進行中**。

教訓（運用ルール化推奨）: 新規パッケージは 1 パッケージ = 1 コミット（または最低限コミットメッセージに全列挙）とする。

### 2-2. リリース実態

- v1.13.0(6/12) → v1.14.0(6/17) → v1.15.0(6/23) は週次で出荷済み。speech / permission / notification / defined / camera 等は**公開済み**（「未リリース」という古い記録は陳腐化）。
- 未リリース差分（v1.15.0..main）: 上記 15 パッケージ ＋ websocket write-only send ＋ **state 同値ガード既定 ON（挙動変化）** ＋ manifest ツーリング。
- 次リリースは **minor 一括 bump（→ v1.16.0）が必須**（既決事項）。

### 2-3. release.yml の非冪等性（→ 本戦略と同時に修正済み）

`.github/workflows/release.yml` の publish ステップは逐次ループで、冪等化前は 15 個の初回 publish のどれかが途中失敗すると「npm 部分公開・タグなし」になり、再実行は再 bump で既公開分と EPUBLISH 衝突する構造だった。**2026-07-08 に「既公開バージョンはスキップ」ガードを追加して冪等化済み**（publish 前に `npm view "$name@$target"` で存在確認）。

### 2-4. その他の実査事実

- `feature/rest` ブランチは main から 0 コミットの空ポインタ（REST ノードの実装・需要根拠はまだ存在しない）
- `packages/poc-visual-editor` は空ディレクトリ（0 ファイル）
- マージ済みブランチが local 56 / remote 36 本残存
- SECURITY.md / CONTRIBUTING.md / FUNDING.yml / llms.txt は不在。ルート LICENSE は MIT だが個別パッケージに LICENSE ファイル未同梱
- docs/signals-migration-plan.md はヘッダ（未着手）と本文（Phase 完了マーク）が矛盾した状態 → 要修正。実態は「残タスク = npm publish のみ」
- GitHub open issues 10 件 ＝ 現存する唯一の実ユーザー接点

## 3. 目的関数ゲート（最初に決める・未決）

全提言の前提となる分岐。ここが未決だと「効く 20%」が逆転する。

| | 成長ゲーム | 工芸ゲーム |
|---|---|---|
| 目標 | stars / DL の最大化 | 仕様の完成度・深い少数ユーザー |
| 投資先 | 発信・デモ・チュートリアル全振り | 規範化・SPEC・内部品質 |
| リスク | マーケ専業化による燃え尽き | 「良いが知られないまま」の均衡 |

**推奨 = ハイブリッド**: 工芸を核に保ちつつ、「見つけてもらえる状態」を作る低コスト投資（導線修理 ＋ 一度の物語発信）だけ成長側に張る。作者の行動履歴（週次リリース、15 パッケージ一気量産、設計文書 33 本、feature/rest での次領域探索）は「作る楽しさ」で回っているプロジェクトであることを示す。**時間の 2〜3 割は自由開発枠として明示的に残す**ことが持続の条件（ソロ OSS の最頻死因は計画の失敗ではなく意欲の枯渇）。

## 4. P0 — 今すぐ（1〜2 週間）

### P0-1. v1.16.0 リリーストレインの発車

1. release.yml の冪等化（済・§2-3）
2. workflow_dispatch で minor を選択して発車
3. リリースノートに **state 同値ガード既定 ON という挙動変化**（オプトアウト手順付き）と新規 15 パッケージを明記。ルートに CHANGELOG.md を新設
4. 発車後、README / サイト掲載の全パッケージリンク（npm / esm.run）が解決することを確認。以後「npm 未公開のものは掲載しない／unreleased マークを付ける」を運用ルール化

### P0-2. リンクグラフ修理 ＋ 計測敷設（数時間）

- GitHub repo の homepage フィールドに wcstack.github.io を設定
- ルート README ⇔ サイトの相互リンク追加、examples/ 直下に索引 README
- npm 表示で切れる相対リンク（signals README 等）を絶対 URL 化
- npm org の 2FA・自動化トークン衛生（数分・供給網リスクは実在）
- 軽量アナリティクス（GoatCounter / Plausible 等）＋ GitHub traffic API をサイトに敷設 — これがないと P1-3 の発信検証が「数字のない感想文」になる
- マージ済みブランチ 54 本と空の poc-visual-editor を削除

### P0-3. open issues 10 件のヒアリング

現存する唯一の実ユーザー接点であり最安のユーザーリサーチ。誰が・何につまずき・なぜ使ったのかは、multi-promise の需要判定にも比較表・チュートリアルの題材にもなる。

## 5. P1 — 3 ヶ月

### P1-1. 「30 秒体験」の構築

- server.js 不要の静的 examples を wcstack.github.io にホスト（GitHub Pages は HTTPS なので camera 等の secure context 要件も満たす）
- **初回体験は権限プロンプト不要のデモ**（fetch / intersection / storage 系）。camera+speech 系の wow デモは 2 クリック目に置く（first-touch で権限 3 連発を踏ませない）
- StackBlitz / CodePen テンプレは CDN 読み HTML 1 枚を貼るだけ（各 1 時間）。専用プレイグラウンドの自作はしない

### P1-2. 深さ方向の導線 1 本

- state → router → fetch で小アプリを組む 3 ステップチュートリアル（Quick Start カウンターと 1,773 行の state README の間を埋める）
- 「vs Alpine.js / htmx / Lit / Petite-Vue、どういう場面で選ぶか」比較表。採用判断者は必ず比較する — 評価フレームを拒否する（現 state README の開き方）より自分で比較軸を定義する方が有利。「比較するな」の思想はエッセイへ退避

### P1-3. 物語駆動の発信 — 日本語圏先行

1. 看板エッセイ『What If HTML Had Reactive State Management』日本語版 ＋ 実装解説 2〜3 本を Zenn に投下
2. デモ → GitHub → star の漏斗を計測・修正（Zenn 読者と HN 読者は別集団なので、JP 検証は「離脱点の発見装置」と割り切る）
3. 英訳エッセイ ＋ デモを携えて Show HN に一発勝負（Show HN は実質一回きりの資源）

売り文句は **「39 tags, 1 protocol」**。Chrome 144 ネイティブ `<geolocation>` は「ブラウザ自身が宣言的要素化を追認した」という**一段落の物語**として README で回収する（ブリッジ実装はしない・§7）。

### P1-4. NOT リストの明文化（コストほぼゼロ）

README / サイトに明記:
- UI コンポーネント集はやらない（Web Awesome / Shoelace 等と組む）
- ビルド必須の機能は永久に入れない
- 新規 I/O ノードは需要 issue が立つまで凍結（htmx の「安定性優先」宣言の前例に倣う）
- 大規模 SPA で React / Vue と正面競争しない（ただし §8 の「楔」導線は残す）

### P1-5. spec-proposal 2 本の規範文言化は docs/ 内で

command-token 引数素通し / undefined-write-skip の 2 本を docs/ 内の規範文書として確定する。**独立 SPEC リポジトリ ＋ v1.0 凍結はやらない**（§7）。

## 6. P2 — 12 ヶ月（需要ゲート付き）

- **multi-promise（REST / RPC）**: 唯一の質的フロンティア（wc-bindable プロトコルの語彙欠落と自己診断済み・全パッケージ波及）。ただし feature/rest は空ブランチで需要根拠なし。**issue でのリクエストをゲート**に、まず (a) コレクション化（既存プロトコル内）から着手判断
- **state 完成宣言**: 残 4 件（A1-3 wcs:ready / A1-4 更新理由トレース / A2-2 ./syntax サブパス / A3-2 flush 規範化）を消化して「完成・規範保守モード」を宣言。いずれも採用には効かない内部品質タスクなので漏斗整備より後
- **signals**: 移行計画は publish で完了。以後の投資はデモ増強と リンク修正のみ。「PoC / 実験」ラベル外しは実戦例が増えてから
- **衛星の役割固定**: server（SSR）は「WC は SSR に弱い」批判への回答としてコア物語に編入（新機能投資は最小）。vscode-wcs は DX の堀として維持モード
- **マイルストーン**: 統制可能指標（デモ公開・記事 N 本・HN 投下実施）と観測指標（stars / DL）を分離して設定。観測指標は閾値でなくレンジで

## 7. やらないこと（レッドチーム査読で kill された提言）

| 提言 | kill 理由 |
|---|---|
| SPEC 独立リポジトリ ＋ v1.0 凍結 | 外部実装者ゼロの時点で儀式先行。multi-promise という既知の語彙欠落を残したまま凍結すると、最初に必要な改訂を自ら破壊的変更に格上げする順序錯誤。語彙が決まってから凍結 |
| PEPC ネイティブ要素へのブリッジ実装 | Chrome 単独出荷の実験 1 要素にコードパス二重化を先払いする価値なし。価値の 9 割は「ブラウザが追認した」という物語で、README 一段落で全取りできる |
| Renovate / Dependabot 導入 | ランタイム依存ゼロなので devDep 腐敗はビルド時限定の低リスク。workspace なしの 41 独立 lock への導入は PR ノイズ製造機 |
| versioning-policy.md / changesets 移行 | ロックステップ一括リリース継続が単一メンテナの正解。脱出条件（第 2 メンテナ出現・単独 breaking 必要時）は顕在化してから考えて間に合う |
| 「39 タグ周期表」をタグ集として売る | 同思想の Polymer iron/platinum はタグ集として死んだ。作るならタグ同士を data-wcs で配線して見せる「プロトコルのデモ」として設計し、ブラウザ対応ティア表示と統合して正直に作る |
| cancelled/error 呼称の全ノード横断統一 | 安定性を約束した直後に 33 パッケージの API 語彙を変える自己矛盾 |
| CONTRIBUTING / good first issue の即時整備 | 読者ゼロの現況では時期尚早。英語圏発信の直前に最小整備（シグナル駆動） |

## 8. 別途判断が要る論点（完全性検査で検出）

- **収益化**: FUNDING.yml すら無い。「やらない」なら明示的に決める（全提言は無償労働を恒久的に増やす計画であるため）
- **ライセンス**: 個別パッケージへの LICENSE 同梱漏れ（npm tarball に法的表示が入らない）。プロトコル規範文書の文書ライセンスは別途選択が要る
- **AI エージェント時代対応**: 週 DL 53 は学習データにもほぼ存在しないことを意味し、AI に「何を使うべきか」を聞く時代には推薦候補に上がらず、書かせれば data-wcs 構文を幻覚する。llms.txt / llms-full.txt の設置と、実装済み manifest を AI 生成コードの検証器（linter / MCP サーバ / vscode-wcs 転用）に流用する構想は、追い風を漏斗に接続する経路
- **React / Vue への「楔」導線**: examples/react-websocket・vue-websocket、fetch の 5 スタック比較デモは「I/O ノードが React/Vue アプリ内で動く」実証資産。「主流層と競わない」宣言と矛盾しないよう、全面置換ではなく「既存アプリに 1 タグ挿す」漸進導入経路として残す
- **CDN サプライチェーン**: esm.run 直読みが主導線なのに、バージョン pin 推奨・SRI・provenance の言及がゼロ。Quick Start のスニペットを pin 付き URL 標準にする一行で先回りできる（HN で最初に突かれる論点）
- **国際化の運用**: docs/ 設計文書 33 本・テスト記述・リリースノートは日本語のみ。プロトコル規範を外部実装者（英語圏）向けにするなら正本言語の決定が要る

## 9. 実行順序まとめ

```
今すぐ    : P0-1 リリース発車 → P0-2 導線・衛生・計測 → P0-3 issue ヒアリング
3 ヶ月    : P1-1 30秒体験 → P1-2 チュートリアル・比較表 → P1-3 JP発信→EN発信
            （並行・低コスト: P1-4 NOTリスト / P1-5 規範文言化）
12 ヶ月   : P2 multi-promise は需要ゲート / state 完成宣言 / マイルストーン評価
恒常      : 時間の 2〜3 割は自由開発枠（燃え尽き防止が最大のリスク管理）
```
