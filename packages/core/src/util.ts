/** Short error text for logs: the root cause, without SQL text or parameters (they may hold personal data). */
export function errorSummary(e: unknown): string {
  const root = (e as { cause?: unknown })?.cause ?? e;
  const msg = root instanceof Error ? root.message : String(root);
  return msg.startsWith("Failed query:") ? "Fallo de SQL" : msg.slice(0, 300);
}

/**
 * Side work that must not fail the caller (recompute targets after a weigh-in, a push after a
 * sync…): run it, and if it fails log a JSON warning instead of swallowing the error silently.
 */
export async function bestEffort<T>(label: string, work: Promise<T> | (() => Promise<T>), ctx: Record<string, unknown> = {}): Promise<T | undefined> {
  try {
    return await (typeof work === "function" ? work() : work);
  } catch (e) {
    console.warn(JSON.stringify({ t: new Date().toISOString(), level: "warn", msg: label, ...ctx, error: errorSummary(e) }));
    return undefined;
  }
}

/** `db.execute` returns an array (postgres.js) or `{ rows }` (PGlite): normalize. */
export function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: T[] }).rows ?? [])) as T[];
}
