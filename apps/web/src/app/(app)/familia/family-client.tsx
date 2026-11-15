"use client";
import { submitForm } from "@/lib/forms";
import { errorText } from "@/lib/errors";
import { useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { Copy, MoreHorizontal, Pencil, Plus, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { saveHouseholdPreferences } from "@/actions/ai";
import { addManagedPerson, inviteToGroup, removeMember, renameGroup, revokeInvitation, setMemberRole } from "@/actions/family";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";

const COLORS = ["#22c55e", "#0ea5e9", "#f97316", "#a855f7", "#ef4444", "#eab308", "#14b8a6", "#ec4899"];
const err = (e: unknown) => toast.error(errorText(e, "Algo ha fallado"));

export function RenameGroup({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useSafeTransition();
  return (
    <>
      <Button size="icon-sm" variant="ghost" aria-label="Renombrar hogar" onClick={() => setOpen(true)}>
        <Pencil />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Nombre del hogar">
          <form
            className="space-y-3"
            onSubmit={submitForm((fd) =>
              start(async () => {
                try {
                  await renameGroup(String(fd.get("name")));
                  setOpen(false);
                } catch (e) {
                  err(e);
                }
              })
            )}
          >
            <Input name="name" defaultValue={name} required maxLength={80} />
            <Button type="submit" className="w-full" disabled={pending}>
              Guardar
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {COLORS.map((c) => (
        <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={value === c} onClick={() => onChange(c)} className="size-7 rounded-full ring-offset-2 ring-offset-paper aria-pressed:ring-2 aria-pressed:ring-ink" style={{ background: c }} />
      ))}
    </div>
  );
}

export function AddPerson() {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState(COLORS[1]!);
  const [pending, start] = useSafeTransition();
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus /> Añadir persona sin cuenta
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Nueva persona" description="Para niños u otras personas que no usan la app: tú llevas su diario y sus objetivos.">
          <form
            className="grid grid-cols-2 gap-3"
            onSubmit={submitForm((fd) =>
              start(async () => {
                try {
                  await addManagedPerson({
                    displayName: String(fd.get("name")),
                    isChild: fd.get("child") === "on",
                    sex: (String(fd.get("sex")) || null) as "male" | "female" | null,
                    birthDate: String(fd.get("birth") || "") || null,
                    heightCm: Number(fd.get("height") || 0) || null,
                    avatarColor: color,
                  });
                  toast.success("Persona añadida");
                  setOpen(false);
                } catch (e) {
                  err(e);
                }
              })
            )}
          >
            <Field label="Nombre" className="col-span-2">
              <Input name="name" required maxLength={60} autoFocus />
            </Field>
            <Field label="Fecha de nacimiento">
              <Input name="birth" type="date" />
            </Field>
            <Field label="Sexo">
              <Select name="sex" defaultValue="">
                <option value="">Sin indicar</option>
                <option value="female">Mujer</option>
                <option value="male">Hombre</option>
              </Select>
            </Field>
            <Field label="Altura (cm)">
              <Input name="height" type="number" min={40} max={230} step="any" />
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" name="child" defaultChecked /> Es menor (IR infantiles)
            </label>
            <Field label="Color" className="col-span-2">
              <ColorPicker value={color} onChange={setColor} />
            </Field>
            <Button type="submit" className="col-span-2" disabled={pending}>
              Añadir
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CopyLink({ link }: { link: string }) {
  return (
    <div className="space-y-2 rounded-lg border border-herb/40 bg-herb-soft p-3">
      <p className="text-sm font-medium">Enlace de invitación (solo se muestra ahora)</p>
      <div className="flex gap-2">
        <Input readOnly value={link} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
        <Button
          size="icon"
          variant="outline"
          aria-label="Copiar enlace"
          onClick={async () => {
            try {
              if (navigator.share) await navigator.share({ title: "Invitación a Nutria", url: link });
              else {
                await navigator.clipboard.writeText(link);
                toast.success("Copiado");
              }
            } catch {}
          }}
        >
          <Copy />
        </Button>
      </div>
    </div>
  );
}

export function InviteMember() {
  const [pending, start] = useSafeTransition();
  const [link, setLink] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <form
        className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end"
        onSubmit={submitForm((fd) =>
          start(async () => {
            try {
              const r = await inviteToGroup({ email: String(fd.get("email")), role: String(fd.get("role")) as "member" });
              setLink(r.link);
            } catch (e) {
              err(e);
            }
          })
        )}
      >
        <Field label="Correo" className="col-span-2 sm:col-span-1">
          <Input name="email" type="email" required placeholder="ana@ejemplo.com" />
        </Field>
        <Field label="Rol">
          <Select name="role" defaultValue="member">
            <option value="member">Miembro</option>
            <option value="admin">Admin</option>
          </Select>
        </Field>
        <Button type="submit" disabled={pending}>
          <UserPlus /> Invitar
        </Button>
      </form>
      {link ? <CopyLink link={link} /> : null}
    </div>
  );
}

export function RevokeInvite({ id }: { id: string }) {
  const [pending, start] = useSafeTransition();
  return (
    <Button size="icon-sm" variant="ghost" aria-label="Anular invitación" disabled={pending} onClick={() => start(async () => void (await revokeInvitation(id).catch(err)))}>
      <X />
    </Button>
  );
}

export function MemberActions({ userId, name, role }: { userId: string; name: string; role: "admin" | "member" }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useSafeTransition();
  return (
    <>
      <Button size="icon-sm" variant="ghost" aria-label={`Opciones de ${name}`} onClick={() => setOpen(true)}>
        <MoreHorizontal />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={name} description="Quitar a alguien del hogar no borra su cuenta ni sus datos; solo deja de compartir.">
          <div className="flex flex-col gap-2">
            <Button variant="outline" disabled={pending} onClick={() => start(async () => void (await setMemberRole(userId, role === "admin" ? "member" : "admin").catch(err)))}>
              {role === "admin" ? "Quitar permisos de admin" : "Hacer admin del hogar"}
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  try {
                    await removeMember(userId);
                    setOpen(false);
                  } catch (e) {
                    err(e);
                  }
                })
              }
            >
              Quitar del hogar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function HouseholdPrefs({ groupId, value }: { groupId: string; value: string }) {
  const [v, setV] = useState(value);
  const [pending, start] = useSafeTransition();
  return (
    <div className="space-y-2">
      <Textarea rows={6} value={v} onChange={(e) => setV(e.target.value)} placeholder={"- Cenas ligeras entre semana\n- A Lucía no le gusta el pescado azul\n- Legumbres dos veces por semana"} maxLength={8000} />
      <Button size="sm" disabled={pending || v === value} onClick={() => start(async () => void (await saveHouseholdPreferences(groupId, v).then(() => toast.success("Guardado")).catch(err)))}>
        Guardar
      </Button>
    </div>
  );
}
