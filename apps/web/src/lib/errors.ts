/**
 * Errors meant for the person using the app.
 *
 * In production Next.js replaces a server action's thrown message with a generic text and only
 * forwards `digest`. A UserError carries its message in the digest so the client can show it;
 * anything else (bugs, DB errors) stays redacted.
 */
const PREFIX = "nutria:";

export class UserError extends Error {
  digest: string;
  constructor(message: string) {
    super(message);
    this.name = "UserError";
    this.digest = PREFIX + message;
  }
}

/** Text to show for a caught error: the UserError message, a client-side message, or the fallback. */
export function errorText(e: unknown, fallback = "Algo ha fallado"): string {
  const digest = (e as { digest?: unknown } | null)?.digest;
  if (typeof digest === "string" && digest.startsWith(PREFIX)) return digest.slice(PREFIX.length);
  if (!(e instanceof Error) || !e.message) return fallback;
  // Redacted server errors and zod issue dumps are not readable text.
  if (/Server Components render|omitted in production|An unexpected response|^\s*[[{]/.test(e.message)) return fallback;
  return e.message;
}
