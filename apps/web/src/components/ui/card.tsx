import { cn } from "@/lib/utils";

export function Card({ className, ...p }: React.ComponentProps<"section">) {
  return <section className={cn("rounded-card border border-line bg-card p-4 shadow-[0_1px_0_0_var(--line)]", className)} {...p} />;
}

export function CardHeader({ title, action, subtitle, className }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold leading-tight">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
