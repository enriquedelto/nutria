import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";

type RestoreTest = { at: string; dump: string; ok: boolean; error?: string; tables: Record<string, { restored: number | null; live: number | null }>; uploads?: { archive: string; inArchive: number; files: number } | null };

const when = (d: Date) => d.toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
const mb = (n: number) => `${(n / 1_048_576).toLocaleString("es-ES", { maximumFractionDigits: n < 10_485_760 ? 1 : 0 })} MB`;

async function newest(dir: string, re: RegExp) {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => re.test(n)).sort();
  const name = names.at(-1);
  if (!name) return null;
  const s = await stat(join(dir, name)).catch(() => null);
  return s ? { name, size: s.size, at: when(s.mtime), old: Date.now() - s.mtime.getTime() > 36 * 3_600_000, count: names.length } : null;
}

type DiskStatus = { at: string; totalBytes: number; freeBytes: number; usedPct: number; level: "ok" | "warn" | "critical"; dbBytes: number | null };
const gb = (n: number) => `${(n / 1_073_741_824).toLocaleString("es-ES", { maximumFractionDigits: 1 })} GB`;

async function readDisk(dir: string) {
  try {
    const s = JSON.parse(await readFile(join(dir, "disk.json"), "utf8")) as DiskStatus;
    return { s, stale: Date.now() - new Date(s.at).getTime() > 3_600_000 };
  } catch {
    return { s: null, stale: true };
  }
}

/** Server disk usage, written every 15 min by the maintenance.disk job (core/src/disk.ts). */
export async function DiskCard() {
  const { s, stale } = await readDisk(process.env.BACKUP_DIR ?? "/data/backups");
  const tone = !s ? "warn" : s.level === "critical" ? "danger" : s.level === "warn" ? "warn" : "ok";
  return (
    <Card>
      <CardHeader title="Disco del servidor" subtitle="Aviso al pasar del 85 % y del 95 %; si se llena, la base de datos se detiene" />
      {s ? (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {s.usedPct.toLocaleString("es-ES")} % usado · {gb(s.freeBytes)} libres de {gb(s.totalBytes)}
            </span>
            <Badge tone={tone}>{s.level === "critical" ? "casi lleno" : s.level === "warn" ? "vigilar" : "bien"}</Badge>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-paper-2" role="meter" aria-label="Uso del disco" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s.usedPct}>
            <div className={`h-full ${s.level === "ok" ? "bg-herb" : s.level === "warn" ? "bg-warn" : "bg-danger"}`} style={{ width: `${Math.min(100, s.usedPct)}%` }} />
          </div>
          <p className="text-xs text-ink-3">
            {s.dbBytes != null ? `Base de datos: ${gb(s.dbBytes)} · ` : ""}medido {when(new Date(s.at))}
            {stale ? " (atrasado: ¿está parado el worker?)" : ""}
          </p>
        </div>
      ) : (
        <p className="text-sm text-ink-2">Aún sin medir (el worker lo comprueba cada 15 minutos).</p>
      )}
    </Card>
  );
}

/** Daily backups (database and uploads) and the weekly restore test written by docker/restore-test.sh. */
export async function BackupsCard() {
  const dir = process.env.BACKUP_DIR ?? "/data/backups";
  const [dump, uploads, raw] = await Promise.all([newest(dir, /^nutria-\d{4}-\d{2}-\d{2}\.dump$/), newest(dir, /^uploads-\d{4}-\d{2}-\d{2}\.tar(\.gz)?$/), readFile(join(dir, "restore-test.json"), "utf8").catch(() => null)]);
  let test: RestoreTest | null = null;
  try {
    test = raw ? (JSON.parse(raw) as RestoreTest) : null;
  } catch {
    test = null;
  }
  const stale = dump ? dump.old : true;
  const testAt = test ? when(new Date(test.at)) : null;
  return (
    <Card>
      <CardHeader title="Copias de seguridad" subtitle="Diarias (base de datos y archivos subidos); prueba de restauración cada domingo" />
      <ul className="space-y-1.5 text-sm">
        <li className="flex flex-wrap items-center justify-between gap-2">
          <span>Base de datos</span>
          <span className="text-ink-2">
            {dump ? `${dump.at} · ${mb(dump.size)} · ${dump.count} guardadas` : "sin copias"} <Badge tone={stale ? "warn" : "ok"}>{stale ? "atrasada" : "al día"}</Badge>
          </span>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-2">
          <span>Fotos y tickets</span>
          <span className="text-ink-2">{uploads ? `${uploads.at} · ${mb(uploads.size)}` : "aún no hay copia (se hace con la diaria)"}</span>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-2">
          <span>Prueba de restauración</span>
          <span className="text-ink-2">
            {test ? `${testAt} · ${test.dump}` : "aún no se ha hecho"} {test ? <Badge tone={test.ok ? "ok" : "danger"}>{test.ok ? "correcta" : "falla"}</Badge> : null}
          </span>
        </li>
      </ul>
      {test ? (
        <p className="mt-2 text-xs text-ink-3">
          {Object.entries(test.tables)
            .map(([t, c]) => `${t} ${c.restored?.toLocaleString("es-ES") ?? "—"}/${c.live?.toLocaleString("es-ES") ?? "—"}`)
            .join(" · ")}
          {test.uploads ? ` · archivos ${test.uploads.inArchive}/${test.uploads.files}` : ""} (restaurado/actual)
          {test.error ? <span className="block text-danger">{test.error}</span> : null}
        </p>
      ) : null}
    </Card>
  );
}
