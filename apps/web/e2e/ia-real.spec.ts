import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Criterios de aceptación con la IA REAL (gasta la suscripción; se lanza a mano, sola y sobre una
 * instancia limpia con IA real):
 *   E2E_AI=1 docker/e2e.sh
 *   E2E_REAL_AI=1 E2E_TICKETS_DIR=C:/ruta/tickets pnpm --filter @nutria/web e2e e2e/ia-real.spec.ts
 * - Tickets (E2E_TICKETS_DIR, fotos o PDF reales): la suma de líneas cuadra con el total.
 * - Planificador: cada día planificado entero queda a ±10 % de las kcal objetivo.
 * - Informe semanal: se genera en menos de 90 s y trae «Un cambio para esta semana».
 * Open Prices real y Health Connect se prueban a mano (necesitan cuentas y el móvil).
 */
test.describe.configure({ mode: "serial" });
test.skip(!process.env.E2E_REAL_AI, "Solo con E2E_REAL_AI=1 (IA real, gasta la suscripción)");
test.setTimeout(300_000);

const stamp = Date.now().toString(36);
const ME = { name: "Prueba IA", email: `ia-${stamp}@e2e.test`, password: "contraseña-larga-ia" };
const SSH_HOST = process.env.E2E_SSH_HOST ?? "nuc";
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
});

test("cuenta y perfil (ganar músculo)", async () => {
  await page.goto("/registro");
  await expect(page.getByText("Eres la primera persona")).toBeVisible();
  await page.getByLabel("Nombre").fill(ME.name);
  await page.getByLabel("Correo").fill(ME.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(ME.password);
  await page.getByLabel("Repite la contraseña").fill(ME.password);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/bienvenida/);
  await page.getByLabel("Sexo (para los cálculos)").selectOption("male");
  await page.getByLabel("Fecha de nacimiento").fill("1994-03-10");
  await page.getByLabel("Altura (cm)").fill("178");
  await page.getByLabel("Peso actual (kg)").fill("72");
  await page.getByRole("button", { name: "Guardar perfil" }).click();
  await expect(page.getByText("Perfil guardado. Objetivos recalculados.")).toBeVisible();
});

test("tickets reales: la suma cuadra con el total", async () => {
  const dir = process.env.E2E_TICKETS_DIR;
  test.skip(!dir, "Pon fotos o PDF de tickets en E2E_TICKETS_DIR");
  const files = readdirSync(dir!).filter((f) => [".jpg", ".jpeg", ".png", ".webp", ".pdf"].includes(extname(f).toLowerCase()));
  expect(files.length).toBeGreaterThan(0);
  const report: string[] = [];
  for (const f of files) {
    await page.goto("/compra/tickets");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Subir foto o PDF" }).click();
    const ext = extname(f).toLowerCase();
    await (await chooser).setFiles({ name: f, mimeType: ext === ".pdf" ? "application/pdf" : `image/${ext === ".jpg" ? "jpeg" : ext.slice(1)}`, buffer: readFileSync(join(dir!, f)) });
    await expect(page.getByRole("heading", { name: "Revisar ticket" })).toBeVisible({ timeout: 240_000 });
    const squares = await page.getByText(/cuadra con el total/).isVisible();
    report.push(`${f}: ${squares ? "cuadra" : (await page.getByText(/para el total|del total/).first().textContent())}`);
    await page.getByRole("button", { name: "Guardar ticket" }).click();
    await expect(page).toHaveURL(/\/compra\/tickets\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Revisar ticket" })).toHaveCount(0);
  }
  console.log(`TICKETS\n${report.join("\n")}`);
  expect(report.filter((r) => !r.endsWith(": cuadra"))).toEqual([]);
});

test("planificador: cada día a ±10 % de las kcal objetivo", async () => {
  await page.goto("/planes");
  await page.getByRole("button", { name: "Generar con IA" }).click();
  const dialog = page.getByRole("dialog");
  // Every meal of the day, so the day's total can be compared with the target.
  for (const box of await dialog.getByRole("checkbox").all()) await box.check();
  const t = Date.now();
  await dialog.getByRole("button", { name: "Proponer menú" }).click();
  await expect(dialog.getByRole("button", { name: "Usar este menú" })).toBeVisible({ timeout: 280_000 });
  console.log(`PLAN propuesto en ${Math.round((Date.now() - t) / 1000)} s`);
  await dialog.getByRole("button", { name: "Usar este menú" }).click();
  await expect(page.getByText(/\d+ platos añadidos al plan/)).toBeVisible();
  await page.reload();
  const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
  const days = (await page.getByText(/[\d.]+\/[\d.]+ kcal · P \d+\/\d+ g/).allTextContents()).map((s) => {
    const m = s.match(/([\d.]+)\/([\d.]+) kcal · P (\d+)\/(\d+) g/)!;
    return { kcal: num(m[1]), target: num(m[2]), protein: Number(m[3]), proteinTarget: Number(m[4]) };
  });
  console.log(`PLAN por día\n${days.map((d) => `${d.kcal}/${d.target} kcal (${Math.round((d.kcal / d.target - 1) * 100)} %) · P ${d.protein}/${d.proteinTarget}`).join("\n")}`);
  expect(days.length).toBeGreaterThan(0);
  for (const d of days) {
    expect(Math.abs(d.kcal / d.target - 1)).toBeLessThanOrEqual(0.1);
    expect(d.protein).toBeGreaterThanOrEqual(d.proteinTarget * 0.9);
  }
});

test("informe semanal: menos de 90 s y con «Un cambio para esta semana»", async () => {
  // Something to talk about: a meal logged with the real AI.
  await page.goto("/registrar");
  await page.getByPlaceholder(/lentejas con chorizo/).fill("200 g de pechuga de pollo a la plancha con 150 g de arroz blanco");
  await page.getByRole("button", { name: "Analizar" }).click();
  await page.getByRole("button", { name: /^Registrar \d+ kcal/ }).click({ timeout: 120_000 });
  await expect(page.getByText(/registrad/i).first()).toBeVisible();
  // The report is a Sunday cron job: run its handler in the E2E worker and time it.
  const out = execFileSync("ssh", [SSH_HOST, "cd ~/nutria-e2e/docker && E2E_IMAGE=nutria-app:e2e docker compose -f compose.e2e.yml exec -T worker pnpm -s --filter @nutria/worker job weekly.report"], { encoding: "utf8", timeout: 200_000 });
  const run = JSON.parse(out.trim().split("\n").at(-1)!) as { seconds: number; result: { reports: number } };
  console.log(`INFORME en ${run.seconds} s`);
  expect(run.result.reports).toBe(1);
  expect(run.seconds).toBeLessThan(90);
  await page.goto("/progreso/informe");
  await expect(page.getByText("Un cambio para esta semana")).toBeVisible();
});
