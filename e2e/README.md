# wcstack e2e — 実ブラウザテスト

**ローカルの `packages/*/dist` バンドル**を実ブラウザ (Chromium / Playwright) で動かし、
バインディングが end-to-end で機能することを検証します。全パッケージの単体テストは
happy-dom 上で動くため、「本物のブラウザで custom element + `data-wcs` バインディングが
機能するか」はここでのみ検証されます。

スペックは2種類あります。

- **examples smoke テスト** — `examples/` および `packages/*/examples/` のデモアプリを
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

| HTML 内の参照 | 書き換え先 |
|---|---|
| `https://esm.run/@wcstack/<pkg>/auto` | `/packages/<pkg>/dist/auto.min.js` |
| `https://esm.run/@wcstack/<pkg>` | `/packages/<pkg>/dist/index.esm.js` |

正規表現はインライン import map 内の URL にもそのまま適用されます (`@version` ピンは除去)。
`auto.min.js` は外部 import ゼロの自己完結バンドルなので、単体で解決します (以前は
`./index.esm.min.js` を相対 import していました)。素のエントリが `index.esm.js` を指すのは、
`exports["."]` の解決先がそれだからです。**dist はコミット済みのものを使う**ので、
パッケージのソースを変更した場合は該当パッケージで `npm run build` してから実行してください。

また、examples の一部は自前の `server.js` (port 3000 固定・同時起動不可) で `/api/*` を
提供するため、`serve.mjs` が同形のモック API (`/api/search`, `/api/users`, `/api/metrics`) を
最小フィクスチャで代替します。テスト単位の失敗注入が必要な `state-intersect-scroll` は
Playwright の `page.route()` で `/api/items` を隔離して横取りします。

## スペック一覧

### examples smoke テスト (9 spec)

| example | 検証内容 |
|---|---|
| `state-search` | state + fetch + debounce。初期全件フェッチの一覧描画、`locale` フィルタ、eventToken のリクエストカウンタ、入力 → 300ms デバウンス → 再フェッチの絞り込み |
| `users-crud` (packages/fetch/examples) | state + fetch。一覧 auto-fetch、行クリック → computed url → 詳細フェッチ、manual POST → 成功バナー → command-token による一覧リロード |
| `state-cross-tab-todo` | state + storage + broadcast。2 ページ (=2 タブ) 間で localStorage 経由のリスト同期と BroadcastChannel 経由の live シグナル。リロード後も消えない (load-before-bind clobber 回帰) |
| `state-sse-dashboard` | state `$streams` + SSE。host 変更時の switchMap 型 cancel/restart、旧 connection の close、最新 feed だけの反映 |
| `state-intersect-scroll` | state `$streams` + intersection。in-flight cancel / stale-drop、順序付き pagination、有界 retry、予算切れ停止、手動復帰、scroll 一往復での error page 再試行 (error UI が sentinel を band 外へ押し出す構成含む)、全87件の終端 |
| `synth-playground` | audio + midi + state。マークアップからのパッチ組み上げ、スライダー → state → オーディオノード、発音中の DOM 追加で音が切れないこと、2つ目の `<wcs-audio>` が共有 AudioContext 上で独立に動くこと |
| `midi-fader` (packages/midi/examples) | midi + state。`navigator.requestMIDIAccess` を差し替えた MIDI 入力が eventToken / command-token / パスゲッター経由でページに届くこと |
| `calendar` (packages/state/examples) | state 単体。算出 getter を `for:` のイテレーション対象にしたグリッドが、週数変化・年跨ぎを含む月移動に追随すること |
| `router-i18n` | router + state + i18n パターン。ロケール交渉（URL > storage > navigator > fallback）、head 同期スクリプトの URL 修復、言語切替のハードナビゲーション、後から差し込まれたルート内容の binder 経由バインド。デモ自身のサーバーをルートで立てる（basename 前提のため serve.mjs 非経由） |

### fixture プロトコル回帰テスト (17 spec)

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
| `monitor-initial-snapshot` | devtools hook protocol の初期スナップショット |
| `router-a11y` | router のスクロール/フォーカス契約 (docs/a11y-design.md §3-1)。Navigation API 経路の仕様既定 (push でトップへ・traverse で復元・フォーカスは body へ) と、`window.navigation` を undefined に潰す fallback 強制で pushState / popstate 経路の SPA 遷移が成立すること (T0-4) |
| `router-a11y-optin` | オプトインの `focus="heading"` / `announce="title"` (docs/a11y-design.md §3-4)。commit 後にリーフ route の見出しへフォーカスし、live region へ commit 時 title が入ること。初回描画では両方とも動かないこと |
| `state-move-before` | keyed swap 中の行内 `<input>` のフォーカス・入力値の保存 (docs/a11y-design.md §4)。mountAfter の moveBefore 分岐は happy-dom に moveBefore が無く実ブラウザでしか走らない |
| `view-transition-route` / `view-transition-list` | 実 `document.startViewTransition` に対する遷移の開始回数と DOM の一回適用（router ルート差し替え / state リスト更新・auto naming） |
| `audio-graph-poc` / `audio-offline` | Web Audio のグラフ配線とレンダリング (OfflineAudioContext) |

### 未対象の examples

技術的障害があるもの:

| example | 理由 |
|---|---|
| `websocket-chat/react` / `websocket-chat/vue` | Vite ビルド + WebSocket サーバーが必要 (CDN 参照でない) |
| `websocket-chat/vanilla` / `websocket-chat/state` / `websocket-chat/signals` | WebSocket サーバー (`shared/server.js`) が必要 |
| `state-custom-states` | WebSocket サーバー (`/ws`) が必要 |
| `ssr` | サーバーサイドレンダリング構成 (静的配信モデル外) |
| `state-camera-record-upload` | カメラデバイス + `getUserMedia` 権限が必要 |
| `state-notification-chat` | Notification 権限 + OS 通知が必要 |
| `state-permission-banner` | Geolocation 権限が必要 |
| `state-pomodoro` / `state-tilt-maze` / `signals-tilt-maze` | wakelock / センサー (headless では発生させられない) |
| `state-color-palette` | EyeDropper (ユーザージェスチャ必須・Chromium 限定) |
| `speak-highlight` / `speech-echo` (packages/speech/examples) | SpeechSynthesis / SpeechRecognition (headless では音声環境なし) |
| `signals-live-search` | `@wcstack/signals/dom` は `/auto` より深いサブパスのため CDN 書き換え対象外 (`/api/people` のモックと併せて対応すれば対象化可能) |

技術的障害はなく、単に未着手のもの (追加候補): `router-spa`、`state-devtools-playground`、
`infinite-scroll` / `pagination` (packages/fetch/examples)、`defined-loader`
(packages/defined/examples)、`calendar` 以外の packages/state/examples 各デモ。

## CI

`.github/workflows/e2e.yml` が `examples/**`・`packages/**/src/**`・`packages/**/dist/**`・
`e2e/**` に触れる pull request と `workflow_dispatch` で実行されます。実行前に
「src が dist より新しい」パッケージをツリーから検出して再ビルドするため、
コミット済み dist が古くてもスイートは常にワーキングツリー相当を検証します。
