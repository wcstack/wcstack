import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
const absoluteStateAddressByStateAddressByStateElement = new WeakMap();
export function createAbsoluteStateAddress(stateName, address) {
    const stateElement = getStateElementByName(stateName);
    if (stateElement === null) {
        raiseError(`State element with name "${stateName}" not found.`);
    }
    let absoluteStateAddressByStateAddress = absoluteStateAddressByStateAddressByStateElement.get(stateElement);
    if (typeof absoluteStateAddressByStateAddress !== "undefined") {
        let absoluteStateAddress = absoluteStateAddressByStateAddress.get(address);
        if (typeof absoluteStateAddress === "undefined") {
            absoluteStateAddress = Object.freeze({
                address,
                stateName,
            });
            absoluteStateAddressByStateAddress.set(address, absoluteStateAddress);
        }
        return absoluteStateAddress;
    }
    else {
        const absoluteStateAddress = Object.freeze({
            address,
            stateName,
        });
        absoluteStateAddressByStateAddress = new WeakMap([[address, absoluteStateAddress]]);
        absoluteStateAddressByStateAddressByStateElement.set(stateElement, absoluteStateAddressByStateAddress);
        return absoluteStateAddress;
    }
}
//# sourceMappingURL=AbsoluteStateAddress.js.map