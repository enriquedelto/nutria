"use client";
import { RouteError } from "@/components/route-error";

export default function AuthError({ error, retry }: { error: unknown; retry: () => void }) {
  return <RouteError error={error} retry={retry} fallback="No se ha podido cargar el acceso. Prueba de nuevo en un momento." />;
}
