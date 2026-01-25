import { config } from "../config";
import { findStateElement } from "../findStateElement";
import { getUUID } from "../getUUID";
import { createLoopContent } from "../LoopContent";
import { getPathInfo } from "../address/PathInfo";
import { raiseError } from "../raiseError";
import { getListIndexesByList } from "../list/listIndexesByList";
import { initializeBindings } from "../initializeBindings";
export class Loop extends HTMLElement {
    _uuid = getUUID();
    _path = '';
    _stateElement = null;
    _placeHolder = document.createComment(`@@loop:${this._uuid}`);
    _initializePromise;
    _resolveInitialize = null;
    _initialized = false;
    _loopContent = null;
    _loopContents = [];
    _loopValue = null;
    _bindingInfo = null;
    constructor() {
        super();
        this._initializePromise = new Promise((resolve) => {
            this._resolveInitialize = resolve;
        });
    }
    get uuid() {
        return this._uuid;
    }
    get path() {
        return this._path;
    }
    get stateElement() {
        if (this._stateElement === null) {
            raiseError(`Loop stateElement is not set.`);
        }
        return this._stateElement;
    }
    get loopContent() {
        if (this._loopContent === null) {
            raiseError(`Loop content is not initialized.`);
        }
        return this._loopContent;
    }
    get bindingInfo() {
        if (this._bindingInfo === null) {
            raiseError(`Loop bindingInfo is not set.`);
        }
        return this._bindingInfo;
    }
    get initializePromise() {
        return this._initializePromise;
    }
    initialize() {
        const template = this.querySelector('template');
        if (!template) {
            raiseError(`${config.tagNames.loop} requires a <template> child element.`);
        }
        this._loopContent = template.content;
        const bindText = this.getAttribute(config.bindAttributeName) || '';
        const [statePathName, stateTempName] = bindText.split('@').map(s => s.trim());
        if (statePathName === '') {
            raiseError(`Invalid loop binding syntax: "${bindText}".`);
        }
        const stateName = stateTempName ?? 'default';
        const statePathInfo = getPathInfo(statePathName);
        const stateElement = findStateElement(document, stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${stateName}" not found for loop binding "${bindText}".`);
        }
        this._bindingInfo = {
            propName: 'loopValue',
            propSegments: ['loopValue'],
            propModifiers: [],
            statePathName,
            statePathInfo,
            stateName,
            stateElement,
            filterTexts: [],
            node: this,
        };
        stateElement.listPaths.add(statePathName);
    }
    async connectedCallback() {
        this.replaceWith(this._placeHolder);
        if (!this._initialized) {
            this.initialize();
            this._resolveInitialize?.();
            this._initialized = true;
        }
    }
    get loopValue() {
        return this._loopValue;
    }
    set loopValue(value) {
        this.render(value, this._loopValue);
        this._loopValue = value;
    }
    render(newValue, oldValue) {
        if (!Array.isArray(newValue)) {
            for (let content of this._loopContents) {
                content.unmount();
            }
        }
        else {
            const parentNode = this._placeHolder.parentNode;
            if (parentNode === null) {
                raiseError(`Loop placeholder has no parent node.`);
            }
            // Remove old contents
            for (let content of this._loopContents) {
                content.unmount();
            }
            this._loopContents = [];
            const listIndexes = getListIndexesByList(newValue);
            if (listIndexes === null) {
                raiseError(`List indexes not found for loop value.`);
            }
            // Create new contents
            let lastNode = this._placeHolder;
            for (let i = 0; i < newValue.length; i++) {
                const listIndex = listIndexes[i];
                const content = document.importNode(this.loopContent, true);
                initializeBindings(content, listIndex);
                const loopContent = createLoopContent(content);
                loopContent.mountAfter(lastNode);
                this._loopContents.push(loopContent);
                lastNode = loopContent.lastNode || lastNode;
            }
        }
    }
}
//# sourceMappingURL=Loop.js.map