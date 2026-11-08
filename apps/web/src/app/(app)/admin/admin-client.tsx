"use client";
import { errorText } from "@/lib/errors";
import { useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { KeyRound, Loader2, Play, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { inviteNewHousehold, resetLinkFor, runJobNow, setUserRole, type RunnableJob } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { CopyLink } from "../familia/family-client";

const err = (e: unknown) => toast.error(errorText(e, "Algo ha fallado"));

export function RoleToggle({ userId, role }: { userId: string; role: "admin" | "member" }) {
  const [pending, start] = useSafeTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => void (await setUserRole(userId, role === "admin" ? "member" : "admin").catch(err)))}>
      {role === "admin" ? "Quitar admin" : "Hacer admin"}
    </Button>
  );
}

export function ResetLink({ userId }: { userId: string }) {
  const [pending, start] = useSafeTransition();
  const [link, setLink] = useState<string | null>(null);
  return (
    <>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Enlace para restablecer contraseña"
        title="Enlace para restablecer contraseña"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              setLink(await resetLinkFor(userId));
            } catch (e) {
              err(e);
            }
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
      </Button>
      <Dialog open={!!link} onOpenChange={(o) => !o && setLink(null)}>
        <DialogContent title="Restablecer contraseña" description="Pásale este enlace por un canal de confianza. Caduca en una hora.">
          {link ? <CopyLink link={link} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function InviteHousehold() {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useSafeTransition();
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus /> Nuevo hogar
      </Button>
      <Dialog open={open} onOpenChange={(o) => (setOpen(o), o || setLink(null))}>
        <DialogContent title="Invitar a otro hogar" description="La persona invitada tendrá su propio hogar, separado del tuyo (amigos, otra familia).">
          {link ? (
            <CopyLink link={link} />
          ) : (
            <form
              className="space-y-3"
              action={(fd) =>
                start(async () => {
                  try {
                    setLink(await inviteNewHousehold(String(fd.get("email"))));
                  } catch (e) {
                    err(e);
                  }
                })
              }
            >
              <Field label="Correo">
                <Input name="email" type="email" required />
              </Field>
              <Button type="submit" className="w-full" disabled={pending}>
                Crear invitación
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RunJob({ job, label }: { job: RunnableJob; label: string }) {
  const [pending, start] = useSafeTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            await runJobNow(job);
            toast.success("En cola");
          } catch (e) {
            err(e);
          }
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Play />} {label}
    </Button>
  );
}
