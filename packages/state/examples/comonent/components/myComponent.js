import { waitForStateInitialize } from "@wcstack/state";
import { convertMustacheToComments } from "@wcstack/state";
import { collectStructuralFragments } from "@wcstack/state";
import { initializeBindings } from "@wcstack/state";

class OuterState {
  _innerStateElement;
  constructor(stateElement) {
    this._innerStateElement = stateElement;
  }
  get value() {
    let value = undefined;
    this._innerStateElement.createState("readonly", (state) => {
      value = state.message;
    });
    return value;
  }

  set value(v) {
    this._innerStateElement.createState("readonly", (state) => {
      state.$postUpdate("message");
    });
  }
}

class InnerState {
  _outerStateElement;
  constructor(stateElement) {
    this._outerStateElement = stateElement;
  }

  get message() {
    let value = undefined;
    this._outerStateElement.createState("readonly", (state) => {
      value = state["user.name"];
    });
    return value;
  }

  set message(v) {
    this._outerStateElement.createState("writable", (state) => {
      state["user.name"] = v;
    });
  }
}


class MyComponent extends HTMLElement {
  _outerState;
  _innerState;
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
    <wcs-state name='my'>
    <script type="module">
export default {
  get host() {
    return this.$stateElement.getRootNode().host;
  },
  get message() {
    return this.host.inner.message;
  },
  set message(v) {
    this.host.inner.message = v;
  }
  
}
    </script>
    </wcs-state>
    <p>{{ message@my }}</p>
    <input type="text" data-bind-state="value: message@my" />
    `;
  }

  async connectedCallback() {
    await waitForStateInitialize(this.shadowRoot);
    const innerStateElement = this.shadowRoot.querySelector('wcs-state');
    convertMustacheToComments(this.shadowRoot);
    collectStructuralFragments(this.shadowRoot);
    this._outerState = new OuterState(innerStateElement);
    const outerStateElement = this.getRootNode().querySelector('wcs-state');
    this._innerState = new InnerState(outerStateElement);
    initializeBindings(this.shadowRoot, null);
  }

  get outer() {
    return this._outerState;
  }

  get inner() {
    return this._innerState;
  }
} 

customElements.define('my-component', MyComponent);
