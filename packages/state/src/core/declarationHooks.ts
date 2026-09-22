/**
 * core/declarationHooks.ts — 宣言の受け口（設計案 H4、S4）。
 *
 * `_state` セッターはこのパッケージで最も順序に敏感なコードで、どの検証が世代を進める前に走り
 * どれが後かがそのままテスト（`integration.stateGenerationReset.test.ts`）で固定されている。
 * だから受け口は「予約キーを走査して handler に渡す」1 点ではなく、**段（phase）**にした。
 * 機能は自分が要る段だけ実装し、core は各段を従来の分岐があった位置で呼ぶ。
 *
 *   validateEarly  core 自身のトークン / `$listKeys` の解析より前（`$recursion` はここで解析される）
 *   validate    世代を進める前（`value` しか読まない検証。ここで throw した再セットは世代を進めない）
 *   preCommit   検証がすべて済み、まだ世代を進めていない点（旧世代の後始末と差し替え）
 *   applyEarly  `__state` の差し替え直後・`$on` の配線より前（`$scan` の出力の実体化と購読）
 *   apply       新しい getterPaths / setterPaths の収集後（`$streams` の衝突検査がそれを見る）
 *   register    `_rebuildPathInfo` と `$scan` の登録の後（依存グラフへの登録）
 *   activate    接続中の再 set と、接続の末尾（起動の可否と二重起動ガードは機能側が持つ）
 *   deactivate  切断
 *
 * apply / register / activate は `order` の昇順、**deactivate は降順**で聞く。
 * これが「watch は stream より先に起動し、後に停止する」を番号だけで保つ
 * （従来 `State` に直書きされていた順序契約）。
 *
 * **文脈袋**（`IDeclarationContext`）: 段を跨いで機能どうしが値を渡す口。core は自分が作った値
 * （`$eventTokens` の名前・再帰レジストリ）を publish し、`$scan` の検証がそれを読む。解析した
 * エントリも袋に入れて validate → applyEarly → register を渡り歩く。1 回の set につき 1 つ作る。
 */
import type { IStateElement } from "../components/types";
import type { IState } from "../types";

/** 1 回の `_state` set の間だけ生きる、機能どうしの受け渡し口 */
export interface IDeclarationContext {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}

export function createDeclarationContext(): IDeclarationContext {
  const values = new Map<string, unknown>();
  return {
    get<T>(key: string): T | undefined {
      return values.get(key) as T | undefined;
    },
    set(key: string, value: unknown): void {
      values.set(key, value);
    },
  };
}

export interface IDeclarationHooks {
  /** 聞く順（watch 10 → streams 20。deactivate はこの逆順） */
  readonly order: number;
  readonly validateEarly?: (element: IStateElement, value: IState, ctx: IDeclarationContext) => void;
  readonly validate?: (element: IStateElement, value: IState, ctx: IDeclarationContext) => void;
  readonly preCommit?: (element: IStateElement, value: IState, ctx: IDeclarationContext) => void;
  readonly applyEarly?: (element: IStateElement, value: IState, ctx: IDeclarationContext) => void;
  readonly apply?: (element: IStateElement, value: IState, ctx: IDeclarationContext) => void;
  readonly register?: (element: IStateElement, value: IState, ctx: IDeclarationContext) => void;
  /**
   * `captured` が null なら `_state` セッターからの起動（接続中の再 set）、
   * 数値なら接続の末尾からの起動で、その接続で捕捉した世代（陳腐な connect の再開を弾く）。
   */
  readonly activate?: (element: IStateElement, captured: number | null) => void;
  readonly deactivate?: (element: IStateElement) => void;
}

const registry = new Map<string, IDeclarationHooks>();
let ordered: IDeclarationHooks[] = [];
let reversed: IDeclarationHooks[] = [];

/** 機能の install が呼ぶ（冪等） */
export function registerDeclarationHooks(feature: string, hooks: IDeclarationHooks): void {
  registry.set(feature, hooks);
  ordered = Array.from(registry.values()).sort((a, b) => a.order - b.order);
  reversed = ordered.slice().reverse();
}

/**
 * 宣言の受け口が入っているか（readiness barrier の判定 — 要件 D13 / 設計案 H5）。
 *
 * 未 install の機能は段がすべて no-op になるだけなので、core 自身が「宣言は書かれているのに
 * 受け口が無い」を見ていないと `$watch` / `$scan` / `$stream` / `$recursion` が**黙って**
 * 素通りする。`components/State.ts` の `_state` セッターがこれで門を張る。
 */
export function isDeclarationFeatureRegistered(feature: string): boolean {
  return registry.has(feature);
}

export function runValidateEarly(element: IStateElement, value: IState, ctx: IDeclarationContext): void {
  for (let i = 0; i < ordered.length; i++) {
    ordered[i].validateEarly?.(element, value, ctx);
  }
}

export function runPreCommit(element: IStateElement, value: IState, ctx: IDeclarationContext): void {
  for (let i = 0; i < ordered.length; i++) {
    ordered[i].preCommit?.(element, value, ctx);
  }
}

export function runValidate(element: IStateElement, value: IState, ctx: IDeclarationContext): void {
  for (let i = 0; i < ordered.length; i++) {
    ordered[i].validate?.(element, value, ctx);
  }
}

export function runApplyEarly(element: IStateElement, value: IState, ctx: IDeclarationContext): void {
  for (let i = 0; i < ordered.length; i++) {
    ordered[i].applyEarly?.(element, value, ctx);
  }
}

export function runApply(element: IStateElement, value: IState, ctx: IDeclarationContext): void {
  for (let i = 0; i < ordered.length; i++) {
    ordered[i].apply?.(element, value, ctx);
  }
}

export function runRegister(element: IStateElement, value: IState, ctx: IDeclarationContext): void {
  for (let i = 0; i < ordered.length; i++) {
    ordered[i].register?.(element, value, ctx);
  }
}

export function runActivate(element: IStateElement, captured: number | null): void {
  for (let i = 0; i < ordered.length; i++) {
    ordered[i].activate?.(element, captured);
  }
}

/** 停止は起動の逆順（stream を止めてから watch を外す） */
export function runDeactivate(element: IStateElement): void {
  for (let i = 0; i < reversed.length; i++) {
    reversed[i].deactivate?.(element);
  }
}
