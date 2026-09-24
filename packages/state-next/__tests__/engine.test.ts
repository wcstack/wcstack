import { describe, it, expect } from "vitest";
import { Engine, mount, DirtyStrategy, VersionStrategy, type Strategy } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));

// happy-dom hoists a <template> out of <tbody> when parsing HTML (browsers do not),
// so the table fixture inserts its template through the DOM API.
const TABLE = "@table";
const ROW_HTML = `
    <tr data-wcs="class.danger: .selected">
      <td>{{ .id }}</td>
      <td><a class="select" data-wcs="onclick: onSelect">{{ .label }}</a></td>
      <td><a class="remove" data-wcs="onclick: onRemove">x</a></td>
    </tr>`;

function rowsOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, label: `row ${i + 1}` }));
}

function trs(): HTMLTableRowElement[] {
  return Array.from(document.querySelectorAll("tbody > tr"));
}

function ids(): string[] {
  return trs().map((tr) => tr.cells[0].textContent!);
}

function setup(html: string, state: Record<string, any>, make: () => Strategy): Engine {
  if (html === TABLE) {
    document.body.innerHTML = "<table><tbody></tbody></table>";
    const tpl = document.createElement("template");
    tpl.setAttribute("data-wcs", "for: data");
    tpl.innerHTML = ROW_HTML;
    document.querySelector("tbody")!.appendChild(tpl);
  } else {
    document.body.innerHTML = html;
  }
  const engine = new Engine(state, make());
  mount(engine, document);
  return engine;
}

const benchState = (variant: "tracked" | "manual" | "eqIndex") => {
  const base: Record<string, any> = {
    data: [] as any[],
    selectedIndex: null as number | null,
    onRemove(this: any, _e: Event, i: number) { this.data = this.data.toSpliced(i, 1); },
    onUpdate(this: any) { for (let i = 0; i < this.data.length; i += 10) this[`data.${i}.label`] += " !!!"; },
    onSwap(this: any) {
      const d = this.data.slice();
      [d[1], d[d.length - 2]] = [d[d.length - 2], d[1]];
      this.data = d;
    },
  };
  if (variant === "tracked") {
    Object.defineProperty(base, "data.*.selected", {
      get(this: any) { return this.$1 === this.selectedIndex; }, enumerable: true, configurable: true,
    });
    base.onSelect = function (this: any, _e: Event, i: number) { this.selectedIndex = i; };
  } else if (variant === "manual") {
    Object.defineProperty(base, "data.*.selected", {
      get(this: any) { return this.$1 === this.$untrackDependency(() => this.selectedIndex); },
      set(this: any, v: boolean) { this.selectedIndex = v ? this.$1 : null; },
      enumerable: true, configurable: true,
    });
    base.onSelect = function (this: any, _e: Event, i: number) {
      if (this.selectedIndex !== null && this.selectedIndex !== i) this[`data.${this.selectedIndex}.selected`] = false;
      this[`data.${i}.selected`] = true;
    };
  } else {
    Object.defineProperty(base, "data.*.selected", {
      get(this: any) { return this.$eqIndex("selectedIndex"); }, enumerable: true, configurable: true,
    });
    base.onSelect = function (this: any, _e: Event, i: number) { this.selectedIndex = i; };
  }
  return base;
};

const strategies: [string, () => Strategy][] = [
  ["dirty", () => new DirtyStrategy()],
  ["version", () => new VersionStrategy()],
];

describe.each(strategies)("%s strategy", (_name, make) => {
  describe("一覧の描画（ベンチマークと同じ形）", () => {
    it("配列を置き換えると行が描画され、mustache とドット省略が解決される", async () => {
      const e = setup(TABLE, benchState("tracked"), make);
      e.proxy.data = rowsOf(3);
      await flush();
      expect(ids()).toEqual(["1", "2", "3"]);
      expect(trs()[1].cells[1].textContent).toBe("row 2");
      expect(trs().some((tr) => tr.classList.contains("danger"))).toBe(false);
    });

    it("添字付きパスへの書き込みはその行だけを書き換える", async () => {
      const e = setup(TABLE, benchState("tracked"), make);
      e.proxy.data = rowsOf(25);
      await flush();
      e.proxy.onUpdate();
      await flush();
      expect(trs()[0].cells[1].textContent).toBe("row 1 !!!");
      expect(trs()[1].cells[1].textContent).toBe("row 2");
      expect(trs()[20].cells[1].textContent).toBe("row 21 !!!");
    });

    it("入れ替えは既存の tr を動かす（keyed）", async () => {
      const e = setup(TABLE, benchState("tracked"), make);
      e.proxy.data = rowsOf(10);
      await flush();
      const before = trs();
      e.proxy.onSwap();
      await flush();
      const after = trs();
      expect(ids()).toEqual(["1", "9", "3", "4", "5", "6", "7", "8", "2", "10"]);
      expect(after[1]).toBe(before[8]);
      expect(after[8]).toBe(before[1]);
      expect(after[5]).toBe(before[5]);
    });

    it("1 行削除はその tr だけを外し、他の tr は残る", async () => {
      const e = setup(TABLE, benchState("tracked"), make);
      e.proxy.data = rowsOf(5);
      await flush();
      const before = trs();
      (before[1].querySelector("a.remove") as HTMLElement).click();
      await flush();
      expect(ids()).toEqual(["1", "3", "4", "5"]);
      expect(trs()[1]).toBe(before[2]);
      expect(before[1].isConnected).toBe(false);
    });

    it("追加・全消去・再作成", async () => {
      const e = setup(TABLE, benchState("tracked"), make);
      e.proxy.data = rowsOf(3);
      await flush();
      e.proxy.data = e.proxy.data.concat([{ id: 4, label: "row 4" }]);
      await flush();
      expect(ids()).toEqual(["1", "2", "3", "4"]);
      e.proxy.data = [];
      await flush();
      expect(trs().length).toBe(0);
      e.proxy.data = rowsOf(2);
      await flush();
      expect(ids()).toEqual(["1", "2"]);
    });

    it("全置き換えは新しい tr を作る", async () => {
      const e = setup(TABLE, benchState("tracked"), make);
      e.proxy.data = rowsOf(3);
      await flush();
      const before = new Set(trs());
      e.proxy.data = rowsOf(3);
      await flush();
      expect(trs().filter((tr) => before.has(tr)).length).toBe(0);
    });
  });

  describe.each(["tracked", "manual", "eqIndex"] as const)("選択（%s）", (variant) => {
    it("クリックした行だけに danger が付き、選び直すと移る", async () => {
      const e = setup(TABLE, benchState(variant), make);
      e.proxy.data = rowsOf(6);
      await flush();
      (trs()[2].querySelector("a.select") as HTMLElement).click();
      await flush();
      expect(trs().map((tr) => tr.classList.contains("danger"))).toEqual([false, false, true, false, false, false]);
      (trs()[4].querySelector("a.select") as HTMLElement).click();
      await flush();
      expect(trs().map((tr) => tr.classList.contains("danger"))).toEqual([false, false, false, false, true, false]);
    });

    it("削除で位置が詰まると、選択は添字に付いていく", async () => {
      const e = setup(TABLE, benchState(variant), make);
      e.proxy.data = rowsOf(6);
      await flush();
      (trs()[3].querySelector("a.select") as HTMLElement).click();
      await flush();
      (trs()[1].querySelector("a.remove") as HTMLElement).click();
      await flush();
      // selectedIndex stays 3: the row now at index 3 (id 5) is the selected one
      expect(ids()).toEqual(["1", "3", "4", "5", "6"]);
      expect(trs().map((tr) => tr.classList.contains("danger"))).toEqual([false, false, false, true, false]);
    });
  });

  describe("書いた直後の読み（read-after-write）", () => {
    it("ルートの getter の連鎖は書いた直後に新しい値を返す", async () => {
      const state = {
        n: 1,
        get d() { return (this as any).n * 10; },
        get e() { return (this as any).d + 1; },
        run(this: any) { this.n = 5; return [this.d, this.e]; },
      };
      const e = setup(`<p data-wcs="textContent: e"></p>`, state, make);
      expect(document.querySelector("p")!.textContent).toBe("11");
      expect(e.proxy.run()).toEqual([50, 51]);
      await flush();
      expect(document.querySelector("p")!.textContent).toBe("51");
    });

    it("行の getter は添字付きの書き込みの直後に新しい値を返す（描画なしでも）", () => {
      const state: Record<string, any> = {
        data: [{ a: 1 }, { a: 2 }],
        run(this: any) {
          const before = this["data.1.b"];
          this["data.1.a"] = 7;
          return [before, this["data.1.b"], this["data.0.b"]];
        },
      };
      Object.defineProperty(state, "data.*.b", { get(this: any) { return this["data.*.a"] * 2; }, enumerable: true });
      const e = setup(``, state, make);
      expect(e.proxy.run()).toEqual([4, 14, 2]);
    });

    it("配列の置き換えの直後に、配列を読む getter が新しい値を返す", () => {
      const state = {
        data: [{ v: 1 }, { v: 2 }],
        get total() { return (this as any).data.reduce((s: number, x: any) => s + x.v, 0); },
        run(this: any) { const a = this.total; this.data = [...this.data, { v: 10 }]; return [a, this.total]; },
      };
      const e = setup(``, state, make);
      expect(e.proxy.run()).toEqual([3, 13]);
    });

    it("要素の書き込みはその位置の値を置き換え、行の getter を無効にする（位置モデル）", async () => {
      const state: Record<string, any> = {
        data: [{ a: 1 }, { a: 2 }],
        run(this: any) { this["data.0"] = { a: 5 }; return this["data.0.b"]; },
      };
      Object.defineProperty(state, "data.*.b", { get(this: any) { return this["data.*.a"] + 100; }, enumerable: true });
      const e = setup(`<ul><template data-wcs="for: data"><li>{{ .b }}</li></template></ul>`, state, make);
      await flush();
      const li0 = document.querySelector("li");
      expect(e.proxy.run()).toBe(105);
      await flush();
      expect(Array.from(document.querySelectorAll("li")).map((l) => l.textContent)).toEqual(["105", "102"]);
      expect(document.querySelector("li")).toBe(li0);
    });

    it("入れ子のリストと、親の行の値を読むバインディング", async () => {
      const state = {
        groups: [{ name: "a", items: [{ v: 1 }, { v: 2 }] }, { name: "b", items: [{ v: 3 }] }],
        rename(this: any) { this["groups.0.name"] = "A"; },
        add(this: any) { this["groups.1.items"] = [...this["groups.1.items"], { v: 4 }]; },
      };
      const e = setup(`<div>
        <template data-wcs="for: groups">
          <section><template data-wcs="for: .items"><i>{{ groups.*.name }}-{{ .v }}</i></template></section>
        </template></div>`, state, make);
      await flush();
      const text = () => Array.from(document.querySelectorAll("i")).map((i) => i.textContent);
      expect(text()).toEqual(["a-1", "a-2", "b-3"]);
      e.proxy.rename();
      e.proxy.add();
      await flush();
      expect(text()).toEqual(["A-1", "A-2", "b-3", "b-4"]);
    });
  });
});
