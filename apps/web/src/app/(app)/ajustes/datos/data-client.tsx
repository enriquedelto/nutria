"use client";
import { errorText } from "@/lib/errors";
import { useRef, useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { useRouter } from "next/navigation";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";

export function ImportCsv({ personId }: { personId: string }) {
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("personId", personId);
      fd.append("file", f);
      const res = await fetch("/api/import", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Importación en cola. Tardará unos minutos.");
      router.refresh();
    } catch (e) {
      toast.error(errorText(e, "Error"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <>
      <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <FileUp />} Subir CSV
      </Button>
      <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => void upload(e.target.files?.[0])} />
    </>
  );
}

export function DeleteAccount({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useSafeTransition();
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Borrar mi cuenta
      </Button>
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent title="Borrar la cuenta" description="Se borran tu usuario, tu persona y todos sus datos (diario, salud, fotos, IA). Las personas que gestionas y no tienen otro gestor también se borran. No se puede deshacer.">
            <form
              className="space-y-3"
              action={(fd) =>
                start(async () => {
                  if (String(fd.get("confirm")).trim().toLowerCase() !== email.toLowerCase()) return void toast.error("Escribe tu email exacto para confirmar");
                  const { error } = await authClient.deleteUser({ password: String(fd.get("password")) });
                  if (error) return void toast.error(error.message ?? "No se pudo borrar");
                  window.location.assign("/login");
                })
              }
            >
              <Field label={`Escribe ${email}`}>
                <Input name="confirm" autoComplete="off" required />
              </Field>
              <Field label="Contraseña">
                <Input name="password" type="password" autoComplete="current-password" required />
              </Field>
              <Button type="submit" variant="danger" className="w-full" disabled={pending}>
                Borrar definitivamente
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
