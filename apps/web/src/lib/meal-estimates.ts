import "server-only";
import { aiEstimates, and, desc, eq, gte } from "@nutria/db";
import { db } from "@/lib/db";

/** How long an analysed meal waits in «Seguir revisando» before it expires. */
export const PENDING_HOURS = 24;

/** What the review screen had when the person left it: restored as is. */
export type MealReview = {
  rows: Record<string, unknown>[];
  slot: string;
  date: string;
  time: string;
  factor?: number;
};

export type PendingMeal = {
  id: string;
  createdAt: string;
  /** Minutes since it was analysed, when the page was rendered. */
  minutesAgo: number;
  /** The estimate as the API returned it (items, notes, question…). */
  estimate: Record<string, unknown>;
  review: MealReview | null;
  input: { mealSlot: string | null; date: string | null; time: string | null };
};

/** Analysed meals not saved yet (left with «Volver», the app closed, a call…), newest first. */
export async function listPendingMeals(userId: string, personId: string): Promise<PendingMeal[]> {
  const now = Date.now();
  const since = new Date(now - PENDING_HOURS * 3_600_000);
  const rows = await db()
    .select()
    .from(aiEstimates)
    .where(and(eq(aiEstimates.userId, userId), eq(aiEstimates.personId, personId), eq(aiEstimates.kind, "meal"), eq(aiEstimates.status, "pending"), gte(aiEstimates.createdAt, since)))
    .orderBy(desc(aiEstimates.createdAt))
    .limit(5);
  return rows.flatMap((r) => {
    const out = r.output as { items?: unknown[]; mealSlot?: string | null; notes?: string | null; questions?: string[]; answers?: string[]; review?: MealReview };
    if (!out.items?.length) return [];
    const input = r.input as { mealSlot?: string | null; date?: string | null; time?: string | null };
    const { review, ...rest } = out;
    return [
      {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        minutesAgo: Math.max(1, Math.round((now - r.createdAt.getTime()) / 60_000)),
        estimate: { estimateId: r.id, mealSlot: input.mealSlot ?? out.mealSlot ?? null, notes: out.notes ?? null, questions: out.questions ?? [], answers: out.answers ?? [], items: rest.items },
        review: review ?? null,
        input: { mealSlot: input.mealSlot ?? null, date: input.date ?? null, time: input.time ?? null },
      },
    ];
  });
}

async function own(userId: string, id: string) {
  const [e] = await db().select().from(aiEstimates).where(and(eq(aiEstimates.id, id), eq(aiEstimates.userId, userId))).limit(1);
  return e ?? null;
}

/** Keep the review screen's state with the estimate (only while it is pending). */
export async function saveReview(userId: string, id: string, review: MealReview) {
  const e = await own(userId, id);
  if (!e || e.status !== "pending") return false;
  await db().update(aiEstimates).set({ output: { ...(e.output as Record<string, unknown>), review }, updatedAt: new Date() }).where(eq(aiEstimates.id, id));
  return true;
}

export async function discardEstimate(userId: string, id: string) {
  await db().update(aiEstimates).set({ status: "discarded", updatedAt: new Date() }).where(and(eq(aiEstimates.id, id), eq(aiEstimates.userId, userId), eq(aiEstimates.status, "pending")));
}
