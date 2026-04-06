import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "wcs-ws": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          url?: string;
          "auto-reconnect"?: string;
          "reconnect-interval"?: string;
          "max-reconnects"?: string;
          manual?: string;
          protocols?: string;
        },
        HTMLElement
      >;
    }
  }
}
