import { describe, it, expect, vi } from "vitest";

vi.mock("../src/webComponent/mount", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/webComponent/mount")>();
  return { ...actual, getMountRecordsForStateElement: vi.fn(actual.getMountRecordsForStateElement) };
});

import { scopeAddressHooks } from "../src/webComponent/addressHooks";
import { getMountRecordsForStateElement } from "../src/webComponent/mount";
import type { IContent } from "../src/structural/types";

/**
 * スコープ機能の rowReused hook（apply/applyChangeToFor.ts の受け口）。スコープの hook はボリュームだけの
 * state（マウント無し）にも付くので、hook 自身が「マウントがあるか」で抜ける。
 */
describe("webComponent/addressHooks — rowReused", () => {
  it("マウントの無い state では張り直しの走査に入らないこと", () => {
    scopeAddressHooks.rowReused!({} as any, {} as IContent);
    expect(vi.mocked(getMountRecordsForStateElement)).not.toHaveBeenCalled();
  });
});
