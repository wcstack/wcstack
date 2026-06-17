import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MediaPermissionWatcher } from "../src/media/permission";
import { installMedia, InstalledMedia } from "./helpers";

describe("MediaPermissionWatcher", () => {
  let media: InstalledMedia;
  beforeEach(() => { media = installMedia(); });
  afterEach(() => { media.uninstall(); });

  it("query 結果を onChange に流し、live change にも追従する", async () => {
    const seen: string[] = [];
    const w = new MediaPermissionWatcher("camera", (s) => seen.push(s));
    await w.observe();
    expect(seen).toEqual(["prompt"]);
    media.control.permissionStatuses.get("camera")!.set("granted");
    expect(seen).toEqual(["prompt", "granted"]);
    w.dispose();
    // dispose 後の change は届かない。
    media.control.permissionStatuses.get("camera")!.set("denied");
    expect(seen).toEqual(["prompt", "granted"]);
  });

  it("二重 observe は早期 return（再購読しない）", async () => {
    const seen: string[] = [];
    const w = new MediaPermissionWatcher("camera", (s) => seen.push(s));
    await w.observe();
    await w.observe();
    expect(seen).toEqual(["prompt"]);
  });

  it("Permissions API 不在では unsupported を報告", async () => {
    media.uninstall();
    media = installMedia({ noPermissions: true });
    const seen: string[] = [];
    const w = new MediaPermissionWatcher("microphone", (s) => seen.push(s));
    await w.observe();
    expect(seen).toEqual(["unsupported"]);
  });

  it("query が descriptor を拒否したら unsupported", async () => {
    media.control.rejectPermissionQuery = true;
    const seen: string[] = [];
    const w = new MediaPermissionWatcher("camera", (s) => seen.push(s));
    await w.observe();
    expect(seen).toEqual(["unsupported"]);
  });

  it("dispose は購読前でも安全（listener 無し）", () => {
    const w = new MediaPermissionWatcher("camera", () => {});
    expect(() => w.dispose()).not.toThrow();
  });

  it("reject が dispose 後に解決しても bail する（世代ガード）", async () => {
    media.control.rejectPermissionQuery = true;
    const seen: string[] = [];
    const w = new MediaPermissionWatcher("camera", (s) => seen.push(s));
    const p = w.observe();
    w.dispose(); // reject の microtask 前に gen++
    await p;
    expect(seen).toEqual([]); // stale reject は unsupported を報告しない
  });

  it("resolve が dispose 後に解決しても listener を貼らない（世代ガード）", async () => {
    const seen: string[] = [];
    const w = new MediaPermissionWatcher("camera", (s) => seen.push(s));
    const p = w.observe();
    w.dispose(); // resolve の microtask 前に gen++
    await p;
    expect(seen).toEqual([]);
  });
});
