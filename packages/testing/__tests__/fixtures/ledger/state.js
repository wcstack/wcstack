// A state in its own file (<wcs-state src="./state.js">) that imports a helper module.
import { total } from "./lib.js";

export default {
  entries: [{ amount: 3 }, { amount: 4 }],
  get total() {
    return total(this.entries);
  },
  add() {
    this.entries = [...this.entries, { amount: 1 }];
  },
};
