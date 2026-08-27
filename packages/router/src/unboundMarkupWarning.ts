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
import { getBinder, wasBoundBy } from "./protocol/binder";

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
  // 判定は **DOMContentLoaded まで**遅らせる。router の auto バンドルは state の
  // ものより先に走るので、`<wcs-head>` が差し出す時点では binder がまだ居ない。
  // そこで即断すると、この直後に正しく束ねられるノードを「壊れている」と報告する。
  //
  // タイマーでは足りない。deferred な module script はパース完了後に実行されるので、
  // `setTimeout(0)` は state の auto バンドルより**先に発火しうる**（実測）。
  // DOMContentLoaded は全 deferred script の実行後に発火するので、そこでは決着している。
  //
  // 見るのは「束ね終わったか」ではなく **binder が居るか**。バインド構築は
  // インライン state モジュールの読み込みを挟むので完了はさらに後になりうるが、
  // binder が居るなら保留キューはいずれ引き取られるので報告する理由が無い。
  whenLoadOrderSettled(() => {
    if (getBinder() !== null || wasBoundBy(element)) {
      return;
    }
    console.warn(
      `[@wcstack/router] ${where} contains ${BIND_ATTRIBUTE} bindings that will never be applied. ` +
      `A binding exists only for nodes that were in the document when @wcstack/state built its ` +
      `bindings, and these nodes were not. They will render empty. ${remedy}`
    );
  });
}

function whenLoadOrderSettled(check: () => void): void {
  if (document.readyState !== "complete") {
    // `load` を待つ。`DOMContentLoaded` では足りない —— deferred script の実行中は
    // readyState が既に `"interactive"` なので「まだ loading か」では判別できず、
    // DOMContentLoaded を待つつもりが即断になる（実測）。`load` は必ず発火し、
    // 全 deferred script より確実に後に来る。診断なので多少遅くて構わない。
    window.addEventListener("load", check, { once: true });
    return;
  }
  // 起動後の挿入（ナビゲーション）。読み込み順はとうに決着している。
  check();
}

/** テスト用: 警告の「1 要素 1 回」を跨いで検証するためのリセット */
export function _resetUnboundMarkupWarnings(elements: Iterable<Element>): void {
  for (const element of elements) {
    warned.delete(element);
  }
}
