/**
 * filters.split.test.ts — コア 24 本と formats 24 本の分け方（scope-classification §8 案 A）と、
 * 各フィルタの引数の個数（要件 B3）を固定する。
 *
 * 引数の個数の表は @wcstack/state 3.3.0 の `builtinFilterArity`（＝ filterMeta の minArgs / maxArgs、
 * lint と同じ正本）の写し。ここが変わる＝ lint / エディタと食い違う、ということ。
 */
import { describe, it, expect } from "vitest";
import { coreFilters } from "../src/filters/core";
import { formatFilters } from "../src/filters/formats";
import { FORMATS_FILTER_NAMES } from "../src/filters/registry";

const SOURCE_ARITY: Readonly<Record<string, readonly [number, number]>> = {
  eq: [1, 1], not: [0, 0], ne: [1, 1], lt: [1, 1], le: [1, 1], gt: [1, 1], ge: [1, 1],
  add: [1, 1], sub: [1, 1], mul: [1, 1], div: [1, 1], mod: [1, 1], abs: [0, 0], clamp: [2, 2],
  toFixed: [0, 1], locale: [0, 1],
  upper: [0, 0], lower: [0, 0], capitalize: [0, 0], trim: [0, 0], slice: [1, 2], substr: [2, 2],
  padStart: [1, 2], padEnd: [1, 2], repeat: [1, 1], reverse: [0, 0], truncate: [1, 2], join: [0, 1],
  int: [0, 0], float: [0, 0], round: [0, 1], floor: [0, 1], ceil: [0, 1], percent: [0, 1], unit: [1, 1],
  date: [0, 1], time: [0, 1], datetime: [0, 1], ymd: [0, 1], hms: [0, 1],
  falsy: [0, 0], truthy: [0, 0], defaults: [1, 1], coalesce: [1, 1],
  boolean: [0, 0], number: [0, 0], string: [0, 0], nullIfEmpty: [0, 0],
};

/** 3.x の `builtinFilterMeta` の並び（lint が did-you-mean の候補をこの順に読む） */
const SOURCE_ORDER = [
  "eq", "ne", "not", "lt", "le", "gt", "ge",
  "add", "sub", "mul", "div", "mod", "abs", "clamp",
  "toFixed", "locale", "upper", "lower", "capitalize", "trim", "slice", "substr", "padStart", "padEnd", "repeat", "reverse", "truncate", "join",
  "int", "float", "round", "floor", "ceil", "percent", "unit",
  "date", "time", "datetime", "ymd", "hms",
  "falsy", "truthy", "defaults", "coalesce", "boolean", "number", "string", "nullIfEmpty",
];

describe("コアと formats の分け方", () => {
  it("コアは条件・算術・型変換・欠損値の 24 本であること", () => {
    expect(Object.keys(coreFilters).sort()).toEqual([
      "eq", "ne", "not", "lt", "le", "gt", "ge", "truthy", "falsy", "boolean",
      "add", "sub", "mul", "div", "mod", "abs", "clamp",
      "number", "string", "int", "float",
      "defaults", "coalesce", "nullIfEmpty",
    ].sort());
  });

  it("formats は数値の表示・文字列の加工・日時の 24 本であること", () => {
    expect(Object.keys(formatFilters).sort()).toEqual([
      "toFixed", "round", "floor", "ceil", "percent", "unit", "locale",
      "upper", "lower", "capitalize", "trim", "slice", "substr", "padStart", "padEnd", "repeat", "reverse", "truncate", "join",
      "date", "time", "datetime", "ymd", "hms",
    ].sort());
  });

  it("各表の並びは 3.x（lint）の相対順であること（did-you-mean の同距離先勝ちを lint と揃える）", () => {
    expect(Object.keys(coreFilters)).toEqual(SOURCE_ORDER.filter((name) => name in coreFilters));
    expect(Object.keys(formatFilters)).toEqual(SOURCE_ORDER.filter((name) => name in formatFilters));
  });

  it("登録簿が formats 機能の案内に使う名前の表が、formats の実際の表と一致すること", () => {
    expect([...FORMATS_FILTER_NAMES]).toEqual(Object.keys(formatFilters));
  });

  it("2 つは重ならず、合わせて 3.x の 48 本（旧名を除く）ちょうどであること", () => {
    const core = Object.keys(coreFilters);
    const formats = Object.keys(formatFilters);
    expect(core.filter((name) => formats.includes(name))).toEqual([]);
    expect([...core, ...formats].sort()).toEqual(Object.keys(SOURCE_ARITY).sort());
  });
});

describe("引数の個数（要件 B3）", () => {
  it.each(Object.entries({ ...coreFilters, ...formatFilters }))("%s の [最少, 最多] が 3.x と同じであること", (name, definition) => {
    expect(definition.arity).toEqual(SOURCE_ARITY[name]);
    expect(definition.arity[0]).toBeLessThanOrEqual(definition.arity[1]);
  });
});
