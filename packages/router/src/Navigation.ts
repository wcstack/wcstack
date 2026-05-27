/**
 * Navigation API の `navigate()` 戻り値（NavigationResult）。
 * - `committed`: URL がアドレスバーに反映された時点で resolve
 * - `finished`: 全 intercept handler 完了で resolve
 * Polyfill や mock 環境では戻り値が undefined のケースもあるため、
 * 戻り値全体を optional として扱う。
 */
export type NavigationResultLike = {
  committed?: Promise<unknown>;
  finished?: Promise<unknown>;
};

export type NavigationLike = {
  navigate?: (url: string) => NavigationResultLike | void | undefined;
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
};

export function getNavigation(): NavigationLike | null {
  const nav = (window as any).navigation as NavigationLike | undefined;
  if (!nav) {
    return null;
  }
  if (typeof nav.addEventListener !== "function" || typeof nav.removeEventListener !== "function") {
    return null;
  }
  return nav;
}
