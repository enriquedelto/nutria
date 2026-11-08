"use client";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { errorText } from "@/lib/errors";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Empty title="Algo ha fallado">
      <p>{errorText(error, "No se ha podido cargar esta página.")}</p>
      <Button className="mt-3" variant="outline" onClick={reset}>
        Reintentar
      </Button>
    </Empty>
  );
}
