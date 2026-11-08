"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { aiEstimates, and, eq, recipeRatings, recipes } from "@nutria/db";
import { cookRecipe, recipeDetail, saveRecipe } from "@nutria/core";
import { structureRecipe, suggestSubstitutions } from "@nutria/ai";
import { extractJsonLdRecipe, fetchPage, pageText } from "@nutria/integrations";
import { todayIn } from "@nutria/nutrition";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { kitchenGuard } from "@/lib/kitchen";
import { assertAccess } from "@/lib/session";

const uuid = z.string().uuid();

const RecipeIn = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullish(),
  servings: z.number().min(0.5).max(100),
  prepMin: z.number().int().min(0).max(1440).nullish(),
  cookMin: z.number().int().min(0).max(2880).nullish(),
  imageUrl: z.string().url().max(1000).nullish(),
  sourceUrl: z.string().url().max(1000).nullish(),
  sourceType: z.enum(["manual", "url", "video", "ai", "import"]).default("manual"),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
  freezable: z.boolean().default(false),
  fridgeDays: z.number().int().min(0).max(30).nullish(),
  totalWeightG: z.number().min(1).max(50000).nullish(),
  ingredients: z.array(z.object({ rawText: z.string().trim().min(1).max(200), foodId: uuid.nullish(), grams: z.number().min(0).max(20000).nullish(), section: z.string().max(60).nullish(), optional: z.boolean().optional() })).min(1).max(80),
  steps: z.array(z.object({ text: z.string().trim().min(1).max(2000), timerSec: z.number().int().min(0).max(86400).nullish() })).max(60),
});
export type RecipeIn = z.input<typeof RecipeIn>;

export async function saveRecipeAction(input: RecipeIn, recipeId?: string, estimateId?: string) {
  const { user, groupId } = await kitchenGuard();
  const r = RecipeIn.parse(input);
  const saved = await saveRecipe(db(), { groupId, userId: user.id, recipe: r, recipeId: recipeId ? uuid.parse(recipeId) : undefined });
  if (estimateId) await db().update(aiEstimates).set({ status: "confirmed", confirmedAt: new Date() }).where(and(eq(aiEstimates.id, uuid.parse(estimateId)), eq(aiEstimates.userId, user.id)));
  refresh();
  return { id: saved.id, missing: saved.missing };
}

export async function deleteRecipe(id: string) {
  const { groupId } = await kitchenGuard();
  await db().delete(recipes).where(and(eq(recipes.id, uuid.parse(id)), eq(recipes.groupId, groupId)));
  refresh();
}

export async function rateRecipe(personId: string, recipeId: string, input: { stars?: number | null; verdict?: "like" | "dislike" | "neutral" | null; notEaten?: boolean; comment?: string | null; planItemId?: string | null }) {
  const { user, groupId } = await kitchenGuard();
  await assertAccess(user.id, uuid.parse(personId), "diary", true);
  const v = z.object({ stars: z.number().int().min(1).max(5).nullish(), verdict: z.enum(["like", "dislike", "neutral"]).nullish(), notEaten: z.boolean().optional(), comment: z.string().max(500).nullish(), planItemId: uuid.nullish() }).parse(input);
  const [r] = await db().select({ id: recipes.id }).from(recipes).where(and(eq(recipes.id, uuid.parse(recipeId)), eq(recipes.groupId, groupId))).limit(1);
  if (!r) throw new Error("Receta no encontrada");
  const [prev] = await db().select({ id: recipeRatings.id }).from(recipeRatings).where(and(eq(recipeRatings.recipeId, r.id), eq(recipeRatings.personId, personId), v.planItemId ? eq(recipeRatings.planItemId, v.planItemId) : eq(recipeRatings.recipeId, r.id))).limit(1);
  const values = { stars: v.stars ?? null, verdict: v.verdict ?? null, notEaten: v.notEaten ?? false, comment: v.comment ?? null, planItemId: v.planItemId ?? null };
  if (prev) await db().update(recipeRatings).set(values).where(eq(recipeRatings.id, prev.id));
  else await db().insert(recipeRatings).values({ recipeId: r.id, personId, ...values });
  refresh();
}

const VIDEO = /(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com\/reel|fb\.watch|vimeo\.com)/i;

export type ImportResult =
  | { kind: "draft"; draft: RecipeIn; estimateId?: string; via: "jsonld" | "ai" }
  | { kind: "pending"; estimateId: string }
  | { kind: "error"; message: string };

/** URL → recipe draft. Web pages: JSON-LD first, AI on the page text otherwise. Videos: background job. */
export async function importRecipe(url: string): Promise<ImportResult> {
  const { user } = await kitchenGuard();
  const u = z.string().url().max(1000).safeParse(url.trim());
  if (!u.success || !/^https?:/.test(u.data)) return { kind: "error", message: "URL no válida" };
  if (VIDEO.test(u.data)) {
    const [e] = await db().insert(aiEstimates).values({ userId: user.id, kind: "recipe", status: "processing", input: { sourceUrl: u.data, sourceType: "video" } }).returning({ id: aiEstimates.id });
    await enqueue("recipe.from-video", { estimateId: e!.id, url: u.data, userId: user.id });
    return { kind: "pending", estimateId: e!.id };
  }
  try {
    const html = await fetchPage(u.data, { flaresolverrUrl: process.env.FLARESOLVERR_URL });
    const ld = extractJsonLdRecipe(html, u.data);
    if (ld && ld.ingredients.length) {
      return {
        kind: "draft",
        via: "jsonld",
        draft: {
          title: ld.title,
          description: ld.description,
          servings: ld.servings ?? 4,
          prepMin: ld.prepMin,
          cookMin: ld.cookMin ?? (ld.totalMin && ld.prepMin ? ld.totalMin - ld.prepMin : ld.totalMin),
          imageUrl: ld.imageUrl,
          sourceUrl: u.data,
          sourceType: "url",
          tags: ld.tags.slice(0, 20),
          ingredients: ld.ingredients.map((rawText) => ({ rawText })),
          steps: ld.steps.map((s) => ({ text: s.text })),
        },
      };
    }
    const r = await structureRecipe({ db: db(), userId: user.id }, { text: pageText(html), sourceUrl: u.data, sourceType: "url" });
    return { kind: "draft", via: "ai", estimateId: r.estimateId, draft: aiToDraft(r, u.data, "url") };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : "No se pudo importar" };
  }
}

/** Paste free text (or a dictated recipe) → structured draft. */
export async function recipeFromText(text: string): Promise<ImportResult> {
  const { user } = await kitchenGuard();
  const t = z.string().trim().min(20).max(30000).parse(text);
  try {
    const r = await structureRecipe({ db: db(), userId: user.id }, { text: t, sourceType: "text" });
    return { kind: "draft", via: "ai", estimateId: r.estimateId, draft: aiToDraft(r, null, "ai") };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : "Error de la IA" };
  }
}

/** Poll a background video import. */
export async function videoImportStatus(estimateId: string): Promise<ImportResult> {
  const { user } = await kitchenGuard();
  const [e] = await db().select().from(aiEstimates).where(and(eq(aiEstimates.id, uuid.parse(estimateId)), eq(aiEstimates.userId, user.id))).limit(1);
  if (!e) return { kind: "error", message: "No encontrado" };
  if (e.status === "failed") return { kind: "error", message: e.error ?? "No se pudo procesar el vídeo" };
  if (e.status === "processing" || !e.output.title) return { kind: "pending", estimateId };
  return { kind: "draft", via: "ai", estimateId, draft: aiToDraft(e.output as never, (e.output.sourceUrl as string) ?? null, "video") };
}

type AiRecipe = { title: string; description: string | null; servings: number | null; prepMin: number | null; cookMin: number | null; ingredients: string[]; steps: { text: string; timerMin?: number | null }[]; tags: string[]; imageUrl?: string | null };
function aiToDraft(r: AiRecipe, sourceUrl: string | null, sourceType: "url" | "video" | "ai"): RecipeIn {
  return {
    title: r.title,
    description: r.description,
    servings: r.servings ?? 4,
    prepMin: r.prepMin != null ? Math.round(r.prepMin) : null,
    cookMin: r.cookMin != null ? Math.round(r.cookMin) : null,
    imageUrl: r.imageUrl ?? null,
    sourceUrl,
    sourceType,
    tags: r.tags.slice(0, 20),
    ingredients: r.ingredients.map((rawText) => ({ rawText })),
    steps: r.steps.map((s) => ({ text: s.text, timerSec: s.timerMin ? Math.round(s.timerMin * 60) : null })),
  };
}

export async function substitutionsFor(personId: string, recipeId: string, reason: string) {
  const { user, groupId } = await kitchenGuard();
  const access = await assertAccess(user.id, uuid.parse(personId), "diary");
  if (!access.scopes.has("ai")) throw new Error("Sin permiso de IA");
  const d = await recipeDetail(db(), uuid.parse(recipeId), groupId);
  if (!d) throw new Error("Receta no encontrada");
  return suggestSubstitutions({ db: db(), userId: user.id, personId, scopes: access.scopes }, { recipeTitle: d.recipe.title, ingredients: d.ingredients.map((i) => i.rawText), reason: z.string().trim().min(2).max(300).parse(reason) });
}

export async function cookAction(input: { recipeId: string; servings: number; batchPortions?: number; location?: string; planItemId?: string | null; timezone: string }) {
  const { groupId } = await kitchenGuard();
  const v = z.object({ recipeId: uuid, servings: z.number().min(0.25).max(100), batchPortions: z.number().int().min(0).max(100).optional(), location: z.enum(["nevera", "congelador"]).optional(), planItemId: uuid.nullish(), timezone: z.string().max(60) }).parse(input);
  const r = await cookRecipe(db(), { groupId, recipeId: v.recipeId, servings: v.servings, batchPortions: v.batchPortions, location: v.location, planItemId: v.planItemId, today: todayIn(v.timezone) });
  refresh();
  return r;
}
