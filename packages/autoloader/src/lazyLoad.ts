import { resolveLoader } from "./resolveLoader";
import { failedTags, loadingTags } from "./tags";
import { IConfig, ILoader, INameSpaceInfo, IPrefixMap, ITagInfo } from "./types";

const isCustomElement = (node: Node): boolean => {
  return (node instanceof Element && (node.tagName.includes("-") || node.getAttribute("is")?.includes("-"))) ?? false;
}

export function getCustomTagInfo(e: Element): ITagInfo {
  const elementTagName = e.tagName.toLowerCase();
  let name;
  let extendsName;
  if (elementTagName.includes("-")) {
    name = elementTagName;
    extendsName = null;
  } else {
    const tagName = e.getAttribute("is");
    if (tagName === null) {
      throw new Error("Custom element without a dash or 'is' attribute found: " + elementTagName);
    }
    if (!tagName.includes("-")) {
      throw new Error("Custom element 'is' attribute without a dash found: " + elementTagName);
    }
    name = tagName;
    extendsName = elementTagName;
  }
  return { name, extends: extendsName };
}

const observedCustomElements: WeakSet<Element> = new WeakSet<Element>();

async function observeShadowRoot(element: Element, config: IConfig, prefixMap: IPrefixMap) {
  observedCustomElements.add(element);
  await handlerForLazyLoad(element.shadowRoot!, config, prefixMap);
}

async function checkObserveShadowRoot(element: Element, config: IConfig, prefixMap: IPrefixMap) {
  if (element.shadowRoot) {
    if (!observedCustomElements.has(element)) {
      await observeShadowRoot(element, config, prefixMap);
    }
  }
}

function matchNameSpace(tagName: string, prefixMap: IPrefixMap): INameSpaceInfo | null {
  for (const [prefix, info] of Object.entries(prefixMap)) {
    if (tagName.startsWith(prefix + "-")) {
      return info;
    }
  }
  return null;
}

async function tagLoad(tagInfo: ITagInfo, config: IConfig, prefixMap: IPrefixMap): Promise<void> {
  const info: INameSpaceInfo | null = matchNameSpace(tagInfo.name, prefixMap);
  if (info === null) {
    throw new Error("No matching namespace found for lazy loaded component: " + tagInfo.name);
  }
  
  if (loadingTags.has(tagInfo.name)) {
    await customElements.whenDefined(tagInfo.name);
    return;
  }  
  loadingTags.add(tagInfo.name);
  try {
    let loader: ILoader;
    try {
      loader = resolveLoader("", info.loaderKey, config.loaders);
    } catch (_e) {
      throw new Error("Loader redirection is not supported for lazy loaded components: " + tagInfo.name);
    }

    const file: string = tagInfo.name.slice(info.prefix.length + 1);
    if (file === "") {
      throw new Error("Invalid component name for lazy loaded component: " + tagInfo.name);
    }
    const path = info.key + file + loader.postfix;

    if (customElements.get(tagInfo.name)) {
      // すでに定義済み
      return;
    }
    const componentConstructor = await loader.loader(path);
    if (componentConstructor !== null) {
      if (customElements.get(tagInfo.name)) {
        // すでに定義済み
        return;
      }
      if (tagInfo.extends === null) {
        customElements.define(tagInfo.name, componentConstructor);
      } else {
        customElements.define(tagInfo.name, componentConstructor, { extends: tagInfo.extends });
      }
    } else {
      throw new Error("Loader returned null for component: " + tagInfo.name);
    }
  } catch(e) {
    console.error(`Failed to lazy load component '${tagInfo.name}':`, e);
    failedTags.add(tagInfo.name);
  } finally {
    loadingTags.delete(tagInfo.name);
  }
}

//
async function lazyLoad(root: Node, config: IConfig, prefixMap: IPrefixMap): Promise<number> {
  const elements: Element[] = [];

  // Create TreeWalker (target element and comment nodes)
  const walker = document.createTreeWalker(
    root, 
    NodeFilter.SHOW_ELEMENT,
    (node: Node): number => {
      return isCustomElement(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    } 
  );
  
  // Move to next node with TreeWalker and add matching nodes to array
  while (walker.nextNode()) {
    elements.push(walker.currentNode as Element);
  }

  const tagInfos: ITagInfo[] = [];
  const tagNames = new Set<string>();
  for(const element of elements) {
    const tagInfo = getCustomTagInfo(element);
    const customClass = customElements.get(tagInfo.name);
    if (customClass === undefined) {
      // undefined
      customElements.whenDefined(tagInfo.name).then(async () => {
        // upgraded
        await checkObserveShadowRoot(element, config, prefixMap);
      });
      if (!tagNames.has(tagInfo.name) && !failedTags.has(tagInfo.name)) {
        tagNames.add(tagInfo.name);
        tagInfos.push(tagInfo);
      }
    } else {
      // upgraded
      await checkObserveShadowRoot(element, config, prefixMap);
    }
  }
  let tagCount = 0;
  for(const tagInfo of tagInfos) {
    await tagLoad(tagInfo, config, prefixMap);
    tagCount++;
  }
  return tagCount;

}

async function lazyLoads(
  root: Document | ShadowRoot, 
  config: IConfig, 
  prefixMap: IPrefixMap
): Promise<void> {
  while(await lazyLoad(root, config, prefixMap) > 0) {
    // Repeat until no more tags to load
  }
}

export async function handlerForLazyLoad(
  root: Document | ShadowRoot, 
  config: IConfig,
  prefixMap: IPrefixMap 
): Promise<void> {
  if (Object.keys(prefixMap).length === 0) {
    return;
  }
  try {
    await lazyLoads(root, config, prefixMap);
  } catch(e) {
    throw new Error("Failed to lazy load components: " + e);
  }

  if (!config.observable) {
    return;
  }
  const mo = new MutationObserver(async (): Promise<void> => {
    try {
      await lazyLoads(root, config, prefixMap);
    } catch(e) {
      console.error("Failed to lazy load components: " + e);
    }
  });
  mo.observe(root, { childList: true, subtree: true });
}
