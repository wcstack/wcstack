# @wcstack/speech

`@wcstack/speech` は wcstack エコシステム向けの、ヘッドレスな Web Speech コンポーネント2点セットです。

これらは視覚的な UI ウィジェットではありません。`@wcstack/fetch` がネットワークリクエストを、`@wcstack/geolocation` が現在地をリアクティブな状態に変えるのと同じように、ブラウザの Web Speech API を**リアクティブな状態に変える非同期プリミティブノード**です。

同一プロトコルの両半身となる2つのタグを提供します:

| タグ | API | 向き | プロトコル上の役割 |
|---|---|---|---|
| **`<wcs-speak>`** | SpeechSynthesis（TTS） | state → 音声 | command-token（state が発話を駆動） |
| **`<wcs-listen>`** | SpeechRecognition（STT） | 音声 → state | event-token（認識結果が state へ流れる） |

両者が1つのパッケージに同居していること自体が要点です。`<wcs-speak>` は **command 駆動の出力**、`<wcs-listen>` は **event 駆動の入力**のショーケース。両者を繋げば speak ⇄ listen のループになります。

いずれも [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core**（`SpeakCore` / `ListenCore`）はネイティブ API のラップ・データ正規化・ライフサイクル/permission 管理を担い、決して throw しません（失敗は `error` で表面化）。
- **Shell**（`<wcs-speak>` / `<wcs-listen>`）はそれを DOM 属性・ライフサイクル・宣言的コマンドに接続します。
- **Binding Contract**（`static wcBindable`）が観測可能な `properties`・書き込み可能な `inputs`・呼び出し可能な `commands` を宣言します。

## インストール

```bash
npm install @wcstack/speech
```

ビルドレス（CDN・両タグ登録）:

```html
<script type="module" src="https://esm.run/@wcstack/speech/auto"></script>
```

---

## `<wcs-speak>` — 音声合成

### 発話の2つの方法

`<wcs-speak>` は同じ「発話」という動作を、**いつ発火するか**が異なる2つのサーフェスで提供します:

```html
<!-- 1. reactive: status が変わるたびに発話（同値は再発話しない） -->
<wcs-speak data-wcs="say: status"></wcs-speak>

<!-- 2. imperative: command token 経由で、同じ文でも都度発話 -->
<wcs-speak data-wcs="command.speak: $command.announce"></wcs-speak>
```

```js
export default {
  $commandTokens: ["announce"],
  status: "準備完了。",
  onClick() {
    this.$command.announce.emit("もう一度クリックされました。");  // imperative — 同値でも発話
  },
};
```

| サーフェス | 発火条件 | 同値で再発話 | 用途 |
|---|---|---|---|
| `say`（reactive input） | 束縛値が**変化**したとき | しない（ガード） | ステータス・a11y アナウンス |
| `speak`（imperative command） | command が**起動**されたとき | する | 「クリックで読む」「もう一度読む」 |

> **ヒント:** `<input>` の value など高頻度ソースに束縛するときは `\|debounce` を挟まないと1キーストロークごとに発話します。`manual` 属性で `say` を完全にミュートできます（認識中の発話ミュート＝echo 回避のフックにもなります）。

### 単語境界ハイライト

`charIndex` / `spokenWord` は読み上げ中の単語に応じて更新されます。束縛すれば「いま読んでいる単語」をハイライトできます（カラオケ風）。

### 属性 / Inputs

| 属性 | Input | 型 | 既定 | 意味 |
|---|---|---|---|---|
| — | `say` | string | — | reactive: 新しい値を書くと発話 |
| `rate` | `rate` | number | `1` | 速度（0.1–10） |
| `pitch` | `pitch` | number | `1` | ピッチ（0–2） |
| `volume` | `volume` | number | `1` | 音量（0–1） |
| `voice` | `voice` | string | — | `name` で voice 選択 |
| `lang` | `lang` | string | — | BCP-47 言語タグ |
| `manual` | `manual` | boolean | `false` | `say` パスをミュート |

### 観測プロパティ（出力）

| プロパティ | 型 | 意味 |
|---|---|---|
| `voices` | `SpeechVoiceInfo[]` | 利用可能な voice（非同期で確定） |
| `speaking` | boolean | 発話中 |
| `paused` | boolean | 一時停止中 |
| `pending` | boolean | キューに発話あり |
| `charIndex` | number \| null | 読み上げ中の単語の位置 |
| `spokenWord` | string \| null | 読み上げ中の単語 |
| `error` | `WcsSpeakErrorDetail` \| null | 直近の失敗 |
| `unsupported` | boolean | SpeechSynthesis 非対応 |

### コマンド

| コマンド | 意味 |
|---|---|
| `speak(text)` | 発話をキュー（現在の `rate`/`pitch`/… 属性を使用） |
| `cancel()` | キューをクリアして停止 |
| `pause()` / `resume()` | 一時停止 / 再開 |

### DOM トリガ（任意）

`autoTrigger` 有効時（既定）、`data-speaktarget="<id>"` を持つ要素のクリックで、その `data-speaktext`（無ければ textContent）を `<wcs-speak id="<id>">` で発話します。

```html
<wcs-speak id="tts"></wcs-speak>
<button data-speaktarget="tts" data-speaktext="こんにちは！">読み上げ</button>
```

---

## `<wcs-listen>` — 音声認識

```html
<!-- 接続時に自動開始し、transcript を state に束縛 -->
<wcs-listen lang="ja-JP" interim data-wcs="finalTranscript: transcript; interimTranscript: draft"></wcs-listen>

<!-- manual・continuous・command 駆動 -->
<wcs-listen manual continuous max-restarts="5"
  data-wcs="command.start: $command.listen; finalTranscript: transcript; listening: isListening"></wcs-listen>
```

`<wcs-geo>` と同様に二相を持ちます: **一発**認識（既定）と、**連続**セッション（`continuous` 属性）。ブラウザは無音でセッションを終了しますが、自動再開は **`max-restarts` でのオプトイン**です — `continuous` **単独**（既定 `max-restarts="0"`）では無音で再開**しません**。`max-restarts="5"` で最大5回の無音をまたぎます。この上限は意図的です（無制限再開は無限ループ/クォータ枯渇のリスク）。

> **マイクの自動起動。** `manual` を付けないと `<wcs-listen>` は接続時に `start()` を呼びます — タグを DOM に置くだけで認識が始まります（permission プロンプト→継続キャプチャ）。**明示的な `start()` / DOM トリガ / `trigger` 書き込みを要求したい場合は `manual` を付けてください。** `<wcs-geo>` の `manual` 慣習に倣っていますが、マイクキャプチャはよりプライバシー感度が高い点に注意。

### 属性 / Inputs

| 属性 | Input | 型 | 既定 | 意味 |
|---|---|---|---|---|
| `lang` | `lang` | string | — | BCP-47 言語タグ |
| `continuous` | `continuous` | boolean | `false` | セッション継続＋end で自動再開 |
| `interim` | `interim` | boolean | `false` | 途中経過の interim を出す |
| `max-restarts` | `maxRestarts` | number | `0` | 自動再開の上限（continuous） |
| `manual` | `manual` | boolean | `false` | 接続時に自動開始しない |
| — | `trigger` | boolean | — | モーメンタリ: `false`→`true` で開始 |

### 観測プロパティ（出力）

| プロパティ | 型 | 意味 |
|---|---|---|
| `interimTranscript` | string | 未確定の途中テキスト |
| `finalTranscript` | string | 蓄積された確定テキスト |
| `result` | `WcsListenResultDetail` \| null | 直近結果（transcript / confidence / alternatives / isFinal） |
| `listening` | boolean | セッション中 |
| `permission` | `"prompt"\|"granted"\|"denied"\|"unsupported"` | マイク permission |
| `error` | `WcsListenErrorDetail` \| null | 直近の失敗 |
| `unsupported` | boolean | SpeechRecognition 非対応 |

### コマンド

| コマンド | 意味 |
|---|---|
| `start()` | セッション開始（transcript をリセット） |
| `stop()` | 穏やかに停止（自動再開しない） |
| `abort()` | 即時停止 |

### DOM トリガ（任意）

`data-listentarget="<id>"` を持つ要素のクリックで、対象 `<wcs-listen>` の `start()` / `stop()` をトグルします。

---

## 注意・制限

- **セキュアコンテキスト必須。** 両 API とも HTTPS か `localhost` が必要。`<wcs-listen>` はさらにマイク permission が必要です。
- **ブラウザ対応。** SpeechSynthesis は広く対応。SpeechRecognition は Chrome 系のみ（`webkitSpeechRecognition`）で、それ以外では `<wcs-listen>` は `unsupported` を報告します。
- **SpeechSynthesis はグローバルシングルトン。** `<wcs-speak>` は切断時に `cancel()` しません（他インスタンスまで止まるため）。音声を止めるには明示的に `cancel()` を。切断された要素は追跡を止めますが、発話中の utterance は自然に完了します。
- **echo ループ。** `<wcs-listen>` → state → `<wcs-speak>` を繋ぐときは、認識中は発話をミュート（例: `manual` を束縛）して合成音声が再認識されないように。echo の例を参照。

## ヘッドレス利用（`SpeakCore` / `ListenCore`）

どちらの Core もフレームワーク非依存で、カスタム要素なしに `@wc-bindable/core` の `bind()` 経由で利用できます:

```js
import { SpeakCore } from "@wcstack/speech";
const core = new SpeakCore();
core.speak("こんにちは。");
```

## ライセンス

MIT
