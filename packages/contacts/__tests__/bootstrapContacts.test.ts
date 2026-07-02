import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapContacts } from "../src/bootstrapContacts";
import { getConfig, setConfig } from "../src/config";

describe("bootstrapContacts", () => {
  beforeEach(() => {
    setConfig({
      tagNames: { contacts: "wcs-contacts" },
    });
  });

  it("設定なしで呼び出してもエラーにならない", () => {
    expect(() => bootstrapContacts()).not.toThrow();
  });

  it("userConfig を setConfig へ転送する（既定タグ維持）", () => {
    bootstrapContacts({ tagNames: { contacts: "wcs-contacts" } });
    expect(getConfig().tagNames.contacts).toBe("wcs-contacts");
  });

  it("wcs-contacts をカスタム要素として登録する", () => {
    bootstrapContacts();
    expect(customElements.get("wcs-contacts")).toBeDefined();
  });
});
