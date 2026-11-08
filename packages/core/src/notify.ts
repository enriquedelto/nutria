/** In-app notifications + Web Push (VAPID) + outgoing webhooks. */
import webpush from "web-push";
import { and, eq, inArray, notificationPrefs, notifications, pushSubscriptions, sql, webhooks, type Database } from "@nutria/db";
import { decrypt, hmacSha256 } from "@nutria/integrations";

let vapidReady: boolean | null = null;
function ensureVapid() {
  if (vapidReady != null) return vapidReady;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return (vapidReady = false);
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:admin@localhost", pub, priv);
  return (vapidReady = true);
}

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body?: string;
  url?: string;
  /** Collapse key: a newer notification with the same tag replaces the previous one on the device. */
  tag?: string;
  /** Skip the push if the user is in quiet hours (in-app notification is still stored). */
  respectQuietHours?: boolean;
  timezone?: string;
}

function inQuietHours(range: unknown, timezone: string, now = new Date()): boolean {
  if (!Array.isArray(range) || range.length !== 2) return false;
  const hm = now.toLocaleTimeString("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false });
  const [from, to] = range as [string, string];
  return from <= to ? hm >= from && hm < to : hm >= from || hm < to;
}

/** Stores the notification and pushes it to every subscription of the user (if enabled). */
export async function notify(db: Database, n: NotifyInput): Promise<{ stored: boolean; pushed: number }> {
  const prefs = await db.select().from(notificationPrefs).where(and(eq(notificationPrefs.userId, n.userId), inArray(notificationPrefs.type, [n.type, "quiet_hours"])));
  const pref = prefs.find((p) => p.type === n.type);
  const quiet = prefs.find((p) => p.type === "quiet_hours" && p.enabled);
  if (pref && !pref.enabled) return { stored: false, pushed: 0 };
  await db.insert(notifications).values({ userId: n.userId, type: n.type, title: n.title, body: n.body ?? "", url: n.url ?? null });
  if (n.respectQuietHours !== false && inQuietHours(pref?.config.quietHours ?? quiet?.config.quietHours, n.timezone ?? "Europe/Madrid")) return { stored: true, pushed: 0 };
  if (!ensureVapid()) return { stored: true, pushed: 0 };
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, n.userId));
  const payload = JSON.stringify({ title: n.title, body: n.body ?? "", url: n.url ?? "/", tag: n.tag ?? n.type });
  const dead: string[] = [];
  let pushed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: n.type === "medication" ? "high" : "normal" });
        pushed++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(s.id);
      }
    }),
  );
  if (dead.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, dead));
  return { stored: true, pushed };
}

/** Outgoing webhook events (Home Assistant & co). */
export const WEBHOOK_EVENTS = ["diary.entry_created", "weight.logged", "goal.reached", "pantry.expiring", "plan.ready", "report.weekly", "achievement.unlocked"] as const;

export async function webhooksFor(db: Database, userId: string, event: string) {
  return db.select({ id: webhooks.id }).from(webhooks).where(and(eq(webhooks.userId, userId), eq(webhooks.enabled, true), sql`${event} = any(${webhooks.events})`));
}

/** Deliver one webhook (signed `X-Nutria-Signature: sha256=<hmac>`). Returns HTTP status. */
export async function deliverWebhook(db: Database, webhookId: string, event: string, payload: Record<string, unknown>, f: typeof fetch = fetch): Promise<number> {
  const [w] = await db.select().from(webhooks).where(eq(webhooks.id, webhookId)).limit(1);
  if (!w || !w.enabled) return 0;
  const body = JSON.stringify({ event, at: new Date().toISOString(), data: payload });
  let status = 0;
  try {
    const r = await f(w.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Nutria-Webhooks/1", "X-Nutria-Event": event, "X-Nutria-Signature": `sha256=${hmacSha256(decrypt(w.secretEnc), body)}` },
      body,
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
    });
    status = r.status;
  } catch {
    status = 0;
  }
  await db.update(webhooks).set({ lastStatus: status, lastDeliveryAt: new Date() }).where(eq(webhooks.id, w.id));
  return status;
}
