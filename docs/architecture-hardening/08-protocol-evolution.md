# プロトコル進化と互換性

- **状態**: 設計提案（未採択・未実装）
- **対象**: wcstack の `static wcBindable`、binding core、tooling、local / remote adapter
- **外部仕様スナップショット**: wc-bindable-protocol
  `5ec0deef212578a072b2f669d2a5554f254253e0`、`@wc-bindable/core@0.8.0`

## 問題

共通プロトコルを広げるほど、古い core、新しいタグ、tooling、remote peer の組合せが増える。
version を「完全に知っている値だけ許可する」switch にすると、optional field の追加さえ相互運用を壊す。
反対に、破壊的変更を同じ識別子のまま version だけ上げて受け入れると、接続は成功しても意味が食い違う。

## 最新 wc-bindable の互換性規則

固定した最新仕様では、宣言の `version` は 1 以上の整数であり、adapter はすべての `version >= 1` を受け入れる。
未知の optional field は無視する。additive な進化では version を上げられるが、binding contract を壊す変更は
未知 version を拒否するのではなく、新しい `protocol` 識別子を必要とする。

したがって version は feature gate ではない。local discovery は公式 helper または固定 conformance vectors に
一致する mirror を validation gate とし、機能利用可否は field の存在、behavioral extension discovery、remote
capability negotiation で判定する。

## wcstack の現在地

`protocol/wc-bindable.ts` は `version: 1` の literal 型を単一ソースとして各 package へ同期している。
これは現在の宣言を正確に表す一方、上流仕様が許す将来の `version >= 1` を型の段階で表現できない。
また、コメント上の command 呼び出しと「descriptive metadata」という位置付けを、コアと Extension 1 の境界に
合わせて明文化する余地がある。本書は差分を記録するだけで、型や runtime はまだ変更しない。

## 推奨する進化規則

### 1. additive change を基本にする

- optional field、property / input / command 宣言、extension capability の追加を許す。
- consumer は未知 field を無視し、理解する field だけで安全に接続できるか判断する。
- 新しい field がなくても従来意味で動作する既定値を仕様に書く。
- field の存在が必須な機能は capability として検査し、黙って代替しない。

### 2. 名前ではなく意味の破壊を判定する

削除、rename、event 変更、read / write 方向変更、順序・teardown 保証の弱化は破壊的変更として扱う。
property の値型変更も wire protocol が同じでもアプリケーション契約上は破壊的になり得る。
移行期間は旧名 alias、旧 event の併発、adapter を用意し、警告と撤去時期を記録する。

### 3. 本当に異なる契約は新 protocol にする

旧 consumer が同じ宣言を安全に解釈できない場合、同じ `protocol: "wc-bindable"` の高い version で隠さず、
新しい protocol identifier または明示的な extension を使う。一つのタグが移行期間中に両 surface を提供する
場合は discovery の優先順位と teardown 所有権を決める。

### 4. local と remote の交渉を分ける

local discovery は宣言 shape と field / extension の存在で判断する。remote はさらに wire capability、
declaration fingerprint、payload 制約、pending / ordering 能力を handshake で確認する。fingerprint の差は
即座の非互換を意味せず、期待宣言との不一致を診断・再発見するために使う。

さらに wcstack の tooling metadata は manifest extension、wc-bindable の command / mutation behavior は
behavioral extension、wire 上の可否は remote capability、ブラウザ API の可否は platform capability と呼び分ける。
manifest に requirement を書いても target 自身が behavioral extension 対応になるわけではない。

### 5. 型定義を forward-compatible にする

共有型は `version: number` と runtime validator（整数かつ 1 以上）へ寄せ、既知 field は厳密に型付けする。
追加 metadata 用の index signature を安易に広げず、未知 field の保持・無視は parser 境界で扱う。
`scripts/sync-protocol-types.mjs` を通して生成コピーを更新し、手編集による drift を禁止する。

## 変更分類

| 変更 | 原則 | 必要な対応 |
| --- | --- | --- |
| optional metadata 追加 | 後方互換 | 未知 field 無視、既定意味を記載 |
| optional extension / capability 追加 | 後方互換 | discovery と graceful failure |
| property / command の追加 | 通常は後方互換 | 名前衝突検査、tooling 更新 |
| 名前の変更・削除 | 破壊的 | alias / adapter / deprecation |
| event・初期同期・teardown 意味変更 | protocol contract の破壊 | 新 protocol または明示 extension |
| remote payload / ordering 保証変更 | wire contract の破壊 | capability 交渉、必要なら新 wire protocol |

## リリースと適合性

1. 仕様、型、runtime validator、tooling、examples、conformance fixture を同じ変更で更新する。
2. old core × new tag、new core × old tag、local × remote の組合せテストを追加する。
3. 最新仕様の conformance suite と wcstack 固有拡張の suite を分離する。
4. release note に additive / deprecated / breaking と最小 capability を記録する。
5. deprecation は DevTools / validator で観測可能にし、削除前に利用箇所を発見できるようにする。

## 互換性と移行

第一段階では runtime の「version 1 固定」判定がないか監査し、`>= 1` 受理と未知 optional field 無視の
適合テストを先に追加する。次に共有型を緩和して生成コピーを同期する。command 呼び出し機能が必要な箇所は
コア metadata と Extension 1 adapter を区別し、既存 command-token との変換を別契約として文書化する。

## 検証条件

- version 1、2、大きな整数と未知 optional field を持つ宣言を既知 field の範囲で受理する。
- 0、負数、非整数、非数、別 protocol を明確な診断で拒否する。
- 旧 core × optional field 追加タグが従来 property を観測できる。
- Extension 1 非対応 surface への `invoke` を capability error とし、method 名から推測して呼ばない。
- remote declaration fingerprint 変更時に再発見し、保留中 request の所有権を混ぜない。
- 生成型が単一ソースと一致し、package 間 drift を CI で検出する。

## 非目標

- 任意の破壊的変更を version number だけで自動変換すること。
- package の SemVer と protocol / extension version を同一視すること。
- 未知 capability の動作を推測して有効化すること。

## 決定ゲート

1. local runtime と tooling の version validator を共有する場所。
2. wcstack 固有 extension の namespace、discovery、versioning 規則。
3. command-token と Extension 1 adapter の正式な対応関係。
4. deprecation 期間と protocol identifier 変更の承認手順。

## 参照

- [wc-bindable SPEC（固定コミット）](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/SPEC.md)
- [wc-bindable Extensions（固定コミット）](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/SPEC-extensions.md)
- [wc-bindable CONFORMANCE（固定コミット）](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/CONFORMANCE.md)
- [wc-bindable RELEASE_NOTES（固定コミット）](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/RELEASE_NOTES.md)
- [wcstack の protocol 型](../../protocol/wc-bindable.ts)
- [8 論点を横断する修正設計](09-remediation-design.md)
