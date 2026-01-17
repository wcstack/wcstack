import { config } from "../config.js";
import { raiseError } from "../raiseError.js";
export class Outlet extends HTMLElement {
    _routesNode = null;
    _lastRoutes = [];
    _initialized = false;
    constructor() {
        super();
    }
    get routesNode() {
        if (!this._routesNode) {
            raiseError(`${config.tagNames.outlet} has no routesNode.`);
        }
        return this._routesNode;
    }
    set routesNode(value) {
        this._routesNode = value;
    }
    get rootNode() {
        if (this.shadowRoot) {
            return this.shadowRoot;
        }
        return this;
    }
    get lastRoutes() {
        return this._lastRoutes;
    }
    set lastRoutes(value) {
        this._lastRoutes = [...value];
    }
    _initialize() {
        if (config.enableShadowRoot) {
            this.attachShadow({ mode: 'open' });
        }
        this._initialized = true;
    }
    connectedCallback() {
        if (!this._initialized) {
            this._initialize();
        }
    }
}
export function createOutlet() {
    return document.createElement(config.tagNames.outlet);
}
//# sourceMappingURL=Outlet.js.map