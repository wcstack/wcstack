const parseBindTextResultByUUID = new Map();
export function getParseBindTextResultByUUID(uuid) {
    return parseBindTextResultByUUID.get(uuid) || null;
}
export function setParseBindTextResultByUUID(uuid, parseBindTextResult) {
    if (parseBindTextResult === null) {
        parseBindTextResultByUUID.delete(uuid);
    }
    else {
        parseBindTextResultByUUID.set(uuid, parseBindTextResult);
    }
}
//# sourceMappingURL=parseBindTextResultByUUID.js.map