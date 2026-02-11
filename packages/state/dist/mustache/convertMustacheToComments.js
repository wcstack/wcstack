import { config } from "../config.js";
import { SVG_NAMESPACE } from "../define.js";
const MUSTACHE_REGEX = /\{\{\s*(.+?)\s*\}\}/g;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE"]);
export function convertMustacheToComments(root) {
    if (!config.enableMustache) {
        return;
    }
    convertTextNodes(root);
    const templates = Array.from(root.querySelectorAll("template"));
    for (const template of templates) {
        if (template.namespaceURI === SVG_NAMESPACE) {
            const newTemplate = document.createElement("template");
            const childNodes = Array.from(template.childNodes);
            for (let i = 0; i < childNodes.length; i++) {
                const childNode = childNodes[i];
                newTemplate.content.appendChild(childNode);
            }
            for (const attr of template.attributes) {
                newTemplate.setAttribute(attr.name, attr.value);
            }
            template.replaceWith(newTemplate);
            convertMustacheToComments(newTemplate.content);
        }
        else {
            convertMustacheToComments(template.content);
        }
    }
}
function convertTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
    }
    for (const textNode of textNodes) {
        if (textNode.parentElement && SKIP_TAGS.has(textNode.parentElement.tagName)) {
            continue;
        }
        replaceTextNode(textNode);
    }
}
function replaceTextNode(textNode) {
    const text = textNode.data;
    MUSTACHE_REGEX.lastIndex = 0;
    if (!MUSTACHE_REGEX.test(text)) {
        return;
    }
    MUSTACHE_REGEX.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    while ((match = MUSTACHE_REGEX.exec(text)) !== null) {
        if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        const bindText = match[1];
        fragment.appendChild(document.createComment(`@@: ${bindText}`));
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    textNode.parentNode.replaceChild(fragment, textNode);
}
//# sourceMappingURL=convertMustacheToComments.js.map