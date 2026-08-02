import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { WcsMidi } from "../src/components/Midi";
import { MidiCore } from "../src/core/MidiCore";
import { registerComponents } from "../src/registerComponents";
import {
  FakeMidiAccess, FakeMidiInput, FakeMidiOutput,
  installMidi, removeMidi, removePermissions, record,
} from "./mocks";

const make = (attrs: Record<string, string> = {}): WcsMidi => {
  const el = document.createElement("wcs-midi") as WcsMidi;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
};

const mount = (el: WcsMidi): WcsMidi => {
  document.body.appendChild(el);
  return el;
};

describe("<wcs-midi>", () => {
  beforeAll(() => {
    registerComponents();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    removePermissions();
    removeMidi();
    vi.restoreAllMocks();
  });

  describe("接続と自動要求", () => {
    it("接続しただけでは request しない", () => {
      const mock = installMidi();
      mount(make());
      expect(mock.requestMIDIAccess).not.toHaveBeenCalled();
    });

    it("auto 属性付きなら接続時に request する", async () => {
      const mock = installMidi();
      const el = mount(make({ auto: "" }));
      await el.connectedCallbackPromise;
      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(1);
      expect(el.connected).toBe(true);
    });

    it("command.request で明示的に取得できる", async () => {
      installMidi();
      const el = mount(make());
      await el.request();
      expect(el.connected).toBe(true);
      expect(el.granted).toBe(true);
    });

    it("connectedCallbackPromise は SSR 用に await できる", async () => {
      installMidi();
      const el = mount(make({ auto: "" }));
      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
    });

    it("display:none を自分で設定する（描画を持たない）", () => {
      installMidi();
      const el = mount(make());
      expect(el.style.display).toBe("none");
    });

    it("切断で購読が外れる", async () => {
      const access = new FakeMidiAccess();
      const input = new FakeMidiInput("in-1");
      access.inputs.set(input.id, input);
      installMidi({ access });
      const el = mount(make({ auto: "" }));
      await el.connectedCallbackPromise;

      el.remove();

      expect(input.onmidimessage).toBeNull();
      expect(el.connected).toBe(false);
    });
  });

  describe("属性 ↔ プロパティ", () => {
    it("input / output は属性と往復する", () => {
      const el = make();
      expect(el.input).toBe("");
      el.input = "Launchkey";
      expect(el.getAttribute("input")).toBe("Launchkey");
      el.output = "Synth";
      expect(el.output).toBe("Synth");
    });

    it("channel は数値として読み書きでき、null で属性が消える", () => {
      const el = make();
      expect(el.channel).toBeNull();
      el.channel = 5;
      expect(el.getAttribute("channel")).toBe("5");
      expect(el.channel).toBe(5);
      el.channel = null;
      expect(el.hasAttribute("channel")).toBe(false);
    });

    it("数値でない channel 属性は null として扱う", () => {
      const el = make({ channel: "abc" });
      expect(el.channel).toBeNull();
    });

    it("sysex / auto は boolean 属性として往復する", () => {
      const el = make();
      expect(el.sysex).toBe(false);
      el.sysex = true;
      expect(el.hasAttribute("sysex")).toBe(true);
      el.sysex = false;
      expect(el.hasAttribute("sysex")).toBe(false);
      el.auto = true;
      expect(el.auto).toBe(true);
    });

    it("sysex 属性は requestMIDIAccess に渡る", async () => {
      const mock = installMidi();
      const el = mount(make({ auto: "", sysex: "" }));
      await el.connectedCallbackPromise;
      expect(mock.calls[0]).toEqual({ sysex: true });
    });

    it("upgrade 前に代入されたプロパティが取り込まれる", async () => {
      const mock = installMidi();
      const el = document.createElement("wcs-midi") as WcsMidi;
      // 未 upgrade 相当: own データプロパティで accessor をシャドウする
      delete (el as any).input;
      Object.defineProperty(el, "input", { value: "Launchkey", writable: true, configurable: true });
      mount(el);
      await el.connectedCallbackPromise;
      expect(el.getAttribute("input")).toBe("Launchkey");
      expect(mock.requestMIDIAccess).not.toHaveBeenCalled();
    });
  });

  describe("属性の live 更新", () => {
    it("接続中の input 変更は再 request せず購読を張り替える", async () => {
      const access = new FakeMidiAccess();
      access.inputs.set("a", new FakeMidiInput("a", "Alpha"));
      access.inputs.set("b", new FakeMidiInput("b", "Beta"));
      const mock = installMidi({ access });
      const el = mount(make({ auto: "", input: "a" }));
      await el.connectedCallbackPromise;
      const seen = record(el, "wcs-midi:message");

      el.setAttribute("input", "b");
      access.inputs.get("a")!.emit([0x90, 60, 100]);
      access.inputs.get("b")!.emit([0x90, 62, 100]);

      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(1);
      expect(seen).toHaveLength(1);
      expect(seen[0].note).toBe(62);
    });

    it("同じ値への setAttribute は何もしない", async () => {
      installMidi();
      const el = mount(make({ auto: "", channel: "3" }));
      await el.connectedCallbackPromise;
      const spy = vi.spyOn(el.core, "setOptions");
      el.setAttribute("channel", "3");
      expect(spy).not.toHaveBeenCalled();
    });

    it("未接続での属性変更は Core に触らない", () => {
      installMidi();
      const el = make();
      const spy = vi.spyOn(el.core, "setOptions");
      el.setAttribute("input", "a");
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("委譲", () => {
    it("Core の観測値をそのまま返す", async () => {
      const access = new FakeMidiAccess();
      const input = new FakeMidiInput("in-1", "Keys");
      access.inputs.set(input.id, input);
      installMidi({ access });
      const el = mount(make({ auto: "" }));
      await el.connectedCallbackPromise;

      input.emit([0xb0, 7, 100]);

      expect(el.type).toBe("controlchange");
      expect(el.control).toBe(7);
      expect(el.value).toBe(100);
      expect(el.note).toBeNull();
      expect(el.velocity).toBeNull();
      expect(el.message?.portName).toBe("Keys");
      expect(el.devices).toHaveLength(1);
      expect(el.permission).toBe("granted");
      expect(el.denied).toBe(false);
      expect(el.unsupported).toBe(false);
      expect(el.error).toBeNull();
      expect(el.errorInfo).toBeNull();
    });

    it("command.send は Core へ素通しする（位置引数保持）", async () => {
      const access = new FakeMidiAccess();
      const out = new FakeMidiOutput("out-1");
      access.outputs.set(out.id, out);
      installMidi({ access });
      const el = mount(make({ auto: "" }));
      await el.connectedCallbackPromise;

      el.send([0x90, 60, 100], 99);

      expect(out.sent).toEqual([{ data: [0x90, 60, 100], timestamp: 99 }]);
    });

    it("command.close で切断できる", async () => {
      installMidi();
      const el = mount(make({ auto: "" }));
      await el.connectedCallbackPromise;
      el.close();
      expect(el.connected).toBe(false);
    });

    it("core getter でヘッドレス Core に到達できる", () => {
      const el = make();
      expect(el.core).toBeInstanceOf(MidiCore);
    });

    it("非対応環境では unsupported が立つ", async () => {
      removeMidi();
      const el = mount(make({ auto: "" }));
      await el.connectedCallbackPromise;
      expect(el.unsupported).toBe(true);
      expect(el.error).toBe("unsupported");
      expect(el.errorInfo?.code).toBe("capability-missing");
    });
  });

  describe("wcBindable 宣言", () => {
    it("Core の properties を継承しつつ inputs を足す", () => {
      expect(WcsMidi.wcBindable.properties).toBe(MidiCore.wcBindable.properties);
      expect(WcsMidi.wcBindable.inputs?.map((i) => i.name)).toEqual([
        "input", "output", "channel", "sysex", "auto",
      ]);
    });

    it("hasConnectedCallbackPromise を宣言する（SSR 用）", () => {
      expect(WcsMidi.hasConnectedCallbackPromise).toBe(true);
    });

    it("observedAttributes は live 更新できる3つ", () => {
      expect(WcsMidi.observedAttributes).toEqual(["input", "output", "channel"]);
    });
  });
});
