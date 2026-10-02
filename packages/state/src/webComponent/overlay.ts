import { createStateAddress } from "../address/StateAddress";
import { getPathInfo } from "../address/PathInfo";
import { getResolvedAddress } from "../address/ResolvedAddress";
import { IStateAddress } from "../address/types";
import { DELIMITER, WILDCARD } from "../define";
import { isRetiredListIndex } from "../list/listIndexesByList";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { IListIndex, ILoopContext } from "../list/types";
import { checkDependency } from "../proxy/methods/checkDependency";
import { getContextListIndex } from "../proxy/methods/getContextListIndex";
import { setLoopContextSymbol } from "../proxy/symbols";
import { raiseError } from "../raiseError";
import { IStateHandler, Mutability } from "../proxy/types";
import { composeMountIndexes, concretizeMountPrefix, IExportEntry, IMountRecord, translateInnerPath, translateInnerWritePath } from "./mount";
import { createDollarPathApiWrapper } from "./dollarPathApis";

/**
 * webComponent/overlay.ts — マウントのオーバーレイ（D20 / D21・impl-plan §3-0 の 4）。
 *
 * 親 handler の getByAddress は「**マーカーで終わるパス**（`users.*.#m1`）」に達したとき
 * だけここへ委譲する。返すのは (マウント記録 × マーカー親パス × listIndex) の
 * オーバーレイ値 proxy で、それより深いパスの読み書きは**通常の親ウォークの続き**として
 * この proxy への素の Reflect.get / Reflect.set になる:
 *
 * - `users.*.#m1.editing` の読み → 親ウォークが `#m1` でこの proxy を得て
 *   `Reflect.get(proxy, "editing")` → 私有データ（listIndex ごとの複製・D21）
 * - `users.*.#m1.editing` への書き込み → setByAddress の fast path が
 *   `Reflect.set(proxy, "editing", v)` → 私有データへ（enqueue / 依存 walk は
 *   setByAddress が済ませている — 通常のツリーキーと同じ経路）
 * - 作者のメソッド・setter の本体の `this.editing = v` → `this` は**作者向けの proxy**
 *   （authorFacing）で、私有キーの書き込みを上の親ウォークの書き込みへ回す。素の state の
 *   `this.x = v` と同じく setByAddress を通るので、同値ガード・enqueue・依存 walk・
 *   キャッシュ更新が走る（#321）。親ウォークが着地する proxy は直接代入のまま —
 *   そこを回すと setByAddress が自分自身へ再帰する
 * - `users.*.#m1.display` の読み → `Reflect.get(proxy, "display")` → 作者の getter を
 *   **この proxy を `this` に**評価。中の `this.name` は translateInnerPath で
 *   `users.*.name` になり、**アクティブな親 receiver** の文字列読みに落ちる —
 *   pushAddress 済みなので依存エッジ（users.*.name → users.*.#m1.display）は
 *   素の wildcard getter と同じ機構（checkDependency）で親のグラフに載る
 * - `onclick: save` → 変換済みパス `users.*.#m1.save` の読み → メソッドを
 *   この proxy に bind して返す
 *
 * proxy は評価中の (receiver, handler) を閉じ込めるため**キャッシュしない**
 * （isCacheable がマーカー終端を除外する）。私有データそのものは
 * (record, listIndex) ごとに 1 つで、行の swap では listIndex と一緒に動き、
 * 行の差し替えでは新しい listIndex に初期スナップショットから作り直される（D21）。
 */

interface IPrivateDataTable {
  byListIndex: WeakMap<IListIndex, Record<string, unknown>>;
  noIndex: Record<string, unknown> | null;
}

const privateDataByRecord = new WeakMap<IMountRecord, IPrivateDataTable>();

/** 要素が最後に立っていた行の文脈（スコープを行へ向けるたびに記録する — mountScope.ts） */
const lastHostContexts = new WeakMap<IMountRecord, ILoopContext | null>();
/**
 * いまの接続のライフサイクルの `this`（`$connectedCallback` と同じ接続の `$disconnectedCallback` で同じもの）。
 * その接続が終わったときの行。切断で外す — 外れた `this` は、その接続が終わったもの
 */
const lifecycleStates = new WeakMap<IMountRecord, [Record<string, any>, { row: IListIndex | null }]>();

/**
 * 要素が行へ向いたときの、その行の祖先の行（外側の行）。行の親は台帳が付け替える（外側の行を作り直した — #256・
 * 外側の行が内側の配列を手放した — #394）ので、要素が立っていた外側の行が消えたかは、向いたときの祖先で見る
 */
const hostAncestorsByRecord = new WeakMap<IMountRecord, IListIndex[]>();

export function noteHostContext(record: IMountRecord, context: ILoopContext | null): void {
  lastHostContexts.set(record, context);
  const ancestors: IListIndex[] = [];
  for (let row = context?.listIndex.parentListIndex ?? null; row !== null; row = row.parentListIndex) {
    ancestors.push(row);
  }
  hostAncestorsByRecord.set(record, ancestors);
}

export function endHostConnection(record: IMountRecord): void {
  const current = lifecycleStates.get(record);
  if (current !== undefined) {
    // その場の行の差し替え（要素の書き込み — #4）で移った先も含め、終わったときの行に留める
    current[1].row = hostRowOf(record);
    lifecycleStates.delete(record);
  }
}

/**
 * ホスト要素の行の文脈（`for:` の外なら null）。要素がいま文脈を持たない（行の中の `if:` が隠した・
 * プールに居る）ときは最後に立っていた行 — 隠れている間も自分の行を読み書きでき（行が生きていれば）、
 * 行が消えていれば退役した行になる（isRemovedHost）。
 */
function hostContextOf(record: IMountRecord): ILoopContext | null {
  return getLoopContextByNode(record.component) ?? lastHostContexts.get(record) ?? null;
}

/**
 * ホスト要素がいま立っている行。オーバーレイはマーカーアドレスが行を持たないときにここから補う —
 * 部分マウントだけの記録はマーカー基底 `#m<id>` がワイルドカードを持たないので、ワイルドカードの
 * 無い getter・メソッドの評価中はホストの行が見えない（#322）。
 */
function hostRowOf(record: IMountRecord): IListIndex | null {
  return hostContextOf(record)?.listIndex ?? null;
}

/** 評価中のインスタンスのホスト行を離れた要素（行が消えた・別の行に使い回された）への読み書き */
function hostRowRemoved(record: IMountRecord): never {
  raiseError(`The host row of <${record.component.tagName.toLowerCase()}> was removed.`);
}

/** 行かその祖先が退役しているか（リストから外れた行） */
function isRetiredRow(row: IListIndex | null): boolean {
  for (; row !== null; row = row.parentListIndex) {
    if (isRetiredListIndex(row)) {
      return true;
    }
  }
  return false;
}

/**
 * 行が消えて外れた要素か（`$disconnectedCallback`・プールに居る要素）。要素に残った文脈は、いまその位置に
 * ある別の行を指す — 私有キーは消えた行の私有データで読み書きでき、ツリーのキーは投げる。
 * 祖先の差し替えの直後は、生きている行も退役した祖先を指したままなので、接続中の要素は含めない
 */
function isRemovedHost(record: IMountRecord, row: IListIndex | null): boolean {
  return !record.component.isConnected
    && (isRetiredRow(row) || hostAncestorsByRecord.get(record)?.some((ancestor) => isRetiredListIndex(ancestor)) === true);
}

/** マウントインスタンス（record × listIndex）の私有データ。無ければ初期スナップショットから複製 */
export function getPrivateData(record: IMountRecord, listIndex: IListIndex | null): Record<string, unknown> {
  let table = privateDataByRecord.get(record);
  if (typeof table === "undefined") {
    table = { byListIndex: new WeakMap(), noIndex: null };
    privateDataByRecord.set(record, table);
  }
  if (listIndex === null) {
    return table.noIndex ??= { ...record.privateSnapshot };
  }
  let data = table.byListIndex.get(listIndex);
  if (typeof data === "undefined") {
    data = { ...record.privateSnapshot };
    table.byListIndex.set(listIndex, data);
  }
  return data;
}

class OverlayValueHandler implements ProxyHandler<Record<string, unknown>> {
  constructor(
    private readonly record: IMountRecord,
    private readonly markerParentPath: string,
    private readonly listIndex: IListIndex | null,
    /**
     * 評価中のインスタンスのホスト行。マーカーアドレスが行を持てばそれ、持たない（部分マウントだけの
     * 記録の）ときは評価を始めたときの要素の行。作者の `this` に引き継ぐので、async メソッドの await の
     * 後も呼び出したときの行を指す — 読み直すと、その行が消えて要素が使い回された先の別の行を指す（#367）。
     * null は行の外か、まだ行に置かれていない（hostIndexes が読み直す）
     */
    private readonly hostRow: IListIndex | null,
    private readonly isBase: boolean,
    private readonly receiver: any,
    private readonly handler: IStateHandler,
    private readonly authorFacing: boolean = false,
  ) {}

  /**
   * 作者のコード（メソッド・setter の本体）へ `this` として渡す proxy。
   * 同じ私有データ・同じ評価文脈で、私有キーの書き込みだけを親ウォークへ回す（#321）。
   */
  private authorThis(target: Record<string, unknown>, receiver: any): object {
    return this.authorFacing ? receiver : new Proxy(target, new OverlayValueHandler(
      this.record, this.markerParentPath, this.listIndex, this.hostRow, this.isBase, this.receiver, this.handler, true));
  }

  private accessorNameFor(key: string): string | undefined {
    return this.record.accessorBySuffixByMarkerParent.get(this.markerParentPath)?.get(key)?.accessorName;
  }

  private accessorAddress(key: string): IStateAddress {
    return createStateAddress(getPathInfo(this.markerParentPath + DELIMITER + key), this.listIndex);
  }

  /**
   * 評価中のインスタンスのホスト行の添字（`for:` の外なら空）。
   * await の間にホストの行がリストから外れたインスタンスの添字は古い位置のままで、いまその位置にある
   * 別の行を指す — 読み書きを別の行へ着地させずに投げる。完全マウントは行（とその祖先）の退役で、
   * 部分マウントは要素が評価を始めたときの行を離れた（行が消えて要素が外れた・別の行に使い回された）
   * ことで見分ける。部分マウントの行は祖先の差し替えの直後には退役した祖先を指したまま生きているので、
   * 退役だけでは見分けられない — 退役した行を指したまま外れた要素（行が消えた `$disconnectedCallback`）は
   * 投げる（#368）。行を持たずに始まった評価は、いまの行を読む（#367）
   */
  private hostIndexes(): readonly number[] {
    const current = this.listIndex ?? hostRowOf(this.record);
    const row = this.hostRow ?? current;
    if (this.listIndex === null ? row !== current || isRemovedHost(this.record, row) : isRetiredRow(row)) {
      hostRowRemoved(this.record);
    }
    return row?.indexes ?? [];
  }

  /**
   * ツリーへの文字列パスの読み書きで、接頭辞のワイルドカードをホスト行の添字で具体化する。
   * partial（`items.0.v` → `groups.*.items.0.v`）はコアが解決できない（getListIndex）ので
   * いつも（#323）。マーカーアドレスが行を持たない（部分マウントだけの記録の）ときも —
   * ワイルドカードの無い getter の評価中は、文脈（スタック先頭の `#m1.total`）にホストの行が
   * 無く context 型を解決できない（#322）。文脈が空のときも — async メソッドの await の後は
   * ループ文脈が外れている（#331）。行が消えて外れた要素のときも — 文脈は消えた行を指し、位置で
   * 読むといまその位置の別の行になる（hostIndexes が投げる — #368）。行を持ち文脈があるときの
   * context 型は文脈がそのまま解決する。
   */
  private resolveTreePath(innerPath: string, translated: string): string {
    return translated.indexOf(WILDCARD) !== -1
      && (this.listIndex === null || this.handler.addressStackLength === 0
        || getResolvedAddress(translated).wildcardType === "partial" || isRemovedHost(this.record, this.listIndex))
      ? concretizeMountPrefix(innerPath, translated, this.hostIndexes())
      : translated;
  }

  get(target: Record<string, unknown>, prop: string | symbol, _receiver: any): any {
    if (typeof prop !== "string") {
      return Reflect.get(target, prop);
    }
    if (prop === "then") {
      // Promise と誤認されないための恒例のガード（innerState と同じ）
      return undefined;
    }
    if (prop[0] === "$") {
      if (prop === "$postUpdate") {
        return (path: string): void => {
          this.receiver.$postUpdate(this.resolveTreePath(path, translateInnerPath(this.record, path)));
        };
      }
      // §4-6（P2-9）: 相対パス → 接頭辞合成 → ルート API。作者のスコープ相対 indexes の
      // 先頭に、評価中のマーカーアドレスの行添字（＝翻訳で増えたワイルドカード分）を足す
      if (prop === "$getAll" || prop === "$setAll" || prop === "$resolve") {
        const record = this.record;
        const contextIndexes = this.hostIndexes();
        const receiver = this.receiver;
        const handler = this.handler;
        const listIndex = this.listIndex;
        if (prop === "$resolve") {
          return (path: string, indexes: number[] | undefined, ...rest: unknown[]): unknown => {
            // 書き込み形（第 3 引数あり）は読み取り専用マウントを検査する（要件 B14 ①）
            const translated = rest.length > 0 ? translateInnerWritePath(record, path) : translateInnerPath(record, path);
            const composed = composeMountIndexes(record, path, translated, indexes ?? [], contextIndexes);
            return receiver.$resolve(translated, composed, ...rest);
          };
        }
        const api = prop;
        return (path: string, indexes?: number[], ...rest: unknown[]): unknown => {
          const translated = api === "$setAll" ? translateInnerWritePath(record, path) : translateInnerPath(record, path);
          // 省略時の文脈既定: 評価中の文脈が外側の行を持たない（部分マウントだけの記録の getter）なら、
          // 自スコープの添字は 0 本 ＝ `[]`。渡さないと親の既定が全ホスト行へ展開し、他の行の値を
          // 混ぜて返す（#322）。文脈が外側の行を持つ（イベント・内側の行）なら親の既定のまま
          const effective = typeof indexes === "undefined" && api === "$getAll" && listIndex === null
            && getContextListIndex(handler, getPathInfo(translated).wildcardPaths[0]) === null ? [] : indexes;
          const composed = composeMountIndexes(record, path, translated, effective, contextIndexes);
          return receiver[api](translated, composed, ...rest);
        };
      }
      // パスだけを取る読みの API（`$eq` / `$eqPath` / `$eqIndex` / `$dependOn`）は共有の表で包む。
      // indexes を取らないので接頭辞の添字合成は要らない（§4-6 の表）
      const record = this.record;
      const receiver = this.receiver;
      const wrapped = createDollarPathApiWrapper(
        prop,
        (path) => this.resolveTreePath(path, translateInnerPath(record, path)),
        (args) => (receiver[prop] as (...a: unknown[]) => unknown)(...args),
      );
      if (wrapped !== null) {
        return wrapped;
      }
      // `$1` 等は親トラップの Δ 補正がスコープ相対にする。他の `$` API は
      // 親スコープの意味論のまま（接頭辞翻訳は P2-9 — §4-6 の表）
      return this.receiver[prop];
    }
    const accessorName = this.accessorNameFor(prop);
    if (typeof accessorName !== "undefined") {
      // 作者の getter を chroot（この proxy）を `this` に評価。マーカーパスを push して
      // 中の読みが依存エッジ（read → このアクセサ）として親グラフに載るようにする
      this.handler.pushAddress(this.accessorAddress(prop));
      try {
        return Reflect.get(this.record.stateObject, accessorName, _receiver);
      } finally {
        this.handler.popAddress();
      }
    }
    if (this.isBase) {
      if (Object.prototype.hasOwnProperty.call(target, prop)) {
        // 私有データの読みはオーバーレイ内で完結し親 proxy を通らないので、
        // 依存エッジ（この私有キー → 評価中の getter）だけは明示的に登録する。
        // 登録しないと `this.suffix` を読む getter が私有キーの書き込みで再評価されない
        checkDependency(this.handler, this.accessorAddress(prop));
        return target[prop];
      }
      const method = this.record.stateObject[prop];
      if (typeof method === "function") {
        return method.bind(this.authorThis(target, _receiver));
      }
    }
    // ツリー（規則 3）: アクティブな親 receiver の文字列読みに落とす。
    // ループ文脈は push 済みの外側アドレス（マーカー親のワイルドカード）から解決される
    return this.receiver[this.resolveTreePath(prop, translateInnerPath(this.record, prop))];
  }

  set(target: Record<string, unknown>, prop: string | symbol, value: any, _receiver: any): boolean {
    if (typeof prop !== "string") {
      return Reflect.set(target, prop, value);
    }
    const accessorName = this.accessorNameFor(prop);
    if (typeof accessorName !== "undefined") {
      if (!this.record.setterKeys.has(accessorName)) {
        // setter の無い getter（computed）への書き込み。下のツリー行きフォールバックへ
        // 落とすと translateInnerPath が同じマーカーパスを返して set が循環し
        // RangeError（無限再帰）になる — 設定ミスとして loud に落とす
        raiseError(
          `Cannot write to "${accessorName}" on mounted <${this.record.component.tagName.toLowerCase()}>: ` +
          `the accessor has no setter. Add a setter or write to the underlying state paths instead.`,
        );
      }
      // setter は命令的な代入（依存を張らない）— setByAddress の setter 規約に合わせる
      this.handler.pushAddress(this.accessorAddress(prop));
      this.handler.beginUntrack();
      try {
        return Reflect.set(this.record.stateObject, accessorName, value, this.authorThis(target, _receiver));
      } finally {
        this.handler.endUntrack();
        this.handler.popAddress();
      }
    }
    if (this.isBase && Object.prototype.hasOwnProperty.call(target, prop)) {
      if (this.authorFacing && this.handler.mutability !== "readonly") {
        // 部分マウントの私有データは要素ごとに 1 組 — await の間にホストの行が消えて要素が別の行に
        // 使い回されたら、その行の私有データへ書かずに投げる（#367）
        if (this.listIndex === null) {
          this.hostIndexes();
        }
        // 素の state の `this.x = v` と同じ経路（親の set トラップ → setByAddress）へ回す。
        // マーカーのアドレスを push するので、行マウントのワイルドカードは await の後でも
        // このインスタンスの行に解決される
        this.handler.pushAddress(createStateAddress(getPathInfo(this.markerParentPath), this.listIndex));
        try {
          this.receiver[this.markerParentPath + DELIMITER + prop] = value;
        } finally {
          this.handler.popAddress();
        }
        return true;
      }
      target[prop] = value;
      return true;
    }
    this.receiver[this.resolveTreePath(prop, translateInnerWritePath(this.record, prop))] = value;
    return true;
  }

  has(target: Record<string, unknown>, prop: string | symbol): boolean {
    if (typeof prop !== "string") {
      return Reflect.has(target, prop);
    }
    if (prop[0] === "$" || prop[0] === "#") {
      return false;
    }
    if (typeof this.accessorNameFor(prop) !== "undefined") {
      return true;
    }
    if (this.isBase) {
      if (Object.prototype.hasOwnProperty.call(target, prop)) {
        return true;
      }
      if (typeof this.record.stateObject[prop] === "function") {
        return true;
      }
    }
    // 規則 3（ツリー）: v1 innerState の has と同じ「規則が解決するか」の意味論。
    // 親 proxy の has は生オブジェクトの Reflect.has なので、複数セグメントの
    // 翻訳後パスを in で聞いても常に偽 — 値の存在でなく規則の存在で答える
    try {
      translateInnerPath(this.record, prop);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * マーカーで終わるアドレスのオーバーレイ値を作る（getByAddress の dispatch 点）。
 * 評価中の receiver / handler を閉じ込めるため、呼び出しごとに作る（キャッシュ不可）。
 */
export function createOverlayValue(
  record: IMountRecord,
  address: IStateAddress,
  receiver: any,
  handler: IStateHandler,
): object {
  const markerParentPath = address.pathInfo.path;
  const isBase = markerParentPath === record.markerBasePath;
  const privateData = isBase ? getPrivateData(record, address.listIndex) : {};
  return new Proxy(privateData, new OverlayValueHandler(
    record,
    markerParentPath,
    address.listIndex,
    address.listIndex ?? hostRowOf(record),
    isBase,
    receiver,
    handler,
  ));
}

/**
 * 公開 getter の読み（docs/state-overlay-export-design.md §2-1 の 4）。
 * `P.#m<id>` のオーバーレイ値に対する `Reflect.get(proxy, k)` と等価 — 作者の getter は
 * マーカーアドレスを push して評価されるので、依存辺・キャッシュはマーカー側に載る。
 */
export function readExportedAccessor(
  record: IMountRecord,
  entry: IExportEntry,
  listIndex: IListIndex | null,
  receiver: any,
  handler: IStateHandler,
): unknown {
  const address = createStateAddress(getPathInfo(entry.markerTerminalPath), listIndex);
  const proxy = createOverlayValue(record, address, receiver, handler);
  return Reflect.get(proxy, entry.suffix);
}

/** 公開 getter への書き込み（X9）: setter があれば評価、無ければ overlay の set が raise する。 */
export function writeExportedAccessor(
  record: IMountRecord,
  entry: IExportEntry,
  listIndex: IListIndex | null,
  value: unknown,
  receiver: any,
  handler: IStateHandler,
): boolean {
  const address = createStateAddress(getPathInfo(entry.markerTerminalPath), listIndex);
  const proxy = createOverlayValue(record, address, receiver, handler);
  return Reflect.set(proxy, entry.suffix, value);
}

/** 親の state をホスト要素のループ文脈で包んで開き、`fn` の戻り値を返す（公開面の全経路が通る） */
type HostCall = (mutability: Mutability, fn: (state: any) => unknown) => any;

/**
 * `element.state` の公開面（chroot・M13）。相対キーを変換して親の proxy を通すだけの
 * 薄い翻訳で、値の解決（私有・getter・ツリー）は全て親ウォーク＋オーバーレイが担う。
 * ホスト要素のループ文脈で包む（行マウント `state: .` の `users.*.…` を解決するため —
 * v1 の outerState → innerState と同じ形）。
 */
function createChrootDollarApi(
  record: IMountRecord,
  api: "$getAll" | "$setAll" | "$resolve" | "$postUpdate",
  call: HostCall,
  rowIndexes: () => readonly number[],
  resolve: (innerPath: string, translated: string) => string,
): (...args: any[]) => unknown {
  if (api === "$postUpdate") {
    return (path: string) => call("readonly", (state) => state.$postUpdate(resolve(path, translateInnerPath(record, path))));
  }
  return (path: string, indexes?: number[], ...rest: unknown[]) => {
    const writes = api === "$setAll" || (api === "$resolve" && rest.length > 0);
    const translated = writes ? translateInnerWritePath(record, path) : translateInnerPath(record, path);
    // $resolve は indexes 必須の API（省略は空列と同義に倒す）。書き込み形（第 3 引数あり）は writable
    const composed = composeMountIndexes(
      record, path, translated, api === "$resolve" ? (indexes ?? []) : indexes, rowIndexes());
    const mutability = writes ? "writable" : "readonly";
    return call(mutability, (state) => state[api](translated, composed, ...rest));
  };
}

/**
 * ライフサイクルの `this`（#368）。行の部品では接続ごとに 1 つで、`$connectedCallback` とその接続の
 * `$disconnectedCallback` は同じものを受け取る。読み書きは `element.state` と同じくホストの行に着地し、
 * 接続が続くうちはその場の行の差し替え（要素の書き込み — #4）にも追従する。その接続が終わった後
 * （取っておいた `this`・await の後）は、終わったときの行に留まり、要素が別の行に使い回されていれば
 * どちらの行にも着地させずに投げる — #367 のメソッドと同じ。行の中の `if:` が隠しただけなら、その行に着地する。
 * 行の外の部品は行を持たないので `element.state` そのもの
 */
export function createLifecycleMountState(record: IMountRecord): Record<string, any> {
  if (hostRowOf(record) === null) {
    return (record.component as unknown as Record<string, Record<string, any>>)[record.stateProp];
  }
  let current = lifecycleStates.get(record);
  if (current === undefined) {
    const pin = { row: null as IListIndex | null };
    lifecycleStates.set(record, current = [createPublicMountState(record, pin), pin]);
  }
  return current[0];
}

/**
 * @param pin ライフサイクルの `this` の接続が終わったときの行（createLifecycleMountState・endHostConnection）。
 *   省略は `element.state`
 */
export function createPublicMountState(record: IMountRecord, pin?: { row: IListIndex | null }): Record<string, any> {
  const hostContext = (): ILoopContext | null => {
    const context = hostContextOf(record);
    // 固定した this は行の部品のものだけ — 行に置かれた要素は最後に立っていた行を必ず持つ（context は null でない）
    if (pin !== undefined && lifecycleStates.get(record)?.[0] !== chroot && context!.listIndex !== pin.row) {
      hostRowRemoved(record);
    }
    return context;
  };
  // 行が消えて外れた要素（isRemovedHost）: 私有キー・メソッド（マーカーのパス）は消えた行の私有データで
  // 読み書きでき（`$disconnectedCallback` の後始末 — タイマーの id など）、ツリーのキーと `$` API は投げる。
  // 接続中の要素は含めない — 祖先をコピーに差し替えた後の行は、生きたまま退役した祖先を指し続ける
  const rowIndexes = (): readonly number[] => {
    const context = hostContext();
    if (isRemovedHost(record, context?.listIndex ?? null)) {
      hostRowRemoved(record);
    }
    return context?.listIndex.indexes ?? [];
  };
  // 公開面の文字列パス。partial（`items.0.v` → `groups.*.items.0.v`）はコアが解決できないので、接頭辞の
  // ワイルドカードをホスト行の添字で具体化する（→ `groups.1.items.0.v`、#323）。context 型（`items` →
  // `groups.*.items`）は具体化しない — call が張るホストのループ文脈がそのまま解決する。位置に具体化すると、
  // 文脈の行が退役した行や祖先を指しているとき（行が消えた要素・外の部品の行を使い回した直後の内側の行）に、
  // いまその位置にある別の行を読み書きする（#368）。行が消えて外れた要素のツリーのキーは投げる
  const resolve = (innerPath: string, translated: string): string =>
    translated.indexOf(WILDCARD) === -1
      ? translated
      : getResolvedAddress(translated).wildcardType === "partial"
        ? concretizeMountPrefix(innerPath, translated, rowIndexes())
        : translated.indexOf("#") !== -1 || !isRemovedHost(record, hostRowOf(record))
          ? translated
          : hostRowRemoved(record);
  const call: HostCall = (mutability, fn) => {
    let result: unknown;
    const context = hostContext();
    record.parentStateElement.createState(mutability, (state) => {
      result = state[setLoopContextSymbol](context, () => fn(state));
    });
    return result;
  };
  const chroot: Record<string, any> = new Proxy({} as Record<string, any>, {
    get(_target, prop): any {
      if (typeof prop !== "string" || prop === "then") {
        return undefined;
      }
      // §4-6（P2-9）: 相対パス → 接頭辞合成 → ルート API（chroot 面）。
      // 先頭添字はホスト要素のループ文脈から補う
      if (prop === "$getAll" || prop === "$setAll" || prop === "$resolve" || prop === "$postUpdate") {
        return createChrootDollarApi(record, prop, call, rowIndexes, resolve);
      }
      // パスだけを取る読みの API（`$eq` / `$eqPath` / `$eqIndex` / `$dependOn`）は共有の表で包む
      const pathApi = createDollarPathApiWrapper(
        prop,
        (path) => resolve(path, translateInnerPath(record, path)),
        (args) => call("readonly", (state) => state[prop](...args)),
      );
      if (pathApi !== null) {
        return pathApi;
      }
      const at = (state: any): any => state[prop[0] === "$" ? prop : resolve(prop, translateInnerPath(record, prop))];
      // 値は読み取り専用で読む。メソッド（関数）は呼ばれたときに書き込み可能なセッションと
      // ホストのループ文脈の中で取り出し直して呼ぶ — イベントから呼んだのと同じ文脈（#331）。
      // 読み取り専用のまま束ねて返すと、私有キーの書き込みは描き直されず、ツリーのキーの
      // 書き込みは readonly で投げる。戻り値（同期の値・Promise）はそのまま返す
      const value = call("readonly", at);
      // 包むのは作者のメソッドだけ（isPrivateAnchor と同じ判定 — getter を評価しないよう getterKeys が先）。
      // 関数を値として持つキー（コールバック・クラス）は、その値をそのまま返す（同一性・プロパティを保つ）
      return prop[0] !== "$" && !record.getterKeys.has(prop) && typeof record.stateObject[prop] === "function"
        ? function (this: unknown, ...args: unknown[]): unknown {
          return call("writable", (state) => at(state).apply(this, args));
        }
        : value;
    },
    set(_target, prop, value): boolean {
      if (typeof prop === "string") {
        call("writable", (state) => {
          state[prop[0] === "$" ? prop : resolve(prop, translateInnerWritePath(record, prop))] = value;
        });
      }
      return true;
    },
    has(_target, prop): boolean {
      if (typeof prop !== "string" || prop[0] === "$" || prop[0] === "#") {
        return false;
      }
      // 作者の面（私有キー・アクセサ・メソッド）はオブジェクトの own property
      if (Object.prototype.hasOwnProperty.call(record.stateObject, prop)) {
        return true;
      }
      // ツリーは「規則が解決するか」（v1 innerState の has と同じ意味論 — ルート
      // マウントでは常に真、部分マウントのみでは接頭辞が一致するときだけ真）
      try {
        translateInnerPath(record, prop);
        return true;
      } catch {
        return false;
      }
    },
  });
  return chroot;
}
