# ブラウザ capability 差の吸収

- **状態**: 設計提案（未採択・未実装）
- **対象**: permission、sensor、media、storage、screen / window、worker などブラウザ API を使う I/O タグ

## 問題

ブラウザ API は、constructor の有無だけでなく secure context、permission policy、ユーザー許可、OS・端末、
実装された method、実行時の状態によって利用可否が変わる。同じブラウザ名でも capability は固定ではない。
タグごとに判定と error 表現が異なると、交換可能な I/O ノードという利点が consumer 側の分岐へ流出する。

## 推奨する共通契約

### 1. feature detection を境界で行う

UA 名や version ではなく、利用する constructor、method、event、secure context、permission を実行直前に検査する。
モジュール import 時に `window`、`navigator`、DOM constructor を必須参照せず、SSR / worker では安全に
unsupported を返す。API object は Core へ注入可能にし、Shell だけがブラウザ globals を解決する。

### 2. capability と現在状態を分ける

最低限、次を区別する。

- `supported`: 実装と最低実行条件を満たすか。
- `permission`: `prompt | granted | denied | unavailable`。
- `ready`: 初期 snapshot を取得済みか。
- `active`: 現在監視・取得しているか。
- `error`: 直近の失敗を正規化した値。

`supported: false`、ユーザーによる `denied`、一時的な `NotReadableError`、まだ未初期化を一つの falsy 値へ
潰さない。単発 action の成功と継続 monitor の状態も分ける。

### 3. never-throw 境界と安定した error taxonomy

同期 throw、Promise rejection、DOMException を Shell で捕捉し、安定した `code`、`name`、`recoverable`、
`cause`（開発時のみ）へ変換する。programmer error まで無言で握りつぶさず、公開 operation は宣言した error 面へ
失敗を流し、開発用 hook に診断を残す。

### 4. lifecycle と動的変化を扱う

permission change、device 消失、page visibility、BFCache 復帰、OS による lock 解除などで capability / active 状態が
変わり得る。observer は `observe() → dispose()` の所有権を明確にし、再接続時には新しい generation で snapshot を
取り直す。古い callback は commit しない。

### 5. adapter が差を正規化する

標準 API の一部だけがない場合は、明示的な adapter で代替経路を選ぶ。semantics が異なる fallback を自動で
同一視せず、`implementation` / `limitations` を capability metadata と診断に残す。polyfill のロードをタグが
暗黙に行わない。

## capability manifest の提案

I/O タグは任意で、安定した feature id、検査結果、制約を読み取り専用 property または開発用 sidecar として
公開できる。値は additive に拡張し、consumer は未知 field を無視する。ブラウザ名の allowlist ではなく、
実際に確認した能力だけを表す。

feature id は `web.fetch` または reverse-DNS 形式など registry で管理できる安定名とし、browser API の
platform capability と remote connection の capability bit を別 namespace・別判定にする。sidecar は静的要件、
runtime assessment は availability、permission、readiness、activity、precondition、epoch、直近 error を表す。
初期化時だけでなく operation 開始直前にも必要条件を再検査する。

共通 error は serializable な `WcsIoErrorInfo` と、runtime 内だけの non-cloneable な `cause` に分ける。移行時は
既存 error property / event の shape を変更せず、まず DevTools と opt-in `errorInfo` へ共通 taxonomy を投影する。

## テスト戦略

- Core test: browser object を使わず、状態機械、世代、error 正規化を決定的に検証する。
- Shell contract test: constructor / method 不在、throw、rejection、permission 遷移、dispose を fake で網羅する。
- Browser E2E: 対応ブラウザで実 API の最小 smoke test を行う。実機依存ケースは capability 条件付きにする。
- Conformance: 全 I/O ノードへ共通の unsupported、never-throw、ready、teardown、late callback テストを適用する。

## 互換性と移行

既存の `supported` property と各タグ固有 error は維持し、共通 taxonomy への mapping を追加する。
新しい capability field は optional とし、旧 consumer が知らなくても動作する。既存の boolean が複数状態を
潰している場合は意味を変更せず、より精密な property を追加して段階的に移行する。

## 検証条件

- SSR で全対象 package を import でき、browser global 不在で module evaluation が失敗しない。
- API 全欠如と method 一部欠如を区別し、どちらも未処理例外を出さない。
- denied、dismissed、policy blocked、insecure context、device busy を安定 code に正規化する。
- permission / visibility / device 状態の変更後に snapshot と active が追従する。
- disconnect 後の native event / Promise 完了が state を更新しない。
- conformance suite が各 I/O package の同じ契約を検査する。

## 非目標

- すべてのブラウザに同じ物理機能を提供すること。
- UA sniffing による将来の対応状況予測。
- semantics の異なる fallback を完全互換として隠すこと。

## 決定ゲート

1. 共通 error code と capability schema の所有 package。
2. `supported` の最低条件を constructor 存在、実行可能性のどちらで定義するか。
3. browser E2E の必須 matrix と、実機依存テストの扱い。
4. capability 情報を通常 property と開発用 sidecar のどちらで公開するか。

## 関連文書

- [非同期 I/O ノード指針](../async-io-node-guidelines.md)
- [非同期実行と wc-bindable 境界](04-async-execution-and-wc-bindable.md)
- [8 論点を横断する修正設計](09-remediation-design.md)
- [発火タイミング契約](../timing-and-firing-contract.md)
