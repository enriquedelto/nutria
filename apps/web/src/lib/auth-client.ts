"use client";
import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({ onTwoFactorRedirect: () => window.location.assign("/login/2fa") }),
    passkeyClient(),
  ],
});
