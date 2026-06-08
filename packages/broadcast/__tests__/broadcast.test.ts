import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { WcsBroadcast } from "../src/components/Broadcast";
import {
  FakeBroadcastChannel,
  installBroadcastChannel,
  restoreBroadcastChannel,
} from "./mocks";

beforeAll(() => {
  if (!customElements.get("wcs-broadcast")) {
    customElements.define("wcs-broadcast", WcsBroadcast);
  }
});

function makeElement(attrs: Record<string, string> = {}): WcsBroadcast {
  const el = document.createElement("wcs-broadcast") as WcsBroadcast;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

describe("WcsBroadcast", () => {
  beforeEach(() => {
    installBroadcastChannel();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    restoreBroadcastChannel();
  });

  describe("属性アクセサ", () => {
    it("name の get/set が属性に反映される", () => {
      const el = makeElement();
      expect(el.name).toBe("");
      el.name = "room";
      expect(el.getAttribute("name")).toBe("room");
      expect(el.name).toBe("room");
    });

    it("manual の get/set が属性に反映される", () => {
      const el = makeElement();
      expect(el.manual).toBe(false);
      el.manual = true;
      expect(el.hasAttribute("manual")).toBe(true);
      el.manual = false;
      expect(el.hasAttribute("manual")).toBe(false);
    });
  });

  describe("connectedCallback", () => {
    it("display:none を設定する", () => {
      const el = makeElement({ name: "room" });
      document.body.appendChild(el);
      expect(el.style.display).toBe("none");
    });

    it("name があり manual でなければ接続時にチャンネルを開く", () => {
      const el = makeElement({ name: "room" });
      document.body.appendChild(el);
      expect(FakeBroadcastChannel.created).toHaveLength(1);
      expect(FakeBroadcastChannel.created[0].name).toBe("room");
    });

    it("name が無ければ開かない", () => {
      const el = makeElement();
      document.body.appendChild(el);
      expect(FakeBroadcastChannel.created).toHaveLength(0);
    });

    it("manual のときは接続時に開かない", () => {
      const el = makeElement({ name: "room", manual: "" });
      document.body.appendChild(el);
      expect(FakeBroadcastChannel.created).toHaveLength(0);
    });
  });

  describe("attributeChangedCallback", () => {
    it("接続後に name を変えると新チャンネルを開く", () => {
      const el = makeElement({ name: "a" });
      document.body.appendChild(el);
      el.setAttribute("name", "b");
      expect(FakeBroadcastChannel.created).toHaveLength(2);
      expect(FakeBroadcastChannel.registry.get("a")!.size).toBe(0);
      expect(FakeBroadcastChannel.registry.get("b")!.size).toBe(1);
    });

    it("manual のときは name 変更で開かない", () => {
      const el = makeElement({ name: "a", manual: "" });
      document.body.appendChild(el);
      el.setAttribute("name", "b");
      expect(FakeBroadcastChannel.created).toHaveLength(0);
    });

    it("未接続のときは name 変更で開かない", () => {
      const el = makeElement();
      el.setAttribute("name", "a"); // not connected yet
      expect(FakeBroadcastChannel.created).toHaveLength(0);
    });

    it("name を空にしても開かない", () => {
      const el = makeElement({ name: "a" });
      document.body.appendChild(el);
      el.removeAttribute("name");
      expect(FakeBroadcastChannel.created).toHaveLength(1); // 接続時の1回のみ
    });
  });

  describe("コマンド", () => {
    it("open() は name 属性のチャンネルを開く", () => {
      const el = makeElement({ name: "room", manual: "" });
      document.body.appendChild(el);
      expect(FakeBroadcastChannel.created).toHaveLength(0);
      el.open();
      expect(FakeBroadcastChannel.created).toHaveLength(1);
    });

    it("open() は name が空なら no-op", () => {
      const el = makeElement({ manual: "" });
      document.body.appendChild(el);
      el.open();
      expect(FakeBroadcastChannel.created).toHaveLength(0);
    });

    it("同一 name の別 <wcs-broadcast> には届くが送信元自身は受け取らない（self-exclusion ＋ 同一タブ共存）", () => {
      const a = makeElement({ name: "room" });
      const b = makeElement({ name: "room" });
      document.body.appendChild(a);
      document.body.appendChild(b);

      a.post("hello");
      expect(b.message).toBe("hello");
      expect(a.message).toBeNull();
    });

    it("close() でチャンネルを閉じる", () => {
      const el = makeElement({ name: "room" });
      document.body.appendChild(el);
      el.close();
      expect(FakeBroadcastChannel.registry.get("room")!.size).toBe(0);
    });
  });

  describe("getter 委譲", () => {
    it("message / error を Core から委譲する", () => {
      const el = makeElement({ name: "room" });
      document.body.appendChild(el);
      expect(el.message).toBeNull();
      expect(el.error).toBeNull();

      el.post("x");
      el.close();
      el.post("y"); // InvalidStateError
      expect(el.error?.name).toBe("InvalidStateError");
    });
  });

  describe("disconnectedCallback", () => {
    it("切断時にチャンネルを閉じる", () => {
      const el = makeElement({ name: "room" });
      document.body.appendChild(el);
      el.remove();
      expect(FakeBroadcastChannel.registry.get("room")!.size).toBe(0);
    });
  });
});
