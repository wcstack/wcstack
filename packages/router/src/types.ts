
export interface ITagNames {
  route: string;
  router: string;
  outlet: string;
  layout: string;
  layoutOutlet: string;
  link: string;
}

export interface IConfig {
  tagNames: ITagNames;
  enableShadowRoot: boolean;
}

export interface IGuardCancel {
  fallbackPath: string;
}