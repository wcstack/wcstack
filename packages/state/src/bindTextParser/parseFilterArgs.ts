export function parseFilterArgs(argsText: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  let hasQuote = false;

  for (let i = 0; i < argsText.length; i++) {
    const char = argsText[i];

    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
      hasQuote = true;
    } else if (char === ',') {
      args.push(current.trim());
      current = '';
      hasQuote = false;
    } else {
      current += char;
    }
  }

  const last = current.trim();
  if (last || hasQuote) {
    args.push(last);
  }

  return args;
}
