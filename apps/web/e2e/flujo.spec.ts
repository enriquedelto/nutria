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
