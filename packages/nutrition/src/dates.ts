/** Local-date helpers (dates are YYYY-MM-DD in the person's timezone). */

export function todayIn(timeZone = "Europe/Madrid", now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function weekStart(date: string, weekStartsOn = 1): string {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // 1..7 (Mon..Sun)
  const diff = (dow - weekStartsOn + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

export function isoDow(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  while (d.getTime() <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function formatDateEs(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }): string {
  return new Intl.DateTimeFormat("es-ES", { ...opts, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}
