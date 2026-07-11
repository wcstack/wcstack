/**
 * stream.streamNamespace.test.ts
 *
 * `$streamStatus` / `$streamError` namespace proxy の単体テスト（B-1）。
 * commandNamespace（command.commandNamespace.test.ts）と対称。
 *
 * - memo 同一性（stateElement 単位・status / error は別 proxy）
 * - 宣言済み stream 名で registry entry の status / error が読めること
 * - 値を memo しない thin gateway であること（registry の書き換えが即座に見える）
 * - 宣言外・Symbol キー・then / constructor は undefined（throw しない寛容規約）
 * - set / deleteProperty は raiseError（書き込み防御 S11 の単体側）
 * - ownKeys / getOwnPropertyDescriptor は宣言済み stream 名を列挙
 * - clearStreamNamespace 後は新 proxy
 */
import { describe, it, expect } from "vitest";
import {
  getStreamStatusNamespace,
  getStreamErrorNamespace,
  clearStreamNamespace,
} from "../src/stream/streamNamespace";
import { setStreamEntries } from "../src/stream/streamRegistry";
import type { IStreamEntry, StreamStatus } from "../src/stream/types";
import type { IStateElement } from "../src/components/types";

function makeEntry(name: string, status: StreamStatus = "active", error: unknown = null): IStreamEntry {
  return {
    name,
    definition: {
      args: null,
      source: () => (async function* () {})(),
      fold: (_acc, chunk) => chunk,
      initial: undefined,
    },
    status,
    error,
    controller: null,
    depAddresses: new Set(),
  };
}

function makeStateElement(entries: IStreamEntry[]): IStateElement {
  const stateElement = {} as IStateElement;
  setStreamEntries(stateElement, new Map(entries.map((e) => [e.name, e])));
  return stateElement;
}

describe("streamNamespace", () => {
  describe("memo 同一性", () => {
    it("同一 stateElement に対して同じ proxy を返す（status / error 各系統で memo 化）", () => {
      const se = makeStateElement([makeEntry("tokens")]);
      expect(getStreamStatusNamespace(se)).toBe(getStreamStatusNamespace(se));
      expect(getStreamErrorNamespace(se)).toBe(getStreamErrorNamespace(se));
      // status と error は別 proxy
      expect(getStreamStatusNamespace(se)).not.toBe(getStreamErrorNamespace(se));
    });

    it("異なる stateElement には別々の proxy を返す", () => {
      const se1 = makeStateElement([makeEntry("tokens")]);
      const se2 = makeStateElement([makeEntry("tokens")]);
      expect(getStreamStatusNamespace(se1)).not.toBe(getStreamStatusNamespace(se2));
      expect(getStreamErrorNamespace(se1)).not.toBe(getStreamErrorNamespace(se2));
    });
  });

  describe("読み取り", () => {
    it("宣言済み stream 名で entry の status / error が読めること", () => {
      const failure = new Error("boom");
      const se = makeStateElement([
        makeEntry("tokens", "active", null),
        makeEntry("ticker", "error", failure),
      ]);
      const statusNs = getStreamStatusNamespace(se) as Record<string, unknown>;
      const errorNs = getStreamErrorNamespace(se) as Record<string, unknown>;
      expect(statusNs.tokens).toBe("active");
      expect(statusNs.ticker).toBe("error");
      expect(errorNs.tokens).toBeNull();
      expect(errorNs.ticker).toBe(failure);
    });

    it("値を memo しない thin gateway であること（registry entry の書き換えが即座に見える）", () => {
      const entry = makeEntry("tokens", "idle");
      const se = makeStateElement([entry]);
      const statusNs = getStreamStatusNamespace(se) as Record<string, unknown>;
      const errorNs = getStreamErrorNamespace(se) as Record<string, unknown>;
      expect(statusNs.tokens).toBe("idle");
      expect(errorNs.tokens).toBeNull();

      // runtime が status / error を書き換えると同じ proxy から新しい値が読める
      entry.status = "error";
      entry.error = "broken";
      expect(statusNs.tokens).toBe("error");
      expect(errorNs.tokens).toBe("broken");
    });

    it("宣言外の名前は undefined を返すこと", () => {
      const se = makeStateElement([makeEntry("tokens")]);
      const statusNs = getStreamStatusNamespace(se) as Record<string, unknown>;
      const errorNs = getStreamErrorNamespace(se) as Record<string, unknown>;
      expect(statusNs.unknown).toBeUndefined();
      expect(errorNs.unknown).toBeUndefined();
    });

    it("Symbol キーは undefined・in 演算子でも false（Symbol キー耐性）", () => {
      const se = makeStateElement([makeEntry("tokens")]);
      const statusNs = getStreamStatusNamespace(se) as any;
      const sym = Symbol("s");
      expect(statusNs[sym]).toBeUndefined();
      expect(sym in statusNs).toBe(false);
      expect(statusNs[Symbol.toPrimitive]).toBeUndefined();
    });

    it("then / constructor など内部機構が触るキーで throw しないこと（寛容規約）", () => {
      const se = makeStateElement([makeEntry("tokens")]);
      const statusNs = getStreamStatusNamespace(se) as Record<string, unknown>;
      const errorNs = getStreamErrorNamespace(se) as Record<string, unknown>;
      expect(statusNs.then).toBeUndefined();
      expect(statusNs.constructor).toBeUndefined();
      expect(errorNs.then).toBeUndefined();
      expect(errorNs.constructor).toBeUndefined();
      // Promise が触っても安全（thenable と誤認されず throw もしない）
      expect(() => Promise.resolve(statusNs)).not.toThrow();
    });
  });

  describe("書き込み防御（S11 単体側）", () => {
    it("set は raiseError すること（宣言済み・宣言外どちらのキーでも）", () => {
      const se = makeStateElement([makeEntry("tokens")]);
      const statusNs = getStreamStatusNamespace(se) as Record<string, unknown>;
      const errorNs = getStreamErrorNamespace(se) as Record<string, unknown>;
      expect(() => {
        statusNs.tokens = "done";
      }).toThrow(/\$streamStatus namespace is read-only/);
      expect(() => {
        statusNs.unknown = "x";
      }).toThrow(/\$streamStatus namespace is read-only/);
      expect(() => {
        errorNs.tokens = "x";
      }).toThrow(/\$streamError namespace is read-only/);
    });

    it("deleteProperty は raiseError すること", () => {
      const se = makeStateElement([makeEntry("tokens")]);
      const statusNs = getStreamStatusNamespace(se) as Record<string, unknown>;
      const errorNs = getStreamErrorNamespace(se) as Record<string, unknown>;
      expect(() => {
        delete statusNs.tokens;
      }).toThrow(/\$streamStatus namespace is read-only/);
      expect(() => {
        delete errorNs.tokens;
      }).toThrow(/\$streamError namespace is read-only/);
    });
  });

  describe("列挙", () => {
    it("ownKeys / Object.keys は宣言済み stream 名を列挙すること", () => {
      const se = makeStateElement([makeEntry("tokens"), makeEntry("ticker")]);
      const statusNs = getStreamStatusNamespace(se);
      const errorNs = getStreamErrorNamespace(se);
      expect(Object.keys(statusNs)).toEqual(["tokens", "ticker"]);
      expect(Object.keys(errorNs)).toEqual(["tokens", "ticker"]);
    });

    it("getOwnPropertyDescriptor は宣言済み名に現在値の descriptor を返し、宣言外は undefined", () => {
      const se = makeStateElement([makeEntry("tokens", "done")]);
      const statusNs = getStreamStatusNamespace(se);
      const desc = Object.getOwnPropertyDescriptor(statusNs, "tokens");
      expect(desc).toMatchObject({ configurable: true, enumerable: true, value: "done" });
      expect(Object.getOwnPropertyDescriptor(statusNs, "unknown")).toBeUndefined();
      const sym = Symbol("s");
      expect(Object.getOwnPropertyDescriptor(statusNs, sym)).toBeUndefined();
    });

    it("in 演算子は宣言済み stream 名のみ true", () => {
      const se = makeStateElement([makeEntry("tokens")]);
      const statusNs = getStreamStatusNamespace(se);
      expect("tokens" in statusNs).toBe(true);
      expect("unknown" in statusNs).toBe(false);
    });
  });

  describe("clearStreamNamespace", () => {
    it("クリア後は両系統とも新しい proxy を返すこと", () => {
      const se = makeStateElement([makeEntry("tokens")]);
      const status1 = getStreamStatusNamespace(se);
      const error1 = getStreamErrorNamespace(se);
      clearStreamNamespace(se);
      expect(getStreamStatusNamespace(se)).not.toBe(status1);
      expect(getStreamErrorNamespace(se)).not.toBe(error1);
    });

    it("未登録の stateElement を clear してもエラーにならないこと", () => {
      const se = {} as IStateElement;
      expect(() => clearStreamNamespace(se)).not.toThrow();
    });
  });
});
