import "server-only";
import { webhooksFor } from "@nutria/core";
import { db } from "./db";
import { enqueue } from "./jobs";

/** Fan out an app event to the user's outgoing webhooks (delivered by the worker with retries). */
export async function emit(userId: string, event: string, payload: Record<string, unknown>) {
  try {
    const hooks = await webhooksFor(db(), userId, event);
    await Promise.all(hooks.map((h) => enqueue("webhook.deliver", { webhookId: h.id, event, payload })));
  } catch (e) {
    console.error(JSON.stringify({ svc: "web", msg: "emit failed", event, error: e instanceof Error ? e.message : String(e) }));
  }
}
