import { getUUID } from "../getUUID.js";
import { config } from "../config.js";
import { raiseError } from "../raiseError.js";
import { IRouteMatchResult, IRoute, IRouter, GuardHandler, ISegmentInfo } from "./types.js";
import { RouteCore } from "../core/RouteCore.js";
import { IWcBindable } from "../types.js";

export class Route extends HTMLElement implements IRoute {
  static wcBindable: IWcBindable = RouteCore.wcBindable;

  private _core: RouteCore;
  private _routeParentNode: IRoute | null = null;
  private _routeChildNodes: IRoute[] = [];
  private _routerNode: IRouter | null = null;
  private _uuid: string = getUUID();
  private _placeHolder: Comment = document.createComment(`@@route:${this._uuid}`);
  private _childNodeArray: Node[] | undefined;
  private _childIndex: number = 0;
  private _initialized: boolean = false;

  constructor() {
    super();
    this._core = new RouteCore(this);
  }

  // Shell-only properties

  get routeParentNode(): IRoute | null {
    return this._routeParentNode;
  }

  get routeChildNodes(): IRoute[] {
    return this._routeChildNodes;
  }

  get routerNode(): IRouter {
    if (!this._routerNode) {
      raiseError(`${config.tagNames.route} has no routerNode.`);
    }
    return this._routerNode;
  }

  get uuid(): string {
    return this._uuid;
  }

  get placeHolder(): Comment {
    return this._placeHolder;
  }

  get childNodeArray(): Node[] {
    if (typeof this._childNodeArray === 'undefined') {
      this._childNodeArray = Array.from(this.childNodes);
    }
    return this._childNodeArray;
  }

  get routes(): IRoute[] {
    if (this.routeParentNode) {
      return this.routeParentNode.routes.concat(this);
    } else {
      return [this];
    }
  }

  get childIndex(): number {
    return this._childIndex;
  }

  // Core delegates

  get path(): string {
    return this._core.path;
  }

  get name(): string {
    return this._core.name;
  }

  get isRelative(): boolean {
    return this._core.isRelative;
  }

  get absolutePath(): string {
    return this._core.absolutePath;
  }

  get segmentInfos(): ISegmentInfo[] {
    return this._core.segmentInfos;
  }

  get absoluteSegmentInfos(): ISegmentInfo[] {
    return this._core.absoluteSegmentInfos;
  }

  get params(): Record<string, string> {
    return this._core.params;
  }

  get typedParams(): Record<string, any> {
    return this._core.typedParams;
  }

  get paramNames(): string[] {
    return this._core.paramNames;
  }

  get absoluteParamNames(): string[] {
    return this._core.absoluteParamNames;
  }

  get weight(): number {
    return this._core.weight;
  }

  get absoluteWeight(): number {
    return this._core.absoluteWeight;
  }

  get segmentCount(): number {
    return this._core.segmentCount;
  }

  get absoluteSegmentCount(): number {
    return this._core.absoluteSegmentCount;
  }

  get fullpath(): string {
    return this.absolutePath;
  }

  get guardHandler(): GuardHandler {
    return this._core.guardHandler;
  }

  set guardHandler(value: GuardHandler) {
    this._core.guardHandler = value;
  }

  setParams(params: Record<string, string>, typedParams: Record<string, any>): void {
    this._core.setParams(params, typedParams);
  }

  clearParams(): void {
    this._core.clearParams();
  }

  shouldChange(newParams: Record<string, string>): boolean {
    return this._core.shouldChange(newParams);
  }

  async guardCheck(matchResult: IRouteMatchResult): Promise<void> {
    return this._core.guardCheck(matchResult);
  }

  testAncestorNode(ancestorNode: IRoute): boolean {
    let currentNode: IRoute | null = this._routeParentNode;
    while (currentNode) {
      if (currentNode === ancestorNode) {
        return true;
      }
      currentNode = currentNode.routeParentNode;
    }
    return false;
  }

  initialize(routerNode: IRouter, routeParentNode: IRoute | null): void {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    // 属性からパス情報を読み取り
    let path: string;
    let isIndex = false;
    let isFallback = false;

    if (this.hasAttribute('path')) {
      path = this.getAttribute('path') || '';
    } else if (this.hasAttribute('index')) {
      path = '';
      isIndex = true;
    } else if (this.hasAttribute('fallback')) {
      path = '';
      isFallback = true;
    } else {
      raiseError(`${config.tagNames.route} should have a "path" or "index" attribute.`);
    }

    // ルートツリーの構築
    this._routerNode = routerNode;
    this._routeParentNode = routeParentNode;
    const routeChildContainer = routeParentNode || routerNode;
    routeChildContainer.routeChildNodes.push(this);
    this._childIndex = routeChildContainer.routeChildNodes.length - 1;

    // Fallback検証
    if (isFallback) {
      if (routeParentNode) {
        raiseError(`${config.tagNames.route} with fallback attribute must be a direct child of ${config.tagNames.router}.`);
      }
      if (routerNode.fallbackRoute) {
        raiseError(`${config.tagNames.router} can have only one fallback route.`);
      }
      routerNode.fallbackRoute = this;
    }

    // 親CoreをCoreに設定
    if (routeParentNode) {
      this._core.parentCore = (routeParentNode as Route)._core;
    }

    // Coreでパス解析
    this._core.parsePath(path!, {
      isIndex,
      isFallback,
      hasGuard: this.hasAttribute('guard'),
      guardFallback: this.getAttribute('guard'),
      name: this.getAttribute('name') || '',
    });

    this.setAttribute('fullpath', this.absolutePath);
  }
}
