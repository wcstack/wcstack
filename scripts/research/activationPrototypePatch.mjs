// Applies the plan-row activation prototype to a sandbox copy of packages/state (never to
// the repository). `BindingSession.activatePlanRows` repeats, per binding, the lookups that
// `registerAddress` needs (loop context by node, list index by binding, state element by root,
// tree path by path); the prototype resolves them once per row and caches the per-slot tree
// paths and wildcard depths on the row plan. Slots without a wildcard fall back to the
// existing `registerAddress`. Every replacement asserts that its anchor exists exactly once;
// idempotent through the marker.
//   node scripts/research/activationPrototypePatch.mjs <sandbox>/packages/state
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: activationPrototypePatch.mjs <sandbox>/packages/state');
const file = join(pkg, 'src/bindings/BindingSession.ts');
let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
const MARKER = 'function planRowContext(';
if (code.includes(MARKER)) { console.log('already patched bindings/BindingSession.ts'); process.exit(0); }
function replaceOnce(anchor, replacement) {
  const count = anchor instanceof RegExp ? (code.match(new RegExp(anchor.source, 'g')) ?? []).length : code.split(anchor).length - 1;
  if (count !== 1) throw new Error(`anchor found ${count} times: ${String(anchor).slice(0, 60)}`);
  code = code.replace(anchor, replacement);
}

// 1. imports (aliased so that existing imports of the same names cannot collide)
code = `import { getLoopContextByNode as getLoopContextByNodeForPlan } from "../list/loopContextByNode";
import { calcWildcardLen as calcWildcardLenForPlan } from "../address/calcWildcardLen";
import { listIndexAtWildcard as listIndexAtWildcardForPlan } from "../list/wildcardLevel";
import { ITreePath as ITreePathForPlan } from "../address/types";
import { IListIndex as IListIndexForPlan } from "../list/types";
import { IStateElement as IStateElementForPlan } from "../components/types";
import { IRowPlan as IRowPlanForPlan } from "../structural/types";
` + code;

// 2. per-plan caches and the per-row context, before the session class
replaceOnce('export class BindingSession {', `// next-major prototype: per-row hoisting of the lookups registerAddress repeats per binding,
// with the per-slot wildcard depth and tree path cached on the row plan.
interface IPlanRowContext { treePaths: ITreePathForPlan[]; listIndexes: (IListIndexForPlan | null)[]; }
const planWildcardLens = new WeakMap<IRowPlanForPlan, number[]>();
const planTreePaths = new WeakMap<IRowPlanForPlan, WeakMap<IStateElementForPlan, ITreePathForPlan[]>>();
function planRowContext(plan: IRowPlanForPlan, firstBinding: IBindingInfo, knownRoot: Node): IPlanRowContext | null {
  const loopContext = getLoopContextByNodeForPlan(firstBinding.node);
  if (loopContext === null) return null;
  const stateElement = getStateElement(knownRoot);
  if (stateElement === null) return null;
  const slots = plan.slots;
  let lens = planWildcardLens.get(plan);
  if (typeof lens === "undefined") {
    lens = slots.map(slot => calcWildcardLenForPlan(loopContext.pathInfo, slot.template.statePathInfo));
    planWildcardLens.set(plan, lens);
  }
  let byElement = planTreePaths.get(plan);
  if (typeof byElement === "undefined") {
    byElement = new WeakMap();
    planTreePaths.set(plan, byElement);
  }
  let treePaths = byElement.get(stateElement);
  if (typeof treePaths === "undefined") {
    treePaths = slots.map(slot => getTreePath(stateElement, slot.template.statePathInfo));
    byElement.set(stateElement, treePaths);
  }
  const listIndexes = new Array<IListIndexForPlan | null>(slots.length);
  for (let i = 0; i < slots.length; i++) {
    listIndexes[i] = lens[i] > 0
      ? (listIndexAtWildcardForPlan(loopContext.listIndex, lens[i] - 1, loopContext.pathInfo.wildcardCount) ?? null)
      : null;
  }
  return { treePaths, listIndexes };
}

export class BindingSession {`);

// 3. activatePlanRows: resolve the row context once, register through the plan fast path
replaceOnce(/  private activatePlanRows\(plan: IRowPlan, bindings: readonly IBindingInfo\[\], knownRoot: Node\): void \{[\s\S]*?\n  \}\n/, `  private activatePlanRows(plan: IRowPlan, bindings: readonly IBindingInfo[], knownRoot: Node): void {
    const slots = plan.slots;
    const rowContext = bindings.length > 0 ? planRowContext(plan, bindings[0], knownRoot) : null;
    for (let i = 0; i < bindings.length; i++) {
      const binding = bindings[i];
      const record = recordByBinding.get(binding);
      if (typeof record === "undefined" || record.session !== this) {
        this.initialize([binding], { registerAddress: true, registerPathInfo: false, applyOnReconnect: false });
        continue;
      }
      record.options.registerAddress = true;
      if (record.phase === "disposed" || record.phase === "failed") {
        const slot = slots[i];
        record.generation = ++nextGeneration;
        record.phase = "active";
        record.initialPolicy = slot.policy;
        record.resolvedAuthority = slot.authority;
        record.initialSettled = true;
        record.initialApplyDone = false;
        record.outputOnlyMember = slot.policy.outputOnly;
        this.records.add(record);
        if (slot.isEvent) {
          try {
            attachEventHandler(binding);
          } catch (error) {
            record.phase = "failed";
            this.runTeardowns(record);
            this.records.delete(record);
            throw error;
          }
          record.eventAttached = true;
        }
        this.registerPlanAddress(record, i, rowContext, knownRoot);
        continue;
      }
      if (record.address === null && record.patternListIndex === null) {
        this.registerPlanAddress(record, i, rowContext, knownRoot);
      }
    }
  }

  private registerPlanAddress(record: IInternalBindingRecord, slotIndex: number, rowContext: IPlanRowContext | null, knownRoot: Node): void {
    if (record.address !== null || record.patternListIndex !== null) return;
    const listIndex = rowContext === null ? null : rowContext.listIndexes[slotIndex];
    if (rowContext === null || listIndex === null) {
      this.registerAddress(record, knownRoot);
      return;
    }
    const absolutePathInfo = rowContext.treePaths[slotIndex];
    addBindingByPattern(absolutePathInfo, listIndex, record.info);
    record.patternPathInfo = absolutePathInfo;
    record.patternListIndex = listIndex;
  }
`);
await writeFile(file, code);
console.log('patched bindings/BindingSession.ts');
