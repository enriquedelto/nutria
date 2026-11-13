/**
 * How much a logged day can be trusted. A day logged only in part makes averages, adherence and
 * the adaptive TDEE think the person ate less than they did, so such days are left out.
 */

export type DayLogStatus =
  /** Nothing logged. */
  | "empty"
  /** Marked by the person as fully logged. */
  | "complete"
  /** Marked by the person as logged only in part. */
  | "incomplete"
  /** Not marked and well under the target (< 50 %): probably partial. */
  | "suspect"
  /** Not marked, plausible amount. */
  | "normal";

/** Below this share of the kcal target an unmarked day is treated as probably partial. */
export const SUSPECT_DAY_SHARE = 0.5;

export function dayLogStatus(d: { kcal: number; entries: number; complete?: boolean | null; incomplete?: boolean | null }, targetKcal: number | null | undefined): DayLogStatus {
  if (!d.entries) return "empty";
  if (d.incomplete) return "incomplete";
  if (d.complete) return "complete";
  if (targetKcal && d.kcal < targetKcal * SUSPECT_DAY_SHARE) return "suspect";
  return "normal";
}

/** Days whose intake is trusted for averages (complete or plausible and unmarked). */
export const countsForAverages = (s: DayLogStatus) => s === "complete" || s === "normal";

export const DAY_STATUS_LABEL: Record<DayLogStatus, string> = {
  empty: "sin registro",
  complete: "completo",
  incomplete: "incompleto",
  suspect: "dudoso",
  normal: "normal",
};
