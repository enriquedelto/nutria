import { Suspense } from "react";
import { eq, persons } from "@nutria/db";
import { ALLERGEN_TAGS } from "@nutria/nutrition";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { getPersonContext } from "@/lib/session";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "Perfil" };

const TIMEZONES = ["Europe/Madrid", "Atlantic/Canary", "Europe/Lisbon", "Europe/London", "Europe/Paris", "Europe/Berlin", "America/Mexico_City", "America/Bogota", "America/Argentina/Buenos_Aires", "America/Santiago", "America/New_York", "UTC"];

async function Content() {
  const ctx = await getPersonContext();
  const [p] = await db().select().from(persons).where(eq(persons.id, ctx.person.id)).limit(1);
  if (!p) return null;
  const canEdit = ctx.person.role === "owner" || ctx.person.role === "manager";
  return (
    <Card>
      {canEdit ? (
        <ProfileForm
          personId={p.id}
          isChild={p.isChild}
          allergens={Object.entries(ALLERGEN_TAGS).map(([code, a]) => ({ code, name: a.nameEs }))}
          timezones={TIMEZONES.includes(p.timezone) ? TIMEZONES : [p.timezone, ...TIMEZONES]}
          initial={{
            displayName: p.displayName,
            avatarColor: p.avatarColor,
            sex: p.sex,
            birthDate: p.birthDate,
            heightCm: p.heightCm,
            activityLevel: p.activityLevel,
            goalType: p.goalType,
            weeklyRateKg: p.weeklyRateKg,
            pregnancy: p.pregnancy as never,
            dietPattern: p.dietPattern,
            allergens: p.allergens,
            dislikes: p.dislikes,
            preferencesMd: p.preferencesMd,
            timezone: p.timezone,
          }}
        />
      ) : (
        <p className="text-ink-2">Solo quien gestiona a {p.displayName} puede cambiar su perfil.</p>
      )}
    </Card>
  );
}

export default function PerfilPage() {
  return (
    <>
      <PageHeader title="Perfil" subtitle="Estos datos calculan tus objetivos de energía y nutrientes" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}
