import { parseFilters } from "./parseFilters";
import { trimFn } from "./utils";
const cacheFilterInfos = new Map();
// format: propName#moodifier1,modifier2
// propName-format: path.to.property (e.g., textContent, style.color, not include :)
// special path: 
//   'attr.attributeName' for attributes (e.g., attr.href, attr.data-id)
//   'style.propertyName' for style properties (e.g., style.backgroundColor, style.fontSize)
//   'class.className' for class names (e.g., class.active, class.hidden)
//   'onclick', 'onchange' etc. for event listeners
export function parsePropPart(propPart) {
    const pos = propPart.indexOf('|');
    let propText = '';
    let filterTexts = [];
    let filtersText = '';
    let filters = [];
    if (pos !== -1) {
        propText = propPart.slice(0, pos).trim();
        filtersText = propPart.slice(pos + 1).trim();
        if (cacheFilterInfos.has(filtersText)) {
            filters = cacheFilterInfos.get(filtersText);
        }
        else {
            filterTexts = filtersText.split('|').map(trimFn);
            filters = parseFilters(filterTexts, "input");
            cacheFilterInfos.set(filtersText, filters);
        }
    }
    else {
        propText = propPart.trim();
    }
    const [propName, propModifiersText] = propText.split('#').map(trimFn);
    const propSegments = propName.split('.').map(trimFn);
    const propModifiers = propModifiersText
        ? propModifiersText.split(',').map(trimFn)
        : [];
    return {
        propName,
        propSegments,
        propModifiers,
        inFilters: filters,
    };
}
//# sourceMappingURL=parsePropPart.js.map