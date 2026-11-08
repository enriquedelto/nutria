/** Default meal slot: the one whose usual time is closest to now (local time). */
export function closestSlot(slots: { key: string; time: string | null }[], tz: string) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date()).split(":").map(Number);
  const now = h! * 60 + m!;
  let best = slots[0]?.key ?? "lunch", diff = Infinity;
  for (const s of slots) {
    if (!s.time) continue;
    const [sh, sm] = s.time.split(":").map(Number);
    const d = Math.abs(sh! * 60 + sm! - now);
    if (d < diff) [best, diff] = [s.key, d];
  }
  return best;
}
