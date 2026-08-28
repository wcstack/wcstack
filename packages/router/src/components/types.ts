import { BuiltinParamTypes } from "../types";

export interface IRouteMatchResult {
  routes: IRoute[];
  params: Record<string, string>;
  typedParams: Record<string, any>;
  path: string;
  lastPath: string;
}

export type GuardHandler = (toPath: string, fromPath: string) => boolean | Promise<boolean>;

export interface _ILayout {
  readonly uuid: string;
  readonly enableShadowRoot: boolean;
  readonly name: string;
  loadTemplate(): Promise<HTMLTemplateElement>;
}
export type ILayout = _ILayout & Pick<Element,'childNodes'>;

export type SegmentType = 'static' | 'param' | 'catch-all';

export interface ISegmentInfo {
  type: SegmentType;
  segmentText: string;
  paramName: string | null;
  pattern: RegExp;
  isIndex?: boolean;
  paramType?: BuiltinParamTypes;
}

export interface IRouteChildContainer {
  readonly routeChildNodes: IRoute[];
}

export interface IRoute extends IRouteChildContainer {
  readonly routeParentNode: IRoute | null;
  readonly routerNode: IRouter;
  readonly path: string;
  readonly isRelative: boolean;
  readonly absolutePath: string;
  readonly uuid: string;
  readonly placeHolder: Comment;
  readonly childNodeArray: Node[];
  readonly routes: IRoute[];
  readonly params: Record<string, string>;
  readonly typedParams: Record<string, any>;
  readonly paramNames: string[];
  readonly absoluteParamNames: string[];
  readonly weight: number;
  readonly absoluteWeight: number;
  readonly childIndex: number;
  readonly name: string;
  readonly fullpath: string;
  readonly segmentCount: number;
  readonly absoluteSegmentCount: number;
  readonly segmentInfos: ISegmentInfo[];
  readonly absoluteSegmentInfos: ISegmentInfo[];
  /** guard 属性の有無。SSR の guard バリア判定に使う（docs/ssr-router-design.md §2-4） */
  readonly hasGuard: boolean;
  guardHandler: GuardHandler;
  shouldChange(newParams: Record<string, string>): boolean;
  guardCheck(matchResult: IRouteMatchResult): Promise<void>;
  initialize(routerNode: IRouter, parentRouteNode: IRoute | null): void;
  testAncestorNode(ancestorNode: IRoute): boolean;
  setParams(params: Record<string, string>, typedParams: Record<string, any>): void;
  clearParams(): void;
  notifyGuardHandlerLoadFailed(): void;
  /**
   * SSR ハイドレーションの採用: サーバー描画済みノード列を内容として引き取る
   * （docs/ssr-router-design.md §4）
   */
  adoptChildNodes(nodes: Node[]): void;
}

/**
 * Router 観測面のコミット 1 回分（docs/router-state-contract-design.md §3.4）。
 */
export interface IRouterCommit {
  params: Record<string, string>;
  typedParams: Record<string, any>;
  routeName: string;
  /** "?k=v" 形式または ""。パースは commit 側（Router）が行う */
  search: string;
  /** basename スライス後の path */
  path: string;
}

export interface IRouter extends IRouteChildContainer {
  readonly basename: string;
  readonly outlet: IOutlet;
  readonly template: HTMLTemplateElement;
  fallbackRoute: IRoute | null;
  path: string;
  /** 現在マッチのマージ済み param（文字列・frozen）。fallback・初期化前は {} */
  readonly params: Record<string, string>;
  /** 同上の型変換済み値（frozen） */
  readonly typedParams: Record<string, any>;
  /** 現在 URL のクエリ（Record・last-wins・frozen）。クエリ無しは {} */
  readonly searchParams: Record<string, string>;
  /** 最深マッチルートの name 属性値。fallback 時は fallback ルートの name */
  readonly routeName: string;
  navigate(path: string): Promise<void>;
  /** navigateUrl（push）の対になる replace 遷移（§4.2） */
  replace(path: string): Promise<void>;
  /**
   * same-match 判定（§4.4）。比較は basename スライス後の path 同士。
   * 最初の成功 commit より前は常に false（初回ガード）。
   */
  isSameMatch(path: string): boolean;
  /**
   * 観測面のコミットと発火（§3.4）。全内部値を先にコミットし、その後で
   * params → route-name → search → path の順に変化したものだけ発火する。
   */
  commitNavigation(commit: IRouterCommit): void;
  /** `announce=` 用 live region。未生成なら null（docs/a11y-design.md §3-4） */
  readonly a11yRegion: HTMLElement | null;
  /** `<wcs-router focus=...>` の属性値（無ければ null） */
  readonly focusPolicy: string | null;
  /** `<wcs-router announce=...>` の属性値（無ければ null） */
  readonly announcePolicy: string | null;
}

export interface IOutlet {
  routesNode: IRouter;
  readonly rootNode: HTMLElement | ShadowRoot;
  lastRoutes: IRoute[];
}

export interface ILayoutOutlet {
  layout: ILayout;
  readonly name: string;
  assignParams(params: Record<string, any>): void;
}

export interface ILink {
  readonly uuid: string;
  readonly router: IRouter;
  readonly anchorElement: HTMLAnchorElement | null;
}

export interface IHead {
  readonly childElementArray: Element[];
}

export type BindType = "props" | "states" | "attr" | "";