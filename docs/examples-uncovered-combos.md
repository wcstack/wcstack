# examples 未カバーパッケージの組み合わせデモ候補

- **状態**: 推し 3 案（§2）実装済み（2026-07-12）— `examples/state-sse-dashboard` / `examples/state-pomodoro` / `examples/state-color-palette`。
- **背景**: ルート `examples/` は「2 パッケージ以上の複合デモ」置き場だが、公開 39 パッケージのうち 17 パッケージがどのデモにも一度も登場していない。組み合わせが新しいだけでなく、**未カバーのパッケージに初出番を与える**ことを選定基準にした。

---

## 0. 現状: examples 完全未カバーのパッケージ

ルート `examples/` と各パッケージの `examples/` を横断 grep した結果（2026-07-12 時点）:

```
sse / worker / clipboard / resize / fullscreen / picture-in-picture /
pointer-lock / screen-orientation / idle / network / share / contacts /
credential / eyedropper / gyroscope / magnetometer / ambient-light-sensor
```

タグ単位ではさらに:

- `<wcs-throttle>`（debounce パッケージ）— 未使用
- `<wcs-timer>` — `packages/defined/examples/defined-loader` に「ロード対象」として登場するだけで実演なし

## 1. 選定基準

1. 未カバーのパッケージを 2 つ以上含む（state は基盤なので数えない）
2. プロジェクトのプロトコル（wc-bindable / command-token / event-token / $streams / ライブハンドル）に固有の見せ場がある
3. buildless・CDN 一発の方針に沿う（バックエンドは shared/server.js の薄い拡張まで）
4. フラグなしのブラウザで動く（Chromium 限定は可、chrome://flags 必須は不可）

## 2. 推し 3 案（実装対象）

### 2-1. `state-sse-dashboard` = sse + state($streams) + network

同一の SSE メトリクスフィード（ダミー）を、**左パネル=`<wcs-sse>` タグ流儀 / 右パネル=`$streams` 流儀**で並置消費するライブダッシュボード。

- **設計判断（実装時に確定）**: `<wcs-sse>` と `$streams` は「SSE を state に取り込む」という**同じ仕事を取り合う競合手段**であり、直結すると不正直な設計になる。よって直列でなく並置比較にし、「要素へ配線するだけならタグ / state 側で fold・switchMap が要るなら `$streams`」という使い分けを主題にする。
- **見せ場**: ホスト切替。左は `$on` で fold した履歴のリセットが手書き 3 行、右は `args` の依存駆動 restart で自動リセット（switchMap）。sse は README しかない唯一の通信系ノードで初カバー、`$streams`（[state-streams-design.md](./state-streams-design.md)）の初のクロスパッケージ実戦投入。fold は **last-N の有界集計**=「backpressure 放棄・fold 有界化」規範のショーケース。名前付きイベント（`events="metric,deploy"` → `message.event`）も実演。
- **network の役割（当初案から修正）**: `<wcs-network>` は Network Information API 専用で **online/offline は公開していない**（実装確認済み）。よって「オフラインバナー」ではなく**回線品質タイル**（effectiveType / downlink / rtt / saveData）として使う。初期スナップショットは接続時に同期 dispatch されるためバインド確立前に取り逃す — state の `$connectedCallback` で現在値を一度 pull する。
- **サーバー**: `examples/shared/server.js` の api フック（生 req/res）で SSE ストリーミングルートを実装。`/state-dist/` に packages/state のローカルビルドをマウント。
- **注意**: `$streams` は未リリースのため、リリースまでは state のみローカルビルド参照。**次回 minor リリース後に CDN 一発化する**（README に明記）。

### 2-2. `state-pomodoro` = timer + wakelock + notification + state

ポモドーロタイマー。カウントダウン中だけ wakelock、セッション終了で notification。

- **見せ場**: 「集中中は画面を消さない」が wakelock の存在理由（desired/actual 二相）を一言で説明する。timer の初実演。fetch に依存しない異色枠。セッション終了 → `$command.notify` の command-token 起動。
- **サーバー**: 不要（any static server / secure context 推奨: wakelock・notification のため）。

### 2-3. `state-color-palette` = eyedropper + clipboard + storage + state

EyeDropper で画面から採色 → パレットに追加（list diffing）→ クリックで hex を clipboard にコピー → storage で永続化。

- **見せ場**: eyedropper（command で起動 → event で色が返る）と clipboard（command で write → copied event）という **command-token / event-token 双対の見本市**。視覚的に映えてバックエンドゼロ。
- **制約**: EyeDropper API は Chromium 限定 + secure context。非対応ブラウザには支持状況を表示してフォールバック文言を出す。
- **サーバー**: 不要（any static server）。

## 3. 次点（今回は実装しない）

| 案 | 組み合わせ | 見せ場 / 保留理由 |
|---|---|---|
| `state-aim-trainer` | pointer-lock + fullscreen + raf + throttle + state | tilt-maze のデスクトップ対応物（ゲーム枠 2 本目）。throttle 初出番 |
| `state-idle-presence` | idle + broadcast + permission + state | クロスタブ在席表示。cross-tab-todo の姉妹編。Chromium + permission 要 |
| `state-worker-crunch` | worker + fetch + debounce + state | 数万行 fetch → worker で集計。メインスレッド非ブロックの体感。worker 初カバー |
| `state-video-theater` | picture-in-picture + fullscreen + screen-orientation + state | 動画プレイヤー UI。camera プレビューを PiP に流す変種はライブハンドル(G2)の次の試金石だが `<wcs-pip>` が外部 video 要素を受けられるか要調査 |
| `state-share-card` | share + clipboard + state | share 失敗時 clipboard フォールバック。小粒。share を 2-3 に添える手も |

## 4. 実装で判明した上流の課題（要対応検討）

推し 3 案の実装・実ブラウザ検証（Playwright）の過程で、examples ではなく **state / storage 側の設計ギャップ**が 2 件見つかった。**正本 = [state-binding-init-races.md](./state-binding-init-races.md)**（機序・実測・該当コード・恒久対応候補のトレードオフ表）。**両件とも同日中に恒久対応済み**（バグ 2 = `scheduleDeferredApply` 実装、バグ 1 = idiom 規範化 + cross-tab-todo 修正、いずれも e2e 回帰テスト付き — 詳細は正本の状態欄）。以下は発見時点の要約。

### 4-1. storage の load-before-bind clobber（既存デモで実害あり）

`<wcs-storage>` は自身の `connectedCallback` でロードして value イベントを dispatch するが、これは state のバインディング確立**前**に起こりうる（イベント取り逃し）。その後 `applyChangeFromBindings` が state 初期値（`null` / `[]`）を要素へ書き込み、write-through save が**永続値をリロードのたびに上書き消去**する。

- **実測**: `examples/state-cross-tab-todo` で todos を追加 → リロードすると localStorage が `[]` に潰され**全消失**（Playwright で確認。既存バグ・本件では未修正）。
- **回避 idiom**（`state-color-palette` で採用）: 永続スロットを `undefined` で開始（undefined はプロパティ書き込みスキップ=「無意見」規範）+ `$connectedCallback` でロード済み値を一度 pull。
- **恒久対応の候補**: two-way wcBindable プロパティへの初期 state→element 書き込みを抑制する / storage 側が bind 後に再通知する、など。要設計判断。

### 4-2. 未 define カスタム要素への初期 apply の黙殺

`applyChange.ts` は `customElements.get(tag) === undefined` のとき初期適用を skip する（「customElement 側の初期化を期待」）が、**whenDefined 後の再適用が無い**。two-way / eventToken の attach は whenDefined 再試行するのと非対称。

- **顕在化条件**: state がローカル配信（高速）で I/O ノードが CDN（低速）など、state のバインド初期化が要素 define より先に完了する構成。`state-sse-dashboard` で `url: sseUrl` が一度も書かれず左パネルが無音になった。既存デモが無事なのは全パッケージ同一 CDN で define が先に済む「偶然」に依る。
- **回避 idiom**（3 デモすべてで採用）: module script は文書順実行が保証されるため、**I/O ノードの `<script>` を先・state を最後**に並べる。
- **恒久対応の候補**: applyChange にも whenDefined 後の再適用を足す（two-way attach と対称化）。

## 5. あえて作らない（理由付き）

- **magnetometer / ambient-light-sensor** — Chrome でフラグ（`#enable-generic-sensor-extra-classes`）必須のためデモ不適
- **gyroscope** — 単体デモより tilt-maze への追加が自然
- **contacts** — Android Chrome 限定
- **credential** — 認証バックエンドの物語が必要で、buildless・バックエンドレス方針と相性が悪い
- **resize** — 単体では物語が薄い。`state-worker-crunch` / `state-video-theater` への添え物候補
