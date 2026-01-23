
export async function load(path: string): Promise<CustomElementConstructor> {
  const module = await import(`${path}`);
  return module.default as CustomElementConstructor;
}
