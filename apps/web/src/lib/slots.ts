const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};

/** Meal slot whose usual time is closest to `hhmm` ("HH:MM"). */
export function slotForTime(slots: { key: string; time?: string | null }[], hhmm: string) {
  const at = minutes(hhmm);
  let best = slots[0]?.key ?? "lunch", diff = Infinity;
  for (const s of slots) {
    if (!s.time) continue;
    const d = Math.abs(minutes(s.time) - at);
    if (d < diff) [best, diff] = [s.key, d];
  }
  return best;
}

/** Current local time "HH:MM" in a time zone (the browser's when omitted). */
export const clockNow = (tz?: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date());

/** Default meal slot: the one whose usual time is closest to now (local time). */
export function closestSlot(slots: { key: string; time: string | null }[], tz: string) {
  return slotForTime(slots, clockNow(tz));
}

/** Local date and time of a Date in the browser's zone: ["YYYY-MM-DD", "HH:MM"]. */
export function localDateTime(d: Date): [string, string] {
  const p = (n: number) => String(n).padStart(2, "0");
  return [`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, `${p(d.getHours())}:${p(d.getMinutes())}`];
}

/** Date from a local "YYYY-MM-DD" + "HH:MM" (browser zone). */
export const fromLocal = (date: string, time: string) => new Date(`${date}T${time}:00`);

/**
 * Default time for a new entry: now when logging today, otherwise the meal's usual time
 * (or noon). `today` is the person's local date.
 */
export function defaultEntryTime(date: string, today: string, slotTime?: string | null) {
  return date === today ? clockNow() : (slotTime?.slice(0, 5) ?? "12:00");
}
