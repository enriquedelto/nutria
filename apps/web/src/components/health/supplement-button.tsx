"use client";
import { useOptimistic, useState } from "react";
import { useRouter } from "next/navigation";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { diaryOp } from "@/lib/offline-queue";
import { errorText } from "@/lib/errors";
import { cn } from "@/lib/utils";

/** Mark today's dose of a supplement plan (logs it in the diary). */
export function SupplementButton({ personId, scheduleId, date, taken, name, disabled }: { personId: string; scheduleId: string; date: string; taken: boolean; name: string; disabled?: boolean }) {
  const [queued, setQueued] = useState<boolean | null>(null);
  const [t, set] = useOptimistic(queued ?? taken);
  const router = useRouter();
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
            const r = await diaryOp({ op: "supplement", personId, scheduleId, date, taken: !t });
            if (r.queued) setQueued(!t);
            else {
              setQueued(null);
              router.refresh();
            }
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
