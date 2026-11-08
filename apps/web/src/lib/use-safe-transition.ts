"use client";
import { useCallback, useTransition } from "react";
import { toast } from "sonner";
import { errorText } from "./errors";

/**
 * useTransition whose callback errors become a toast instead of blanking the page.
 * Next.js navigation signals (redirect/notFound) are rethrown so the router handles them.
 */
export function useSafeTransition() {
  const [pending, startTransition] = useTransition();
  const start = useCallback(
    (fn: () => unknown) =>
      startTransition(async () => {
        try {
          await fn();
        } catch (e) {
          const d = (e as { digest?: unknown } | null)?.digest;
          if (typeof d === "string" && d.startsWith("NEXT_")) throw e;
          toast.error(errorText(e));
        }
      }),
    [],
  );
  return [pending, start] as const;
}
