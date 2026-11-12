import "server-only";
import { EventEmitter } from "node:events";

/**
 * In-process pub/sub for realtime views (shopping list). Nutria runs a single web container on
 * the NUC, so this is enough; with several instances, swap for Postgres LISTEN/NOTIFY.
 */
declare global {
   
  var __nutriaBus: EventEmitter | undefined;
}
export const bus = (globalThis.__nutriaBus ??= Object.assign(new EventEmitter(), {}).setMaxListeners(500));

export const publish = (channel: string, payload: Record<string, unknown> = {}) => bus.emit(channel, { ...payload, at: Date.now() });
