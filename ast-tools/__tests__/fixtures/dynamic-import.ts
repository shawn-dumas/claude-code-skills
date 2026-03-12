export async function loadComponent(): Promise<unknown> {
  const mod = await import('./simple-component');
  return mod.Button;
}

export async function loadTypes(): Promise<unknown> {
  const types = await import('./module-with-types');
  return types;
}
