import { z } from "zod";
import { readLabel } from "@nutria/ai";
import { json, route } from "@/lib/api";
import { aiCtx, Images, toImages, withAi } from "@/lib/ai";

const Body = z.object({ personId: z.string().uuid(), images: Images.min(1) });

/** Nutrition label photo → per-100 g values to prefill a custom food. */
export const POST = route(async (req, user) => {
  const b = Body.parse(await req.json());
  const c = await aiCtx(user, b.personId, "diary", req);
  return withAi(async () => json(await readLabel(c, toImages(b.images))));
});
