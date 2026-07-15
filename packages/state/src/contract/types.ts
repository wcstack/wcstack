/**
 * contract/types.ts
 *
 * Phase 5b(dev-time contract analyzer)が読む sidecar manifest の最小 subset。
 * 完全な JSON-Schema subset 検証は CI 側(vscode-wcs の validator core)の責務であり、
 * runtime analyzer は「実際に読み込まれた wcBindable 宣言との drift」照合に絞る。
 *
 * この型は vscode-wcs の `wcstack.types` を copy-distribution したもの(§14: ランタイム
 * 依存を導入しない)。CI 側の全量型ではなく drift 照合に必要な形だけを持つ。
 */

export interface IContractObservable {
  readonly event?: string;
}

export interface IContractComponent {
  readonly observables?: Readonly<Record<string, IContractObservable>>;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly commands?: Readonly<Record<string, unknown>>;
}

export interface IContractManifest {
  readonly manifestExtensions?: {
    readonly "wcstack.types"?: {
      readonly components?: Readonly<Record<string, IContractComponent>>;
    };
    readonly [namespace: string]: unknown;
  };
}

/** live な static wcBindable 宣言を drift 照合用に索引化したもの。 */
export interface ILiveDeclaration {
  /** property 名 → dispatch event 名。 */
  readonly propertyEvents: ReadonlyMap<string, string>;
  readonly inputs: ReadonlySet<string>;
  readonly commands: ReadonlySet<string>;
}
