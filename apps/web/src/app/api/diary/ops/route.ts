import { z } from "zod";
import { and, eq, waterLogs } from "@nutria/db";
import { copyMeal, logTemplate, recomputeDay, takeSupplement, untakeSupplement } from "@nutria/core";
import { db } from "@/lib/db";
import { assertAccess, getApiUser } from "@/lib/session";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const base = { personId: z.string().uuid(), clientId: z.string().min(8).max(80) };
const Op = z.discriminatedUnion("op", [
  z.object({ op: z.literal("water"), ...base, date: day, ml: z.number().int().min(-2000).max(3000) }),
  z.object({ op: z.literal("copy"), ...base, fromDate: day, toDate: day, fromSlot: z.string().max(40).optional(), toSlot: z.string().max(40).optional() }),
  z.object({ op: z.literal("supplement"), ...base, scheduleId: z.string().uuid(), date: day, taken: z.boolean() }),
  z.object({ op: z.literal("template"), ...base, templateId: z.string().uuid(), date: day, slot: z.string().min(1).max(40) }),
]);

/**
 * Small diary writes that also work offline (lib/offline-queue.ts replays them): water, copying a
 * meal, supplement doses and one-tap templates. Every op is idempotent by its clientId.
 */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });
  const parsed = Op.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Datos no válidos" }, { status: 400 });
  const v = parsed.data;
  try {
    await assertAccess(user.id, v.personId, "diary", true);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Sin permiso" }, { status: 403 });
  }
  const d = db();
  try {
    switch (v.op) {
      case "water": {
        const [seen] = await d.select({ id: waterLogs.id }).from(waterLogs).where(and(eq(waterLogs.personId, v.personId), eq(waterLogs.clientId, v.clientId))).limit(1);
        if (!seen) {
          await d.insert(waterLogs).values({ personId: v.personId, date: v.date, ml: v.ml, clientId: v.clientId });
          await recomputeDay(d, v.personId, v.date);
        }
        return Response.json({ ok: true, n: seen ? 0 : 1 });
      }
      case "copy": {
        const rows = await copyMeal(d, { personId: v.personId, userId: user.id, fromDate: v.fromDate, toDate: v.toDate, fromSlot: v.fromSlot, toSlot: v.toSlot, clientId: v.clientId });
        return Response.json({ ok: true, n: rows.length });
      }
      case "supplement": {
        if (v.taken) await takeSupplement(d, v.personId, user.id, v.scheduleId, v.date);
        else await untakeSupplement(d, v.personId, v.scheduleId, v.date);
        return Response.json({ ok: true, n: 1 });
      }
      case "template": {
        const r = await logTemplate(d, { personId: v.personId, userId: user.id, templateId: v.templateId, date: v.date, slot: v.slot, clientId: v.clientId });
        return Response.json({ ok: true, n: r.rows.length });
      }
    }
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "No se pudo guardar" }, { status: 422 });
  }
}
