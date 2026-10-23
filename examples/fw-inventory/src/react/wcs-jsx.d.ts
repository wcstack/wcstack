// The tags' JSX declarations, by hand: the packages ship none (docs/framework-adapter-integration.md
// §2). Attributes are strings; an object input (`files`) is a property React 19 assigns because the
// tag is defined before the first render (main.tsx imports each package's `/auto`).
import "react";

type Base = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "wcs-fetch": Base & { url?: string | null; method?: string; manual?: boolean };
      "wcs-sse": Base & { url?: string | null; events?: string; manual?: boolean };
      "wcs-storage": Base & { "storage-key"?: string; type?: "local" | "session"; manual?: boolean };
      "wcs-upload": Base & { url?: string; manual?: boolean; files?: File[] | FileList | null; accept?: string };
      "wcs-broadcast": Base & { name?: string; manual?: boolean };
    }
  }
}
