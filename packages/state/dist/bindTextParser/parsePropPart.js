import { trimFn } from "./utils";
// format: propName#moodifier1,modifier2
// propName-format: path.to.property (e.g., textContent, style.color, not include :)
// special path: 
//   'attr.attributeName' for attributes (e.g., attr.href, attr.data-id)
//   'style.propertyName' for style properties (e.g., style.backgroundColor, style.fontSize)
//   'class.className' for class names (e.g., class.active, class.hidden)
//   'onclick', 'onchange' etc. for event listeners
export function parsePropPart(propPart) {
    const [propName, propModifiersText] = propPart.split('#').map(trimFn);
    const propSegments = propName.split('.').map(trimFn);
    const propModifiers = propModifiersText
        ? propModifiersText.split(',').map(trimFn)
        : [];
    return {
        propName,
        propSegments,
        propModifiers,
    };
}
//# sourceMappingURL=parsePropPart.js.map