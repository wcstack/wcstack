export function parseFilterArgs(argsText: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  
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
    } else if (char === ',') {
      args.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  if (current.trim()) {
    args.push(current.trim());
  }
  
  return args;
}