"use client";
import { errorText } from "@/lib/errors";
import { useRef, useState } from "react";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { FileUp, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { confirmLabReport, deleteLabReport } from "@/actions/health";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { fileToBase64, fileToJpeg } from "@/lib/image";

export type LabRow = { parameterCode: string | null; rawName: string; value: number; unit: string; refLow: number | null; refHigh: number | null };
export type LabDraft = { reportId: string; date: string; labName: string | null; results: LabRow[] };
type Param = { code: string; nameEs: string; unit: string };

export function LabUpload({ personId, params, drafts }: { personId: string; params: Param[]; drafts: LabDraft[] }) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<LabDraft | null>(drafts[0] ?? null);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const list = [...files];
      const pdf = list.find((f) => f.type === "application/pdf");
      const body: Record<string, unknown> = { personId };
      if (pdf) {
        if (pdf.size > 10 * 1024 * 1024) throw new Error("PDF demasiado grande (máx. 10 MB)");
        body.pdf = await fileToBase64(pdf);
      } else {
        body.images = await Promise.all(list.slice(0, 6).map(async (f) => {
          const j = await fileToJpeg(f, 2000, 0.85);
          return { mediaType: j.mediaType, data: j.data };
        }));
      }
      const res = await fetch("/api/ai/lab", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error ?? "No se pudo leer");
      setDraft({ reportId: out.reportId, date: out.date ?? new Date().toISOString().slice(0, 10), labName: out.labName, results: out.results });
      toast.success(`${out.results.length} valores leídos. Revísalos antes de guardar.`);
    } catch (e) {
      toast.error(errorText(e, "Error"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  if (draft) return <LabReview personId={personId} params={params} draft={draft} onDone={() => setDraft(null)} />;
  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={() => input.current?.click()} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <FileUp />} {busy ? "Leyendo la analítica…" : "Subir PDF o fotos"}
      </Button>
      <p className="text-xs text-ink-3">La IA extrae parámetros, valores y rangos. Nada se guarda hasta que lo confirmes.</p>
      <input ref={input} type="file" accept="application/pdf,image/*" multiple hidden onChange={(e) => void upload(e.target.files)} />
    </div>
  );
}

function LabReview({ personId, params, draft, onDone }: { personId: string; params: Param[]; draft: LabDraft; onDone: () => void }) {
  const [rows, setRows] = useState<LabRow[]>(draft.results);
  const [date, setDate] = useState(draft.date);
  const [lab, setLab] = useState(draft.labName ?? "");
  const [pending, start] = useSafeTransition();
  const set = (i: number, patch: Partial<LabRow>) => setRows((xs) => xs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const num = (v: string) => (v === "" ? null : Number(v.replace(",", ".")));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Fecha">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Laboratorio">
          <Input value={lab} onChange={(e) => setLab(e.target.value)} />
        </Field>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="text-left text-xs text-ink-3">
            <tr>
              <th className="py-1 font-medium">Parámetro</th>
              <th className="font-medium">Vinculado a</th>
              <th className="font-medium">Valor</th>
              <th className="font-medium">Unidad</th>
              <th className="font-medium">Mín</th>
              <th className="font-medium">Máx</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const out = (r.refLow != null && r.value < r.refLow) || (r.refHigh != null && r.value > r.refHigh);
              return (
                <tr key={i} className={out ? "bg-persimmon-soft/50" : ""}>
                  <td className="py-1 pr-1">
                    <Input value={r.rawName} onChange={(e) => set(i, { rawName: e.target.value })} className="h-9" />
                  </td>
                  <td className="pr-1">
                    <Select value={r.parameterCode ?? ""} onChange={(e) => set(i, { parameterCode: e.target.value || null })} className="h-9 w-40">
                      <option value="">—</option>
                      {params.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.nameEs}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="pr-1">
                    <Input inputMode="decimal" value={String(r.value)} onChange={(e) => set(i, { value: num(e.target.value) ?? 0 })} className="num h-9 w-24" />
                  </td>
                  <td className="pr-1">
                    <Input value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} className="h-9 w-20" />
                  </td>
                  <td className="pr-1">
                    <Input inputMode="decimal" value={r.refLow ?? ""} onChange={(e) => set(i, { refLow: num(e.target.value) })} className="num h-9 w-20" />
                  </td>
                  <td className="pr-1">
                    <Input inputMode="decimal" value={r.refHigh ?? ""} onChange={(e) => set(i, { refHigh: num(e.target.value) })} className="num h-9 w-20" />
                  </td>
                  <td>
                    <button type="button" aria-label="Quitar" className="rounded-full p-1 text-ink-3 hover:bg-paper-2" onClick={() => setRows((xs) => xs.filter((_, j) => j !== i))}>
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setRows((xs) => [...xs, { parameterCode: null, rawName: "", value: 0, unit: "", refLow: null, refHigh: null }])}>
          <Plus /> Fila
        </Button>
        <span className="flex-1" />
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await deleteLabReport(personId, draft.reportId);
              onDone();
            })
          }
        >
          Descartar
        </Button>
        <Button
          disabled={pending || !rows.length}
          onClick={() =>
            start(async () => {
              await confirmLabReport(personId, draft.reportId, { date, labName: lab || null, rows: rows.filter((r) => r.rawName && Number.isFinite(r.value)) });
              toast.success("Analítica guardada");
              onDone();
            })
          }
        >
          Guardar {rows.length} valores
        </Button>
      </div>
    </div>
  );
}

export function DeleteReport({ personId, id }: { personId: string; id: string }) {
  const [pending, start] = useSafeTransition();
  return (
    <button type="button" disabled={pending} aria-label="Borrar analítica" className="rounded-full p-1 text-ink-3 hover:bg-paper-2" onClick={() => start(() => deleteLabReport(personId, id))}>
      <Trash2 className="size-4" />
    </button>
  );
}
