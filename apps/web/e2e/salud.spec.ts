import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STATE, whitePng } from "./helpers";

/**
 * Pantallas sin cobertura en flujo.spec.ts: salud (medicación, síntomas, analíticas, sueño, ciclo),
 * despensa con caducidades, retos y logros, fotos de progreso, etiqueta por IA, compartir con Nutria
 * y la cola sin conexión. Cada bloque crea lo que necesita; solo reutiliza la sesión del admin
 * (el registro está cerrado tras la primera cuenta), así que va después de flujo.spec.ts.
 */
let page: Page;

test.beforeAll(async ({ browser }) => {
  test.skip(!existsSync(ADMIN_STATE), "Lanza la batería completa: necesita la sesión que crea flujo.spec.ts");
  page = await (await browser.newContext({ storageState: ADMIN_STATE })).newPage();
});

const tag = Date.now().toString(36).slice(-4);

test.describe("salud", () => {
  test("medicación: «días vacío = todos» genera la toma de hoy y se marca", async () => {
    const name = `Eutirox ${tag}`;
    await page.goto("/salud/medicacion");
    await page.getByRole("button", { name: "Añadir", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nombre").fill(name);
    await dialog.getByLabel("Dosis").fill("50 µg");
    await dialog.getByRole("button", { name: "Guardar" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(/08:00 · todos los días/).first()).toBeVisible();
    // The worker generates today's doses (job medication.doses); the 08:00 one exists even if it already passed.
    const dose = page.locator("li").filter({ hasText: name }).filter({ has: page.getByRole("button", { name: "Marcar" }) });
    await expect(async () => {
      await page.reload();
      await expect(dose).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await dose.getByRole("button", { name: "Marcar" }).click();
    const taken = page.locator("li").filter({ hasText: name }).getByRole("button", { name: "Tomada" });
    await expect(taken).toBeVisible();
    await page.reload();
    await expect(taken).toBeVisible();
  });

  test("síntomas: anotar uno y lanzar la búsqueda de relaciones", async () => {
    await page.goto("/salud/sintomas");
    await page.getByRole("button", { name: "Hinchazón", exact: true }).click();
    await expect(page.getByLabel("Síntoma")).toHaveValue("Hinchazón");
    await page.getByRole("button", { name: "Anotar" }).click();
    await expect(page.getByText("Síntoma anotado")).toBeVisible();
    await expect(page.getByText(/Hinchazón ×\d/)).toBeVisible();
    await page.getByRole("button", { name: "Buscar relaciones ahora" }).click();
    await expect(page.getByText(/Analizando/)).toBeVisible();
  });

  test("analíticas (IA simulada): leer, revisar y guardar", async () => {
    await page.goto("/salud/analiticas");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Subir PDF o fotos" }).click();
    await (await chooser).setFiles({ name: "analitica.png", mimeType: "image/png", buffer: whitePng(300, 400) });
    await expect(page.getByText(/\d+ valores leídos/)).toBeVisible();
    await page.getByRole("button", { name: /^Guardar \d+ valores/ }).click();
    await expect(page.getByText("Analítica guardada")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Ferritina").first()).toBeVisible();
    await expect(page.getByText("Laboratorio simulado").first()).toBeVisible();
  });

  test("sueño: anotar la noche", async () => {
    await page.goto("/salud/sueno");
    await page.getByRole("button", { name: "🙂" }).click();
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Sueño guardado")).toBeVisible();
    await page.reload();
    const nights = page.locator("li").filter({ hasText: /^Hoy/ });
    await expect(nights.getByText(/^8(,0)? h/)).toBeVisible();
  });

  test("ciclo: empezar la regla, anotar un síntoma y terminarla", async () => {
    await page.goto("/salud/ciclo");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(/^Día 1 · /)).toBeVisible();
    await page.getByRole("button", { name: "Dolor", exact: true }).click();
    await expect(page.getByText("Dolor anotado")).toBeVisible();
    await page.getByRole("button", { name: "Terminó la regla (hoy)" }).click();
    await expect(page.getByRole("button", { name: "Terminó la regla (hoy)" })).toHaveCount(0);
  });
});

test.describe("casa", () => {
  test("despensa: caducidades con atajos", async () => {
    await page.goto("/despensa");
    const add = async (name: string, exp: string) => {
      await page.getByLabel("Producto").fill(name);
      await page.getByLabel("Caduca").fill(exp);
      await page.getByRole("button", { name: "Añadir", exact: true }).click();
      await expect(page.getByLabel("Producto")).toHaveValue("");
    };
    await add(`Yogures ${tag}`, "+1d");
    await add(`Pechuga ${tag}`, "+3d");
    await expect(page.locator("li").filter({ hasText: `Yogures ${tag}` }).getByText("caduca mañana")).toBeVisible();
    await expect(page.locator("li").filter({ hasText: `Pechuga ${tag}` }).getByText("caduca en 3 días")).toBeVisible();
  });

  test("retos: crear uno, salir y volver, y recalcular logros", async () => {
    await page.goto("/retos");
    await page.getByRole("button", { name: "Nuevo reto" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Semana registrando todo" }).click();
    await dialog.getByLabel("Título").fill(`Semana ${tag}`);
    await dialog.getByRole("button", { name: "Crear reto" }).click();
    await expect(dialog).toHaveCount(0);
    const card = page.locator("section").filter({ hasText: `Semana ${tag}` }).filter({ has: page.getByRole("button", { name: "Borrar reto" }) }).last();
    await card.getByRole("button", { name: "Salir" }).click();
    await expect(card.getByRole("button", { name: "Unirme" })).toBeVisible();
    await card.getByRole("button", { name: "Unirme" }).click();
    await expect(card.getByRole("button", { name: "Salir" })).toBeVisible();

    await page.getByRole("button", { name: "Actualizar" }).click();
    const logros = page.getByRole("heading", { name: /^Logros \d+ de \d+$/ });
    await expect(logros).toBeVisible();
    // flujo.spec.ts already logged food, water and training: something must be unlocked.
    await expect.poll(async () => Number((await logros.textContent())!.match(/(\d+) de/)![1])).toBeGreaterThan(0);

    await card.getByRole("button", { name: "Borrar reto" }).click();
    await expect(page.getByText(`Semana ${tag}`, { exact: true })).toHaveCount(0);
  });
});

test.describe("fotos e IA", () => {
  test("fotos de progreso: se guardan cifradas y solo las ve quien tiene sesión", async ({ request }) => {
    await page.goto("/progreso");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Foto", exact: true }).click();
    await (await chooser).setFiles({ name: "frente.png", mimeType: "image/png", buffer: whitePng(300, 400) });
    await expect(page.getByText("Foto guardada (cifrada)")).toBeVisible();
    const img = page.getByRole("img", { name: "Foto de progreso" }).first();
    await expect(img).toBeVisible();
    const src = (await img.getAttribute("src"))!;
    const mine = await page.request.get(src);
    expect(mine.status()).toBe(200);
    expect(mine.headers()["content-type"]).toMatch(/^image\//);
    // Without a session (the bare request fixture) the photo is not served.
    expect((await request.get(src, { maxRedirects: 0 })).status()).toBeGreaterThanOrEqual(300);
  });

  test("alimento nuevo desde la foto de la etiqueta (IA simulada) y registro sin conexión", async () => {
    await page.goto("/buscar/nuevo");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Foto de la etiqueta" }).click();
    await (await chooser).setFiles({ name: "etiqueta.png", mimeType: "image/png", buffer: whitePng(300, 400) });
    await expect(page.getByText("Etiqueta leída")).toBeVisible();
    await expect(page.getByLabel("Nombre")).toHaveValue("Yogur natural");
    await expect(page.getByLabel("kcal")).toHaveValue("61");
    await page.getByLabel("Nombre").fill(`Yogur etiqueta ${tag}`);
    await page.getByRole("button", { name: "Guardar alimento" }).click();
    await expect(page.getByText("Alimento creado")).toBeVisible();
    await expect(page).toHaveURL(/\/buscar\?abrir=[0-9a-f-]{36}/);

    // Fresh load of that URL (the client-side navigation may still be settling): the dialog opens with
    // the food already loaded, and the save goes out with no connection.
    await page.goto(page.url());
    const dialog = page.getByRole("dialog");
    const addBtn = dialog.getByRole("button", { name: /^Añadir \d+ g/ });
    await expect(addBtn).toBeVisible();
    await page.context().setOffline(true);
    try {
      await addBtn.click();
      await expect(page.getByText("Guardado sin conexión; se enviará luego")).toBeVisible();
    } finally {
      await page.context().setOffline(false);
    }
    await expect(page.getByText(/Sincronizado: 1 registro/)).toBeVisible({ timeout: 30_000 });
    await page.goto("/diario");
    await expect(page.getByText(`Yogur etiqueta ${tag}`).first()).toBeVisible();
  });

  test("compartir con Nutria: fotos al registro con IA, enlaces a importar receta", async ({ request }) => {
    const share = (multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>) => page.request.post("/api/share-target", { multipart, maxRedirects: 0 });
    const photo = await share({ files: { name: "plato.png", mimeType: "image/png", buffer: whitePng(200, 200) } });
    expect(photo.status()).toBe(303);
    const to = photo.headers().location;
    expect(to).toMatch(/^\/registrar\?compartido=[0-9a-f-]{36}$/);
    await page.goto(to);
    await expect(page.getByRole("img", { name: "Foto 1" })).toBeVisible();

    const link = await share({ title: "Lentejas", text: "Mira esta receta https://example.com/lentejas" });
    expect(link.headers().location).toBe(`/recetas/importar?url=${encodeURIComponent("https://example.com/lentejas")}`);
    const text = await share({ text: "dos huevos fritos" });
    expect(text.headers().location).toBe(`/registrar?texto=${encodeURIComponent("dos huevos fritos")}`);
    // Without a session it goes to the login.
    const anon = await request.post("/api/share-target", { multipart: { text: "hola" }, maxRedirects: 0 });
    expect(anon.status()).toBe(303);
    expect(anon.headers().location).toMatch(/^\/login/);
  });
});
