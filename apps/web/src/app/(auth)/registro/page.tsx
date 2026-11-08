import { Suspense } from "react";
import { findInvitation, isFirstUser } from "@nutria/core";
import { db } from "@/lib/db";
import { Skeleton } from "@/components/ui/empty";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Crear cuenta" };

async function Gate({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const first = await isFirstUser(db());
  const inv = token ? await findInvitation(db(), token) : null;
  if (!first && !inv) {
    return (
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold">Solo con invitación</h1>
        <p className="text-ink-2">
          Nutria es privada. Pide a quien administra la casa un enlace de invitación y ábrelo desde aquí.
          {token ? " Este enlace ya se usó o ha caducado." : ""}
        </p>
        <a className="text-herb hover:underline" href="/login">Ya tengo cuenta</a>
      </div>
    );
  }
  return <SignupForm token={inv ? token! : null} email={inv?.email ?? ""} first={first} professional={inv?.accessRole === "professional"} />;
}

export default function SignupPage({ searchParams }: PageProps<"/registro">) {
  return (
    <Suspense fallback={<Skeleton className="h-72" />}>
      <Gate searchParams={searchParams as Promise<{ token?: string }>} />
    </Suspense>
  );
}
