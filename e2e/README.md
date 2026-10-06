# wcstack e2e — 実ブラウザテスト

**ローカルの `packages/*/dist` バンドル**を実ブラウザ (Chromium / Playwright) で動かし、
バインディングが end-to-end で機能することを検証します。全パッケージの単体テストは
happy-dom 上で動くため、「本物のブラウザで custom element + `data-wcs` バインディングが
機能するか」はここでのみ検証されます。

スペックは2種類あります。

- **examples テスト** — `examples/` および `packages/*/examples/` のデモアプリを
  そのまま開く。デモが壊れていないことと、デモが体現する機能が実ブラウザで動くことを見る
- **fixture プロトコル回帰テスト** — `e2e/fixtures/` の手書き最小 HTML を開く。DCC・
  bind-component・遅延 define・devtools monitor・Web Audio など、**実ブラウザでしか
  再現しない**挙動 (template.content の clone は upgrade されない、OfflineAudioContext の
  レンダリング等) をデモから切り離して固定する

## 実行方法

```bash
cd e2e
npm ci                                   # 依存インストール (初回のみ)
npx playwright install chromium          # ブラウザインストール (初回のみ)
npm test
```

静的サーバーは Playwright の `webServer` 設定 (`playwright.config.ts`) が自動起動します。
手動でページを確認したい場合は `npm run serve` で `http://127.0.0.1:4173/examples/<name>/`
(パッケージ配下のデモは `/packages/<pkg>/examples/<name>/`) を開けます。

各テストは共通して次を検証します:

1. ページを開き、`pageerror`(未捕捉例外) と `console.error` を収集する
2. バインディングが動いた証拠となる UI (フェッチ結果の一覧行・ステータス文言など) の描画を待つ
3. 収集したエラーが 0 件であることを assert する

CDN 書き換え (下記) の対象は examples だけですが、fixture も同じ `serve.mjs` が配信するため
`/packages/*/dist/` を直接参照します。どちらも**コミット済み dist ではなくワーキングツリーの
dist** を見るので、`packages/*/src` を変更したら該当パッケージで `npm run build` してから
実行してください (`dist` はリリース時にしかコミットされないため、main では常に古い)。

## CDN → ローカル書き換えの仕組み

examples の `index.html` は `https://esm.run/@wcstack/*` (CDN) を参照していますが、
テストは「現在のワーキングツリー」を検証しなければなりません。そこで `serve.mjs`
(依存ゼロ、`node:http` のみ) がリポジトリルートを配信し、**HTML レスポンスのみ**を
次のルールで書き換えます (他のアセットは素通し、examples のファイル自体は変更しません):

`https://esm.run/@wcstack/<pkg>[/<subpath>]` を、そのパッケージの `package.json` の
`exports` で解決したローカルのファイルに書き換えます (バンドラや CDN が選ぶのと同じファイル):

| HTML 内の参照 | 書き換え先 (`exports` の解決結果) |
|---|---|
| `https://esm.run/@wcstack/<pkg>/auto` | `/packages/<pkg>/dist/auto.min.js` |
| `https://esm.run/@wcstack/<pkg>` | `/packages/<pkg>/dist/index.esm.js` |
| `https://esm.run/@wcstack/signals/dom` | `/packages/signals/dist/dom.esm.js` |

正規表現はインライン import map 内の URL にもそのまま適用されます (`@version` ピンは除去)。
`exports` に無いサブパスと、リポジトリに無いパッケージの URL は書き換えません。
`auto.min.js` は外部 import ゼロの自己完結バンドルなので、単体で解決します。**dist は
ワーキングツリーのものを使う**ので、パッケージのソースを変更した場合は該当パッケージで
`npm run build` してから実行してください。

また、examples の一部は自前の `server.js` (port 3000 固定・同時起動不可) で `/api/*` を
提供するため、`serve.mjs` が同形のモック API (`/api/search`, `/api/users`, `/api/metrics`) を
最小フィクスチャで代替します。それ以外の API・WebSocket・外部 API は、各 spec が
`page.route()` / `page.routeWebSocket()` で隔離して横取りします。

デモ自身のサーバーが要るもの (オリジンのルートに置く前提の SPA、チャンクで流す応答、
SSR) は、spec がそのサーバーを `WCS_LOCAL=1` で**ワーカーごとのポート**に立てます
(`router-i18n` / `router-spa` / `ssr` / `packages/state/examples/streams`)。
`WCS_LOCAL=1` はデモのサーバー側で esm.run をローカルの dist に書き換える同じ手口です。

ブラウザに無い (または headless で使えない) プラットフォーム API は、spec が
`page.addInitScript()` で差し替えるか (EyeDropper・Notification・wakeLock・センサー・
MIDI)、Chromium の機能で与えます (カメラは `--use-fake-device-for-media-stream`、
権限と位置は Playwright のコンテキスト権限と geolocation エミュレーション。権限を指定
しない headless の Permissions API は `prompt`、`permissions: []` は `denied`)。

## スペック一覧

### examples テスト (35 spec)

`examples/` と `packages/state/examples/` のデモは、すべて対象です（`websocket-chat/react`・`/vue` を除く。下の「未対象」）。
4.0 の評価のため、読み込めることではなく、デモが見せている機能を UI から操作して描画結果を確かめます。
見つけた欠陥は直し、テストはその回帰として残しています（「4.0.0-rc.6 の不具合の回帰」と書いた行）。直していない欠陥を固定するときは、正しい挙動を書いて `test.fail` を付けます。直ると「失敗するはずが成功した」で落ちるので、そのとき外します。

**packages/state/examples**（state 単体）

| example | 検証内容 |
|---|---|
| `index.html` | 目次のリンクが実在するデモを指し、デモのディレクトリと過不足なく一致すること |
| `hello-world` / `simple-counter` / `simple-list` | `{{ }}` と双方向の `value:`、`class.*` の付け外し、`for:` の行と getter |
| `cart` | `<select>` の中の `for:`、`value|number`、ハンドラの `(event, $1)`、行の追加・数量・削除（confirm）、`if:` / `else:` |
| `spread` | `...:` の展開（単独・行ごと）、後ろの明示バインディングが勝つこと、要素からの書き戻しが同じ値を持つ別の要素へ届くこと |
| `state-population` | 二重の `for:` と小計・合計・比率の getter、`locale` / `percent`、`regions` の書き換えへの追従 |
| `calendar` | 算出 getter を `for:` で回すグリッドが、週数変化・年跨ぎを含む月移動に追随すること |
| `recursive-tree` | `$recursion` と自己参照コンポーネントの木。全深さの集計、子の追加・削除、全選択。消えた行の中の入れ子のコンポーネントが描き続けないこと（4.0.0-rc.6 の不具合の回帰） |
| `watch` | 行パスの `$watch`（`cur, prev, index`）、どこにもバインドしない getter の watch、`$listKeys` で配列を差し替えたときに発火するのは変わった行だけ |
| `async-fetch` | `$connectedCallback` の取得、Loading → 一覧、空・HTTP エラー・ネットワークエラー（外部 API は `page.route()`） |
| `streams` | `$stream` のチャンクごとの描画、prompt の変更での中断と再開、Regenerate、途中の切断と `$streamError`（デモのサーバーを立てる） |

**examples/**（state と I/O ノード・router・server）

| example | 検証内容 |
|---|---|
| `state-search` | state + fetch + debounce。初期全件フェッチの一覧描画、`locale` フィルタ、eventToken のリクエストカウンタ、入力 → 300ms デバウンス → 再フェッチの絞り込み |
| `users-crud` (packages/fetch/examples) | state + fetch。一覧 auto-fetch、行クリック → computed url → 詳細フェッチ、manual POST → 成功バナー → command-token による一覧リロード |
| `state-cross-tab-todo` | state + storage + broadcast。2 ページ (=2 タブ) 間で localStorage 経由のリスト同期と BroadcastChannel 経由の live シグナル。リロード後も消えない (load-before-bind clobber 回帰) |
| `state-sse-dashboard` | state `$stream` + SSE。host 変更時の switchMap 型 cancel/restart、旧 connection の close、最新 feed だけの反映 |
| `state-intersect-scroll` | state `$stream` + intersection。in-flight cancel / stale-drop、順序付き pagination、有界 retry、予算切れ停止、手動復帰、scroll 一往復での error page 再試行 (error UI が sentinel を band 外へ押し出す構成含む)、全87件の終端 |
| `state-intersect-fetch` | intersection + fetch を state が event token と command token でつなぐ無限スクロール。1 ページずつの読み込み、`reobserve()`、失敗と Retry、終端 |
| `synth-playground` | audio + midi + state。マークアップからのパッチ組み上げ、スライダー → state → オーディオノード、発音中の DOM 追加で音が切れないこと、2つ目の `<wcs-audio>` が共有 AudioContext 上で独立に動くこと |
| `midi-fader` (packages/midi/examples) | midi + state。`navigator.requestMIDIAccess` を差し替えた MIDI 入力が eventToken / command-token / パスゲッター経由でページに届くこと |
| `router-i18n` | router + state + i18n パターン。ロケール交渉（URL > storage > navigator > fallback）、head 同期スクリプトの URL 修復、言語切替のハードナビゲーション、後から差し込まれたルート内容の binder 経由バインド。デモ自身のサーバーをルートで立てる（basename 前提のため serve.mjs 非経由） |
| `router-spa` | router + fetch + state。一覧と絞り込み（`replaceUrl`）、行クリックで詳細、ディープリンク、戻る・進む、遷移中に古いデータを見せないこと、404、API の失敗。デモ自身のサーバーを立てる |
| `ssr` | @wcstack/server の SSR とハイドレーション。生 HTML と JS 無効での表示、`<wcs-ssr version>` が 4.0、ハイドレーションがサーバーの DOM を描き直さずに引き取ること、その後のボタン。デモ自身のサーバーを立てる |
| `state-devtools-playground` | devtools + state + timer。ページの機能に加えて、オーバーレイの State / Wiring / Timeline ペインとカバレッジ、遅れてアタッチしてもライブ台帳が見えること。開いたままの State ペインが、一時停止中も含めてページの書き込みに追従し、編集中は待つこと（devtools の不具合の回帰）。どのドックと画面幅でも × がパネルの内側にあること |
| `state-testing-todo` | 追加・切り替え・Clear done、`#prevent`。input と submit が同じタスクで起きても入力欄が空になること（4.0.0-rc.6 の不具合の回帰） |
| `state-custom-states` | fetch + websocket の `:state(loading/error/connected)` が CSS に出ること、切断・再接続・接続失敗。ページを開いたときのソケットが 1 本であること（`<wcs-ws>` の二重接続の回帰） |
| `websocket-chat` (state / vanilla / signals) | 同じ WebSocket プロトコルの 3 実装。接続・stats・echo・broadcast・Clear・失敗と自動再接続、3 ページを 1 つの hub につないだ配信順 |
| `state-permission-banner` | geolocation + permission。prompt / granted / denied / unsupported のバナー、許可の変化への追従、取得中の表示 |
| `state-notification-chat` | notification + permission。許可の要求、通知の生成とクリックの event token、ブロック時の無効化 |
| `state-pomodoro` | timer + wakelock + notification。start / pause / reset、focus と break の切り替え、通知とそのクリックで次へ。wake lock を focus の間だけ取ること（下の属性ミラーの回帰） |
| `state-color-palette` | eyedropper + clipboard + storage。色の追加・コピー・削除・永続化・2 ページ間の同期、行の `style.backgroundColor:`（4.0.0-rc.6 の不具合の回帰） |
| `state-camera-record-upload` | camera + upload。撮影 → 録画 → プレビュー → multipart のアップロードと進捗、失敗、拒否。`keepAlive: recording`（同） |
| `state-tilt-maze` | tilt + accelerometer + raf + wakelock + defined。傾き・ドラッグ（`#direct` のハンドラの `currentTarget` がボード）・キーでの操作、穴・ゴール、読み込み失敗時の `<wcs-defined>`。wake lock をプレイ中だけ取ること（同） |
| `signals-tilt-maze` / `signals-live-search` | 同じデモの signals 版と、signals + fetch の検索（`@wcstack/signals/dom`） |

属性ミラーの回帰（pomodoro・tilt-maze・camera）: state は wc-bindable の `inputs[].attribute` に値を写す。
4.0.0-rc.6 まで（3.x も）boolean を `String(value)` で写していたので `false` が `active="false"` になり、
属性の有無で真偽を決める I/O ノードは真と読んでいた。今は HTML の真偽属性として写す（`true` は空、`false` は外す）。

### fixture プロトコル回帰テスト (19 spec)

`e2e/fixtures/` の最小 HTML に対して実行します。デモではなく**プロトコルの不変条件**を固定するもので、
happy-dom では再現しない挙動を対象にしています。

| fixture | 検証内容 |
|---|---|
| `dcc-command` | command-token が DCC のメソッドに届き、引数も渡ること |
| `dcc-in-list` | fragment 内で bind された行にも初期値が入り、`if` の再マウントでも壊れないこと |
| `dcc-subpath-change` | DCC へのサブパス書き込みが親 state まで伝わること |
| `bind-component-write` | mapped なコンポーネントでも state の read/write が素通しすること |
| `bind-component-parent-write` | 親 state からの書き込みが子コンポーネントへ配送されること（ADR-15 §1.7-1.10） |
| `bind-component-list` | for 行内の bind-component への配送とキー付き更新 |
| `bind-component-row-replace` | 行の置換で子コンポーネントのバインドが繋ぎ直されること |
| `bind-component-nested-for` | 入れ子 for の中の bind-component 配送 |
| `bind-component-depth2` / `bind-component-depth2-nested` | 深さ 2 のコンポーネント連鎖（ADR-15 §1.11/§1.12） |
| `bind-component-light-dom` | Light DOM の bind-component がデッドロックしないこと（ADR-15 §1.1-1.13） |
| `deferred-apply` | 後から define された要素にも初期バインド値が適用されること |
| `deferred-spread-template` | `for:` / `if:` のテンプレートの中の spread（`...: .` / `...: rows.*`）が、後から define された要素でも行・枝を先に描き、define 後にその行の値で展開されること。define 前に消えた行は展開しないこと（#330） |
| `monitor-initial-snapshot` | devtools hook protocol の初期スナップショット |
| `router-a11y` | router のスクロール/フォーカス契約 (docs/a11y-design.md §3-1)。Navigation API 経路の仕様既定 (push でトップへ・traverse で復元・フォーカスは body へ) と、`window.navigation` を undefined に潰す fallback 強制で pushState / popstate 経路の SPA 遷移が成立すること (T0-4) |
| `router-a11y-optin` | オプトインの `focus="heading"` / `announce="title"` (docs/a11y-design.md §3-4)。commit 後にリーフ route の見出しへフォーカスし、live region へ commit 時 title が入ること。初回描画では両方とも動かないこと |
| `native-commands` | ネイティブ要素の `command.<method>:`（native-commands 機能）。`onclick: $command` で `<dialog>` が `:modal` で開き、state の `emit("saved")` で閉じて `returnValue` が入ること、`if:` で表示した `<input>` に `$renderedCallback` からの emit でフォーカスが移ること、popover の開閉（クリックのイベントを引数にしない）。happy-dom では top layer・フォーカス・popover の状態を見られない |
| `state-move-before` | keyed swap 中の行内 `<input>` のフォーカス・入力値の保存 (docs/a11y-design.md §4)。mountAfter の moveBefore 分岐は happy-dom に moveBefore が無く実ブラウザでしか走らない |
| `view-transition-route` / `view-transition-list` | 実 `document.startViewTransition` に対する遷移の開始回数と DOM の一回適用（router ルート差し替え / state リスト更新・auto naming） |
| `audio-graph-poc` / `audio-offline` | Web Audio のグラフ配線とレンダリング (OfflineAudioContext) |

### 未対象の examples

| example | 理由 |
|---|---|
| `websocket-chat/react` / `websocket-chat/vue` | Vite でビルドする React / Vue のアプリで、`@wcstack/state` を使わない（依存は npm の `@wcstack/websocket`） |
| `speak-highlight` / `speech-echo` (packages/speech/examples) | SpeechSynthesis / SpeechRecognition (headless では音声環境なし) |

`examples/` と `packages/state/examples/` の外で未着手のもの (追加候補): `infinite-scroll` / `pagination`
(packages/fetch/examples)、`defined-loader` (packages/defined/examples)、`list-transitions`
(packages/view-transition/examples)。

## CI

`.github/workflows/e2e.yml` が `examples/**`・`packages/**/src/**`・`packages/**/dist/**`・
`e2e/**` に触れる pull request と `workflow_dispatch` で実行されます。実行前に
「src が dist より新しい」パッケージをツリーから検出して再ビルドするため、
コミット済み dist が古くてもスイートは常にワーキングツリー相当を検証します。
