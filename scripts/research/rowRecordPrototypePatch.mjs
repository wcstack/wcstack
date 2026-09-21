// Applies the "one record per plan row" prototype to a sandbox copy of packages/state (never
// to the repository). Today every plan-row binding gets a 25-field record, three ledger
// writes (recordByBinding, records, optionsByBinding) and a per-binding registration; the
// prototype keeps one row record per session (a plan session is one row) holding slot arrays
// (phase, flags, address / pattern registration, teardowns), so a row costs one record and
// one WeakMap write per binding (the session lookup). The public surface (getRecord,
// shouldApplyState, addTeardown, disposeBinding, dispose, destroyRecords, rebindAddresses,
// forEachActiveBindingNode, getBindingSession) answers for row bindings from the row record.
// Every replacement asserts that its anchor exists exactly once; idempotent through the marker.
//   node scripts/research/rowRecordPrototypePatch.mjs <sandbox>/packages/state
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: rowRecordPrototypePatch.mjs <sandbox>/packages/state');
const file = join(pkg, 'src/bindings/BindingSession.ts');
let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
const MARKER = 'interface IRowRecord {';
if (code.includes(MARKER)) { console.log('already patched bindings/BindingSession.ts'); process.exit(0); }
function replaceOnce(anchor, replacement) {
  const count = anchor instanceof RegExp ? (code.match(new RegExp(anchor.source, 'g')) ?? []).length : code.split(anchor).length - 1;
  if (count !== 1) throw new Error(`anchor found ${count} times: ${String(anchor).slice(0, 70)}`);
  code = code.replace(anchor, replacement);
}

// A. row record types and the row → session lookup
replaceOnce('let nextRecordId = 0;\nlet nextGeneration = 0;\n', `let nextRecordId = 0;
let nextGeneration = 0;

// next-major prototype: one record per plan row (slot arrays) instead of one per binding.
const SLOT_ACTIVE = 0;
const SLOT_DISPOSED = 1;
const SLOT_FAILED = 2;
const FLAG_INITIAL_APPLY_DONE = 1;
const FLAG_EVENT_ATTACHED = 2;
const SLOT_PHASE_NAMES: readonly BindingPhase[] = ["active", "disposed", "failed"];
interface IRowRecord {
  readonly id: number;
  generation: number;
  readonly plan: IRowPlan;
  readonly bindings: readonly IBindingInfo[];
  /** activate が address 登録を昇格したか（従来の record.options.registerAddress に相当、行で共有） */
  registered: boolean;
  /** SLOT_* per slot */
  readonly phases: Uint8Array;
  /** FLAG_* bits per slot */
  readonly flags: Uint8Array;
  readonly addresses: (IAbsoluteStateAddress | null)[];
  readonly patternPathInfos: (ITreePath | null)[];
  readonly patternListIndexes: (IListIndex | null)[];
  teardowns: (Array<() => void> | null)[] | null;
}
const sessionByRowBinding = new WeakMap<IBindingInfo, BindingSession>();
`);

// B. the session's row
replaceOnce('  private rowPlan: IRowPlan | null = null;\n', '  private rowPlan: IRowPlan | null = null;\n  private row: IRowRecord | null = null;\n');

// C. initialize(): a binding that is a live slot of this session's row is already initialized
replaceOnce('      const binding = this.remember(candidate, resolvedOptions);\n      const existing = recordByBinding.get(binding);', `      const binding = this.remember(candidate, resolvedOptions);
      const rowSlot = this.rowSlotOf(binding);
      if (rowSlot >= 0 && this.row!.phases[rowSlot] === SLOT_ACTIVE) {
        const row = this.row!;
        this.observe(binding.replaceNode);
        if (resolvedOptions.registerAddress && row.addresses[rowSlot] === null && row.patternPathInfos[rowSlot] === null) {
          row.registered = true;
          this.registerRowSlot(row, rowSlot);
        }
        continue;
      }
      const existing = recordByBinding.get(binding);`);

// D. shouldApplyState(): answer for row slots from the row record
replaceOnce(`    const record = recordByBinding.get(binding);
    if (typeof record === "undefined" || record.session !== this) return true;
    if (!record.options.registerAddress || record.phase === "waiting-definition") return true;`, `    const row = this.row;
    if (row !== null) {
      const slot = row.bindings.indexOf(binding);
      if (slot >= 0) {
        if (!row.registered) return true;
        if (row.phases[slot] === SLOT_FAILED) return false;
        const planSlot = row.plan.slots[slot];
        if ((row.flags[slot] & FLAG_INITIAL_APPLY_DONE) === 0) {
          row.flags[slot] |= FLAG_INITIAL_APPLY_DONE;
          return planSlot.authority === "state";
        }
        if (planSlot.authority === "state") return true;
        return !planSlot.policy.outputOnly;
      }
    }
    const record = recordByBinding.get(binding);
    if (typeof record === "undefined" || record.session !== this) return true;
    if (!record.options.registerAddress || record.phase === "waiting-definition") return true;`);

// E. getRecord(): a read-only view for row slots (tests and diagnostics)
replaceOnce(`  getRecord(binding: IBindingInfo): IBindingRecord | null {
    const record = recordByBinding.get(binding);
    return record?.session === this ? record : null;
  }`, `  getRecord(binding: IBindingInfo): IBindingRecord | null {
    const slot = this.rowSlotOf(binding);
    if (slot >= 0) {
      const row = this.row!;
      return { id: row.id * 64 + slot, info: binding, generation: row.generation, phase: SLOT_PHASE_NAMES[row.phases[slot]], teardowns: null };
    }
    const record = recordByBinding.get(binding);
    return record?.session === this ? record : null;
  }`);

// F. addTeardown()
replaceOnce(`  addTeardown(binding: IBindingInfo, teardown: () => void): boolean {
    const record = recordByBinding.get(binding);`, `  addTeardown(binding: IBindingInfo, teardown: () => void): boolean {
    const slot = this.rowSlotOf(binding);
    if (slot >= 0) {
      const row = this.row!;
      if (row.phases[slot] !== SLOT_ACTIVE) return false;
      const teardowns = row.teardowns ??= new Array<Array<() => void> | null>(row.bindings.length).fill(null);
      (teardowns[slot] ??= []).push(teardown);
      return true;
    }
    const record = recordByBinding.get(binding);`);

// G. disposeBinding()
replaceOnce(`  disposeBinding(binding: IBindingInfo): void {
    const record = recordByBinding.get(binding);`, `  disposeBinding(binding: IBindingInfo): void {
    const slot = this.rowSlotOf(binding);
    if (slot >= 0) {
      this.disposeRowSlot(this.row!, slot);
      return;
    }
    const record = recordByBinding.get(binding);`);

// H. dispose()
replaceOnce(`  dispose(): void {
    for (const record of Array.from(this.records)) this.disposeRecord(record);`, `  dispose(): void {
    const row = this.row;
    if (row !== null) for (let i = 0; i < row.bindings.length; i++) this.disposeRowSlot(row, i);
    for (const record of Array.from(this.records)) this.disposeRecord(record);`);

// J. destroyRecords()
replaceOnce(`  destroyRecords(): void {
    for (const record of this.records) {`, `  destroyRecords(): void {
    const row = this.row;
    if (row !== null) {
      for (let i = 0; i < row.bindings.length; i++) {
        const address = row.addresses[i];
        if (address !== null) {
          removeBindingByAbsoluteStateAddress(address, row.bindings[i]);
          row.addresses[i] = null;
        }
        row.phases[i] = SLOT_DISPOSED;
      }
      row.teardowns = null;
    }
    for (const record of this.records) {`);

// K. forEachActiveBindingNode()
replaceOnce(`  forEachActiveBindingNode(callback: (node: Node) => void): void {
    for (const record of this.records) {`, `  forEachActiveBindingNode(callback: (node: Node) => void): void {
    const row = this.row;
    if (row !== null) {
      for (let i = 0; i < row.bindings.length; i++) {
        if (row.phases[i] === SLOT_ACTIVE) callback(row.bindings[i].node);
      }
    }
    for (const record of this.records) {`);

// L. rebindAddresses()
replaceOnce(`  rebindAddresses(): IBindingInfo[] {
    const rebound: IBindingInfo[] = [];`, `  rebindAddresses(): IBindingInfo[] {
    const rebound: IBindingInfo[] = [];
    const row = this.row;
    if (row !== null) {
      for (let i = 0; i < row.bindings.length; i++) {
        if (row.phases[i] !== SLOT_ACTIVE) continue;
        if (row.addresses[i] === null && row.patternPathInfos[i] === null) continue;
        const binding = row.bindings[i];
        this.unregisterRowSlot(row, i);
        this.registerRowSlot(row, i);
        if (this.shouldApplyState(binding)) rebound.push(binding);
      }
    }`);

// N. initializeRow(): one row record
replaceOnce(/  initializeRow\(plan: IRowPlan, bindings: readonly IBindingInfo\[\]\): void \{[\s\S]*?\n  \}\n(?=\n  \/\*\*\n   \* プラン行の活性化)/, `  initializeRow(plan: IRowPlan, bindings: readonly IBindingInfo[]): void {
    this.rowPlan = plan;
    const slots = plan.slots;
    const n = bindings.length;
    const row: IRowRecord = {
      id: ++nextRecordId,
      generation: ++nextGeneration,
      plan,
      bindings,
      registered: false,
      phases: new Uint8Array(n),
      flags: new Uint8Array(n),
      addresses: new Array<IAbsoluteStateAddress | null>(n).fill(null),
      patternPathInfos: new Array<ITreePath | null>(n).fill(null),
      patternListIndexes: new Array<IListIndex | null>(n).fill(null),
      teardowns: null,
    };
    this.row = row;
    for (let i = 0; i < n; i++) {
      const binding = bindings[i];
      const anchor = binding.replaceNode;
      addInterestedSession(anchor, this);
      this.addKnownRowBinding(anchor, binding, i);
      sessionByRowBinding.set(binding, this);
      if (slots[i].isEvent) {
        try {
          attachEventHandler(binding);
        } catch (error) {
          row.phases[i] = SLOT_FAILED;
          throw error;
        }
        row.flags[i] |= FLAG_EVENT_ATTACHED;
      }
      // 非 event スロットはプラン適格性により双方向不能・radio/checkbox 不能・
      // token 配線不能が確定しているため attach 系を一切呼ばない
    }
  }
`);

// O. activatePlanRows(): activate the row record's slots
replaceOnce(/  private activatePlanRows\(plan: IRowPlan, bindings: readonly IBindingInfo\[\], knownRoot: Node\): void \{[\s\S]*?\n  \}\n(?=\n  private addKnownRowBinding)/, `  private activatePlanRows(plan: IRowPlan, bindings: readonly IBindingInfo[], knownRoot: Node): void {
    const row = this.row;
    if (row === null || row.bindings !== bindings) {
      // この session の行でない binding 配列（防御）: 従来経路
      for (const binding of bindings) {
        this.initialize([binding], { registerAddress: true, registerPathInfo: false, applyOnReconnect: false });
      }
      return;
    }
    row.registered = true;
    const slots = plan.slots;
    let revived = false;
    for (let i = 0; i < bindings.length; i++) {
      if (row.phases[i] !== SLOT_ACTIVE) {
        // pool 再利用: 世代だけ進めて listener attach とアドレス登録をやり直す
        if (!revived) {
          row.generation = ++nextGeneration;
          revived = true;
        }
        row.phases[i] = SLOT_ACTIVE;
        row.flags[i] = 0;
        if (slots[i].isEvent) {
          try {
            attachEventHandler(bindings[i]);
          } catch (error) {
            row.phases[i] = SLOT_FAILED;
            this.runRowSlotTeardowns(row, i);
            throw error;
          }
          row.flags[i] |= FLAG_EVENT_ATTACHED;
        }
        this.registerRowSlot(row, i, knownRoot);
        continue;
      }
      if (row.addresses[i] === null && row.patternPathInfos[i] === null) {
        // 初回活性化
        this.registerRowSlot(row, i, knownRoot);
      }
    }
  }

  private rowSlotOf(binding: IBindingInfo): number {
    const row = this.row;
    return row === null ? -1 : row.bindings.indexOf(binding);
  }

  private registerRowSlot(row: IRowRecord, slot: number, knownRoot?: Node | null): void {
    if (row.addresses[slot] !== null || row.patternPathInfos[slot] !== null) return;
    const binding = row.bindings[slot];
    const listIndex = getListIndexByBindingInfo(binding);
    if (listIndex !== null) {
      const rootNode = resolveBindingRootNode(binding, knownRoot);
      const stateElement = getStateElement(rootNode);
      if (stateElement === null) {
        raiseError(\`No state tree found on this root for binding.\`);
      }
      const absolutePathInfo = getTreePath(stateElement, binding.statePathInfo);
      addBindingByPattern(absolutePathInfo, listIndex, binding);
      row.patternPathInfos[slot] = absolutePathInfo;
      row.patternListIndexes[slot] = listIndex;
    } else {
      const address = getAbsoluteStateAddressByBinding(binding, knownRoot);
      addBindingByAbsoluteStateAddress(address, binding);
      row.addresses[slot] = address;
    }
    // registerPathInfo は行オプションで常に false
  }

  private unregisterRowSlot(row: IRowRecord, slot: number): void {
    const binding = row.bindings[slot];
    const address = row.addresses[slot];
    if (address !== null) {
      removeBindingByAbsoluteStateAddress(address, binding);
      row.addresses[slot] = null;
    } else if (row.patternPathInfos[slot] !== null) {
      removeBindingByPattern(row.patternPathInfos[slot]!, row.patternListIndexes[slot]!, binding);
      row.patternPathInfos[slot] = null;
      row.patternListIndexes[slot] = null;
    } else {
      return;
    }
    clearStateAddressByBindingInfo(binding);
    clearAbsoluteStateAddressByBinding(binding);
  }

  private disposeRowSlot(row: IRowRecord, slot: number): void {
    if (row.phases[slot] === SLOT_DISPOSED) return;
    row.phases[slot] = SLOT_DISPOSED;
    this.runRowSlotTeardowns(row, slot);
  }

  private runRowSlotTeardowns(row: IRowRecord, slot: number): void {
    try {
      this.unregisterRowSlot(row, slot);
    } catch {
      // Cleanup is best-effort; one faulty resource must not retain the rest.
    }
    const teardowns = row.teardowns?.[slot] ?? null;
    if (teardowns !== null) {
      row.teardowns![slot] = null;
      for (const teardown of teardowns.slice().reverse()) {
        try {
          teardown();
        } catch {
          // Cleanup is best-effort.
        }
      }
    }
    if ((row.flags[slot] & FLAG_EVENT_ATTACHED) !== 0) {
      row.flags[slot] &= ~FLAG_EVENT_ATTACHED;
      try {
        detachEventHandler(row.bindings[slot]);
      } catch {
        // Cleanup is best-effort.
      }
    }
  }
`);

// Q. getBindingSession(): row bindings resolve through the row lookup
replaceOnce('  return recordByBinding.get(binding)?.session ?? null;', '  return recordByBinding.get(binding)?.session ?? sessionByRowBinding.get(binding) ?? null;');

await writeFile(file, code);
console.log('patched bindings/BindingSession.ts');
