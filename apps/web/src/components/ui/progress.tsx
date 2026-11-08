import { cn } from "@/lib/utils";

/** Horizontal bar; going over the target (>105%) turns it persimmon. */
export function Bar({ value, max, color = "var(--herb)", className, label }: { value: number; max: number | null | undefined; color?: string; className?: string; label?: string }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  const over = !!max && value > max * 1.05;
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-paper-2", className)} role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max ?? undefined}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: over ? "var(--persimmon)" : color }} />
    </div>
  );
}

/** Ring used for kcal on the home screen. */
export function Ring({ value, max, size = 152, stroke = 14, children }: { value: number; max: number | null | undefined; size?: number; stroke?: number; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max ? Math.min(1, value / max) : 0;
  const over = !!max && value > max * 1.05;
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--paper-2)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={over ? "var(--persimmon)" : "var(--kcal)"}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset .6s" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}
