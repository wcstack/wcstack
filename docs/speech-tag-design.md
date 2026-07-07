# 設計メモ: `@wcstack/speech`（`<wcs-speak>` / `<wcs-listen>`）

- **状態**: 実装済み（`packages/speech`）。本文書は実装時の論点整理と決定事項の記録。
- **対象 WebAPI**: SpeechSynthesis（TTS / 発話）＋ SpeechRecognition（STT / 認識）
- **位置づけ**: command-token と event-token の**双対をパッケージ単位で実証するショーケース**。加えて command-token に「引数束縛付き起動」を一級市民として導入する参照実装。
- **前提資産**: geolocation（二相＋permission＋never-throw＋secure-context＋Core/Shell分割）、clipboard（command/event 双対）、debounce（同一パッケージ2サーフェス共存）、command-token / event-token プロトコル、wc-bindable protocol v1。

---

## 0. 大前提: speech は2つの別物の束

| | SpeechSynthesis（TTS / 発話） | SpeechRecognition（STT / 認識） |
|---|---|---|
| 方向 | 出力（state → 副作用） | 入力（イベント → state） |
| プロトコル | command-token（発話を起動） | event-token（結果を受ける） |
| permission | 不要 | マイク必須（Permissions API 名 `"microphone"`） |
| ブラウザ対応 | 広い | Chrome 系・`webkit` プレフィクスのみ |
| ライフサイクル | utterance キュー（一発の連続） | セッション（start/stop、無音で自動終了） |
| 雛形 | clipboard の command 側 | geolocation の二相＋permission |

この非対称性が以降ほぼ全ての論点の根。

---

## 1. パッケージ／タグ構成 — **決定: 案B**

- ~~案A: `<wcs-speech>` 単一タグで両方~~ — permission 有無・対応ブラウザ・方向が違うものを1要素に同居させ属性面が混乱。不採用。
- **案B: `<wcs-speak>`（発話）＋ `<wcs-listen>`（認識）の2タグ／1パッケージ** ✅
  - debounce の `<wcs-debounce>`＋`<wcs-throttle>`（2サーフェス・1パッケージ・Core共存）と同型。
  - Core は別々（`SpeakCore` / `ListenCore`）。
- ~~案C: パッケージごと分割~~ — 技術的には筋が通るが、**双対の同居というこのパッケージの存在意義（ショーケース性）が薄れる**ため不採用。

> 設計意図の明文化: **双対はタグ単位ではなくパッケージ単位**で成立する。発話=command-token の `<wcs-speak>` と認識=event-token の `<wcs-listen>` が**同居していること自体**がショーケースである。

---

## 2. `<wcs-speak>`（TTS）側の論点

- **発話テキストの供給** → §5 のペイロード束縛で確定（reactive `say` / imperative `speak` の二系統）。
- **voices の非同期ロード**: `getVoices()` は初回空、`voiceschanged` 後に確定。`voices` を state プロパティとして公開し非同期確定を吸収（fetch の loading に相当する小さな二相）。voice 選択は name / lang。
- **キューか割り込みか**: `speechSynthesis` は既定でキュー。`speak`（追加）と `cancel`→`speak`（割り込み）の双方を、別 command か mode 属性で提供。
- **boundary ハイライト**: `boundary` イベントで `charIndex` / 現在の単語を event-token プロパティ化すると「読んでいる単語をハイライト」が可能。デモ映えの目玉。粒度（word/sentence）は要検討。
- **状態プロパティ**: `speaking` / `paused` / `pending` / `error`。`speaking@false` を他要素のトリガに転用可。
- **utterance パラメータ**（inputs）: `rate` / `pitch` / `volume` / `voice` / `lang`。

## 3. `<wcs-listen>`（STT）側の論点

- **geo と同じ二相**: 一発認識 vs 連続。`manual` / `watch` / `trigger` / `start()`/`stop()`/`abort()` を geo から流用。
- **interim と final の二系統**: `interimResults` の逐次途中経過（高頻度更新の event-token ストリーム）と確定結果を `interimTranscript` / `finalTranscript` に分離。interim は更新が激しく **debounce 前提**。
- **結果のデータ形状**: `SpeechRecognitionResultList`（alternatives＋confidence）を、geo の `WcsGeoPositionDetail` のように **structured-clone-friendly な detail**（transcript / confidence / alternatives[]）に正規化。
- **自動再開（最大の罠）**: 連続モードでも無音や `end` で停止する。websocket/sse の reconnect 相当の auto-restart が要るが、**エラー連鎖で無限ループ／クォータ枯渇**を起こしやすい。再開回数の上限・backoff を必ず設計に入れる。
- **permission**: geo の `prompt`/`granted`/`denied`/`unsupported` を流用、名は `"microphone"`。
- **vendor prefix / 非対応**: `webkitSpeechRecognition` フォールバック＋`unsupported` state。

---

## 4. 横断（既存パターン踏襲）

- **Core/Shell 分割** / **never-throw** / **secure-context ガード** / **`unsupported` state** / **autoTrigger** は wakelock・geo を踏襲。
- **permission 基盤**: STT がマイク permission を要する。将来 `wcs-permission` を作るなら STT が最初の実利用者。

---

## 5. command-token のペイロード束縛 — **決定: 案1・案2 を両採用（住み分け）**

geo の `trigger` は「fire のみ」のモーメンタリだが、発話は**テキストというペイロードを動的に渡す**必要がある。これは command-token に無かった新論点。両案を**発火条件で住み分ける**ことで冗長にならず、reactive／imperative の両ユースケースを覆う。

| | 案1: input-as-trigger（reactive） | 案2: command＋引数束縛（imperative） |
|---|---|---|
| プロパティ名 | **`say`** | **`speak`** |
| 発火条件 | 束縛元の値が**変化したとき**自動発火 | command を**明示起動したとき** |
| ペイロード | 書き込まれた値そのもの | 起動時点の束縛パスの**スナップショット** |
| same-value | **再発火しない**（同値ガードあり） | **毎回発火する**（同値でも撃ち直す） |
| 典型用途 | ステータス読み上げ・a11y ライブリージョン | ボタン押下で読む・「もう一度読む」 |
| 構文例 | `say: statusMessage`（`\|debounce` 推奨） | `command.speak: composedText` |
| wc-bindable | `inputs`（副作用付き setter） | `commands`（引数あり） |

- **両者を分ける軸は「same-value で再発火するか」**。sse / spread で確立した same-value ガードをそのまま流用し、**案1にはガードを効かせ、案2には効かせない**。「同じ文をもう一度」は構造的に案2の領分。
- **命名衝突回避**: geo で Core の `watch()` が `watch` boolean と衝突し `watchPosition` に改名した前例に倣い、**同名 `speak` を input と command の両方に割り当てない**。reactive=`say` / imperative=`speak` で protocol サーフェスも名前も分離。
- **案1のゲーティング（必須）**: `<input>` の value に直結すると1キーストロークごとに発話するため「案1は debounce タグ前提」と明記し、example も `say: text|debounce` で見せる。manual/gating 属性で案1を一時停止可能にする（echo ループ対策＝発話中は案1抑止、にも転用）。

### プロトコルへの含意

> **補正（調査済み）**: 案2の「引数あり起動」は command-token に**既に実装・文書化・実例済み**。`emit(...args)` が `Reflect.apply(method, el, args)` で素通し転送し（`token/Token.ts` / `apply/applyChangeToCommand.ts`）、state README にも「emit に渡した引数はそのまま要素のメソッドへ転送される」と明記、examples（cross-tab-todo の `announce.emit({...})`、websocket の `wsSend.emit(...)`）でも稼働している。clipboard `writeText(text)` / fetch `fetch(url, options)` も同様。

したがって案2は**新機能ではなく、SPEC が黙っている既存挙動の規範化（相互運用保証）**である。`<wcs-speak>.speak(text)` はその素直な利用例。改訂提案は `docs/spec-proposal-command-token-arguments.md` に分離した（undefined-write 提案と同型の clarification 扱い）。`<wcs-speak>` 実装側で新たに必要な作業は無く、binder の引数転送経路を利用するだけ。

---

## 6. STT→state→TTS エコーループ（デモのキラー＆罠）

「認識結果を state に入れ TTS で読み返す」がパッケージ双対のデモ。一方で **TTS 出力をマイクが拾い再認識する自己ループ**が起きる。発話中は認識を一時停止する相互排他（`speaking` ⇔ listen 抑止）をデモで示し、§5 の案1 gating をその実装手段に使う。

---

## 7. 値サーフェス草案（geo types.ts 同型・未確定）

`<wcs-speak>` SpeakCore（観測プロパティ）:

```
voices: SpeechVoiceInfo[]      // voiceschanged で確定
speaking: boolean
paused: boolean
pending: boolean
charIndex: number | null       // boundary ハイライト用
spokenWord: string | null      // 同上
error: WcsSpeakErrorDetail | null
unsupported: boolean
```

inputs: `say`（reactive trigger）, `rate`, `pitch`, `volume`, `voice`, `lang`, `manual`
commands: `speak(text)`（引数束縛＝案2）, `cancel()`, `pause()`, `resume()`

`<wcs-listen>` ListenCore（観測プロパティ）:

```
interimTranscript: string
finalTranscript: string
result: WcsListenResultDetail | null   // transcript / confidence / alternatives[]
listening: boolean
permission: PermissionState            // prompt/granted/denied/unsupported
error: WcsListenErrorDetail | null
unsupported: boolean
```

inputs: `lang`, `continuous`, `interim`, `maxRestarts`, `watch`, `manual`, `trigger`
commands: `start()`, `stop()`, `abort()`

---

## 8. 実装順の推奨

1. **`<wcs-speak>` を先行** — permission 不要・対応広・**案2（command-token 引数束縛）の実証**になる。
2. 次に **`<wcs-listen>`** — geo の二相＋permission をほぼ流用、auto-restart の上限設計のみ新規。
3. example の目玉に **boundary ハイライト** と **echo デモ** を据える。
4. command-token-protocol へ「引数あり起動」の規範化提案 → **作成済み**: `docs/spec-proposal-command-token-arguments.md`（既存挙動の clarification）。
