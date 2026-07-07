import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapNetwork } from "../src/bootstrapNetwork";
import { setConfig } from "../src/config";
import { WcsNetwork } from "../src/components/Network";
import { installConnection, removeConnection } from "./mocks";

function createNetwork(): WcsNetwork {
  return document.createElement("wcs-network") as WcsNetwork;
}

describe("Network (Shell)", () => {
  beforeEach(() => {
    setConfig({ tagNames: { network: "wcs-network" } });
    bootstrapNetwork();
    removeConnection();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    removeConnection();
  });

  it("接続時に display:none になり、既存 connection の値を反映する", () => {
    installConnection({ effectiveType: "3g", downlink: 1.5, rtt: 200, saveData: true });
    const el = createNetwork();
    document.body.appendChild(el);

    expect(el.style.display).toBe("none");
    expect(el.effectiveType).toBe("3g");
    expect(el.downlink).toBe(1.5);
    expect(el.rtt).toBe(200);
    expect(el.saveData).toBe(true);
    expect(el.supported).toBe(true);
  });

  it("接続前の getter は既定値を返す", () => {
    const el = createNetwork();
    expect(el.effectiveType).toBeNull();
    expect(el.downlink).toBeNull();
    expect(el.rtt).toBeNull();
    expect(el.saveData).toBeNull();
    expect(el.supported).toBe(false);
  });

  it("hasConnectedCallbackPromise が true で connectedCallbackPromise が即 settle する（SSR）", async () => {
    installConnection({ effectiveType: "4g" });
    expect(WcsNetwork.hasConnectedCallbackPromise).toBe(true);
    const el = createNetwork();
    document.body.appendChild(el);

    await el.connectedCallbackPromise;
    expect(el.effectiveType).toBe("4g");
  });

  it("非対応環境では supported=false のまま", async () => {
    removeConnection();
    const el = createNetwork();
    document.body.appendChild(el);
    await el.connectedCallbackPromise;
    expect(el.supported).toBe(false);
  });

  it("live change が要素の値に伝わる", () => {
    const conn = installConnection({ effectiveType: "4g" });
    const el = createNetwork();
    const seen: any[] = [];
    el.addEventListener("wcs-network:change", (e) => seen.push((e as CustomEvent).detail));
    document.body.appendChild(el); // 接続時に初回 snapshot（supported: false→true）が1回 dispatch される

    expect(seen).toHaveLength(1);
    conn.change({ effectiveType: "2g" });
    expect(el.effectiveType).toBe("2g");
    expect(seen).toHaveLength(2);
  });

  it("wcs-network:change は bubbles:true で祖先要素へ伝播する（guidelines §3.3 MUST）", () => {
    installConnection({ effectiveType: "4g" });
    const wrapper = document.createElement("div");
    document.body.appendChild(wrapper);
    const seen: any[] = [];
    wrapper.addEventListener("wcs-network:change", (e) => seen.push((e as CustomEvent).detail));

    wrapper.appendChild(createNetwork()); // 接続時の初回 snapshot が祖先まで bubble する

    expect(seen).toHaveLength(1);
    expect(seen[0].supported).toBe(true);
  });

  it("切断で change 購読を解除し、再接続で再度反映する", () => {
    const conn = installConnection({ effectiveType: "4g" });
    const el = createNetwork();
    document.body.appendChild(el);
    expect(el.effectiveType).toBe("4g");

    el.remove();
    conn.change({ effectiveType: "2g" });
    expect(el.effectiveType).toBe("4g"); // 切断後は追従しない

    const conn2 = installConnection({ effectiveType: "3g" });
    document.body.appendChild(el); // reconnect
    expect(el.effectiveType).toBe("3g");

    conn2.change({ effectiveType: "slow-2g" });
    expect(el.effectiveType).toBe("slow-2g");
  });

  it("inputs は空（属性を持たない、バッチ中最小の Shell）", () => {
    expect(WcsNetwork.wcBindable.inputs).toEqual([]);
    expect(WcsNetwork.wcBindable.commands).toEqual([]);
  });

  it("wcBindable: Shell は Core の5プロパティをそのまま継承する", () => {
    const props = WcsNetwork.wcBindable.properties.map((p) => p.name);
    expect(props).toEqual(["effectiveType", "downlink", "rtt", "saveData", "supported"]);
  });
});
