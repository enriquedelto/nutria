"use client";
import { useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export default function TwoFactorPage() {
  const router = useRouter();
  const [pending, start] = useSafeTransition();
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (fd: FormData) =>
    start(async () => {
      const code = String(fd.get("code") ?? "").replace(/\s/g, "");
      const trustDevice = fd.get("trust") === "on";
      const res = backup ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice }) : await authClient.twoFactor.verifyTotp({ code, trustDevice });
      if (res.error) return setError("Código incorrecto.");
      router.replace("/hoy");
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Verificación en dos pasos</h1>
      <p className="text-ink-2">{backup ? "Escribe uno de tus códigos de respaldo." : "Escribe el código de 6 dígitos de tu app de autenticación."}</p>
      <form action={onSubmit} className="space-y-4">
        <Field label="Código">
          <Input name="code" inputMode={backup ? "text" : "numeric"} autoComplete="one-time-code" required autoFocus maxLength={backup ? 20 : 6} className="num text-center text-2xl tracking-[0.4em]" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" name="trust" className="size-4 accent-[var(--herb)]" /> Confiar en este dispositivo 30 días
        </label>
        {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
        <Button type="submit" size="lg" className="w-full" disabled={pending}>Verificar</Button>
      </form>
      <button type="button" className="text-sm text-herb hover:underline" onClick={() => setBackup((b) => !b)}>
        {backup ? "Usar la app de autenticación" : "Usar un código de respaldo"}
      </button>
    </div>
  );
}
