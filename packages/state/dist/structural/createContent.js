import { getBindingsByContent, setBindingsByContent } from "../bindings/bindingsByContent.js";
import { initializeBindingsByFragment } from "../bindings/initializeBindings.js";
import { raiseError } from "../raiseError.js";
import { getContentByNode, setContentByNode } from "./contentByNode.js";
import { getFragmentInfoByUUID } from "./fragmentInfoByUUID.js";
class Content {
    _content;
    _childNodeArray = [];
    _firstNode = null;
    _lastNode = null;
    _mounted = false;
    constructor(content) {
        this._content = content;
        this._childNodeArray = Array.from(this._content.childNodes);
        this._firstNode = this._childNodeArray.length > 0 ? this._childNodeArray[0] : null;
        this._lastNode = this._childNodeArray.length > 0 ? this._childNodeArray[this._childNodeArray.length - 1] : null;
    }
    get firstNode() {
        return this._firstNode;
    }
    get lastNode() {
        return this._lastNode;
    }
    get mounted() {
        return this._mounted;
    }
    mountAfter(targetNode) {
        const parentNode = targetNode.parentNode;
        const nextSibling = targetNode.nextSibling;
        if (parentNode) {
            this._childNodeArray.forEach((node) => {
                parentNode.insertBefore(node, nextSibling);
            });
        }
        this._mounted = true;
    }
    unmount() {
        this._childNodeArray.forEach((node) => {
            if (node.parentNode) {
                node.parentNode.removeChild(node);
            }
        });
        const bindings = getBindingsByContent(this);
        for (const binding of bindings) {
            if (binding.bindingType === 'if' || binding.bindingType === 'elseif' || binding.bindingType === 'else') {
                const content = getContentByNode(binding.node);
                if (content !== null) {
                    content.unmount();
                }
            }
        }
        this._mounted = false;
    }
}
export function createContent(bindingInfo, loopContext) {
    if (typeof bindingInfo.uuid === 'undefined' || bindingInfo.uuid === null) {
        raiseError(`BindingInfo.uuid is null.`);
    }
    const fragmentInfo = getFragmentInfoByUUID(bindingInfo.uuid);
    if (!fragmentInfo) {
        raiseError(`Fragment with UUID "${bindingInfo.uuid}" not found.`);
    }
    const cloneFragment = document.importNode(fragmentInfo.fragment, true);
    const bindings = initializeBindingsByFragment(cloneFragment, fragmentInfo.nodeInfos, loopContext);
    const content = new Content(cloneFragment);
    setBindingsByContent(content, bindings);
    setContentByNode(bindingInfo.node, content);
    return content;
}
//# sourceMappingURL=createContent.js.map