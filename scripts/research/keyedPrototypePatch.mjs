// Applies the `$eq(path, key)` keyed-subscription prototype to a sandbox copy of
// packages/state (never to the repository). Every replacement asserts that its anchor exists
// exactly once, so a drifted source fails loudly instead of building a half-patched runtime.
// The new module dependency/keyedDependency.ts must already be in the sandbox.
//   node scripts/research/keyedPrototypePatch.mjs <sandbox>/packages/state
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: keyedPrototypePatch.mjs <sandbox>/packages/state');
// Line endings are normalised to LF for matching (the checkout may be CRLF) and the file is
// written back as LF; a file that already carries the marker is left alone (idempotent).
async function patch(rel, marker, edits) {
  const file = join(pkg, 'src', rel);
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes(marker)) { console.log('already patched', rel); return; }
  for (const [anchor, replacement] of edits) {
    const count = code.split(anchor).length - 1;
    if (count !== 1) throw new Error(`${rel}: anchor found ${count} times: ${anchor.slice(0, 60)}`);
    code = code.replace(anchor, replacement);
  }
  await writeFile(file, code);
  console.log('patched', rel);
}

// 1. `$eq` on the proxy: read `path` without a dependency edge, subscribe the evaluating
//    getter's row address under `key`, return the equality.
const getImports = `import { untrackDependency } from "../apis/untrackDependency";`;
await patch('proxy/traps/get.ts', 'case "$eq"', [
  [getImports, `${getImports}\nimport { registerKeyedDependency } from "../../dependency/keyedDependency";\nimport { liftAddress as liftAddressForKeyed } from "../../address/liftAddress";`],
  [`        case "$untrackDependency": {`,
   `        case "$eq": {
          return (path: string, key: unknown): boolean => {
            const lastAddress = handler.lastAddressStack;
            handler.beginUntrack();
            let current: unknown;
            try {
              current = receiver[path];
            } finally {
              handler.endUntrack();
            }
            if (lastAddress !== null && handler.stateElement.getterPaths.has(lastAddress.pathInfo.path)) {
              registerKeyedDependency(handler.stateElement, path, key, liftAddressForKeyed(handler.stateElement, lastAddress));
            }
            return Object.is(current, key);
          };
        }
        case "$untrackDependency": {`],
]);

// 2. Write side: after the same-value guard has read the old value (both the fast path and
//    the general path), notify only the rows subscribed under the old and the new key.
const setImports = `import { walkDependency } from "../../dependency/walkDependency";`;
const helper = `
// next-major prototype: keyed subscriptions from \`$eq\` (dependency/keyedDependency.ts)
function notifyKeyed(stateElement: IStateHandler["stateElement"], path: string, hasOldValue: boolean, oldValue: unknown, value: unknown): void {
  if (!hasKeyedDependents(stateElement, path)) {
    return;
  }
  const updater = getUpdater();
  const context = config.enablePropagationContext ? (getCurrentPropagationContext() ?? null) : null;
  for (const absAddress of keyedDependents(stateElement, path, hasOldValue, oldValue, value)) {
    dirtyCacheEntryByAbsoluteStateAddress(absAddress);
    updater.enqueueAbsoluteAddress(absAddress, context);
  }
}
`;
await patch('proxy/methods/setByAddress.ts', 'function notifyKeyed(', [
  [setImports, `${setImports}\nimport { hasKeyedDependents, keyedDependents } from "../../dependency/keyedDependency";`],
  [`function notifyWrite(`, `${helper}\nfunction notifyWrite(`],
  // fast path: right after the guard block
  [`        devOldValue = oldValue;
        devHasOldValue = true;
      }
      const cacheable = isCacheable(stateElement, address);`,
   `        devOldValue = oldValue;
        devHasOldValue = true;
      }
      notifyKeyed(stateElement, path, devHasOldValue, devOldValue, value);
      const cacheable = isCacheable(stateElement, address);`],
  // general path: right after its guard block
  [`    devOldValue = oldValue;
    devHasOldValue = true;
  }
  // --- end same-value guard ---`,
   `    devOldValue = oldValue;
    devHasOldValue = true;
  }
  notifyKeyed(stateElement, path, devHasOldValue, devOldValue, value);
  // --- end same-value guard ---`],
]);
