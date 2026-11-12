import { Skeleton } from "@/components/ui/empty";

/** Instant feedback while a page's server part loads (the chrome in layout.tsx stays interactive). */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
