import { State } from "./components/State";
import { config } from "./config";
const stateElementByName = new Map();
export function getStateElementByName(name) {
    const result = stateElementByName.get(name) || null;
    if (result === null && name === 'default') {
        const state = document.querySelector(`${config.tagNames.state}:not([name])`);
        if (state instanceof State) {
            stateElementByName.set('default', state);
            return state;
        }
    }
    return result;
}
export function setStateElementByName(name, element) {
    if (element === null) {
        stateElementByName.delete(name);
    }
    else {
        stateElementByName.set(name, element);
    }
}
//# sourceMappingURL=stateElementByName.js.map