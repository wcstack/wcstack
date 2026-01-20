import { IConfig } from "./types";

export const config: IConfig = {
  tagNames: {
    route: "wcs-route",
    router: "wcs-router",
    outlet: "wcs-outlet",
    layout: "wcs-layout",
    layoutOutlet: "wcs-layout-outlet",
    link: "wcs-link"
  },
  enableShadowRoot: false,
  basenameFileExtensions: [".html"]
};