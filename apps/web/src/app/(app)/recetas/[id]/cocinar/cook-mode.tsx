"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ListChecks, Pause, Play, Timer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Step = { text: string; timerSec: number | null };

/** Durations mentioned in a step ("10 minutos", "1 h", "30-40 min" → upper bound). */
function detectTimers(text: string): number[] {
  const out: number[] = [];
  const re = /(\d+(?:[.,]\d+)?)(?:\s*[-–a]\s*(\d+(?:[.,]\d+)?))?\s*(h|horas?|min|minutos?|seg|segundos?)\b/gi;
  for (const m of text.matchAll(re)) {
    const v = Number((m[2] ?? m[1])!.replace(",", "."));
    const u = m[3]!.toLowerCase();
    out.push(Math.round(u.startsWith("h") ? v * 3600 : u.startsWith("s") ? v : v * 60));
  }
  return [...new Set(out)].filter((s) => s > 0 && s <= 86400).slice(0, 3);
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

type RunningTimer = { id: number; label: string; total: number; endsAt: number | null; left: number };

export function CookMode({ id, title, steps, ingredients }: { id: string; title: string; steps: Step[]; ingredients: string[] }) {
  const [i, setI] = useState(0);
  const [showIngs, setShowIngs] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [timers, setTimers] = useState<RunningTimer[]>([]);
  const [, tick] = useState(0);
  const seq = useRef(0);

  // Keep the screen on while cooking.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const req = async () => {
      try {
        lock = await navigator.wakeLock?.request("screen");
      } catch {}
    };
    void req();
    const onVis = () => document.visibilityState === "visible" && void req();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release();
    };
  }, []);

  useEffect(() => {
    if (!timers.some((t) => t.endsAt)) return;
    const h = setInterval(() => {
      tick((x) => x + 1);
      setTimers((ts) =>
        ts.map((t) => {
          if (!t.endsAt) return t;
          const left = Math.max(0, (t.endsAt - Date.now()) / 1000);
          if (left === 0 && t.left > 0) {
            navigator.vibrate?.([300, 150, 300, 150, 600]);
            try {
              const ctx = new AudioContext();
              const o = ctx.createOscillator();
              o.frequency.value = 880;
              o.connect(ctx.destination);
              o.start();
              o.stop(ctx.currentTime + 0.8);
            } catch {}
            if (Notification.permission === "granted") new Notification(`⏰ ${t.label}`, { body: title, tag: `timer-${t.id}` });
          }
          return { ...t, left, endsAt: left === 0 ? null : t.endsAt };
        }),
      );
    }, 500);
    return () => clearInterval(h);
  }, [timers, title]);

  const step = steps[i];
  const suggestions = step ? (step.timerSec ? [step.timerSec] : detectTimers(step.text)) : [];
  const start = (sec: number) => setTimers((ts) => [...ts, { id: ++seq.current, label: `Paso ${i + 1} · ${fmt(sec)}`, total: sec, left: sec, endsAt: Date.now() + sec * 1000 }]);
  const toggle = (t: RunningTimer) => setTimers((ts) => ts.map((x) => (x.id !== t.id ? x : x.endsAt ? { ...x, endsAt: null } : { ...x, endsAt: Date.now() + x.left * 1000 })));

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Link href={`/recetas/${id}`} aria-label="Salir del modo cocina" className="rounded-full p-2 hover:bg-paper-2">
          <X className="size-5" />
        </Link>
        <p className="min-w-0 flex-1 truncate font-display text-lg font-semibold">{title}</p>
        <Button variant={showIngs ? "primary" : "outline"} size="sm" onClick={() => setShowIngs((x) => !x)}>
          <ListChecks /> Ingredientes
        </Button>
      </header>

      {timers.length ? (
        <div className="flex gap-2 overflow-x-auto border-b border-line px-4 py-2">
          {timers.map((t) => (
            <div key={t.id} className={cn("flex shrink-0 items-center gap-2 rounded-full border px-3 py-1", t.left === 0 ? "animate-pulse border-persimmon bg-persimmon text-white" : "border-line bg-card")}>
              <Timer className="size-4" />
              <span className="num font-semibold">{fmt(t.left)}</span>
              <span className="text-xs opacity-75">{t.label.split(" · ")[0]}</span>
              {t.left > 0 ? (
                <button type="button" aria-label={t.endsAt ? "Pausar" : "Seguir"} onClick={() => toggle(t)}>
                  {t.endsAt ? <Pause className="size-4" /> : <Play className="size-4" />}
                </button>
              ) : null}
              <button type="button" aria-label="Quitar temporizador" onClick={() => setTimers((ts) => ts.filter((x) => x.id !== t.id))}>
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="relative flex-1 overflow-y-auto">
        {showIngs ? (
          <ul className="mx-auto max-w-2xl space-y-2 p-6 text-lg">
            {ingredients.map((x, j) => (
              <li key={j}>
                <label className={cn("flex items-start gap-3", checked.has(j) && "text-ink-3 line-through")}>
                  <input type="checkbox" className="mt-1.5 size-5 accent-[var(--herb)]" checked={checked.has(j)} onChange={() => setChecked((c) => { const n = new Set(c); if (n.has(j)) n.delete(j); else n.add(j); return n; })} />
                  {x}
                </label>
              </li>
            ))}
          </ul>
        ) : step ? (
          <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-6 p-6">
            <p className="text-sm font-medium uppercase tracking-wide text-herb">
              Paso {i + 1} de {steps.length}
            </p>
            <p className="font-display text-2xl leading-snug sm:text-3xl">{step.text}</p>
            {suggestions.length ? (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <Button key={s} variant="soft" size="lg" onClick={() => start(s)}>
                    <Timer /> {fmt(s)}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="p-6 text-center text-ink-2">Esta receta no tiene pasos.</p>
        )}
      </div>

      <footer className="safe-bottom flex items-center gap-3 border-t border-line px-4 py-3">
        <Button variant="outline" size="lg" disabled={i === 0} onClick={() => setI((x) => x - 1)} aria-label="Paso anterior">
          <ChevronLeft />
        </Button>
        <div className="flex flex-1 justify-center gap-1">
          {steps.map((_, j) => (
            <button key={j} type="button" aria-label={`Ir al paso ${j + 1}`} onClick={() => setI(j)} className={cn("h-2 rounded-full transition-all", j === i ? "w-6 bg-herb" : "w-2 bg-line")} />
          ))}
        </div>
        {i < steps.length - 1 ? (
          <Button size="lg" onClick={() => setI((x) => x + 1)} aria-label="Paso siguiente">
            <ChevronRight />
          </Button>
        ) : (
          <Button asChild size="lg" variant="accent">
            <Link href={`/recetas/${id}`}>¡Listo!</Link>
          </Button>
        )}
      </footer>
    </div>
  );
}
