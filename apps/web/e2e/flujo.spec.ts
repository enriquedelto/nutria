import zlib from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  await page.getByLabel("Peso actual (kg)").fill("62.5");
  await page.getByRole("button", { name: "Guardar perfil" }).click();
  await expect(page.getByText("Perfil guardado. Objetivos recalculados.")).toBeVisible();
  await page.getByRole("link", { name: "Empezar" }).click();
  await expect(page).toHaveURL(/\/hoy/);
  await expect(page.getByText("Completa tu perfil")).toHaveCount(0);
});

test("objetivos: «Recalcular» calcula con el perfil, también si estaban fijados", async () => {
  const page = adminPage;
  await page.goto("/ajustes/objetivos");
  await page.getByRole("button", { name: "Recalcular" }).click();
  const toastText = page.getByText(/Objetivos recalculados: \d+ kcal/);
  await expect(toastText).toBeVisible();
  const kcal = Number((await toastText.textContent())!.match(/(\d+) kcal/)![1]);
  // Fijarlos a mano con otras calorías y recalcular: vuelven a los de la fórmula.
  await page.getByRole("button", { name: "Editar" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Modo").selectOption("fixed");
  await dialog.getByLabel("Calorías").fill("1500");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(/^1500 kcal/)).toBeVisible();
  await page.getByRole("button", { name: "Recalcular" }).click();
  await expect(page.getByText("Estaban fijados a mano")).toBeVisible();
  await expect(page.getByText(new RegExp(`^${kcal} kcal`))).toBeVisible();
  await expect(page.getByText("calculado", { exact: true })).toBeVisible();
});

test("deporte: volumen, días de entreno, objetivos por día y creatina marcada en Hoy", async () => {
  const page = adminPage;
  await page.goto("/ajustes");
  await page.getByLabel("Objetivo", { exact: true }).selectOption("gain");
  await page.getByRole("button", { name: /Volumen limpio/ }).click();
  await expect(page.getByText("Ritmo: 0,16 kg/semana (0,26 % de tu peso)", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Guardar perfil" }).click();
  await expect(page.getByText("Perfil guardado. Objetivos recalculados.")).toBeVisible();

  await page.getByLabel(/Entreno de fuerza o hipertrofia/).check();
  await page.getByRole("button", { name: /Competitivo/ }).click();
  await expect(page.getByText("Proteína: 2,0 g/kg ≈ 125 g al día")).toBeVisible();
  for (const d of ["lunes", "miércoles", "viernes"]) await page.getByRole("button", { name: d, exact: true }).click();
  await expect(page.getByLabel(/Más hidratos los días de entreno/)).toBeChecked();
  await page.getByLabel(/Agua según tu peso y tu entreno/).uncheck();
  await page.getByRole("button", { name: "Guardar deporte" }).click();
  await expect(page.getByText("Perfil deportivo guardado. Objetivos recalculados.")).toBeVisible();

  await page.goto("/ajustes/objetivos");
  await expect(page.getByText("Día de entreno (3/sem)")).toBeVisible();
  await expect(page.getByText("Día de descanso (4/sem)")).toBeVisible();
  await expect(page.getByText("2 g/kg × 62,5 kg = 125 g", { exact: false })).toBeVisible();
  await expect(page.getByText("para ganar 0,16 kg/semana", { exact: false })).toBeVisible();

  await page.goto("/salud/suplementos");
  const creatine = page.locator("div.rounded-xl").filter({ hasText: "Creatina monohidrato" }).first();
  await expect(creatine.getByText("Evidencia A")).toBeVisible();
  await creatine.getByRole("button", { name: "Añadir pauta" }).click();
  await creatine.getByRole("button", { name: "Guardar pauta" }).click();
  await expect(page.getByText("Creatina monohidrato añadida a tus pautas")).toBeVisible();
  await expect(creatine.getByText("Ya está en tus pautas")).toBeVisible();
  await expect(page.getByText("BCAA / aminoácidos ramificados:")).toBeVisible();

  await page.goto("/hoy");
  await expect(page.getByText(/Día de (entreno|descanso)/)).toBeVisible();
  // The button turns «tomada» optimistically: wait for the request before reloading.
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/diary/ops");
  await page.getByRole("button", { name: "Marcar Creatina monohidrato como tomada" }).click();
  await expect(page.getByRole("button", { name: "Creatina monohidrato: tomada" })).toBeVisible();
  await saved;
  await page.reload();
  await expect(page.getByRole("button", { name: "Creatina monohidrato: tomada" })).toBeVisible();
  await expect(page.getByText("Supl.").first()).toBeVisible();
});

test("revisión del volumen: sin datos todavía, a mano desde Progreso", async () => {
  const page = adminPage; // goal «gain» since the sport test
  await page.goto("/progreso");
  const card = page.locator("#volumen");
  await expect(card.getByRole("heading", { name: "Revisión del volumen" })).toBeVisible();
  await expect(card.getByText(/Aún no hay revisión/)).toBeVisible();
  await card.getByRole("button", { name: "Revisar ahora" }).click();
  await expect(page.getByText("Revisión actualizada")).toBeVisible();
  await expect(card.getByText("Faltan datos")).toBeVisible();
  await expect(card.getByText(/hacen falta unas 3–4 semanas/)).toBeVisible();
  await expect(card.getByText("¿Músculo o grasa?")).toBeVisible();
  await expect(card.getByText(/Sin entrenos de openGym/)).toBeVisible();
});

test("proteína por comida y tarjeta del entreno en Hoy", async () => {
  const page = adminPage; // 62,5 kg, sport profile on: ideal dose max(25, 0.4 g/kg) = 25 g
  await page.goto("/hoy");
  await expect(page.getByText("Sin registrar · ideal ≥ 25 g de proteína").first()).toBeVisible();
  // Snacks have no protein target.
  await expect(page.locator("section").filter({ has: page.getByRole("heading", { name: "Merienda" }) }).getByText("Sin registrar", { exact: true })).toBeVisible();
  // Training days (Mon/Wed/Fri in the sport test) show what to eat before and after.
  if (await page.getByText("Día de entreno: más hidratos").count()) {
    const card = page.locator("#entreno");
    await expect(card.getByText(/Aún no sé a qué hora entrenas|Sueles entrenar/)).toBeVisible();
    await expect(card.getByText(/19–25 g de proteína con hidratos/)).toBeVisible();
  } else await expect(page.locator("#entreno")).toHaveCount(0);
  await page.goto("/ajustes/notificaciones");
  await expect(page.getByText("Proteína del día")).toBeVisible();
  await expect(page.getByText("Después de entrenar")).toBeVisible();
});

test("medidas: gráfica por zona y composición corporal estimada con la cinta", async () => {
  const page = adminPage;
  await page.goto("/progreso");
  const comp = page.locator("#composicion");
  await expect(comp.getByText(/Mide cuello y cintura/)).toBeVisible();
  const save = async (values: Record<string, string>, date?: string) => {
    await page.getByRole("button", { name: "Medidas" }).click();
    const dialog = page.getByRole("dialog");
    if (date) await dialog.getByLabel("Fecha").fill(date);
    for (const [label, v] of Object.entries(values)) await dialog.getByLabel(label, { exact: true }).fill(v);
    await dialog.getByRole("button", { name: "Guardar" }).click();
    await expect(dialog).toHaveCount(0);
  };
  await save({ Cintura: "70", Cadera: "96", Cuello: "32", Hombros: "104", Gemelo: "35" });
  await expect(comp.getByText("Estimada con la cinta", { exact: false })).toBeVisible();
  await expect(comp.getByText("Masa magra", { exact: true })).toBeVisible();
  await expect(comp.getByText(/FFMI/)).toBeVisible();
  await expect(page.getByText("Hombros", { exact: true }).first()).toBeVisible();
  // A second day draws the chart, with one chip per measured zone.
  const d = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  await save({ Cintura: "71", Cadera: "96", Cuello: "32" }, d);
  const chips = page.getByRole("group", { name: "Medida que se muestra" });
  await expect(chips.getByRole("button", { name: "Cintura" })).toHaveAttribute("aria-pressed", "true");
  await chips.getByRole("button", { name: "Cadera" }).click();
  await expect(page.getByText(/Cadera: 0 cm desde el primer registro \(2 medidas\)/)).toBeVisible();
  await expect(page.getByRole("group", { name: "Dato de composición que se muestra" })).toBeVisible();
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

test("coste de receta con precios de Open Prices", async () => {
  const page = adminPage;
  await page.goto("/buscar/nuevo?barcode=8437000000017");
  await page.getByLabel("Nombre").fill("Quinoa ecológica Nutria");
  await expect(page.getByLabel("Código de barras")).toHaveValue("8437000000017");
  await page.getByLabel("kcal", { exact: true }).fill("360");
  await page.getByRole("button", { name: /Crear|Guardar/ }).click();
  await expect(page.getByText("Alimento creado")).toBeVisible();
  await page.goto("/recetas/nueva");
  await page.getByLabel("Título").fill("Quinoa sola");
  await page.getByLabel("Raciones").fill("2");
  await page.getByLabel("Ingredientes").fill("500 g de quinoa ecológica nutria");
  await page.getByLabel("Pasos").fill("Cuece la quinoa.");
  await page.getByRole("button", { name: /Guardar/ }).click();
  await expect(page).toHaveURL(/\/recetas\/[0-9a-f-]{36}$/);
  await expect(page.getByText(/Coste:\s*1,20\s€\s*por ración/)).toBeVisible();
});

test("explorar: filtros en la URL, ficha con su precio y a la compra", async () => {
  const page = adminPage;
  await page.goto("/buscar");
  await page.getByRole("tab", { name: "Explorar" }).click();
  await expect(page).toHaveURL(/ver=explorar/);
  await page.getByRole("combobox", { name: "Origen" }).selectOption("mine");
  await page.getByRole("button", { name: "Con precio", exact: true }).click();
  await page.getByRole("button", { name: "Otros", exact: true }).click();
  await expect(page).toHaveURL(/origen=mine/);
  await expect(page).toHaveURL(/precio=1/);
  await expect(page).toHaveURL(/grupo=otros/);
  // Price shown in the list (Open Prices fake: 2,40 € → 4,80 €/kg).
  await expect(page.getByRole("button", { name: /Quinoa ecológica Nutria.*4,80/ })).toBeVisible();
  await page.getByRole("combobox", { name: "Ordenar por" }).selectOption("protein_price");
  await page.getByRole("button", { name: /Más filtros/ }).click();
  await page.getByLabel("kcal máx.").fill("100");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText("Nada con estos filtros")).toBeVisible();
  // Reload keeps the filters (URL state), then clear the advanced ones.
  await page.reload();
  await expect(page.getByText("Nada con estos filtros")).toBeVisible();
  await page.getByRole("button", { name: /Más filtros \(1 activos\)/ }).click();
  await page.getByRole("button", { name: "Quitar filtros" }).click();
  await page.getByRole("button", { name: /Quinoa ecológica Nutria/ }).click();
  await page.getByRole("link", { name: /Ficha completa/ }).click();
  await expect(page).toHaveURL(/\/alimentos\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Quinoa ecológica Nutria" })).toBeVisible();
  await expect(page.getByText(/Open Prices/).first()).toBeVisible();
  await expect(page.getByText(/4,80\s€\/kg/).first()).toBeVisible();
  await page.getByRole("button", { name: "A la compra" }).click();
  await expect(page.getByText("Quinoa ecológica Nutria en la lista de la compra")).toBeVisible();
});

/** Plain white RGB PNG (a real image, so the browser can decode and crop it). */
function whitePng(w: number, h: number) {
  const chunk = (type: string, data: Buffer) => {
    const td = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 255)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("ticket: leer, revisar, guardar el precio y compartirlo en Open Prices", async () => {
  const page = adminPage;
  const fakes = process.env.E2E_FAKES_URL ?? "http://127.0.0.1:8132";
  // Connect Open Prices (fake): a wrong password is refused, the right one connects.
  await page.goto("/ajustes/integraciones");
  await page.getByLabel("Usuario de Open Food Facts").fill("e2e");
  await page.getByLabel("Contraseña").fill("mal");
  await page.getByRole("button", { name: "Conectar", exact: true }).last().click();
  await expect(page.getByText("Usuario o contraseña de Open Food Facts incorrectos")).toBeVisible();
  await page.getByLabel("Contraseña").fill("e2e-pass");
  await page.getByRole("button", { name: "Conectar", exact: true }).last().click();
  await expect(page.getByText("Open Prices conectado")).toBeVisible();

  // Scan (mock AI reading: quinoa 2,60 €, plátano a peso, bolsa).
  await page.goto("/compra/tickets");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Subir foto o PDF" }).click();
  await (await chooser).setFiles({ name: "ticket.png", mimeType: "image/png", buffer: whitePng(40, 80) });
  await expect(page).toHaveURL(/\/compra\/tickets\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Revisar ticket" })).toBeVisible();
  // Store from OpenStreetMap (fake Nominatim), lines matched and the sum checked against the total.
  await expect(page.getByRole("radio", { name: /Mercadona/ })).toBeChecked();
  await expect(page.getByRole("link", { name: "Quinoa ecológica Nutria" })).toBeVisible();
  await expect(page.getByText(/cuadra con el total/)).toBeVisible();
  await page.getByRole("button", { name: "Quitar línea: Bolsa" }).click();
  await expect(page.getByText(/faltan 0,15\s€ para el total/)).toBeVisible();
  await page.getByLabel("Compartir en Open Prices").check();
  await expect(page.getByAltText("Ticket que se compartirá")).toBeVisible();
  await page.getByRole("button", { name: "Guardar ticket" }).click();

  // Detail: shared in the background by the worker.
  await expect(page.getByRole("heading", { name: "Mercadona" })).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("main")).toContainText("1 precio publicado", { timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  const sent = (await (await fetch(`${fakes}/fake/op/last`)).json()) as { proofs: { type: string; osm: string; date: string }[]; prices: { product_code: string; price: number; proof_id: number }[] };
  expect(sent.proofs).toHaveLength(1);
  expect(sent.proofs[0]).toMatchObject({ type: "RECEIPT", osm: "NODE:4242424242", date: "2026-11-02" });
  expect(sent.prices).toEqual([expect.objectContaining({ product_code: "8437000000017", price: 2.6, proof_id: 501 })]);

  // The price lands in the food page, with its store; the receipts list and the prices page show it.
  await page.getByRole("link", { name: "Quinoa ecológica Nutria" }).click();
  await expect(page.getByText(/ticket/).first()).toBeVisible();
  await expect(page.getByText(/2,60\s€/).first()).toBeVisible();
  await page.goto("/compra/tickets");
  await expect(page.getByRole("link", { name: /Mercadona.*2 líneas/ })).toBeVisible();
  await page.goto("/compra/precios");
  await expect(page.getByText("Gasto por mes")).toBeVisible();
});

test("diario: cambiar una entrada por otro alimento buscándolo", async () => {
  const page = adminPage;
  await page.goto("/diario");
  await page.getByRole("button", { name: /Tortilla de patatas/ }).first().click();
  await page.getByRole("button", { name: "Cambiar por otro alimento" }).click();
  const search = page.getByRole("searchbox", { name: "Buscar otro alimento" });
  await expect(search).toHaveValue("Tortilla de patatas");
  await search.fill("quinoa ecológica");
  await page.getByRole("button", { name: /Quinoa ecológica Nutria/ }).click();
  await expect(page.getByText("Cambiado por Quinoa ecológica Nutria")).toBeVisible();
  await expect(page.getByRole("button", { name: /Quinoa ecológica Nutria/ }).first()).toBeVisible();
});

test("registro por IA: buscar otro alimento antes de confirmar", async () => {
  const page = adminPage;
  await page.goto("/registrar");
  await page.getByPlaceholder(/lentejas con chorizo/).fill("Tortilla");
  await page.getByRole("button", { name: "Analizar" }).click();
  await page.getByRole("button", { name: /^Buscar otro alimento para/ }).first().click();
  await page.getByRole("searchbox", { name: "Buscar otro alimento" }).fill("quinoa ecológica");
  await page.getByRole("button", { name: /Quinoa ecológica Nutria/ }).click();
  await expect(page.getByText(/Base de datos: Quinoa ecológica Nutria/)).toBeVisible();
  await page.getByRole("button", { name: "Volver" }).click();
});

test("coach: la respuesta aparece mientras se genera, sin romper la página", async () => {
  const page = adminPage;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/coach");
  await page.getByRole("button", { name: "¿Por qué no bajo de peso?" }).click();
  await expect(page.getByText(/\(simulado\) He recibido/)).toHaveCount(1);
  await expect(page.getByText("Algo ha fallado")).toHaveCount(0);
  await expect(page).toHaveURL(/\/coach\?c=/);
  await page.getByRole("textbox", { name: "Mensaje" }).fill("Y otra pregunta");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText(/\(simulado\) He recibido/)).toHaveCount(2);
  await expect(page.getByText("Y otra pregunta", { exact: true }).last()).toBeVisible();
  expect(errors).toEqual([]);
});

test("coach en el móvil: abrir y borrar conversaciones anteriores", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: await adminPage.context().storageState(), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto("/coach");
  await page.getByRole("textbox", { name: "Mensaje" }).fill("Ideas de desayuno con avena");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText(/\(simulado\) He recibido/)).toHaveCount(1);
  await expect(page).toHaveURL(/\/coach\?c=/);

  // The first conversation (from the previous test) is reachable from the phone.
  await page.getByRole("button", { name: /Conversaciones \(\d+\)/ }).click();
  const sheet = page.getByRole("dialog", { name: "Conversaciones" });
  await expect(sheet.getByRole("link", { name: /Ideas de desayuno con avena/ })).toBeVisible();
  await sheet.getByRole("link", { name: /¿Por qué no bajo de peso\?/ }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Y otra pregunta", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Ideas de desayuno con avena")).toBeHidden(); // only in the (hidden) desktop list

  await page.getByRole("button", { name: /Conversaciones \(\d+\)/ }).click();
  await sheet.getByRole("button", { name: "Borrar conversación «Ideas de desayuno con avena»" }).click();
  await sheet.getByRole("button", { name: "Borrar", exact: true }).click();
  await expect(page.getByText("Conversación borrada")).toBeVisible();
  await expect(sheet.getByRole("link", { name: /Ideas de desayuno con avena/ })).toHaveCount(0);
  await expect(sheet.getByRole("link", { name: /¿Por qué no bajo de peso\?/ })).toBeVisible();
  await ctx.close();
});

test("plan semanal: añadir la receta y mandarla a la compra", async () => {
  const page = adminPage;
  await page.goto("/planes");
  await page.getByRole("button", { name: "Empezar a mano" }).click();
  await page.getByRole("button", { name: "Añadir plato" }).first().click();
  await page.getByRole("button", { name: /Garbanzos con espinacas/ }).click();
  await expect(page.getByText("Garbanzos con espinacas").first()).toBeVisible();
  // Coverage of that day against its own target, and batch cooking once it repeats on another day.
  await expect(page.getByText(/\/[\d.]+ kcal · P \d+\/\d+ g/).first()).toBeVisible();
  await expect(page.getByText("Cocina por lotes")).toHaveCount(0);
  await page.getByRole("button", { name: "Añadir plato" }).nth(2).click();
  await page.getByRole("button", { name: /Garbanzos con espinacas/ }).click();
  await expect(page.getByText("Cocina por lotes")).toBeVisible();
  await expect(page.getByRole("link", { name: "Cocinar en lote" })).toHaveAttribute("href", /\/recetas\/.+\/cocinar/);
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
  await expect(page.getByRole("heading", { name: "Copias de seguridad" })).toBeVisible();
});

test("los errores del servidor llegan con su mensaje en producción", async () => {
  const page = adminPage;
  await page.goto("/despensa");
  await page.getByLabel("Producto").fill("Leche");
  await page.getByLabel("Caduca").fill("pasado mañana");
  await page.getByRole("button", { name: "Añadir" }).click();
  await expect(page.getByText(/Fecha no válida/)).toBeVisible();
});

test("sondeos de bots a server actions: 404 sin llegar a Next; las acciones reales siguen funcionando", async ({ request }) => {
  for (const id of ["x", "0", "a".repeat(41), "z".repeat(42)]) {
    const r = await request.post("/", { headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8" }, data: "[]" });
    expect(r.status(), id).toBe(404);
  }
  // A real action from the UI still goes through (previous test already submitted one; do another).
  const page = adminPage;
  await page.goto("/despensa");
  await page.getByLabel("Producto").fill("Arroz");
  await page.getByRole("button", { name: "Añadir" }).click();
  await expect(page.getByText("Arroz").first()).toBeVisible();
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
  expect(await json.text()).toContain("Quinoa ecológica Nutria");
  const csv = await page.request.get(jsonHref!.replace("format=json", "format=csv&table=diario"));
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("Quinoa ecológica Nutria");

  await page.locator("input[type=file]").setInputFiles({ name: "cronometer.csv", mimeType: "text/csv", buffer: Buffer.from("Day,Food Name,Amount,Energy (kcal),Protein (g),Carbs (g),Fat (g)\n2026-11-01,Yogur importado,125 g,80,5,6,3\n2026-11-01,Pan importado,60 g,150,5,30,1\n") });
  await expect(page.getByText("Importación en cola")).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/2 alimentos/)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByText("· Cronometer")).toBeVisible();
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
  // Un profesional no tiene diario propio: entra directo a las personas que sigue.
  await expect(pro).toHaveURL(/\/familia/);
  await expect(pro.getByText("Personas que sigues")).toBeVisible();
  await pro.getByRole("link", { name: /Ana Prueba/ }).click();
  await expect(pro.getByText(/Profesional/).first()).toBeVisible();
  await pro.getByPlaceholder(/Pauta, observación/).fill("Subir legumbres a 4 veces por semana");
  await pro.getByRole("button", { name: "Añadir nota" }).click();
  await expect(pro.getByText("Subir legumbres a 4 veces por semana")).toBeVisible();
  await pro.getByRole("button", { name: "Ver su día" }).click();
  await expect(pro).toHaveURL(/\/hoy/);
  await expect(pro.getByText("Solo lectura", { exact: true })).toBeVisible();
  await pro.goto("/diario");
  await expect(pro.getByText("Quinoa ecológica Nutria").first()).toBeVisible();
  // Lo no compartido (medicación) no se ve.
  await pro.goto("/salud/medicacion");
  await expect(pro).toHaveURL(/sinpermiso=medication/);

  await page.goto(ana);
  await expect(page.getByText("Subir legumbres a 4 veces por semana")).toBeVisible();
  // El acceso del profesional caduca (90 días por defecto).
  await expect(page.getByRole("listitem").filter({ hasText: "Marta Nutricionista" }).getByText(/· hasta \d/)).toBeVisible();
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

// 1×1 PNG para las subidas de imagen (la IA es simulada).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("webhooks: salida firmada (Home Assistant) y peso de entrada con token", async () => {
  const page = adminPage;
  await page.goto("/ajustes/integraciones");
  await page.getByLabel("URL de destino").fill("http://fakes:8080/hook");
  await page.getByRole("button", { name: "Peso registrado" }).click();
  await page.getByRole("button", { name: "Añadir webhook" }).click();
  await expect(page.getByText(/Secreto de firma/)).toBeVisible();
  await page.getByRole("button", { name: "Probar" }).click();
  // El receptor falso solo responde 200 si la petición viene firmada.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("(HTTP 200)")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });

  await page.getByLabel("Nombre").fill("Báscula");
  await page.getByRole("button", { name: "escribir" }).click();
  await page.getByRole("button", { name: "Crear" }).click();
  const secret = page.getByText("Cópialo ahora").locator("..").locator("code");
  await expect(secret).toHaveText(/\S{20,}/);
  const token = (await secret.textContent())!.trim();
  const res = await page.request.post("/api/hooks/weight", { headers: { authorization: `Bearer ${token}` }, data: { kg: 63.4, id: "bascula-1" } });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const again = await page.request.post("/api/hooks/weight", { headers: { authorization: `Bearer ${token}` }, data: { kg: 63.4, id: "bascula-1" } });
  expect(again.status()).toBeLessThan(300); // idempotente
  // Phone/watch data (Health Connect format): steps and sleep land on their pages.
  const now = new Date();
  const health = await page.request.post("/api/hooks/health", {
    headers: { authorization: `Bearer ${token}` },
    data: { steps: [{ count: 8200, start_time: now.toISOString() }], sleep: [{ session_end_time: now.toISOString(), duration_seconds: 27000 }], heart_rate: [{ bpm: 61, time: now.toISOString() }] },
  });
  expect(health.status(), await health.text()).toBe(200);
  expect(((await health.json()) as { saved: { steps: number; sleep: number; heartDays: number } }).saved).toMatchObject({ steps: 1, sleep: 1, heartDays: 1 });
  expect((await page.request.post("/api/hooks/health", { data: { steps: 1 } })).status()).toBe(401);
  await page.goto("/salud/sueno");
  await expect(page.getByText("7,5 h", { exact: false }).first()).toBeVisible();
  await page.goto("/ajustes/datos");
  const href = await page.getByRole("link", { name: "Todo (JSON)" }).getAttribute("href");
  const pesos = ((await (await page.request.get(href!)).json()) as { data: { pesos: { kg: number; source: string }[] } }).data.pesos;
  expect(pesos.filter((p) => p.kg === 63.4)).toHaveLength(1);
});

test("openGym: emparejar con código, importar entreno con sus ejercicios y reflejar borrados", async () => {
  const page = adminPage;
  // The fake openGym is published on the NUC as 127.0.0.1:8132 (tunnelled like the app).
  const fakes = process.env.E2E_FAKES_URL ?? "http://127.0.0.1:8132";
  await page.request.post(`${fakes}/fake/og/reset`);
  await page.goto("/ajustes/integraciones");
  await expect(page.getByText("Emparejar la app móvil")).toBeVisible();
  await page.getByLabel("Dirección de openGym").fill("http://fakes:8080");
  await page.getByLabel("Código de emparejamiento").fill("ZZZZ2222");
  await page.getByRole("button", { name: "Conectar", exact: true }).click();
  await expect(page.getByText("Código de emparejamiento no válido o caducado")).toBeVisible();
  await page.getByLabel("Código de emparejamiento").fill("k7wq2mzp");
  await page.getByRole("button", { name: "Conectar", exact: true }).click();
  await expect(page.getByText("openGym conectado: 1 entreno y 1 pesaje importados")).toBeVisible();
  await expect(page.getByText(/Se sincroniza sola cada 2 min/)).toBeVisible();
  await expect(page.getByText("Ana (openGym)", { exact: false })).toBeVisible();
  await expect(page.getByText("api/hooks/opengym")).toHaveCount(0);

  await page.goto("/salud/ejercicio");
  await expect(page.getByText("Pierna (openGym e2e)")).toBeVisible();
  await page.getByText("2 ejercicios · 1 récord").click();
  await expect(page.getByText("Sentadilla con barra alta")).toBeVisible();
  await expect(page.getByText("3×8 · 60 kg")).toBeVisible();
  await expect(page.getByText("Zancada en mi banco")).toBeVisible();
  await expect(page.getByText("12×10 kg, 10×12 kg")).toBeVisible();

  await page.goto("/ajustes/datos");
  const href = await page.getByRole("link", { name: "Todo (JSON)" }).getAttribute("href");
  const pesos = ((await (await page.request.get(href!)).json()) as { data: { pesos: { kg: number; source: string }[] } }).data.pesos;
  expect(pesos.some((p) => p.kg === 61.8 && p.source === "opengym")).toBe(true);

  // Deleted in openGym → gone from Nutria on the next sync.
  await page.request.post(`${fakes}/fake/og/delete`);
  await page.goto("/ajustes/integraciones");
  await page.getByRole("button", { name: "Sincronizar ahora" }).click();
  await expect(page.getByText("Sincronizado: 0 entrenos y 1 pesaje · 1 borrado")).toBeVisible();
  await page.goto("/salud/ejercicio");
  await expect(page.getByText("Pierna (openGym e2e)")).toHaveCount(0);
});

test("IA en la cocina (simulada): sustituciones y foto de la nevera", async () => {
  const page = adminPage;
  await page.goto("/recetas");
  await page.getByRole("link", { name: /Garbanzos con espinacas/ }).first().click();
  await page.getByRole("button", { name: "Sin lactosa" }).click();
  await page.getByRole("button", { name: "Sugerir" }).click();
  await expect(page.getByText("yogur griego")).toBeVisible();

  await page.goto("/despensa");
  // Como una persona: pulsar el botón abre el selector (y garantiza que la página ya está hidratada).
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Foto de la nevera" }).click();
  await (await chooser).setFiles({ name: "nevera.png", mimeType: "image/png", buffer: PNG });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Guardar 1" })).toBeVisible();
  await dialog.getByRole("button", { name: "Guardar 1" }).click();
  await expect(page.getByText("1 producto guardado")).toBeVisible();
  await expect(page.getByText("Leche").first()).toBeVisible();
});

const ROUTES = [
  "/hoy", "/diario", "/buscar", "/buscar/nuevo", "/registrar", "/coach", "/coach/memoria", "/progreso", "/progreso/informe", "/informe",
  "/salud", "/salud/medicacion", "/salud/suplementos", "/salud/sintomas", "/salud/analiticas", "/salud/ayuno", "/salud/ejercicio", "/salud/sueno", "/salud/ciclo", "/salud/condiciones",
  "/recetas", "/recetas/nueva", "/recetas/importar", "/planes", "/despensa", "/compra", "/compra/tickets", "/compra/precios", "/familia", "/retos", "/mas", "/admin",
  "/ajustes", "/ajustes/objetivos", "/ajustes/comidas", "/ajustes/pantalla", "/ajustes/notificaciones", "/ajustes/seguridad", "/ajustes/integraciones", "/ajustes/datos",
];

/** Every route, plus detail pages: first recipe, first person and the current plan's review. */
async function allRoutes(page: Page) {
  await page.goto("/recetas");
  const recipe = await page.locator('a[href^="/recetas/"]').filter({ hasNotText: /nueva|importar/i }).first().getAttribute("href");
  await page.goto("/familia");
  const person = await page.locator('a[href^="/familia/"]').first().getAttribute("href");
  await page.goto("/planes");
  const retro = await page.locator('a[href$="/repaso"]').first().getAttribute("href");
  // evaluateAll does not wait: these links only exist once a ticket has been saved.
  const firstHref = (sel: string) => page.locator(sel).evaluateAll((els) => els[0]?.getAttribute("href") ?? null);
  await page.goto("/compra/tickets");
  const ticket = await firstHref('a[href^="/compra/tickets/"]');
  if (ticket) await page.goto(ticket);
  const food = ticket ? await firstHref('main a[href^="/alimentos/"]') : null;
  return [...ROUTES, ...[recipe, recipe && `${recipe}/editar`, recipe && `${recipe}/cocinar`, person, retro, ticket, ticket && `${ticket}?editar=1`, food].filter((x): x is string => !!x)];
}

test("registro rápido: plantilla en un toque, atajos y acciones de los avisos", async () => {
  const page = adminPage;
  await page.goto("/hoy");
  // Breakfast has at least the creatine dose taken in the sport test.
  const breakfast = page.locator("section").filter({ has: page.getByRole("heading", { name: "Desayuno" }) });
  await breakfast.getByRole("button", { name: "Más opciones" }).click();
  await page.getByRole("menuitem", { name: "Guardar como plantilla" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre").fill("Desayuno e2e");
  await dialog.getByRole("button", { name: "Guardar plantilla" }).click();
  await expect(page.getByText("Plantilla guardada")).toBeVisible();

  await page.goto("/buscar?ver=plantillas&comida=dinner");
  await expect(page.getByText("Desayuno e2e")).toBeVisible();
  await page.getByRole("button", { name: "Registrar Desayuno e2e en Cena" }).click();
  await expect(page.getByText(/Desayuno e2e: \d+ alimentos? registrados? en cena/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/usada 1 vez/)).toBeVisible();

  // The endpoint behind the notification buttons always answers with a message.
  const shake = await page.request.post("/api/diary/quick", { data: { kind: "shake" } });
  expect(shake.status()).toBe(200);
  expect(((await shake.json()) as { message: string }).message).toMatch(/batido|Batido|proteína/);
  expect((await page.request.post("/api/diary/quick", { data: { kind: "nope" } })).status()).toBe(400);
  // App shortcut: logs (or explains why not) and cleans the URL.
  await page.goto("/hoy?rapido=ayer");
  await expect(page.getByText(/Copiado de ayer|Ayer no registraste|Ya hay algo registrado/)).toBeVisible();
  await expect(page).toHaveURL(/\/hoy$/);
  const manifest = (await (await page.request.get("/manifest.webmanifest")).json()) as { shortcuts: { url: string }[] };
  expect(manifest.shortcuts.map((s) => s.url)).toEqual(expect.arrayContaining(["/hoy?rapido=ayer", "/hoy?rapido=batido"]));
});

test("todas las páginas cargan sin errores de servidor", async () => {
  const page = adminPage;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
  const all = await allRoutes(page);
  for (const r of all) {
    const res = await page.goto(r);
    expect(res?.status(), r).toBeLessThan(500);
    await expect(page.getByText(/Internal Server Error|Application error|Algo ha fallado/i), r).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("diario en el móvil: cambiar gramos y comida, borrar con confirmación; agua; compra", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: await adminPage.context().storageState(), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto("/diario");
  const entry = () => page.getByRole("button", { name: /Pan blanco/ });
  await entry().first().click();
  const dialog = page.getByRole("dialog", { name: "Pan blanco" });
  await dialog.getByLabel("Cantidad (g)").fill("80");
  const slot = dialog.getByLabel("Comida");
  const target = (await slot.inputValue()) === "breakfast" ? "Comida" : "Desayuno";
  await slot.selectOption({ label: target });
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog).toBeHidden();
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: target, exact: true }) });
  await expect(section.getByRole("button", { name: /Pan blanco/ })).toContainText("80 g");
  await expect(section.getByRole("button", { name: /Pan blanco/ })).not.toContainText("rebanada");

  // Deleting asks for a second tap.
  await entry().first().click();
  await dialog.getByRole("button", { name: "Borrar" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "¿Seguro? Borrar" }).click();
  await expect(page.getByText("Pan blanco borrado")).toBeVisible();
  await expect(entry()).toHaveCount(0);

  await page.goto("/hoy");
  await page.getByRole("button", { name: "+250 ml" }).click();
  await expect(page.getByText("0,25 / 2 L")).toBeVisible();

  await page.goto("/compra");
  // Ticked items move to the "done" list, so follow the item by its name.
  const name = (await page.getByRole("checkbox").first().getAttribute("aria-label"))!;
  const box = page.getByRole("checkbox", { name, exact: true });
  await box.click();
  await expect(box).toHaveAttribute("aria-checked", "true");
  await box.click();
  await expect(box).toHaveAttribute("aria-checked", "false");
  await ctx.close();
});

/**
 * Phone pass over every page: no horizontal overflow, no client errors, no 5xx, and every dialog
 * (Radix triggers) opens and closes cleanly; buttons/links have a name and images an alt.
 * With E2E_EXPLORE_DIR it also writes a report (console errors, 4xx, slow pages) and screenshots.
 */
test("en el móvil, ninguna página desborda ni da errores", async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ storageState: await adminPage.context().storageState(), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const dir = process.env.E2E_EXPLORE_DIR;
  if (dir) mkdirSync(dir, { recursive: true });
  const hard: string[] = [];
  const report: { route: string; kind: string; detail: string }[] = [];
  let route = "";
  page.on("pageerror", (e) => hard.push(`${route}: pageerror ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 500) hard.push(`${route}: ${r.status()} ${r.url()}`);
    else if (r.status() >= 400 && !/\/api\/auth\//.test(r.url())) report.push({ route, kind: "http", detail: `${r.status()} ${r.url()}` });
  });
  page.on("console", (m) => {
    if (m.type() === "error") report.push({ route, kind: "console", detail: m.text().slice(0, 300) });
  });
  const overflow = () =>
    page.evaluate(() => {
      const w = window.innerWidth;
      if (document.documentElement.scrollWidth <= w + 1) return [];
      const scrolls = (el: Element | null): boolean => {
        for (let p = el; p && p !== document.body; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true;
        }
        return false;
      };
      const out: string[] = [];
      for (const el of document.body.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= w + 1 || scrolls(el.parentElement)) continue;
        if ([...el.children].some((c) => c.getBoundingClientRect().right > w + 1)) continue;
        const id = el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 4).join(".") : "");
        out.push(`${id} «${(el.textContent ?? "").trim().slice(0, 40)}» right=${Math.round(r.right)}`);
        if (out.length >= 5) break;
      }
      return out.length ? out : [`scrollWidth=${document.documentElement.scrollWidth}`];
    });
  const soft = () =>
    page.evaluate(() => {
      const out: string[] = [];
      for (const b of document.querySelectorAll("button, a[href]")) {
        const el = b as HTMLElement;
        if (!el.offsetParent) continue;
        const name = (el.getAttribute("aria-label") ?? "") + (el.getAttribute("title") ?? "") + (el.innerText ?? "").trim();
        const labelled = el.getAttribute("aria-labelledby");
        if (!name && !labelled) out.push(`sin nombre: <${el.tagName.toLowerCase()} class="${(el.className || "").toString().slice(0, 60)}">`);
      }
      for (const i of document.querySelectorAll("img:not([alt])")) out.push(`img sin alt: ${(i as HTMLImageElement).src.slice(0, 80)}`);
      return out;
    });

  for (const r of await allRoutes(page)) {
    route = r;
    const t0 = Date.now();
    const res = await page.goto(r, { waitUntil: "networkidle" });
    const ms = Date.now() - t0;
    expect(res?.status(), r).toBeLessThan(500);
    if (ms > 2500) report.push({ route: r, kind: "lento", detail: `${ms} ms` });
    for (const o of await overflow()) hard.push(`${r}: desborda ${o}`);
    // Buttons and links need an accessible name; images an alt.
    for (const x of await soft()) hard.push(`${r}: ${x}`);
    if (dir) {
      await page.screenshot({ path: join(dir, `${r.replace(/\//g, "_") || "_"}.png`), fullPage: true });
    }
    // Open and close each dialog trigger (bounded) and check the sheet fits too.
    const triggers = page.locator('button[aria-haspopup="dialog"]:visible');
    const n = Math.min(await triggers.count(), 6);
    for (let i = 0; i < n; i++) {
      const t = triggers.nth(i);
      const label = ((await t.getAttribute("aria-label")) ?? (await t.innerText())).trim().slice(0, 40);
      route = `${r} [${label}]`;
      await t.click();
      const dlg = page.getByRole("dialog");
      await expect(dlg.first(), route).toBeVisible();
      const wide = await dlg.first().evaluate((d) => d.scrollWidth > d.clientWidth + 1);
      if (wide) hard.push(`${route}: el diálogo desborda en horizontal`);
      if (dir) await page.screenshot({ path: join(dir, `${r.replace(/\//g, "_")}__dlg${i}.png`) });
      await page.keyboard.press("Escape");
      await expect(dlg, route).toHaveCount(0);
      route = r;
    }
  }
  if (dir) writeFileSync(join(dir, "report.json"), JSON.stringify({ hard, report }, null, 2));
  await ctx.close();
  expect(hard).toEqual([]);
});

// Informative: JS downloaded to render a page from a cold cache (compressed bytes over the wire).
test("medida: JavaScript inicial por página", async ({ browser }) => {
  const sizes: Record<string, number> = {};
  for (const route of ["/hoy", "/buscar", "/progreso", "/compra/precios"]) {
    const ctx = await browser.newContext({ storageState: await adminPage.context().storageState(), serviceWorkers: "block" });
    const page = await ctx.newPage();
    let bytes = 0;
    page.on("response", (r) => {
      if (!/\/_next\/static\/.*\.js/.test(r.url())) return;
      void r.body().then((b) => (bytes += Number(r.headers()["content-length"] ?? b.length))).catch(() => undefined);
    });
    await page.goto(route, { waitUntil: "networkidle" });
    sizes[route] = Math.round(bytes / 1024);
    await ctx.close();
  }
  console.log(`JS_INICIAL_KB ${JSON.stringify(sizes)}`);
  expect(sizes["/hoy"]).toBeGreaterThan(0);
});
