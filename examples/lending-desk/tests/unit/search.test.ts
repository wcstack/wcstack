import { describe, expect, it } from "vitest";
import { formFromQuery, itemsApiUrl, pageFromQuery, pageLinks, searchHref } from "../../src/lib/search.ts";

describe("the search in the URL", () => {
  it("query → form, ignoring what is not valid", () => {
    expect(formFromQuery({ q: "テント", center: "2", from: "2026-12-05", to: "bad", sort: "x" }))
      .toEqual({ q: "テント", category: "", center: "2", from: "2026-12-05", to: "", sort: "name" });
    expect(pageFromQuery({ page: "2" })).toBe(2);
    expect(pageFromQuery({ page: "-1" })).toBe(1);
  });
  it("form → href, stable order, only what is set", () => {
    const f = formFromQuery({ q: "テント", center: "2", from: "2026-12-05", to: "2026-12-06" });
    expect(searchHref(f, 2)).toBe("?q=%E3%83%86%E3%83%B3%E3%83%88&center=2&from=2026-12-05&to=2026-12-06&page=2");
    expect(searchHref(formFromQuery({}))).toBe("?");
  });
  it("the API url asks for free counts only with a whole period", () => {
    expect(itemsApiUrl(formFromQuery({ from: "2026-12-05" }), 1)).not.toContain("from=");
    expect(itemsApiUrl(formFromQuery({ from: "2026-12-05", to: "2026-12-06" }), 3)).toContain("from=2026-12-05&to=2026-12-06");
    expect(itemsApiUrl(formFromQuery({}), 1, "2000")).toContain("delay=2000");
  });
  it("page links", () => {
    const links = pageLinks(formFromQuery({ q: "机" }), 45, 2);
    expect(links.map((l) => l.n)).toEqual([1, 2, 3]);
    expect(links[0]?.href).toBe("/?q=%E6%9C%BA");
    expect(links[1]).toMatchObject({ current: true, href: "/?q=%E6%9C%BA&page=2" });
    expect(pageLinks(formFromQuery({}), 10, 1)[0]?.href).toBe("/?");
  });
});
