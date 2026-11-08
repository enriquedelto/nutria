import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badge = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "bg-paper-2 text-ink-2",
      herb: "bg-herb-soft text-herb",
      accent: "bg-persimmon-soft text-persimmon",
      danger: "bg-danger/12 text-danger",
      warn: "bg-warn/20 text-ink",
      ok: "bg-ok/15 text-ok",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...p }: React.ComponentProps<"span"> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...p} />;
}
