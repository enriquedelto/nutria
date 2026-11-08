"use client";
import { useOptimistic, useTransition } from "react";
import { Check } from "lucide-react";
import { markDose } from "@/actions/health";
import { cn } from "@/lib/utils";

export function DoseButton({ personId, doseId, status, disabled }: { personId: string; doseId: string; status: string; disabled?: boolean }) {
  const [s, set] = useOptimistic(status);
  const [, start] = useTransition();
  const taken = s === "taken";
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={taken}
      onClick={() =>
        start(async () => {
          const next = taken ? "pending" : "taken";
          set(next);
          await markDose(personId, doseId, next);
        })
      }
      className={cn("inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-medium", taken ? "border-ok bg-ok/15 text-ok" : "border-line hover:bg-paper-2")}
    >
      {taken ? <Check className="size-3.5" /> : null}
      {taken ? "Tomada" : s === "skipped" ? "Omitida" : "Marcar"}
    </button>
  );
}
