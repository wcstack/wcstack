import { resolveLoader } from "./resolveLoader.js";
import { failedTags } from "./tags.js";
import { IEagerLoadInfo, ILoader } from "./types.js";


const EXTENDS_MAP = new Map<any, string>();

if (typeof window !== "undefined") {
  const map = [
    [HTMLButtonElement, "button"],
    [HTMLInputElement, "input"],
    [HTMLAnchorElement, "a"],
    [HTMLImageElement, "img"],
    [HTMLDivElement, "div"],
    [HTMLSpanElement, "span"],
    [HTMLParagraphElement, "p"],
    [HTMLUListElement, "ul"],
    [HTMLOListElement, "ol"],
    [HTMLLIElement, "li"],
    [HTMLTableElement, "table"],
    [HTMLFormElement, "form"],
    [HTMLLabelElement, "label"],
    [HTMLSelectElement, "select"],
    [HTMLTextAreaElement, "textarea"],
    [HTMLHeadingElement, "h1"],
    [HTMLQuoteElement, "blockquote"],
    [HTMLPreElement, "pre"],
    [HTMLBRElement, "br"],
    [HTMLHRElement, "hr"],
    [HTMLModElement, "ins"],
    [HTMLTableCaptionElement, "caption"],
    [HTMLTableColElement, "col"],
    [HTMLTableSectionElement, "tbody"],
    [HTMLTableRowElement, "tr"],
    [HTMLTableCellElement, "td"],
    [HTMLFieldSetElement, "fieldset"],
    [HTMLLegendElement, "legend"],
    [HTMLDListElement, "dl"],
    [HTMLOptGroupElement, "optgroup"],
    [HTMLOptionElement, "option"],
    [HTMLStyleElement, "style"],
    [HTMLScriptElement, "script"],
    [HTMLTemplateElement, "template"],
    [HTMLCanvasElement, "canvas"],
    [HTMLIFrameElement, "iframe"],
    [HTMLObjectElement, "object"],
    [HTMLEmbedElement, "embed"],
    [HTMLVideoElement, "video"],
    [HTMLAudioElement, "audio"],
    [HTMLTrackElement, "track"],
    [HTMLMapElement, "map"],
    [HTMLAreaElement, "area"],
    [HTMLSourceElement, "source"],
    [HTMLParamElement, "param"],
    [HTMLMeterElement, "meter"],
    [HTMLProgressElement, "progress"],
    [HTMLOutputElement, "output"],
    [HTMLDetailsElement, "details"],
    [HTMLDialogElement, "dialog"],
    [HTMLMenuElement, "menu"],
    [HTMLSlotElement, "slot"],
    [HTMLTimeElement, "time"],
    [HTMLDataElement, "data"],
    [HTMLPictureElement, "picture"],
  ] as const;

  map.forEach(([cls, tag]) => {
    if (typeof cls !== "undefined") {
      EXTENDS_MAP.set(cls, tag);
    }
  });
}

function resolveExtends(componentConstructor: CustomElementConstructor): string | null {
  for (const [cls, tag] of EXTENDS_MAP) {
    if (componentConstructor.prototype instanceof cls) {
      return tag;
    }
  }
  return null;
}

export async function eagerLoad(
  loadMap: Record<string, IEagerLoadInfo>, 
  loaders: Record<string, ILoader | string>
): Promise<void> {
  for(const [tagName, info] of Object.entries(loadMap)) {
    let loader: ILoader;
    try {
      loader = resolveLoader(info.key, info.loaderKey, loaders);
    } catch (_e) {
      throw new Error("Loader redirection is not supported for eager loaded components: " + tagName);
    }

    try {
      const componentConstructor = await loader.loader(info.key);
      if (componentConstructor !== null) {
        let extendsName = info.extends;
        if (extendsName === null) {
          extendsName = resolveExtends(componentConstructor);
        }

        if (extendsName === null) {
          customElements.define(tagName, componentConstructor);
        } else {
          customElements.define(tagName, componentConstructor, { extends: extendsName });
        }
      }
    } catch(e) {
      if (!failedTags.has(tagName)) {
        console.error(`Failed to eager load component '${tagName}':`, e);
        failedTags.add(tagName);
      }
    }
  }
}
