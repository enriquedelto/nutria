"use client";
import { minutesToClock, trainingMealTiming, type GroupedMeal } from "@nutria/nutrition";
import { MealTimingChart } from "@/components/charts/weight-chart";
import { cn } from "@/lib/utils";

const dur = (min: number) => {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
};

/**
 * The day's meals around the session: a time line and how the pre-workout meal (1–3 h before,
 * ~1 g/kg carbs) and post-workout protein (0.3–0.4 g/kg within 2 h) landed.
 */
export function TrainingMeals({ session, meals, weightKg, nowMin }: { session: { start: number; end: number }; meals: GroupedMeal[]; weightKg: number; /** Current minute of the day in the person's zone (from the server, so SSR and hydration agree); null for past days. */ nowMin: number | null }) {
  const t = trainingMealTiming(meals, session, weightKg);
  const now = nowMin ?? 24 * 60;
  const pre: [number, number] = [session.start - 180, session.start - 60];
  const post: [number, number] = [session.end, session.end + 120];
  const approx = (a: boolean) => (a ? " (hora aprox.)" : "");
  const [lo, hi] = t.post.proteinTargetG;

  let preText: string;
  let preOk: boolean | null = t.pre.verdict === "ok";
  switch (t.pre.verdict) {
    case "ok":
      preText = `Comida previa ${dur(t.pre.gapMin!)} antes${approx(t.pre.approx)}, ${t.pre.carbsG} g de hidratos en las 4 h previas.`;
      break;
    case "too_close":
      preText = `La comida con hidratos fue solo ${dur(t.pre.gapMin!)} antes${approx(t.pre.approx)}: si es abundante puede sentar pesada. Mejor de 1 a 3 h antes, o algo ligero si es tan cerca.`;
      break;
    case "too_early":
      preText = `La última comida con hidratos fue ${dur(t.pre.gapMin!)} antes${approx(t.pre.approx)}. Algo con hidratos 1–3 h antes (≈ ${t.pre.carbsTargetG} g) llega mejor al entreno.`;
      break;
    case "low_carbs":
      preText = `Comiste ${dur(t.pre.gapMin!)} antes${approx(t.pre.approx)}, pero solo ${t.pre.carbsG} g de hidratos en las 4 h previas (≈ ${t.pre.carbsTargetG} g recomendados).`;
      break;
    default:
      if (now < session.start) {
        preOk = null;
        preText = `Para entrenar a las ${minutesToClock(session.start)}: come entre las ${minutesToClock(pre[0])} y las ${minutesToClock(pre[1])}, con ≈ ${t.pre.carbsTargetG} g de hidratos.`;
      } else preText = "Sin comida con hidratos registrada antes del entreno.";
  }

  let postText: string;
  let postOk: boolean | null = t.post.verdict === "ok";
  switch (t.post.verdict) {
    case "ok":
      postText = `Después: ${dur(t.post.delayMin!)} más tarde${approx(t.post.approx)}, ${t.post.proteinG} g de proteína.`;
      break;
    case "low_protein":
      postText = `Después: ${t.post.proteinG} g de proteína en las 2 h siguientes (${lo}–${hi} g recomendados).`;
      break;
    case "late":
      postText = `La primera comida tras entrenar fue ${dur(t.post.delayMin!)} después. Importa poco si llegas a la proteína del día, pero ${lo}–${hi} g en 2 h ayudan.`;
      break;
    default:
      postOk = null;
      postText = now < post[1] ? `Después: ${lo}–${hi} g de proteína antes de las ${minutesToClock(post[1])}.` : "Sin comida registrada tras el entreno.";
  }

  return (
    <div className="space-y-2">
      <MealTimingChart
        data={meals.map((m) => ({ t: m.at, carbs: Math.round(m.carbs), protein: Math.round(m.protein), approx: !!m.approx, label: m.names.slice(0, 3).join(", ") }))}
        session={session}
        pre={pre}
        post={post}
      />
      <ul className="space-y-1 text-sm">
        <Verdict ok={preOk} text={preText} />
        <Verdict ok={postOk} text={postText} />
      </ul>
      {meals.some((m) => m.approx) ? <p className="text-xs text-ink-3">Las barras claras usan la hora habitual de la comida: pon la hora real al registrar para afinar.</p> : null}
    </div>
  );
}

function Verdict({ ok, text }: { ok: boolean | null; text: string }) {
  return (
    <li className="flex gap-2">
      <span className={cn("mt-0.5 shrink-0 font-semibold", ok === true ? "text-ok" : ok === false ? "text-persimmon" : "text-ink-3")} aria-hidden>
        {ok === true ? "✓" : ok === false ? "!" : "·"}
      </span>
      <span>{text}</span>
    </li>
  );
}
