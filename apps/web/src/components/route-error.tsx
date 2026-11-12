"use client";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { errorText } from "@/lib/errors";

/** Shared body of the error.tsx boundaries: readable message (UserError digest) and a retry that re-fetches. */
export function RouteError({ error, retry, fallback = "No se ha podido cargar esta página." }: { error: unknown; retry: () => void; fallback?: string }) {
  return (
    <Empty title="Algo ha fallado">
      <p>{errorText(error, fallback)}</p>
      <Button className="mt-3" variant="outline" onClick={() => retry()}>
        Reintentar
      </Button>
    </Empty>
  );
}
