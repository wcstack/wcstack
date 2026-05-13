
// wc-bindable protocol (@wc-bindable/core v0.5.0) for custom element binding.
// properties:  bidirectional — element dispatches events on change, framework subscribes
// inputs:      one-way framework→element — optional `attribute` mirrors the property to that attribute
// commands:    framework invokes the element's method by name (subscribe via pub/sub token)
export interface IWcBindableProperty {
  readonly name: string;
  readonly event: string;
  readonly getter?: (event: Event) => any;
}

export interface IWcBindableInput {
  readonly name: string;
  readonly attribute?: string;
}

export interface IWcBindableCommand {
  readonly name: string;
  readonly async?: boolean;
}

export interface IWcBindable {
  readonly protocol: "wc-bindable";
  readonly version: 1;
  readonly properties: IWcBindableProperty[];
  readonly inputs?: readonly IWcBindableInput[];
  readonly commands?: readonly IWcBindableCommand[];
}
