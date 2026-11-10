import Link from "next/link";
import { Dumbbell } from "lucide-react";
import type { TrainingDayPlan } from "@nutria/core";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const PHASE_TEXT: Record<TrainingDayPlan["phase"], string> = {
  early: "Hoy toca entreno",
  pre: "Buen momento para la comida de antes",
  soon: "Entrenas enseguida: si tienes hambre, algo ligero de hidratos",
  during: "Entrenando",
  post: "Toca la comida de después",
  late: "Entreno hecho",
};

/** Training day: what to eat before and after, at the usual (or real) training time. */
export function TrainingCard({ plan, proteinLeft }: { plan: TrainingDayPlan; proteinLeft: number | null }) {
  const t = plan.timing;
  const before = plan.phase === "early" || plan.phase === "pre" || plan.phase === "soon";
  const after = plan.phase === "post" || plan.phase === "during";
  const [lo, hi] = t.postProteinG;
  return (
    <Card id="entreno" className="sm:col-span-2">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Dumbbell className="size-4 text-persimmon" aria-hidden /> {PHASE_TEXT[plan.phase]}
          </span>
        }
        subtitle={plan.done ? `Entreno de ${t.start} a ${t.end}` : plan.known ? `Sueles entrenar hacia las ${t.start}` : "Aún no sé a qué hora entrenas: supongo las 18:30"}
      />
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <div className={cn("rounded-xl p-3", before ? "bg-herb-soft/60" : "bg-paper-2", plan.done || plan.phase === "late" ? "opacity-60" : "")}>
          <p className="font-medium">
            Antes <span className="num font-normal text-ink-2">· {t.preFrom}–{t.preTo}</span>
          </p>
          <p className="text-ink-2">
            Hidratos fáciles (≈ {t.preCarbsG} g: arroz, pasta, pan, fruta) con algo de proteína y poca grasa, de 1 a 3 h antes.
          </p>
        </div>
        <div className={cn("rounded-xl p-3", after ? "bg-herb-soft/60" : "bg-paper-2")}>
          <p className="font-medium">
            Después <span className="num font-normal text-ink-2">· antes de las {t.postUntil}</span>
          </p>
          <p className="text-ink-2">
            {lo}–{hi} g de proteína con hidratos en las 2 h siguientes.
          </p>
        </div>
      </div>
      {plan.ideas.length ? (
        <p className="mt-3 text-sm text-ink-2">
          <span className="font-medium text-ink">Ideas tuyas con proteína:</span>{" "}
          {plan.ideas.map((i, n) => (
            <span key={i.foodId}>
              {n ? " · " : ""}
              <Link href={`/alimentos/${i.foodId}`} className="text-herb hover:underline">
                {i.name}
              </Link>{" "}
              <span className="num text-xs text-ink-3">
                ({i.grams} g → {i.protein} g)
              </span>
            </span>
          ))}
        </p>
      ) : null}
      {proteinLeft != null && proteinLeft >= 20 ? (
        <p className="mt-2 text-xs text-ink-3">
          Te quedan <span className="num font-medium text-ink-2">{proteinLeft} g</span> de proteína hoy, unas {Math.max(1, Math.round(proteinLeft / plan.proteinDoseG))} tomas de {plan.proteinDoseG} g.
        </p>
      ) : null}
    </Card>
  );
}
