/**
 * 「後から差し込んだノードのバインドは効かない」ことを loud に報告する。
 *
 * `data-wcs` のバインドは、`@wcstack/state` がバインドを構築した時点で document に
 * 居たノードにしか作られない。router が後から差し込むノード —— 非活性ルートの内容
 * （`hideRoute` が切り離しているので走査されない）と `<wcs-head>` が head へ映す
 * クローン（元ノードとは別物）—— はどちらもその時点に存在せず、バインドは決して
 * 届かない。何度ナビゲーションを往復しても回復しない。
 *
 * **挙動は変えない。** 変えるのは「黙って空になる」を「原因を指す警告」にすること
 * だけである。症状（見出しが空・`<title>` が消える）は原因（バインド構築の時点）から
 * 遠く、しかも例外も出ないため、これまで気づく手立てが無かった。
 *
 * 恒久的な解決は binder プロトコル（docs/binder-protocol-design.md）で別途決める。
 *
 * 警告は要素ごとに 1 回。壊れている場合にのみ走るので、正常系のコストはゼロ。
 */
const warned = new WeakSet<Element>();

/** `data-wcs`。router は state の config を読めないので既定名を直接持つ */
const BIND_ATTRIBUTE = "data-wcs";

function hasBinding(element: Element): boolean {
  return element.hasAttribute(BIND_ATTRIBUTE) || element.querySelector(`[${BIND_ATTRIBUTE}]`) !== null;
}

/**
 * @param element 差し込まれるサブツリーの根
 * @param where   利用者が原因を特定できる位置の説明（例: `<wcs-route path="/about">`）
 * @param remedy  その位置に固有の回避策
 */
export function warnUnboundMarkup(element: Element, where: string, remedy: string): void {
  if (warned.has(element) || !hasBinding(element)) {
    return;
  }
  warned.add(element);
  console.warn(
    `[@wcstack/router] ${where} contains ${BIND_ATTRIBUTE} bindings that will never be applied. ` +
    `A binding exists only for nodes that were in the document when @wcstack/state built its ` +
    `bindings, and these nodes were not. They will render empty. ${remedy}`
  );
}

/** テスト用: 警告の「1 要素 1 回」を跨いで検証するためのリセット */
export function _resetUnboundMarkupWarnings(elements: Iterable<Element>): void {
  for (const element of elements) {
    warned.delete(element);
  }
}
