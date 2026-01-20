interface ITagNames {
    route: string;
    router: string;
    outlet: string;
    layout: string;
    layoutOutlet: string;
    link: string;
}
interface IConfig {
    tagNames: ITagNames;
    enableShadowRoot: boolean;
    basenameFileExtensions: string[];
}

declare const config: IConfig;

declare function registerComponents(): void;

export { config, registerComponents };
