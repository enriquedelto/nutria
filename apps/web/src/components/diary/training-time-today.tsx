"use client";
import { useState } from "react";
import { toast } from "sonner";
import { setTrainingTimeToday } from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSafeTransition } from "@/lib/use-safe-transition";

/** «Cambiar hora» on today's training card: a start time for today only (or back to the usual one). */
export function TrainingTimeToday({ personId, start, isToday }: { personId: string; start: string; isToday: boolean }) {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(start);
  const [pending, run] = useSafeTransition();
  const save = (t: string | null) =>
    run(async () => {
      await setTrainingTimeToday(personId, t);
      toast.success(t ? `Hoy entrenas a las ${t}` : "Vuelve a tu hora de siempre");
      setOpen(false);
    });
  if (!open)
    return (
      <span className="inline-flex flex-wrap gap-x-3">
        <button type="button" className="text-herb underline" onClick={() => setOpen(true)}>
          Cambiar hora
        </button>
        {isToday ? (
          <button type="button" className="text-ink-3 underline" disabled={pending} onClick={() => save(null)}>
            Usar la de siempre
          </button>
        ) : null}
      </span>
    );
  return (
    <form
      className="mt-1 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (time) save(time);
      }}
    >
      <Input type="time" aria-label="Hora de entreno de hoy" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" required />
      <Button type="submit" size="sm" disabled={pending}>
        Solo hoy
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancelar
      </Button>
    </form>
  );
}
