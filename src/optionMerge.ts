/** Three-way merge of saved options and local edits. Never silently overwrite concurrent edits. */
export function mergeOptions<T>(base: T, edited: T, latest: T): { value: T; conflicts: string[] } {
  const conflicts: string[] = [];
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const identified = (value: unknown[]): value is Array<Record<string, unknown> & { id: string }> =>
    value.every((item) => object(item) && typeof item.id === 'string') &&
    new Set(value.map((item) => (item as { id: string }).id)).size === value.length;
  const merge = (before: unknown, local: unknown, remote: unknown, path: string): unknown => {
    if (equal(local, before)) {
      return remote;
    }
    if (equal(remote, before) || equal(local, remote)) {
      return local;
    }
    if (object(before) && object(local) && object(remote)) {
      const result: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(before), ...Object.keys(local), ...Object.keys(remote)])) {
        const value = merge(before[key], local[key], remote[key], `${path}.${key}`);
        if (value !== undefined) {
          result[key] = value;
        }
      }
      return result;
    }
    if (
      Array.isArray(before) &&
      Array.isArray(local) &&
      Array.isArray(remote) &&
      identified(before) &&
      identified(local) &&
      identified(remote)
    ) {
      const original = new Map(before.map((item) => [item.id, item]));
      const mine = new Map(local.map((item) => [item.id, item]));
      const saved = new Map(remote.map((item) => [item.id, item]));
      const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);
      const order = equal(ids(local), ids(before)) ? ids(remote) : ids(local);
      const result = [];
      for (const id of new Set([...order, ...ids(remote)])) {
        const value = merge(original.get(id), mine.get(id), saved.get(id), `${path}[${id}]`);
        if (value !== undefined) {
          result.push(value);
        }
      }
      return result;
    }
    conflicts.push(path);
    return local;
  };
  return { value: merge(base, edited, latest, 'options') as T, conflicts };
}

export function saveEditedItem<T extends { id: string }>(items: T[], base: T | undefined, draft: T) {
  if (!base) {
    return items.some((item) => item.id === draft.id)
      ? { conflicts: ['ID já cadastrado'], value: items }
      : { conflicts: [], value: [...items, draft] };
  }
  const latest = items.find((item) => item.id === base.id);
  if (!latest) {
    return { conflicts: ['Item removido durante a edição'], value: items };
  }
  const merged = mergeOptions(base, draft, latest);
  return { conflicts: merged.conflicts, value: items.map((item) => (item.id === base.id ? merged.value : item)) };
}
