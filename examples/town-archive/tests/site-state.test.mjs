// @vitest-environment happy-dom
// The public site's state, headless, with @wcstack/testing (mount → write → settle → read).
import { describe, it, expect, afterEach } from "vitest";
import { mount, settle } from "@wcstack/testing";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
// <wcs-state src="js/site-state.js"> resolves against http://localhost/ under happy-dom
const resolveModule = (url) => join(publicDir, url.pathname);

const HTML = `
  <wcs-state src="js/site-state.js"></wcs-state>
  <p id="count" data-wcs="textContent: favCount"></p>
  <p id="cols" data-wcs="textContent: cols"></p>
  <p id="title" data-wcs="textContent: docTitle"></p>
`;

let app;
afterEach(() => app?.unmount());

describe("site state", () => {
  it("the filter comes from the URL's query (the router's searchParams)", async () => {
    app = await mount(HTML, { resolveModule });
    await app.state().write((s) => { s.query = { q: " 路面電車 ", area: "minato", sort: "bogus" }; });
    await settle();
    const r = app.state().read((s) => ({ q: s.filterQ, area: s.filterArea, sort: s.filterSort, has: s.hasFilter, decades: s.decadesActive }));
    expect(r).toEqual({ q: " 路面電車 ", area: "minato", sort: "old", has: true, decades: true });
    await app.state().write((s) => { s.query = { sort: "title" }; });
    await settle();
    expect(app.state().read((s) => s.decadesActive)).toBe(false);
  });

  it("columns and thumbnail size follow the grid's width and the pixel ratio; a width of 0 (hidden) is ignored", async () => {
    app = await mount(HTML, { resolveModule });
    await app.state().write((s) => { s.gridWidthRaw = 972; });
    await settle();
    expect(app.root.querySelector("#cols").textContent).toBe("5");
    expect(app.state().read((s) => [s.gridTemplate, s.neededThumb])).toEqual(["repeat(5, minmax(0, 1fr))", 320]);
    await app.state().write((s) => { s.gridWidthRaw = 0; });
    await settle();
    expect(app.state().read((s) => s.gridWidth)).toBe(972);
    await app.state().write((s) => { s.over1 = true; s.over15 = true; });
    await settle();
    expect(app.state().read((s) => s.neededThumb)).toBe(640);
    expect(app.state().read((s) => s.thumbSize)).toBe(640); // raised by the neededThumb watch
    await app.state().write((s) => { s.over1 = false; s.over15 = false; });
    await settle();
    expect(app.state().read((s) => s.thumbSize)).toBe(640); // never smaller: no second download
  });

  it("★ adds to and removes from お気に入り, last starred first", async () => {
    app = await mount(HTML, { resolveModule });
    const p = (id) => ({ id, title: `写真${id}`, year: 1960, month: 1, area: "kita", w: 1200, h: 900, color: "#888888" });
    await app.state().write((s) => { s.toggleFavorite(p(1)); });
    await settle();
    await app.state().write((s) => { s.toggleFavorite(p(2)); });
    await settle();
    expect(app.root.querySelector("#count").textContent).toBe("2");
    expect(app.state().read((s) => s.favorites.map((f) => f.id))).toEqual([2, 1]);
    await app.state().write((s) => { s.toggleFavorite(p(1)); });
    await settle();
    expect(app.state().read((s) => s.favorites.map((f) => f.id))).toEqual([2]);
  });

  it("entering the list asks for its first page with the filter it is for", async () => {
    app = await mount(HTML, { resolveModule });
    await app.state().write((s) => { s.query = { q: "港" }; s.routeName = "list"; });
    await settle();
    await settle();
    const r = app.state().read((s) => ({ key: s.feedKey === s.listKey, url: s.pageUrl, pending: s.reqPending }));
    expect(r.key).toBe(true);
    expect(r.pending).toBe(true);
    expect(r.url).toBe("/api/photos?q=%E6%B8%AF&area=&sort=old&offset=0&limit=60");
  });

  it("the photo page's title is the photo's", async () => {
    app = await mount(HTML, { resolveModule });
    await app.state().write((s) => { s.routeName = "photo"; s.routeParams = { id: 42 }; s.photoValue = { id: 42, title: "港の夕暮れ", year: 1960, month: 3, area: "minato", tags: [], w: 1, h: 1, color: "#000000", donor: "x", description: "y", seen: 0 }; });
    await settle();
    expect(app.root.querySelector("#title").textContent).toBe("港の夕暮れ — みどり市 まちの記憶アーカイブ");
  });
});
