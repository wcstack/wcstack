import { describe, it, expect } from "vitest";
import { resolveStateSrc, scanWcstackHtml } from "../src/htmlTags";

const srcs = (html: string): string[] => scanWcstackHtml(html).stateSrcs.map((s) => s.value);

describe("scanWcstackHtml — <wcs-state src> を探す", () => {
  it("二重引用・一重引用・引用無しの値と、その位置", () => {
    const html = `<wcs-state src="./a.ts"></wcs-state><WCS-STATE mount=x SRC='b.ts'></WCS-STATE><wcs-state src=/c.ts></wcs-state>`;
    const scan = scanWcstackHtml(html);
    expect(scan.stateSrcs.map((s) => s.value)).toEqual(["./a.ts", "b.ts", "/c.ts"]);
    for (const s of scan.stateSrcs) expect(html.slice(s.valueStart, s.valueEnd)).toBe(s.value);
  });

  it("空の src・src の無い要素・値の無い属性は拾わず、同名の属性は最初が勝つ", () => {
    expect(srcs(`<wcs-state src=""></wcs-state><wcs-state src></wcs-state><wcs-state json='{}'></wcs-state>`)).toEqual([]);
    expect(srcs(`<wcs-state src="first.ts" src="second.ts"></wcs-state>`)).toEqual(["first.ts"]);
    expect(srcs(`<wcs-state/ src="a.ts" / ></wcs-state>`)).toEqual(["a.ts"]);
  });

  it("コメント・宣言・生テキスト要素の中のタグはタグではない。<template> の中は拾う", () => {
    const html = `<!DOCTYPE html><?xml x?><!-- <wcs-state src="comment.ts"></wcs-state> -->
<script>const s = '<wcs-state src="script.ts">';</script>
<style>/* <wcs-state src="style.ts"> */</style><textarea><wcs-state src="textarea.ts"></textarea>
<title><wcs-state src="title.ts"></title>
<template><wcs-state src="template.ts"></wcs-state></template>`;
    expect(srcs(html)).toEqual(["template.ts"]);
  });

  it("閉じていないコメント・宣言・属性値・生テキストは文書の終わりまで", () => {
    expect(srcs(`<wcs-state src="a.ts"></wcs-state><!-- <wcs-state src="b.ts">`)).toEqual(["a.ts"]);
    expect(srcs(`<wcs-state src="a.ts"></wcs-state><!DOCTYPE`)).toEqual(["a.ts"]);
    expect(srcs(`<wcs-state src="a.ts></wcs-state>`)).toEqual(["a.ts></wcs-state>"]);
    expect(srcs(`<wcs-state src="a.ts"`)).toEqual(["a.ts"]);
    expect(srcs(`<script><wcs-state src="b.ts">`)).toEqual([]);
    expect(srcs(`a < b <1> </ > <wcs-state src="a.ts"></wcs-state></wcs-state`)).toEqual(["a.ts"]);
  });

  it("最初の <base href> を返す", () => {
    expect(scanWcstackHtml(`<base href="/"><base href="/other/">`).baseHref).toBe("/");
    expect(scanWcstackHtml(`<base target="_top"><base href="/x/">`).baseHref).toBe("/x/");
    expect(scanWcstackHtml(`<p></p>`).baseHref).toBeUndefined();
  });
});

describe("scanWcstackHtml — <wcs-state> / <wcs-guard-handler> の中のインラインの module script", () => {
  it("中のものだけを、<script の直後の位置で返す（<template> の中も）", () => {
    const html = `<script type="module">outside()</script>
<wcs-state><script type="module">export default {}</script></wcs-state>
<template><wcs-route><wcs-guard-handler><script type=" Module ">export default () => true</script></wcs-guard-handler></wcs-route></template>
<script type="module">after()</script>`;
    const scan = scanWcstackHtml(html);
    expect(scan.inlineScripts.map((at) => html.slice(at - 7, html.indexOf("</script>", at)))).toEqual([
      `<script type="module">export default {}`,
      `<script type=" Module ">export default () => true`,
    ]);
  });

  it("src のある script・module でない script・vite-ignore 付きは触らない", () => {
    const html = `<wcs-state>
<script type="module" src="./x.ts"></script>
<script type="application/json">{}</script>
<script>classic()</script>
<script type="module" vite-ignore>export default {}</script>
</wcs-state>`;
    expect(scanWcstackHtml(html).inlineScripts).toEqual([]);
  });

  it("閉じタグで外に出る（余分な閉じタグは数えない）。タグ名は変えられる", () => {
    const html = `</wcs-state><wcs-state src="a.ts"></wcs-state><script type="module">outside()</script>`;
    expect(scanWcstackHtml(html).inlineScripts).toEqual([]);
    const renamed = `<my-state src="s.ts"><script type="module">export default {}</script></my-state><wcs-state src="no.ts"></wcs-state><my-guard><script type="module">x</script></my-guard>`;
    const scan = scanWcstackHtml(renamed, { stateTag: "My-State", guardHandlerTag: "my-guard" });
    expect(scan.stateSrcs.map((s) => s.value)).toEqual(["s.ts"]);
    expect(scan.inlineScripts).toHaveLength(2);
  });
});

describe("resolveStateSrc — ページの URL と <base href> から、プロジェクトの中のパスへ", () => {
  it("相対・絶対・.. ・クエリとハッシュ・パーセントエンコード", () => {
    expect(resolveStateSrc("./src/state.ts", "/index.html")).toBe("/src/state.ts");
    expect(resolveStateSrc("state.ts", "/pages/a.html")).toBe("/pages/state.ts");
    expect(resolveStateSrc("../../state.ts", "/pages/a.html")).toBe("/state.ts");
    expect(resolveStateSrc("/src/state.ts?v=1#x", "/pages/a.html")).toBe("/src/state.ts");
    expect(resolveStateSrc(" ./my%20state.ts ", "/index.html")).toBe("/my state.ts");
    expect(resolveStateSrc("./bad%E0.ts", "/index.html")).toBe("/bad%E0.ts");
  });

  it("<base href> に従う（エンジンは document.baseURI で解決する）", () => {
    expect(resolveStateSrc("src/state.ts", "/pages/a.html", "/")).toBe("/src/state.ts");
    expect(resolveStateSrc("state.ts", "/a.html", "sub/")).toBe("/sub/state.ts");
    expect(resolveStateSrc("state.ts", "/a.html", "https://cdn.example.com/")).toBeUndefined();
  });

  it("別のオリジン・data: ・blob: ・壊れた URL はプロジェクトの外", () => {
    expect(resolveStateSrc("https://cdn.example.com/s.js", "/index.html")).toBeUndefined();
    expect(resolveStateSrc("//cdn.example.com/s.js", "/index.html")).toBeUndefined();
    expect(resolveStateSrc("data:text/javascript,export default {}", "/index.html")).toBeUndefined();
    expect(resolveStateSrc("blob:http://wcstack.invalid/x", "/index.html")).toBeUndefined();
    expect(resolveStateSrc("http://[bad/s.js", "/index.html")).toBeUndefined();
  });
});
