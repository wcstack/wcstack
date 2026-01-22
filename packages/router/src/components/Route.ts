import { getUUID } from "../getUUID.js";
import { config } from "../config.js";
import { raiseError } from "../raiseError.js";
import { IRouteMatchResult, IRoute, IRouter, GuardHandler } from "./types.js";
import { assignParams } from "../assignParams.js";
import { LayoutOutlet } from "./LayoutOutlet.js";
import { GuardCancel } from "../GuardCancel.js";

export class Route extends HTMLElement implements IRoute {
  private _name: string = '';
  private _path: string = '';
  private _routeParentNode: IRoute | null = null;
  private _routeChildNodes: IRoute[] = [];
  private _routerNode: IRouter | null = null;
  private _uuid: string = getUUID();
  private _placeHolder: Comment = document.createComment(`@@route:${this._uuid}`);
  private _childNodeArray: Node[] = [];
  private _isMadeArray: boolean = false;
  private _paramNames: string[] = [];
  private _patternText: string = '';
  private _params: Record<string, string> = {};
  private _absolutePattern: RegExp | null = null;
  private _weight: number = -1;
  private _absoluteWeight: number = 0;
  private _childIndex: number = 0;
  private _hasGuard: boolean = false;
  private _guardHandler: GuardHandler | null = null;
  private _waitForSetGuardHandler: Promise<void> | null = null;
  private _resolveSetGuardHandler: (() => void) | null = null;
  private _guardFallbackPath: string = '';
  private _initialized: boolean = false;
  private _isFallbackRoute: boolean = false;
  private _segmentCount: number = 0;

  constructor() {
    super();
  }

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

  get path(): string {
    return this._path;
  }

  get isRelative(): boolean {
    return !this._path.startsWith('/');
  }

  private _checkParentNode<T>(
    hasParentCallback: (routeParentNode: IRoute) => T, 
    noParentCallback: () => T
  ): T {
    if (this.isRelative && !this._routeParentNode) {
      raiseError(`${config.tagNames.route} is relative but has no parent route.`);
    }
    if (!this.isRelative && this._routeParentNode) {
      raiseError(`${config.tagNames.route} is absolute but has a parent route.`);
    }
    if (this.isRelative && this._routeParentNode) {
      return hasParentCallback(this._routeParentNode);
    } else {
      return noParentCallback();
    }
  }

  get absolutePath(): string {
    return this._checkParentNode<string>((routeParentNode) => {
        const parentPath = routeParentNode.absolutePath;
        return parentPath.endsWith('/')
          ? parentPath + this._path
          : parentPath + '/' + this._path;

      }, () => {
        return this._path;
      }
    );
  }

  get uuid(): string {
    return this._uuid;
  }

  get placeHolder(): Comment {
    return this._placeHolder;
  }

  get rootElement(): ShadowRoot | HTMLElement {
    return this.shadowRoot ?? this;
  }

  get childNodeArray(): Node[] {
    if (!this._isMadeArray) {
      this._childNodeArray = Array.from(this.rootElement.childNodes);
      this._isMadeArray = true;
    }
    return this._childNodeArray;
  }

  testPath(path: string): IRouteMatchResult | null {
    const params: Record<string, string> = {};
    const testResult = this._absolutePattern?.exec(path) ?? 
      (this._absolutePattern = new RegExp(`^${this.absolutePatternText}$`)).exec(path);
    if (testResult) {
      this.absoluteParamNames.forEach((paramName, index) => {
        params[paramName] = testResult[index + 1];
      });
      return {
        path: path,
        routes: this.routes,
        params: params,
        lastPath: ""
      };
    }
    return null;
  }

  get routes(): IRoute[] {
    if (this.routeParentNode) {
      return this.routeParentNode.routes.concat(this);
    } else {
      return [ this ];
    }
  }

  get patternText(): string {
    return this._patternText;
  }

  get absolutePatternText(): string {
    return this._checkParentNode<string>((routeParentNode) => {
      const parentPattern = routeParentNode.absolutePatternText;
      return parentPattern.endsWith('\\/')
        ? parentPattern + this._patternText
        : parentPattern + '\\/' + this._patternText;
    }, () => {
      return this._patternText;
    });
  }

  get params(): Record<string, string> {
    return this._params;
  }

  get absoluteParamNames(): string[] {
    return this._checkParentNode<string[]>((routeParentNode) => {
      return [
        ...routeParentNode.absoluteParamNames,
        ...this._paramNames
      ];
    }, () => {
      return [ ...this._paramNames ];
    });
  }

  get weight(): number {
    return this._weight;
  }

  get absoluteWeight(): number {
    if (this._absoluteWeight > 0) {
      return this._absoluteWeight
    }
    return (this._absoluteWeight = this._checkParentNode<number>((routeParentNode) => {
      return routeParentNode.absoluteWeight + this._weight;
    }, () => {
      return this._weight;
    }));
  }

  get childIndex(): number {
    return this._childIndex;
  }

  get name(): string {
    return this._name;
  }

  async guardCheck(matchResult: IRouteMatchResult): Promise<void> {
    if (this._hasGuard && this._waitForSetGuardHandler) {
      await this._waitForSetGuardHandler;
    }
    if (this._guardHandler) {
      const toPath = matchResult.path;
      const fromPath = matchResult.lastPath;
      const allowed = await this._guardHandler(toPath, fromPath);
      if (!allowed) {
        throw new GuardCancel('Navigation cancelled by guard.', this._guardFallbackPath);
      }
    }
  }

  show(params: Record<string, string>): boolean {
    this._params = {};
    for(const key of this._paramNames) {
      this._params[key] = params[key];
    }
    const parentNode = this.placeHolder.parentNode;
    const nextSibling = this.placeHolder.nextSibling;
    for (const node of this.childNodeArray) {
      if (nextSibling) {
        parentNode?.insertBefore(node, nextSibling);
      } else {
        parentNode?.appendChild(node);
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        element.querySelectorAll('[data-bind]').forEach((e) => {
          assignParams(e, this._params);
        });
        if (element.hasAttribute('data-bind')) {
          assignParams(element, this._params);
        }
        element.querySelectorAll<LayoutOutlet>(config.tagNames.layoutOutlet).forEach((layoutOutlet) => {
          layoutOutlet.assignParams(this._params);
        });
        if (element.tagName.toLowerCase() === config.tagNames.layoutOutlet) {
          (element as LayoutOutlet).assignParams(this._params);
        }
      }
    }
    return true;
  }

  hide() {
    this._params = {};
    for(const node of this.childNodeArray) {
      node.parentNode?.removeChild(node);
    }
  }

  shouldChange(newParams: Record<string, string>): boolean {
    for(const key of this._paramNames) {
      if (this._params[key] !== newParams[key]) {
        return true;
      }
    }
    return false;
  }

  get guardHandler(): GuardHandler {
    if (!this._guardHandler) {
      raiseError(`${config.tagNames.route} has no guardHandler.`);
    }
    return this._guardHandler!;
  }
  set guardHandler(value: GuardHandler) {
    this._resolveSetGuardHandler?.();
    this._guardHandler = value;
  }

  initialize(routerNode: IRouter, routeParentNode: IRoute | null): void {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    // 単独で影響のないものから設定していく
    if (this.hasAttribute('path')) {
      this._path = this.getAttribute('path') || '';
    } else if (this.hasAttribute('index')) {
      this._path = '';
    } else if (this.hasAttribute('fallback')) {
      this._path = '';
      this._isFallbackRoute = true;
    } else {
      raiseError(`${config.tagNames.route} should have a "path" or "index" attribute.`);
    }
    this._name = this.getAttribute('name') || '';

    this._routerNode = routerNode;
    this._routeParentNode = routeParentNode;
    if (routeParentNode) {
      routeParentNode.routeChildNodes.push(this);
      this._childIndex = routeParentNode.routeChildNodes.length - 1;
    } else {
      // Top-level route
      routerNode.routeChildNodes.push(this);
      this._childIndex = routerNode.routeChildNodes.length - 1;
    }

    if (this._isFallbackRoute) {
      if (routerNode.fallbackRoute) {
        raiseError(`${config.tagNames.router} can have only one fallback route.`);
      }
      routerNode.fallbackRoute = this;
    }

    const segments = this._path.split('/');
    const patternSegments = [];
    let segmentCount = 0;
    for (const segment of segments) {
      if (segment === '*') {
        // Catch-all: matches remaining path segments
        this._paramNames.push('*');
        patternSegments.push('(.*)');
        this._weight += 0; // Lowest priority
        break; // Ignore subsequent segments
      } else if (segment.startsWith(':')) {
        this._paramNames.push(segment.substring(1));
        patternSegments.push('([^\\/]+)');
        this._weight += 1;
        segmentCount++;
      } else {
        patternSegments.push(segment);
        this._weight += 2;
        segmentCount++;
      }
    }
    this._segmentCount = this._path === "" ? 0 : segmentCount; 
    this._patternText = patternSegments.join('\\/');
    this._hasGuard = this.hasAttribute('guard');
    if (this._hasGuard) {
      this._guardFallbackPath = this.getAttribute('guard') || '/';
      this._waitForSetGuardHandler = new Promise((resolve) => {
        this._resolveSetGuardHandler = resolve;
      });
    }

    this.setAttribute('fullpath', this.absolutePath);
  }

  get fullpath(): string {
    return this.absolutePath;
  }

  get segmentCount(): number {
    return this._segmentCount;
  }

  get absoluteSegmentCount(): number {
    return this._checkParentNode<number>((routeParentNode) => {
      return routeParentNode.absoluteSegmentCount + this._segmentCount;
    }, () => {
      return this._segmentCount;
    });
  }

  testAncestorNode(ancestorNode: IRoute): boolean {
    let currentNode: IRoute | null = this._routeParentNode;
    while(currentNode) {
      if (currentNode === ancestorNode) {
        return true;
      }
      currentNode = currentNode.routeParentNode;
    }
    return false;
  }
}
