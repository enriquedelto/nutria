/**
 * «Cerrar el día»: at night (22:30 by default, notification_prefs type "day_close") a day logged
 * well under the kcal target asks whether it is complete. «Completo» marks it from the
 * notification itself; «Registrar» and «Fuera» open the app.
 */
import { and, dailySummaries, eq, type Database } from "@nutria/db";
import { recomputeDay } from "./summaries";

export const DAY_CLOSE = "day_close";
export const DAY_CLOSE_TIME = "22:30";
/** Below this share of the kcal target the day gets the question. */
export const DAY_CLOSE_SHARE = 0.7;

/** Whether a day should get the night question, and how much is missing. */
export function dayCloseGap(day: { kcal: number; entries: number; complete?: boolean | null; incomplete?: boolean | null } | null | undefined, targetKcal: number | null | undefined) {
  // Nothing logged: the person is not using the diary today; marked: already answered.
  if (!day?.entries || day.complete || day.incomplete || !targetKcal) return null;
  if (day.kcal >= targetKcal * DAY_CLOSE_SHARE) return null;
  return Math.round((targetKcal - day.kcal) / 50) * 50;
}

export async function setDayLogStatus(db: Database, personId: string, date: string, status: "complete" | "incomplete" | null) {
  await recomputeDay(db, personId, date);
  await db
    .update(dailySummaries)
    .set({ complete: status === "complete", incomplete: status === "incomplete" })
    .where(and(eq(dailySummaries.personId, personId), eq(dailySummaries.date, date)));
}
