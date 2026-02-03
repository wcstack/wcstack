let versionCounter = 0;
export function getNextVersion() {
    versionCounter++;
    return {
        version: versionCounter,
        revision: 0,
    };
}
//# sourceMappingURL=version.js.map