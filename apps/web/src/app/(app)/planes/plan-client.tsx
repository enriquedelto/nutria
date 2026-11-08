"use client";
import { errorText } from "@/lib/errors";
import { useMemo, useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChefHat, Copy, Loader2, NotebookPen, Plus, Printer, ShoppingCart, Sparkles, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { addPlanItem, applyPlanDraft, copyWeek, createPlan, deletePlanItem, generatePlanDraft, logPlanItem, movePlanItem, setItemCooked, setPlanPersons, setPortion } from "@/actions/plans";
import { shoppingFromPlanAction } from "@/actions/kitchen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Member = { id: string; name: string; color: string | null; isChild: boolean };
type Slot = { key: string; label: string };
type Recipe = { id: string; title: string; kcal: number | null; prepMin: number | null; tags: string[] };
type Item = { id: string; date: string; mealSlot: string; recipeId: string | null; title: string; note: string | null; cooked: boolean; portions: Record<string, { servings: number; grams?: number; kcal?: number }> };
type Plan = { id: string; personIds: string[]; items: Item[] };

const dayName = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", timeZone: "UTC" });
const dayLabel = (d: string) => dayName.format(new Date(`${d}T12:00:00Z`));

function err(e: unknown) {
  toast.error(errorText(e, "Algo ha fallado"));
}

export function PlanBoard(props: {
  week: string;
  today: string;
  days: string[];
  slots: Slot[];
  defaultSlots: string[];
  members: Member[];
  currentPersonId: string;
  canAi: boolean;
  timezone: string;
  prevPlan: { id: string; label: string } | null;
  recipes: Recipe[];
  plan: Plan | null;
}) {
  const { plan, members, days, slots } = props;
  const [pending, start] = useSafeTransition();
  const router = useRouter();
  const [adding, setAdding] = useState<{ date: string; slot: string } | null>(null);
  const [visibleSlots, setVisibleSlots] = useState<string[]>(() => {
    const used = new Set(plan?.items.map((i) => i.mealSlot));
    return slots.filter((s) => props.defaultSlots.includes(s.key) || used.has(s.key)).map((s) => s.key);
  });
  const names = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);

  if (!plan) return <StartPlan {...props} />;

  const people = members.filter((m) => plan.personIds.includes(m.id));
  const cell = (date: string, slot: string) => plan.items.filter((i) => i.date === date && i.mealSlot === slot);
  const shown = slots.filter((s) => visibleSlots.includes(s.key));

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        <PersonsDialog planId={plan.id} members={members} selected={plan.personIds} />
        {props.canAi ? <GenerateDialog {...props} personIds={plan.personIds} /> : null}
        <Button
          size="sm"
          variant="outline"
          disabled={pending || !plan.items.length}
          onClick={() =>
            start(async () => {
              try {
                const r = await shoppingFromPlanAction(plan.id);
                toast.success(`${r.added} cosas añadidas a la lista`, { action: { label: "Ver", onClick: () => router.push("/compra") } });
              } catch (e) {
                err(e);
              }
            })
          }
        >
          <ShoppingCart /> A la compra
        </Button>
        {props.prevPlan && !plan.items.length ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => void (await copyWeek(props.prevPlan!.id, props.week)))}>
            <Copy /> Repetir semana del {props.prevPlan.label}
          </Button>
        ) : null}
        <Button asChild size="sm" variant="outline">
          <Link href={`/planes/${plan.id}/repaso`}>
            <NotebookPen /> Repaso
          </Link>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => window.print()}>
          <Printer /> Imprimir
        </Button>
        <details className="relative ml-auto">
          <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-sm text-ink-2 hover:bg-paper-2">Comidas ▾</summary>
          <div className="absolute right-0 z-20 mt-1 w-48 space-y-1 rounded-lg border border-line bg-paper p-2 shadow-lg">
            {slots.map((s) => (
              <label key={s.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={visibleSlots.includes(s.key)} onChange={(e) => setVisibleSlots((v) => (e.target.checked ? [...v, s.key] : v.filter((x) => x !== s.key)))} />
                {s.label}
              </label>
            ))}
          </div>
        </details>
      </div>

      {/* Desktop/print: table. Mobile: day cards. */}
      <div className="hidden overflow-x-auto md:block print:block">
        <table className="w-full table-fixed border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="w-24" />
              {days.map((d) => (
                <th key={d} className={cn("rounded-md px-1 py-1 text-left font-medium capitalize", d === props.today && "bg-herb/10 text-herb")}>
                  {dayLabel(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.key} className="align-top">
                <th className="pt-2 text-left text-xs font-medium text-ink-3">{s.label}</th>
                {days.map((d) => (
                  <td key={d} className="rounded-md bg-paper-2/60 p-1">
                    <Cell items={cell(d, s.key)} names={names} days={days} slots={slots} people={people} onAdd={() => setAdding({ date: d, slot: s.key })} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden print:hidden">
        {days.map((d) => (
          <Card key={d} className={cn(d === props.today && "border-herb/60")}>
            <p className="mb-2 font-display font-semibold capitalize">{dayLabel(d)}</p>
            <div className="space-y-2">
              {shown.map((s) => (
                <div key={s.key} className="grid grid-cols-[5.5rem_1fr] gap-2">
                  <span className="pt-1.5 text-xs text-ink-3">{s.label}</span>
                  <Cell items={cell(d, s.key)} names={names} days={days} slots={slots} people={people} onAdd={() => setAdding({ date: d, slot: s.key })} />
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {adding ? <AddDialog planId={plan.id} target={adding} slots={slots} recipes={props.recipes} onClose={() => setAdding(null)} /> : null}
    </div>
  );
}

function Cell({ items, names, days, slots, people, onAdd }: { items: Item[]; names: Map<string, string>; days: string[]; slots: Slot[]; people: Member[]; onAdd: () => void }) {
  return (
    <div className="space-y-1">
      {items.map((i) => (
        <PlanItem key={i.id} item={i} names={names} days={days} slots={slots} people={people} />
      ))}
      <button type="button" onClick={onAdd} className="no-print flex w-full items-center justify-center rounded-md border border-dashed border-line py-1 text-ink-3 hover:border-herb hover:text-herb" aria-label="Añadir plato">
        <Plus className="size-4" />
      </button>
    </div>
  );
}

function PlanItem({ item, names, days, slots, people }: { item: Item; names: Map<string, string>; days: string[]; slots: Slot[]; people: Member[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useSafeTransition();
  const [cooked, setCooked] = useState(item.cooked);
  const portions = Object.entries(item.portions);
  return (
    <>
      <div className={cn("group rounded-md border border-line bg-paper px-2 py-1.5", cooked && "opacity-60")}>
        <div className="flex items-start gap-1">
          <button type="button" onClick={() => setOpen(true)} className="min-w-0 flex-1 text-left">
            <span className={cn("block text-sm leading-snug font-medium", cooked && "line-through")}>{item.title}</span>
            {portions.length ? (
              <span className="num block text-[11px] text-ink-3">
                {portions.map(([pid, p]) => `${(names.get(pid) ?? "?").split(" ")[0]} ${p.servings.toLocaleString("es-ES", { maximumFractionDigits: 2 })}`).join(" · ")}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            aria-label={cooked ? "Marcar como pendiente" : "Marcar como hecho"}
            className="no-print mt-0.5"
            onClick={() => {
              setCooked(!cooked);
              start(() => setItemCooked(item.id, !cooked));
            }}
          >
            <Check className={cn("size-4", cooked ? "text-ok" : "text-line group-hover:text-ink-3")} />
          </button>
        </div>
      </div>
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent title={item.title} description="Raciones calculadas con los objetivos de cada persona para esa comida.">
            <div className="space-y-4">
              <div className="space-y-2">
                {people.map((p) => (
                  <PortionRow key={p.id} itemId={item.id} person={p} servings={item.portions[p.id]?.servings ?? 0} kcal={item.portions[p.id]?.kcal} />
                ))}
              </div>
              {item.note ? <p className="text-sm whitespace-pre-line text-ink-2">{item.note}</p> : null}
              <div className="grid grid-cols-2 gap-2">
                <Field label="Día">
                  <Select defaultValue={item.date} onChange={(e) => start(() => movePlanItem(item.id, e.target.value, item.mealSlot))}>
                    {days.map((d) => (
                      <option key={d} value={d}>
                        {dayLabel(d)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Comida">
                  <Select defaultValue={item.mealSlot} onChange={(e) => start(() => movePlanItem(item.id, item.date, e.target.value))}>
                    {slots.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                {item.recipeId ? (
                  <>
                    <Button asChild size="sm" variant="soft">
                      <Link href={`/recetas/${item.recipeId}`}>Ver receta</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/recetas/${item.recipeId}/cocinar`}>
                        <ChefHat /> Cocinar
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          try {
                            const n = await logPlanItem(item.id, Object.keys(item.portions));
                            toast.success(`Registrado en el diario de ${n} persona${n === 1 ? "" : "s"}`);
                          } catch (e) {
                            err(e);
                          }
                        })
                      }
                    >
                      <NotebookPen /> Registrar a todos
                    </Button>
                  </>
                ) : null}
                <Button
                  size="sm"
                  variant="danger"
                  className="ml-auto"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await deletePlanItem(item.id);
                      setOpen(false);
                    })
                  }
                >
                  <Trash2 /> Quitar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function PortionRow({ itemId, person, servings, kcal }: { itemId: string; person: Member; servings: number; kcal?: number }) {
  const [v, setV] = useState(servings);
  const [, start] = useSafeTransition();
  const set = (n: number) => {
    const next = Math.max(0, Math.round(n * 4) / 4);
    setV(next);
    start(() => setPortion(itemId, person.id, next));
  };
  return (
    <div className="flex items-center gap-2">
      <span className="size-2.5 rounded-full" style={{ background: person.color ?? "var(--color-herb)" }} />
      <span className="flex-1 text-sm">
        {person.name}
        {kcal ? <span className="num ml-1 text-xs text-ink-3">≈ {Math.round(kcal)} kcal</span> : null}
      </span>
      <Button size="icon-sm" variant="outline" aria-label="Menos" onClick={() => set(v - 0.25)}>
        −
      </Button>
      <span className="num w-12 text-center text-sm">{v.toLocaleString("es-ES")}</span>
      <Button size="icon-sm" variant="outline" aria-label="Más" onClick={() => set(v + 0.25)}>
        +
      </Button>
    </div>
  );
}

function AddDialog({ planId, target, slots, recipes, onClose }: { planId: string; target: { date: string; slot: string }; slots: Slot[]; recipes: Recipe[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [free, setFree] = useState(false);
  const [pending, start] = useSafeTransition();
  const list = useMemo(() => {
    const n = q.trim().toLocaleLowerCase("es");
    return (n ? recipes.filter((r) => r.title.toLocaleLowerCase("es").includes(n) || r.tags.some((t) => t.toLocaleLowerCase("es").includes(n))) : recipes).slice(0, 40);
  }, [q, recipes]);
  const slotLabel = slots.find((s) => s.key === target.slot)?.label ?? target.slot;
  const add = (input: Parameters<typeof addPlanItem>[1]) =>
    start(async () => {
      try {
        await addPlanItem(planId, input);
        onClose();
      } catch (e) {
        err(e);
      }
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${slotLabel} · ${dayLabel(target.date)}`} description="Elige una receta guardada o escribe un plato libre.">
        <div className="mb-3 flex gap-1 rounded-lg bg-paper-2 p-1 text-sm">
          <button type="button" className={cn("flex-1 rounded-md py-1", !free && "bg-paper shadow-sm")} onClick={() => setFree(false)}>
            Receta
          </button>
          <button type="button" className={cn("flex-1 rounded-md py-1", free && "bg-paper shadow-sm")} onClick={() => setFree(true)}>
            Plato libre
          </button>
        </div>
        {free ? (
          <form
            className="space-y-3"
            action={(fd) => add({ date: target.date, mealSlot: target.slot, title: String(fd.get("title")), note: String(fd.get("ing") || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => (l.startsWith("- ") ? l : `- ${l}`)).join("\n") || null })}
          >
            <Field label="Plato">
              <Input name="title" required maxLength={200} placeholder="Tortilla de patatas y ensalada" autoFocus />
            </Field>
            <Field label="Ingredientes (opcional)" hint="Uno por línea; irán a la lista de la compra">
              <Textarea name="ing" rows={4} placeholder={"6 huevos\n500 g patatas\n1 cebolla"} />
            </Field>
            <Button type="submit" className="w-full" disabled={pending}>
              Añadir
            </Button>
          </form>
        ) : (
          <div className="space-y-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar receta o etiqueta" autoFocus />
            {recipes.length ? (
              <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto">
                {list.map((r) => (
                  <li key={r.id}>
                    <button type="button" disabled={pending} onClick={() => add({ date: target.date, mealSlot: target.slot, recipeId: r.id })} className="flex w-full items-center gap-2 py-2 text-left hover:text-herb">
                      <span className="flex-1 text-sm font-medium">{r.title}</span>
                      <span className="num text-xs text-ink-3">
                        {r.kcal ? `${Math.round(r.kcal)} kcal` : ""} {r.prepMin ? `· ${r.prepMin}′` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-center text-sm text-ink-3">
                Aún no hay recetas. <Link href="/recetas/nueva" className="text-herb underline">Crea una</Link> o usa «Plato libre».
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PersonPicker({ members, value, onChange }: { members: Member[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {members.map((m) => {
        const on = value.includes(m.id);
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== m.id) : [...value, m.id])}
            className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm", on ? "border-herb bg-herb/10 text-herb" : "border-line text-ink-2")}
          >
            <span className="size-2 rounded-full" style={{ background: m.color ?? "var(--color-herb)" }} />
            {m.name}
            {m.isChild ? <span className="text-xs text-ink-3">(niño)</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function PersonsDialog({ planId, members, selected }: { planId: string; members: Member[]; selected: string[] }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(selected);
  const [pending, start] = useSafeTransition();
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Users /> {selected.length} {selected.length === 1 ? "persona" : "personas"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="¿Quién come este plan?" description="Los platos nuevos se reparten según los objetivos de cada uno.">
          <PersonPicker members={members} value={value} onChange={setValue} />
          <Button
            className="mt-4 w-full"
            disabled={pending || !value.length}
            onClick={() =>
              start(async () => {
                await setPlanPersons(planId, value);
                setOpen(false);
              })
            }
          >
            Guardar
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StartPlan(props: { week: string; members: Member[]; currentPersonId: string; prevPlan: { id: string; label: string } | null; canAi: boolean; slots: Slot[]; defaultSlots: string[]; recipes: Recipe[]; today: string; days: string[]; timezone: string }) {
  const [value, setValue] = useState(() => props.members.map((m) => m.id));
  const [pending, start] = useSafeTransition();
  return (
    <Card className="mx-auto max-w-xl space-y-4 text-center">
      <ChefHat className="mx-auto size-10 text-herb" />
      <div>
        <h2 className="font-display text-lg font-semibold">Sin plan para esta semana</h2>
        <p className="text-sm text-ink-2">Elige quién come en casa y empieza a llenar la semana.</p>
      </div>
      <div className="flex justify-center">
        <PersonPicker members={props.members} value={value} onChange={setValue} />
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button disabled={pending || !value.length} onClick={() => start(async () => void (await createPlan(props.week, value)))}>
          {pending ? <Loader2 className="animate-spin" /> : <Plus />} Empezar a mano
        </Button>
        {props.canAi ? <GenerateDialog {...props} personIds={value} /> : null}
        {props.prevPlan ? (
          <Button variant="outline" disabled={pending} onClick={() => start(async () => void (await copyWeek(props.prevPlan!.id, props.week)))}>
            <Copy /> Repetir la del {props.prevPlan.label}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

type Draft = Awaited<ReturnType<typeof generatePlanDraft>>;

function GenerateDialog({ week, personIds, slots, defaultSlots, members, recipes }: { week: string; personIds: string[]; slots: Slot[]; defaultSlots: string[]; members: Member[]; recipes: Recipe[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useSafeTransition();
  const [chosen, setChosen] = useState<string[]>(() => defaultSlots.filter((s) => s !== "breakfast"));
  const [draft, setDraft] = useState<Draft | null>(null);
  const names = new Map(members.map((m) => [m.id, m.name]));
  const recipeIds = new Set(recipes.map((r) => r.id));
  const slotLabel = (k: string) => slots.find((s) => s.key === k)?.label ?? k;

  return (
    <>
      <Button size="sm" variant="accent" onClick={() => setOpen(true)} disabled={!personIds.length}>
        <Sparkles /> Generar con IA
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent title={draft ? "Propuesta de la semana" : "Planificar con IA"} description={draft ? "Revísala: solo se añadirán los huecos que estén libres." : "Usa los objetivos, condiciones, gustos aprendidos, la despensa y vuestras recetas."} className="max-w-2xl">
          {!draft ? (
            <form
              className="space-y-3"
              action={(fd) =>
                start(async () => {
                  try {
                    const r = await generatePlanDraft({
                      weekStart: week,
                      personIds,
                      days: Number(fd.get("days") || 7),
                      slots: chosen,
                      maxPrepMinWeekday: Number(fd.get("prep") || 0) || null,
                      budgetPerDay: Number(fd.get("budget") || 0) || null,
                      notes: String(fd.get("notes") || "") || null,
                    });
                    setDraft(r);
                  } catch (e) {
                    err(e);
                  }
                })
              }
            >
              <Field label="Comidas a planificar">
                <div className="flex flex-wrap gap-2">
                  {slots.map((s) => (
                    <label key={s.key} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={chosen.includes(s.key)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, s.key] : c.filter((x) => x !== s.key)))} />
                      {s.label}
                    </label>
                  ))}
                </div>
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Días">
                  <Input name="days" type="number" min={1} max={7} defaultValue={7} />
                </Field>
                <Field label="Máx. min entre semana">
                  <Input name="prep" type="number" min={5} max={240} placeholder="40" />
                </Field>
                <Field label="€ / día">
                  <Input name="budget" type="number" min={1} step="any" placeholder="25" />
                </Field>
              </div>
              <Field label="Indicaciones" hint="p. ej. «pescado dos veces», «el jueves cenamos fuera», «cocinar el domingo para varios días»">
                <Textarea name="notes" rows={3} maxLength={1000} />
              </Field>
              <Button type="submit" className="w-full" disabled={pending || !chosen.length}>
                {pending ? (
                  <>
                    <Loader2 className="animate-spin" /> Pensando el menú…
                  </>
                ) : (
                  <>
                    <Sparkles /> Proponer menú
                  </>
                )}
              </Button>
            </form>
          ) : (
            <div className="space-y-3">
              <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
                {draft.days.map((d) => (
                  <div key={d.date}>
                    <p className="text-sm font-semibold capitalize">{dayLabel(d.date)}</p>
                    <ul className="mt-1 space-y-1">
                      {d.meals.map((m, i) => (
                        <li key={i} className="rounded-md bg-paper-2 px-2 py-1.5 text-sm">
                          <span className="text-xs text-ink-3">{slotLabel(m.mealSlot)} · </span>
                          <b className="font-medium">{m.title}</b> {m.recipeId && recipeIds.has(m.recipeId) ? <Badge tone="herb">receta</Badge> : null}
                          {m.prepMin ? <span className="num text-xs text-ink-3"> · {m.prepMin}′</span> : null}
                          <span className="block text-xs text-ink-3">
                            {m.servingsByPerson.map((s) => `${(names.get(s.personId) ?? "?").split(" ")[0]} ${s.servings}`).join(" · ")}
                            {m.why ? ` — ${m.why}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {draft.notes ? <p className="text-sm text-ink-2">{draft.notes}</p> : null}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setDraft(null)} disabled={pending}>
                  Otra propuesta
                </Button>
                <Button
                  className="flex-1"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      try {
                        const r = await applyPlanDraft(draft.estimateId, week, personIds);
                        toast.success(`${r.added} platos añadidos al plan`);
                        setDraft(null);
                        setOpen(false);
                      } catch (e) {
                        err(e);
                      }
                    })
                  }
                >
                  <Check /> Usar este menú
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

