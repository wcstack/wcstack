// Round 3 of the keyed-subscription prototype, applied on top of keyedPrototypePatch.mjs in a
// sandbox copy of packages/state. On 2026-09-20 the same two patches were applied to the
// repository's packages/state as the N6 implementation (survey §11 item 1), followed by comment
// and coverage edits there; the scripts remain as the record of what was measured.
//   - `$eqPath(path, keyPath)`: the key is read from a path without a dependency edge (the
//     runtime form of survey §10.1 addendum 2's `keyedIdUntracked`);
//   - `$eqIndex(path, level = 1)`: the key is the row's index at a wildcard level, without
//     marking the getter index-dependent; the diff re-keys the subscription when the index moves;
//   - the registration records the current value of `path`, the list diff drops the
//     subscriptions of retired rows and re-keys moved rows (list/createListDiff.ts).
// keyedDependency.prototype.ts (round 3) must already be copied to src/dependency/keyedDependency.ts.
// Every replacement asserts that its anchor exists exactly once; idempotent through markers.
//   node scripts/research/keyedRound3Patch.mjs <sandbox>/packages/state
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: keyedRound3Patch.mjs <sandbox>/packages/state');
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

// 1. get trap: `$eq` records the current value; `$eqPath` and `$eqIndex` added
await patch('proxy/traps/get.ts', 'case "$eqPath"', [
  ['import { registerKeyedDependency } from "../../dependency/keyedDependency";',
   'import { registerIndexKeyedDependency, registerKeyedDependency } from "../../dependency/keyedDependency";'],
  [`            if (lastAddress !== null && handler.stateElement.getterPaths.has(lastAddress.pathInfo.path)) {
              registerKeyedDependency(handler.stateElement, path, key, liftAddressForKeyed(handler.stateElement, lastAddress));
            }
            return Object.is(current, key);
          };
        }`,
   `            if (lastAddress !== null && handler.stateElement.getterPaths.has(lastAddress.pathInfo.path)) {
              registerKeyedDependency(handler.stateElement, path, key, liftAddressForKeyed(handler.stateElement, lastAddress), current);
            }
            return Object.is(current, key);
          };
        }
        case "$eqPath": {
          // next-major prototype: the key is read from keyPath without a dependency edge
          return (path: string, keyPath: string): boolean => {
            const lastAddress = handler.lastAddressStack;
            handler.beginUntrack();
            let current: unknown;
            let key: unknown;
            try {
              current = receiver[path];
              key = receiver[keyPath];
            } finally {
              handler.endUntrack();
            }
            if (lastAddress !== null && handler.stateElement.getterPaths.has(lastAddress.pathInfo.path)) {
              registerKeyedDependency(handler.stateElement, path, key, liftAddressForKeyed(handler.stateElement, lastAddress), current);
            }
            return Object.is(current, key);
          };
        }
        case "$eqIndex": {
          // next-major prototype: the key is the row's index at wildcard level \`level\` (\`$1\` = 1),
          // read without marking the getter index-dependent; the list diff re-keys it on moves
          return (path: string, level: number = 1): boolean => {
            const lastAddress = handler.lastAddressStack;
            if (lastAddress === null || lastAddress.listIndex === null) {
              raiseError(\`$eqIndex("\${path}") needs a list row scope.\`);
            }
            const levelListIndex = listIndexAtWildcard(lastAddress.listIndex, level - 1, lastAddress.pathInfo.wildcardCount);
            if (levelListIndex === null) {
              raiseError(\`$eqIndex("\${path}", \${level}): no list index at that level.\`);
            }
            handler.beginUntrack();
            let current: unknown;
            try {
              current = receiver[path];
            } finally {
              handler.endUntrack();
            }
            if (handler.stateElement.getterPaths.has(lastAddress.pathInfo.path)) {
              registerIndexKeyedDependency(handler.stateElement, path, levelListIndex, liftAddressForKeyed(handler.stateElement, lastAddress), current);
            }
            return Object.is(current, levelListIndex.index);
          };
        }`],
]);

// 2. list diff: drop the subscriptions of retired rows, re-key moved rows
await patch('list/createListDiff.ts', 'rekeyIndexSubscriptions', [
  ['import { IListDiff, IListIndex } from "./types";',
   'import { IListDiff, IListIndex } from "./types";\nimport { dropKeyedSubscriptionsByListIndex, rekeyIndexSubscriptions } from "../dependency/keyedDependency";'],
  [`    if (newIndexes[i].index !== i) {
      newIndexes[i].index = i;
    }`,
   `    if (newIndexes[i].index !== i) {
      const oldIndex = newIndexes[i].index;
      newIndexes[i].index = i;
      // next-major prototype: \`$eqIndex\` subscriptions follow the index on the diff side
      rekeyIndexSubscriptions(newIndexes[i], oldIndex, i);
    }`],
  [`  retireListIndexes(diff.deleteIndexSet);`,
   `  retireListIndexes(diff.deleteIndexSet);
  // next-major prototype: keyed subscriptions of removed rows are dropped with the row
  for (const retired of diff.deleteIndexSet) {
    dropKeyedSubscriptionsByListIndex(retired);
  }`],
]);
