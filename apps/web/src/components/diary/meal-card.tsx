"use client";
import { submitForm } from "@/lib/forms";
import { useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import Link from "next/link";
import { ArrowLeftRight, BookmarkPlus, Copy, History, MoreHorizontal, Plus, Sparkles, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { toast } from "sonner";
import { editEntry, removeEntries, saveMealTemplate } from "@/actions/diary";
import { diaryOp } from "@/lib/offline-queue";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FoodPicker } from "@/components/food/food-picker";
import { NutriBadges } from "@/components/food/add-food-dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { mealProteinStatus, NUTRIENTS, type NutrientMap } from "@nutria/nutrition";
import { n0, nutrient } from "@/lib/format";
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
  nutrients?: NutrientMap;
  nova?: number | null;
  nutriscore?: string | null;
  eatenAt?: Date | string | null;
};

type MicroTargets = Record<string, { min?: number; max?: number }>;

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
  yesterday,
  microTargets,
  slotTime,
  timeZone,
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
  /** Yesterday had this meal logged: an empty meal offers «Como ayer». */
  yesterday?: boolean;
  /** Daily references for the micronutrients shown in the entry dialog. */
  microTargets?: MicroTargets;
  /** Usual time of this meal ("HH:MM[:SS]"), default for the entry's time. */
  slotTime?: string | null;
  timeZone?: string;
}) {
  const [pending, start] = useSafeTransition();
  const [editing, setEditing] = useState<MealEntry | null>(null);
  const [naming, setNaming] = useState(false);
  const router = useRouter();
  /** Copy a meal between days; offline it is parked and done later. */
  const copy = async (fromDate: string, toDate: string) => {
    const r = await diaryOp({ op: "copy", personId, fromDate, toDate, fromSlot: slot, toSlot: slot });
    if (!r.queued) router.refresh();
    return r;
  };
  const prevDay = new Date(Date.parse(date + "T12:00:00Z") - 86_400_000).toISOString().slice(0, 10);
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
                      onSelect={() =>
                        start(async () => {
                          const r = await copy(date, tomorrow);
                          toast.success(r.queued ? "Sin conexión: se copiará a mañana al volver" : `Copiado a mañana (${r.data?.n ?? 0})`);
                        })
                      }
                    >
                      <Copy className="size-4" /> Copiar a mañana
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 outline-none data-[highlighted]:bg-paper-2" onSelect={() => setNaming(true)}>
                      <BookmarkPlus className="size-4" /> Guardar como plantilla
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
      {!entries.length && yesterday && canWrite ? (
        <div className="border-t border-line px-4 py-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await copy(prevDay, date);
                const n = r.data?.n ?? 0;
                toast.success(r.queued ? "Sin conexión: se copiará al volver" : `${label}: ${n} ${n === 1 ? "alimento copiado" : "alimentos copiados"} de ayer`);
              })
            }
          >
            <History /> Como ayer
          </Button>
        </div>
      ) : null}
      {naming ? (
        <Dialog open onOpenChange={setNaming}>
          <DialogContent title="Guardar como plantilla" description="Se guardan los alimentos y sus gramos. Luego la registras en un toque desde Buscar › Plantillas o desde el aviso de la comida.">
            <form
              className="space-y-3"
              onSubmit={submitForm((fd) =>
                start(async () => {
                  await saveMealTemplate(personId, date, slot, String(fd.get("name") ?? ""));
                  setNaming(false);
                  toast.success("Plantilla guardada");
                }),
              )}
            >
              <Field label="Nombre">
                <Input name="name" defaultValue={`${label} habitual`} maxLength={80} required autoFocus />
              </Field>
              <Button type="submit" className="w-full" disabled={pending}>
                Guardar plantilla
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
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
                    {e.eatenAt ? <span className="num">{clockIn(e.eatenAt, timeZone)} · </span> : null}
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
      {editing ? <EditEntryDialog personId={personId} entry={editing} slots={slots} microTargets={microTargets ?? {}} defaultTime={slotTime?.slice(0, 5) ?? null} timeZone={timeZone} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

const clockIn = (d: Date | string, timeZone?: string) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(d));

function EditEntryDialog({
  personId,
  entry,
  slots,
  microTargets,
  defaultTime,
  timeZone,
  onClose,
}: {
  personId: string;
  entry: MealEntry;
  slots: { key: string; label: string }[];
  microTargets: MicroTargets;
  defaultTime: string | null;
  timeZone?: string;
  onClose: () => void;
}) {
  const [pending, start] = useSafeTransition();
  const [grams, setGrams] = useState(entry.grams);
  const [swapping, setSwapping] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  // Deleting has no undo: on a phone it is easy to tap by mistake, so it takes a second tap.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ratio = entry.grams > 0 ? grams / entry.grams : 1;
  const savedTime = entry.eatenAt ? clockIn(entry.eatenAt, timeZone) : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={entry.name} description={entry.brand ?? undefined}>
        {entry.nova || entry.nutriscore ? (
          <div className="-mt-2 mb-3">
            <NutriBadges nutriscore={entry.nutriscore ?? null} nova={entry.nova ?? null} />
          </div>
        ) : null}
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
              const time = String(fd.get("time") || "");
              await editEntry(personId, entry.id, {
                grams: entry.quick ? undefined : Number(fd.get("grams")),
                mealSlot: String(fd.get("slot")),
                note: String(fd.get("note") || "") || null,
                // Only store a time the person set or changed; the meal's usual time stays implicit.
                ...(time && time !== (savedTime ?? defaultTime) ? { eatenTime: time } : !time && savedTime ? { eatenTime: null } : {}),
              });
              onClose();
            })
          )}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
            <Field label="Hora">
              <Input name="time" type="time" defaultValue={savedTime ?? defaultTime ?? ""} />
            </Field>
          </div>
          <div className="num grid grid-cols-4 gap-2 rounded-xl bg-paper-2 p-3 text-center text-sm">
            <Stat label="kcal" v={entry.kcal * ratio} />
            <Stat label="Prot." v={entry.protein * ratio} />
            <Stat label="Hidr." v={entry.carbs * ratio} />
            <Stat label="Grasa" v={entry.fat * ratio} />
          </div>
          <EntryNutrients nutrients={entry.nutrients ?? {}} ratio={ratio} targets={microTargets} />
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

const ENTRY_GROUPS: { title: string; cats: string[]; extra?: string[] }[] = [
  { title: "Azúcares, grasas y fibra", cats: ["carb_detail", "fat_detail"], extra: ["fiber"] },
  { title: "Vitaminas", cats: ["vitamin"] },
  { title: "Minerales", cats: ["mineral"] },
  { title: "Otros", cats: ["other"] },
];

/** Micronutrients of the entry (scaled to the grams being edited) as a share of the daily reference. */
function EntryNutrients({ nutrients, ratio, targets }: { nutrients: NutrientMap; ratio: number; targets: MicroTargets }) {
  const groups = ENTRY_GROUPS.map((g) => ({
    title: g.title,
    rows: NUTRIENTS.filter((n) => g.cats.includes(n.category) || g.extra?.includes(n.code))
      .map((n) => ({ n, v: (nutrients[n.code] ?? 0) * ratio, t: targets[n.code] }))
      .filter((r) => r.v > 0),
  })).filter((g) => g.rows.length);
  if (!groups.length) return <p className="text-xs text-ink-3">Este alimento no trae micronutrientes.</p>;
  return (
    <div className="rounded-xl border border-line px-3">
      {groups.map((g) => (
        <details key={g.title} open={groups.length === 1 || !g.title.startsWith("Azúcares")} className="border-t border-line py-2 first:border-t-0">
          <summary className="cursor-pointer py-1 text-sm font-semibold">{g.title}</summary>
          <ul className="mt-1 space-y-1.5">
            {g.rows.map(({ n, v, t }) => {
              const ref = t?.min ?? t?.max;
              const over = t?.max != null && v > t.max;
              return (
                <li key={n.code} className="flex justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">{n.nameEs}</span>
                  <span className={cn("num shrink-0", over ? "text-danger" : "text-ink-2")}>
                    {nutrient(n.code, v)}
                    {ref ? <span className="text-ink-3"> · {n0((v / ref) * 100)} %{t?.min == null ? " del máx." : ""}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      ))}
      <p className="pb-2 text-[11px] text-ink-3">% de tu referencia diaria. Los nutrientes sin dato no aparecen.</p>
    </div>
  );
}
