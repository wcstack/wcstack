# 設計メモ: `@wcstack/credential`（`<wcs-credential>`）

- **状態**: 実装済み（`packages/credential`）。本文書は実装時の論点整理と決定事項の記録。
- **対象 WebAPI**: Credential Management API（`navigator.credentials.get()` / `.store()`、`PasswordCredential` / `FederatedCredential`）
- **位置づけ**: [io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md) バッチ3（薄い一発commandパターン）の4本目にして最後。バッチ内で唯一「単一commandでなく2つの独立したcommand」を持つメンバーであり、バッチの中で最も複雑（実装順の最後に置かれている理由でもある）。
- **前提資産**: `fetch`（`_doFetch`の単一`_gen`・never-throw・try/catch、[FetchCore.ts](../packages/fetch/src/core/FetchCore.ts)）、`worker`（`_normalizeError`によるDOMException正規化、[WorkerCore.ts:312-318](../packages/worker/src/core/WorkerCore.ts#L312-L318)）、バッチ3共有アーキタイプ（`value`/`loading`/`error`/`cancelled`の最小Core、[io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md)バッチ3節）。

---

## 0. 大前提: 3種のcredentialを1つのsurfaceで扱うAPI形状 — v1は`publicKey`を完全に除外する

Credential Management APIは仕様上、`navigator.credentials.get()`/`.store()`という単一のsurfaceで **`password`（パスワード資格情報）・`federated`（フェデレーション認証）・`publicKey`（WebAuthn）** という3種類のcredentialを統一的に扱う。`get()`はこれらをオプションキーとして受け取り（`{password: true, federated: {...}, publicKey: {...}}`）、`store()`は返ってきた credential インスタンスの型で分岐する。

この統一APIをそのまま1つのIOノードに持ち込むと、WebAuthnの持つ巨大なsurfaceに引きずられてノードのスコープが崩壊する。以下を明示的・番号付きの決定として記録する。

1. **`publicKey`（WebAuthn）はv1スコープから完全に除外する** ✅ — `get()`/`store()`のオプションに`publicKey`キーを含めることはできない。
2. ~~`publicKey`もオプションとして受け付け、値をそのまま`navigator.credentials`へ転送する~~ — 不採用。WebAuthnは attestation（authenticatorからの証明書チェーン検証）・authenticator選択（platform vs cross-platform）・RP（Relying Party）設定・challenge/timeout/userVerification等のパラメータ群・`PublicKeyCredential`の戻り値整形など、password/federatedとは比較にならない大きさのsurfaceを持つ。これを本ノードに継ぎ足すと「薄い一発command」というバッチ3のアーキタイプそのものが崩れ、`value`/`loading`/`error`/`cancelled`という4プロパティに収まらない専用の観測面（authenticator状態、attestation結果等）が必要になる。
3. **WebAuthnは将来の専用ノード`<wcs-webauthn>`に切り出す** ✅ — 独立したCore/Shell、独立した`docs/webauthn-tag-design.md`を持つ別パッケージとする。本ノードとは無関係に設計・実装してよい（両者が同じ`navigator.credentials`名前空間を触ること自体は衝突しない。`get()`を同時に呼べば後勝ちでブラウザのUIが競合するが、これは同一ページ内で認証UIを二重に起動する利用者側の設計ミスであり、ノード側で相互排他を仕組む必要はない）。

これが本ドキュメントで最も重要なスコープ境界の決定であり、以降の全論点（§2の`get()`引数検証、§3の観測面設計）はこの決定を前提にする。

---

## 1. 存在意義

- **宣言的なログインフォーム連携**: フォーム送信成功後に`store()`を呼びブラウザのパスワードマネージャへ保存を促す、ページロード時に`get()`を呼びサイレントサインインを試みる、という2つの定型フローを`command.get:` / `command.store:`だけで配線できる。
- **`fetch`との組み合わせ**: `get()`で得た credential を`FormData`/JSONに詰めて`<wcs-fetch>`の`fetch()`へ渡す、というノード間連携が典型ユースケースになる（credential自体はネットワーク転送しない設計判断は§4）。
- password/federatedのみに絞ることで、バッチ3の他メンバー（Web Share / EyeDropper / Contact Picker）と同型の「薄いcommand+never-throw」を保ったまま提供できる。WebAuthnまで含めた「認証全部盛りノード」を目指さない。

---

## 2. `properties` — `cancelled`を持つか **決定: 持つ**

バッチ3共有アーキタイプの`value`/`loading`/`error`/`cancelled`をそのまま踏襲する。

```typescript
static wcBindable: IWcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "value",     event: "wcs-credential:complete",        getter: e => (e as CustomEvent).detail.value },
    { name: "loading",   event: "wcs-credential:loading-changed" },
    { name: "error",     event: "wcs-credential:error" },
    { name: "cancelled", event: "wcs-credential:cancelled-changed" },
  ],
  commands: [
    { name: "get",   async: true },
    { name: "store", async: true },
  ],
};
```

**`cancelled`が必要かの検討**: `navigator.credentials.get()`は、ユーザーがブラウザのネイティブなアカウント選択UI（credential picker）を明示的に閉じた／選択せず却下した場合、`NotAllowedError`でrejectする（Chromium/WebKit実測。仕様上も「ユーザーの拒否」は`NotAllowedError`に分類される）。これは「APIが使えない」「権限がない」「ネットワーク的な失敗」とは性質が異なる——**ユーザーが単に選ばなかっただけ**の結果であり、Web Shareの`AbortError`（共有シートを閉じた）と同じ位置づけの「真の失敗ではないキャンセル」である。

- **決定: `cancelled`プロパティを追加する** ✅ — バッチ3アーキタイプ（[io-node-batch-implementation-plan.md](./io-node-batch-implementation-plan.md)バッチ3節）の決定「`cancelled`を`error`から独立させる。`AbortError`（ユーザーがダイアログを閉じた等）は失敗ではないため、`error`には含めない」をそのまま踏襲し、Web Shareとの一貫性を優先する。
- 判定方法: `get()`/`store()`のreject時、`err.name === "NotAllowedError"`であれば`cancelled`をtrueにし`error`は変更しない（nullのまま）。それ以外の名前（`SecurityError`、`NetworkError`等）は`error`へ流し`cancelled`は変更しない。
- 同値ガード対象（§3.3のMUST）。`get`/`store`呼び出し開始時に両方falseへリセットしてから実行する（Web Shareの`cancelled-changed`パターンと同型）。

---

## 3. `commands` — `get()` と `store()`

### 3.1 `get(options)`

```typescript
async get(options: WcsCredentialGetOptions = {}): Promise<any>
```

`CredentialRequestOptions`形状のオブジェクト引数を取るが、v1では`password`/`federated`キーのみを許可する。

**`publicKey`キーの扱い — 決定: 明示的にvalidateして除去し、スコープ違反として`error`で表面化させる**

呼び出し引数に`publicKey`キーが含まれていた場合、それを黙って`navigator.credentials.get()`へ転送してはならない。理由:

- 黙って転送すると、たまたま`publicKey`オプションが有効な形をしていれば実際にWebAuthnフローが起動してしまう。これは§0で明示的にスコープ外と決めた機能を、バリデーションの不在という**裏口**から誤って対応してしまうことに等しく、決定1〜3の意味が失われる。
- したがって`get()`は引数を検査し、`publicKey`キーが存在すれば**呼び出し自体を中断**し、`_setError({ name: "NotSupportedError", message: "publicKey (WebAuthn) is out of scope for wcs-credential; use a dedicated <wcs-webauthn> node." })`のような明確な`error`を発火して`null`を返す。実プラットフォームAPIは一切呼ばない。
- `password`/`federated`のみのオプションはそのまま`navigator.credentials.get({ password, federated, mediation, signal })`へ渡す（`mediation`は`get()`の呼び出しタイミング制御に必要なため許可する。WebAuthn固有ではない）。

### 3.2 `store(credential)`

```typescript
async store(credential: WcsCredentialLike): Promise<any>
```

credential的なオブジェクト引数（`{ id, password, ... }`または`{ id, provider, ... }`）を取り、`PasswordCredential`/`FederatedCredential`コンストラクタへ渡してインスタンス化してから`navigator.credentials.store()`へ渡す。渡された引数がどちらの種別かは、`password`キーの有無で判定する（`password`があれば`PasswordCredential`、なければ`FederatedCredential`として扱う）。`publicKey`系の資格情報オブジェクト（`PublicKeyCredential`）が渡された場合も`get()`と同様にスコープ違反として`error`へ流す（型の識別は`credential.type === "public-key"`または`id`/`password`/`provider`のいずれも欠く形状で検出する）。

---

## 4. 複数Promiseの論点 — `get()`と`store()`は1つの`_gen`を共有してよいか

[multi-promise-io-node-design.md](./multi-promise-io-node-design.md)を踏まえて検討する。同ドキュメントは「1つのCoreインスタンスにつき進行中の非同期処理は常に1本」という既存パターン（`FetchCore`の単一`_gen`+単一`_abortController`、[FetchCore.ts:48-54](../packages/fetch/src/core/FetchCore.ts#L48-L54)）が、`get()`/`store()`のように**同一操作の並行複数呼び出し**（同ドキュメント§2「パターン(1)」）が要求されるノードには素朴には当てはまらないことを指摘し、(a)コレクション化・(b)相関をuserlandへ・(c)プロトコル拡張（`keyed`プロパティ）という3つの戦略的選択肢を示している。

本ノードはこの「複数Promise」問題の**軽度な事例**である。`get`と`store`という2つの独立したcommandを持つが、それぞれが独立した相関キー空間を必要とするわけではなく、動的に生成されるキー（RESTのresource-id、RPCのcorrelation-id）も存在しない。したがって`multi-promise-io-node-design.md`が扱う「keyed Map」的な扱い——`_genByKey: Map<string, number>`への一般化——は**過剰**である。

**決定: v1では`get()`と`store()`が単一の共有`_gen`を使うことを許容される簡略化とする** ✅

理由:

- 実際の認証フローでは`get()`と`store()`は**逐次的**に使われる。典型的な流れは「ページロード時に`get()`でサイレントサインインを試みる → ログインフォーム送信成功後に`store()`で資格情報を保存する」であり、同一インスタンス上で両者が自然に並行呼び出しされる場面は想定しにくい。
- ネイティブUIの観点でも、`get()`のアカウント選択ダイアログと`store()`の保存確認ダイアログが同一ページ上で同時に開くことは、ユーザー体験としてもまず起こらない設計になっている。

**実際の制限として明記する**: もし`get()`と`store()`が同一の`<wcs-credential>`インスタンスに対して並行して起動された場合、後の呼び出しの世代インクリメント（`gen = ++this._gen`）が前の呼び出しの完了書き込みを黙って握り潰す、という失敗モードがそのまま発生する。例えば`get()`実行中に`store()`が呼ばれると、`store()`が`_gen`をインクリメントし、後から`get()`のPromiseがresolveしても`gen !== this._gen`となり`get()`の結果（`value`/`loading`/`error`）は一切反映されない。これはまさに[multi-promise-io-node-design.md](./multi-promise-io-node-design.md)の選択肢(a)/(b)/(c)が解決する類の問題だが、**v1でそれを実装するのはスコープ外**とする。

**実際にこの制限が問題になった場合の回避策**: Core自体を作り直す（`_genByKey`化する、`command`ごとに独立した`_gen`を持たせる等）のではなく、**2つの別々の`<wcs-credential>`要素インスタンスを使う**（1つは`get`専用、もう1つは`store`専用）ことを推奨する。state/DOMは既にどのIOノードでも複数インスタンスの併存を許容しており（`<wcs-fetch>`を用途ごとに複数置くのと同じ運用）、追加のプロトコル変更もCore実装の複雑化も不要である。この回避策をREADMEに明記する。

---

## 5. never-throw — DOMExceptionの正規化

`navigator.credentials.get()`/`.store()`は、ブラウザ・設定・ユーザー操作次第で多様なDOMException名でrejectする（`NotAllowedError`＝ユーザー拒否またはgesture要件違反、`SecurityError`＝secure context外／オリジン不一致、`InvalidStateError`、`NetworkError`等）。try/catchはこれらを一貫した`error`形状に正規化する必要がある。

`WorkerCore`の`_normalizeError`が同じ問題（`post()`の`DataCloneError`、`_spawn()`の起動失敗）を解決している手法をそのまま流用する:

```typescript
private _normalizeError(err: unknown): WcsWorkerErrorDetail {
  if (err instanceof Error) {
    // DOMException is an Error subclass; its `name` (DataCloneError, etc.) is
    // the meaningful discriminator for consumers switching on failure kind.
    return { name: err.name, message: err.message };
  }
  return { name: "Error", message: String(err) };
}
```
（[WorkerCore.ts:312-318](../packages/worker/src/core/WorkerCore.ts#L312-L318)）

`DOMException`は`Error`のサブクラスであり、`err.name`がconsumer側の分岐キーとして意味を持つ、という点は本ノードでも同一に成立する。本ノードでは`_normalizeError`の結果を使う前に、まず`err.name === "NotAllowedError"`かどうかで§2の`cancelled`分岐を行い、それ以外の名前だけが`error`へ正規化されて流れる。

`get()`/`store()`の`try/catch`は`FetchCore._doFetch`の構造（単一`_gen`捕捉→try本体→catch内でstale世代チェック→`_normalizeError`相当の正規化、[FetchCore.ts:180-316](../packages/fetch/src/core/FetchCore.ts#L180-L316)）をそのまま踏襲する。

---

## 6. ブラウザUIの介在とuser gesture — Web Share/Fullscreenとの違い

ネイティブのアカウント選択UI（credential picker）が`get()`呼び出し時に介在する点はWeb Share（共有シート）やFullscreen（全画面遷移）と同様だが、**user gesture要件の有無が異なる**。

- `requestFullscreen()`はuser gesture必須（gesture外呼び出しはreject。[io-node-candidate-implementation-notes.md](./io-node-candidate-implementation-notes.md)候補9）。
- `navigator.share()`もuser activation必須（W3C仕様で明記）。
- 一方 **`navigator.credentials.get()`は仕様上厳密にはuser gestureを必須としない**。Credential Management APIの仕様・各ブラウザの実装ともに、`get()`をユーザー操作（クリック等）のハンドラ外——例えばページロード直後の`connectedCallback`相当のタイミング——から呼び出すことを許容する。これは「サイレントサインイン」（ページを開いた瞬間に、ブラウザに保存済みの資格情報があれば自動的にログイン状態を復元する）という一般的な実践のために、意図的にgesture要件を課していない設計である。
- `store()`についても同様にgesture必須の制約は無い（ログイン成功ハンドラから、ユーザーの明示的クリックを介さずに呼び出せる）。

**この違いが意味すること**: 本ノードはページロード時の「サイレントサインイン」という一般的な実践のために、`connectedCallback`から`get()`を自動起動できる、という点でこのバッチの他メンバー（Web Share・EyeDropper・Contact Picker——いずれもユーザーの明示的なクリックなど gesture 文脈からしか呼べない）とは異なる性質を持つ。

- **決定: `autoTrigger`（`manual`属性が無い場合の自動`get()`起動）を持つ余地を残す** — ただし濫用防止のため既定はopt-in（`mediation="silent"`を明示指定した場合のみ、あるいは専用の`auto-get`属性を要求する）とし、無条件の自動起動をデフォルトにはしない。この設計判断はShell実装時に確定させる（v1のスコープでは「呼べる」ことの明記に留め、自動起動属性の具体名は実装着手時に決定する）。
- `mediation`オプション（`"silent" | "optional" | "required" | "conditional"`）はこの非対称性を制御する仕組みそのものなので、§3.1の通り`get()`の許可オプションキーに含める。

---

## 7. 比較表（バッチ3内の位置づけ）

| | Web Share / EyeDropper / Contact Picker | `<wcs-credential>` |
|---|---|---|
| command数 | 1（`share`/`open`/`select`） | **2**（`get`/`store`） |
| `_gen` | 単一、1操作専有 | 単一だが**2 commandで共有**（§4の制限あり） |
| user gesture | 必須（モーダルダイアログ起動の前提） | **`get()`/`store()`は不要**（サイレント実行を許容） |
| `cancelled` | あり（`AbortError`） | あり（`NotAllowedError`をユーザー拒否として分類） |
| スコープ境界の複雑さ | なし（API自体が単一機能） | **あり**（`publicKey`/WebAuthnを明示的に除外・validate） |
| autoTrigger | 無し（gesture必須のため） | **検討の余地あり**（サイレントサインイン用途、opt-in） |

---

## 8. テスト方針（happy-dom）

happy-domは`navigator.credentials`を持たないため`__tests__/mocks.ts`で全モック。Fake doubleは`get`/`store`をそれぞれ差し替え可能な関数として保持する（Web Share等と同様、モーダルAPIのFakeはPromiseを外部から`resolve`/`reject`できるcontrollableな形にする）。

```typescript
class FakeCredentialsContainer {
  get = vi.fn<[CredentialRequestOptions?], Promise<any>>();
  store = vi.fn<[any], Promise<any>>();
}
```

観点:

- `get()`成功時: `value`に資格情報相当のオブジェクトが載り、`loading`がtrue→falseに遷移し、`error`/`cancelled`は変化しない。
- `store()`成功時: 同様の`value`/`loading`遷移。
- `get()`/`store()`が`NotAllowedError`でrejectしたとき`cancelled`がtrueになり、`error`は変化しない（同値ガード込みで検証）。
- `get()`/`store()`が`SecurityError`等の非`NotAllowedError`でrejectしたとき`error`に正規化された`{name, message}`が載り、`cancelled`は変化しない。
- **`publicKey`キーを含む`get()`呼び出しが実プラットフォームAPIを一切呼ばず即座に`error`（スコープ違反）を発火する**こと（`FakeCredentialsContainer.get`が呼ばれていないことをアサートする、§0/§3.1の検証）。
- `publicKey`型と識別できる`store()`引数も同様に呼び出しをブロックすること。
- **`_gen`共有の制限の回帰確認**: `get()`実行中（未resolve）に`store()`を呼び、`store()`完了後に`get()`のPromiseをresolveさせても、`get()`の結果が`value`/`loading`/`error`へ反映されないこと（§4の失敗モードそのものを固定するテスト。「直す」テストではなく「この制限がある」ことを明文化する回帰テスト）。
- never-throw: 未対応環境（`navigator.credentials`不在）で`get()`/`store()`を呼んでも例外を投げず`error`（`"unsupported"`相当）に落ちること。
- 同値ガード: 連続する`get()`呼び出しで`loading`がtrue→false→true→falseと正しく遷移すること（イベント性の`value`/`error`更新自体は都度発火してよいが、`loading`/`cancelled`は同値なら再dispatchしない）。
- dispose後に`get()`/`store()`のPromiseがresolveしても状態を書き込まないこと（`_gen`ガード、[async-io-node-guidelines.md](./async-io-node-guidelines.md) §3.4）。

---

## 9. 決定事項まとめ

| 論点 | 決定 |
|---|---|
| §0 WebAuthn (`publicKey`) | **v1スコープから完全除外**。将来`<wcs-webauthn>`へ切り出し |
| §2 `cancelled`プロパティ | **追加する**（`NotAllowedError`をユーザーキャンセルとして分類、Web Shareと一貫） |
| §3.1 `get()`への`publicKey`混入 | **validateして除去し`error`で表面化**（黙って転送しない） |
| §3.2 `store()`の型判定 | `password`キー有無で`PasswordCredential`/`FederatedCredential`を判定、`publicKey`系は拒否 |
| §4 `_gen`共有 | **v1では単一`_gen`共有を許容**（逐次利用が前提）。並行呼び出し時の握り潰しは既知の制限として明記 |
| §4 制限の回避策 | 2つの別インスタンス（get用/store用）を使う。Core再設計はしない |
| §5 never-throw | `WorkerCore._normalizeError`（[WorkerCore.ts:312-318](../packages/worker/src/core/WorkerCore.ts#L312-L318)）を流用 |
| §6 user gesture | `get()`/`store()`はgesture不要（サイレントサインイン前提の設計） |
| §6 autoTrigger | 検討の余地あり、既定はopt-in（実装時に属性名確定） |
| パッケージ/タグ | `@wcstack/credential` / `<wcs-credential>` / Shell `WcsCredential` |

---

## 10. 実装順の推奨

単一ノードのため「実装順」は内部ステップとして以下の順で進めた。

1. **Core（`get()`まで）**: `CredentialCore`の骨格（`value`/`loading`/`error`/`cancelled`の同値ガード付きsetter、単一`_gen`、`_normalizeError`）を`FetchCore`/`WorkerCore`から移植し、`get(options)`を実装。`publicKey`キー検出によるスコープ違反の`error`化をここで確定させる。
2. **Core（`store()`追加）**: 同じ`_gen`を共有する形で`store(credential)`を追加。§4の制限（並行呼び出しの握り潰し）を固定する回帰テストをここで書く。
3. **Shell `<wcs-credential>`**: `display:none`、属性は無し（`get`/`store`はどちらもcommand引数がオブジェクトのため、Shellの属性連動入力は不要。`mediation`をデフォルト値属性として持たせるかは実装時判断）。`connectedCallback`でのサイレントサインイン自動起動（§6のopt-in属性）をここで確定させる。
4. **tests**: §8の観点一式。Fake double (`FakeCredentialsContainer`) の install/remove、never-throw、`_gen`共有の制限テストを含む。
5. README ja/en（WebAuthn非対応の明記、`cancelled`と`error`の違い、`_gen`共有の制限と2インスタンス回避策、サイレントサインインのuser gesture不要性を明記）。
