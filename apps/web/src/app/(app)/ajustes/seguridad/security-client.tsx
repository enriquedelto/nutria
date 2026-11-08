"use client";
import { submitForm } from "@/lib/forms";
import { useEffect, useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { useRouter } from "next/navigation";
import { KeyRound, Laptop, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

const err = (e: { message?: string } | null | undefined, fallback: string) => e?.message ?? fallback;

export function ChangePassword() {
  const [pending, start] = useSafeTransition();
  return (
    <form
      className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={submitForm((fd) =>
        start(async () => {
          const { error } = await authClient.changePassword({ currentPassword: String(fd.get("current")), newPassword: String(fd.get("next")), revokeOtherSessions: true });
          if (error) toast.error(err(error, "No se pudo cambiar"));
          else toast.success("Contraseña cambiada. Se han cerrado las demás sesiones.");
        })
      )}
    >
      <Field label="Contraseña actual">
        <Input name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="Nueva (mín. 10)">
        <Input name="next" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <Button type="submit" disabled={pending}>
        Cambiar
      </Button>
    </form>
  );
}

export function TwoFactor({ enabled }: { enabled: boolean }) {
  const [step, setStep] = useState<"idle" | "password" | "verify" | "codes">("idle");
  const [password, setPassword] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [uri, setUri] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [pending, start] = useSafeTransition();
  const router = useRouter();

  const begin = () =>
    start(async () => {
      if (enabled) {
        const { error } = await authClient.twoFactor.disable({ password });
        if (error) return void toast.error(err(error, "Contraseña incorrecta"));
        toast.success("Verificación en dos pasos desactivada");
        setStep("idle");
        router.refresh();
        return;
      }
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error || !data || data.method !== "totp") return void toast.error(err(error, "Contraseña incorrecta"));
      setUri(data.totpURI);
      setCodes(data.backupCodes);
      setQr(await QRCode.toDataURL(data.totpURI, { margin: 1, width: 220 }));
      setStep("verify");
    });

  if (step === "idle")
    return enabled ? (
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 text-sm font-medium text-ok">
          <ShieldCheck className="size-4" /> Activada
        </span>
        <Button size="sm" variant="outline" onClick={() => setStep("password")}>
          Desactivar
        </Button>
      </div>
    ) : (
      <Button onClick={() => setStep("password")}>
        <ShieldCheck /> Activar con app de autenticación
      </Button>
    );

  if (step === "password")
    return (
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          begin();
        }}
      >
        <Field label="Confirma tu contraseña" className="flex-1">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <Button type="submit" disabled={pending}>
          Continuar
        </Button>
        <Button type="button" variant="ghost" onClick={() => setStep("idle")}>
          Cancelar
        </Button>
      </form>
    );

  if (step === "verify")
    return (
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {qr ? <img src={qr} alt="Código QR para la app de autenticación" className="size-48 rounded-xl bg-white p-2" /> : null}
        <form
          className="space-y-2"
          onSubmit={submitForm((fd) =>
            start(async () => {
              const { error } = await authClient.twoFactor.verifyTotp({ code: String(fd.get("code")).replace(/\s/g, "") });
              if (error) return void toast.error(err(error, "Código incorrecto"));
              setStep("codes");
              router.refresh();
            })
          )}
        >
          <p className="text-sm text-ink-2">Escanea el código con Google Authenticator, 1Password, Aegis… y escribe el código de 6 cifras.</p>
          <a href={uri} className="block text-xs text-herb underline">
            Abrir en la app de este dispositivo
          </a>
          <Field label="Código">
            <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required className="num w-40 text-lg tracking-widest" />
          </Field>
          <Button type="submit" disabled={pending}>
            Verificar y activar
          </Button>
        </form>
      </div>
    );

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Guarda estos códigos de recuperación en un lugar seguro. Cada uno sirve una vez si pierdes el móvil.</p>
      <ul className="num grid grid-cols-2 gap-1 rounded-xl bg-paper-2 p-3 font-mono text-sm sm:grid-cols-5">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(codes.join("\n")).then(() => toast.success("Copiados"))}>
          Copiar
        </Button>
        <Button size="sm" onClick={() => setStep("idle")}>
          Hecho
        </Button>
      </div>
    </div>
  );
}

type Pk = { id: string; name?: string | null; createdAt: Date | string; deviceType?: string };

export function Passkeys() {
  const [items, setItems] = useState<Pk[] | null>(null);
  const [pending, start] = useSafeTransition();
  const load = async () => {
    const { data } = await authClient.passkey.listUserPasskeys();
    setItems((data as Pk[] | null) ?? []);
  };
  useEffect(() => {
    void load();
  }, []);
  const supported = typeof window !== "undefined" && "PublicKeyCredential" in window;
  return (
    <div className="space-y-3">
      {items?.length ? (
        <ul className="divide-y divide-line text-sm">
          {items.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-2">
              <KeyRound className="size-4 text-herb" />
              <span className="flex-1">
                {p.name || "Llave de acceso"} <span className="text-ink-3">· {new Date(p.createdAt).toLocaleDateString("es-ES")}</span>
              </span>
              <Button size="icon-sm" variant="ghost" aria-label="Borrar" disabled={pending} onClick={() => start(async () => {
                await authClient.passkey.deletePasskey({ id: p.id });
                await load();
              })}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : items ? (
        <p className="text-sm text-ink-2">Entra con la huella, la cara o el PIN del dispositivo, sin contraseña.</p>
      ) : null}
      <Button
        variant="outline"
        disabled={pending || !supported}
        onClick={() =>
          start(async () => {
            const name = /Android|iPhone|iPad/.test(navigator.userAgent) ? "Móvil" : "Ordenador";
            const res = await authClient.passkey.addPasskey({ name });
            if (res?.error) toast.error(err(res.error, "No se pudo crear"));
            else toast.success("Llave de acceso añadida");
            await load();
          })
        }
      >
        <KeyRound /> Añadir llave de acceso
      </Button>
    </div>
  );
}

type Sess = { id: string; token: string; userAgent?: string | null; ipAddress?: string | null; createdAt: Date | string; updatedAt: Date | string };

export function Sessions({ currentToken }: { currentToken: string | null }) {
  const [items, setItems] = useState<Sess[] | null>(null);
  const [pending, start] = useSafeTransition();
  const load = async () => {
    const { data } = await authClient.listSessions();
    setItems((data as Sess[] | null) ?? []);
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line text-sm">
        {items?.map((s) => {
          const mobile = /Android|iPhone|iPad|Mobile/.test(s.userAgent ?? "");
          const Icon = mobile ? Smartphone : Laptop;
          const browser = /Edg\//.test(s.userAgent ?? "") ? "Edge" : /Chrome\//.test(s.userAgent ?? "") ? "Chrome" : /Firefox\//.test(s.userAgent ?? "") ? "Firefox" : /Safari\//.test(s.userAgent ?? "") ? "Safari" : "Navegador";
          const current = s.token === currentToken;
          return (
            <li key={s.id} className="flex items-center gap-2 py-2">
              <Icon className="size-4 text-ink-3" />
              <span className="flex-1">
                {browser} {mobile ? "en móvil" : ""} {current ? <b className="text-herb">· esta sesión</b> : null}
                <span className="block text-xs text-ink-3">
                  {s.ipAddress ?? "IP desconocida"} · activa {new Date(s.updatedAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </span>
              {!current ? (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => {
                  await authClient.revokeSession({ token: s.token });
                  await load();
                })}>
                  Cerrar
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {items && items.length > 1 ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
          await authClient.revokeOtherSessions();
          await load();
          toast.success("Sesiones cerradas");
        })}>
          Cerrar todas las demás
        </Button>
      ) : null}
    </div>
  );
}
