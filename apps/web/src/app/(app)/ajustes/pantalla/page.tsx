import { Suspense } from "react";
import { eq, persons } from "@nutria/db";
import { getSportProfile } from "@nutria/core";
import { CORE_MICROS, NUTRIENTS } from "@nutria/nutrition";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/empty";
import { db } from "@/lib/db";
import { HOME_CARD_NAMES, HOME_CARDS } from "@/lib/home-cards";
import { getPersonContext } from "@/lib/session";
import { HIDEABLE_SECTIONS, SECTION_LABELS } from "@/lib/sections";
import { DisplaySettings, SectionVisibility, ThemePicker } from "../settings-client";

export const metadata = { title: "Pantalla" };

async function Content() {
  const ctx = await getPersonContext();
  const [p] = await db().select({ settings: persons.settings }).from(persons).where(eq(persons.id, ctx.person.id)).limit(1);
  const s = p?.settings ?? {};
  const sport = await getSportProfile(db(), ctx.person.id);
  const micros = NUTRIENTS.filter((n) => n.category === "vitamin" || n.category === "mineral" || ["sodium", "sugars", "saturated_fat", "caffeine", "alcohol", "omega3"].includes(n.code));
  return (
    <Card>
      <DisplaySettings
        personId={ctx.person.id}
        canEdit={ctx.person.role === "owner" || ctx.person.role === "manager"}
        waterAuto={sport.active && !!sport.profile.waterAuto}
        cards={HOME_CARDS.map((c) => ({ code: c, name: HOME_CARD_NAMES[c] }))}
        micros={micros.map((n) => ({ code: n.code, name: n.nameEs }))}
        initial={{
          homeCards: s.homeCards?.length ? s.homeCards : [...HOME_CARDS],
          trackedMicros: s.trackedMicros?.length ? s.trackedMicros : CORE_MICROS.slice(0, 8),
          units: s.units ?? "metric",
          energyUnit: s.energyUnit ?? "kcal",
          waterGoalMl: s.waterGoalMl ?? 2000,
        }}
      />
    </Card>
  );
}

async function Sections() {
  const ctx = await getPersonContext();
  const own = ctx.persons.find((p) => p.isSelf);
  if (!own) return null;
  return (
    <Card>
      <CardHeader title="Secciones del menú" subtitle="Se aplica a tu cuenta, veas a quien veas" />
      <SectionVisibility personId={own.id} sections={HIDEABLE_SECTIONS.map((c) => ({ code: c, label: SECTION_LABELS[c] }))} initial={HIDEABLE_SECTIONS.filter((c) => ctx.hiddenSections.includes(c))} />
    </Card>
  );
}

export default function PantallaPage() {
  return (
    <>
      <PageHeader title="Pantalla" />
      <div className="space-y-4">
        <Card>
          <CardHeader title="Tema" subtitle="Se guarda en este dispositivo" />
          <ThemePicker />
        </Card>
        <Suspense fallback={<Skeleton className="h-28" />}>
          <Sections />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Content />
        </Suspense>
      </div>
    </>
  );
}
