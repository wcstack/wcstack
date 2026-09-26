/**
 * coverage-element-sentences.test.ts — the diagnostics add-on's sentences
 * (src/diagnostics/messages.ts, rendered by src/diagnostics/explain.ts) for every numbered core
 * message, and the path checks of `getPathInfo` (src/public/pathInfo.ts) as the tooling reads them.
 * This file installs the diagnostics add-on: every message is the full sentence.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, diagnostics, getBindingsReady, installFeatures } from "../src/index";
import { M, text } from "../src/messages";
import { SENTENCES } from "../src/diagnostics/messages";
import { render } from "../src/diagnostics/explain";
import { MAX_DRAIN_PASSES, MAX_INDEX_PARAM } from "../src/engine";
import { getPathInfo } from "../src/public/pathInfo";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([diagnostics]);
  bootstrapState();
});

/** Every numbered message with representative values, and what the add-on renders. */
const RENDERED: [M, unknown[], string][] = [
  [M.ScanRemoved, [], "$scan was removed (use $watch or $on)"],
  [M.GetterWithoutSetter, ["total"], '"total" is a getter without a setter'],
  [M.NoRow, ["items.*.name"], 'no row for "items.*.name"'],
  [M.ParentNotObject, ["user.name", null], 'cannot write "user.name": its parent is null'],
  [M.NotAMethod, ["save"], '"save" is not a method'],
  [M.GetAllNoCommonLevel, ["a.*.b"], '$getAll("a.*.b"): no loop level in common with the context'],
  [M.EqIndexNoRow, ["items"], '$eqIndex("items") needs a list row scope.'],
  [M.Readonly, [], "This state is readonly."],
  [M.SetAllNeedsIndexes, ["items.*.done"], '$setAll("items.*.done") needs indexes ([] for every match)'],
  [M.SetAllSpreadLength, ["items.*.done", 3], '$setAll("items.*.done", …, { spread: true }) needs an array of 3 values'],
  [M.DrainNotSettled, [], `updates did not settle after ${MAX_DRAIN_PASSES} passes`],
  [M.BindingFailed, ["text", "bad"], 'binding "text: bad" failed to apply.'],
  [M.LoadFailed, ["state.json", 404], 'failed to load "state.json": 404'],
  [M.ElementFailed, [], "this <wcs-state> failed to initialize; create a new one"],
  [M.NotInitialized, [], "state is not initialized"],
  [M.NoScript, ["cfg"], 'no <script> with id "cfg"'],
  [M.TokenSubscriberThrew, ["save"], 'a subscriber of token "save" threw.'],
  [M.TokenListNotArray, ["$commandTokens"], "$commandTokens must be an array of strings."],
  [M.TokenEntryEmpty, ["$eventTokens"], "$eventTokens entries must be non-empty strings."],
  [M.TokenEntryReserved, ["$commandTokens", "$command", "$command"], '$commandTokens entry "$command" conflicts with the reserved namespace name "$command".'],
  [M.TokenEntryDuplicated, ["$eventTokens", "saved"], '$eventTokens entry "saved" is duplicated.'],
  [M.OnNotObject, [], "$on must be an object of handlers."],
  [M.OnEntryUndeclared, ["savd"], '$on entry "savd" is not declared in $eventTokens.'],
  [M.OnEntryNotFunction, ["saved"], '$on entry "saved" must be a function.'],
  [M.NamingLimit, [100], "view-transition naming-limit (100) reached."],
  [M.FilterOptionsRequired, ["eq"], "filter eq requires at least one option"],
  [M.FilterOptionNotNumber, ["lt"], "filter lt requires a number as option"],
  [M.FilterValueNotNumber, ["round"], "filter round requires a number value"],
  [M.FilterValueNotDate, ["date"], "filter date requires a date value"],
  [M.FilterValueNotArray, ["join"], "filter join requires an array value"],
  [M.DirectionalSyncDisabled, [], "init=/sync= modifiers require enableDirectionalInitialSync."],
  [M.ModifierUnknown, ["foo", "foo=1"], 'Unknown binding modifier "foo" in "foo=1".'],
  [M.ModifierTwice, ["init"], 'Binding modifier "init" may only be specified once.'],
  [M.ModifierValue, ["sync", "later"], 'Invalid sync modifier value "later".'],
  [M.EventInitNone, [], "Event bindings only allow init=none."],
  [M.InitUnsupported, ["radio", "element"], 'Binding type "radio" does not support init=element.'],
  [M.MemberUndeclared, ["title"], 'Property "title" is not declared by wcBindable.'],
  [M.InitIncompatible, ["auto", "status"], 'init=auto is incompatible with wcBindable member "status".'],
  [M.SyncConnectNeedsOutput, ["label"], 'sync=connect requires observable property "label".'],
  [M.SelectorRemoved, ["value: @main.count"], '"value: @main.count": the "@name" selector was removed in v2 — there is a single state tree. Mount the named state onto the tree (<wcs-state mount="...">) and read it by its path prefix instead.'],

  [M.BindTextNoColon, ["value"], `[wcs/binding-syntax] Invalid bindText: "value". Missing ':' separator between propPart and statePart.`],
  [M.StructuralTakesNoModifiers, ["for#ro: items", "for"], '[wcs/binding-syntax] "for#ro: items": "for" takes no modifiers or filters on its left side — write "for:".'],
  [M.ElseTakesNoValue, ["else: x"], '[wcs/binding-syntax] "else: x": "else" takes no value — write "else:".'],
  [M.SpreadNoPath, ["...:"], '[wcs/binding-syntax] Invalid spread binding "...:": spread target path is required.'],
  [M.SpreadNoFilters, ["...: a|x"], '[wcs/binding-syntax] Invalid spread binding "...: a|x": filters are not allowed on spread targets.'],
  [M.LeadingDotNamespace, [".class"], '[wcs/binding-syntax] ".class": a leading "." binds an element property by name — write a non-empty property that is not a namespace (class, attr, style, command, eventToken, state).'],
  [M.UnterminatedQuote, ["'", "'a"], `[wcs/binding-syntax] unterminated ' quote in the filter arguments "('a)". Close the quote.`],
  [M.FilterUnclosed, ["join(a"], '[wcs/binding-syntax] Invalid filter format: missing closing parenthesis in "join(a".'],
  [M.FilterUnopened, ["joina)"], '[wcs/binding-syntax] Invalid filter format: missing opening parenthesis in "joina)".'],
  [M.FilterParenOrder, [")join("], '[wcs/binding-syntax] Invalid filter format: ")" comes before "(" in ")join(".'],
  [M.FilterTrailing, ["join(a)x", "x"], `[wcs/binding-syntax] "join(a)x": unexpected "x" after the filter's closing ")" — separate filters with "|" (write "join(a)|x").`],
  [M.FilterEmpty, ["a||b"], '[wcs/binding-syntax] an empty filter in "a||b" — remove the extra "|" or name the filter.'],
  [M.FilterNameHasModifiersInput, ["trim#ro", "ro"], '[wcs/binding-syntax] "trim#ro" is not a filter name: a modifier list "#ro" comes before the input filters, not inside one'],
  [M.FilterNameHasModifiersOutput, ["trim#ro"], '[wcs/binding-syntax] "trim#ro" is not a filter name: "#" cannot appear in one.'],
  [M.OneModifierList, ["value#ro#wo"], '[wcs/binding-syntax] "value#ro#wo": a binding takes one modifier list after a single "#"'],
  [M.NoPropertyName, ["#ro"], '[wcs/binding-syntax] "#ro": the left side of a binding must name a property — write "<property>: <path>" (modifiers and input filters come after the name).'],
  [M.TooManySegments, ["a.b", 513], '[wcs/binding-syntax] "a.b" has 513 path segments — the limit is 512.'],
  [M.EmptySegment, ["value: a..b"], '[wcs/binding-syntax] "value: a..b": the right side of a binding must name a state path — write "<property>: <path>" (a path segment cannot be empty; "." alone and a leading "." are the loop-relative shorthand).'],

  [M.StructuralNotSingle, ["for: a; value: b"], `[wcs/template-syntax] Invalid bindText: "for: a; value: b". 'if', 'elseif', 'else', and 'for' bindings must be single binding.`],
  [M.ElseWithoutIf, ["else"], '[wcs/template-syntax] "else:" must follow an "if:" template'],
  [M.PathMissing, ["itemz"], '[wcs/binding-path-missing] Path "itemz" does not exist on the state tree.'],
  [M.ClassNeedsBoolean, ["active", "string"], "[wcs/binding-type-expectation] class.active needs a boolean, got string."],
  [M.FilterUnknown, ["uper"], "[wcs/filter-unknown] filter not found: uper."],
  [M.FilterTooFewArgs, ["clamp", 2, 1], '[wcs/filter-arity] filter "clamp" requires at least 2 argument(s) (1 given).'],
  [M.FilterTooManyArgs, ["join", 1, 2], '[wcs/filter-arity] filter "join" accepts at most 1 argument(s) (2 given).'],
  [M.GetterCycle, ["total"], '[wcs/getter-cycle] "total" depends on itself'],
  [M.GetterDepth, ["deep"], '[wcs/getter-depth-exceeded] "deep"'],
  [M.IndexArityExact, ["$resolve", "m.*.*", 2, 1], '[wcs/index-arity] $resolve("m.*.*") takes 2 index(es), got 1.'],
  [M.IndexArityAtMost, ["$getAll", "m.*", 1, 2], '[wcs/index-arity] $getAll("m.*") takes at most 1 index(es), got 2.'],
  [M.IndexParamRange, ["$99"], `[wcs/index-param-range] "$99": list index parameters run from $1 to $${MAX_INDEX_PARAM}.`],
  [M.RecursionUnsupported, ["a.**"], '[wcs/recursion-unsupported] "a.**" uses "**", which is not accepted here.'],
  [M.CommandRightSide, ["command.go", "go"], '[wcs/token-misconfigured] "command.go: go": the right-hand side must be $command.<name>'],
  [M.NoBindable, ["x-el", "command.go"], "[wcs/token-misconfigured] <x-el> declares no static wcBindable (command.go)."],
  [M.NoCommand, ["x-el", "go"], '[wcs/token-misconfigured] <x-el> declares no command "go".'],
  [M.NoProperty, ["x-el", "nope"], '[wcs/token-misconfigured] <x-el> declares no property "nope".'],
  [M.EventTokenUndeclared, ["made"], '[wcs/token-undeclared] eventToken "made" is not declared in $eventTokens.'],
  [M.CommandTokenUndeclared, ["sav"], '[wcs/token-undeclared] "$command.sav" is not declared in $commandTokens.'],
  [M.WildcardNoLoop, ["items.*.name", 1], '[wcs/wildcard-rank] "items.*.name" needs 1 enclosing loop level(s); the scope provides 0.'],
  [M.WildcardRelative, [".name"], '[wcs/wildcard-rank] ".name" is relative: it needs an enclosing "for" template'],
  [M.SpreadNoBindable, ["x-el", '"...: obj"'], '[wcs/spread-no-bindable] <x-el> declares no static wcBindable ("...: obj").'],
  [M.DeclarationRemoved, ["$streams", "$stream"], "[wcs/declaration-alias] $streams was removed: write $stream."],
  [M.ApiRemoved, ["$trackDependency", "$dependOn"], "[wcs/name-alias] $trackDependency was removed: write $dependOn."],
];

describe("番号付きのメッセージの文面（診断の後付け）", () => {
  it("表はすべての番号を 1 回ずつ含む", () => {
    const ids = RENDERED.map(([id]) => Number(id)).sort((a, b) => a - b);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(Object.keys(SENTENCES).map(Number).sort((a, b) => a - b));
  });

  it.each(RENDERED.map(([id, args, expected]) => [id, args, expected] as const))("#%i は値を埋めた文面になる", (id, args, expected) => {
    expect(text(id, args)).toBe(expected);
  });

  it("add-on の知らない番号は、コード・番号・値のまま出す", () => {
    expect(render(9999, ["a", 1])).toBe("#9999 a 1");
    expect(render(118, ["x"])).toBe("[wcs/binding-syntax] #118 x");
  });
});

describe("ページで出会う文面", () => {
  async function page(html: string, state: Record<string, any>) {
    const h = document.createElement(`cov-sentences-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = html;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState(state);
    document.body.appendChild(h);
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    await flush();
    return { root, el };
  }

  it("宣言に無いコマンドを配線した <wcs-state> は、要素とメソッドを名指しした文面で初期化に失敗する", async () => {
    const tag = `cov-sentences-el-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [], commands: [{ name: "go" }] };
      go(): void {}
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(page(`<wcs-state></wcs-state><${tag} data-wcs="command.stop: $command.t"></${tag}>`, { $commandTokens: ["t"] }))
        .rejects.toThrow(`[@wcstack/state] [wcs/token-misconfigured] <${tag}> declares no command "stop".`);
    } finally {
      error.mockRestore();
    }
  });

  it("宣言に無いイベントトークンの発火は、近い名前と lint への誘導付きで console.error に出る", async () => {
    const tag = `cov-sentences-el-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "done", event: `${tag}:done` }] };
      done: unknown = null;
    });
    const { root } = await page(`<wcs-state></wcs-state><${tag} data-wcs="eventToken.done: savd"></${tag}>`, { $eventTokens: ["saved"] });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      root.querySelector(tag)!.dispatchEvent(new CustomEvent(`${tag}:done`, { detail: 1 }));
      expect((error.mock.calls[0][0] as Error).message).toBe(
        '[@wcstack/state] [wcs/token-undeclared] eventToken "savd" is not declared in $eventTokens. Did you mean "saved"? Validate statically: npx @wcstack/lint <file>.',
      );
    } finally {
      error.mockRestore();
    }
  });
});

describe("getPathInfo のパスの検査", () => {
  it("** を含むパスは wcs/recursion-unsupported（どこで意味を持つかの案内付き）で拒み、intern しない", () => {
    const message = '[@wcstack/state] [wcs/recursion-unsupported] "tree.**.name" uses "**", which is not accepted here.'
      + " It is only meaningful in a $recursion declaration, in a recursive getter key, and in the path argument of $getAll / $setAll — and only when the state declares a $recursion anchor.";
    expect(() => getPathInfo("tree.**.name")).toThrow(message);
    expect(() => getPathInfo("tree.**.name")).toThrow(message);
  });

  it("512 セグメントまでは受け付け、513 セグメントは上限を示して拒む（lint への誘導は付けない）", () => {
    const path = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`).join(".");
    const ok = getPathInfo(path(512));
    expect(ok.segments).toHaveLength(512);
    expect(ok.parentPath).toBe(path(511));
    expect(getPathInfo(path(512))).toBe(ok);
    const long = path(513);
    expect(() => getPathInfo(long)).toThrow(
      `[@wcstack/state] [wcs/binding-syntax] "${long}" has 513 path segments — the limit is 512. Every prefix of a path is interned, so the cost grows with the square of the depth.`,
    );
    expect(() => getPathInfo(long)).toThrow(/the square of the depth\.$/);
  });
});
