import { describe, it, expect } from "vitest";
import * as api from "../src/exports";
import { FetchHeader } from "../src/components/FetchHeader";
import { FetchBody } from "../src/components/FetchBody";

describe("exports: 補助のタグのクラス", () => {
  it("WcsFetchHeader / WcsFetchBody を出す（タグを自分で定義するページ — autoloader の包み・スコープ付きのレジストリ — が補助のタグも定義できる）", () => {
    expect(api.WcsFetchHeader).toBe(FetchHeader);
    expect(api.WcsFetchBody).toBe(FetchBody);
  });
});
