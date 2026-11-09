"use server";
import { UserError } from "@/lib/errors";
import { refresh } from "next/cache";
import { z } from "zod";
import {
  and,
  apiTokens,
  eq,
  integrationAccounts,
  isNull,
  mealSlots,
  notificationPrefs,
  NOTIFICATION_TYPES,
  persons,
  pushSubscriptions,
  webhooks,
  weightLogs,
} from "@nutria/db";
import { todayIn } from "@nutria/nutrition";
import { audit, latestWeight, missingProfileFields, notify, pairOpenGym, recomputeTargets, syncOpenGym, WEBHOOK_EVENTS } from "@nutria/core";
import { encrypt, newToken } from "@nutria/integrations";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { assertAccess, getApiUser } from "@/lib/session";

const uuid = z.string().uuid();
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

async function me() {
  const u = await getApiUser();
  if (!u) throw new UserError("No autenticado");
  return u;
}
/** Profile edits need owner/manager on that person. */
async function manage(personId: string) {
  const u = await me();
  const a = await assertAccess(u.id, uuid.parse(personId), "diary", true);
  if (a.role !== "owner" && a.role !== "manager") throw new UserError("Solo quien gestiona a esta persona puede cambiar su perfil");
  return u;
}

/* ------------------------------- profile ------------------------------- */

const Profile = z.object({
  displayName: z.string().trim().min(1).max(40),
  avatarColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  sex: z.enum(["female", "male"]).nullable(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  heightCm: z.number().min(40).max(250).nullable(),
  /** Current weight: logged as today's weigh-in when it changes (the formulas use the latest one). */
  weightKg: z.number().min(2).max(400).nullable().optional(),
  activityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]),
  goalType: z.enum(["lose", "maintain", "gain"]),
  weeklyRateKg: z.number().min(-1.5).max(1),
  pregnancy: z.enum(["trimester1", "trimester2", "trimester3", "lactation"]).nullable(),
  dietPattern: z.string().max(30).nullable(),
  allergens: z.array(z.string().max(30)).max(20),
  dislikes: z.array(z.string().trim().min(1).max(40)).max(50),
  preferencesMd: z.string().max(4000),
  timezone: z.string().max(60),
});

export async function updateProfile(personId: string, input: z.input<typeof Profile>) {
  await manage(personId);
  const v = Profile.parse(input);
  try {
    new Intl.DateTimeFormat("es", { timeZone: v.timezone });
  } catch {
    throw new UserError("Zona horaria no válida");
  }
  // Losing/gaining with rate 0 makes no sense; maintain forces 0.
  const weeklyRateKg = v.goalType === "maintain" ? 0 : v.goalType === "lose" ? -Math.abs(v.weeklyRateKg || 0.5) : Math.abs(v.weeklyRateKg || 0.25);
  const { weightKg, ...fields } = v;
  await db().update(persons).set({ ...fields, weeklyRateKg }).where(eq(persons.id, personId));
  if (weightKg != null) {
    const last = await latestWeight(db(), personId);
    if (!last || Math.abs(last.kg - weightKg) >= 0.05) await db().insert(weightLogs).values({ personId, date: todayIn(v.timezone), kg: weightKg, source: "manual", measuredAt: new Date() });
  }
  await recomputeTargets(db(), personId).catch(() => undefined);
  refresh();
  return { missing: await missingProfileFields(db(), personId) };
}

const Settings = z.object({
  homeCards: z.array(z.string().max(30)).max(20).optional(),
  trackedMicros: z.array(z.string().max(30)).max(30).optional(),
  units: z.enum(["metric", "imperial"]).optional(),
  energyUnit: z.enum(["kcal", "kj"]).optional(),
  waterGoalMl: z.number().int().min(500).max(8000).optional(),
  enabledModules: z.array(z.string().max(30)).max(30).optional(),
  mealReminders: z.boolean().optional(),
});

export async function updatePersonSettings(personId: string, patch: z.input<typeof Settings>) {
  await manage(personId);
  const v = Settings.parse(patch);
  const [p] = await db().select({ settings: persons.settings }).from(persons).where(eq(persons.id, personId)).limit(1);
  await db().update(persons).set({ settings: { ...(p?.settings ?? {}), ...v } }).where(eq(persons.id, personId));
  refresh();
}

/* ------------------------------ meal slots ------------------------------ */

const Slot = z.object({ id: uuid.optional(), key: z.string().regex(/^[a-z0-9_]{1,30}$/), label: z.string().trim().min(1).max(30), defaultTime: hhmm.nullable(), kcalShare: z.number().min(0).max(1).nullable() });

export async function saveMealSlots(personId: string, slots: z.input<typeof Slot>[]) {
  await manage(personId);
  const v = z.array(Slot).min(1).max(10).parse(slots);
  if (new Set(v.map((s) => s.key)).size !== v.length) throw new UserError("Hay comidas repetidas");
  await db().transaction(async (tx) => {
    const existing = await tx.select({ id: mealSlots.id, key: mealSlots.key }).from(mealSlots).where(eq(mealSlots.personId, personId));
    const keep = new Set(v.map((s) => s.key));
    for (const e of existing) if (!keep.has(e.key)) await tx.delete(mealSlots).where(eq(mealSlots.id, e.id));
    for (const [i, s] of v.entries())
      await tx
        .insert(mealSlots)
        .values({ personId, key: s.key, label: s.label, defaultTime: s.defaultTime, kcalShare: s.kcalShare, sortOrder: i })
        .onConflictDoUpdate({ target: [mealSlots.personId, mealSlots.key], set: { label: s.label, defaultTime: s.defaultTime, kcalShare: s.kcalShare, sortOrder: i } });
  });
  refresh();
}

/* ---------------------------- notifications ---------------------------- */

export async function savePushSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string) {
  const u = await me();
  const v = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }).parse(sub);
  await db()
    .insert(pushSubscriptions)
    .values({ userId: u.id, endpoint: v.endpoint, p256dh: v.keys.p256dh, auth: v.keys.auth, userAgent: userAgent?.slice(0, 200) ?? null })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: u.id, p256dh: v.keys.p256dh, auth: v.keys.auth } });
  refresh();
}

export async function removePushSubscription(endpoint: string) {
  const u = await me();
  await db().delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, u.id), eq(pushSubscriptions.endpoint, endpoint)));
  refresh();
}

export async function sendTestPush() {
  const u = await me();
  return notify(db(), { userId: u.id, type: "test", title: "Nutria", body: "¡Las notificaciones funcionan! 🦦", url: "/hoy" });
}

const Pref = z.object({
  enabled: z.boolean(),
  config: z.object({ times: z.array(hhmm).max(8).optional(), quietHours: z.tuple([hhmm, hhmm]).optional(), intervalMin: z.number().int().min(30).max(480).optional(), daysOfWeek: z.array(z.number().int().min(1).max(7)).optional() }).default({}),
});

export async function saveNotificationPref(type: string, input: z.input<typeof Pref>) {
  const u = await me();
  z.enum(NOTIFICATION_TYPES).parse(type);
  const v = Pref.parse(input);
  await db()
    .insert(notificationPrefs)
    .values({ userId: u.id, type, enabled: v.enabled, config: v.config })
    .onConflictDoUpdate({ target: [notificationPrefs.userId, notificationPrefs.type], set: { enabled: v.enabled, config: v.config } });
  refresh();
}

/* ------------------------------ API tokens ------------------------------ */

/** Returns the clear token ONCE; only its hash is stored. */
export async function createApiToken(input: { name: string; scopes: string[]; expiresDays?: number | null }) {
  const u = await me();
  const v = z.object({ name: z.string().trim().min(1).max(40), scopes: z.array(z.enum(["read", "write", "destroy"])).min(1), expiresDays: z.number().int().min(1).max(3650).nullish() }).parse(input);
  const t = newToken("ntr");
  await db()
    .insert(apiTokens)
    .values({ userId: u.id, name: v.name, tokenHash: t.hash, prefix: t.prefix, scopes: v.scopes, expiresAt: v.expiresDays ? new Date(Date.now() + v.expiresDays * 86_400_000) : null });
  await audit(db(), { userId: u.id, action: "token.create", resource: "api_token", meta: { name: v.name, scopes: v.scopes } });
  refresh();
  return t.token;
}

export async function revokeApiToken(id: string) {
  const u = await me();
  await db().update(apiTokens).set({ revokedAt: new Date() }).where(and(eq(apiTokens.id, uuid.parse(id)), eq(apiTokens.userId, u.id), isNull(apiTokens.revokedAt)));
  await audit(db(), { userId: u.id, action: "token.revoke", resource: "api_token", resourceId: id });
  refresh();
}

/* ------------------------------- webhooks ------------------------------- */

export async function createWebhook(input: { url: string; events: string[] }) {
  const u = await me();
  const v = z.object({ url: z.string().url().max(500).refine((s) => /^https?:\/\//.test(s)), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1) }).parse(input);
  const secret = newToken("whs").token;
  await db().insert(webhooks).values({ userId: u.id, url: v.url, events: v.events, secretEnc: encrypt(secret) });
  refresh();
  return secret;
}

export async function setWebhookEnabled(id: string, enabled: boolean) {
  const u = await me();
  await db().update(webhooks).set({ enabled }).where(and(eq(webhooks.id, uuid.parse(id)), eq(webhooks.userId, u.id)));
  refresh();
}

export async function deleteWebhook(id: string) {
  const u = await me();
  await db().delete(webhooks).where(and(eq(webhooks.id, uuid.parse(id)), eq(webhooks.userId, u.id)));
  refresh();
}

export async function testWebhook(id: string) {
  const u = await me();
  const [w] = await db().select({ id: webhooks.id }).from(webhooks).where(and(eq(webhooks.id, uuid.parse(id)), eq(webhooks.userId, u.id))).limit(1);
  if (!w) throw new UserError("No encontrado");
  await enqueue("webhook.deliver", { webhookId: w.id, event: "test", payload: { hello: "nutria", at: new Date().toISOString() } });
}

/* ----------------------------- integrations ----------------------------- */

export async function connectOpenGym(personId: string, baseUrl: string, code: string) {
  const u = await manage(personId);
  const url = z.string().url().max(300).parse(baseUrl.trim());
  const c = z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6,12}$/, "El código son 8 letras y números (openGym → Ajustes → Emparejar la app móvil)")
    .parse(code);
  const existing = await db().select({ id: integrationAccounts.id }).from(integrationAccounts).where(and(eq(integrationAccounts.userId, u.id), eq(integrationAccounts.provider, "opengym"), eq(integrationAccounts.personId, personId)));
  if (existing.length) await db().delete(integrationAccounts).where(eq(integrationAccounts.id, existing[0]!.id));
  const acc = await pairOpenGym(db(), { userId: u.id, personId, baseUrl: url, code: c }).catch((e: unknown) => {
    // The openGym client's messages are meant for people ("código no válido…"); network errors are not.
    const m = e instanceof Error ? e.message : "";
    throw new UserError(/código|openGym/i.test(m) ? m : "No se pudo conectar con openGym en esa dirección");
  });
  // First import right away so the user sees the result; if it is slow or fails, the worker retries.
  const r = await syncOpenGym(db(), acc.id, undefined, { force: true }).catch(async () => {
    await enqueue("opengym.sync", { accountId: acc.id, force: true });
    return null;
  });
  refresh();
  return r ? { exercises: r.exercises, weights: r.weights } : null;
}

export async function syncIntegration(id: string) {
  const u = await me();
  const [a] = await db().select().from(integrationAccounts).where(and(eq(integrationAccounts.id, uuid.parse(id)), eq(integrationAccounts.userId, u.id))).limit(1);
  if (!a) throw new UserError("No encontrado");
  if (a.provider !== "opengym") return null;
  // Run it here (not queued) so the button answers with what changed.
  const r = await syncOpenGym(db(), a.id, undefined, { force: true }).catch((e: unknown) => {
    throw new UserError(e instanceof Error && /openGym|caducado/.test(e.message) ? e.message : "No se pudo conectar con openGym");
  });
  refresh();
  return r;
}

export async function disconnectIntegration(id: string) {
  const u = await me();
  await db().delete(integrationAccounts).where(and(eq(integrationAccounts.id, uuid.parse(id)), eq(integrationAccounts.userId, u.id)));
  refresh();
}

export async function deleteCustomReminder(type: string) {
  const u = await me();
  if (!/^custom:[0-9a-f-]{36}$/.test(type)) throw new UserError("Tipo no válido");
  await db().delete(notificationPrefs).where(and(eq(notificationPrefs.userId, u.id), eq(notificationPrefs.type, type)));
  refresh();
}
