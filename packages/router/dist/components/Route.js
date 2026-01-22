import { getUUID } from "../getUUID.js";
import { config } from "../config.js";
import { raiseError } from "../raiseError.js";
import { assignParams } from "../assignParams.js";
import { GuardCancel } from "../GuardCancel.js";
export class Route extends HTMLElement {
    _name = '';
    _path = '';
    _routeParentNode = null;
    _routeChildNodes = [];
    _routerNode = null;
    _uuid = getUUID();
    _placeHolder = document.createComment(`@@route:${this._uuid}`);
    _childNodeArray = [];
    _isMadeArray = false;
    _paramNames = [];
    _patternText = '';
    _params = {};
    _absolutePattern = null;
    _weight = -1;
    _absoluteWeight = 0;
    _childIndex = 0;
    _hasGuard = false;
    _guardHandler = null;
    _waitForSetGuardHandler = null;
    _resolveSetGuardHandler = null;
    _guardFallbackPath = '';
    _initialized = false;
    _isFallbackRoute = false;
    _segmentCount = 0;
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
        if (this.isRelative && !this._routeParentNode) {
            raiseError(`${config.tagNames.route} is relative but has no parent route.`);
        }
        if (!this.isRelative && this._routeParentNode) {
            raiseError(`${config.tagNames.route} is absolute but has a parent route.`);
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
    get rootElement() {
        return this.shadowRoot ?? this;
    }
    get childNodeArray() {
        if (!this._isMadeArray) {
            this._childNodeArray = Array.from(this.rootElement.childNodes);
            this._isMadeArray = true;
        }
        return this._childNodeArray;
    }
    testPath(path) {
        const params = {};
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
    get routes() {
        if (this.routeParentNode) {
            return this.routeParentNode.routes.concat(this);
        }
        else {
            return [this];
        }
    }
    get patternText() {
        return this._patternText;
    }
    get absolutePatternText() {
        return this._checkParentNode((routeParentNode) => {
            const parentPattern = routeParentNode.absolutePatternText;
            return parentPattern.endsWith('\\/')
                ? parentPattern + this._patternText
                : parentPattern + '\\/' + this._patternText;
        }, () => {
            return this._patternText;
        });
    }
    get params() {
        return this._params;
    }
    get absoluteParamNames() {
        return this._checkParentNode((routeParentNode) => {
            return [
                ...routeParentNode.absoluteParamNames,
                ...this._paramNames
            ];
        }, () => {
            return [...this._paramNames];
        });
    }
    get weight() {
        return this._weight;
    }
    get absoluteWeight() {
        if (this._absoluteWeight > 0) {
            return this._absoluteWeight;
        }
        return (this._absoluteWeight = this._checkParentNode((routeParentNode) => {
            return routeParentNode.absoluteWeight + this._weight;
        }, () => {
            return this._weight;
        }));
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
    show(params) {
        this._params = {};
        for (const key of this._paramNames) {
            this._params[key] = params[key];
        }
        const parentNode = this.placeHolder.parentNode;
        const nextSibling = this.placeHolder.nextSibling;
        for (const node of this.childNodeArray) {
            if (nextSibling) {
                parentNode?.insertBefore(node, nextSibling);
            }
            else {
                parentNode?.appendChild(node);
            }
            if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node;
                element.querySelectorAll('[data-bind]').forEach((e) => {
                    assignParams(e, this._params);
                });
                if (element.hasAttribute('data-bind')) {
                    assignParams(element, this._params);
                }
                element.querySelectorAll(config.tagNames.layoutOutlet).forEach((layoutOutlet) => {
                    layoutOutlet.assignParams(this._params);
                });
                if (element.tagName.toLowerCase() === config.tagNames.layoutOutlet) {
                    element.assignParams(this._params);
                }
            }
        }
        return true;
    }
    hide() {
        this._params = {};
        for (const node of this.childNodeArray) {
            node.parentNode?.removeChild(node);
        }
    }
    shouldChange(newParams) {
        for (const key of this._paramNames) {
            if (this._params[key] !== newParams[key]) {
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
        if (routeParentNode) {
            routeParentNode.routeChildNodes.push(this);
            this._childIndex = routeParentNode.routeChildNodes.length - 1;
        }
        else {
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
            }
            else if (segment.startsWith(':')) {
                this._paramNames.push(segment.substring(1));
                patternSegments.push('([^\\/]+)');
                this._weight += 1;
                segmentCount++;
            }
            else {
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
    get fullpath() {
        return this.absolutePath;
    }
    get segmentCount() {
        return this._segmentCount;
    }
    get absoluteSegmentCount() {
        return this._checkParentNode((routeParentNode) => {
            return routeParentNode.absoluteSegmentCount + this._segmentCount;
        }, () => {
            return this._segmentCount;
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
}
//# sourceMappingURL=Route.js.map