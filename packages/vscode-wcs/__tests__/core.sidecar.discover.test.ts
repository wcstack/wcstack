import { describe, it, expect } from "vitest";
import {
  applicationStatesOf,
  discoverApplicationManifest,
  joinRelativeSource,
} from "../src/core/sidecar/discover.js";
import { loadManifest } from "../src/core/sidecar/loader.js";

const appManifest = (states: Record<string, unknown>): string =>
  JSON.stringify({
    schemaVersion: 1,
    kind: "application",
    manifestExtensions: { "wcstack.application": { version: 1, states } },
  });

const numberSchema = { type: "object", properties: { a: { type: "number" } } };

describe("discover — 最近傍の wcstack.manifest.json（D8）", () => {
  it("HTML と同じディレクトリにあればそれを採り、親は読まない", () => {
    const requested: string[] = [];
    const reader = (p: string): string | undefined => {
      requested.push(p);
      if (p === "wcstack.manifest.json") return appManifest({ default: { stateSchema: numberSchema } });
      if (p === "../wcstack.manifest.json") return appManifest({ default: { stateSchema: { type: "object", properties: { parent: {} } } } });
      return undefined;
    };
    const d = discoverApplicationManifest(reader)!;
    expect(d.relativePath).toBe("wcstack.manifest.json");
    expect([...d.states.keys()]).toEqual(["default"]);
    expect(d.states.get("default")!.properties).toHaveProperty("a");
    expect(requested).toEqual(["wcstack.manifest.json"]);
  });

  it("同階層に無ければ上へ辿り、最初に読めたものを採る（合成しない）", () => {
    const reader = (p: string): string | undefined =>
      p === "../../wcstack.manifest.json" ? appManifest({ default: { stateSchema: numberSchema }, other: { stateSchema: numberSchema } }) : undefined;
    const d = discoverApplicationManifest(reader)!;
    expect(d.relativePath).toBe("../../wcstack.manifest.json");
    expect([...d.states.keys()].sort()).toEqual(["default", "other"]);
  });

  it("どこにも無ければ undefined。上限階層で打ち切る（無限に登らない）", () => {
    let calls = 0;
    const d = discoverApplicationManifest(() => { calls++; return undefined; });
    expect(d).toBeUndefined();
    expect(calls).toBeLessThanOrEqual(17);
  });

  it("最近傍が壊れていてもそれを採り、上は見ない（診断は manifest 側に載せる）", () => {
    const reader = (p: string): string | undefined => {
      if (p === "wcstack.manifest.json") return "{ oops";
      if (p === "../wcstack.manifest.json") return appManifest({ default: { stateSchema: numberSchema } });
      return undefined;
    };
    const d = discoverApplicationManifest(reader)!;
    expect(d.relativePath).toBe("wcstack.manifest.json");
    expect(d.loaded.manifest).toBeNull();
    expect(d.states.size).toBe(0);
  });

  it("package kind の manifest からは state を取らない", () => {
    const pkg = JSON.stringify({ schemaVersion: 1, kind: "package", manifestExtensions: { "wcstack.types": { version: 1, components: {} } } });
    const d = discoverApplicationManifest((p) => (p === "wcstack.manifest.json" ? pkg : undefined))!;
    expect(d.states.size).toBe(0);
  });

  it("stateSchema がオブジェクトでない entry は入れない", () => {
    const loaded = loadManifest({
      text: appManifest({ ok: { stateSchema: numberSchema }, bad: { stateSchema: "nope" }, none: {}, nul: null }),
      source: "m.json",
    });
    expect([...applicationStatesOf(loaded).keys()]).toEqual(["ok"]);
  });
});

describe("joinRelativeSource — 発見した manifest の表示用 source", () => {
  it("HTML のディレクトリに相対パスを畳み込む（`..` は親へ、区切りは / に正規化）", () => {
    expect(joinRelativeSource("examples/app/index.html", "wcstack.manifest.json")).toBe("examples/app/wcstack.manifest.json");
    expect(joinRelativeSource("examples/app/index.html", "../wcstack.manifest.json")).toBe("examples/wcstack.manifest.json");
    expect(joinRelativeSource("examples/app/index.html", "../../wcstack.manifest.json")).toBe("wcstack.manifest.json");
    expect(joinRelativeSource("a\\b\\index.html", "../wcstack.manifest.json")).toBe("a/wcstack.manifest.json");
  });

  it("ディレクトリを登り切ったら `..` を残す", () => {
    expect(joinRelativeSource("index.html", "../wcstack.manifest.json")).toBe("../wcstack.manifest.json");
    expect(joinRelativeSource("a/index.html", "../../../m.json")).toBe("../../m.json");
  });
});
