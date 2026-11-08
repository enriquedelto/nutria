import { z } from "zod";
import { extractLabReport } from "@nutria/ai";
import { labReports } from "@nutria/db";
import { db } from "@/lib/db";
import { json, route } from "@/lib/api";
import { aiCtx, Images, toImages, withAi } from "@/lib/ai";

const Body = z.object({ personId: z.string().uuid(), pdf: z.string().max(14_000_000).optional(), images: Images.optional() });

/** Lab report (PDF or photos) → draft results for review; creates a pending report row. */
export const POST = route(async (req, user) => {
  const b = Body.parse(await req.json());
  if (!b.pdf && !b.images?.length) return json({ error: "Adjunta el PDF o fotos" }, 400);
  const c = await aiCtx(user, b.personId, "labs", req);
  return withAi(async () => {
    const out = await extractLabReport(c, { pdf: b.pdf, images: b.images ? toImages(b.images) : undefined });
    const [r] = await db()
      .insert(labReports)
      .values({ personId: c.personId, date: out.date ?? new Date().toISOString().slice(0, 10), labName: out.labName, status: "pending", aiEstimateId: out.estimateId })
      .returning({ id: labReports.id });
    return json({ reportId: r!.id, ...out });
  });
});
