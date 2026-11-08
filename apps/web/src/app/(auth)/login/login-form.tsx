"use client";
import { useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/hoy");

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [pending, start] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);

  const onSubmit = (fd: FormData) =>
    start(async () => {
      setError(null);
      const email = String(fd.get("email") ?? "");
      if (forgot) {
        await authClient.requestPasswordReset({ email, redirectTo: "/login/restablecer" });
        toast.success("Si el correo existe, el administrador recibirá el enlace para restablecerla.");
        setForgot(false);
        return;
      }
      const { error } = await authClient.signIn.email({ email, password: String(fd.get("password") ?? ""), rememberMe: true });
      if (error) return setError(error.status === 429 ? "Demasiados intentos. Espera un minuto." : "Correo o contraseña incorrectos.");
      router.replace(next);
      router.refresh();
    });

  const withPasskey = () =>
    start(async () => {
      setError(null);
      const res = await authClient.signIn.passkey();
      if (res?.error) return setError("No se pudo usar la llave de acceso.");
      router.replace(next);
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">{forgot ? "Recuperar acceso" : "Entrar"}</h1>
      <form action={onSubmit} className="space-y-4">
        <Field label="Correo">
          <Input name="email" type="email" autoComplete="username webauthn" required autoFocus />
        </Field>
        {!forgot && (
          <Field label="Contraseña">
            <Input name="password" type="password" autoComplete="current-password" required minLength={8} />
          </Field>
        )}
        {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {forgot ? "Enviar enlace" : "Entrar"}
        </Button>
      </form>
      {!forgot && (
        <Button variant="outline" size="lg" className="w-full" onClick={withPasskey} disabled={pending}>
          <KeyRound /> Entrar con llave de acceso
        </Button>
      )}
      <div className="flex justify-between text-sm">
        <button type="button" className="text-herb hover:underline" onClick={() => setForgot((f) => !f)}>
          {forgot ? "Volver" : "¿Olvidaste la contraseña?"}
        </button>
        <a href="/registro" className="text-ink-2 hover:underline">Tengo una invitación</a>
      </div>
    </div>
  );
}
