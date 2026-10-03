/**
 * Walk a dotted path into a JSON bag. Returns undefined if any segment is
 * missing. Used to resolve a gate's `input_attribute` against the patient
 * narrative (e.g. `freeformData.narrative.chief_complaint`).
 */
export function resolveDottedPath(root: unknown, path: string): unknown {
  if (!path) return undefined;
  let cursor: unknown = root;
  for (const segment of path.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}
