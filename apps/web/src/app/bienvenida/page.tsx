import { Suspense } from "react";
import Link from "next/link";
import { BellRing, ChefHat, MessageCircle, ScanBarcode, Smartphone, Users } from "lucide-react";
import { and, eq, listAccessiblePersons, persons } from "@nutria/db";
import { latestWeight } from "@nutria/core";
import { ALLERGEN_TAGS } from "@nutria/nutrition";
import { ProfileForm } from "@/app/(app)/ajustes/profile-form";
import { PushToggle } from "@/app/(app)/ajustes/notificaciones/notify-client";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export const metadata = { title: "Bienvenida" };

const TIMEZONES = ["Europe/Madrid", "Atlantic/Canary", "Europe/Lisbon", "Europe/London", "Europe/Paris", "America/Mexico_City", "America/Bogota", "America/Argentina/Buenos_Aires", "UTC"];

const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <section className="space-y-3">
    <h2 className="flex items-center gap-3 font-display text-lg font-semibold">
      <span className="num grid size-7 place-items-center rounded-full bg-herb text-sm text-white">{n}</span>
      {title}
    </h2>
    {children}
  </section>
);

async function Content() {
  const me = await getCurrentUser();
  const [[own], shared] = await Promise.all([db().select().from(persons).where(and(eq(persons.userId, me.id))).limit(1), listAccessiblePersons(db(), me.id)]);

  if (!own) {
    return (
      <Card className="space-y-3">
        <CardHeader title={`Hola, ${me.name.split(" ")[0]}`} subtitle={shared.length ? "Tienes acceso a datos que te han compartido." : "Todavía nadie te ha compartido datos, o el acceso ha caducado."} />
        {shared.length ? (
          <Button asChild>
            <Link href="/familia">Ver personas</Link>
          </Button>
        ) : (
          <p className="text-sm text-ink-2">Pide a la persona que te invitó que vuelva a compartir su información contigo.</p>
        )}
      </Card>
    );
  }

  const weight = await latestWeight(db(), own.id);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-semibold">Hola, {me.name.split(" ")[0]} 👋</h1>
        <p className="mt-1 text-ink-2">Tres pasos y listo. Todo se puede cambiar luego en Ajustes.</p>
      </div>

      <Step n={1} title="Tus datos">
        <p className="text-sm text-ink-2">Con la edad, la altura, el peso, la actividad y el objetivo se calculan tus calorías, macros y micronutrientes (IR de la EFSA). Si apuntas alergias, la app te avisará al escanear.</p>
        <Card>
          <ProfileForm
            personId={own.id}
            isChild={own.isChild}
            allergens={Object.entries(ALLERGEN_TAGS).map(([code, a]) => ({ code, name: a.nameEs }))}
            timezones={TIMEZONES.includes(own.timezone) ? TIMEZONES : [own.timezone, ...TIMEZONES]}
            initial={{
              displayName: own.displayName,
              avatarColor: own.avatarColor,
              sex: own.sex,
              birthDate: own.birthDate,
              heightCm: own.heightCm,
              weightKg: weight?.kg ?? null,
              activityLevel: own.activityLevel,
              goalType: own.goalType,
              weeklyRateKg: own.weeklyRateKg,
              pregnancy: own.pregnancy as never,
              dietPattern: own.dietPattern,
              allergens: own.allergens,
              dislikes: own.dislikes,
              preferencesMd: own.preferencesMd,
              timezone: own.timezone,
            }}
          />
        </Card>
      </Step>

      <Step n={2} title="Avisos e instalación">
        <Card className="space-y-4">
          <div className="flex gap-3">
            <BellRing className="mt-0.5 size-5 shrink-0 text-herb" />
            <div className="flex-1 space-y-2">
              <p className="text-sm text-ink-2">Recordatorios de comidas, agua, medicación, ayuno y caducidades. Tú eliges cuáles.</p>
              <PushToggle vapidKey={process.env.VAPID_PUBLIC_KEY ?? null} />
            </div>
          </div>
          <div className="flex gap-3">
            <Smartphone className="mt-0.5 size-5 shrink-0 text-herb" />
            <p className="text-sm text-ink-2">
              <b className="font-medium text-ink">Instálala como app.</b> En Android: menú ⋮ → «Instalar aplicación». En iPhone/iPad: Compartir → «Añadir a pantalla de inicio». Así podrás compartir recetas y fotos directamente a Nutria.
            </p>
          </div>
        </Card>
      </Step>

      <Step n={3} title="Por dónde empezar">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { href: "/registrar", icon: MessageCircle, title: "Registra tu primera comida", text: "Escríbela, díctala o hazle una foto: la IA la convierte en alimentos." },
            { href: "/buscar", icon: ScanBarcode, title: "Escanea un producto", text: "Código de barras con Nutri-Score, NOVA, aditivos y alérgenos." },
            { href: "/familia", icon: Users, title: "Añade a tu familia", text: "Invita a quien viva contigo o añade a los peques sin cuenta." },
            { href: "/recetas/importar", icon: ChefHat, title: "Importa una receta", text: "Pega el enlace de una web o de un vídeo de YouTube, TikTok o Instagram." },
          ].map((x) => (
            <Link key={x.href} href={x.href} className="flex gap-3 rounded-2xl border border-line bg-card p-4 hover:border-herb">
              <x.icon className="size-6 shrink-0 text-herb" />
              <span>
                <span className="block font-medium">{x.title}</span>
                <span className="text-sm text-ink-2">{x.text}</span>
              </span>
            </Link>
          ))}
        </div>
      </Step>
      {/* Sin prefetch: lo precargado al entrar sería anterior a guardar el perfil. */}
      <Button asChild size="lg" className="w-full">
        <Link href="/hoy" prefetch={false}>
          Empezar
        </Link>
      </Button>
    </div>
  );
}

export default function BienvenidaPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </main>
  );
}
