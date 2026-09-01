// bind-component の境界を 2 枚重ねるための共通コンポーネント定義。
// bind-component-depth2.html（§1.11・平坦）と bind-component-depth2-nested.html
// （§1.12・Δ>0）が共有する。2 枚に分けてあるのは、§1.12 が初期描画で throw して
// ドキュメント全体をウェッジするため（同居させると §1.11 の信号が消える）。

// 最下層。渡された配列を自分で回す。
const CARD_TEMPLATE = `
<wcs-state bind-component="state"></wcs-state>
<ul class="leaf-view">
  <template data-wcs="for: list">
    <li data-wcs="textContent: .name; attr.data-row-id: .id"></li>
  </template>
</ul>
`;

// 中間。配列をそのまま下へ渡すだけで、自分の行バインディングは持たない。
// これが §1.11 の要点 —— 中継が居ないので 1 段目だけの相乗りでは誰にも届かない。
const panelTemplate = (cardTag) => `
<wcs-state bind-component="state"></wcs-state>
<${cardTag} data-wcs="state.list: items"></${cardTag}>
`;

function define(tag, template, timing) {
  class Comp extends HTMLElement {
    state = {}; // v2 R1: 既定値はマッピングを隠す（D19）
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      if (timing === "constructor") {
        this.shadowRoot.innerHTML = template;
      }
    }
    connectedCallback() {
      if (timing === "connectedCallback" && this.shadowRoot.childElementCount === 0) {
        this.shadowRoot.innerHTML = template;
      }
    }
  }
  customElements.define(tag, Comp);
}

// shadow を constructor で組む形（再接続で <wcs-state> を使い回す）と
// connectedCallback で組む形（再接続のたびに新しくなる）の両方（§1.9）。
define("card-eager", CARD_TEMPLATE, "constructor");
define("card-lazy", CARD_TEMPLATE, "connectedCallback");
define("panel-eager", panelTemplate("card-eager"), "constructor");
define("panel-lazy", panelTemplate("card-lazy"), "connectedCallback");
