import { raiseError } from "../raiseError";
export async function loadFromJsonFile(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            raiseError(`Failed to fetch JSON file: ${response.statusText}`);
        }
        const data = await response.json();
        return data;
    }
    catch (e) {
        console.error('Failed to load JSON file:', e);
        return {};
    }
}
//# sourceMappingURL=loadFromJsonFile.js.map