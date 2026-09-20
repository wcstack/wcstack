// Applies the H1 "read/write boundary hook" receptacle of the wiring design (stage S3) to a
// sandbox copy of packages/state (never to the repository), for the cost measurement of
// design §7-4 only: the feature branches stay where they are, and a hook loop is added at
// the top of getByAddress (read), setByAddressCore (write) and the get trap's string-prop
// path (get). With `--inactive N`, bootstrapState() registers N hooks per receptacle that
// perform one boolean check and return NOT_HANDLED, i.e. an installed feature whose
// declaration is absent from this state. Every replacement asserts that its anchor exists
// exactly once; idempotent through the marker.
//   node scripts/research/addressHookPrototypePatch.mjs <sandbox>/packages/state [--inactive N]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: addressHookPrototypePatch.mjs <sandbox>/packages/state [--inactive N]');
const inactive = process.argv.includes('--inactive') ? Number(process.argv[process.argv.indexOf('--inactive') + 1]) : 0;
// --gated: the loops run only when the state element carries a feature mask (`hasAddressHooks`),
// i.e. hooks registered per state at declaration time rather than a global array — the D18
// shape (`hasMounts === true`) the core uses today. The flag is never set in the fixture, so
// this measures the cost of the gate alone with N hooks registered globally.
const gated = process.argv.includes('--gated');
const gate = (expr, element = 'stateElement') => gated ? `(${expr}) && (${element} as any).hasAddressHooks === true` : expr;
async function patch(rel, marker, edits) {
  const file = join(pkg, 'src', rel);
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes(marker)) { console.log('already patched', rel); return; }
  for (const [anchor, replacement] of edits) {
    const count = code.split(anchor).length - 1;
    if (count !== 1) throw new Error(`${rel}: anchor found ${count} times: ${anchor.slice(0, 70)}`);
    // function form: a replacement containing `$'` (as in `prop[0] === '$'`) must not be read as a pattern
    code = code.replace(anchor, () => replacement);
  }
  await writeFile(file, code);
  console.log('patched', rel);
}

await mkdir(join(pkg, 'src/core'), { recursive: true });
await writeFile(join(pkg, 'src/core/addressHooks.ts'), `/**
 * core/addressHooks.ts — next-major prototype of receptacle H1 (docs/state-next-major-wiring-design.md §3).
 * Features register hooks; the core calls them at its read / write / get boundaries and takes the
 * first result that is not NOT_HANDLED. With nothing registered the hot path pays one length check.
 */
import type { IStateAddress } from "../address/types";
import type { IStateElement } from "../components/types";
import type { IStateHandler } from "../proxy/types";

export const NOT_HANDLED: unique symbol = Symbol("wcs.notHandled");
export type ReadHook = (stateElement: IStateElement, address: IStateAddress, receiver: any, handler: IStateHandler) => unknown;
export type WriteHook = (stateElement: IStateElement, address: IStateAddress, value: unknown, receiver: any, handler: IStateHandler) => unknown;
export type GetHook = (handler: IStateHandler, prop: string, receiver: any) => unknown;
export const readHooks: ReadHook[] = [];
export const writeHooks: WriteHook[] = [];
export const getHooks: GetHook[] = [];
export interface IAddressHook { read?: ReadHook; write?: WriteHook; get?: GetHook; }
export function registerAddressHook(hook: IAddressHook): void {
  if (hook.read && !readHooks.includes(hook.read)) readHooks.push(hook.read);
  if (hook.write && !writeHooks.includes(hook.write)) writeHooks.push(hook.write);
  if (hook.get && !getHooks.includes(hook.get)) getHooks.push(hook.get);
}
`);
console.log('wrote core/addressHooks.ts');

await patch('proxy/methods/getByAddress.ts', 'readHooks', [
  ['import { checkDependency } from "./checkDependency";', 'import { checkDependency } from "./checkDependency";\nimport { NOT_HANDLED, readHooks } from "../../core/addressHooks";'],
  [`  handler  : IStateHandler
): any {
  // 再帰 getter の遅延実体化（Phase B）。`, `  handler  : IStateHandler
): any {
  // next-major prototype (H1): registered read hooks first; one length check when none
  if (${gate('readHooks.length !== 0', 'handler.stateElement')}) {
    for (let i = 0; i < readHooks.length; i++) {
      const handled = readHooks[i](handler.stateElement, address, receiver, handler);
      if (handled !== NOT_HANDLED) return handled;
    }
  }
  // 再帰 getter の遅延実体化（Phase B）。`],
]);

await patch('proxy/methods/setByAddress.ts', 'writeHooks', [
  ['import { writeExportedAccessor } from "../../webComponent/overlay";', 'import { writeExportedAccessor } from "../../webComponent/overlay";\nimport { NOT_HANDLED, writeHooks } from "../../core/addressHooks";'],
  [`  const stateElement = handler.stateElement;
  const path = address.pathInfo.path;
  // D22 後段:`, `  const stateElement = handler.stateElement;
  const path = address.pathInfo.path;
  // next-major prototype (H1): registered write hooks first; one length check when none
  if (${gate('writeHooks.length !== 0')}) {
    for (let i = 0; i < writeHooks.length; i++) {
      const handled = writeHooks[i](stateElement, address, value, receiver, handler);
      if (handled !== NOT_HANDLED) return handled;
    }
  }
  // D22 後段:`],
]);

await patch('proxy/traps/get.ts', 'getHooks', [
  ['import { hasRecursionWildcard } from "../../recursion/expand";', 'import { hasRecursionWildcard } from "../../recursion/expand";\nimport { NOT_HANDLED, getHooks } from "../../core/addressHooks";'],
  [`  if (typeof prop === "string") {
    if (prop[0] === '$') {`, `  if (typeof prop === "string") {
    // next-major prototype (H1): registered get hooks first; one length check when none
    if (${gated ? 'getHooks.length !== 0 && (handler.stateElement as any)?.hasAddressHooks === true' : 'getHooks.length !== 0'}) {
      for (let i = 0; i < getHooks.length; i++) {
        const handled = getHooks[i](handler, prop, receiver);
        if (handled !== NOT_HANDLED) return handled;
      }
    }
    if (prop[0] === '$') {`],
]);

if (inactive > 0) {
  const hooks = Array.from({ length: inactive }, (_, i) => `  registerAddressHook({
    read: (stateElement, _address) => stateElement.hasMounts === true ? NOT_HANDLED : NOT_HANDLED,
    write: (stateElement, _address, _value) => stateElement.hasGraftedVolumes === true ? NOT_HANDLED : NOT_HANDLED,
    get: (handler, _prop) => handler.stateElement?.hasRecursion === true ? NOT_HANDLED : NOT_HANDLED,
  }); // inactive hook ${i + 1}`).join('\n');
  await patch('bootstrapState.ts', 'registerAddressHook', [
    ['import { installVolumeGraft } from "./webComponent/volume";', 'import { installVolumeGraft } from "./webComponent/volume";\nimport { NOT_HANDLED, registerAddressHook } from "./core/addressHooks";'],
    ['  installVolumeGraft();\n  registerComponents(registry);', `  installVolumeGraft();\n  // next-major prototype (H1): ${inactive} installed-but-inactive hook(s) per receptacle\n${hooks}\n  registerComponents(registry);`],
  ]);
}
