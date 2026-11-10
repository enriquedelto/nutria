import { importHealthData, parseHealthPayload } from "@nutria/core";
import { db } from "@/lib/db";
import { publicRoute, tokenAuth, tokenPerson } from "@/lib/tokens";

/**
 * Inbound health data from a phone or watch (token with "write"): steps, sleep, heart rate,
 * weight and exercise. Takes the JSON of the «Health Connect Webhook» Android app as is, or
 * { steps, sleep, heartRate, weight, exercise } arrays. `?personId=` picks another person.
 */
export const POST = publicRoute(async (req) => {
  const auth = await tokenAuth(req, "write");
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return Response.json({ error: "Se esperaba un JSON" }, { status: 400 });
  const personId = new URL(req.url).searchParams.get("personId") ?? (typeof body.personId === "string" ? body.personId : null);
  const { person } = await tokenPerson(auth, personId, "body", true);
  const saved = await importHealthData(db(), person.id, parseHealthPayload(body, person.timezone));
  return Response.json({ ok: true, personId: person.id, saved });
});
