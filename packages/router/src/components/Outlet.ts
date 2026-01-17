import { config } from "../config.js";
import { raiseError } from "../raiseError.js";
import { IOutlet, IRoute, IRouter } from "./types.js";

export class Outlet extends HTMLElement implements IOutlet {
  private _routesNode: IRouter | null = null;
  private _lastRoutes: IRoute[] = [];
  private _initialized: boolean = false;
  constructor() {
    super();
  }

  get routesNode(): IRouter {
    if (!this._routesNode) {
      raiseError(`${config.tagNames.outlet} has no routesNode.`);
    }
    return this._routesNode;
  }
  set routesNode(value: IRouter) {
    this._routesNode = value;
  }

  get rootNode(): HTMLElement | ShadowRoot {
    if (this.shadowRoot) {
      return this.shadowRoot;
    }
    return this;
  }

  get lastRoutes(): IRoute[] {
    return this._lastRoutes;
  }
  set lastRoutes(value: IRoute[]) {
    this._lastRoutes = [ ...value ];
  }

  private _initialize() {
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

export function createOutlet(): Outlet {
  return document.createElement(config.tagNames.outlet) as Outlet;
}
