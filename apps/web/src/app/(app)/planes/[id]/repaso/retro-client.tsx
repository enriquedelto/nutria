"use client";
import { errorText } from "@/lib/errors";
import { useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { Check, Loader2, Meh, Sparkles, ThumbsDown, ThumbsUp, Utensils } from "lucide-react";
import { toast } from "sonner";
import { applyRetro, retroProposal, saveRetroAnswers } from "@/actions/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Verdict = "like" | "dislike" | "neutral";
type Answer = { verdict?: Verdict; notEaten?: boolean; stars?: number };
type Person = { id: string; name: string; color: string | null };
type Item = { id: string; date: string; title: string; recipeId: string | null; cooked: boolean; eaters: string[] };

const day = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", timeZone: "UTC" });

export function RetroClient(props: {
  planId: string;
  done: boolean;
  canAi: boolean;
  householdMd: string;
  people: Person[];
  defaultPersonId: string;
  items: Item[];
  answers: Record<string, { items: Record<string, Answer>; comment: string }>;
}) {
  const [who, setWho] = useState(props.defaultPersonId);
  const [all, setAll] = useState(props.answers);
  const [pending, start] = useSafeTransition();
  const mine = all[who] ?? { items: {}, comment: "" };
  const items = props.items.filter((i) => !i.eaters.length || i.eaters.includes(who));
  const set = (itemId: string, patch: Answer) => setAll((a) => ({ ...a, [who]: { ...mine, items: { ...mine.items, [itemId]: { ...mine.items[itemId], ...patch } } } }));
  const answered = Object.keys(all).filter((pid) => Object.keys(all[pid]?.items ?? {}).length);

  if (!props.items.length) return <Card className="text-center text-sm text-ink-2">Esta semana no tenía platos planificados.</Card>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {props.people.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setWho(p.id)}
            className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm", who === p.id ? "border-herb bg-herb/10 text-herb" : "border-line text-ink-2")}
          >
            <span className="size-2 rounded-full" style={{ background: p.color ?? "var(--color-herb)" }} />
            {p.name}
            {answered.includes(p.id) ? <Check className="size-3.5" /> : null}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader title={`Platos de ${props.people.find((p) => p.id === who)?.name ?? ""}`} subtitle="Marca qué tal fue cada uno. Lo que no se valore no cuenta." />
        <ul className="divide-y divide-line">
          {items.map((i) => {
            const a = mine.items[i.id] ?? {};
            return (
              <li key={i.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{i.title}</p>
                  <p className="text-xs text-ink-3 capitalize">
                    {day.format(new Date(`${i.date}T12:00:00Z`))} {!i.cooked ? <Badge tone="warn">sin marcar como hecho</Badge> : null}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {(
                    [
                      ["like", ThumbsUp, "Le gustó", "text-ok"],
                      ["neutral", Meh, "Normal", "text-ink-2"],
                      ["dislike", ThumbsDown, "No le gustó", "text-danger"],
                    ] as const
                  ).map(([v, Icon, label, tone]) => (
                    <Button key={v} size="icon-sm" variant={a.verdict === v ? "soft" : "ghost"} aria-label={label} title={label} aria-pressed={a.verdict === v} onClick={() => set(i.id, { verdict: a.verdict === v ? undefined : v, notEaten: false })}>
                      <Icon className={cn(a.verdict === v && tone)} />
                    </Button>
                  ))}
                  <Button size="sm" variant={a.notEaten ? "soft" : "ghost"} aria-pressed={!!a.notEaten} onClick={() => set(i.id, { notEaten: !a.notEaten, verdict: undefined })}>
                    <Utensils className={cn(a.notEaten && "text-persimmon")} /> No lo comió
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <Field label="Comentario de la semana" className="mt-3">
          <Textarea rows={2} maxLength={2000} value={mine.comment} onChange={(e) => setAll((x) => ({ ...x, [who]: { ...mine, comment: e.target.value } }))} placeholder="Demasiado pescado, la cena del martes fue muy pesada…" />
        </Field>
        <Button
          className="mt-3"
          disabled={pending}
          onClick={() =>
            start(async () => {
              try {
                await saveRetroAnswers(props.planId, who, mine.items, mine.comment);
                toast.success("Valoración guardada");
              } catch (e) {
                toast.error(errorText(e, "Error"));
              }
            })
          }
        >
          Guardar valoración
        </Button>
      </Card>

      {props.canAi ? <Learn planId={props.planId} done={props.done} ready={answered.length > 0} currentHousehold={props.householdMd} /> : null}
    </div>
  );
}

type Proposal = Awaited<ReturnType<typeof retroProposal>>;

function Learn({ planId, done, ready, currentHousehold }: { planId: string; done: boolean; ready: boolean; currentHousehold: string }) {
  const [pending, start] = useSafeTransition();
  const [p, setP] = useState<Proposal | null>(null);
  const [household, setHousehold] = useState("");
  const [per, setPer] = useState<Record<string, string>>({});

  return (
    <Card>
      <CardHeader
        title="Aprender de la semana"
        subtitle={done ? "Esta semana ya se usó para actualizar los gustos; puedes repetirlo si cambian las valoraciones." : "La IA resume lo que ha gustado y actualiza las preferencias que usa el planificador. Tú revisas el texto antes de guardarlo."}
      />
      {!p ? (
        <>
          {currentHousehold ? (
            <details className="mb-3 text-sm">
              <summary className="cursor-pointer text-ink-2">Preferencias actuales del hogar</summary>
              <pre className="mt-2 font-sans text-sm whitespace-pre-wrap text-ink-2">{currentHousehold}</pre>
            </details>
          ) : null}
          <Button
            variant="accent"
            disabled={pending || !ready}
            onClick={() =>
              start(async () => {
                try {
                  const r = await retroProposal(planId);
                  setP(r);
                  setHousehold(r.householdMd);
                  setPer(Object.fromEntries(r.perPerson.map((x) => [x.personId, x.preferencesMd])));
                } catch (e) {
                  toast.error(errorText(e, "Error de la IA"));
                }
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <Sparkles />} {ready ? "Proponer cambios" : "Primero guarda alguna valoración"}
          </Button>
        </>
      ) : (
        <div className="space-y-3">
          <Field label="Gustos del hogar" hint="Markdown; lo lee el planificador en cada propuesta">
            <Textarea rows={8} value={household} onChange={(e) => setHousehold(e.target.value)} />
          </Field>
          {p.perPerson.map((x) => (
            <Field key={x.personId} label={`Gustos de ${p.names[x.personId] ?? "persona"}`}>
              <Textarea rows={5} value={per[x.personId] ?? ""} onChange={(e) => setPer((v) => ({ ...v, [x.personId]: e.target.value }))} />
            </Field>
          ))}
          <div className="flex gap-2">
            <Button variant="outline" disabled={pending} onClick={() => setP(null)}>
              Descartar
            </Button>
            <Button
              className="flex-1"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  try {
                    await applyRetro(planId, p.estimateId, household, Object.entries(per).map(([personId, preferencesMd]) => ({ personId, preferencesMd })));
                    toast.success("Preferencias actualizadas");
                    setP(null);
                  } catch (e) {
                    toast.error(errorText(e, "Error"));
                  }
                })
              }
            >
              <Check /> Guardar preferencias
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
