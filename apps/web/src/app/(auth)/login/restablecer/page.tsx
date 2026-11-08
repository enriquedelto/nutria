"use client";
import { Suspense, useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

function ResetForm() {
  const token = useSearchParams().get("token");
  const router = useRouter();
  const [pending, start] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);
  if (!token) return <p className="text-ink-2">El enlace no es válido o ha caducado.</p>;
  const onSubmit = (fd: FormData) =>
    start(async () => {
      const a = String(fd.get("p1")), b = String(fd.get("p2"));
      if (a !== b) return setError("Las contraseñas no coinciden.");
      const { error } = await authClient.resetPassword({ newPassword: a, token });
      if (error) return setError("El enlace ha caducado. Pide otro.");
      toast.success("Contraseña cambiada. Ya puedes entrar.");
      router.replace("/login");
    });
  return (
    <form action={onSubmit} className="space-y-4">
      <Field label="Nueva contraseña" hint="Mínimo 10 caracteres">
        <Input name="p1" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <Field label="Repite la contraseña">
        <Input name="p2" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>Guardar</Button>
    </form>
  );
}

export default function ResetPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Nueva contraseña</h1>
      <Suspense>
        <ResetForm />
      </Suspense>
    </div>
  );
}
