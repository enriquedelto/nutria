/**
 * openGym integration (self-hosted gym tracker on the NUC).
 * Auth: pairing code → POST /api/pair/redeem → Bearer token (same value as a session cookie).
 * Read: GET /api/data → { state: { unit, workouts[], bodyweight[] }, rev }.
 * Newer versions also send signed webhooks (workout finished, weigh-in) — handled when configured.
 */
import { strengthSessionKcal } from "@nutria/nutrition";
import { verifySignature } from "./secrets";

export interface OpenGymWorkout {
  id: string;
  d: string;
  start?: number;
  end?: number;
  name?: string;
  routineId?: string;
  bw?: number;
  vol?: number;
  entries?: { id: string; sets?: { w?: number; r?: number; done?: boolean }[] }[];
}
export interface OpenGymWeighIn {
  d: string;
  w: number;
  t?: number;
}
export interface OpenGymState {
  unit?: "kg" | "lb";
  workouts?: OpenGymWorkout[];
  bodyweight?: OpenGymWeighIn[];
}

const LB = 0.45359237;

export class OpenGymClient {
  constructor(
    private baseUrl: string,
    private token?: string,
    private f: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async redeem(code: string, deviceName = "Nutria"): Promise<string> {
    const r = await this.f(`${this.baseUrl}/api/pair/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim(), name: deviceName }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(r.status === 400 || r.status === 404 ? "Código de emparejamiento no válido o caducado" : `openGym respondió ${r.status}`);
    const j = (await r.json()) as { token?: string };
    if (!j.token) throw new Error("openGym no devolvió token");
    this.token = j.token;
    return j.token;
  }

  private headers() {
    if (!this.token) throw new Error("Sin token de openGym");
    return { Authorization: `Bearer ${this.token}`, Accept: "application/json" };
  }

  /** Returns state and, if the server renewed the token, the new token. */
  async me(): Promise<{ name?: string; renewedToken?: string }> {
    const r = await this.f(`${this.baseUrl}/api/me`, { headers: this.headers(), signal: AbortSignal.timeout(10000) });
    if (r.status === 401) throw new Error("Token de openGym caducado: vuelve a emparejar");
    const j = (await r.json()) as { user?: { name?: string }; name?: string; token?: string };
    return { name: j.user?.name ?? j.name, renewedToken: j.token };
  }

  async data(): Promise<{ state: OpenGymState | null; rev: number }> {
    const r = await this.f(`${this.baseUrl}/api/data`, { headers: this.headers(), signal: AbortSignal.timeout(20000) });
    if (r.status === 401) throw new Error("Token de openGym caducado: vuelve a emparejar");
    if (!r.ok) throw new Error(`openGym respondió ${r.status}`);
    return (await r.json()) as { state: OpenGymState | null; rev: number };
  }
}

export interface MappedExercise {
  externalId: string;
  date: string;
  startedAt: Date | null;
  name: string;
  durationMin: number;
  kcal: number;
  volumeKg: number | null;
  sets: number;
}
export interface MappedWeight {
  externalId: string;
  date: string;
  measuredAt: Date;
  kg: number;
}

/** Map openGym state into our exercise/weight rows (idempotent by externalId). */
export function mapOpenGymState(state: OpenGymState, fallbackWeightKg: number): { exercises: MappedExercise[]; weights: MappedWeight[] } {
  const toKg = (v: number) => (state.unit === "lb" ? v * LB : v);
  const weights: MappedWeight[] = (state.bodyweight ?? [])
    .filter((b) => b.d && Number.isFinite(b.w) && b.w > 0)
    .map((b) => ({ externalId: `bw:${b.d}:${b.t ?? 0}`, date: b.d, measuredAt: new Date(b.t ?? Date.parse(`${b.d}T08:00:00`)), kg: Math.round(toKg(b.w) * 100) / 100 }));
  const exercises: MappedExercise[] = (state.workouts ?? [])
    .filter((w) => w.id && w.d)
    .map((w) => {
      const minutes = w.start && w.end && w.end > w.start ? Math.min(240, (w.end - w.start) / 60000) : 45;
      const bodyKg = w.bw ? toKg(w.bw) : fallbackWeightKg;
      const vol = w.vol != null ? toKg(w.vol) : null;
      const sets = (w.entries ?? []).reduce((s, e) => s + (e.sets ?? []).filter((x) => x.done !== false).length, 0);
      return {
        externalId: w.id,
        date: w.d,
        startedAt: w.start ? new Date(w.start) : null,
        name: w.name || "Entrenamiento (openGym)",
        durationMin: Math.round(minutes),
        kcal: strengthSessionKcal(bodyKg, minutes, vol ?? undefined),
        volumeKg: vol == null ? null : Math.round(vol),
        sets,
      };
    });
  return { exercises, weights };
}

/** Webhook payload (newer openGym): { event: "workout.finished" | "weighin.logged" | "pr", data } */
export interface OpenGymWebhook {
  event: string;
  data: Record<string, unknown>;
}

export function verifyOpenGymWebhook(secret: string, rawBody: string, signatureHeader: string | null): OpenGymWebhook | null {
  if (!verifySignature(secret, rawBody, signatureHeader)) return null;
  try {
    return JSON.parse(rawBody) as OpenGymWebhook;
  } catch {
    return null;
  }
}
