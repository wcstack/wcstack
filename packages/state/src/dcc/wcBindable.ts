export interface IWcBindableProperty {
  name: string;
  event: string;
}

export interface IWcBindable {
  protocol: string;
  version: number;
  properties: IWcBindableProperty[];
}

export function createWcBindable(tagName: string, bindables: string[]): IWcBindable {
  const properties: IWcBindableProperty[] = bindables.map((propName) => ({
    name: propName,
    event: `${tagName}:${propName}-changed`,
  }));
  return {
    protocol: "wc-bindable",
    version: 1,
    properties,
  };
}

export function createBindableEventMap(tagName: string, bindables: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const propName of bindables) {
    map[propName] = `${tagName}:${propName}-changed`;
  }
  return map;
}
