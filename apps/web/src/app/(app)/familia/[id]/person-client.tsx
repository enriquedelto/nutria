"use client";
import { errorText } from "@/lib/errors";
import { useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Pencil, Share2, Stethoscope, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { addProfessionalNote, deleteManagedPerson, deleteProfessionalNote, grantAccess, inviteProfessional, revokeAccess, updatePersonBasics } from "@/actions/family";
import { switchPerson } from "@/actions/person";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { ColorPicker, CopyLink } from "../family-client";

const err = (e: unknown) => toast.error(errorText(e, "Algo ha fallado"));
const ROLE: Record<string, string> = { owner: "propietaria", manager: "gestiona", viewer: "solo ver", professional: "profesional" };

export function SwitchTo({ personId }: { personId: string }) {
  const [pending, start] = useSafeTransition();
  const router = useRouter();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await switchPerson(personId);
          router.push("/hoy");
        })
      }
    >
      <ArrowRightLeft /> Ver su día
    </Button>
  );
}

export function EditBasics({ personId, name, color }: { personId: string; name: string; color: string }) {
  const [open, setOpen] = useState(false);
  const [c, setC] = useState(color);
  const [pending, start] = useSafeTransition();
  return (
    <>
      <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setOpen(true)}>
        <Pencil />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Nombre y color">
          <form
            className="space-y-3"
            action={(fd) =>
              start(async () => {
                try {
                  await updatePersonBasics(personId, { displayName: String(fd.get("name")), avatarColor: c });
                  setOpen(false);
                } catch (e) {
                  err(e);
                }
              })
            }
          >
            <Input name="name" defaultValue={name} required maxLength={60} />
            <ColorPicker value={c} onChange={setC} />
            <Button type="submit" className="w-full" disabled={pending}>
              Guardar
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeletePerson({ personId, name }: { personId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  const [pending, start] = useSafeTransition();
  const router = useRouter();
  return (
    <>
      <Button size="sm" variant="ghost" className="text-danger" onClick={() => setOpen(true)}>
        <Trash2 /> Borrar
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`Borrar a ${name}`} description="Se borran su diario, peso, salud y todo lo demás. No se puede deshacer.">
          <Field label={`Escribe «${name}» para confirmar`}>
            <Input value={v} onChange={(e) => setV(e.target.value)} autoComplete="off" />
          </Field>
          <Button
            variant="danger"
            className="mt-3 w-full"
            disabled={pending || v.trim() !== name}
            onClick={() =>
              start(async () => {
                try {
                  await deleteManagedPerson(personId, v);
                  router.push("/familia");
                } catch (e) {
                  err(e);
                }
              })
            }
          >
            Borrar definitivamente
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AccessRow({ personId, row, canRevoke }: { personId: string; row: { userId: string; name: string; email: string; role: string; canWrite: boolean; scopes: string[]; expires: string | null }; canRevoke: boolean }) {
  const [pending, start] = useSafeTransition();
  return (
    <li className="flex items-center gap-2 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block font-medium">
          {row.name} <Badge tone={row.role === "professional" ? "accent" : row.role === "viewer" ? "neutral" : "herb"}>{ROLE[row.role] ?? row.role}</Badge>
          {row.canWrite && row.role === "viewer" ? <Badge tone="warn">puede editar</Badge> : null}
        </span>
        <span className="block truncate text-xs text-ink-3">
          {row.scopes.join(", ") || "nada"}
          {row.expires ? ` · hasta ${row.expires}` : ""}
        </span>
      </span>
      {canRevoke ? (
        <Button size="icon-sm" variant="ghost" aria-label={`Quitar acceso a ${row.name}`} disabled={pending} onClick={() => start(async () => void (await revokeAccess(personId, row.userId).catch(err)))}>
          <X />
        </Button>
      ) : null}
    </li>
  );
}

function ScopeChecks({ names, value, onChange }: { names: Record<string, string>; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {Object.entries(names).map(([k, label]) => (
        <label key={k} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.includes(k)} onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))} />
          {label}
        </label>
      ))}
    </div>
  );
}

export function GrantAccess({ personId, members, scopeNames }: { personId: string; members: { userId: string; name: string }[]; scopeNames: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<"viewer" | "manager">("viewer");
  const [scopes, setScopes] = useState<string[]>(["diary", "body"]);
  const [pending, start] = useSafeTransition();
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Share2 /> Compartir con alguien del hogar
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Compartir" description="Quien gestiona puede verlo y cambiarlo todo; quien ve, solo lo que marques.">
          <form
            className="space-y-3"
            action={(fd) =>
              start(async () => {
                try {
                  await grantAccess({ personId, userId: String(fd.get("user")), role, scopes: scopes as never, canWrite: fd.get("write") === "on" });
                  setOpen(false);
                } catch (e) {
                  err(e);
                }
              })
            }
          >
            <Field label="Con">
              <Select name="user">
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Rol">
              <Select value={role} onChange={(e) => setRole(e.target.value as "viewer")}>
                <option value="viewer">Ver lo que elija</option>
                <option value="manager">Gestionar (todo)</option>
              </Select>
            </Field>
            {role === "viewer" ? (
              <>
                <ScopeChecks names={scopeNames} value={scopes} onChange={setScopes} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="write" /> También puede registrar (diario, peso…)
                </label>
              </>
            ) : null}
            <Button type="submit" className="w-full" disabled={pending || (role === "viewer" && !scopes.length)}>
              Compartir
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function InviteProfessional({ personId, scopeNames }: { personId: string; scopeNames: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [scopes, setScopes] = useState<string[]>(["diary", "body"]);
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useSafeTransition();
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Stethoscope /> Invitar a un profesional
      </Button>
      <Dialog open={open} onOpenChange={(o) => (setOpen(o), o || setLink(null))}>
        <DialogContent title="Nutricionista o médico" description="Acceso de solo lectura a lo que marques, con caducidad. Puede dejar notas.">
          {link ? (
            <CopyLink link={link} />
          ) : (
            <form
              className="space-y-3"
              action={(fd) =>
                start(async () => {
                  try {
                    const r = await inviteProfessional({ personId, email: String(fd.get("email")), scopes, days: Number(fd.get("days") || 90) });
                    setLink(r.link);
                  } catch (e) {
                    err(e);
                  }
                })
              }
            >
              <Field label="Correo">
                <Input name="email" type="email" required />
              </Field>
              <ScopeChecks names={scopeNames} value={scopes} onChange={setScopes} />
              <Field label="Días de acceso">
                <Input name="days" type="number" min={1} max={365} defaultValue={90} />
              </Field>
              <Button type="submit" className="w-full" disabled={pending || !scopes.length}>
                Crear invitación
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NoteForm({ personId }: { personId: string }) {
  const [v, setV] = useState("");
  const [pending, start] = useSafeTransition();
  return (
    <div className="space-y-2">
      <Textarea rows={3} value={v} onChange={(e) => setV(e.target.value)} placeholder="Pauta, observación o recordatorio…" maxLength={8000} />
      <Button
        size="sm"
        disabled={pending || !v.trim()}
        onClick={() =>
          start(async () => {
            try {
              await addProfessionalNote(personId, v);
              setV("");
            } catch (e) {
              err(e);
            }
          })
        }
      >
        Añadir nota
      </Button>
    </div>
  );
}

export function DeleteNote({ id }: { id: string }) {
  const [pending, start] = useSafeTransition();
  return (
    <button type="button" aria-label="Borrar nota" disabled={pending} onClick={() => start(async () => void (await deleteProfessionalNote(id).catch(err)))}>
      <Trash2 className="size-3.5" />
    </button>
  );
}
