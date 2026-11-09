import { Suspense } from "react";
import { eq, persons } from "@nutria/db";
import { getSportProfile, latestWeight, openGymPlannedDays } from "@nutria/core";
import { ALLERGEN_TAGS, sportProteinPerKg } from "@nutria/nutrition";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { getPersonContext } from "@/lib/session";
import { ProfileForm } from "./profile-form";
import { SportForm } from "./sport-form";

export const metadata = { title: "Perfil" };

const TIMEZONES = ["Europe/Madrid", "Atlantic/Canary", "Europe/Lisbon", "Europe/London", "Europe/Paris", "Europe/Berlin", "America/Mexico_City", "America/Bogota", "America/Argentina/Buenos_Aires", "America/Santiago", "America/New_York", "UTC"];

async function Content() {
  const ctx = await getPersonContext();
  const [p] = await db().select().from(persons).where(eq(persons.id, ctx.person.id)).limit(1);
  if (!p) return null;
  const [weight, sport, ogDays] = await Promise.all([latestWeight(db(), p.id), getSportProfile(db(), p.id), openGymPlannedDays(db(), p.id)]);
  const canEdit = ctx.person.role === "owner" || ctx.person.role === "manager";
  const sp = sport.profile;
  return (
    <div className="space-y-4">
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
            weightKg: weight?.kg ?? null,
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
    {canEdit && !p.isChild ? (
      <Card>
        <h2 className="mb-3 font-display text-lg font-semibold">Deporte</h2>
        <SportForm
          personId={p.id}
          weightKg={weight?.kg ?? null}
          openGymDays={ogDays}
          initial={{
            active: sport.active,
            focus: sp.focus,
            level: sp.level,
            proteinPerKg: sportProteinPerKg(sp),
            trainingDays: sp.trainingDays ?? ogDays,
            trainingDaysSource: sp.trainingDaysSource ?? (ogDays.length ? "opengym" : "manual"),
            cycleCarbs: sport.exists ? !!sp.cycleCarbs : true,
            waterAuto: sport.exists ? !!sp.waterAuto : true,
          }}
        />
      </Card>
    ) : null}
    </div>
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
