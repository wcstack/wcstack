import { describe, it, expect, beforeAll, vi } from "vitest";
import { WcsDefined } from "../src/components/Defined.js";
import { bootstrapDefined } from "../src/bootstrapDefined.js";
import { uniqueTag, defineTag, flush } from "./helpers.js";

beforeAll(() => {
  bootstrapDefined();
});

function makeEl(attrs: Record<string, string>): WcsDefined {
  const el = document.createElement("wcs-defined") as WcsDefined;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

describe("<wcs-defined> Shell", () => {
  it("bootstrapDefined で wcs-defined が登録される", () => {
    expect(customElements.get("wcs-defined")).toBe(WcsDefined);
    expect(WcsDefined.hasConnectedCallbackPromise).toBe(true);
  });

  describe("属性パース", () => {
    it("tags はカンマ区切りで trim され空要素は除去される", async () => {
      const a = uniqueTag();
      const b = uniqueTag();
      defineTag(a);
      defineTag(b);
      const el = makeEl({ tags: ` ${a} , , ${b} ` });
      document.body.appendChild(el);
      await el.connectedCallbackPromise;
      expect(el.total).toBe(2);
      expect(el.count).toBe(2);
      expect(el.defined).toBe(true);
      el.remove();
    });

    it("tags 属性が無ければ空文字を返す", () => {
      expect(makeEl({}).tags).toBe("");
    });

    it("mode 既定は all、'any' のみ any として解釈する", () => {
      expect(makeEl({}).mode).toBe("all");
      expect(makeEl({ mode: "any" }).mode).toBe("any");
      expect(makeEl({ mode: "garbage" }).mode).toBe("all");
    });

    it("timeout は数値化され、非数値・負値・非有限は 0（=無制限）に正規化される", () => {
      expect(makeEl({ timeout: "3000" }).timeout).toBe(3000);
      expect(makeEl({ timeout: "abc" }).timeout).toBe(0);
      expect(makeEl({}).timeout).toBe(0);
      // 負値は無限待機に化けず 0 に丸められる
      expect(makeEl({ timeout: "-5000" }).timeout).toBe(0);
      // Infinity 相当も 0 に丸められる
      expect(makeEl({ timeout: "Infinity" }).timeout).toBe(0);
      // 小数はそのまま透過（setTimeout が ms を切り捨てる）
      expect(makeEl({ timeout: "1500.5" }).timeout).toBe(1500.5);
    });

    it("属性アクセサの setter は属性へ反映される", () => {
      const el = makeEl({});
      el.tags = "a-b,c-d";
      el.mode = "any";
      el.timeout = 500;
      expect(el.getAttribute("tags")).toBe("a-b,c-d");
      expect(el.getAttribute("mode")).toBe("any");
      expect(el.getAttribute("timeout")).toBe("500");
    });

    it("undefined はマークアップに書かれた属性へ戻し、null は属性を外す（P1 / P2）", () => {
      const host = document.createElement("div");
      host.innerHTML = '<wcs-defined tags="x-a,x-b" mode="any" timeout="3000"></wcs-defined>';
      const el = host.firstElementChild as WcsDefined;
      el.tags = "y-a";
      el.mode = "all";
      el.timeout = 10;
      el.tags = undefined;
      el.mode = undefined;
      el.timeout = undefined;
      expect(el.tags).toBe("x-a,x-b");
      expect(el.mode).toBe("any");
      expect(el.timeout).toBe(3000);
      el.tags = null;
      el.mode = null;
      el.timeout = null;
      // 文字列 "null" ではなく属性なし（既定値）
      expect(el.hasAttribute("tags")).toBe(false);
      expect(el.tags).toBe("");
      expect(el.hasAttribute("mode")).toBe(false);
      expect(el.mode).toBe("all");
      expect(el.hasAttribute("timeout")).toBe(false);
      expect(el.timeout).toBe(0);
    });

    it("マークアップに無い tags の undefined は文字列 \"undefined\" を書かず属性なしにする", () => {
      const el = makeEl({});
      el.tags = undefined;
      expect(el.hasAttribute("tags")).toBe(false);
      expect(el.tags).toBe("");
    });
  });

  describe("ライフサイクル", () => {
    it("接続時に display:none となる", () => {
      const el = makeEl({ tags: uniqueTag() });
      document.body.appendChild(el);
      expect(el.style.display).toBe("none");
      el.remove();
    });

    it("接続前のゲッターは既定値を返す", () => {
      const el = makeEl({ tags: uniqueTag() });
      expect(el.defined).toBe(false);
      expect(el.count).toBe(0);
      expect(el.total).toBe(0);
      expect(el.pending).toEqual([]);
      expect(el.missing).toEqual([]);
      expect(el.error).toBeNull();
    });

    it("connectedCallbackPromise は接続時の監視が settle すると resolve する", async () => {
      const t = uniqueTag();
      defineTag(t);
      const el = makeEl({ tags: t });
      document.body.appendChild(el);
      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
      expect(el.defined).toBe(true);
      el.remove();
    });

    it("切断で dispose され、再接続で再監視する", async () => {
      const t = uniqueTag();
      const el = makeEl({ tags: t });
      document.body.appendChild(el);
      el.remove(); // disconnectedCallback → dispose

      document.body.appendChild(el); // reconnect → 再 observe
      defineTag(t);
      await flush();
      expect(el.defined).toBe(true);
      el.remove();
    });

    it("接続中に tags / mode / timeout を変えると、その設定で見張り直す", async () => {
      const a = uniqueTag();
      const b = uniqueTag();
      defineTag(a);
      const el = makeEl({ tags: a });
      document.body.appendChild(el);
      await el.connectedCallbackPromise;
      expect(el.defined).toBe(true);

      // state などの binder は upgrade・接続の後にプロパティを書く
      el.tags = `${a},${b}`;
      expect(el.total).toBe(2);
      expect(el.pending).toEqual([b]);
      expect(el.defined).toBe(false);

      el.mode = "any";
      await flush();
      expect(el.defined).toBe(true);

      defineTag(b);
      await el.connectedCallbackPromise;
      expect(el.count).toBe(2);
      el.remove();
    });

    it("同じ値の書き込みと切断中の変更では見張り直さない", async () => {
      const a = uniqueTag();
      const el = makeEl({ tags: a });
      document.body.appendChild(el);
      const first = el.connectedCallbackPromise;
      el.tags = a;
      expect(el.connectedCallbackPromise).toBe(first);
      el.remove();
      const b = uniqueTag();
      defineTag(b);
      el.tags = b;
      expect(el.total).toBe(1);
      expect(el.pending).toEqual([a]);
      document.body.appendChild(el); // 再接続で新しい tags を読む
      await el.connectedCallbackPromise;
      expect(el.defined).toBe(true);
      el.remove();
    });

    it("timeout 属性で失敗検出が働く", async () => {
      vi.useFakeTimers();
      const t = uniqueTag();
      const el = makeEl({ tags: t, timeout: "1000" });
      document.body.appendChild(el);

      vi.advanceTimersByTime(1000);
      await flush();
      expect(el.missing).toEqual([t]);
      expect(el.defined).toBe(false);
      el.remove();
      vi.useRealTimers();
    });
  });
});
