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

  describe("disconnectedCallback — 文書を離れるとき（timing contract §22）", () => {
    async function lockedEl(): Promise<{ el: WcsPointerLock; canvas: HTMLElement; events: unknown[]; doc: ReturnType<typeof installPointerLockDoc> }> {
      const doc = installPointerLockDoc();
      const canvas = document.createElement("canvas");
      canvas.id = "scene";
      document.body.appendChild(canvas);
      const el = createPointerLock();
      el.target = "#scene";
      document.body.appendChild(el);
      await el.requestPointerLock();
      expect(el.active).toBe(true);
      const events: unknown[] = [];
      el.addEventListener("wcs-pointer-lock:change", (e) => events.push((e as CustomEvent).detail));
      return { el, canvas, events, doc };
    }

    it("ロック中に切断すると change を false で発火し、active は false（:state(active) も外れる）。ロックは解かない", async () => {
      const { el, canvas, events, doc } = await lockedEl();
      expect(el.debugStates).toEqual(["active"]);

      el.remove();

      expect(events).toEqual([false]);
      expect(el.active).toBe(false);
      expect(el.debugStates).toEqual([]);
      expect(doc.getLockedElement()).toBe(canvas);
    });

    it("切断中は pointerlockchange を聞かない（購読は外れている）", async () => {
      const { el, canvas, events, doc } = await lockedEl();
      el.remove();
      events.length = 0;

      doc.setLockedElement(null);
      doc.setLockedElement(canvas);

      expect(events).toEqual([]);
      expect(el.active).toBe(false);
    });

    it("target がまだロックされたまま再接続すると true を公開し直す", async () => {
      const { el, events } = await lockedEl();
      el.remove();

      document.body.appendChild(el);

      expect(events).toEqual([false, true]);
      expect(el.active).toBe(true);
    });

    it("切断のあいだにロックが解けていれば、再接続しても false のまま", async () => {
      const { el, events, doc } = await lockedEl();
      el.remove();
      doc.setLockedElement(null);

      document.body.appendChild(el);

      expect(events).toEqual([false]);
      expect(el.active).toBe(false);
    });

    it("ロックしていないときの切断は何も発火しない", () => {
      installPointerLockDoc();
      const el = createPointerLock();
      el.target = "self";
      document.body.appendChild(el);
      const events: unknown[] = [];
      el.addEventListener("wcs-pointer-lock:change", (e) => events.push((e as CustomEvent).detail));

      el.remove();

      expect(events).toEqual([]);
      expect(el.active).toBe(false);
    });

    it("移動（切断 → 接続）は false、true の順に 2 回", async () => {
      const { el, events } = await lockedEl();
      const host = document.createElement("section");
      document.body.appendChild(host);

      host.appendChild(el); // moveBefore の無いブラウザの移動: 切断してから接続

      expect(events).toEqual([false, true]);
      expect(el.active).toBe(true);
    });
  });

  describe("pointerlockerror — イベントで届く拒否（Firefox）", () => {
    // Firefox の requestPointerLock() は何も返さない。拒否は document の
    // pointerlockerror でだけ届く。
    const silentRequest = function (this: Element): Promise<void> {
      return undefined as unknown as Promise<void>;
    };

    it("promise を返さない要求の拒否が error / errorInfo に載る（コマンドの promise が決着した後に届く）", async () => {
      const doc = installPointerLockDoc({}, silentRequest);
      const el = createPointerLock();
      el.target = "self";
      document.body.appendChild(el);
      const errors: unknown[] = [];
      el.addEventListener("wcs-pointer-lock:error", (e) => errors.push((e as CustomEvent).detail));

      await el.requestPointerLock();
      expect(el.error).toBeNull(); // この時点ではまだ答えが無い

      doc.fireError();

      expect(el.error.name).toBe("NotAllowedError");
      expect(el.error.message).toBe("The browser refused the pointer lock request.");
      expect(el.errorInfo?.code).toBe("not-allowed");
      expect(el.errorInfo?.recoverable).toBe(true);
      expect(errors).toHaveLength(1);
    });

    it("要求していないインスタンスは、他のインスタンスの拒否を自分の error にしない", async () => {
      const doc = installPointerLockDoc({}, silentRequest);
      const a = document.createElement("div");
      a.id = "a";
      const b = document.createElement("div");
      b.id = "b";
      document.body.append(a, b);
      const pl1 = createPointerLock();
      pl1.target = "#a";
      const pl2 = createPointerLock();
      pl2.target = "#b";
      document.body.append(pl1, pl2);

      await pl1.requestPointerLock();
      doc.fireError();

      expect(pl1.error).not.toBeNull();
      expect(pl2.error).toBeNull();
    });

    it("reject された promise の後のイベントは重ねて報告しない", async () => {
      const rejection = new DOMException("nope", "NotAllowedError");
      const doc = installPointerLockDoc({}, function () {
        return Promise.reject(rejection);
      });
      const el = createPointerLock();
      el.target = "self";
      document.body.appendChild(el);
      const errors: unknown[] = [];
      el.addEventListener("wcs-pointer-lock:error", (e) => errors.push((e as CustomEvent).detail));

      await el.requestPointerLock();
      doc.fireError();

      expect(errors).toEqual([rejection]);
      expect(el.error).toBe(rejection);
    });
  });

  describe("supported", () => {
    it("Core の値をそのまま返す（呼ぶたびに調べ直す）", () => {
      const el = createPointerLock();
      expect(el.supported).toBe(false);
      installPointerLockDoc();
      expect(el.supported).toBe(true);
    });

    it("API のあるページでは、接続時に supported-changed を true で 1 回発火する（再接続や target の変更では出ない）", () => {
      installPointerLockDoc();
      const el = createPointerLock();
      el.target = "self";
      const events: unknown[] = [];
      el.addEventListener("wcs-pointer-lock:supported-changed", (e) => events.push((e as CustomEvent).detail));

      document.body.appendChild(el);
      expect(events).toEqual([true]);

      el.target = "#elsewhere";
      el.remove();
      document.body.appendChild(el);
      expect(events).toEqual([true]);
    });

    it("API の無いページでは接続しても発火しない（最後に発火した値の初期値は false）", () => {
      const el = createPointerLock();
      el.target = "self";
      const events: unknown[] = [];
      el.addEventListener("wcs-pointer-lock:supported-changed", (e) => events.push((e as CustomEvent).detail));

      document.body.appendChild(el);

      expect(events).toEqual([]);
      expect(el.supported).toBe(false);
    });
  });

  describe("wcBindable", () => {
    it("Core の properties/commands を継承する", () => {
      expect(WcsPointerLock.wcBindable.properties.map((p) => p.name)).toEqual(["active", "error", "errorInfo", "supported"]);
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

    it("undefined はマークアップに書かれた target へ戻し、null は属性を外して既定（最初の子）へ戻す（P1 / P2）", () => {
      document.body.innerHTML = '<wcs-pointer-lock target="#authored"><canvas></canvas></wcs-pointer-lock>';
      const el = document.body.firstElementChild as WcsPointerLock;
      expect(el.style.display).toBe("none");
      el.target = "self";
      expect(el.style.display).toBe("block");
      el.target = undefined;
      expect(el.getAttribute("target")).toBe("#authored");
      expect(el.style.display).toBe("none");
      el.target = null;
      expect(el.hasAttribute("target")).toBe(false);
      expect(el.target).toBe("");
      expect(el.style.display).toBe("contents");
    });
  });
});
