/**
 * 素のフラグメントへのリンク（`<a href="#main">` — スキップリンク）は、ページの中の移動
 * （docs/seam-apps.md、city-library）。
 *
 * SPA は `<base href="/">`（多言語なら `<base href="/ja/">`）を置くので、`#main` は
 * `/#main` へ解決される: `/search?q=a` で押すと、router がそれを受けてホームのルートへ
 * 移っていた。書いたままの `href` がフラグメントだけのリンクは、今のページのそのフラグメントへ
 * 移る — `<base>` の無いページでブラウザがするのと同じナビゲーションで。
 */

/**
 * `a` / `area` の、書いたままの `href` がフラグメントだけ（`#…`、`#` 単独も）ならその値。
 * そうでなければ null（`/faq#x`・`?q=b#x` は別のページへのリンク）。
 */
export function fragmentHref(element: Element | null | undefined): string | null {
  if (!element || (element.localName !== "a" && element.localName !== "area")) return null;
  // URL の解析と同じく、前後の空白は除く
  const href = element.getAttribute("href")?.trim();
  return href !== undefined && href.startsWith("#") ? href : null;
}

/**
 * HTML の "find a potential indicated element": その id を持つ要素、無ければその name を持つ `<a>`。
 * 書いたままの値で探し、見つからなければパーセントデコードした値で探す（"select the indicated part"）。
 */
export function findIndicatedElement(fragment: string): HTMLElement | null {
  if (fragment === "") return null;
  const find = (value: string): HTMLElement | null =>
    document.getElementById(value) ??
    Array.from(document.getElementsByName(value)).find((el) => el.localName === "a") ??
    null;
  const found = find(fragment);
  if (found !== null) return found;
  let decoded: string;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    return null;
  }
  return decoded === fragment ? null : find(decoded);
}

/** URL がフラグメントを除いて今のページの URL と同じか（そこへのナビゲーションはフラグメントのナビゲーション） */
export function isCurrentPage(url: string): boolean {
  const here = new URL(window.location.href);
  const there = new URL(url);
  here.hash = "";
  there.hash = "";
  return here.href === there.href;
}

/**
 * リンクがこのウィンドウで開くか（`target` も `<base target>` も無い、または `_self`）。
 * 別のウィンドウ・タブで開くリンクは、そこでのナビゲーション（ブラウザに任せる）。
 */
export function opensInThisWindow(link: Element): boolean {
  const target = link.getAttribute("target") ?? document.querySelector("base[target]")?.getAttribute("target") ?? "";
  return target === "" || target.toLowerCase() === "_self";
}

/**
 * NavigateEvent が sourceElement（ナビゲーションを起こしたリンク）を持つか。Chromium・Firefox・
 * Safari の今の版は持つ。持たない（古い Chromium の Navigation API）なら、リンクは click で拾う。
 */
export function navigateEventHasSource(): boolean {
  const ctor = (globalThis as { NavigateEvent?: unknown }).NavigateEvent;
  return typeof ctor === "function" && "sourceElement" in ctor.prototype;
}

/** 自分でフォーカスを受ける要素（tabindex を足すとタブ順から外れてしまうもの） */
const FOCUSABLE = "a[href], area[href], button, input, select, textarea, iframe, summary, [contenteditable], audio[controls], video[controls], [tabindex]";

/**
 * フラグメントが指す要素へフォーカスを移す。フォーカスできない要素（`<main>`・見出し・`<a name>`）には
 * `tabindex="-1"` を足す（`focus="heading"` と同じ）。スクロールはフラグメントのナビゲーション
 * （ブラウザ）がする: ここでは動かさない — `scroll-margin` も `scroll-behavior: smooth` も効いたまま。
 */
export function focusFragmentTarget(fragment: string): void {
  const target = findIndicatedElement(fragment);
  if (target === null) return;
  if (!target.matches(FOCUSABLE)) {
    target.setAttribute("tabindex", "-1");
  }
  target.focus({ preventScroll: true });
}

/**
 * ページの中の移動: URL を今のパスとクエリ＋そのハッシュにする。`<base>` の無いページで
 * ブラウザがするのと同じフラグメントのナビゲーション（`location.assign`）— 履歴は push、
 * 今と同じ URL なら replace、スクロールは指す要素へ（`#` / `#top` は先頭へ）、`hashchange`
 * と `:target` もそのまま。ルートの遷移ではないので、どの router も受けない。
 */
export function navigateToFragment(href: string): void {
  // 解決の基準は文書の URL（<base> ではない）
  const url = new URL(href, window.location.href);
  window.location.assign(url.href);
  focusFragmentTarget(url.hash.slice(1));
}
