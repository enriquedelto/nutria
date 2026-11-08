/** `db.execute` returns an array (postgres.js) or `{ rows }` (PGlite): normalize. */
export function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: T[] }).rows ?? [])) as T[];
}
