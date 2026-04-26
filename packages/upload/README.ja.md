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
| `multiple` | `boolean` | `false` | 複数ファイル対応を表すフラグ |
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
ファイル未指定またはバリデーション失敗時は `null` を返します。

#### `abort()`

現在のリクエストを中断します。

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

バリデーションに失敗すると `wcs-upload:error` を発火し、リクエストは開始されません。

## wc-bindable サーフェス

`<wcs-upload>` は次の bindable property を持つ `wcBindable` 定義を公開します。

- `value`
- `loading`
- `progress`
- `error`
- `status`
- `trigger`
- `files`

これにより、`@wcstack/state` を含む wc-bindable 対応システムから利用できます。

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