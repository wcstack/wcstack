import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapPointerLock } from "../src/bootstrapPointerLock";
import { setConfig } from "../src/config";
import { WcsPointerLock } from "../src/components/PointerLock";
import { installPointerLockDoc, removePointerLockDoc } from "./mocks";

function createPointerLock(): WcsPointerLock {
  return document.createElement("wcs-pointer-lock") as WcsPointerLock;
}

describe("PointerLock (Shell)", () => {
  beforeEach(() => {
    setConfig({ tagNames: { pointerLock: "wcs-pointer-lock" } });
    bootstrapPointerLock();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    removePointerLockDoc();
  });

  describe("target 解決の3モード + display 反映", () => {
    it('target="self" は自分自身を対象にし display:block', () => {
      const el = createPointerLock();
      el.target = "self";
      document.body.appendChild(el);
      expect(el.style.display).toBe("block");
    });

    it("target にセレクタを指定すると一致要素を対象にし display:none", () => {
      const referenced = document.createElement("div");
      referenced.id = "hero";
      document.body.appendChild(referenced);

      const el = createPointerLock();
      el.target = "#hero";
      document.body.appendChild(el);

      expect(el.style.display).toBe("none");
    });

    it("target 省略時、子要素があればそれを対象にし display:contents", () => {
      const el = createPointerLock();
      const child = document.createElement("canvas");
      el.appendChild(child);
      document.body.appendChild(el);

      expect(el.style.display).toBe("contents");
    });

    it("target 省略時、子要素が無ければ自分自身にフォールバックし display:block", () => {
      const el = createPointerLock();
      document.body.appendChild(el);

      expect(el.style.display).toBe("block");
    });

    it("不正なセレクタでも例外を投げず display:none（未解決）になる", () => {
      const el = createPointerLock();
      el.target = ":::invalid:::";
      expect(() => document.body.appendChild(el)).not.toThrow();
      expect(el.style.display).toBe("none");
    });
  });

  describe("requestPointerLock()/exitPointerLock() コマンド", () => {
    it("requestPointerLock() 成功で active: true になる", async () => {
      installPointerLockDoc();
      const el = createPointerLock();
      el.target = "self";
      document.body.appendChild(el);

      await el.requestPointerLock();

      expect(el.active).toBe(true);
      expect(el.error).toBeNull();
    });

    it("target が解決できない場合 requestPointerLock() は「未解決」の error を設定して resolve する（「未対応」とは別メッセージ）", async () => {
      installPointerLockDoc();
      const el = createPointerLock();
      el.target = "#does-not-exist";
      document.body.appendChild(el);

      await expect(el.requestPointerLock()).resolves.toBeUndefined();
      expect(el.active).toBe(false);
      expect(el.error).toEqual({ message: "Pointer Lock target could not be resolved." });
      // errorInfo が Shell ゲッター経由で Core から読める(taxonomy 分類済み)。
      expect(el.errorInfo).toEqual({
        code: "invalid-argument", phase: "start", recoverable: false,
        message: "Pointer Lock target could not be resolved.",
      });
    });

    it("exitPointerLock() でロック解除される", async () => {
      installPointerLockDoc();
      const el = createPointerLock();
      el.target = "self";
      document.body.appendChild(el);
      await el.requestPointerLock();
      expect(el.active).toBe(true);

      el.exitPointerLock();

      expect(el.active).toBe(false);
    });

    it("gesture 外呼び出し相当の reject で never-throw・error に格納される", async () => {
      installPointerLockDoc({}, function () {
        return Promise.reject(new DOMException("nope", "NotAllowedError"));
      });
      const el = createPointerLock();
      el.target = "self";
      document.body.appendChild(el);

      await expect(el.requestPointerLock()).resolves.toBeUndefined();
      expect(el.error.name).toBe("NotAllowedError");
      expect(el.active).toBe(false);
    });

    it("Core が Shell 上に発火する change イベントの detail は bare boolean（{ active } 形式ではない）", async () => {
      installPointerLockDoc();
      const el = createPointerLock();
      el.target = "self";
      document.body.appendChild(el);
      const events: unknown[] = [];
      el.addEventListener("wcs-pointer-lock:change", (e) => events.push((e as CustomEvent).detail));

      await el.requestPointerLock();
      el.exitPointerLock();

      expect(events).toEqual([true, false]);
    });
  });

  describe("複数インスタンス同時存在", () => {
    it("#a/#b をtargetにした2インスタンスが正しく分離される", async () => {
      installPointerLockDoc();
      const elA = document.createElement("div");
      elA.id = "a";
      const elB = document.createElement("div");
      elB.id = "b";
      document.body.appendChild(elA);
      document.body.appendChild(elB);

      const pl1 = createPointerLock();
      pl1.target = "#a";
      const pl2 = createPointerLock();
      pl2.target = "#b";
      document.body.appendChild(pl1);
      document.body.appendChild(pl2);

      await pl1.requestPointerLock();

      expect(pl1.active).toBe(true);
      expect(pl2.active).toBe(false);
    });
  });

  describe("attributeChangedCallback", () => {
    it("target 属性変更で再解決される", () => {
      const referenced1 = document.createElement("div");
      referenced1.id = "x";
      const referenced2 = document.createElement("div");
      referenced2.id = "y";
      document.body.appendChild(referenced1);
      document.body.appendChild(referenced2);

      const el = createPointerLock();
      el.target = "#x";
      document.body.appendChild(el);
      expect(el.style.display).toBe("none");

      el.target = "self";
      expect(el.style.display).toBe("block");
    });

    it("未接続時は attributeChangedCallback が何もしない", () => {
      const el = createPointerLock();
      expect(() => { el.target = "self"; }).not.toThrow();
    });
  });

  describe("SSR / ready", () => {
    it("hasConnectedCallbackPromise が true で connectedCallbackPromise が即 settle する", async () => {
      const el = createPointerLock();
      expect(WcsPointerLock.hasConnectedCallbackPromise).toBe(true);
      document.body.appendChild(el);

      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
    });
  });

  describe("disconnectedCallback", () => {
    it("切断で購読が解除され、以後の pointerlockchange に追従しない", async () => {
      const doc = installPointerLockDoc();
      const el = createPointerLock();
      el.target = "self";
      document.body.appendChild(el);
      await el.requestPointerLock();
      expect(el.active).toBe(true);

      el.remove();
      doc.setLockedElement(null);

      expect(el.active).toBe(true); // 切断後は追従しない
    });
  });

  describe("wcBindable", () => {
    it("Core の properties/commands を継承する", () => {
      expect(WcsPointerLock.wcBindable.properties.map((p) => p.name)).toEqual(["active", "error", "errorInfo"]);
      expect(WcsPointerLock.wcBindable.commands).toEqual([
        { name: "requestPointerLock", async: true },
        { name: "exitPointerLock" },
      ]);
    });

    it("inputs は target 属性のみ", () => {
      expect(WcsPointerLock.wcBindable.inputs).toEqual([{ name: "target", attribute: "target" }]);
    });

    it("movementX/movementY がどこにも現れない（回帰確認）", () => {
      const allNames = WcsPointerLock.wcBindable.properties.map((p) => p.name);
      expect(allNames).not.toContain("movementX");
      expect(allNames).not.toContain("movementY");
    });

    it("active は getter を持たない（Shell 側の継承後も bare boolean 形状のまま固定される）", () => {
      const prop = WcsPointerLock.wcBindable.properties.find((p) => p.name === "active")!;
      expect(prop.getter).toBeUndefined();
    });
  });

  describe("target アクセサ", () => {
    it("get/set target が属性と同期する", () => {
      const el = createPointerLock();
      expect(el.target).toBe("");
      el.target = "#foo";
      expect(el.getAttribute("target")).toBe("#foo");
      expect(el.target).toBe("#foo");
    });
  });
});
