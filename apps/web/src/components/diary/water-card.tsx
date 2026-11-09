"use client";
import { useEffect, useOptimistic, useRef } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { useRouter, useSearchParams } from "next/navigation";
import { Droplet, Minus } from "lucide-react";
import { toast } from "sonner";
import { addWater } from "@/actions/diary";
import { Button } from "@/components/ui/button";
import { Bar } from "@/components/ui/progress";
import { n0 } from "@/lib/format";

export function WaterCard({ personId, date, ml, goal, canWrite }: { personId: string; date: string; ml: number; goal: number; canWrite: boolean }) {
  const [optimistic, add] = useOptimistic(ml, (s, d: number) => Math.max(0, s + d));
  const [, start] = useSafeTransition();
  const params = useSearchParams();
  const router = useRouter();
  const done = useRef(false);
  const log = (d: number) =>
    start(async () => {
      add(d);
      await addWater(personId, date, d);
    });

  // App shortcut: /hoy?agua=250
  useEffect(() => {
    const q = Number(params.get("agua"));
    if (!done.current && canWrite && q > 0 && q <= 2000) {
      done.current = true;
      log(q);
      toast.success(`+${q} ml de agua`);
      router.replace("/hoy");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const glasses = Math.round(optimistic / 250);
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between">
        <p className="num font-display text-3xl font-semibold">
          {(optimistic / 1000).toLocaleString("es-ES", { maximumFractionDigits: 2 })} <span className="text-base font-normal text-ink-2">/ {(goal / 1000).toLocaleString("es-ES", { maximumFractionDigits: 2 })} L</span>
        </p>
        <div className="flex gap-0.5" aria-hidden>
          {Array.from({ length: Math.min(12, Math.max(8, Math.ceil(goal / 250))) }).map((_, i) => (
            <Droplet key={i} className={`size-4 ${i < glasses ? "fill-sky-500 text-sky-500" : "text-line"}`} />
          ))}
        </div>
      </div>
      <Bar value={optimistic} max={goal} color="oklch(0.65 0.13 235)" label="Agua" />
      {canWrite ? (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => log(250)}>
            +250 ml
          </Button>
          <Button size="sm" variant="outline" onClick={() => log(500)}>
            +500 ml
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => log(-250)} aria-label="Quitar 250 ml" disabled={optimistic <= 0}>
            <Minus />
          </Button>
          <span className="ml-auto self-center text-xs text-ink-3">{n0(Math.max(0, goal - optimistic))} ml para el objetivo</span>
        </div>
      ) : null}
    </div>
  );
}
