import { BuiltinParamTypes } from "../types";
export interface IRouteMatchResult {
    routes: IRoute[];
    params: Record<string, string>;
    typedParams: Record<string, any>;
    path: string;
    lastPath: string;
}
export type GuardHandler = (toPath: string, fromPath: string) => boolean | Promise<boolean>;
export interface _ILayout {
    readonly uuid: string;
    readonly enableShadowRoot: boolean;
    readonly name: string;
    loadTemplate(): Promise<HTMLTemplateElement>;
}
export type ILayout = _ILayout & Pick<Element, 'childNodes'>;
export type SegmentType = 'static' | 'param' | 'catch-all';
export interface ISegmentInfo {
    type: SegmentType;
    segmentText: string;
    paramName: string | null;
    pattern: RegExp;
    isIndex?: boolean;
    paramType?: BuiltinParamTypes;
}
export interface IRouteChildContainer {
    readonly routeChildNodes: IRoute[];
}
export interface IRoute extends IRouteChildContainer {
    readonly routeParentNode: IRoute | null;
    readonly routerNode: IRouter;
    readonly path: string;
    readonly isRelative: boolean;
    readonly absolutePath: string;
    readonly uuid: string;
    readonly placeHolder: Comment;
    readonly childNodeArray: Node[];
    readonly routes: IRoute[];
    params: Record<string, string>;
    typedParams: Record<string, any>;
    readonly paramNames: string[];
    readonly absoluteParamNames: string[];
    readonly weight: number;
    readonly absoluteWeight: number;
    readonly childIndex: number;
    readonly name: string;
    readonly fullpath: string;
    readonly segmentCount: number;
    readonly absoluteSegmentCount: number;
    readonly segmentInfos: ISegmentInfo[];
    readonly absoluteSegmentInfos: ISegmentInfo[];
    guardHandler: GuardHandler;
    shouldChange(newParams: Record<string, string>): boolean;
    guardCheck(matchResult: IRouteMatchResult): Promise<void>;
    initialize(routerNode: IRouter, parentRouteNode: IRoute | null): void;
    testAncestorNode(ancestorNode: IRoute): boolean;
    clearParams(): void;
}
export interface IRouter extends IRouteChildContainer {
    readonly basename: string;
    readonly outlet: IOutlet;
    readonly template: HTMLTemplateElement;
    fallbackRoute: IRoute | null;
    path: string;
    navigate(path: string): Promise<void>;
}
export interface IOutlet {
    routesNode: IRouter;
    readonly rootNode: HTMLElement | ShadowRoot;
    lastRoutes: IRoute[];
}
export interface ILayoutOutlet {
    layout: ILayout;
    readonly name: string;
    assignParams(params: Record<string, any>): void;
}
export interface ILink {
    readonly uuid: string;
    readonly router: IRouter;
    readonly anchorElement: HTMLAnchorElement | null;
}
export interface IHead {
    readonly childElementArray: Element[];
}
export type BindType = "props" | "states" | "attr" | "";
//# sourceMappingURL=types.d.ts.map