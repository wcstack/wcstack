// Survey §11 (round 4) item 3 (a): one BindingSession per list instead of one per row. §10.11
// attributed half of the JS heap per row (1.65 KB of 3.3 KB) to the backing stores of the
// per-row session's 6 WeakMaps and 2 Sets. On top of the row-record prototype
// (rowRecordPrototypePatch.mjs), the session keeps a Set of row records and every row-level
// operation the content performs (unmount, unmountInPlace, tryDestroy) becomes row-scoped
// (disposeBindings / destroyRow); the session is shared by all rows of one `for` binding (keyed
// by the binding's node). Applied to a sandbox copy; every anchor must match exactly once.
//   node scripts/research/sessionPerListPatch.mjs <sandbox>/packages/state
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: sessionPerListPatch.mjs <sandbox>/packages/state');
async function patch(rel, marker, edits) {
  const file = join(pkg, 'src', rel);
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes(marker)) { console.log('already patched', rel); return; }
  for (const [anchor, replacement, all] of edits) {
    const count = code.split(anchor).length - 1;
    if (all ? count < 1 : count !== 1) throw new Error(`${rel}: anchor found ${count} times: ${anchor.slice(0, 70)}`);
    code = all ? code.replaceAll(anchor, () => replacement) : code.replace(anchor, () => replacement);
  }
  await writeFile(file, code);
  console.log('patched', rel);
}

await patch('bindings/BindingSession.ts', 'private readonly rows = new Set<IRowRecord>()', [
  ['interface IRowRecord {\n  readonly id: number;', 'interface IRowRecord {\n  readonly id: number;\n  readonly session: BindingSession;'],
  ['const sessionByRowBinding = new WeakMap<IBindingInfo, BindingSession>();', '// session-per-list prototype: binding → its row record (the record knows its shared session)\nconst rowByBinding = new WeakMap<IBindingInfo, IRowRecord>();'],
  ['  private row: IRowRecord | null = null;', '  private readonly rows = new Set<IRowRecord>();'],
  // initialize(): a live slot of one of this session's rows
  [`      const rowSlot = this.rowSlotOf(binding);
      if (rowSlot >= 0 && this.row!.phases[rowSlot] === SLOT_ACTIVE) {
        const row = this.row!;`, `      const rowRecord = this.rowOf(binding);
      const rowSlot = rowRecord === null ? -1 : rowRecord.bindings.indexOf(binding);
      if (rowRecord !== null && rowRecord.phases[rowSlot] === SLOT_ACTIVE) {
        const row = rowRecord;`],
  // shouldApplyState
  [`    const row = this.row;
    if (row !== null) {
      const slot = row.bindings.indexOf(binding);
      if (slot >= 0) {
        if (!row.registered) return true;`, `    const row = this.rowOf(binding);
    if (row !== null) {
      const slot = row.bindings.indexOf(binding);
      if (slot >= 0) {
        if (!row.registered) return true;`],
  // getRecord
  [`    const slot = this.rowSlotOf(binding);
    if (slot >= 0) {
      const row = this.row!;
      return { id: row.id * 64 + slot,`, `    const row = this.rowOf(binding);
    const slot = row === null ? -1 : row.bindings.indexOf(binding);
    if (row !== null && slot >= 0) {
      return { id: row.id * 64 + slot,`],
  // addTeardown
  [`    const slot = this.rowSlotOf(binding);
    if (slot >= 0) {
      const row = this.row!;
      if (row.phases[slot] !== SLOT_ACTIVE) return false;`, `    const row = this.rowOf(binding);
    const slot = row === null ? -1 : row.bindings.indexOf(binding);
    if (row !== null && slot >= 0) {
      if (row.phases[slot] !== SLOT_ACTIVE) return false;`],
  // disposeBinding
  [`    const slot = this.rowSlotOf(binding);
    if (slot >= 0) {
      this.disposeRowSlot(this.row!, slot);
      return;
    }`, `    const row = this.rowOf(binding);
    if (row !== null) {
      const slot = row.bindings.indexOf(binding);
      if (slot >= 0) {
        this.disposeRowSlot(row, slot);
        return;
      }
    }`],
  // dispose(): all rows, then records; plus the row-scoped content operations
  [`  dispose(): void {
    const row = this.row;
    if (row !== null) for (let i = 0; i < row.bindings.length; i++) this.disposeRowSlot(row, i);
    for (const record of Array.from(this.records)) this.disposeRecord(record);`, `  /** session-per-list prototype: a row session is shared by every row of one \`for\` binding */
  get isRowSession(): boolean {
    return this.rowPlan !== null;
  }

  get currentRowPlan(): IRowPlan | null {
    return this.rowPlan;
  }

  /**
   * row-scoped dispose for a shared session: only the rows these bindings belong to, plus the
   * definition-wait tasks hanging on their nodes; once no live row is left, every remaining
   * deferred task of the session is cancelled as the per-row dispose() used to do
   */
  disposeBindings(bindings: readonly IBindingInfo[]): void {
    for (let i = 0; i < bindings.length; i++) {
      this.disposeBinding(bindings[i]);
      this.cancelDeferredByNode(bindings[i].replaceNode);
    }
    if (this.rows.size === 0) this.cancelAllDeferred();
  }

  private cancelDeferredByNode(node: Node): void {
    const tasks = this.deferredByNode.get(node);
    if (typeof tasks === "undefined") return;
    for (const task of Array.from(tasks)) {
      task.active = false;
      task.cancel?.();
      tasks.delete(task);
      this.deferred.delete(task);
    }
  }

  private cancelAllDeferred(): void {
    for (const task of Array.from(this.deferred)) {
      task.active = false;
      task.cancel?.();
      this.deferred.delete(task);
      this.deferredByNode.get(task.node)?.delete(task);
    }
  }

  /** row-scoped wholesale destroy; a session without row records destroys everything as before */
  destroyRow(bindings: readonly IBindingInfo[]): void {
    const row = bindings.length > 0 ? this.rowOf(bindings[0]) : null;
    if (row === null) {
      this.destroyRecords();
      return;
    }
    this.destroyRowRecord(row);
    this.rows.delete(row);
  }

  private destroyRowRecord(row: IRowRecord): void {
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

  dispose(): void {
    for (const row of Array.from(this.rows)) {
      for (let i = 0; i < row.bindings.length; i++) this.disposeRowSlot(row, i);
    }
    for (const record of Array.from(this.records)) this.disposeRecord(record);`],
  // destroyRecords(): all rows
  [`    const row = this.row;
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
    if (this.records.size === 0) return;`, `    for (const row of this.rows) this.destroyRowRecord(row);
    this.rows.clear();
    if (this.records.size === 0) return;`],
  // forEachActiveBindingNode
  [`    const row = this.row;
    if (row !== null) {
      for (let i = 0; i < row.bindings.length; i++) {
        if (row.phases[i] === SLOT_ACTIVE) callback(row.bindings[i].node);
      }
    }`, `    for (const row of this.rows) {
      for (let i = 0; i < row.bindings.length; i++) {
        if (row.phases[i] === SLOT_ACTIVE) callback(row.bindings[i].node);
      }
    }`],
  // rebindAddresses
  [`    const row = this.row;
    if (row !== null) {
      for (let i = 0; i < row.bindings.length; i++) {
        if (row.phases[i] !== SLOT_ACTIVE) continue;`, `    for (const row of this.rows) {
      for (let i = 0; i < row.bindings.length; i++) {
        if (row.phases[i] !== SLOT_ACTIVE) continue;`],
  // initializeRow
  [`      id: ++nextRecordId,
      generation: ++nextGeneration,
      plan,`, `      id: ++nextRecordId,
      session: this,
      generation: ++nextGeneration,
      plan,`],
  ['    this.row = row;', '    this.rows.add(row);'],
  ['      sessionByRowBinding.set(binding, this);', '      rowByBinding.set(binding, row);'],
  // activatePlanRows
  [`    const row = this.row;
    if (row === null || row.bindings !== bindings) {`, `    const row = bindings.length > 0 ? this.rowOf(bindings[0]) : null;
    if (row === null || row.bindings !== bindings) {`],
  [`        if (!revived) {
          row.generation = ++nextGeneration;
          revived = true;
        }`, `        if (!revived) {
          row.generation = ++nextGeneration;
          revived = true;
          this.rows.add(row);
        }`],
  // rowSlotOf → rowOf
  [`  private rowSlotOf(binding: IBindingInfo): number {
    const row = this.row;
    return row === null ? -1 : row.bindings.indexOf(binding);
  }`, `  private rowOf(binding: IBindingInfo): IRowRecord | null {
    const row = rowByBinding.get(binding);
    return typeof row !== "undefined" && row.session === this ? row : null;
  }`],
  // disposeRowSlot: a fully disposed row leaves the Set (revived on activate)
  [`  private disposeRowSlot(row: IRowRecord, slot: number): void {
    if (row.phases[slot] === SLOT_DISPOSED) return;
    row.phases[slot] = SLOT_DISPOSED;
    this.runRowSlotTeardowns(row, slot);
  }`, `  private disposeRowSlot(row: IRowRecord, slot: number): void {
    if (row.phases[slot] === SLOT_DISPOSED) return;
    row.phases[slot] = SLOT_DISPOSED;
    this.runRowSlotTeardowns(row, slot);
    for (let i = 0; i < row.phases.length; i++) {
      if (row.phases[i] === SLOT_ACTIVE) return;
    }
    this.rows.delete(row);
  }`],
  ['  return recordByBinding.get(binding)?.session ?? sessionByRowBinding.get(binding) ?? null;', '  return recordByBinding.get(binding)?.session ?? rowByBinding.get(binding)?.session ?? null;'],
]);

await patch('structural/createContent.ts', 'session.destroyRow(', [
  ['    session.destroyRecords();', '    session.destroyRow(getBindingsByContent(this));'],
  ['    getBindingSessionByContent(this)?.dispose();', `    {
      // session-per-list prototype: a shared row session disposes only this content's row
      const session = getBindingSessionByContent(this);
      if (session !== null) {
        if (session.isRowSession) session.disposeBindings(getBindingsByContent(this));
        else session.dispose();
      }
    }`, true],
  ['  const session = initializeRowBindings(plan, bindings);', '  const session = initializeRowBindings(plan, bindings, bindingInfo.node);'],
]);

await patch('bindings/initializeBindings.ts', 'rowSessionByForNode', [
  [`export function initializeRowBindings(plan: IRowPlan, bindings: IBindingInfo[]): BindingSession {
  const session = new BindingSession();
  session.initializeRow(plan, bindings);
  return session;
}`, `// session-per-list prototype: one session for every row of a \`for\` binding (keyed by its node)
const rowSessionByForNode = new WeakMap<Node, BindingSession>();
export function initializeRowBindings(plan: IRowPlan, bindings: IBindingInfo[], forNode: Node): BindingSession {
  let session = rowSessionByForNode.get(forNode);
  if (typeof session === "undefined" || session.currentRowPlan !== plan) {
    session = new BindingSession();
    rowSessionByForNode.set(forNode, session);
  }
  session.initializeRow(plan, bindings);
  return session;
}`],
]);
