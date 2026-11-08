import { Children, cloneElement, isValidElement, useId } from "react";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-xl border border-line bg-card px-3 text-ink placeholder:text-ink-3 focus:border-herb focus:outline-none focus:ring-2 focus:ring-herb/25 disabled:opacity-60";

const chevron =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

export function Input({ className, ...p }: React.ComponentProps<"input">) {
  return <input className={cn(field, "h-11", className)} {...p} />;
}

export function Textarea({ className, ...p }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(field, "min-h-24 py-2", className)} {...p} />;
}

export function Select({ className, style, ...p }: React.ComponentProps<"select">) {
  return <select className={cn(field, "h-11 appearance-none bg-[length:1rem] bg-[right_0.75rem_center] bg-no-repeat pr-9", className)} style={{ backgroundImage: chevron, ...style }} {...p} />;
}

export function Label({ className, ...p }: React.ComponentProps<"label">) {
  return <label className={cn("mb-1 block text-sm font-medium text-ink-2", className)} {...p} />;
}

const FORM_CONTROLS: unknown[] = [Input, Textarea, Select, "input", "select", "textarea"];

/**
 * Label + control + hint. When the only child is a form control, the label is tied to it
 * (htmlFor/id) and the hint becomes its description, so screen readers and getByLabel work.
 */
export function Field({ label, hint, error, children, className, htmlFor }: { label: React.ReactNode; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string; htmlFor?: string }) {
  const auto = useId();
  const only = Children.count(children) === 1 && isValidElement<{ id?: string; "aria-describedby"?: string }>(children) && FORM_CONTROLS.includes(children.type) ? children : null;
  const id = htmlFor ?? only?.props.id ?? (only ? auto : undefined);
  const descId = (hint || error) && only ? `${auto}-d` : undefined;
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={id}>{label}</Label>
      {only ? cloneElement(only, { id, "aria-describedby": [only.props["aria-describedby"], descId].filter(Boolean).join(" ") || undefined }) : children}
      {error ? <p id={descId} className="text-sm text-danger">{error}</p> : hint ? <p id={descId} className="text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}
