"use client";
import { useOptimistic } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { markSupplement } from "@/actions/health";
import { errorText } from "@/lib/errors";
import { cn } from "@/lib/utils";

/** Mark today's dose of a supplement plan (logs it in the diary). */
export function SupplementButton({ personId, scheduleId, date, taken, name, disabled }: { personId: string; scheduleId: string; date: string; taken: boolean; name: string; disabled?: boolean }) {
  const [t, set] = useOptimistic(taken);
  const [, start] = useSafeTransition();
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={t}
      aria-label={t ? `${name}: tomada` : `Marcar ${name} como tomada`}
      onClick={() =>
        start(async () => {
          set(!t);
          try {
            await markSupplement(personId, scheduleId, date, !t);
          } catch (e) {
            toast.error(errorText(e, "Error"));
          }
        })
      }
      className={cn("inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-medium", t ? "border-ok bg-ok/15 text-ok" : "border-line hover:bg-paper-2")}
    >
      {t ? <Check className="size-3.5" /> : null}
      {t ? "Tomada" : "Marcar"}
    </button>
  );
}
