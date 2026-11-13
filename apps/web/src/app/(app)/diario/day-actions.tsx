"use client";
import { submitForm } from "@/lib/forms";
import { useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { CheckCircle2, CircleDashed, Copy, Save, Smile } from "lucide-react";
import { toast } from "sonner";
import { copyMealTo, saveTemplate, setDayStatus } from "@/actions/diary";
import { logFeeling } from "@/actions/health";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/format";

type TemplateItem = { foodId?: string; name: string; grams: number; servingLabel?: string };

export function DayActions({ personId, date, today, complete, incomplete, hasEntries, meals }: { personId: string; date: string; today: string; complete: boolean; incomplete: boolean; hasEntries: boolean; meals: { key: string; label: string; items: TemplateItem[] }[] }) {
  const [pending, start] = useSafeTransition();
  const [tpl, setTpl] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      {hasEntries && date !== today ? (
        <Button variant="outline" disabled={pending} onClick={() => start(async () => void toast.success(`${plural(await copyMealTo(personId, date, today), "alimento copiado", "alimentos copiados")} a hoy`))}>
          <Copy /> Copiar día a hoy
        </Button>
      ) : null}
      <Button variant={complete ? "soft" : "outline"} disabled={pending} aria-pressed={complete} onClick={() => start(() => setDayStatus(personId, date, complete ? null : "complete"))} title="Ayuda a estimar tu gasto real: los días marcados como completos pesan más">
        <CheckCircle2 /> {complete ? "Día completo" : "Marcar día completo"}
      </Button>
      {hasEntries ? (
        <Button variant={incomplete ? "soft" : "ghost"} disabled={pending} aria-pressed={incomplete} onClick={() => start(() => setDayStatus(personId, date, incomplete ? null : "incomplete"))} title="No registraste todo: el día no cuenta en medias, informe ni gasto estimado">
          <CircleDashed /> {incomplete ? "Día incompleto" : "Marcar incompleto"}
        </Button>
      ) : null}
      {meals.length ? (
        <Button variant="ghost" onClick={() => setTpl(true)}>
          <Save /> Guardar como plantilla
        </Button>
      ) : null}
      {tpl ? (
        <Dialog open onOpenChange={setTpl}>
          <DialogContent title="Guardar plantilla" description="Reutiliza una comida habitual con un toque.">
            <form
              className="space-y-3"
              onSubmit={submitForm((fd) =>
                start(async () => {
                  const m = meals.find((x) => x.key === fd.get("slot"))!;
                  await saveTemplate(personId, String(fd.get("name")), m.key, m.items);
                  toast.success("Plantilla guardada");
                  setTpl(false);
                })
              )}
            >
              <Field label="Comida">
                <Select name="slot">
                  {meals.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label} ({m.items.length})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Nombre">
                <Input name="name" required maxLength={80} placeholder="Desayuno de diario" />
              </Field>
              <Button type="submit" className="w-full" disabled={pending}>
                Guardar
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

const SCALE = [1, 2, 3, 4, 5];

function Scale({ name, label, low, high, value }: { name: string; label: string; low: string; high: string; value: number | null }) {
  const [v, setV] = useState(value);
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-ink-2">{label}</legend>
      <input type="hidden" name={name} value={v ?? ""} />
      <div className="flex gap-1">
        {SCALE.map((n) => (
          <button key={n} type="button" onClick={() => setV(n)} aria-pressed={v === n} className={cn("size-10 flex-1 rounded-xl border text-sm font-medium", v === n ? "border-herb bg-herb text-herb-ink" : "border-line hover:bg-paper-2")}>
            {n}
          </button>
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[11px] text-ink-3">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </fieldset>
  );
}

export function FeelingButton({ personId, date, slot, current }: { personId: string; date: string; slot: string; current: { hungerBefore: number | null; satietyAfter: number | null; mood: number | null; note: string | null } | null }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useSafeTransition();
  const filled = current && (current.hungerBefore || current.satietyAfter || current.mood);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="ml-3 inline-flex items-center gap-1 text-xs text-ink-3 hover:text-herb">
        <Smile className="size-3.5" />
        {filled ? `Hambre ${current!.hungerBefore ?? "–"} · saciedad ${current!.satietyAfter ?? "–"} · ánimo ${current!.mood ?? "–"}` : "¿Cómo te sentó?"}
      </button>
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent title="¿Cómo te sentó?" description="Sirve para encontrar patrones de hambre, saciedad y ánimo.">
            <form
              className="space-y-4"
              onSubmit={submitForm((fd) =>
                start(async () => {
                  const n = (k: string) => (fd.get(k) ? Number(fd.get(k)) : null);
                  await logFeeling(personId, { date, mealSlot: slot, hungerBefore: n("hunger"), satietyAfter: n("satiety"), mood: n("mood"), note: String(fd.get("note") || "") || null });
                  setOpen(false);
                })
              )}
            >
              <Scale name="hunger" label="Hambre antes" low="Nada" high="Mucha" value={current?.hungerBefore ?? null} />
              <Scale name="satiety" label="Saciedad después" low="Me quedé con hambre" high="Muy lleno" value={current?.satietyAfter ?? null} />
              <Scale name="mood" label="Ánimo" low="Bajo" high="Genial" value={current?.mood ?? null} />
              <Field label="Nota">
                <Textarea name="note" defaultValue={current?.note ?? ""} rows={2} maxLength={300} />
              </Field>
              <Button type="submit" className="w-full" disabled={pending}>
                Guardar
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
