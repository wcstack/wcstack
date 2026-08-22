/**
 * core/DevtoolsCore.ts
 *
 * hook client（devtools-tag-design.md §1）。DOM 非依存の純ロジック層。
 *
 * - registry への addListener / 解除（connect / disconnect）
 * - source 管理と roster（state 要素一覧）の維持
 * - 配線台帳（binding-added/removed イベントから構築。binding は WeakRef 保持）
 * - タイムライン ring buffer（既定 500 件 FIFO）
 * - 予約 prefix `wcs-devtools` の自己除外（protocol §5）
 *
 * 台帳はすべて devtools 側に置く（protocol 原則 2）。disconnect で
 * sources / roster / wiring をクリアし、残留参照を持たない。
 */

import { getOrCreateHookRegistry } from "../protocol/registry";
import {
  DevtoolsEventLike,
  IAbsoluteAddressLike,
  IBindingLike,
  IDeclaredBindingLike,
  IDevtoolsSourceLike,
  IStateElementSummaryLike,
} from "../protocol/types";
import { formatArgs, formatError, formatValue } from "./formatValue";

/** 予約 state 名 prefix（protocol §5）。この prefix の要素・イベントは常に除外 */
export const RESERVED_STATE_NAME_PREFIX = "wcs-devtools";

const DEFAULT_TIMELINE_CAPACITY = 500;

export type TimelineKind =
  | "write"
  | "batch"
  | "command"
  | "event"
  | "element-registered"
  | "element-unregistered"
  | "watch-error"
  | "watch-chain-limit"
  | "propagation-suppressed"
  | "propagation-coalesced"
  | "propagation-hop-limit"
  | "contract-drift";

export interface ITimelineEntry {
  readonly seq: number;
  readonly time: number;
  readonly sourceId: string;
  readonly kind: TimelineKind;
  readonly stateName: string | null;
  readonly label: string;
  readonly detail: string;
  readonly subscriberCount: number | null;
}

export interface IRosterEntry {
  readonly sourceId: string;
  readonly name: string;
  readonly rootNode: Node;
  readonly summary: IStateElementSummaryLike;
}

export interface IWiringEntry {
  readonly sourceId: string;
  readonly stateName: string;
  readonly path: string;
  readonly propName: string;
  readonly bindingType: string;
  readonly bindingRef: WeakRef<IBindingLike>;
}

export type CoreChangeKind = "sources" | "roster" | "wiring" | "timeline" | "coverage";
export type CoreChangeListener = (kind: CoreChangeKind) => void;

/**
 * 配線カバレッジ 1 行（static-wiring-dx-design.md §4 — 宣言 × 実測の突合）。
 * - watch: `fired`（count 回）/ `never` / `prerequisite-missing`
 *   （ワイルドカード行 watch は「for バインド or $listKeys 宣言」が無いと
 *   リスト書き込みが行へ届かない — 「未発火」と区別しないと誤警告になる）
 * - command / eventToken: `emitted`（count 回）/ `never` /
 *   `emitted-unheard`（全 emit が subscriberCount 0 = 空撃ち。§4 の突合対象）
 * - binding: canonical declared がある場合のみ。`attached` / `never-attached`
 *   （attached は「観測開始以降に一度でも attach された」— live 台帳は WeakRef
 *   pruning で縮むため、瞬間値で判定すると attached が never-attached へ戻る）
 */
export type CoverageStatus =
  | "fired" | "emitted" | "emitted-unheard" | "attached"
  | "never" | "prerequisite-missing" | "never-attached";

export interface ICoverageEntry {
  readonly stateName: string;
  readonly kind: "watch" | "command" | "eventToken" | "binding";
  readonly name: string;
  readonly status: CoverageStatus;
  readonly count: number;
  readonly note: string | null;
}

export interface IDevtoolsCoreOptions {
  /** タイムライン ring buffer 件数（既定 500） */
  timelineCapacity?: number;
  /** 追加で除外する state 名（予約 prefix は常に除外） */
  hiddenStateNames?: readonly string[];
}

/** 台帳キーの区切り文字（state 名・パスに現れ得ない NUL）。
 *  エスケープ表記でなく生成式にしているのは、ツーリングがソース中の
 *  `エスケープ列` リテラルを生バイトへ壊す事故が実際に起きたため。 */
const NUL = String.fromCharCode(0);

function pathKeyOf(stateName: string, path: string): string {
  return stateName + NUL + path;
}

function tokenKeyOf(stateName: string, kind: string, name: string): string {
  return stateName + NUL + kind + NUL + name;
}

/** 宣言（stateName+path+propName）単位の attach キー。NUL 区切りは pathKeyOf と同じ理由 */
function attachKeyOf(stateName: string, path: string, propName: string): string {
  return pathKeyOf(stateName, path) + NUL + propName;
}

/** token emit の実測（カバレッジ台帳の値）。zeroSubscriberCount = 空撃ち回数 */
interface ITokenEmitStat {
  count: number;
  zeroSubscriberCount: number;
}

/** token カバレッジ 1 行の判定（§4: 空撃ちのみ / 一部空撃ち / 正常 / 未発火） */
function tokenCoverageOf(
  stateName: string,
  kind: "command" | "eventToken",
  name: string,
  stat: ITokenEmitStat | undefined,
): ICoverageEntry {
  if (stat === undefined) {
    return { stateName, kind, name, status: "never", count: 0, note: null };
  }
  if (stat.zeroSubscriberCount === stat.count) {
    return {
      stateName, kind, name, status: "emitted-unheard", count: stat.count,
      note: `all ${stat.count} emit(s) had 0 subscribers`,
    };
  }
  return {
    stateName, kind, name, status: "emitted", count: stat.count,
    note: stat.zeroSubscriberCount > 0
      ? `${stat.zeroSubscriberCount}/${stat.count} emit(s) had 0 subscribers`
      : null,
  };
}

export class DevtoolsCore {
  private _timelineCapacity: number;
  private _hiddenStateNames: Set<string>;
  private _removeListener: (() => void) | null = null;
  private _sources: Map<string, IDevtoolsSourceLike> = new Map();
  private _roster: Map<string, IRosterEntry[]> = new Map();
  private _wiringByPathKey: Map<string, Set<IWiringEntry>> = new Map();
  private _wiringEntryByBinding: WeakMap<IBindingLike, IWiringEntry> = new WeakMap();
  private _timeline: ITimelineEntry[] = [];
  private _seq: number = 0;
  private _paused: boolean = false;
  private _changeListeners: Set<CoreChangeListener> = new Set();
  /** 観測開始時刻（connect 時の performance.now。未接続は null）。 */
  private _observingSince: number | null = null;
  /** watch 発火回数（stateName + NUL + path → count）。カバレッジの実測面。 */
  private _watchFiredCounts: Map<string, number> = new Map();
  /** token emit 実測（stateName + NUL + kind + NUL + name → 回数と空撃ち回数）。 */
  private _tokenEmitCounts: Map<string, ITokenEmitStat> = new Map();
  /** 観測開始以降に一度でも attach を観測した宣言キー（attachKeyOf）。
   *  live 配線台帳は WeakRef pruning / binding-removed で縮むため、binding
   *  カバレッジの attached 判定はこちらで行う（瞬間値で判定すると行の
   *  破棄・GC のたびに attached が never-attached へ逆戻りする）。 */
  private _everAttachedKeys: Set<string> = new Set();

  constructor(options?: IDevtoolsCoreOptions) {
    this._timelineCapacity = options?.timelineCapacity ?? DEFAULT_TIMELINE_CAPACITY;
    this._hiddenStateNames = new Set(options?.hiddenStateNames ?? []);
  }

  get connected(): boolean {
    return this._removeListener !== null;
  }

  get paused(): boolean {
    return this._paused;
  }

  set paused(value: boolean) {
    this._paused = value;
  }

  /** 表示から除外する state 名か（予約 prefix + hiddenStateNames、protocol §5） */
  isHiddenStateName(name: string | null): boolean {
    if (name === null) {
      return false;
    }
    return name.startsWith(RESERVED_STATE_NAME_PREFIX) || this._hiddenStateNames.has(name);
  }

  connect(): void {
    if (this._removeListener !== null) {
      return;
    }
    // カバレッジは「観測開始以降」の実測。台帳の過去は再構成できない（protocol §6）
    // ため、UI はこの時刻を常時表示して非対称を明示する。
    this._observingSince = performance.now();
    const registry = getOrCreateHookRegistry();
    this._removeListener = registry.addListener({
      onSourceRegistered: (source) => {
        this._sources.set(source.id, source);
        this._refreshRosterOf(source);
        this._notify("sources");
      },
      onSourceUnregistered: (sourceId) => {
        this._sources.delete(sourceId);
        this._roster.delete(sourceId);
        this._notify("sources");
        this._notify("roster");
      },
      onEvent: (sourceId, event) => {
        this._ingest(sourceId, event);
      },
    });
  }

  /** 購読解除 + 台帳クリア（タイムラインは保持。protocol §7-2 の残留ゼロ） */
  disconnect(): void {
    if (this._removeListener === null) {
      return;
    }
    this._removeListener();
    this._removeListener = null;
    this._sources.clear();
    this._roster.clear();
    this._wiringByPathKey.clear();
    this._wiringEntryByBinding = new WeakMap();
    this._observingSince = null;
    this._watchFiredCounts.clear();
    this._tokenEmitCounts.clear();
    this._everAttachedKeys.clear();
    this._notify("sources");
    this._notify("roster");
    this._notify("wiring");
    this._notify("coverage");
  }

  /** 観測開始時刻（performance.now 基準。未接続は null）。 */
  get observingSince(): number | null {
    return this._observingSince;
  }

  onChange(listener: CoreChangeListener): () => void {
    this._changeListeners.add(listener);
    return () => {
      this._changeListeners.delete(listener);
    };
  }

  getSources(): IDevtoolsSourceLike[] {
    return [...this._sources.values()];
  }

  getRoster(): IRosterEntry[] {
    const entries: IRosterEntry[] = [];
    for (const list of this._roster.values()) {
      entries.push(...list);
    }
    return entries;
  }

  /** 全 source の state 要素一覧を pull で取り直す */
  refreshRoster(): void {
    for (const source of this._sources.values()) {
      this._refreshRosterOf(source);
    }
    this._notify("roster");
  }

  getTimeline(): readonly ITimelineEntry[] {
    return this._timeline;
  }

  clearTimeline(): void {
    this._timeline = [];
    this._notify("timeline");
  }

  /** 指定パスに束縛された配線（生存している binding のみ） */
  getWiringForPath(stateName: string, path: string): IWiringEntry[] {
    const set = this._wiringByPathKey.get(pathKeyOf(stateName, path));
    if (set === undefined) {
      return [];
    }
    return this._collectAlive(set);
  }

  /** 全配線のスナップショット（生存している binding のみ） */
  getAllWiring(): IWiringEntry[] {
    const result: IWiringEntry[] = [];
    for (const set of this._wiringByPathKey.values()) {
      result.push(...this._collectAlive(set));
    }
    return result;
  }

  /** 指定ノード（またはその子孫のバインドノード）に載る配線 */
  getWiringForNode(node: Node): IWiringEntry[] {
    const result: IWiringEntry[] = [];
    for (const set of this._wiringByPathKey.values()) {
      for (const entry of this._collectAlive(set)) {
        const binding = entry.bindingRef.deref()!;
        if (
          binding.node === node ||
          binding.replaceNode === node ||
          node.contains(binding.node) ||
          node.contains(binding.replaceNode)
        ) {
          result.push(entry);
        }
      }
    }
    return result;
  }

  /**
   * ランタイム正本パーサによる宣言バインディング集合（protocol v1 追補）。
   * getDeclaredBindings を実装した source が 1 つも無ければ null（消費側は
   * declaredScan の簡易パーサへフォールバックする）。root は roster の rootNode
   * を source ごとに重複排除して渡す。
   */
  getCanonicalDeclared(): IDeclaredBindingLike[] | null {
    let supported = false;
    const out: IDeclaredBindingLike[] = [];
    // source をまたぐ重複（同じ root を複数 source が走査した場合）を宣言タプルで排除
    const seen = new Set<string>();
    for (const [sourceId, source] of this._sources) {
      if (typeof source.getDeclaredBindings !== "function") {
        continue;
      }
      supported = true;
      const roots = new Set<Node>();
      for (const entry of this._roster.get(sourceId) ?? []) {
        roots.add(entry.rootNode);
      }
      for (const root of roots) {
        for (const declared of source.getDeclaredBindings(root)) {
          if (this.isHiddenStateName(declared.stateName)) {
            continue;
          }
          const key = [declared.stateName, declared.statePathName, declared.propName,
            declared.bindingType, declared.origin, declared.raw].join(NUL);
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          out.push(declared);
        }
      }
    }
    return supported ? out : null;
  }

  /**
   * 配線カバレッジ（§4）: 宣言面（watchPaths / token 宣言 / canonical declared）と
   * 実測面（watch-fired・token-emit の台帳・live 配線台帳）の突合。
   * 「観測開始以降」の実測であることは observingSince を UI が常時表示して明示する。
   */
  getCoverageReport(): ICoverageEntry[] {
    const out: ICoverageEntry[] = [];

    for (const entry of this.getRoster()) {
      const summary = entry.summary;
      // --- watch: 宣言（watchPaths）× 実測（watch-fired 台帳） ---
      for (const path of summary.watchPaths ?? []) {
        const count = this._watchFiredCounts.get(pathKeyOf(entry.name, path)) ?? 0;
        if (count > 0) {
          out.push({ stateName: entry.name, kind: "watch", name: path, status: "fired", count, note: null });
          continue;
        }
        // ワイルドカード行 watch に**リスト書き込み**が届く前提 = 各 `.*` 階層の
        // リストが「for バインド（paths.list）or `$listKeys` 宣言（keyedListPaths）」
        // されていること（watch 設計 §6-3）。未成立は「未発火」と区別する。
        // 前提はリスト置換経路に限る主張 — 明示 index 書き込み（`$resolve` /
        // `items.0.price` 代入。$getAll で listIndex 台帳が生えた後）は前提に
        // 依らず発火し得るため、「一度も発火しない」とは断定できない（実測済み）。
        // keyedListPaths は protocol v1 追補 — フィールドを持たない旧ランタイム
        // では $listKeys 側が観測できないため、note はさらに観測形に落とす 2 段。
        const keyedKnown = summary.keyedListPaths !== undefined;
        let missingList: string | null = null;
        for (let star = path.indexOf(".*"); star !== -1; star = path.indexOf(".*", star + 2)) {
          const listPath = path.slice(0, star);
          const satisfied = summary.paths.list.has(listPath)
            || (summary.keyedListPaths?.has(listPath) ?? false);
          if (!satisfied) {
            missingList = listPath;
            break;
          }
        }
        if (missingList !== null) {
          out.push({
            stateName: entry.name, kind: "watch", name: path, status: "prerequisite-missing", count: 0,
            note: keyedKnown
              ? `list "${missingList}" has no for binding and no $listKeys declaration — list writes never reach its rows (only explicit-index writes can fire this watch)`
              : `no for binding observed for list "${missingList}" (a $listKeys declaration would still let list writes fire it)`,
          });
          continue;
        }
        out.push({ stateName: entry.name, kind: "watch", name: path, status: "never", count: 0, note: null });
      }
      // --- token: 宣言（commandTokenNames / eventTokenNames）× 実測（emit 台帳）。
      // subscriberCount 0 = 空撃ち（§4）: 全 emit が空撃ちなら emitted-unheard として
      // 警告する（emit 側だけ配線されて受け手が一つも居ない構成ミスの検出）。 ---
      for (const name of summary.commandTokenNames) {
        out.push(tokenCoverageOf(entry.name, "command", name,
          this._tokenEmitCounts.get(tokenKeyOf(entry.name, "command", name))));
      }
      for (const name of summary.eventTokenNames) {
        out.push(tokenCoverageOf(entry.name, "eventToken", name,
          this._tokenEmitCounts.get(tokenKeyOf(entry.name, "event", name))));
      }
    }

    // --- binding: canonical declared（宣言）× live 配線台帳（実測）。canonical が
    // 取れないランタイムではこの節を出さない（declaredScan は集合でないため突合しない）。
    const declared = this.getCanonicalDeclared();
    if (declared !== null) {
      const seen = new Set<string>();
      for (const decl of declared) {
        // 構造ディレクティブは行の実体化そのもの・eventToken は token 節が担当
        if (decl.bindingType === "for" || decl.bindingType === "if"
          || decl.bindingType === "elseif" || decl.bindingType === "else") continue;
        if (decl.propName.startsWith("eventToken.")) continue;
        const key = attachKeyOf(decl.stateName, decl.statePathName, decl.propName);
        if (seen.has(key)) continue;
        seen.add(key);
        // 「一度でも attach を観測したか」で判定（ever 台帳）。live 台帳は行の
        // 破棄や GC（WeakRef pruning）で縮むため、瞬間値だと逆戻りする。
        const attached = this._everAttachedKeys.has(key);
        out.push({
          stateName: decl.stateName, kind: "binding",
          name: `${decl.propName} ← ${decl.statePathName}`,
          status: attached ? "attached" : "never-attached",
          count: attached ? 1 : 0,
          note: decl.origin === "fragment" ? "template interior (attaches when rows materialize)" : null,
        });
      }
    }

    return out;
  }

  /** roster entry の state からトップレベルキーを列挙（keys 未実装ランタイムは空） */
  keysOf(entry: IRosterEntry): string[] {
    const source = this._sources.get(entry.sourceId);
    if (source === undefined || typeof source.keys !== "function") {
      return [];
    }
    return source.keys(entry.name, entry.rootNode);
  }

  readValue(entry: IRosterEntry, path: string, indexes?: number[]): unknown {
    const source = this._sources.get(entry.sourceId);
    if (source === undefined) {
      return undefined;
    }
    return source.read(entry.name, entry.rootNode, path, indexes);
  }

  writeValue(entry: IRosterEntry, path: string, value: unknown, indexes?: number[]): void {
    const source = this._sources.get(entry.sourceId);
    if (source === undefined) {
      return;
    }
    source.write(entry.name, entry.rootNode, path, value, indexes);
  }

  // --- internal ---

  private _notify(kind: CoreChangeKind): void {
    for (const listener of this._changeListeners) {
      listener(kind);
    }
  }

  private _refreshRosterOf(source: IDevtoolsSourceLike): void {
    const entries: IRosterEntry[] = [];
    for (const summary of source.getStateElements()) {
      if (this.isHiddenStateName(summary.name)) {
        continue;
      }
      entries.push({
        sourceId: source.id,
        name: summary.name,
        rootNode: summary.rootNode,
        summary,
      });
    }
    this._roster.set(source.id, entries);
  }

  private _collectAlive(set: Set<IWiringEntry>): IWiringEntry[] {
    const alive: IWiringEntry[] = [];
    for (const entry of set) {
      if (entry.bindingRef.deref() === undefined) {
        // GC 済み binding は遅延剪定（detach 漏れで DOM を残さないための WeakRef 側）
        set.delete(entry);
        continue;
      }
      alive.push(entry);
    }
    return alive;
  }

  private _appendTimeline(entry: Omit<ITimelineEntry, "seq" | "time">): void {
    if (this._paused) {
      return;
    }
    this._timeline.push({
      ...entry,
      seq: this._seq++,
      time: performance.now(),
    });
    const overflow = this._timeline.length - this._timelineCapacity;
    if (overflow > 0) {
      this._timeline.splice(0, overflow);
    }
    this._notify("timeline");
  }

  private _labelOf(address: IAbsoluteAddressLike): string {
    const indexes = address.listIndex?.indexes;
    const path = address.absolutePathInfo.pathInfo.path;
    return indexes !== undefined ? `${path}[${indexes.join(",")}]` : path;
  }

  private _ingest(sourceId: string, event: DevtoolsEventLike): void {
    switch (event.type) {
      case "state:element-registered": {
        if (this.isHiddenStateName(event.name)) {
          return;
        }
        const source = this._sources.get(sourceId);
        if (source !== undefined) {
          this._refreshRosterOf(source);
          this._notify("roster");
        }
        this._appendTimeline({
          sourceId,
          kind: "element-registered",
          stateName: event.name,
          label: event.name,
          detail: "",
          subscriberCount: null,
        });
        return;
      }
      case "state:element-unregistered": {
        if (this.isHiddenStateName(event.name)) {
          return;
        }
        const source = this._sources.get(sourceId);
        if (source !== undefined) {
          this._refreshRosterOf(source);
          this._notify("roster");
        }
        this._appendTimeline({
          sourceId,
          kind: "element-unregistered",
          stateName: event.name,
          label: event.name,
          detail: "",
          subscriberCount: null,
        });
        return;
      }
      case "state:write": {
        const stateName = event.absoluteAddress.absolutePathInfo.stateName;
        if (this.isHiddenStateName(stateName)) {
          return;
        }
        const detail = event.hasOldValue
          ? `${formatValue(event.value)} (was ${formatValue(event.oldValue)})`
          : formatValue(event.value);
        this._appendTimeline({
          sourceId,
          kind: "write",
          stateName,
          label: this._labelOf(event.absoluteAddress),
          detail,
          subscriberCount: null,
        });
        return;
      }
      case "state:update-batch": {
        const labels: string[] = [];
        let total = 0;
        for (const address of event.addresses) {
          if (this.isHiddenStateName(address.absolutePathInfo.stateName)) {
            continue;
          }
          total++;
          if (labels.length < 3) {
            labels.push(this._labelOf(address));
          }
        }
        if (total === 0) {
          return;
        }
        const rest = total > labels.length ? `, …(${total})` : "";
        this._appendTimeline({
          sourceId,
          kind: "batch",
          stateName: null,
          label: `${total} address${total === 1 ? "" : "es"}`,
          detail: `${labels.join(", ")}${rest}`,
          subscriberCount: null,
        });
        return;
      }
      case "state:binding-added": {
        const stateName = event.absoluteAddress.absolutePathInfo.stateName;
        if (this.isHiddenStateName(stateName)) {
          return;
        }
        const path = event.absoluteAddress.absolutePathInfo.pathInfo.path;
        const key = pathKeyOf(stateName, path);
        let set = this._wiringByPathKey.get(key);
        if (set === undefined) {
          set = new Set();
          this._wiringByPathKey.set(key, set);
        }
        const entry: IWiringEntry = {
          sourceId,
          stateName,
          path,
          propName: event.binding.propName,
          bindingType: event.binding.bindingType,
          bindingRef: new WeakRef(event.binding),
        };
        set.add(entry);
        this._wiringEntryByBinding.set(event.binding, entry);
        // カバレッジの実測面（B2）: attach の観測を ever 台帳へ積む（remove では消さない）
        this._everAttachedKeys.add(attachKeyOf(stateName, path, event.binding.propName));
        this._notify("wiring");
        this._notify("coverage");
        return;
      }
      case "state:binding-removed": {
        const entry = this._wiringEntryByBinding.get(event.binding);
        if (entry === undefined) {
          return;
        }
        this._wiringEntryByBinding.delete(event.binding);
        const key = pathKeyOf(entry.stateName, entry.path);
        const set = this._wiringByPathKey.get(key);
        if (set !== undefined) {
          set.delete(entry);
          if (set.size === 0) {
            this._wiringByPathKey.delete(key);
          }
        }
        this._notify("wiring");
        return;
      }
      case "state:binding-cleared": {
        const stateName = event.absoluteAddress.absolutePathInfo.stateName;
        const path = event.absoluteAddress.absolutePathInfo.pathInfo.path;
        const key = pathKeyOf(stateName, path);
        if (this._wiringByPathKey.delete(key)) {
          this._notify("wiring");
        }
        return;
      }
      case "state:token-emit": {
        if (this.isHiddenStateName(event.stateName)) {
          return;
        }
        // カバレッジの実測面: emit 回数と空撃ち回数を台帳に積む（§4）。
        // stateName が null の emit はどの宣言とも突合できないため積まない。
        if (event.stateName !== null) {
          const emitKey = tokenKeyOf(event.stateName, event.kind, event.tokenName);
          const stat = this._tokenEmitCounts.get(emitKey);
          if (stat === undefined) {
            this._tokenEmitCounts.set(emitKey, {
              count: 1,
              zeroSubscriberCount: event.subscriberCount === 0 ? 1 : 0,
            });
          } else {
            stat.count += 1;
            if (event.subscriberCount === 0) {
              stat.zeroSubscriberCount += 1;
            }
          }
          this._notify("coverage");
        }
        this._appendTimeline({
          sourceId,
          kind: event.kind,
          stateName: event.stateName,
          label: event.tokenName,
          detail: formatArgs(event.args),
          subscriberCount: event.subscriberCount,
        });
        return;
      }
      case "state:watch-fired": {
        if (this.isHiddenStateName(event.stateName)) {
          return;
        }
        // timeline 行にはしない（発火は高頻度になりうる活動でありカバレッジが受け皿）。
        const firedKey = pathKeyOf(event.stateName, event.path);
        this._watchFiredCounts.set(firedKey, (this._watchFiredCounts.get(firedKey) ?? 0) + 1);
        this._notify("coverage");
        return;
      }
      case "state:watch-error": {
        if (this.isHiddenStateName(event.stateName)) {
          return;
        }
        // ランタイム側は例外を握って drain を守るため、ここに出ないと失敗が
        // どこにも現れない（console を見ていない限り）。phase を detail の先頭に
        // 置くのは、getter の評価失敗とハンドラの失敗で直し方が違うため。
        this._appendTimeline({
          sourceId,
          kind: "watch-error",
          stateName: event.stateName,
          label: event.path,
          detail: `${event.phase}: ${formatError(event.error)}`,
          subscriberCount: null,
        });
        return;
      }
      case "state:watch-chain-limit": {
        this._appendTimeline({
          sourceId,
          kind: "watch-chain-limit",
          stateName: null,
          // 打ち切りはバッチ単位で state 名を持たない（複数 state のアドレスが
          // 載りうる）ため、hidden 判定はここでは行わない。
          label: `depth > ${event.maxDepth}`,
          detail: event.paths.join(", "),
          subscriberCount: null,
        });
        return;
      }
      case "propagation:suppressed": {
        // two-way エコーの辺単位抑止。state 名を持たない（node+member が主語）
        // ため hidden 判定はここでは行わない。
        this._appendTimeline({
          sourceId,
          kind: "propagation-suppressed",
          stateName: null,
          label: event.member,
          detail: `${event.reason} (tx ${event.transactionId}, edge ${event.edgeId})`,
          subscriberCount: null,
        });
        return;
      }
      case "propagation:coalesced": {
        const stateName = event.absoluteAddress.absolutePathInfo.stateName;
        if (this.isHiddenStateName(stateName)) {
          return;
        }
        this._appendTimeline({
          sourceId,
          kind: "propagation-coalesced",
          stateName,
          label: this._labelOf(event.absoluteAddress),
          detail: `tx ${event.droppedTransactionId} dropped (winner tx ${event.winnerTransactionId})`,
          subscriberCount: null,
        });
        return;
      }
      case "propagation:hop-limit": {
        const stateName = event.absoluteAddress.absolutePathInfo.stateName;
        if (this.isHiddenStateName(stateName)) {
          return;
        }
        this._appendTimeline({
          sourceId,
          kind: "propagation-hop-limit",
          stateName,
          label: this._labelOf(event.absoluteAddress),
          detail: `hop ${event.hop} (tx ${event.transactionId})`,
          subscriberCount: null,
        });
        return;
      }
      case "contract:drift": {
        // sidecar と live wcBindable の乖離。live が正本（wcstack-manifest-schema.md）。
        // sidecarEvent / liveEvent は型上 optional（reason と結合されていない構造的
        // 型付け）のため、欠落 payload でも "undefined" を表示しない防御を入れる。
        const memberPart = event.member !== undefined ? `: ${event.member}` : "";
        const eventPart =
          event.reason === "event-mismatch"
            ? ` (sidecar ${event.sidecarEvent ?? "?"} / live ${event.liveEvent ?? "?"})`
            : "";
        this._appendTimeline({
          sourceId,
          kind: "contract-drift",
          stateName: null,
          label: event.tag,
          detail: `${event.reason}${memberPart}${eventPart}`,
          subscriberCount: null,
        });
        return;
      }
      case "contract:manifest-read":
      case "contract:unsupported-extension": {
        // 情報イベント。contract analyzer の戻り値 API から取得でき、timeline は
        // 活動ログに絞る（static-wiring-dx-design.md §6 の行 4 種）。union に
        // 載せることで「型に無いイベントを黙って捨てる」状態だけを解消する。
        return;
      }
    }
    // 全 union メンバーは上の case で return する。ここに到達するのは union 外の
    // 未知イベント（新しいランタイム）だけで、additive プロトコルの意図どおり素通し。
    // union にメンバーを足して case を書き忘れると、この代入が型エラーで止める
    // （watch 2 種 → PR#161、propagation/contract 6 種 → 本修正、の再々発防止）。
    const _exhaustive: never = event;
    void _exhaustive;
  }
}
