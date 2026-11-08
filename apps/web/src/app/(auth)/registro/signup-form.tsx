"use client";
import { useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export function SignupForm({ token, email, first, professional }: { token: string | null; email: string; first: boolean; professional: boolean }) {
  const router = useRouter();
  const [pending, start] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (fd: FormData) =>
    start(async () => {
      setError(null);
      const p1 = String(fd.get("password")), p2 = String(fd.get("password2"));
      if (p1 !== p2) return setError("Las contraseñas no coinciden.");
      const { error } = await authClient.signUp.email(
        { name: String(fd.get("name")).trim(), email: String(fd.get("email")).trim(), password: p1 },
        { headers: token ? { "x-nutria-invite": token } : {} },
      );
      if (error) return setError(error.message ?? "No se pudo crear la cuenta.");
      router.replace(professional ? "/familia" : "/bienvenida");
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">{first ? "Primera cuenta" : "Crear cuenta"}</h1>
        <p className="mt-1 text-ink-2">
          {first
            ? "Eres la primera persona: tendrás permisos de administración para invitar al resto de la casa."
            : professional
              ? "Te han invitado como profesional: podrás ver (sin modificar) los datos que te hayan compartido."
              : "Te han invitado a Nutria. Completa tus datos para empezar."}
        </p>
      </div>
      <form action={onSubmit} className="space-y-4">
        <Field label="Nombre">
          <Input name="name" autoComplete="given-name" required maxLength={60} />
        </Field>
        <Field label="Correo" hint={token ? "Debe coincidir con el de la invitación" : undefined}>
          <Input name="email" type="email" autoComplete="email" defaultValue={email} readOnly={!!token} required />
        </Field>
        <Field label="Contraseña" hint="Mínimo 10 caracteres. Después podrás añadir una llave de acceso.">
          <Input name="password" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <Field label="Repite la contraseña">
          <Input name="password2" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null} Crear cuenta
        </Button>
      </form>
    </div>
  );
}
