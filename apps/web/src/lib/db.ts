import "server-only";
import { getDb, type Database } from "@nutria/db";

/** Shared Postgres handle (lazy: build-time imports never connect). */
export const db = (): Database => getDb();
