
export interface ITagNames {
  readonly route: string;
  readonly router: string;
  readonly outlet: string;
  readonly layout: string;
  readonly layoutOutlet: string;
  readonly link: string;
}

export interface IConfig {
  readonly tagNames: ITagNames;
  readonly enableShadowRoot: boolean;
  readonly basenameFileExtensions: readonly string[];
}

export interface IGuardCancel {
  fallbackPath: string;
}