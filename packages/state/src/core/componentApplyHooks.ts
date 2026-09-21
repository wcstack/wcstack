/**
 * core/componentApplyHooks.ts — カスタム要素のプロパティ束縛の受け口（設計案 S5）。
 *
 * `bind-component` の機能（webComponent/bindComponentLifecycle.ts）が install で置く。apply 側
 * （apply/applyChange.ts・apply/applyChangeToProperty.ts）は、置かれていなければカスタム要素への
 * 束縛も素のプロパティ書き込みとして扱い、何も控えない — 控えの読み手は bind-component の中にしか居ない。
 */

export interface IComponentApplyHooks {
  /** `bind-component` の配線が完了した (要素, state プロパティ)。値を運ばない通知チャネルへ切り替える */
  isComplete(element: Element, stateProp: string): boolean;
  /** 宣言済み・未完了。完了前の初期適用は書かない */
  isDeclared(element: Element, stateProp: string): boolean;
  /** 完了前の丸ごと書き込み（`state: user`）が置き換える作者のオブジェクトを控える */
  rememberOverwrittenObject(element: Element, prop: string, previous: object): void;
  /** 完了前の部分書き込み（`state.theme: theme`）が作者のオブジェクトに作ったキーを控える */
  recordInjectedKey(element: Element, prop: string, key: string): void;
  /** 完了前の部分書き込みが上書きする作者の既存キーの値を控える */
  rememberOverwrittenValue(element: Element, prop: string, key: string, previous: unknown): void;
}

/** 置かれていなければ null（apply 側は判定 1 回で素の書き込みに倒す） */
export let componentApplyHooks: IComponentApplyHooks | null = null;

/** 機能の install が呼ぶ（冪等 — 置き換え） */
export function setComponentApplyHooks(hooks: IComponentApplyHooks | null): void {
  componentApplyHooks = hooks;
}
