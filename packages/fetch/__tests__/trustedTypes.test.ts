import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TRUSTED_TYPES_POLICY_SLOT,
  _resetTrustedTypesDiagnostics,
  getTrustedTypesPolicy,
  isTrustedTypesEnforced,
  setTrustedTypesPolicy,
  trustHtmlValue,
  writeTargetHTML,
} from "../src/trustedTypes";
import { Fetch } from "../src/components/Fetch";
import { registerComponents } from "../src/registerComponents";

registerComponents();

function createMockResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "Content-Type": "text/html" }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

/** happy-dom が innerHTML を定義しているプロトタイプを探す。 */
function findInnerHTMLOwner(): { proto: any, desc: PropertyDescriptor } {
  let proto: any = Object.getPrototypeOf(document.createElement("div"));
  while (proto) {
    const desc = Object.getOwnPropertyDescriptor(proto, "innerHTML");
    if (desc) return { proto, desc };
    proto = Object.getPrototypeOf(proto);
  }
  throw new Error("innerHTML descriptor not found");
}

/**
 * `require-trusted-types-for 'script'` 下のブラウザを模す。happy-dom には
 * Trusted Types の実装が無いので、sink が投げる状態と `trustedTypes` グローバルの
 * 存在をスタブする。
 */
function withTrustedTypesEnforced<T>(fn: () => T): T {
  const { proto, desc } = findInnerHTMLOwner();
  Object.defineProperty(proto, "innerHTML", {
    ...desc,
    set(_value: string) {
      throw new TypeError("Failed to set the 'innerHTML' property on 'Element': This document requires 'TrustedHTML' assignment.");
    },
  });
  (globalThis as any).trustedTypes = { createPolicy: () => ({}) };
  try {
    return fn();
  } finally {
    Object.defineProperty(proto, "innerHTML", desc);
    delete (globalThis as any).trustedTypes;
  }
}

describe("trustedTypes", () => {
  beforeEach(() => {
    setTrustedTypesPolicy(null);
    _resetTrustedTypesDiagnostics();
  });

  afterEach(() => {
    setTrustedTypesPolicy(null);
    _resetTrustedTypesDiagnostics();
    vi.restoreAllMocks();
  });

  describe("policy スロット", () => {
    it("未設定なら null を返すこと", () => {
      expect(getTrustedTypesPolicy()).toBeNull();
    });

    it("グローバルスロットに直接入れた policy も読めること（buildless 経路）", () => {
      const policy = { createHTML: (s: string) => s };
      (globalThis as any)[TRUSTED_TYPES_POLICY_SLOT] = policy;
      expect(getTrustedTypesPolicy()).toBe(policy);
    });

    it("オブジェクト以外がスロットに入っていたら null を返すこと", () => {
      (globalThis as any)[TRUSTED_TYPES_POLICY_SLOT] = "nope";
      expect(getTrustedTypesPolicy()).toBeNull();
    });
  });

  describe("trustHtmlValue", () => {
    it("文字列以外はそのまま返すこと", () => {
      const value = { html: true };
      expect(trustHtmlValue(value)).toBe(value);
    });

    it("policy が無ければ素通しすること（TT 下ではブラウザが弾く＝意図どおり）", () => {
      expect(trustHtmlValue("<p>x</p>")).toBe("<p>x</p>");
    });

    it("createHTML を持たない policy なら素通しすること", () => {
      setTrustedTypesPolicy({ createScriptURL: (s: string) => s });
      expect(trustHtmlValue("<p>x</p>")).toBe("<p>x</p>");
    });

    it("policy があれば createHTML を通すこと（policy を this にして呼ぶ）", () => {
      setTrustedTypesPolicy({
        prefix: "[s]",
        createHTML(this: any, s: string) { return `${this.prefix}${s}`; },
      } as any);
      expect(trustHtmlValue("<p>x</p>")).toBe("[s]<p>x</p>");
    });
  });

  describe("isTrustedTypesEnforced", () => {
    it("trustedTypes グローバルが無ければ false を返すこと", () => {
      expect(isTrustedTypesEnforced()).toBe(false);
    });

    it("trustedTypes があっても書き込みが通るなら false を返すこと（default policy 相当）", () => {
      (globalThis as any).trustedTypes = { createPolicy: () => ({}) };
      try {
        expect(isTrustedTypesEnforced()).toBe(false);
      } finally {
        delete (globalThis as any).trustedTypes;
      }
    });

    it("sink が投げるなら true を返し、結果をキャッシュすること", () => {
      withTrustedTypesEnforced(() => {
        expect(isTrustedTypesEnforced()).toBe(true);
      });
      // スタブを外した後もキャッシュ済みの結果を返す（cold path で 1 度だけ実測する）
      expect(isTrustedTypesEnforced()).toBe(true);
    });
  });

  describe("writeTargetHTML", () => {
    it("policy 未設定なら従来どおりそのまま書き込むこと", () => {
      const el = document.createElement("div");
      writeTargetHTML(el, "<p>plain</p>");
      expect(el.innerHTML).toBe("<p>plain</p>");
    });

    it("policy があれば TT 非対応ブラウザでも sanitizer を通すこと", () => {
      setTrustedTypesPolicy({ createHTML: () => "<p>sanitized</p>" });
      const el = document.createElement("div");
      writeTargetHTML(el, '<img src=x onerror="alert(1)">');
      expect(el.innerHTML).toBe("<p>sanitized</p>");
    });

    it("TT に弾かれたら直し方を 1 度だけ報告し、例外は投げ返さないこと（never-throw — 自動 fetch 経路で未処理 rejection にしない）", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      withTrustedTypesEnforced(() => {
        const el = document.createElement("div");
        expect(() => writeTargetHTML(el, "<p>x</p>")).not.toThrow();
        expect(() => writeTargetHTML(el, "<p>x</p>")).not.toThrow();
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toContain("blocked by Trusted Types");
      expect(spy.mock.calls[0][0]).toContain("does not pass responses through an identity policy");
    });

    it("policy 設定済みで弾かれたら policy 側の戻り値を疑うメッセージにすること", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      setTrustedTypesPolicy({ createHTML: (s: string) => s });
      withTrustedTypesEnforced(() => {
        const el = document.createElement("div");
        expect(() => writeTargetHTML(el, "<p>x</p>")).not.toThrow();
      });
      expect(spy.mock.calls[0][0]).toContain("did not return a TrustedHTML");
    });

    it("TT が強制されていない環境の書き込み失敗は診断を出さないこと", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const el = document.createElement("div");
      Object.defineProperty(el, "innerHTML", {
        set() { throw new TypeError("unrelated"); },
      });
      expect(() => writeTargetHTML(el, "<p>x</p>")).toThrow("unrelated");
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("<wcs-fetch target> との結線", () => {
    it("HTML 置換モードが利用側 sanitizer を通ること", async () => {
      const createHTML = vi.fn(() => "<p>sanitized</p>");
      setTrustedTypesPolicy({ createHTML });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(createMockResponse("<script>evil()</script>"));

      const area = document.createElement("div");
      area.id = "tt-target-area";
      document.body.appendChild(area);

      const el = document.createElement("wcs-fetch") as Fetch;
      el.url = "/api/partial";
      el.target = "tt-target-area";
      el.manual = true;
      document.body.appendChild(el);
      await el.fetch();

      expect(createHTML).toHaveBeenCalledWith("<script>evil()</script>");
      expect(area.innerHTML).toBe("<p>sanitized</p>");

      el.remove();
      area.remove();
    });
  });
});
