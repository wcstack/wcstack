import { getUUID } from "../getUUID.js";
import { config } from "../config.js";
import { raiseError } from "../raiseError.js";
import { assignParams } from "../assignParams.js";
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
    _childNodeArray = [];
    _isMadeArray = false;
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
    testPath(path, segments) {
        const params = {};
        const typedParams = {};
        let testResult = true;
        let catchAllFound = false;
        let i = 0, segIndex = 0;
        while (i < this.absoluteSegmentInfos.length) {
            const segmentInfo = this.absoluteSegmentInfos[i];
            // index属性のルートはセグメントを消費しないのでスキップ
            if (segmentInfo.isIndex) {
                i++;
                continue;
            }
            // 先頭の空セグメント（絶対パスの /）はsegmentsから除外されているのでスキップ
            if (i === 0 && segmentInfo.segmentText === '' && segmentInfo.type === 'static') {
                i++;
                continue;
            }
            const segment = segments[segIndex];
            if (segment === undefined) {
                // セグメントが足りない
                testResult = false;
                break;
            }
            let match = false;
            if (segmentInfo.type === "param") {
                const paramType = segmentInfo.paramType || 'any';
                const builtinParamType = builtinParamTypes[paramType];
                const value = builtinParamType.parse(segment);
                if (typeof value !== 'undefined') {
                    if (segmentInfo.paramName) {
                        params[segmentInfo.paramName] = segment;
                        typedParams[segmentInfo.paramName] = value;
                    }
                    match = true;
                }
            }
            else {
                match = segmentInfo.pattern.exec(segment) !== null;
            }
            if (match) {
                if (segmentInfo.type === 'catch-all') {
                    // Catch-all: match remaining segments
                    const remainingSegments = segments.slice(segIndex).join('/');
                    params['*'] = remainingSegments;
                    typedParams['*'] = remainingSegments;
                    catchAllFound = true;
                    break; // No more segments to process
                }
            }
            else {
                testResult = false;
                break;
            }
            i++;
            segIndex++;
        }
        let finalResult = false;
        if (testResult) {
            if (catchAllFound) {
                // catch-all は残り全部マッチ済み
                finalResult = true;
            }
            else if (i === this.absoluteSegmentInfos.length && segIndex === segments.length) {
                // 全セグメントが消費された
                finalResult = true;
            }
            else if (i === this.absoluteSegmentInfos.length && segIndex === segments.length - 1 && segments.at(-1) === '') {
                // 末尾スラッシュ対応: /users/ -> ['', 'users', '']
                finalResult = true;
            }
        }
        if (finalResult) {
            return {
                path: path,
                routes: this.routes,
                params: params,
                typedParams: typedParams,
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
    show(matchResult) {
        this._params = {};
        for (const key of this.paramNames) {
            this._params[key] = matchResult.params[key];
            this._typedParams[key] = matchResult.typedParams[key];
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
                    assignParams(e, this._typedParams);
                });
                if (element.hasAttribute('data-bind')) {
                    assignParams(element, this._typedParams);
                }
                element.querySelectorAll(config.tagNames.layoutOutlet).forEach((layoutOutlet) => {
                    layoutOutlet.assignParams(this._typedParams);
                });
                if (element.tagName.toLowerCase() === config.tagNames.layoutOutlet) {
                    element.assignParams(this._typedParams);
                }
            }
        }
        return true;
    }
    hide() {
        this._params = {};
        this._typedParams = {};
        for (const node of this.childNodeArray) {
            node.parentNode?.removeChild(node);
        }
    }
    shouldChange(newParams) {
        for (const key of this.paramNames) {
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
}
//# sourceMappingURL=Route.js.map