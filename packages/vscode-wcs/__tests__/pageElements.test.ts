/**
 * pageElements.test.ts — ページで定義した自作要素の `static wcBindable` と、その要素への束縛の照合
 * （7GUIs の評価の No. 22・23: `eventToken.` / `command.` の名前の打ち間違いに lint が黙っていた）。
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument.js';
import { WcsDiagnosticCode } from '../src/core/diagnostics.js';
import { collectPageElementContracts } from '../src/service/pageElements.js';

const STATE = `<wcs-state><script type="module">export default { listMove: null, items: [], text: "", go: true, $commandTokens: ["reveal"], $eventTokens: ["move"] };</script></wcs-state>`;
const NAV = `<script type="module">
  customElements.define("listbox-nav", class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable", version: 1,
      properties: [{ name: "move", event: "listbox-nav:move", semantics: "event" }],
      inputs: [{ name: "label" }],
      commands: [{ name: "revealSelected" }],
    };
  });
</script>`;
const unknown = (html: string, fileReader?: (p: string) => string | undefined) =>
  validateDocument(html, { locale: 'en', ...(fileReader ? { fileReader } : {}) }).filter((d) => d.code === WcsDiagnosticCode.TagMemberUnknown);

describe('ページで定義した自作要素の wcBindable と束縛を照合する（wcs/tag-member-unknown）', () => {
  it('eventToken. / command. / プロパティの名前の打ち間違いは error で、近い名前を示す', () => {
    const html = `${STATE}${NAV}<listbox-nav data-wcs="eventToken.mov: move; command.revealSelcted: $command.reveal; lable: text"></listbox-nav>`;
    const found = unknown(html);
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual(['eventToken.mov', 'command.revealSelcted', 'lable']);
    expect(found.every((d) => d.severity === 'error' && d.tag === 'listbox-nav')).toBe(true);
    expect(found[0].message).toContain('Did you mean "move"?');
    expect(found[1].message).toContain('Did you mean "revealSelected"?');
    expect(found[2].message).toContain('Did you mean "label"?');
  });

  it('宣言したメンバー・HTML の書き込み先・class. / attr. / on*: / コンポーネントの配線（state.x:）は黙る', () => {
    const html = `${STATE}${NAV}<listbox-nav data-wcs="eventToken.move: move; command.revealSelected: $command.reveal; label: text; move: listMove; innerHTML: text; class.on: go; attr.title: text; onclick: go; state.items: items"></listbox-nav>`;
    expect(unknown(html)).toEqual([]);
  });

  it('クラスの宣言を名前で define した形・ページの中の親クラスから継ぐ形・static の getter も読む', () => {
    const html = `${STATE}<script type="module">
      class Base extends HTMLElement { static get wcBindable() { return { protocol: "wc-bindable", version: 1, properties: [{ name: "value", event: "x:change" }] }; } }
      class Child extends Base {}
      const Other = class extends HTMLElement { static wcBindable = { protocol: "wc-bindable", version: 1, properties: [], commands: [{ name: "open" }] }; };
      customElements.define("x-base", Base);
      window.customElements.define("x-child", Child);
      customElements.define("x-other", Other);
    </script><x-base data-wcs="valeu: text"></x-base><x-child data-wcs="eventToken.vaule: move"></x-child><x-other data-wcs="command.opne: $command.reveal"></x-other>`;
    expect(unknown(html).map((d) => `${d.tag} ${d.member}`)).toEqual(['x-base valeu', 'x-child vaule', 'x-other opne']);
  });

  it('src のモジュールと、そこからの相対の import を読む（CDN の URL は読まない）', () => {
    const files: Record<string, string> = {
      './js/main.js': `import "./components/nav.js";\nexport const ready = true;`,
      './js/components/nav.js': `export class Nav extends HTMLElement { static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "move", event: "nav:move" }] }; }\ncustomElements.define("app-nav", Nav);`,
    };
    const html = `${STATE}<script type="module" src="https://cdn.jsdelivr.net/npm/@wcstack/state@4.3.0/dist/auto.min.js"></script><script type="module" src="./js/main.js"></script><app-nav data-wcs="eventToken.mvoe: move"></app-nav>`;
    expect(unknown(html, (p) => files[p]).map((d) => d.member)).toEqual(['mvoe']);
    // without a reader (an unsaved document) the module is not read: silent
    expect(unknown(html)).toEqual([]);
  });

  it('宣言を確かに読めない要素は照合しない（計算した宣言・spread・ページの外の親クラス・宣言の無いクラス）', () => {
    const html = `${STATE}<script type="module">
      import { Base } from "./lib.js";
      customElements.define("x-made", class extends HTMLElement { static wcBindable = make(); });
      customElements.define("x-spread", class extends HTMLElement { static wcBindable = { ...base, properties: [] }; });
      customElements.define("x-props", class extends HTMLElement { static wcBindable = { protocol: "wc-bindable", version: 1, properties: names.map((name) => ({ name })) }; });
      customElements.define("x-sub", class extends Base {});
      customElements.define("x-plain", class extends HTMLElement {});
    </script><x-made data-wcs="a: text"></x-made><x-spread data-wcs="b: text"></x-spread><x-props data-wcs="c: text"></x-props><x-sub data-wcs="d: text"></x-sub><x-plain data-wcs="e: text"></x-plain>`;
    expect(unknown(html)).toEqual([]);
    expect([...collectPageElementContracts(html).keys()]).toEqual([]);
  });

  it('コメントやスクリプトの文字列の中のタグは照合せず、wcs-* のタグはカタログのまま', () => {
    const html = `${STATE}${NAV}<!-- <listbox-nav data-wcs="eventToken.zzz: move"></listbox-nav> -->`
      + `<script>const s = '<listbox-nav data-wcs="command.zzz: $command.reveal">';</script>`
      + `<script type="module">customElements.define("wcs-timer", class extends HTMLElement { static wcBindable = { protocol: "wc-bindable", version: 1, properties: [] }; });</script>`;
    expect(unknown(html)).toEqual([]);
    expect([...collectPageElementContracts(html).keys()]).toEqual(['listbox-nav']);
  });

  it('ページの要素の trigger という入力には、組み込みの I/O ノードの trigger の検査をかけない', () => {
    const html = `${STATE}<script type="module">customElements.define("x-run", class extends HTMLElement { static wcBindable = { protocol: "wc-bindable", version: 1, properties: [], inputs: [{ name: "trigger" }] }; });</script>`
      + `<x-run data-wcs="trigger: go"></x-run>`;
    expect(validateDocument(html, { locale: 'en' }).filter((d) => d.code === WcsDiagnosticCode.TriggerSeededTruthy)).toEqual([]);
  });
});
