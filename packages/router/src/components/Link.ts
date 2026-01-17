import { config } from "../config";
import { getUUID } from "../getUUID";
import { raiseError } from "../raiseError";
import { getNavigation } from "../Navigation";
import { Router } from "./Router";
import { ILink } from "./types";

export class Link extends HTMLElement implements ILink {
  private _childNodeArray: Node[] = [];
  private _uuid: string = getUUID();
  private _commentNode: Comment = document.createComment(`@@link:${this._uuid}`);
  private _path: string = "";
  private _router: Router | null = null;
  private _anchorElement: HTMLAnchorElement | null = null;
  private _initialized: boolean = false;

  constructor() {
    super();
  }

  get uuid(): string {
    return this._uuid;
  }
  get commentNode(): Comment {
    return this._commentNode;
  }
  get router(): Router {
    if (this._router) {
      return this._router;
    }
    const router = document.querySelector<Router>(config.tagNames.router);
    if (router) {
      return (this._router = router);
    }
    raiseError(`${config.tagNames.link} is not connected to a router.`);
  }

  private _initialize() {
    this.replaceWith(this._commentNode); // Link 要素自体は DOM から取り除く
    this._childNodeArray = Array.from(this.childNodes);
    this._path = this.getAttribute('to') || '';
    this._initialized = true;
  }

  connectedCallback() {
    if (!this._initialized) {
      this._initialize();
    }
    const parentNode = this._commentNode.parentNode;
    if (!parentNode) {
      raiseError(`${config.tagNames.link} comment node has no parent`);
    }
    const nextSibling = this._commentNode.nextSibling;
    const link = document.createElement('a');
    if (this._path.startsWith('/')) {
      link.href = this.router.basename + this._path;
    } else {
      link.href = new URL(this._path).toString();
    }
    for(const childNode of this._childNodeArray) {
      link.appendChild(childNode);
    }
    if (nextSibling) {
      parentNode.insertBefore(link, nextSibling);
    } else {
      parentNode.appendChild(link);
    }
    this._anchorElement = link;

    // ロケーション変更を監視
    getNavigation()?.addEventListener('currententrychange', this._updateActiveState);
    this._updateActiveState();    
  }

  disconnectedCallback() {
    getNavigation()?.removeEventListener('currententrychange', this._updateActiveState);
    if (this._anchorElement) {
      this._anchorElement.remove();
    }
    for(const childNode of this._childNodeArray) {
      childNode.parentNode?.removeChild(childNode);
    }
  }

  private _updateActiveState = () => {
    const currentPath = new URL(window.location.href).pathname;
    const linkPath = this.router.basename + this._path;
    
    if (this._anchorElement) {
      if (currentPath === linkPath) {
        this._anchorElement.classList.add('active');
      } else {
        this._anchorElement.classList.remove('active');
      }
    }
  };
}