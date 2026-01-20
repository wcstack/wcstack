interface ITagNames {
    readonly route: string;
    readonly router: string;
    readonly outlet: string;
    readonly layout: string;
    readonly layoutOutlet: string;
    readonly link: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
    readonly enableShadowRoot: boolean;
    readonly basenameFileExtensions: readonly string[];
}

declare const config: IConfig;

declare function registerComponents(): void;

export { config, registerComponents };
