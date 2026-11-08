import { expect, test, type Page } from "@playwright/test";

/**
 * Recorrido principal (serial) sobre una instancia vacía con IA simulada:
 * registro del primer usuario (admin) → bienvenida → registro por IA → receta → plan →
 * compra → familia (niño gestionado) → invitación de un segundo usuario → privacidad → admin.
 */
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const ADMIN = { name: "Ana Prueba", email: `ana-${stamp}@e2e.test`, password: "contraseña-larga-1" };
const SECOND = { name: "Luis Prueba", email: `luis-${stamp}@e2e.test`, password: "contraseña-larga-2" };
const PRO = { name: "Marta Nutricionista", email: `marta-${stamp}@e2e.test`, password: "contraseña-larga-3" };
let inviteLink = "";
let adminPage: Page;

test.beforeAll(async ({ browser }) => {
  adminPage = await (await browser.newContext()).newPage();
});

async function signUp(page: Page, who: typeof ADMIN) {
  await page.getByLabel("Nombre").fill(who.name);
  const email = page.getByLabel("Correo");
  // With an invitation the address comes prefilled and read-only.
  if (await email.isEditable()) await email.fill(who.email);
  else await expect(email).toHaveValue(who.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(who.password);
  await page.getByLabel("Repite la contraseña").fill(who.password);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
}

test("sin sesión, las páginas privadas llevan al login", async ({ page }) => {
  await page.goto("/diario");
  await expect(page).toHaveURL(/\/login\?next=%2Fdiario/);
});

test("el primer registro crea la cuenta de administración", async () => {
  const page = adminPage;
  await page.goto("/registro");
  await expect(page.getByText("Eres la primera persona")).toBeVisible();
  await signUp(page, ADMIN);
  await expect(page).toHaveURL(/\/bienvenida/);
  await expect(page.getByRole("heading", { name: /Hola, Ana/ })).toBeVisible();
});

test("bienvenida: guardar el perfil calcula objetivos", async () => {
  const page = adminPage;
  await page.getByLabel("Sexo (para los cálculos)").selectOption({ index: 1 });
  await page.getByLabel("Fecha de nacimiento").fill("1990-05-20");
  await page.getByLabel("Altura (cm)").fill("168");
  await page.getByRole("button", { name: "Guardar perfil" }).click();
  await expect(page.getByText("Perfil guardado")).toBeVisible();
  await page.getByRole("link", { name: "Empezar" }).click();
  await expect(page).toHaveURL(/\/hoy/);
  await expect(page.getByText("Completa tu perfil")).toHaveCount(0);
});

test("registro por IA (simulada) llega al diario", async () => {
  const page = adminPage;
  await page.goto("/registrar");
  await page.getByPlaceholder(/lentejas con chorizo/).fill("Tortilla de patatas con pan");
  await page.getByRole("button", { name: "Analizar" }).click();
  await expect(page.getByText("Tortilla de patatas").first()).toBeVisible();
  await page.getByRole("button", { name: /^Registrar \d+ kcal/ }).click();
  await page.goto("/diario");
  await expect(page.getByText("Tortilla de patatas").first()).toBeVisible();
});

test("lo registrado por la IA se puede deshacer", async () => {
  const page = adminPage;
  await page.goto("/diario");
  const before = await page.getByText("Tortilla de patatas").count();
  await page.goto("/registrar");
  await page.getByPlaceholder(/lentejas con chorizo/).fill("Otra tortilla");
  await page.getByRole("button", { name: "Analizar" }).click();
  await page.getByRole("button", { name: /^Registrar \d+ kcal/ }).click();
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(page.getByText("Registro deshecho")).toBeVisible();
  await page.goto("/diario");
  await expect(page.getByText("Tortilla de patatas")).toHaveCount(before);
});

test("receta manual con nutrición calculada", async () => {
  const page = adminPage;
  await page.goto("/recetas/nueva");
  await page.getByLabel("Título").fill("Garbanzos con espinacas");
  await page.getByLabel("Raciones").fill("4");
  await page.getByLabel("Ingredientes").fill("400 g de garbanzos cocidos\n300 g de espinacas\n2 dientes de ajo\n30 g de aceite de oliva");
  await page.getByLabel("Pasos").fill("Sofríe el ajo.\n\nAñade las espinacas y luego los garbanzos.");
  await page.getByRole("button", { name: /Guardar/ }).click();
  await expect(page).toHaveURL(/\/recetas\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Garbanzos con espinacas" })).toBeVisible();
});

test("plan semanal: añadir la receta y mandarla a la compra", async () => {
  const page = adminPage;
  await page.goto("/planes");
  await page.getByRole("button", { name: "Empezar a mano" }).click();
  await page.getByRole("button", { name: "Añadir plato" }).first().click();
  await page.getByRole("button", { name: /Garbanzos con espinacas/ }).click();
  await expect(page.getByText("Garbanzos con espinacas").first()).toBeVisible();
  await page.getByRole("button", { name: "A la compra" }).click();
  await expect(page.getByText(/cosas añadidas a la lista/)).toBeVisible();
  await page.goto("/compra");
  await expect(page.getByText(/garbanzos/i).first()).toBeVisible();
});

test("familia: añadir un niño sin cuenta", async () => {
  const page = adminPage;
  await page.goto("/familia");
  await page.getByRole("button", { name: "Añadir persona sin cuenta" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre").fill("Lucía");
  await dialog.getByLabel("Fecha de nacimiento").fill("2019-03-02");
  await dialog.getByRole("button", { name: "Añadir" }).click();
  await expect(page.getByRole("link", { name: /Lucía/ })).toBeVisible();
});

test("invitar a un miembro del hogar", async () => {
  const page = adminPage;
  await page.goto("/familia");
  await page.getByLabel("Correo").fill(SECOND.email);
  await page.getByRole("button", { name: "Invitar" }).click();
  const link = page.locator("input[readonly]");
  await expect(link).toHaveValue(/\/invitacion\//);
  inviteLink = await link.inputValue();
});

test("el invitado entra en el hogar pero no ve datos de salud ajenos", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const url = new URL(inviteLink);
  await page.goto(url.pathname);
  await expect(page).toHaveURL(/\/registro\?token=/);
  await signUp(page, SECOND);
  await expect(page).toHaveURL(/\/bienvenida/);
  await page.goto("/familia");
  await expect(page.getByText(/no compartido contigo/)).toContainText("Ana Prueba");
  await expect(page.getByRole("link", { name: /Ana Prueba/ })).toHaveCount(0);
  // Sin rol de admin no hay administración.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/hoy/);
});

test("administración: usuarios y uso de la IA", async () => {
  const page = adminPage;
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Administración" })).toBeVisible();
  await expect(page.getByText(SECOND.email)).toBeVisible();
  await expect(page.getByText("meal_text")).toBeVisible();
});

test("los errores del servidor llegan con su mensaje en producción", async () => {
  const page = adminPage;
  await page.goto("/despensa");
  await page.getByLabel("Producto").fill("Leche");
  await page.getByLabel("Caduca").fill("pasado mañana");
  await page.getByRole("button", { name: "Añadir" }).click();
  await expect(page.getByText(/Fecha no válida/)).toBeVisible();
});

test("batch cooking: cocinar con tuppers y comer de uno", async () => {
  const page = adminPage;
  await page.goto("/recetas");
  await page.getByRole("link", { name: /Garbanzos con espinacas/ }).first().click();
  await page.getByRole("button", { name: "La he cocinado" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Para tuppers").fill("2");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(/tuppers guardados/)).toBeVisible();
  await page.goto("/despensa");
  await expect(page.getByText(/2 de 2 raciones/)).toBeVisible();
  await page.getByRole("button", { name: "Comer 1 ración" }).click();
  await expect(page.getByText(/quedan 1/)).toBeVisible();
  await expect(page.getByText(/1 de 2 raciones/)).toBeVisible();
  await page.goto("/diario");
  await expect(page.getByText("Garbanzos con espinacas").first()).toBeVisible();
});

test("MCP: token personal de solo lectura", async () => {
  const page = adminPage;
  await page.goto("/ajustes/integraciones");
  await page.getByLabel("Nombre").fill("E2E");
  await page.getByRole("button", { name: "Crear" }).click();
  const secret = page.getByText("Cópialo ahora").locator("..").locator("code");
  await expect(secret).toHaveText(/\S{20,}/);
  const token = (await secret.textContent())!.trim();
  const rpc = async (method: string, params: unknown) => {
    const res = await page.request.post("/api/mcp", {
      headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", "content-type": "application/json", "mcp-protocol-version": "2025-06-18" },
      data: { jsonrpc: "2.0", id: 1, method, params },
    });
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json()) as { result: { tools?: { name: string }[]; content?: { text: string }[] } };
  };
  const tools = (await rpc("tools/list", {})).result.tools!.map((t) => t.name);
  expect(tools).toContain("list_persons");
  expect(tools).not.toContain("log_weight"); // sin permiso de escritura
  const persons = await rpc("tools/call", { name: "list_persons", arguments: {} });
  expect(persons.result.content![0]!.text).toContain("Ana Prueba");
  const bad = await page.request.post("/api/mcp", { headers: { authorization: "Bearer nutria_falso", "content-type": "application/json" }, data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect(bad.status()).toBe(401);
});

test("exportar JSON/CSV e importar un CSV", async () => {
  const page = adminPage;
  await page.goto("/ajustes/datos");
  const jsonHref = await page.getByRole("link", { name: "Todo (JSON)" }).getAttribute("href");
  const json = await page.request.get(jsonHref!);
  expect(json.status()).toBe(200);
  expect(await json.text()).toContain("Tortilla de patatas");
  const csv = await page.request.get(jsonHref!.replace("format=json", "format=csv&table=diario"));
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("Tortilla de patatas");

  await page.locator("input[type=file]").setInputFiles({ name: "cronometer.csv", mimeType: "text/csv", buffer: Buffer.from("Day,Food Name,Amount,Energy (kcal),Protein (g),Carbs (g),Fat (g)\n2026-11-01,Yogur importado,125 g,80,5,6,3\n2026-11-01,Pan importado,60 g,150,5,30,1\n") });
  await expect(page.getByText("Importación en cola")).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/2 alimentos/)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByText("Cronometer")).toBeVisible();
  await page.goto("/diario?fecha=2026-11-01");
  await expect(page.getByText("Yogur importado")).toBeVisible();
});

test("profesional: solo lectura de lo compartido y notas", async ({ browser }) => {
  const page = adminPage;
  await page.goto("/familia");
  await page.getByRole("link", { name: /Ana Prueba/ }).click();
  await page.getByRole("button", { name: "Invitar a un profesional" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Correo").fill(PRO.email);
  await dialog.getByRole("button", { name: "Crear invitación" }).click();
  const link = dialog.locator("input[readonly]");
  await expect(link).toHaveValue(/\/invitacion\//);
  const url = new URL(await link.inputValue());
  const ana = page.url();

  const pro = await (await browser.newContext()).newPage();
  await pro.goto(url.pathname);
  await signUp(pro, PRO);
  await expect(pro).toHaveURL(/\/bienvenida/);
  await pro.goto("/familia");
  await expect(pro.getByText("Personas que sigues")).toBeVisible();
  await pro.getByRole("link", { name: /Ana Prueba/ }).click();
  await expect(pro.getByText(/Profesional/).first()).toBeVisible();
  await pro.getByPlaceholder(/Pauta, observación/).fill("Subir legumbres a 4 veces por semana");
  await pro.getByRole("button", { name: "Añadir nota" }).click();
  await expect(pro.getByText("Subir legumbres a 4 veces por semana")).toBeVisible();
  await pro.getByRole("button", { name: "Ver su día" }).click();
  await expect(pro).toHaveURL(/\/hoy/);
  await expect(pro.getByText("Solo lectura")).toBeVisible();
  await pro.goto("/diario");
  await expect(pro.getByText("Tortilla de patatas").first()).toBeVisible();
  // Lo no compartido (medicación) no se ve.
  await pro.goto("/salud/medicacion");
  await expect(pro).toHaveURL(/sinpermiso=medication/);

  await page.goto(ana);
  await expect(page.getByText("Subir legumbres a 4 veces por semana")).toBeVisible();
  await expect(page.getByText(PRO.email)).toBeVisible();
});

test("repaso semanal: valorar platos y aprender gustos", async () => {
  const page = adminPage;
  await page.goto("/planes");
  await page.locator('a[href$="/repaso"]').first().click();
  await page.getByRole("button", { name: "Le gustó" }).first().click();
  await page.getByRole("button", { name: "Guardar valoración" }).click();
  await expect(page.getByText("Valoración guardada")).toBeVisible();
  await page.getByRole("button", { name: "Proponer cambios" }).click();
  await expect(page.getByLabel("Gustos del hogar")).toHaveValue(/legumbres/);
  await page.getByRole("button", { name: "Guardar preferencias" }).click();
  await expect(page.getByText("Preferencias actualizadas")).toBeVisible();
  await page.reload();
  await expect(page.getByText(/ya se usó para actualizar los gustos/)).toBeVisible();
});

const ROUTES = [
  "/hoy", "/diario", "/buscar", "/buscar/nuevo", "/registrar", "/coach", "/coach/memoria", "/progreso", "/informe",
  "/salud", "/salud/medicacion", "/salud/sintomas", "/salud/analiticas", "/salud/ayuno", "/salud/ejercicio", "/salud/sueno", "/salud/ciclo", "/salud/condiciones",
  "/recetas", "/recetas/nueva", "/recetas/importar", "/planes", "/despensa", "/compra", "/familia", "/retos", "/mas", "/admin",
  "/ajustes", "/ajustes/objetivos", "/ajustes/comidas", "/ajustes/pantalla", "/ajustes/notificaciones", "/ajustes/seguridad", "/ajustes/integraciones", "/ajustes/datos",
];

test("todas las páginas cargan sin errores de servidor", async () => {
  const page = adminPage;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
  // Detail pages: first recipe, first person and the current plan's review.
  await page.goto("/recetas");
  const recipe = await page.locator('a[href^="/recetas/"]').filter({ hasNotText: /nueva|importar/i }).first().getAttribute("href");
  await page.goto("/familia");
  const person = await page.locator('a[href^="/familia/"]').first().getAttribute("href");
  await page.goto("/planes");
  const retro = await page.locator('a[href$="/repaso"]').first().getAttribute("href");
  const all = [...ROUTES, ...[recipe, recipe && `${recipe}/editar`, recipe && `${recipe}/cocinar`, person, retro].filter((x): x is string => !!x)];
  for (const r of all) {
    const res = await page.goto(r);
    expect(res?.status(), r).toBeLessThan(500);
    await expect(page.getByText(/Internal Server Error|Application error|Algo ha fallado/i), r).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
