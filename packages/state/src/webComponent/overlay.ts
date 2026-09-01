import { createStateAddress } from "../address/StateAddress";
import { getPathInfo } from "../address/PathInfo";
import { IStateAddress } from "../address/types";
import { DELIMITER } from "../define";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { IListIndex } from "../list/types";
import { checkDependency } from "../proxy/methods/checkDependency";
import { setLoopContextSymbol } from "../proxy/symbols";
import { IStateHandler, IStateProxy } from "../proxy/types";
import { IMountRecord, translateInnerPath } from "./mount";

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
    private readonly isBase: boolean,
    private readonly receiver: any,
    private readonly handler: IStateHandler,
  ) {}

  private accessorNameFor(key: string): string | undefined {
    return this.record.accessorBySuffixByMarkerParent.get(this.markerParentPath)?.get(key)?.accessorName;
  }

  private accessorAddress(key: string): IStateAddress {
    return createStateAddress(getPathInfo(this.markerParentPath + DELIMITER + key), this.listIndex);
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
          this.receiver.$postUpdate(translateInnerPath(this.record, path));
        };
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
        return method.bind(_receiver);
      }
    }
    // ツリー（規則 3）: アクティブな親 receiver の文字列読みに落とす。
    // ループ文脈は push 済みの外側アドレス（マーカー親のワイルドカード）から解決される
    return this.receiver[translateInnerPath(this.record, prop)];
  }

  set(target: Record<string, unknown>, prop: string | symbol, value: any, _receiver: any): boolean {
    if (typeof prop !== "string") {
      return Reflect.set(target, prop, value);
    }
    const accessorName = this.accessorNameFor(prop);
    if (typeof accessorName !== "undefined" && this.record.setterKeys.has(accessorName)) {
      // setter は命令的な代入（依存を張らない）— setByAddress の setter 規約に合わせる
      this.handler.pushAddress(this.accessorAddress(prop));
      this.handler.beginUntrack();
      try {
        return Reflect.set(this.record.stateObject, accessorName, value, _receiver);
      } finally {
        this.handler.endUntrack();
        this.handler.popAddress();
      }
    }
    if (this.isBase && Object.prototype.hasOwnProperty.call(target, prop)) {
      target[prop] = value;
      return true;
    }
    this.receiver[translateInnerPath(this.record, prop)] = value;
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
    isBase,
    receiver,
    handler,
  ));
}

/**
 * `element.state` の公開面（chroot・M13）。相対キーを変換して親の proxy を通すだけの
 * 薄い翻訳で、値の解決（私有・getter・ツリー）は全て親ウォーク＋オーバーレイが担う。
 * ホスト要素のループ文脈で包む（行マウント `state: .` の `users.*.…` を解決するため —
 * v1 の outerState → innerState と同じ形）。
 */
export function createPublicMountState(record: IMountRecord): Record<string, any> {
  const parent = record.parentStateElement;
  const withHostContext = <T>(state: IStateProxy, callback: () => T): T => {
    const loopContext = getLoopContextByNode(record.component);
    let result!: T;
    state[setLoopContextSymbol](loopContext, () => {
      result = callback();
    });
    return result;
  };
  return new Proxy({} as Record<string, any>, {
    get(_target, prop): any {
      if (typeof prop !== "string" || prop === "then") {
        return undefined;
      }
      let value: unknown;
      parent.createState("readonly", (state) => {
        value = withHostContext(state as IStateProxy, () =>
          (state as Record<string, unknown>)[prop[0] === "$" ? prop : translateInnerPath(record, prop)]);
      });
      return value;
    },
    set(_target, prop, value): boolean {
      if (typeof prop !== "string") {
        return true;
      }
      parent.createState("writable", (state) => {
        withHostContext(state as IStateProxy, () => {
          (state as Record<string, unknown>)[prop[0] === "$" ? prop : translateInnerPath(record, prop)] = value;
        });
      });
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
}
