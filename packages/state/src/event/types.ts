
// Protocol for defining custom reactivity in custom elements
export interface IWcsReactivity {
  defaultEvent: string;
  properties?: string[];
  propertyMap?: Record<string, string>;
}