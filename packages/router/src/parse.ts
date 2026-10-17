import { IRoute, IRouter } from "./components/types.js";
import { Layout } from "./components/Layout.js";
import { createLayoutOutlet } from "./components/LayoutOutlet.js";
import { Route } from "./components/Route.js";
import { config } from "./config.js";
import { loadGuardHandler } from "./loadGuardHandler.js";


/**
 * 同一の絶対パスを持つ Route が複数定義された場合に警告を出力する。
 *
 * 仕様: 同一 absolutePath ごとに 1 回だけ警告する（複数重複でも警告は 1 件）。
 * これは過剰なログを避けるための意図的な設計。
 * テストでは Vitest の console.warn spy で 1 回出力を確認する。
 */
function _duplicateCheck(routesByPath: Map<string, IRoute[]>, route: IRoute): void {
  let routes = routesByPath.get(route.absolutePath);
  if (!routes) {
    routes = [];
  }
  for(const existingRoute of routes) {
    if (!route.testAncestorNode(existingRoute)) {
      console.warn(`Duplicate route path detected: '${route.absolutePath}' (defined as '${route.path}')`);
      break;
    }
  }
  routes.push(route);
  if (routes.length === 1) {
    routesByPath.set(route.absolutePath, routes);
  }
}

/**
 * `routeParentNode` は `node` を囲む最も内側の `<wcs-route>`（無ければ null）。再帰の引数で渡す —
 * それまでに解析したルートの一覧の最後で決めると、前の兄弟（とその子孫）が親に化けた: `<div>` や
 * `<wcs-layout>` の中のルートが前のルートの下のパスになるか、絶対パスなら「親がある」で落ち、
 * 入れ子のルートの後に置いた `<wcs-guard-handler>` は外側でなく子のルートを守った
 * （docs/mistake-catalogue.md）。
 */
async function _parseNode(
  routerNode: IRouter,
  node: Node,
  routeParentNode: IRoute | null,
  routesByPath: Map<string, IRoute[]>
): Promise<DocumentFragment> {
  const fragment = document.createDocumentFragment();
  // the last <wcs-route> among node's children so far: the route an outside <wcs-guard-handler> after it guarded
  let previousRoute: IRoute | null = null;
  const childNodes = Array.from(node.childNodes);
  for(const childNode of childNodes) {
    if (childNode.nodeType === Node.ELEMENT_NODE) {
      let appendNode = childNode
      let element = childNode as HTMLElement;
      // the route the children are parsed under: this one when it is a <wcs-route>, else the enclosing one
      let childParent = routeParentNode;
      const tagName = element.tagName.toLowerCase();
      if (tagName === config.tagNames.route) {
        const childFragment = document.createDocumentFragment();
        // Move child nodes to fragment to avoid duplication of
        for(const childNode of Array.from(element.childNodes)) {
          childFragment.appendChild(childNode);
        }
        const cloneElement = document.importNode<Route>(element as Route, true);
        customElements.upgrade(cloneElement);
        cloneElement.appendChild(childFragment);
        const route = cloneElement;
        route.initialize(routerNode, routeParentNode);
        _duplicateCheck(routesByPath, route);
        appendNode = route.placeHolder;
        element = route;
        childParent = route;
        previousRoute = route;
      } else if (tagName === config.tagNames.guardHandler) {
        // 囲むルートを守る（子のルートの前でも後でも）。ルートの外のものは、同じ階層の直前のルートを守る —
        // 以前は「直前に解析したルート」に付いたので、その形で守ってきたページを、更新で黙って開けないため
        // （README は外に置けば無視されると書いていた）。どちらでもない形と、守れない形は黙らない — その
        // ルートは守られず、保護したページが見えるので console.error（docs/mistake-catalogue.md）
        const route = routeParentNode ?? previousRoute;
        const script = element.querySelector('script[type="module"]');
        if (route === null) {
          console.error(`[@wcstack/router] [wcs/guard-handler-ignored] A <${config.tagNames.guardHandler}> outside a <${config.tagNames.route}> guards nothing: put it inside the route it guards.`);
        } else if (!script) {
          console.error(`[@wcstack/router] [wcs/guard-handler-ignored] The <${config.tagNames.guardHandler}> of route "${route.absolutePath}" has no <script type="module">, so the route is not guarded.`);
        } else {
          if (routeParentNode === null) {
            console.error(`[@wcstack/router] [wcs/guard-handler-ignored] A <${config.tagNames.guardHandler}> outside a <${config.tagNames.route}> guards the route before it, "${route.absolutePath}": put it inside that route.`);
          }
          // ハンドラがあれば guard を有効にする（`guard` 属性が無くても）。読み込みより前に —
          // 最初のナビゲーションの guard 相がハンドラを待てるように。属性が無いと待たずに通し、
          // 最初の表示だけ守られなかった（docs/seam-apps.md、router-auth）
          route.enableGuard();
          loadGuardHandler(script as HTMLScriptElement, route);
        }
        continue;
      } else if (tagName === "template") {
        // 不透明な葉として扱う。<template> の子は childNodes ではなく .content に
        // 居るため、汎用の再構築（_parseNode → innerHTML = "" → appendChild）に
        // 通すと content が空になり、ルート内容に書かれた state の構造テンプレート
        // （for / if）を黙って破壊する。route 定義は template の中には置けない
        // （inert）ので、中を辿る理由も無い。
        fragment.appendChild(element);
        continue;
      } else if (tagName === config.tagNames.layout) {
        // <wcs-layout> は他の case と異なり element と appendNode が別物になる。
        // - element: cloneElement (Layout 本体)。後続の `element.innerHTML = ""; element.appendChild(children)`
        //   で再帰結果が Layout 内に流し込まれる。Layout はそれを slot 投影に使う。
        // - appendNode: layoutOutlet。最終的に fragment へ挿入されるのは layoutOutlet で、
        //   layoutOutlet が element (Layout) を参照して投影を行う。
        const childFragment = document.createDocumentFragment();
        // Move child nodes to fragment to avoid duplication of
        for(const childNode of Array.from(element.childNodes)) {
          childFragment.appendChild(childNode);
        }
        const cloneElement = document.importNode(element, true);
        customElements.upgrade(cloneElement);
        cloneElement.appendChild(childFragment);
        const layout = cloneElement;
        const layoutOutlet = createLayoutOutlet();
        layoutOutlet.layout = layout as Layout;
        appendNode = layoutOutlet;
        element = cloneElement;
      }
      const children = await _parseNode(routerNode, element, childParent, routesByPath);
      // 空文字の innerHTML 代入は Trusted Types 下でも通る実装が多いが、その細目に
      // 寄りかからずノード操作で書く（docs/csp.md §7）。意図としても「子を全消しして
      // 差し替える」のほうが直接的。
      element.replaceChildren();
      element.appendChild(children);
      fragment.appendChild(appendNode);
    } else {
      fragment.appendChild(childNode);
    }
  }
  return fragment;
}

export async function parse(routerNode: IRouter): Promise<DocumentFragment> {
  const routesByPath: Map<string, IRoute[]> = new Map();
  const fr = await _parseNode(routerNode, routerNode.template.content, null, routesByPath);
  return fr;
}