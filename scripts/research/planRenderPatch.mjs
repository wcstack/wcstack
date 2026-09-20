// Survey §11 (round 4) item 3 (b): plan-level initial render. When a plan row is activated,
// every binding today goes through applyChange → getValue → the proxy (address creation, cache
// lookup, parent walk); the profile of §10.11 put address creation (5.3 µs/row) and
// applyChange's gates ahead of the reads themselves. This prototype reads the row object once
// through the proxy and, for slots whose state path is a plain leaf under the row (no getter on
// any prefix, no wildcard in the tail, not an event / index binding), takes the value from the
// raw row object and hands it to the same DOM writer (applyValueToBinding, the tail of
// _applyChange). Getter slots and everything else keep applyChange. Only when the state has no
// $updatedCallback (the per-binding address aggregation is then skipped anyway). Applied to a
// sandbox copy of packages/state; every replacement asserts that its anchor exists exactly once.
//   node scripts/research/planRenderPatch.mjs <sandbox>/packages/state
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: planRenderPatch.mjs <sandbox>/packages/state');
async function patch(rel, marker, edits) {
  const file = join(pkg, 'src', rel);
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes(marker)) { console.log('already patched', rel); return; }
  for (const [anchor, replacement] of edits) {
    const count = code.split(anchor).length - 1;
    if (count !== 1) throw new Error(`${rel}: anchor found ${count} times: ${anchor.slice(0, 70)}`);
    code = code.replace(anchor, () => replacement);
  }
  await writeFile(file, code);
  console.log('patched', rel);
}

await writeFile(join(pkg, 'src/structural/planByContent.ts'), `import type { IContent, IRowPlan } from "./types";

// plan-render prototype: the row plan a content was instantiated from (plan path only)
const planByContent = new WeakMap<IContent, IRowPlan>();
export function setPlanByContent(content: IContent, plan: IRowPlan): void {
  planByContent.set(content, plan);
}
export function getPlanByContent(content: IContent): IRowPlan | null {
  return planByContent.get(content) ?? null;
}
`);
console.log('wrote structural/planByContent.ts');

await patch('structural/createContent.ts', 'setPlanByContent', [
  ['import { compileRowPlan } from "./rowPlan.js";', 'import { compileRowPlan } from "./rowPlan.js";\nimport { setPlanByContent } from "./planByContent.js";'],
  [`  const content = new Content(cloneFragment);
  setBindingSessionByContent(content, session);
  setBindingsByContent(content, bindings);`, `  const content = new Content(cloneFragment);
  setBindingSessionByContent(content, session);
  setBindingsByContent(content, bindings);
  setPlanByContent(content, plan);`],
]);

await patch('apply/applyChange.ts', 'export function applyValueToBinding', [
  [`function _applyChange(binding: IBindingInfo, context: IApplyContext): void {
  const value = getValue(context.state, binding);
  const filteredValue = getFilteredValue(value, binding.outFilters);`, `function _applyChange(binding: IBindingInfo, context: IApplyContext): void {
  applyValueToBinding(binding, context, getValue(context.state, binding));
}

/** plan-render prototype: the DOM-writing tail of _applyChange for an already resolved value */
export function applyValueToBinding(binding: IBindingInfo, context: IApplyContext, value: unknown): void {
  const filteredValue = getFilteredValue(value, binding.outFilters);`],
]);

await patch('structural/activateContent.ts', 'applyPlanRow', [
  ['import { applyChange } from "../apply/applyChange";', `import { applyChange, applyValueToBinding } from "../apply/applyChange";
import { getPlanByContent } from "./planByContent";
import { getByAddressSymbol } from "../proxy/symbols";
import type { IStateElement } from "../components/types";
import type { IRowPlan } from "./types";
import type { IBindingInfo } from "../types";
import type { BindingSession } from "../bindings/BindingSession";`],
  [`export function activateContent(`, `// plan-render prototype: per (plan, row path), the structural tail of each slot under the row
// (null = event / index binding, path not under the row, or a wildcard in the tail). Whether a
// prefix is a getter is decided per row against the state's current getterPaths (the set is
// rebuilt on a state reset, so it must not be cached), and a state with recursion (\`**\`) takes
// the ordinary path because its expanded getters are not in getterPaths.
interface ISlotTail { readonly tail: string[]; readonly prefixes: string[]; }
const tailsByPlan = new WeakMap<IRowPlan, Map<string, (ISlotTail | null)[]>>();
function slotTails(plan: IRowPlan, bindings: readonly IBindingInfo[], rowPath: string): (ISlotTail | null)[] {
  let byRowPath = tailsByPlan.get(plan);
  if (typeof byRowPath === "undefined") {
    tailsByPlan.set(plan, byRowPath = new Map());
  }
  let tails = byRowPath.get(rowPath);
  if (typeof tails !== "undefined") {
    return tails;
  }
  const prefix = rowPath + ".";
  tails = bindings.map((binding, i) => {
    const slot = plan.slots[i];
    if (slot.isEvent || slot.isIndexBinding) return null;
    const path = binding.statePathInfo.path;
    if (!path.startsWith(prefix)) return null;
    const tail = path.slice(prefix.length).split(".");
    const prefixes: string[] = [];
    let acc = rowPath;
    for (const segment of tail) {
      if (segment === "*") return null;
      acc += "." + segment;
      prefixes.push(acc);
    }
    return { tail, prefixes };
  });
  byRowPath.set(rowPath, tails);
  return tails;
}

function hasGetterOnPrefix(prefixes: string[], getterPaths: ReadonlySet<string>): boolean {
  for (let k = 0; k < prefixes.length; k++) {
    if (getterPaths.has(prefixes[k])) return true;
  }
  return false;
}

function applyPlanRow(plan: IRowPlan, bindings: readonly IBindingInfo[], session: BindingSession, loopContext: ILoopContext, context: IApplyContext): void {
  const stateElement: IStateElement = context.stateElement;
  const tails = slotTails(plan, bindings, loopContext.pathInfo.path);
  const getterPaths = stateElement.getterPaths;
  let rowValue: any;
  let rowRead = false;
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    if (!session.shouldApplyState(binding)) continue;
    const slotTail = tails[i];
    if (slotTail === null || hasGetterOnPrefix(slotTail.prefixes, getterPaths)) {
      applyChange(binding, context);
      continue;
    }
    if (context.appliedBindingSet.has(binding)) continue;
    context.appliedBindingSet.add(binding);
    if (!rowRead) {
      rowValue = context.state[getByAddressSymbol](loopContext);
      rowRead = true;
    }
    const tail = slotTail.tail;
    let value: any = rowValue;
    for (let k = 0; k < tail.length; k++) {
      if (value === null || typeof value === "undefined") { value = undefined; break; }
      value = value[tail[k]];
    }
    applyValueToBinding(binding, context, value);
  }
}

export function activateContent(`],
  [`    session.activate(bindings, context.rootNode);
  }
  for (const binding of bindings) {`, `    session.activate(bindings, context.rootNode);
    // plan-render prototype: plan rows without $updatedCallback and without recursion take the raw-leaf path
    if (loopContext !== null && context.stateElement.hasUpdatedCallback === false && context.stateElement.hasRecursion !== true) {
      const plan = getPlanByContent(content);
      if (plan !== null) {
        applyPlanRow(plan, bindings, session, loopContext, context);
        return;
      }
    }
  }
  for (const binding of bindings) {`],
]);
