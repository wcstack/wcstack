const fragmentInfoByUUID = new Map();
export function setFragmentInfoByUUID(uuid, fragmentInfo) {
    if (fragmentInfo === null) {
        fragmentInfoByUUID.delete(uuid);
    }
    else {
        fragmentInfoByUUID.set(uuid, fragmentInfo);
    }
}
export function getFragmentInfoByUUID(uuid) {
    return fragmentInfoByUUID.get(uuid) || null;
}
//# sourceMappingURL=fragmentInfoByUUID.js.map