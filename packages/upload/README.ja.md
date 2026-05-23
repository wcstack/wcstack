# @wcstack/upload

`@wcstack/upload` は wcstack エコシステム向けの宣言的ファイルアップロードコンポーネントです。

視覚的な UI ウィジェットではありません。
ファイルアップロードをバインド可能な状態へ変換する、隠れた **upload I/O ノード** です。

`@wcstack/state` と組み合わせると、`<wcs-upload>` は次のような小さな非同期ステートサーフェスを公開します。

- 入力 / コマンドサーフェス: `files`, `trigger`
- 設定サーフェス: `url`, `method`, `field-name`, `accept`, `max-size`, `manual`, `multiple`
- 出力ステートサーフェス: `value`, `loading`, `progress`, `error`, `status`

つまり、ファイルアップロードを場当たり的な `XMLHttpRequest` のグルーコードではなく、状態遷移と DOM バインディングとして扱えます。

`@wcstack/upload` は wcstack の他の I/O パッケージと同様に、HAWC 的な分割に従います。

- **Core** (`UploadCore`) が XHR アップロード、進捗追跡、abort、非同期状態を処理
- **Shell** (`<wcs-upload>`) がその状態をカスタム要素と `wc-bindable` サーフェスとして公開
- フレームワークやバインディングシステムは `wc-bindable-protocol` 経由で利用

## なぜこれが存在するのか

ファイルアップロードは、実際には複数の関心事に分散しがちです。

- ファイル入力の取得
- `FormData` の組み立て
- progress イベント
- loading フラグ
- エラー処理
- 切断時の abort

`@wcstack/upload` はそのロジックを再利用可能なコンポーネントへ移し、結果をバインド可能な状態として公開します。

## インストール

```bash
npm install @wcstack/upload
```

## クイックスタート

### 1. `files` を代入すると自動アップロード

```html
<script type="module" src="https://esm.run/@wcstack/upload/auto"></script>

<wcs-upload id="avatar-upload" url="/api/upload"></wcs-upload>
<input id="avatar-input" type="file" accept="image/*">

<script type="module">
  const upload = document.getElementById("avatar-upload");
  const input = document.getElementById("avatar-input");

  input.addEventListener("change", () => {
    upload.files = input.files;
  });

  upload.addEventListener("wcs-upload:progress", (event) => {
    console.log("progress", event.detail);
  });

  upload.addEventListener("wcs-upload:response", (event) => {
    console.log("uploaded", event.detail.value);
  });
</script>
```

デフォルト動作は次のとおりです。

- `files` を代入すると即座にアップロード開始
- 送信形式は `multipart/form-data`
- リクエストメソッドのデフォルトは `POST`
- フィールド名のデフォルトは `file`

### 2. `trigger` による手動アップロード

先にファイルを選び、後からアップロードしたい場合は `manual` を使います。

```html
<script type="module" src="https://esm.run/@wcstack/upload/auto"></script>

<wcs-upload id="resume-upload" url="/api/upload" manual></wcs-upload>

<input id="resume-input" type="file">
<button id="resume-button">Upload</button>

<script type="module">
  const upload = document.getElementById("resume-upload");
  const input = document.getElementById("resume-input");
  const button = document.getElementById("resume-button");

  input.addEventListener("change", () => {
    upload.files = input.files;
  });

  button.addEventListener("click", () => {
    upload.trigger = true;
  });
</script>
```

`trigger` は単方向のコマンドサーフェスです。

- `true` を書き込むと `upload()` を開始
- 完了後に自動で `false` へ戻る
- そのリセット時に `wcs-upload:trigger-changed` を発火

観測できるのは `false` へのリセットのみです。`true` 遷移（アップロード開始）は `wcs-upload:trigger-changed` を発火しません。バインディングシステムは `true` を書き込んで開始し、唯一の `false` エッジを観測してコマンドの完了を知ります。これは `@wcstack/fetch` の `trigger` と同じトレードオフです。

### 3. 宣言的なトリガーターゲット

自動トリガーが有効な場合、クリック可能な要素から id で `<wcs-upload>` を参照できます。

```html
<script type="module" src="https://esm.run/@wcstack/upload/auto"></script>

<wcs-upload id="photo-upload" url="/api/upload" manual></wcs-upload>
<input id="photo-input" type="file">
<button data-uploadtarget="photo-upload">Upload</button>

<script type="module">
  const upload = document.getElementById("photo-upload");
  const input = document.getElementById("photo-input");

  input.addEventListener("change", () => {
    upload.files = input.files;
  });
</script>
```

デフォルトのトリガー属性名は `data-uploadtarget` です。

### 4. `@wcstack/state` と組み合わせる

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/upload/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      uploadResult: null,
      uploadLoading: false,
      uploadProgress: 0,
      uploadError: null,
    };
  </script>

  <wcs-upload
    id="state-upload"
    url="/api/upload"
    manual
    data-wcs="
      value: uploadResult;
      loading: uploadLoading;
      progress: uploadProgress;
      error: uploadError
    ">
  </wcs-upload>

  <input id="state-upload-input" type="file">
  <button data-uploadtarget="state-upload">Upload</button>

  <progress max="100" data-wcs="value: uploadProgress"></progress>
  <p data-wcs="textContent: uploadLoading"></p>

  <script type="module">
    const upload = document.getElementById("state-upload");
    const input = document.getElementById("state-upload-input");

    input.addEventListener("change", () => {
      upload.files = input.files;
    });
  </script>
</wcs-state>
```

この構成では、アップロードはバインド可能な非同期ノードになります。

- 要素がリクエストを実行
- 非同期状態が `value`, `loading`, `progress`, `error`, `status` として返る
- UI はそれらのパスへ宣言的にバインド

## 公開 API

### 要素属性とプロパティ

| 名前 | 型 | デフォルト | 説明 |
|---|---|---|---|
| `url` | `string` | `""` | アップロード先エンドポイント |
| `method` | `string` | `"POST"` | HTTP メソッド |
| `field-name` | `string` | `"file"` | FormData のフィールド名 |
| `multiple` | `boolean` | `false` | 複数ファイル対応を表す宣言用フラグのみ。ファイル数を強制しない（`multiple` の有無に関わらず `files` のファイルはすべて送信される） |
| `max-size` | `number` | `Infinity` | 許容最大ファイルサイズ（byte） |
| `accept` | `string` | `""` | 許可する MIME type または拡張子 |
| `manual` | `boolean` | `false` | `files` 代入時の自動アップロードを無効化 |
| `files` | `FileList \| File[] \| null` | `null` | アップロード対象ファイル |
| `trigger` | `boolean` | `false` | 手動アップロード用の書き込みコマンド面 |
| `value` | `any` | `null` | パース済みレスポンスまたはレスポンステキスト |
| `loading` | `boolean` | `false` | アップロード中フラグ |
| `progress` | `number` | `0` | `0` から `100` の進捗率 |
| `error` | `any` | `null` | バリデーション、ネットワーク、レスポンスのエラー |
| `status` | `number` | `0` | HTTP レスポンスステータス |
| `promise` | `Promise<any>` | resolved `null` | 現在のアップロード Promise |

### メソッド

#### `upload()`

現在の `files` を使ってアップロードを開始し、promise を返します。

この promise はすべての終了ケースで **resolve** し、reject しません。

- 成功 → パース済みレスポンスボディ（`value`）で resolve
- ファイル未指定 / `url` 未指定 → `null` で resolve（no-op。リクエストは開始されずエラーも発火しない）
- バリデーション失敗 → `null` で resolve（`wcs-upload:error` を発火）
- HTTP エラー（status >= 400）→ `null` で resolve（エラー内容は `error` / `wcs-upload:error` で取得）
- ネットワークエラー → `null` で resolve（エラー内容は `error` / `wcs-upload:error` で取得）
- 中断（abort）→ `null` で resolve

`null` は正常な resolve 値でもあるため、失敗判定に resolve 値を使わないでください。代わりに `error` / `status`（または `wcs-upload:error` / `wcs-upload:response` イベント）を観測します。これは `@wcstack/fetch` と同じ設計で、エラーは promise の reject ではなく状態として流れます。

> ヘッドレス Core についての注記: `UploadCore.upload(url, files)` は `async` で、同期的に検出できる引数エラー（`url` 欠落・`files` が空）は `[@wcstack/upload] ...` を throw して **reject** します。Shell の `upload()` は `url` 未指定・ファイル未指定を no-op として扱い `null` を返します（Shell が `url`／ファイルのライフサイクルを所有しており「送信先無し」「ファイル無し」をエラーではなく無操作とみなすため）。これにより Shell は Core の throw に到達せず reject しません。

#### `abort()`

現在のリクエストを中断します。loading の解除はリクエストの abort 経路を通じて行われます（`@wcstack/fetch` と一貫）。

## イベント

| イベント | `detail` | 説明 |
|---|---|---|
| `wcs-upload:files-changed` | `FileList \| File[] \| null` | `files` 変更時に発火 |
| `wcs-upload:trigger-changed` | `boolean` | `trigger` が `false` に戻るとき発火 |
| `wcs-upload:loading-changed` | `boolean` | loading 状態変更時に発火 |
| `wcs-upload:progress` | `number` | アップロード進捗更新時に発火 |
| `wcs-upload:error` | error object | バリデーション、ネットワーク、HTTP エラー時に発火 |
| `wcs-upload:response` | `{ value, status }` | HTTP 成功レスポンス時に発火 |

## バリデーション

`<wcs-upload>` は送信前にファイルを検証します。

- `max-size` は指定 byte 数を超えるファイルを拒否
- `accept` は `image/*` のような MIME 範囲、`application/pdf` のような厳密 MIME、`.pdf` のような拡張子をサポート

`type` が空のファイル（OS が MIME を判定できなかったファイル）は MIME パターンと照合できません。この場合、`accept` に一致する拡張子パターン（例: `.png`）が含まれていれば受理されます。`accept` が MIME パターンのみの場合は、型を確認できないため空 type のファイルは拒否されます。

バリデーションに失敗すると `wcs-upload:error` を発火し、リクエストは開始されません。

### 状態サーフェスにおける error と response

成功レスポンス（status 2xx）では `value` と `status` の両方が `wcs-upload:response` 経由で更新されます。HTTP エラー（status >= 400）では `error` のみが（`wcs-upload:error` 経由で）更新され、**エラー時に `status` は状態サーフェスへ伝播しません**。これは `status` が `wcs-upload:response` イベントにバインドされており、エラー時はそのイベントが発火しないためです。HTTP ステータスコードは `error` オブジェクト内（`error.status`）で取得できます。これは `@wcstack/fetch` と同じトレードオフで、エラー詳細は response/error に分散させず単一の `error` チャネルに集約します。

> `core.status` / `el.status` を直接読むと、`413` や `500` などのエラーステータスも含め、直近レスポンスの HTTP ステータスが返ります（getter は生の XHR ステータスを反映するため）。これはバインド経路の `status`（`wcs-upload:response` 駆動）とは異なり、バインド経路はエラー時には前回値のまま据え置かれます。したがって getter を命令的に直接読むコードと `status` にバインドするコードでは、HTTP エラー後に観測値が食い違います。どちらか一方の経路に統一してください。これは `@wcstack/fetch` と同じ構造です。

### エラー時の progress

`progress` は各アップロード開始時に `0` へリセットされ、成功時に `100` へ設定されるだけです。HTTP・ネットワーク・abort のエラー時は、**`progress` は意図的に直前の値（例: `70`）のまま据え置かれます**。これは転送がどこで止まったかを UI が示せるようにするためです。失敗の検出には `progress` ではなく `error` / `loading` を使い、古い値を表示したくない場合は `wcs-upload:error` に応じて UI 側で進捗表示をリセット / 非表示にしてください。次回の `upload()` で `progress` は再び `0` にリセットされます。

## wc-bindable-protocol

`UploadCore` と `<wcs-upload>` はいずれも `wc-bindable-protocol` 準拠を宣言しており、プロトコルをサポートするあらゆるフレームワークやコンポーネントと相互運用できます。

宣言は wc-bindable インターフェースモデルの全体に従い、3 つの独立したサーフェスを持ちます。

- **`properties`** — `bind()` が購読する観測可能な出力（`value`, `loading`, `progress`, `error`, `status`、および Shell の `trigger` / `files`）
- **`inputs`** — 設定可能サーフェス（`url`, `method`, `fieldName`, …）。ツール・codegen・リモートプロキシが読む記述的メタデータ
- **`commands`** — 呼び出し可能メソッド（`upload`, `abort`）。`@wcstack/state` のようなバインディングシステムが名前で呼び出せる

プロトコル上、コアの `bind()` が解釈するのは `properties` のみです。`inputs` / `commands`（および `attribute` / `async` ヒント）は記述的であり、暗黙の双方向データフローを生成しません。

### Core (`UploadCore`)

`UploadCore` は、任意のランタイムが購読できるバインド可能な非同期状態に加え、移植可能な入力 / コマンドサーフェスを宣言します。

```typescript
static wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "value",    event: "wcs-upload:response",
      getter: (e) => e.detail.value },
    { name: "loading",  event: "wcs-upload:loading-changed" },
    { name: "progress", event: "wcs-upload:progress" },
    { name: "error",    event: "wcs-upload:error" },
    { name: "status",   event: "wcs-upload:response",
      getter: (e) => e.detail.status },
  ],
  inputs: [
    { name: "url" },
    { name: "method" },
    { name: "fieldName" },
  ],
  commands: [
    { name: "upload", async: true },
    { name: "abort" },
  ],
};
```

Headless 利用では `core.upload(url, files)` を直接呼び出します（`trigger` は不要）。

### Shell (`<wcs-upload>`)

Shell は Core の宣言を継承し、`trigger` / `files` 出力と DOM 駆動の入力サーフェスを追加します。`commands`（`upload` / `abort`）は spread でそのまま継承されます。

```typescript
static wcBindable = {
  ...UploadCore.wcBindable,
  properties: [
    ...UploadCore.wcBindable.properties,
    { name: "trigger", event: "wcs-upload:trigger-changed" },
    { name: "files",   event: "wcs-upload:files-changed" },
  ],
  inputs: [
    { name: "url" },
    { name: "method" },
    { name: "fieldName" },
    { name: "multiple" },
    { name: "maxSize" },
    { name: "accept" },
    { name: "manual" },
    { name: "files" },
    { name: "trigger" },
  ],
};
```

Shell の inputs は意図的に `attribute` ヒントを持ちません。属性に紐づく各 setter（`url`, `method`, `fieldName`, `multiple`, `maxSize`, `accept`, `manual`）はすでに自身で属性へ反映するため、`inputs[].attribute` をミラーするバインディングシステムが属性を二重に設定してしまうのを避けるためです。

これにより、`@wcstack/state` を含むあらゆる wc-bindable 対応システムから利用できます。

## Headless API

カスタム要素の shell が不要な場合は、`UploadCore` を直接使えます。

```ts
import { UploadCore } from "@wcstack/upload";

const core = new UploadCore();
const result = await core.upload("/api/upload", files, {
  method: "PUT",
  fieldName: "attachment",
  headers: {
    Authorization: "Bearer token",
  },
});
```

`UploadCore` は同じ非同期状態をプロパティとして公開し、同じイベントを発火します。

## 手動 bootstrap

```ts
import { bootstrapUpload } from "@wcstack/upload";

bootstrapUpload({
  autoTrigger: true,
  triggerAttribute: "data-uploadtarget",
  tagNames: {
    upload: "wcs-upload",
  },
});
```

`@wcstack/upload/auto` に頼らず、タグ名やトリガー属性名をカスタマイズしたい場合に使います。