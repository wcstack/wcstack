import { describe, it, expect } from "vitest";
import {
  applicationSchemaOf,
  discoverApplicationManifest,
  joinRelativeSource,
} from "../src/core/sidecar/discover.js";
import { loadManifest } from "../src/core/sidecar/loader.js";

const appManifest = (stateSchema: unknown): string =>
  JSON.stringify({
    schemaVersion: 2,
    kind: "application",
    manifestExtensions: { "wcstack.application": { version: 2, stateSchema } },
  });

const numberSchema = { type: "object", properties: { a: { type: "number" } } };

describe("discover — 最近傍の wcstack.manifest.json（D8）", () => {
  it("HTML と同じディレクトリにあればそれを採り、親は読まない", () => {
    const requested: string[] = [];
    const reader = (p: string): string | undefined => {
      requested.push(p);
      if (p === "wcstack.manifest.json") return appManifest(numberSchema);
      if (p === "../wcstack.manifest.json") return appManifest({ type: "object", properties: { parent: {} } });
      return undefined;
    };
    const d = discoverApplicationManifest(reader)!;
    expect(d.relativePath).toBe("wcstack.manifest.json");
    expect(d.schema!.properties).toHaveProperty("a");
    expect(requested).toEqual(["wcstack.manifest.json"]);
  });

  it("同階層に無ければ上へ辿り、最初に読めたものを採る（合成しない）", () => {
    const reader = (p: string): string | undefined =>
      p === "../../wcstack.manifest.json" ? appManifest(numberSchema) : undefined;
    const d = discoverApplicationManifest(reader)!;
    expect(d.relativePath).toBe("../../wcstack.manifest.json");
    expect(d.schema!.properties).toHaveProperty("a");
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
      if (p === "../wcstack.manifest.json") return appManifest(numberSchema);
      return undefined;
    };
    const d = discoverApplicationManifest(reader)!;
    expect(d.relativePath).toBe("wcstack.manifest.json");
    expect(d.loaded.manifest).toBeNull();
    expect(d.schema).toBeUndefined();
  });

  it("package kind の manifest からは stateSchema を取らない", () => {
    const pkg = JSON.stringify({ schemaVersion: 2, kind: "package", manifestExtensions: { "wcstack.types": { version: 2, components: {} } } });
    const d = discoverApplicationManifest((p) => (p === "wcstack.manifest.json" ? pkg : undefined))!;
    expect(d.schema).toBeUndefined();
  });

  it("stateSchema がオブジェクトでなければ undefined", () => {
    const loaded = loadManifest({
      text: appManifest("nope"),
      source: "m.json",
    });
    expect(applicationSchemaOf(loaded)).toBeUndefined();
    const loadedArray = loadManifest({ text: appManifest([1]), source: "m.json" });
    expect(applicationSchemaOf(loadedArray)).toBeUndefined();
  });
});

describe("joinRelativeSource", () => {
  it("HTML の source と manifest 相対パスを結合し正規化する", () => {
    expect(joinRelativeSource("app/index.html", "wcstack.manifest.json")).toBe("app/wcstack.manifest.json");
    expect(joinRelativeSource("app/index.html", "../wcstack.manifest.json")).toBe("wcstack.manifest.json");
    expect(joinRelativeSource("index.html", "../wcstack.manifest.json")).toBe("../wcstack.manifest.json");
  });
});
