import { z } from "zod";
import { weightLogs } from "@nutria/db";
import { recomputeTargets } from "@nutria/core";
import { todayIn } from "@nutria/nutrition";
import { db } from "@/lib/db";
import { emit } from "@/lib/events";
import { publicRoute, tokenAuth, tokenPerson } from "@/lib/tokens";

const Body = z.object({
  kg: z.number().min(2).max(400),
  bodyFatPct: z.number().min(2).max(70).nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  personId: z.string().uuid().optional(),
  /** Idempotency key from the sender (e.g. the scale's measurement id). */
  id: z.string().max(100).optional(),
  source: z.string().max(30).optional(),
});

/** Inbound weight from a smart scale, iOS Shortcuts, Home Assistant… (token with "write"). */
export const POST = publicRoute(async (req) => {
  const auth = await tokenAuth(req, "write");
  const b = Body.parse(await req.json());
  const { person } = await tokenPerson(auth, b.personId, "body", true);
  const date = b.date ?? todayIn(person.timezone);
  const source = b.source ?? "webhook";
  const [row] = await db()
    .insert(weightLogs)
    .values({ personId: person.id, date, kg: b.kg, bodyFatPct: b.bodyFatPct ?? null, source, externalId: b.id ?? null, measuredAt: new Date() })
    .onConflictDoNothing()
    .returning({ id: weightLogs.id });
  if (row) {
    await recomputeTargets(db(), person.id).catch(() => undefined);
    void emit(auth.userId, "weight.logged", { personId: person.id, date, kg: b.kg, source });
  }
  return Response.json({ ok: true, duplicated: !row, personId: person.id, date });
});
