# Claude Code チームの検証の手法 — 検討

- **状態**: 検討（2026-11-21）。著者は同日、推奨した順序を採った（§3）。作業は終わるごとに §4 に記録する
- **出典**: Addy Osmani「[How the Claude Code team thinks about verification](https://claude.dev/blog/how-the-claude-code-team-thinks-about-verification/)」（2026-11-16）。以下「記事」
- **English**: [verification-practices-study.md](./verification-practices-study.md)

記事は、コードの大半を Claude が書き、Claude がレビューするチームが、そのコードの正しさをどう保っているかを書いている。変更が触れられないチェック、繰り返す失敗への hook、コミット前に走らせる `verify` スキルを使う。flaky なテストは通るまでリトライさせない。property テストと差分テスト、diff に反応するチェックリスト、古くなるルールの剪定を加え、レビューは 3 ラウンドで止める。ここから wcstack 向けに 8 つの提案が出た。本書は各提案をリポジトリと突き合わせ、判定と作業の順序を記録する。

## 1. 記事の主張

- 「変更が自分を裁くチェックを書き換えられるなら、そのチェックは壊れている」。Code Review は REVIEW.md を base ブランチから読み、プルリクエストからは読まない。
- エージェントが同じ失敗を繰り返すなら、hook か CLAUDE.md の明示的なルールを足す。それで「（ほぼ）」再発しない。
- 検証とは変更を走らせることである。`.claude/skills/` の `verify` スキルをコミット前に使い、速く確実に保つ。Claude が作業を終えたときに hook がテストを走らせる。各コミットには、どう検証したか（「なし」も含む）を刻む。新しいゲートは observe モードで始め、止めたはずのものを記録する。
- flaky なテストは、エージェントにコードを直すより再実行することを教える。Claude はそれを skip できず、sleep も足せず、通るまでのリトライもできない。原因が見つからなければ、テストを消して理由を書く。
- property テストは、round trip、不変条件、冪等性、最適化したコードと素朴なコードの一致を確かめる。差分テストは、新旧を同じランダムな入力（または抽出した本番の入力）で走らせ、無関係な差を正規化し、承認した変更を一覧に持つ。
- 信頼性のチェックリストは、各項目に diff から読めるトリガー、チェックの内容、きっかけになったインシデントを持たせる。走らせるのは該当する項目だけで、たいてい 3〜10 項目。
- 「テストスイートも検証の手順も .md ファイルも、放っておけば増える一方だ」。剪定する。
- レビュー担当は 1 人にする。各ラウンドは前のラウンドと過去の失敗を引き継ぎ、指摘には Important / Nit / Pre-existing を付け、何を見るかは REVIEW.md に書く。3 ラウンド経っても落ちるチェックは人に渡す。

## 2. 提案とリポジトリの突き合わせ

| # | 提案 | 判定 | 優先度 |
|---|---|---|---|
| 1 | 判定基準を変更の手の届かない所に置く | 妥当（やり方を変える） | 高 |
| 2 | skill の lint 完了ゲートを hook にする | 妥当（前提の半分は解決済み） | 中 |
| 3 | CI の外でも走る verify（スクリプトとスキル） | 妥当 | 中 |
| 4 | e2e のリトライに `failOnFlakyTests` を足す | 方向は妥当、今は有効にできない | 最優先で調査 |
| 5 | state エンジンの property テストと差分テスト | 妥当 | (a) は高 |
| 6 | 「Things that bite」を diff トリガーのチェックリストにする | 妥当 | 低〜中 |
| 7 | 変動する数値を散文に書かない | 妥当（裏付けあり） | 最優先（安い） |
| 8 | project-quality-improvement スキル | 妥当（一部は旧版の記述） | 中 |

### 2.1 判定基準を変更の手の届かない所に置く

**提案.** ゲートが裁く PR は、そのゲートの入力をすべて変えられる。size と結合のベースライン（slack を含む）、`check-state-size.mjs` の絶対上限、各 `vitest.config.ts` の閾値、`src` のカバレッジ除外コメント、`ci.yml` 自体である。`gate-integrity` ジョブは、これらに触れた PR を `Gate-Change:` トレーラーが無い限り落とす。PreToolUse hook は、エージェントによるこれらの編集と `--update` を拒む。

**リポジトリ.** 中身は合っている。4.0 のゲートを作り直してから（2026-10-03）、size のベースラインは 65 コミットで変わった。そのうち 17 はリリースでの取り直しではない。add-on の追加や移動、diagnostics の増加、「リリースが取り直すまで」の 640 B の slack（bd9c6944）、core の上限の 20 KiB への引き上げ（49dc2770）である。どれも著者が決めた変更なので、ゲートはこうした変更を禁じるより見えるようにするのが合う。カバレッジ除外コメント 21 か所は 6 パッケージの 10 ファイルにあり、`state` には無い。

**足りない点.** トレーラーは自己申告なので、ゲートで詰まったエージェントはコードと同じようにトレーラーも書ける。記事では、ルールは変更からではなく base から来る。

**やること.**
- CI: PR を base のルールでも裁く。base の size ゲート・上限・ベースラインを、PR のビルドに当てる。ベースライン・上限・閾値・除外コメントの変更は、差分とともにジョブのサマリに書き出す。observe モードで始める。
- エージェント: PreToolUse の deny ではなく permissions の `ask` にする。リリースの手順でベースラインを `--update` で取り直すのはエージェントなので、deny ではリリースが止まる。Bash（sed や node）での書き込みは塞げないので、壁ではなく減速帯である。

### 2.2 skill の lint 完了ゲートを hook にする

**提案.** プラグインの `hooks/hooks.json` で、エージェントが HTML・manifest・state のソースを書いた後に `wcs-validate` を走らせる（PostToolUse）。error が残る間は、Stop hook が終了を止める。error は止め、warning は情報として返す。

**リポジトリ.** family-ledger の作者では、`--errors-only` が本物の warning を 4 件通した。これは 4.21 で直した。`wcs/submit-without-prevent` と `wcs/tag-package-missing` を error にし（#659）、skill の合格線を「`--errors-only` が 0 で終わり、warning はすべて直すか説明する」に変えた。cold-start で lint を 9 回中 0 回しか走らせなかったのは、skill を持たない作者である。プラグインの hook が届くのはプラグインを入れた作者だけで、それも Claude Code の中だけである。

**やること.** プラグインはどのプロジェクトでも有効なので、PostToolUse は `data-wcs`・`wcs-` のタグ・wcstack のスクリプトを含むファイルに限る。lint が走れないとき（オフライン、`npx` の初回ダウンロード）は止めない。Stop hook は `stop_hook_active` を見て、記事のコミットゲートと同じく 2 回止めたら通す。observe モードで始め、static-wiring-dx の D10 が予定する cold-start の再実行で効果を測る。

### 2.3 CI の外でも走る verify

**提案.** CI の選択ロジックを `scripts/verify.mjs --base <ref>` に切り出し、CI と `.claude/skills/verify/` から呼ぶ。quick 層（lint と影響するパッケージのテスト）は Stop hook で、heavy 層（size と結合のゲート、e2e、exhaustive の CI の深さ）は PR の前に走らせる。走らせたものは `Verified:` トレーラーに記録する。

**リポジトリ.** 選択ロジックは YAML の bash にしか無い。`ci.yml` の `detect-changes` では、`tsconfig.json` の変更は全パッケージを選び、`state` の変更は devtools と router を足し、メンバーの変更は `wcstack` を足し、ゲートのスクリプトは `state` を選ぶ。dist が古いかの判定は `e2e.yml` にある。ただ `research/*` の最後の更新は 2026-10-24 で、リリースは main から出るので、CI の無いブランチはほぼ過去のものである。今も価値があるのは、CI と同じ選択を PR の前にローカルで走らせられることである。

**やること.** CI のワークフローとスキルから同じスクリプトを呼ぶ。Stop hook は会話だけのターンも含めて毎ターンの終わりに発火するので、前回の verify から `packages/` が変わったときだけ、カバレッジなしで走らせる。`Verified:` のスタンプは検証したツリーに結び付ける。observe モードで始める。

### 2.4 e2e のリトライに `failOnFlakyTests` を足す

**提案.** CI は落ちた e2e テストを 2 回まで再試行し（`e2e/playwright.config.ts`）、再試行で通ったテストは通ったものとして数える。試行ごとに割合 p で落ちる欠陥は、確率 1 − p³ で緑になる（p = 0.3 なら 97 %）。`failOnFlakyTests: !!process.env.CI` を設定する。リトライは診断のために残すが、緑にはさせない。

**リポジトリ.** Playwright 1.61.1 にこの設定はある。ただ直近 15 回の e2e（2026-11-15〜11-19）のうち 8 回に flaky があり、計 10 件だった:

| spec | 回数 | 1 回目の失敗 |
|---|---|---|
| `family-ledger.spec.ts` | 5 | ログインの補助関数の URL が `/login?email=…&<パスワード>`: フォームが GET で送られた |
| `router-auth.spec.ts` | 1 | 同じ形: `/login?username=alice&<パスワード>` |
| `homeroom.spec.ts` | 1（2 件） | ログインした後も `/login?next=…` のまま |
| `town-archive.spec.ts` | 1 | 「一覧へ戻る」の後にカードにフォーカスが無い |
| `state-mount.spec.ts` V7 | 1 | ボリュームの `$connectedCallback` が走らなかった |

今この設定を入れると PR の半分ほどが赤になる。そして記事の警告がそのまま当てはまる。2 つのアプリで、ログインのフォームがネイティブの GET で送られ、パスワードが URL に載った。ページが束ねられる前の送信に見え、遅い回線なら実際の利用者にも起きうる。V7 はエンジンのタイミングの欠陥かもしれない。調べて分かったことは §2.4.1 に書いた。

**やること.** (1) spec ごとに原因を探し、直すか、テストを消して理由を書く。(2) flaky の件数をジョブのサマリに出す（observe モード）。(3) 0 件が続いたら `failOnFlakyTests` を有効にし、CLAUDE.md に 1 行足す。

#### 2.4.1 flaky な spec が隠していたもの（2026-11-21）

5 つの spec のうち、テストの誤りは 1 つだった。残りの 4 つは wcstack の欠陥を 2 つ隠していた。どちらも利用者が出会いうるもので、どちらも何も言わない。

| spec | 原因 | 再現のしかた |
|---|---|---|
| `state-mount.spec.ts` V7 | **テストの誤り.** テストはルートの `connectedCallbackPromise` を待ってからボリュームを読んでいた。ボリュームは自分の `src` を読み込み、自分の promise で決着する。ルートはボリュームを待たない（state の README の Volumes）。 | ボリュームの `src` を 800 ms 遅らせると、毎回 `undefined` を読む。両方を待つように直した。 |
| `family-ledger`・`router-auth`・`homeroom` | **state が束ねる前のルートが使える.** router は自分のスクリプトが走るとすぐに `/login` を描く。state が束ねるのは、ルートの state（`state.js` かインラインのモジュール）を読み込んだ後である。その間の送信はネイティブの GET になり、パスワードが URL と履歴に載る。その間に打った文字は、束ねたときに state の空の値で消える。`homeroom` ではその後 `required` が送信を止める。SSR の add-on は打った文字を既に戻している（`typed()`、v4-direction §5.1 の著者の決定）が、クライアントが描くページにはそれに当たるものが無い。 | `state.js` を 1.5 秒遅らせると、family-ledger のログインは毎回 `/login?email=mom%40example.com&password=pass` へ行き、両アプリの打った値は `""` になる。遅らせなければ何も起きない。 |
| `town-archive` | **外側の束縛が内側の要素のイベントを聞く.** `<wcs-intersect>` は、多くの I/O ノードと同じく bubble するイベントを出す（Core 42 ファイル）。要素自身は子孫のイベントを捨てる（`event.target !== this`）。しかし state の `eventToken.*` と出力プロパティのリスナー（`dom/wc.ts`）は target を見ず、signals の `bindNode` も見ない。外側の seen-probe の `cardVisibility` は内側の thumb-probe のイベントでも走り、`span.thumb` をカードとして記録した。そのため `focusCard` は `.card-link` を見つけられなかった。見た数とアンカーも同じ誤った entry を読んでいる。 | 手元で 30 回中 3 回。一時的なトレースでは、失敗した回は毎回 `rt.cardEls` に `span.thumb` があり、通った回は毎回 `article.card` があった。 |

2 つの欠陥は、著者の決定を待ってから直す。それまでその spec は flaky のままで、`failOnFlakyTests` もそれを待つ。

### 2.5 state エンジンの property テストと差分テスト

**提案.** (a) リスト操作を含め、state の形と書き込みの列をランダムに作る。dirty 戦略と keyed diff を経た DOM が、全束縛を素朴に再評価した DOM と一致することを確かめる。(b) 凍結した 3.5.4 のパーサと 4.0 のパーサを、生成した `data-wcs` の文字列で突き合わせる。既知の差（`@state`）は承認リストに入れる。(c) router の `encodePathname` / `decodeSegment`、`protocol/input-attribute`、SSR のスナップショットの round trip を確かめる。

**リポジトリ.** fast-check を使うのは signals（`reactive.property.test.ts`）だけである。state のテストは何もランダムに作らない。`Math.random` は `bench/scale` でタグに名前を付けるのにしか使っていない。

**やること.**
- (a) 正解を、別に書いた素朴な評価器にしなくてよい。同じ最終状態を新しい `<wcs-state>` に描かせ、その DOM と差分で更新した DOM を正規化して比べる。fast-check は devDependency なので、実行時依存ゼロの規則は守られる（signals に前例がある）。
- (b) fixtures には 3.5.4 の `parser.esm.js` がある。ただ 4.0 のパーサは golden を持つ移植なので、(b) は (a) より価値が低い。
- (c) 法則の書き方に注意する。`encodePathname` と `decodeSegment` は互いの逆関数ではない。静的セグメントは書いたとおりに照合する（#694）。法則は「アプリが書いたパスが意図したルートに当たり、params がデコードされて返る」になる。

### 2.6 「Things that bite」を diff トリガーのチェックリストにする

**提案.** 罠ごとに diff から読めるトリガー、チェックの内容、きっかけのインシデントを持たせ、該当する項目だけを走らせる。インシデントは CI のコメントに既にある（#183、#433、#136、#214〜#219、#591）。散文にしか無い罠もある: README と README.ja の対、wcstack-skill の references、`packages/state/package.json` の編集でチャンク名が変わること、testing のビルドが dist を汚すこと。README の対と `Skill-Impact:` トレーラーは、observe モードで機械化できる。

**やること.** 対になった README の一方だけが変わったら警告するチェックを作る（`packages/wcstack` の README は英語版だけ）。罠を CLAUDE.md からトリガー付きのチェックリストへ移すと、毎セッション読まれる分も縮む。skill は別のリポジトリにあるので、`Skill-Impact:` トレーラーは記録にとどまる。

### 2.7 変動する数値を散文に書かない

**提案.** 誤りの目録は、core の余地を 20 KiB の上限まで 536 B と書いている。実際の余地は 6 B で、disposition の定義は、実行時の知らせをどこに置くかをこの余地で決めている。

**リポジトリ.** 確かめた。536 B は `docs/mistake-catalogue.md`（disposition の定義と `submit-without-prevent` の行）、`.ja.md` の同じ 2 か所、その生成元の `scripts/mistake-catalogue.json`、`docs/v4-direction-2026-10.md`（2026-10-17 の方針の 2 行）にある。同じ文書の §5 の「20,163 B（4.7.0）」のような日付付きの決定記録は履歴なので残す。

**やること.** 定義と方針から数値を消し、今の値がどこにあるか（size ゲートの出力。CLAUDE.md に引いてある）を書く。数値はリリースごとに変わり、必要とするのはゲートだけなので、ベースラインから差し込むより消すほうが安い。

### 2.8 project-quality-improvement スキル

**提案.** 指摘者と修正者の往復に上限が無い。指摘者は build・test・lint を走らせない。毎回白紙のコンテキストから走査し直す。前のラウンドを引き継ぐか、せめて修正者が却下した指摘の台帳を引き継ぐ。指摘に Important / Nit / Pre-existing を付ける。レビューで見るものは wcstack の REVIEW.md に書く。

**リポジトリ.** このスキルはユーザーレベル（`~/.claude/skills/`）にあり、このリポジトリには無い。提案は旧版を読んでいる。今の版は `/clear` ではなく、新しい指摘者エージェントを（最大 5 回）起動する。内側の往復（手順 3〜6）には上限が無く、終わらないことがある。修正者が指摘を却下し、同じ指摘者がそれを未解決として返すと、「指摘事項なし」はいつまでも来ない。新しい指摘者も、却下された指摘を毎回出し直す。指摘者にも修正者にも build・test・lint を走らせる指示は無い。修正者は「テストへの影響を考慮する」だけである。Pre-existing は「この差分が持ち込んだものではない」の意味で、全ソースを走査すればすべてが既存なので、何も分けない。分けるのは Important / Nit である。

**やること.** 3 ラウンドで止め、残りは人に渡す。修正者に build・test・lint を走らせ、結果を報告に付けさせる。却下した指摘の台帳を理由とともに新しい指摘者に引き継ぐ。指摘には Important / Nit を付ける。リポジトリに REVIEW.md があれば読む。

## 3. 作業の順序

2026-11-21 に決定（著者は推奨した順序を採った）:

1. §2.7: 数行で済み、誤りも確かめてある。
2. §2.4 の調査: flaky な spec が欠陥を隠しているかもしれない（ログインの GET、V7）。
3. §2.1: `ask` のルールと、base のルールで裁くこと。
4. §2.5 (a)。
5. §2.8: ユーザーレベルのスキル。
6. §2.3、次に §2.2（D10 とあわせて）、次に §2.6。

新しいゲートは記事のとおり observe モードで始め、誤検知が分かってから強制にする。

## 4. 進み具合

| 手順 | 節 | 状態 |
|---|---|---|
| 1 | §2.7 | 本書とともに済み（#721） |
| 2 | §2.4 | 原因を特定した（§2.4.1）。observe モードの reporter と V7 の修正は #722。2 つの欠陥は決定し（v4-direction §5.22）、#723（入れ子のイベント）と #724（束ねる前のフォーム）で直した。`failOnFlakyTests` は、それらが入って件数が 0 のまま続くのを待つ |
| 3 | §2.1 | #725: `gate-changes`（CI のジョブとスクリプト）、PR のビルドを base の size ゲートでも測る、`.claude/settings.json` の `ask` の規則。どれも observe モード |
| 4 | §2.5 (a) | #726: ランダムな書き込みの列の後の DOM を、ゼロからの描画と比べる property。わざと壊したキー付きの差分を 3 手の反例で捕まえた。(b) と (c) は未着手 |
| 5 | §2.8 | ユーザーレベルのスキル（リポジトリの外）で済み: 3 ラウンド、修正者が build / test / lint を走らせる、却下台帳、Important / Nit、リポジトリの REVIEW.md |
| 6 | §2.3、§2.2、§2.6 | §2.3 は #727（`scripts/verify.mjs`、CI の選択。300 件のマージで bash と同じ。Stop hook は著者に委ねた）。§2.2 は wcstack/wcstack-skill#74（プラグインの lint の hook。既定は observe、enforce は D10 の後）。§2.6 は #728（`scripts/diff-checklist.json`、10 項目） |
