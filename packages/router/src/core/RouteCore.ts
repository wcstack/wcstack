import { GuardCancel } from "../GuardCancel.js";
import { builtinParamTypes } from "../builtinParamTypes.js";
import { raiseError } from "../raiseError.js";
import { config } from "../config.js";
import { ISegmentInfo, SegmentType, IRouteMatchResult, GuardHandler } from "../components/types.js";
import { BuiltinParamTypes, IWcBindable } from "../types.js";

const weights: Record<SegmentType, number> = {
  'static': 2,
  'param': 1,
  'catch-all': 0
};

export interface RouteParseOptions {
  isIndex?: boolean;
  isFallback?: boolean;
  hasGuard?: boolean;
  guardFallback?: string | null;
  name?: string;
}

export class RouteCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "params", event: "wcs-route:params-changed" },
      { name: "typedParams", event: "wcs-route:params-changed", getter: (e: Event) => (e as CustomEvent).detail.typedParams },
      { name: "active", event: "wcs-route:active-changed" },
    ],
  };

  private _target: EventTarget;
  private _parentCore: RouteCore | null = null;
  private _path: string = '';
  private _name: string = '';
  private _isFallbackRoute: boolean = false;
  private _segmentInfos: ISegmentInfo[] = [];
  private _absoluteSegmentInfos: ISegmentInfo[] | undefined;
  private _paramNames: string[] | undefined;
  private _absoluteParamNames: string[] | undefined;
  private _weight: number | undefined;
  private _absoluteWeight: number | undefined;
  private _segmentCount: number | undefined;
  private _params: Record<string, string> = {};
  private _typedParams: Record<string, any> = {};
  private _active: boolean = false;

  // Guard
  private _hasGuard: boolean = false;
  private _guardHandler: GuardHandler | null = null;
  private _guardFallbackPath: string = '';
  private _waitForSetGuardHandler: Promise<void> | null = null;
  private _resolveSetGuardHandler: (() => void) | null = null;

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get parentCore(): RouteCore | null {
    return this._parentCore;
  }

  set parentCore(value: RouteCore | null) {
    this._parentCore = value;
  }

  get path(): string {
    return this._path;
  }

  get name(): string {
    return this._name;
  }

  get isFallbackRoute(): boolean {
    return this._isFallbackRoute;
  }

  get isRelative(): boolean {
    return !this._path.startsWith('/');
  }

  get segmentInfos(): ISegmentInfo[] {
    return this._segmentInfos;
  }

  private _checkParentCore<T>(
    hasParentCallback: (parentCore: RouteCore) => T,
    noParentCallback: () => T
  ): T {
    if (!this._isFallbackRoute) {
      if (this.isRelative && !this._parentCore) {
        raiseError(`${config.tagNames.route} is relative but has no parent route.`);
      }
      if (!this.isRelative && this._parentCore) {
        raiseError(`${config.tagNames.route} is absolute but has a parent route.`);
      }
    }
    if (this.isRelative && this._parentCore) {
      return hasParentCallback(this._parentCore);
    } else {
      return noParentCallback();
    }
  }

  get absolutePath(): string {
    return this._checkParentCore<string>((parentCore) => {
      const parentPath = parentCore.absolutePath;
      return parentPath.endsWith('/')
        ? parentPath + this._path
        : parentPath + '/' + this._path;
    }, () => {
      return this._path;
    });
  }

  get absoluteSegmentInfos(): ISegmentInfo[] {
    if (typeof this._absoluteSegmentInfos === 'undefined') {
      this._absoluteSegmentInfos = this._checkParentCore<ISegmentInfo[]>((parentCore) => {
        return [
          ...parentCore.absoluteSegmentInfos,
          ...this._segmentInfos
        ];
      }, () => {
        return [...this._segmentInfos];
      });
    }
    return this._absoluteSegmentInfos;
  }

  get params(): Record<string, string> {
    return this._params;
  }

  get typedParams(): Record<string, any> {
    return this._typedParams;
  }

  get active(): boolean {
    return this._active;
  }

  get paramNames(): string[] {
    if (typeof this._paramNames === 'undefined') {
      const names: string[] = [];
      for (const info of this._segmentInfos) {
        if (info.paramName) {
          names.push(info.paramName);
        }
      }
      this._paramNames = names;
    }
    return this._paramNames;
  }

  get absoluteParamNames(): string[] {
    if (typeof this._absoluteParamNames === 'undefined') {
      this._absoluteParamNames = this._checkParentCore<string[]>((parentCore) => {
        return [
          ...parentCore.absoluteParamNames,
          ...this.paramNames
        ];
      }, () => {
        return [...this.paramNames];
      });
    }
    return this._absoluteParamNames;
  }

  get weight(): number {
    if (typeof this._weight === 'undefined') {
      let weight = 0;
      for (const info of this._segmentInfos) {
        weight += weights[info.type];
      }
      this._weight = weight;
    }
    return this._weight;
  }

  get absoluteWeight(): number {
    if (typeof this._absoluteWeight === 'undefined') {
      this._absoluteWeight = this._checkParentCore<number>((parentCore) => {
        return parentCore.absoluteWeight + this.weight;
      }, () => {
        return this.weight;
      });
    }
    return this._absoluteWeight;
  }

  get segmentCount(): number {
    if (typeof this._segmentCount === 'undefined') {
      let count = 0;
      for (const info of this._segmentInfos) {
        if (info.type !== 'catch-all') {
          count++;
        }
      }
      this._segmentCount = this._path === "" ? 0 : count;
    }
    return this._segmentCount;
  }

  get absoluteSegmentCount(): number {
    return this._checkParentCore<number>((parentCore) => {
      return parentCore.absoluteSegmentCount + this.segmentCount;
    }, () => {
      return this.segmentCount;
    });
  }

  parsePath(path: string, options: RouteParseOptions = {}): void {
    this._path = path;
    this._name = options.name || '';
    this._isFallbackRoute = options.isFallback || false;

    if (options.isIndex) {
      this._segmentInfos.push({
        type: 'static',
        segmentText: '',
        paramName: null,
        pattern: /^$/,
        isIndex: true
      });
    }

    const segments = path.split('/');
    for (let idx = 0; idx < segments.length; idx++) {
      const segment = segments[idx];
      // 末尾の空セグメントはスキップ（/parent/ のような場合）
      if (segment === '' && idx === segments.length - 1 && idx > 0) {
        continue;
      }
      if (segment === '*') {
        this._segmentInfos.push({
          type: 'catch-all',
          segmentText: segment,
          paramName: '*',
          pattern: new RegExp('^(.*)$')
        });
        // Catch-all: matches remaining path segments
        break; // Ignore subsequent segments
      } else if (segment.startsWith(':')) {
        const matchType = segment.match(/^:([^()]+)(\(([^)]+)\))?$/);
        let paramName: string;
        let typeName: BuiltinParamTypes = 'any';
        if (matchType) {
          paramName = matchType[1];
          if (matchType[3] && Object.keys(builtinParamTypes).includes(matchType[3])) {
            typeName = matchType[3] as BuiltinParamTypes;
          }
        } else {
          paramName = segment.substring(1);
        }

        this._segmentInfos.push({
          type: 'param',
          segmentText: segment,
          paramName: paramName,
          pattern: new RegExp('^([^\\/]+)$'),
          paramType: typeName
        });
      } else if (segment !== '' || !options.isIndex) {
        // 空セグメントはindex以外の場合のみ追加（絶対パスの先頭 '' など）
        this._segmentInfos.push({
          type: 'static',
          segmentText: segment,
          paramName: null,
          pattern: new RegExp(`^${segment}$`)
        });
      }
    }

    this._hasGuard = options.hasGuard || false;
    if (this._hasGuard) {
      this._guardFallbackPath = options.guardFallback || '/';
      this._waitForSetGuardHandler = new Promise((resolve) => {
        this._resolveSetGuardHandler = resolve;
      });
    }
  }

  setParams(params: Record<string, string>, typedParams: Record<string, any>): void {
    this._params = params;
    this._typedParams = typedParams;
    this._active = true;
    this._target.dispatchEvent(new CustomEvent("wcs-route:params-changed", {
      detail: { params, typedParams },
      bubbles: true,
    }));
  }

  clearParams(): void {
    this._params = {};
    this._typedParams = {};
    this._active = false;
  }

  shouldChange(newParams: Record<string, string>): boolean {
    for (const key of this.paramNames) {
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
}
