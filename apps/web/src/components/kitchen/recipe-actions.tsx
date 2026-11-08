"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CookingPot, Loader2, Minus, Plus, Sparkles, Star, Trash2, Utensils } from "lucide-react";
import { toast } from "sonner";
import { addItems } from "@/actions/diary";
import { cookAction, deleteRecipe, rateRecipe, substitutionsFor } from "@/actions/recipes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Ing = { id: string; rawText: string; grams: number | null; quantity: number | null; unit: string | null; section: string | null; optional: boolean; food: { id: string; name: string } | null };

const fmtQty = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 4) / 4).toLocaleString("es-ES");

/** Ingredient list that rescales with the servings stepper. */
export function ScaledIngredients({ ingredients, baseServings }: { ingredients: Ing[]; baseServings: number }) {
  const [s, setS] = useState(baseServings);
  const f = s / (baseServings || 1);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  let section: string | null = null;
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm text-ink-2">Raciones</span>
        <Button size="icon-sm" variant="outline" aria-label="Menos" onClick={() => setS((x) => Math.max(0.5, x - (x > 1 ? 1 : 0.5)))}>
          <Minus />
        </Button>
        <span className="num w-8 text-center font-semibold">{s}</span>
        <Button size="icon-sm" variant="outline" aria-label="Más" onClick={() => setS((x) => x + 1)}>
          <Plus />
        </Button>
      </div>
      <ul className="space-y-1.5 text-sm">
        {ingredients.map((i) => {
          const head = i.section && i.section !== section ? ((section = i.section), i.section) : null;
          const scaled = f !== 1 && (i.grams != null || i.quantity != null);
          return (
            <li key={i.id}>
              {head ? <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-ink-3">{head}</p> : null}
              <label className={cn("flex items-start gap-2", checked.has(i.id) && "text-ink-3 line-through")}>
                <input type="checkbox" className="mt-1 accent-[var(--herb)]" checked={checked.has(i.id)} onChange={() => setChecked((c) => { const n = new Set(c); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })} />
                <span>
                  {scaled ? (
                    <b className="num font-semibold">{i.grams != null ? `${fmtQty(i.grams * f)} g` : `${fmtQty(i.quantity! * f)} ${i.unit ?? ""}`} · </b>
                  ) : null}
                  {i.rawText}
                  {i.optional ? <span className="text-ink-3"> (opcional)</span> : null}
                  {!i.food ? <span className="ml-1 text-xs text-persimmon">· sin alimento vinculado</span> : i.grams == null ? <span className="ml-1 text-xs text-persimmon">· sin gramos</span> : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function LogRecipe({ personId, foodId, servingGrams, title, slots, defaultSlot, today }: { personId: string; foodId: string; servingGrams: number | null; title: string; slots: { key: string; label: string }[]; defaultSlot: string; today: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="soft" onClick={() => setOpen(true)}>
        <Utensils /> Registrar
      </Button>
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent title={`Registrar «${title}»`}>
            <form
              className="space-y-3"
              action={(fd) =>
                start(async () => {
                  const servings = Number(fd.get("servings"));
                  const grams = fd.get("grams") ? Number(fd.get("grams")) : (servingGrams ?? 300) * servings;
                  await addItems({ personId, date: String(fd.get("date")), mealSlot: String(fd.get("slot")), origin: "recipe", items: [{ foodId, grams, servingLabel: "ración", servingQty: servings }] });
                  toast.success("Añadido al diario");
                  setOpen(false);
                })
              }
            >
              <div className="grid grid-cols-2 gap-2">
                <Field label="Raciones">
                  <Input name="servings" type="number" min={0.25} step={0.25} defaultValue={1} required />
                </Field>
                <Field label="o gramos" hint={servingGrams ? `1 ración ≈ ${servingGrams} g` : undefined}>
                  <Input name="grams" type="number" min={1} />
                </Field>
                <Field label="Comida">
                  <Select name="slot" defaultValue={defaultSlot}>
                    {slots.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Fecha">
                  <Input name="date" type="date" defaultValue={today} />
                </Field>
              </div>
              <Button type="submit" className="w-full" disabled={pending}>
                Añadir
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export function CookDialog({ recipeId, servings, freezable, timezone }: { recipeId: string; servings: number; freezable: boolean; timezone: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <CookingPot /> La he cocinado
      </Button>
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent title="¿Cuánto has cocinado?" description="Descuento los ingredientes de la despensa. Si sobra, lo guardo como tuppers para registrarlos después.">
            <form
              className="space-y-3"
              action={(fd) =>
                start(async () => {
                  const r = await cookAction({ recipeId, servings: Number(fd.get("servings")), batchPortions: Number(fd.get("batch") || 0), location: String(fd.get("loc")) as "nevera", timezone });
                  toast.success(`${r.used.length ? `Despensa actualizada (${r.used.length} productos)` : "Hecho"}${r.batchId ? " · tuppers guardados" : ""}`);
                  setOpen(false);
                })
              }
            >
              <div className="grid grid-cols-3 gap-2">
                <Field label="Raciones">
                  <Input name="servings" type="number" min={0.5} step={0.5} defaultValue={servings} required />
                </Field>
                <Field label="Para tuppers">
                  <Input name="batch" type="number" min={0} defaultValue={0} />
                </Field>
                <Field label="Dónde">
                  <Select name="loc" defaultValue="nevera">
                    <option value="nevera">Nevera</option>
                    {freezable ? <option value="congelador">Congelador</option> : null}
                  </Select>
                </Field>
              </div>
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

export function Rating({ personId, recipeId, current }: { personId: string; recipeId: string; current: number | null }) {
  const [stars, setStars] = useState(current ?? 0);
  const [, start] = useTransition();
  return (
    <div className="flex gap-0.5" role="radiogroup" aria-label="Valoración">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={stars === n}
          aria-label={`${n} estrellas`}
          onClick={() => {
            setStars(n);
            start(() => rateRecipe(personId, recipeId, { stars: n, verdict: n >= 4 ? "like" : n <= 2 ? "dislike" : "neutral" }));
          }}
        >
          <Star className={cn("size-5", n <= stars ? "fill-persimmon text-persimmon" : "text-line")} />
        </button>
      ))}
    </div>
  );
}

export function Substitutions({ personId, recipeId }: { personId: string; recipeId: string }) {
  const [reason, setReason] = useState("");
  const [opts, setOpts] = useState<{ ingredient: string; substitute: string; reason: string; ratio: string | null }[] | null>(null);
  const [pending, start] = useTransition();
  const presets = ["Más proteína", "Menos calorías", "Sin lactosa", "Sin gluten", "Vegana", "Con lo que tengo en la despensa"];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button key={p} type="button" onClick={() => setReason(p)} className={cn("rounded-full border px-3 py-1 text-xs", reason === p ? "border-herb bg-herb-soft text-herb" : "border-line")}>
            {p}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="¿Qué quieres cambiar?" />
        <Button
          variant="soft"
          disabled={pending || reason.trim().length < 2}
          onClick={() =>
            start(async () => {
              try {
                setOpts((await substitutionsFor(personId, recipeId, reason)).options);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Error de la IA");
              }
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : <Sparkles />} Sugerir
        </Button>
      </div>
      {opts ? (
        <ul className="space-y-1.5 text-sm">
          {opts.map((o, i) => (
            <li key={i} className="rounded-xl bg-paper-2 p-2">
              <b>{o.ingredient}</b> → {o.substitute} {o.ratio ? <span className="text-ink-3">({o.ratio})</span> : null}
              <span className="block text-xs text-ink-2">{o.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function DeleteRecipe({ id }: { id: string }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return confirm ? (
    <span className="flex items-center gap-1">
      <Button size="sm" variant="danger" disabled={pending} onClick={() => start(async () => {
        await deleteRecipe(id);
        router.push("/recetas");
      })}>
        Sí, borrar
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
        No
      </Button>
    </span>
  ) : (
    <Button size="icon-sm" variant="ghost" aria-label="Borrar receta" onClick={() => setConfirm(true)}>
      <Trash2 />
    </Button>
  );
}

export function CookModeLink({ id }: { id: string }) {
  return (
    <Button asChild>
      <Link href={`/recetas/${id}/cocinar`}>
        <CookingPot /> Modo cocina
      </Link>
    </Button>
  );
}
