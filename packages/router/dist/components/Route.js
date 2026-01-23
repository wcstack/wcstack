import { getUUID } from "../getUUID.js";
import { config } from "../config.js";
import { raiseError } from "../raiseError.js";
import { GuardCancel } from "../GuardCancel.js";
import { builtinParamTypes } from "../builtinParamTypes.js";
const weights = {
    'static': 2,
    'param': 1,
    'catch-all': 0
};
export class Route extends HTMLElement {
    _name = '';
    _path = '';
    _routeParentNode = null;
    _routeChildNodes = [];
    _routerNode = null;
    _uuid = getUUID();
    _placeHolder = document.createComment(`@@route:${this._uuid}`);
    _childNodeArray;
    _paramNames;
    _absoluteParamNames;
    _params = {};
    _typedParams = {};
    _weight;
    _absoluteWeight;
    _childIndex = 0;
    _hasGuard = false;
    _guardHandler = null;
    _waitForSetGuardHandler = null;
    _resolveSetGuardHandler = null;
    _guardFallbackPath = '';
    _initialized = false;
    _isFallbackRoute = false;
    _segmentCount;
    _segmentInfos = [];
    _absoluteSegmentInfos;
    constructor() {
        super();
    }
    get routeParentNode() {
        return this._routeParentNode;
    }
    get routeChildNodes() {
        return this._routeChildNodes;
    }
    get routerNode() {
        if (!this._routerNode) {
            raiseError(`${config.tagNames.route} has no routerNode.`);
        }
        return this._routerNode;
    }
    get path() {
        return this._path;
    }
    get isRelative() {
        return !this._path.startsWith('/');
    }
    _checkParentNode(hasParentCallback, noParentCallback) {
        // fallbackはルーター直下のみ許可されるため、相対パスチェックはスキップ
        if (!this._isFallbackRoute) {
            if (this.isRelative && !this._routeParentNode) {
                raiseError(`${config.tagNames.route} is relative but has no parent route.`);
            }
            if (!this.isRelative && this._routeParentNode) {
                raiseError(`${config.tagNames.route} is absolute but has a parent route.`);
            }
        }
        if (this.isRelative && this._routeParentNode) {
            return hasParentCallback(this._routeParentNode);
        }
        else {
            return noParentCallback();
        }
    }
    get absolutePath() {
        return this._checkParentNode((routeParentNode) => {
            const parentPath = routeParentNode.absolutePath;
            return parentPath.endsWith('/')
                ? parentPath + this._path
                : parentPath + '/' + this._path;
        }, () => {
            return this._path;
        });
    }
    get uuid() {
        return this._uuid;
    }
    get placeHolder() {
        return this._placeHolder;
    }
    get childNodeArray() {
        if (typeof this._childNodeArray === 'undefined') {
            this._childNodeArray = Array.from(this.childNodes);
        }
        return this._childNodeArray;
    }
    get routes() {
        if (this.routeParentNode) {
            return this.routeParentNode.routes.concat(this);
        }
        else {
            return [this];
        }
    }
    get segmentInfos() {
        return this._segmentInfos;
    }
    // indexの場合、{ type: 'static', segmentText: '' }となる、indexが複数連続する場合もある
    get absoluteSegmentInfos() {
        if (typeof this._absoluteSegmentInfos === 'undefined') {
            this._absoluteSegmentInfos = this._checkParentNode((routeParentNode) => {
                return [
                    ...routeParentNode.absoluteSegmentInfos,
                    ...this._segmentInfos
                ];
            }, () => {
                return [...this._segmentInfos];
            });
        }
        return this._absoluteSegmentInfos;
    }
    get params() {
        return this._params;
    }
    get typedParams() {
        return this._typedParams;
    }
    get paramNames() {
        if (typeof this._paramNames === 'undefined') {
            const names = [];
            for (const info of this._segmentInfos) {
                if (info.paramName) {
                    names.push(info.paramName);
                }
            }
            this._paramNames = names;
        }
        return this._paramNames;
    }
    get absoluteParamNames() {
        if (typeof this._absoluteParamNames === 'undefined') {
            this._absoluteParamNames = this._checkParentNode((routeParentNode) => {
                return [
                    ...routeParentNode.absoluteParamNames,
                    ...this.paramNames
                ];
            }, () => {
                return [...this.paramNames];
            });
        }
        return this._absoluteParamNames;
    }
    get weight() {
        if (typeof this._weight === 'undefined') {
            let weight = 0;
            for (const info of this._segmentInfos) {
                weight += weights[info.type];
            }
            this._weight = weight;
        }
        return this._weight;
    }
    get absoluteWeight() {
        if (typeof this._absoluteWeight === 'undefined') {
            this._absoluteWeight = this._checkParentNode((routeParentNode) => {
                return routeParentNode.absoluteWeight + this.weight;
            }, () => {
                return this.weight;
            });
        }
        return this._absoluteWeight;
    }
    get childIndex() {
        return this._childIndex;
    }
    get name() {
        return this._name;
    }
    async guardCheck(matchResult) {
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
    shouldChange(newParams) {
        for (const key of this.paramNames) {
            if (this.params[key] !== newParams[key]) {
                return true;
            }
        }
        return false;
    }
    get guardHandler() {
        if (!this._guardHandler) {
            raiseError(`${config.tagNames.route} has no guardHandler.`);
        }
        return this._guardHandler;
    }
    set guardHandler(value) {
        this._resolveSetGuardHandler?.();
        this._guardHandler = value;
    }
    initialize(routerNode, routeParentNode) {
        if (this._initialized) {
            return;
        }
        this._initialized = true;
        // 単独で影響のないものから設定していく
        if (this.hasAttribute('path')) {
            this._path = this.getAttribute('path') || '';
        }
        else if (this.hasAttribute('index')) {
            this._path = '';
        }
        else if (this.hasAttribute('fallback')) {
            this._path = '';
            this._isFallbackRoute = true;
        }
        else {
            raiseError(`${config.tagNames.route} should have a "path" or "index" attribute.`);
        }
        this._name = this.getAttribute('name') || '';
        this._routerNode = routerNode;
        this._routeParentNode = routeParentNode;
        const routeChildContainer = routeParentNode || routerNode;
        routeChildContainer.routeChildNodes.push(this);
        this._childIndex = routeChildContainer.routeChildNodes.length - 1;
        if (this._isFallbackRoute) {
            if (routeParentNode) {
                raiseError(`${config.tagNames.route} with fallback attribute must be a direct child of ${config.tagNames.router}.`);
            }
            if (routerNode.fallbackRoute) {
                raiseError(`${config.tagNames.router} can have only one fallback route.`);
            }
            routerNode.fallbackRoute = this;
        }
        // index属性の場合は特別扱い（セグメントを消費しない）
        if (this.hasAttribute('index')) {
            this._segmentInfos.push({
                type: 'static',
                segmentText: '',
                paramName: null,
                pattern: /^$/,
                isIndex: true
            });
        }
        const segments = this._path.split('/');
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
            }
            else if (segment.startsWith(':')) {
                const matchType = segment.match(/^:([^()]+)(\(([^)]+)\))?$/);
                let paramName;
                let typeName = 'any';
                if (matchType) {
                    paramName = matchType[1];
                    if (matchType[3] && Object.keys(builtinParamTypes).includes(matchType[3])) {
                        typeName = matchType[3];
                    }
                }
                else {
                    paramName = segment.substring(1);
                }
                this._segmentInfos.push({
                    type: 'param',
                    segmentText: segment,
                    paramName: paramName,
                    pattern: new RegExp('^([^\\/]+)$'),
                    paramType: typeName
                });
            }
            else if (segment !== '' || !this.hasAttribute('index')) {
                // 空セグメントはindex以外の場合のみ追加（絶対パスの先頭 '' など）
                this._segmentInfos.push({
                    type: 'static',
                    segmentText: segment,
                    paramName: null,
                    pattern: new RegExp(`^${segment}$`)
                });
            }
        }
        this._hasGuard = this.hasAttribute('guard');
        if (this._hasGuard) {
            this._guardFallbackPath = this.getAttribute('guard') || '/';
            this._waitForSetGuardHandler = new Promise((resolve) => {
                this._resolveSetGuardHandler = resolve;
            });
        }
        this.setAttribute('fullpath', this.absolutePath);
    }
    get fullpath() {
        return this.absolutePath;
    }
    get segmentCount() {
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
    get absoluteSegmentCount() {
        return this._checkParentNode((routeParentNode) => {
            return routeParentNode.absoluteSegmentCount + this.segmentCount;
        }, () => {
            return this.segmentCount;
        });
    }
    testAncestorNode(ancestorNode) {
        let currentNode = this._routeParentNode;
        while (currentNode) {
            if (currentNode === ancestorNode) {
                return true;
            }
            currentNode = currentNode.routeParentNode;
        }
        return false;
    }
    clearParams() {
        this._params = {};
        this._typedParams = {};
    }
}
//# sourceMappingURL=Route.js.map