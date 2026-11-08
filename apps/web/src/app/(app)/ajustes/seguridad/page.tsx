import { Suspense } from "react";
import { headers } from "next/headers";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { auth } from "@/lib/auth";
import { ChangePassword, Passkeys, Sessions, TwoFactor } from "./security-client";

export const metadata = { title: "Seguridad" };

async function Content() {
  const h = await headers();
  const s = await auth().api.getSession({ headers: h });
  const twoFa = !!(s?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Llaves de acceso (passkeys)" subtitle="La forma más segura y cómoda de entrar" />
        <Passkeys />
      </Card>
      <Card>
        <CardHeader title="Verificación en dos pasos" subtitle="Un código de tu móvil además de la contraseña" />
        <TwoFactor enabled={twoFa} />
      </Card>
      <Card>
        <CardHeader title="Contraseña" />
        <ChangePassword />
      </Card>
      <Card>
        <CardHeader title="Sesiones abiertas" />
        <Sessions currentToken={s?.session.token ?? null} />
      </Card>
    </div>
  );
}

export default function SeguridadPage() {
  return (
    <>
      <PageHeader title="Seguridad" subtitle="Tus datos de salud merecen una buena cerradura" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}
