import { WifiOff } from "lucide-react";

export const metadata = { title: "Sin conexión" };

export default function Offline() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <WifiOff className="size-10 text-ink-3" />
      <h1 className="text-2xl font-semibold">Sin conexión</h1>
      <p className="text-ink-2">
        Puedes seguir apuntando comidas desde <strong>Hoy</strong> o <strong>Buscar</strong> si ya las tenías abiertas: se guardan en el
        móvil y se envían solas cuando vuelva la conexión.
      </p>
      <a href="/hoy" className="rounded-full bg-herb px-5 py-2.5 font-medium text-herb-ink">Reintentar</a>
    </main>
  );
}
