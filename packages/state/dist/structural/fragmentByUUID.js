const fragmentByUUID = new Map();
export function getFragmentByUUID(uuid) {
    return fragmentByUUID.get(uuid) || null;
}
export function setFragmentByUUID(uuid, fragment) {
    if (fragment === null) {
        fragmentByUUID.delete(uuid);
    }
    else {
        fragmentByUUID.set(uuid, fragment);
    }
}
//# sourceMappingURL=fragmentByUUID.js.map