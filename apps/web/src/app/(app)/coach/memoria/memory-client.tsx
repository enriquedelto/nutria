"use client";
import { submitForm } from "@/lib/forms";
import { useRef, useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { addMemory, deleteMemory, saveHouseholdPreferences } from "@/actions/ai";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/input";

const CATS: Record<string, string> = { gustos: "Gustos", rutina: "Rutina", salud: "Salud", objetivos: "Objetivos", cocina: "Cocina", otros: "Otros" };

export function MemoryClient({
  personId,
  memories,
  groupId,
  household,
  lastConversationId,
  canWrite,
}: {
  personId: string;
  memories: { id: string; category: string; contentMd: string; source: string }[];
  groupId: string | null;
  household: string;
  lastConversationId: string | null;
  canWrite: boolean;
}) {
  const [pending, start] = useSafeTransition();
  const [suggested, setSuggested] = useState<{ category: string; contentMd: string }[] | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [hh, setHh] = useState(household);
  const form = useRef<HTMLFormElement>(null);

  const extract = async () => {
    setExtracting(true);
    const res = await fetch("/api/ai/memories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ personId, conversationId: lastConversationId }) });
    const d = await res.json();
    setExtracting(false);
    if (!res.ok) return toast.error(d.error);
    setSuggested(d.memories);
    if (!d.memories.length) toast("No he encontrado nada nuevo que recordar");
  };

  return (
    <div className="space-y-4">
      {canWrite ? (
        <Card>
          <form
            ref={form}
            className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
            onSubmit={submitForm((fd) =>
              start(async () => {
                await addMemory(personId, String(fd.get("category")), String(fd.get("content")));
                form.current?.reset();
              })
            )}
          >
            <Field label="Categoría">
              <Select name="category">
                {Object.entries(CATS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Algo que el coach deba saber">
              <Textarea name="content" rows={1} required placeholder="No me gusta el pescado azul salvo el salmón" />
            </Field>
            <Button type="submit" disabled={pending}>
              <Plus /> Añadir
            </Button>
          </form>
          {lastConversationId ? (
            <Button variant="soft" size="sm" className="mt-3" onClick={extract} disabled={extracting}>
              {extracting ? <Loader2 className="animate-spin" /> : <Sparkles />} Sacar recuerdos de la última conversación
            </Button>
          ) : null}
          {suggested?.length ? (
            <ul className="mt-3 space-y-2">
              {suggested.map((s, i) => (
                <li key={i} className="flex items-start gap-2 rounded-xl bg-paper-2 p-3 text-sm">
                  <span className="flex-1">
                    <b>{CATS[s.category]}:</b> {s.contentMd}
                  </span>
                  <Button
                    size="sm"
                    onClick={() =>
                      start(async () => {
                        await addMemory(personId, s.category, s.contentMd);
                        setSuggested((xs) => xs!.filter((_, j) => j !== i));
                      })
                    }
                  >
                    Guardar
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}
      {Object.entries(CATS).map(([cat, title]) => {
        const list = memories.filter((m) => m.category === cat);
        if (!list.length) return null;
        return (
          <Card key={cat}>
            <CardHeader title={title} />
            <ul className="space-y-2">
              {list.map((m) => (
                <li key={m.id} className="flex items-start gap-2 text-sm">
                  <Markdown text={m.contentMd} className="flex-1" />
                  {canWrite ? (
                    <button type="button" aria-label="Olvidar" className="rounded-full p-1 text-ink-3 hover:bg-paper-2" onClick={() => start(() => deleteMemory(personId, m.id))}>
                      <Trash2 className="size-4" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
      {groupId ? (
        <Card>
          <CardHeader title="Preferencias de la casa" subtitle="Las usa el planificador de menús para todos (markdown)." />
          <Textarea value={hh} onChange={(e) => setHh(e.target.value)} rows={6} placeholder={"- Cenamos ligero entre semana\n- Los domingos, paella\n- Presupuesto ajustado"} />
          <Button
            className="mt-2"
            size="sm"
            disabled={pending || hh === household}
            onClick={() =>
              start(async () => {
                await saveHouseholdPreferences(groupId, hh);
                toast.success("Guardado");
              })
            }
          >
            Guardar
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
