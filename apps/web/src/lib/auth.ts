import "server-only";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins/two-factor";
import { passkey } from "@better-auth/passkey";
import { count, schema } from "@nutria/db";
import { audit, deleteOrphanedManagedPersons, findInvitation, isFirstUser, onUserCreated } from "@nutria/core";
import { db } from "./db";

export const INVITE_HEADER = "x-nutria-invite";

type HookCtx = { headers?: Headers; request?: Request } | null | undefined;
const inviteToken = (ctx: HookCtx) => ctx?.headers?.get(INVITE_HEADER) ?? ctx?.request?.headers.get(INVITE_HEADER) ?? null;

function createAuth() {
  const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const rpID = new URL(baseURL).hostname;
  return betterAuth({
    appName: "Nutria",
    baseURL,
    database: drizzleAdapter(db(), {
      provider: "pg",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification, twoFactor: schema.twoFactor, passkey: schema.passkey },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      // Without SMTP the reset link is left in the audit log for an admin to relay.
      sendResetPassword: async ({ user, url }) => {
        await audit(db(), { userId: user.id, action: "password_reset_requested", resource: "user", resourceId: user.id, meta: { url } });
      },
    },
    user: {
      additionalFields: {
        role: { type: "string", input: false, defaultValue: "member" },
        locale: { type: "string", input: false, defaultValue: "es" },
      },
      deleteUser: {
        enabled: true,
        beforeDelete: async (u) => {
          const removed = await deleteOrphanedManagedPersons(db(), u.id);
          await audit(db(), { userId: null, action: "user.delete", resource: "user", resourceId: u.id, meta: { removedPersons: removed.length } });
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 8 },
        "/sign-up/email": { window: 60, max: 5 },
        "/two-factor/verify-totp": { window: 60, max: 6 },
        "/request-password-reset": { window: 300, max: 3 },
      },
    },
    advanced: {
      useSecureCookies: baseURL.startsWith("https://"),
      ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
    },
    trustedOrigins: [baseURL],
    databaseHooks: {
      user: {
        create: {
          // Closed registration: the first account bootstraps the instance; the rest need an invitation for that email.
          before: async (u, ctx) => {
            if (await isFirstUser(db())) {
              // With ADMIN_EMAIL set, only that address can bootstrap the instance (safe to publish early).
              const admin = process.env.ADMIN_EMAIL?.trim().toLowerCase();
              if (admin && u.email.trim().toLowerCase() !== admin) throw new APIError("FORBIDDEN", { message: "Este registro está reservado para la administración." });
              return;
            }
            const token = inviteToken(ctx);
            const inv = token ? await findInvitation(db(), token, u.email) : null;
            if (!inv) throw new APIError("FORBIDDEN", { message: "Necesitas una invitación válida para este correo." });
          },
          after: async (u, ctx) => {
            const token = inviteToken(ctx);
            const inv = token ? await findInvitation(db(), token, u.email) : null;
            const [c] = await db().select({ n: count() }).from(schema.user);
            await onUserCreated(db(), { id: u.id, name: u.name, email: u.email }, inv, { firstUser: !inv && (c?.n ?? 0) === 1 });
          },
        },
      },
    },
    plugins: [
      twoFactor({ issuer: "Nutria", backupCodeOptions: { amount: 10 } }),
      passkey({ rpID, rpName: "Nutria", origin: baseURL }),
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
declare global {
  // eslint-disable-next-line no-var
  var __nutriaAuth: Auth | undefined;
}

/** Lazy so `next build` never needs DATABASE_URL. */
export function auth(): Auth {
  globalThis.__nutriaAuth ??= createAuth();
  return globalThis.__nutriaAuth;
}

export type Session = Auth["$Infer"]["Session"];
