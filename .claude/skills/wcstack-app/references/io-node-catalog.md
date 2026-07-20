# wcstack I/O ノードカタログ + signals 早見表

出典: 各パッケージ README（ja 優先）と src の `static wcBindable` 宣言・`packages/signals/README.ja.md`・`examples/signals-live-search`。fetch / storage / websocket / timer / intersection / clipboard / notification / geolocation は README と突き合わせ済み。それ以外の属性 kebab-case 表記は inputs 名からの推定を含むため、厚く使う場合は該当パッケージの README を確認すること。

## 0. 共通規約（全 I/O ノード共通)

- **CDN 一行**: `<script type="module" src="https://esm.run/@wcstack/<pkg>/auto"></script>`（`@wcstack/state/auto` と併記、I/O 側を先に）
- **wc-bindable**: 各タグは `static wcBindable` で **properties**（観測可能な出力。state が購読）/ **inputs**（書き込みサーフェス。属性は kebab-case ミラー）/ **commands**（呼び出し可能メソッド）を宣言。
- **配線**: 出力バインド `data-wcs="value: users"` ／ command-token `data-wcs="command.<メソッド>: $command.<名前>"` ／ event-token `data-wcs="eventToken.<プロパティ>: <名前>"` ／ spread `data-wcs="...: slot"`。
- **共通イディオム**:
  - `manual` 属性 = 接続時に自動開始しない。
  - `trigger` はコマンドではなく**モーメンタリな入力プロパティ**。`false`→`true` の書き込みで起動（`command.trigger` は存在しない）。
  - イベント名は `<タグ名>:<種別>`（例外: screen-orientation は `wcs-orientation:*`、`<wcs-throttle>` は `wcs-throttle:*`）。
  - ほぼ全ノードが `error` / `errorInfo` を出力に持つ（持たないのは timer / raf / debounce / permission / network / intersection / resize / defined）。表では省略。

## 1. カタログ

| パッケージ | タグ | 主要属性 / inputs | properties（出力） | commands |
|---|---|---|---|---|
| **fetch** | `<wcs-fetch>`（補助: `<wcs-fetch-header name value>` `<wcs-fetch-body type>` `<wcs-infinite-scroll>`） | `url` `method` `target` `manual` `body` `response-type`(auto/json/text/blob/arrayBuffer) `trigger` | `value` `loading` `error` `status` `objectURL` `trigger` | `fetch` `abort` |
| **storage** | `<wcs-storage>` | `key` `type`(local/session) `value` `manual` `trigger` | `value` `loading` `error`（クロスタブ同期あり） | `load` `save` `remove`（全て同期） |
| **upload** | `<wcs-upload>` | `url` `method` `field-name` `multiple` `max-size` `accept` `manual` `files` `trigger` | `value` `loading` `progress` `error` `status` `files` `trigger` | `upload` `abort` |
| **websocket** | `<wcs-ws>` | `url` `protocols` `auto-reconnect` `reconnect-interval` `max-reconnects` `binary-type` `manual` `trigger` `send`（値を書くと即送信・オブジェクトは自動 JSON 化） | `message` `connected` `loading` `readyState` `trigger` `send` | `connect` `sendMessage` `close` |
| **sse** | `<wcs-sse>` | `url` `with-credentials` `events` `raw` `manual` `trigger` | `message` `connected` `loading` `readyState` `trigger` | `connect` `close`（受信専用） |
| **broadcast** | `<wcs-broadcast>` | `name` `manual` | `message`（自己エコーなし・structured clone） | `open` `post` `close` |
| **worker** | `<wcs-worker>` | `src` `type` `name` `manual` `keep-alive` `restart-on-error` `max-restarts` `restart-interval` | `message` `running` | `start` `post` `terminate` |
| **timer** | `<wcs-timer>` | `interval`(既定1000) `once` `repeat` `immediate` `manual` `trigger` | `tick`(カウンタ) `elapsed`(ms) `running` `trigger` | `start` `stop` `reset` `pause` `resume` |
| **raf** | `<wcs-raf>` | `once` `repeat` `manual` `trigger` | `tick` `elapsed` `dt` `running` `suspended` | `start` `stop` `reset` `pause` `resume` |
| **debounce** | `<wcs-debounce>` / `<wcs-throttle>`（throttle は leading 既定 on・`wcs-throttle:*`） | `source`（値サーフェス入力） `wait` `leading` `trailing` `max-wait` | `value`(settled 済み値) `fired` `pending` | `trigger` `cancel` `flush` |
| **clipboard** | `<wcs-clipboard>` | `monitor` | `text` `items` `loading` `readPermission` `writePermission` `monitoring` `copied` `cut` `pasted` | `writeText` `write` `readText` `read` `startMonitor` `stopMonitor`（write はユーザージェスチャ必須） |
| **geolocation** | `<wcs-geo>` | `high-accuracy` `timeout` `maximum-age` `watch` `manual` `trigger`（属性は接続時読み取り） | `position` `latitude` `longitude` `accuracy` `coords` `timestamp` `watching` `loading` `permission` | `getCurrentPosition` `watchPosition` `clearWatch` |
| **permission** | `<wcs-permission>` | `name`（1タグ1権限） `user-visible-only` `sysex` | `state`(granted/denied/prompt/unsupported) `granted` `denied` `prompt` `unsupported` | なし（監視専用） |
| **notification** | `<wcs-notify>` | `notice`（reactive 表示・同値ガード） `mode`(auto/constructor/sw) `body` `icon` `badge` `tag` `lang` `dir` `require-interaction` `silent` `renotify` `manual` | `permission` `granted` `denied` `prompt` `unsupported` `clicked` `closed` `shown` | `request` `notify(title, options)` `close` `closeAll`（SW 併用は `@wcstack/notification/sw` の `wireNotificationClicks()`） |
| **intersection** | `<wcs-intersect>` | `target`（省略=最初の子/セレクタ/`self`） `root` `root-margin` `threshold` `once` `manual` `trigger` | `entry` `intersecting` `ratio` `visible`（初交差でラッチ） `observing` | `observe` `reobserve` `unobserve` `disconnect` `reset` |
| **resize** | `<wcs-resize>` | `target` `box` `round` `once` `manual` `trigger` | `entry` `width` `height` `observing` | `observe` `unobserve` `disconnect` |
| **wakelock** | `<wcs-wakelock>` | `active`（desired 入力） `type` `manual` | `held`（actual 出力・OS 解放を反映） | `request` `release` |
| **camera** | `<wcs-camera>` | `audio` `facing-mode` `device-id` `width` `height` `autostart` `keep-alive` | `active` `permission` `audioPermission` `deviceId` `devices` `streamReady`（生 MediaStream） `ended` | `start` `stop` `switchCamera` |
| **camera** | `<wcs-recorder>` | `mime-type` `timeslice` `audio-bits-per-second` `video-bits-per-second` | `recording` `paused` `duration` `mimeType` `blob` `objectURL` `recorded` `dataavailable` | `attachStream` `start` `stop` `pause` `resume` |
| **speech** | `<wcs-speak>`（TTS） | `say`（reactive 発話・同値ガード） `rate` `pitch` `volume` `voice` `lang` `manual` | `voices` `speaking` `paused` `pending` `charIndex` `spokenWord` `unsupported` | `speak`（imperative・同値でも発火） `cancel` `pause` `resume` |
| **speech** | `<wcs-listen>`（STT） | `lang` `continuous` `interim` `max-restarts` `manual` `trigger` | `interimTranscript` `finalTranscript` `result` `listening` `permission` `unsupported` `trigger` | `start` `stop` `abort` |
| **defined** | `<wcs-defined>` | `tags` `mode` `timeout`（timeout でロード失敗検出） | `defined` `pending` `missing` `count` `total` `error`（不変条件 total=count+pending+missing） | なし（event-token 専用・単調・終端） |
| **fullscreen** | `<wcs-fullscreen>` | `target` | `active` | `requestFullscreen` `exitFullscreen` |
| **picture-in-picture** | `<wcs-pip>` | `target` | `active` | `requestPictureInPicture` `exitPictureInPicture` |
| **pointer-lock** | `<wcs-pointer-lock>` | `target` | `active` | `requestPointerLock` `exitPointerLock` |
| **screen-orientation** | `<wcs-screen-orientation>` | （入力なし） | `type` `angle` `portrait` `landscape` | `lock` `unlock` |
| **idle** | `<wcs-idle>` | `threshold` | `userState` `screenState` `active` | `requestPermission` `start` `stop` |
| **network** | `<wcs-network>` | （入力なし） | `effectiveType` `downlink` `rtt` `saveData` `supported` | なし（監視専用） |
| **share** | `<wcs-share>` | （入力なし） | `value` `loading` `cancelled` | `share` |
| **contacts** | `<wcs-contacts>` | （入力なし） | `value` `loading` `cancelled` | `select` |
| **credential** | `<wcs-credential>` | （入力なし） | `value` `loading` `cancelled` | `get` `store` |
| **eyedropper** | `<wcs-eyedropper>` | （入力なし） | `value` `loading` `cancelled` | `open` `abort` |
| **tilt** | `<wcs-tilt>` | （入力なし） | `alpha` `beta` `gamma` `absolute` `permissionState` | `requestPermission` `start` `stop` |
| **accelerometer** | `<wcs-accelerometer>` | `frequency` | `x` `y` `z` | `start` `stop` |
| **gyroscope** | `<wcs-gyroscope>` | `frequency` | `x` `y` `z` | `start` `stop` |
| **magnetometer** | `<wcs-magnetometer>` | `frequency` | `x` `y` `z` | `start` `stop` |
| **ambient-light-sensor** | `<wcs-ambient-light-sensor>` | `frequency` | `illuminance` | `start` `stop` |

## 2. 高頻度ノードの state 連携最小例（各 README より）

**fetch** — 算出 URL が fetch を駆動（url 変化で自動再実行・進行中は abort）:
```html
<wcs-fetch data-wcs="url: usersUrl; value: users; loading: listLoading; error: listError"></wcs-fetch>
<ul><template data-wcs="for: users"><li data-wcs="textContent: users.*.name"></li></template></ul>
```

**storage** — プリミティブ値の双方向永続化。バインド先 state スロットは**意図的に `undefined` で初期化**（`""`/`null` だと初期書き戻しで保存値を上書きする = load-before-bind イディオム）:
```html
<wcs-storage key="username" data-wcs="value: username"></wcs-storage>
<input data-wcs="value: username">
```
オブジェクトのサブプロパティ変更は `$trackDependency` 入り getter を `trigger` にバインドし `manual` + save で保存。

**websocket** — 受信は `message`、送信は `send` に値を書くだけ:
```html
<wcs-ws url="wss://example.com/ws"
  data-wcs="message: lastMessage; connected: isConnected; send: outgoing"></wcs-ws>
<!-- state 側: sendChat() { this.outgoing = { type: "chat", content: this.chatInput }; } -->
```

**timer** — `setInterval` 相当を宣言的に:
```html
<wcs-timer interval="1000" data-wcs="tick: count; running: isRunning"></wcs-timer>
<!-- ワンショット: <wcs-timer interval="3000" once data-wcs="tick: showBanner"> -->
```

**intersection** — 遅延読み込み（`visible` は初交差でラッチ、`once` で切断）:
```html
<wcs-intersect once data-wcs="visible: shown">
  <img data-wcs="src: src" alt="lazy">
</wcs-intersect>
<!-- 無限スクロール端検出: <wcs-intersect target="self" data-wcs="intersecting: atEnd"> -->
```

**clipboard** — command-token でコピー（write はユーザージェスチャ必須）:
```html
<wcs-clipboard data-wcs="command.writeText: $command.copy"></wcs-clipboard>
<button data-wcs="onclick: onShare">Share</button>
<!-- state 側: $commandTokens: ["copy"], onShare() { this.$command.copy.emit(this.message); } -->
```
読み取りは `command.readText: $command.paste; text: pasted`、監視は `monitor` 属性 + `eventToken.pasted: ...`。

**notification** — command-token（表示）と event-token（クリック）が 1 タグに同居:
```html
<wcs-notify data-wcs="
  command.request: $command.request;
  command.notify:  $command.notify;
  eventToken.clicked: opened"></wcs-notify>
<!-- state 側: $commandTokens:["request","notify"], $eventTokens:["opened"],
     send() { this.$command.notify.emit("New message", { body:"...", tag:"chat", data:{room:7} }); },
     $on: { opened: (state, event) => { /* event.detail = {tag,data,action} */ } } -->
```
reactive 版は `notice` 属性バインド（同値抑制つき。スパム防止に debounce + `tag` 推奨）。

**camera/recorder** — 生 MediaStream は state に入れず要素間直結:
```html
<wcs-camera data-wcs="eventToken.streamReady: streamReady"></wcs-camera>
<wcs-recorder data-wcs="command.attachStream: $command.attachStream"></wcs-recorder>
<!-- $on: { streamReady: (state, ev) => state.$command.attachStream.emit(ev.detail) } -->
```

## 3. signals 早見表（`@wcstack/signals`）

### 位置づけ（state との使い分け）

- `@wcstack/state` は UI と状態を **HTML のパス文字列**（`data-wcs`）で接続し、コードにリアクティブプリミティブは現れない。`@wcstack/signals` は逆に **signal/computed/effect を直接露出**（DSL・`data-wcs` なし）。両者は競合ではなく**併存**。
- signals の v1 スコープ外: SSR/hydration・深い/proxy リアクティビティ（パスベース深追跡は state の領分）・ストリーム backpressure。
- API は TC39 Signals proposal の形に倣った自前極小実装。

### CDN 読み込み（1 ページ 1 エントリの原則）

```html
<script type="importmap">
{ "imports": { "@wcstack/signals/dom": "https://esm.run/@wcstack/signals/dom" } }
</script>
<script type="module">
  import { signal, computed, effect, h, render, For, bindNode } from "@wcstack/signals/dom";
</script>
```

> **既知の罠**: CDN では各エントリがコア内蔵の自己完結バンドルになるため、`@wcstack/signals` と `@wcstack/signals/dom` を 1 ページで混在 import すると**リアクティブコアが二重化**して継ぎ目で反応性が壊れる。CDN ページでは全てを単一の `/dom` エントリから import する（`/dom` はコア全体を再エクスポート）。ローカル npm / バンドラではこの制約なし。

### 基本 API（コア）

```js
const count = signal(0);                       // .get()=読み取り+追跡 / .peek()=追跡なし / .set(v)
const doubled = computed(() => count.get() * 2); // 遅延・メモ化・equality short-circuit
effect(() => { console.log(doubled.get()); });   // 初回即時、以降マイクロタスクに coalesce
count.set(1);        // 次のマイクロタスクで effect 再実行
flushSync();         // 同期フラッシュ（テストで DOM を読み戻す時）
createRoot((dispose) => { /* この中の effect/リソースは dispose で一括破棄 */ });
onCleanup(fn);       // 現在のオーナーに破棄処理を登録
```

### DOM レイヤ（`h` / `render` / `SignalsElement`）

`h(tag, props, ...children)` は実 DOM を一度だけ構築、関数/signal の prop・child だけが個別 effect で更新（VDOM なし）。`onXxx` prop はイベントリスナ。カスタム要素は `SignalsElement` を継承して `render()` のみ実装（connect でマウント・disconnect で全 effect 破棄）。

### keyed リスト — `For` / `Index`

```js
const todos = signal([{ id: 1, text: "a" }, { id: 2, text: "b" }]);
h("ul", null, For(todos, (t, index) => h("li", null, () => `${index()}: ${t.text}`), { key: (t) => t.id }));
// プリミティブ配列は Index: each は (item: () => T, index: number)
h("ul", null, Index(nums, (n) => h("li", null, () => String(n() * 2))));
```

素のリアクティブ child（`() => items.map(render)`）は毎回全再生成するのでリストには必ず For/Index。キー既定は `===`、重複キーは throw。`each` は単一 Node を返す。

### 非同期 — `resource` / `streamResource`

```js
const user = resource(
  async (userId, signal) => (await fetch(`/api/users/${userId}`, { signal })).json(),
  { args: () => id.get() },  // args 内で読んだ signal 変化 → 前を abort して再起動（switchMap）
); // user.value / user.loading / user.error は読み取り専用 signal

const log = streamResource((args, signal) => openLogStream(signal), {
  fold: (acc, chunk) => [...(acc ?? []), chunk], initial: [],
}); // log.value / log.status ("idle"|"active"|"done"|"error") / log.error。backpressure なし・fold は有界に
```

強い契約: `source` は渡される `AbortSignal` を必ず honor すること（これが restart/dispose を駆動）。

### wc-bindable ブリッジ — `bindNode`（I/O ノードを signal 化）

```js
await customElements.whenDefined("wcs-fetch");
const bound = bindNode(fetchEl);              // descriptor は constructor.wcBindable から自動取得
bound.signals.value.get();                    // 出力 property → 読み取り専用 signal（同値ガード）
bound.on("fired", { fold, initial });         // event-token ストリーム（同値でも毎回）
bound.set("url", v);                          // input へ命令的書き込み
bound.bindInput("url", someSignal);           // signal → input のリアクティブ反映（ループはガード）
bound.command("fetch", ...args);              // command 呼び出し
bound.bindCommand("start", trigger, mapArgs); // trigger 変化で command 起動（初期値では発火しない）
bound.dispose();                              // 全解除（冪等・以後 inert）
```

型付けは `bindNode<FetchShape>(el)`。実戦パターン: `effect(() => bound.set("url", ...))` で query → `<wcs-fetch>` 自動 fetch → `bound.signals.value` を `computed` で読み `For` で描画（examples/signals-live-search）。

### 安定度

コア（signal/computed/effect/createRoot/onCleanup/flushSync）と resource/streamResource は **Stable**。`bindNode`/`nodeSource` と DOM レイヤ（h/For/Index/SignalsElement）は **Evolving**（マイナーで変わりうる）。
