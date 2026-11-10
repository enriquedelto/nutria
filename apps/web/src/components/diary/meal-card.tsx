"use client";
import { submitForm } from "@/lib/forms";
import { useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import Link from "next/link";
import { ArrowLeftRight, Copy, MoreHorizontal, Plus, Sparkles, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { toast } from "sonner";
import { copyMealTo, editEntry, removeEntries } from "@/actions/diary";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FoodPicker } from "@/components/food/food-picker";
import { Field, Input, Select } from "@/components/ui/input";
import { mealProteinStatus } from "@nutria/nutrition";
import { n0 } from "@/lib/format";
import { cn } from "@/lib/utils";

export type MealEntry = {
  id: string;
  name: string;
  brand: string | null;
  grams: number;
  servingLabel: string | null;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  origin: string;
  quick: boolean;
  note: string | null;
  mealSlot: string;
};

const ORIGIN_ICON: Record<string, string> = { ai_text: "IA", ai_photo: "IA", ai_voice: "IA", label: "Etiqueta", scan: "Escaneo", plan: "Plan", import: "Import.", supplement: "Supl." };

export function MealCard({
  personId,
  date,
  slot,
  label,
  entries,
  slots,
  canWrite,
  proteinDose,
}: {
  personId: string;
  date: string;
  slot: string;
  label: string;
  entries: MealEntry[];
  slots: { key: string; label: string }[];
  canWrite: boolean;
  /** Ideal protein for this meal (main meals of people training or gaining). */
  proteinDose?: number | null;
}) {
  const [pending, start] = useSafeTransition();
  const [editing, setEditing] = useState<MealEntry | null>(null);
  const kcal = entries.reduce((a, e) => a + e.kcal, 0);
  const protein = entries.reduce((a, e) => a + e.protein, 0);
  const pStatus = proteinDose ? mealProteinStatus(protein, proteinDose) : null;
  const tomorrow = new Date(Date.parse(date + "T12:00:00Z") + 86_400_000).toISOString().slice(0, 10);

  return (
    <section className="rounded-card border border-line bg-card">
      <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
        <div>
          <h3 className="font-display text-lg font-semibold">{label}</h3>
          <p className="num text-xs text-ink-3">
            {entries.length ? (
              <>
                {n0(kcal)} kcal ·{" "}
                {pStatus && proteinDose ? (
                  <span className={cn("font-medium", pStatus === "ok" ? "text-herb" : pStatus === "near" ? "text-ink-2" : "text-persimmon")} title="Proteína de esta comida frente a la toma ideal (0,4 g/kg)">
                    P {n0(protein)} de {n0(proteinDose)} g{pStatus === "ok" ? " ✓" : ""}
                  </span>
                ) : (
                  `P ${n0(protein)} g`
                )}
              </>
            ) : proteinDose ? (
              `Sin registrar · ideal ≥ ${n0(proteinDose)} g de proteína`
            ) : (
              "Sin registrar"
            )}
          </p>
        </div>
        {canWrite ? (
          <div className="flex items-center gap-1">
            <Button asChild size="icon-sm" variant="soft" aria-label={`Añadir a ${label}`}>
              <Link href={`/buscar?comida=${slot}&fecha=${date}`}>
                <Plus />
              </Link>
            </Button>
            <Button asChild size="icon-sm" variant="ghost" aria-label={`Registrar ${label} con IA`}>
              <Link href={`/registrar?comida=${slot}&fecha=${date}`}>
                <Sparkles />
              </Link>
            </Button>
            {entries.length ? (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger className="grid size-8 place-items-center rounded-full hover:bg-paper-2" aria-label="Más opciones">
                  <MoreHorizontal className="size-4" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="end" className="z-50 min-w-52 rounded-2xl border border-line bg-card p-1.5 text-sm shadow-xl">
                    <DropdownMenu.Item
                      className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 outline-none data-[highlighted]:bg-paper-2"
                      onSelect={() => start(async () => void toast.success(`Copiado a mañana (${await copyMealTo(personId, date, tomorrow, slot)})`))}
                    >
                      <Copy className="size-4" /> Copiar a mañana
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-danger outline-none data-[highlighted]:bg-paper-2"
                      onSelect={() =>
                        start(async () => {
                          await removeEntries(personId, entries.map((e) => e.id));
                          toast(`${label} vaciado`);
                        })
                      }
                    >
                      <Trash2 className="size-4" /> Vaciar comida
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            ) : null}
          </div>
        ) : null}
      </header>
      {entries.length ? (
        <ul className={pending ? "opacity-60" : undefined}>
          {entries.map((e) => (
            <li key={e.id} className="border-t border-line first:border-t-0">
              <button
                type="button"
                disabled={!canWrite}
                onClick={() => setEditing(e)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-paper-2/60 disabled:cursor-default"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {e.name}
                    {ORIGIN_ICON[e.origin] ? <span className="ml-2 rounded bg-herb-soft px-1 text-[10px] font-semibold uppercase text-herb">{ORIGIN_ICON[e.origin]}</span> : null}
                  </p>
                  <p className="truncate text-xs text-ink-3">
                    {e.quick ? "Registro rápido" : e.servingLabel ? `${e.servingLabel} · ${n0(e.grams)} g` : `${n0(e.grams)} g`}
                    {e.brand ? ` · ${e.brand}` : ""}
                  </p>
                </div>
                <div className="num text-right text-sm">
                  <p className="font-medium">{n0(e.kcal)}</p>
                  <p className="text-[11px] text-ink-3">
                    {n0(e.protein)}·{n0(e.carbs)}·{n0(e.fat)}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {editing ? <EditEntryDialog personId={personId} entry={editing} slots={slots} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

function EditEntryDialog({ personId, entry, slots, onClose }: { personId: string; entry: MealEntry; slots: { key: string; label: string }[]; onClose: () => void }) {
  const [pending, start] = useSafeTransition();
  const [grams, setGrams] = useState(entry.grams);
  const [swapping, setSwapping] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  // Deleting has no undo: on a phone it is easy to tap by mistake, so it takes a second tap.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ratio = entry.grams > 0 ? grams / entry.grams : 1;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={entry.name} description={entry.brand ?? undefined}>
        <div className="mb-4">
          {swapping ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Cambiar por otro alimento{entry.quick ? "" : ` (se mantienen ${n0(grams)} g)`}</p>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSwapping(false)}>
                  Cancelar
                </Button>
              </div>
              <FoodPicker
                personId={personId}
                initialQuery={entry.name}
                busyId={picked}
                onPick={(f) => {
                  setPicked(f.id);
                  start(async () => {
                    try {
                      await editEntry(personId, entry.id, { foodId: f.id, grams: entry.quick ? undefined : grams > 0 ? grams : undefined });
                      toast.success(`Cambiado por ${f.name}`);
                      onClose();
                    } finally {
                      setPicked(null);
                    }
                  });
                }}
              />
            </div>
          ) : (
            <Button type="button" variant="outline" className="w-full" onClick={() => setSwapping(true)}>
              <ArrowLeftRight /> Cambiar por otro alimento
            </Button>
          )}
        </div>
        <form
          hidden={swapping}
          className="space-y-4"
          onSubmit={submitForm((fd) =>
            start(async () => {
              await editEntry(personId, entry.id, {
                grams: entry.quick ? undefined : Number(fd.get("grams")),
                mealSlot: String(fd.get("slot")),
                note: String(fd.get("note") || "") || null,
              });
              onClose();
            })
          )}
        >
          <div className="grid grid-cols-2 gap-3">
            {!entry.quick ? (
              <Field label="Cantidad (g)">
                <Input name="grams" type="number" inputMode="decimal" min={0} step="any" value={grams} onChange={(e) => setGrams(Number(e.target.value))} />
              </Field>
            ) : null}
            <Field label="Comida">
              <Select name="slot" defaultValue={entry.mealSlot}>
                {slots.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="num grid grid-cols-4 gap-2 rounded-xl bg-paper-2 p-3 text-center text-sm">
            <Stat label="kcal" v={entry.kcal * ratio} />
            <Stat label="Prot." v={entry.protein * ratio} />
            <Stat label="Hidr." v={entry.carbs * ratio} />
            <Stat label="Grasa" v={entry.fat * ratio} />
          </div>
          <Field label="Nota">
            <Input name="note" defaultValue={entry.note ?? ""} maxLength={500} />
          </Field>
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant={confirmDelete ? "danger" : "ghost"}
              className={confirmDelete ? undefined : "text-danger"}
              disabled={pending}
              onClick={() => {
                if (!confirmDelete) return setConfirmDelete(true);
                start(async () => {
                  await removeEntries(personId, [entry.id]);
                  toast(`${entry.name} borrado`);
                  onClose();
                });
              }}
            >
              <Trash2 /> {confirmDelete ? "¿Seguro? Borrar" : "Borrar"}
            </Button>
            <Button type="submit" disabled={pending}>
              Guardar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const Stat = ({ label, v }: { label: string; v: number }) => (
  <div>
    <p className="font-semibold">{n0(v)}</p>
    <p className="text-[11px] text-ink-3">{label}</p>
  </div>
);
