export function parseFilterArgs(argsText) {
    const args = [];
    let current = '';
    let inQuote = null;
    for (let i = 0; i < argsText.length; i++) {
        const char = argsText[i];
        if (inQuote) {
            if (char === inQuote) {
                inQuote = null;
            }
            else {
                current += char;
            }
        }
        else if (char === '"' || char === "'") {
            inQuote = char;
        }
        else if (char === ',') {
            args.push(current.trim());
            current = '';
        }
        else {
            current += char;
        }
    }
    if (current.trim()) {
        args.push(current.trim());
    }
    return args;
}
//# sourceMappingURL=parseFilterArgs.js.map