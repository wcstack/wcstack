/**
 * 明示のプロパティ形 `.name:`（要件 B5・D34）— the parse half, ported from
 * packages/state/__tests__/binding.explicitProperty.test.ts（describe「明示のプロパティ形の解析」）.
 * The apply / listener halves need a mounted state and are not parser tests.
 */
import { describe, it, expect } from "vitest";
import { parseBindTextsForElement } from "../src/parser/parseBindTextsForElement";
import { installFeatures } from "../src/hooks";
import { diagnostics } from "../src/features/diagnostics";

// the sentences are the diagnostics add-on's (the core alone gives the code and the message number)
installFeatures([diagnostics]);

describe("明示のプロパティ形の解析", () => {
  it("`.online:` はプロパティ束縛、`online:` は従来どおりイベント束縛であること", () => {
    const [explicit, event] = parseBindTextsForElement(".online#ro: isOnline; online: refresh");
    expect(explicit).toMatchObject({ bindingType: "prop", propName: "online", propSegments: ["online"], propModifiers: ["ro"] });
    expect(event).toMatchObject({ bindingType: "event", propName: "online" });
  });

  it("入れ子のプロパティと入力フィルタを受けること", () => {
    const [result] = parseBindTextsForElement(".detail.onset|number: start");
    expect(result).toMatchObject({ bindingType: "prop", propName: "detail.onset", propSegments: ["detail", "onset"] });
    expect(result.inFilters.map((f) => f.filterName)).toEqual(["number"]);
  });

  // `.state: x` / `.state.taxRate: x` は要件 B14③ の左辺名前空間（`<wcs-state mount>` の注入宣言）
  // と曖昧なので、他の名前空間の語と同じ語彙で拒否する（D34）
  it.each([".: x", "..online: x", ".online.: x", ".class.on: x", ".attr.title: x", ".style.color: x", ".command.go: x", ".eventToken.done: x", ".state: x", ".state.taxRate: x"])(
    "%s を [wcs/binding-syntax] で拒否すること",
    (bindText) => {
      expect(() => parseBindTextsForElement(bindText)).toThrow(/\[wcs\/binding-syntax\].*leading "\."/);
    },
  );
});
