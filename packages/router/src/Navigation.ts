export type NavigationLike = {
  navigate?: (url: string) => void;
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
