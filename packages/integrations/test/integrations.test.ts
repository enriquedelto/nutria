import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  assertPublicUrl,
  decrypt,
  decryptFile,
  encrypt,
  encryptFile,
  extractJsonLdRecipe,
  hmacSha256,
  importDiaryCsv,
  isPrivateIp,
  isoDurationMinutes,
  keepForMirror,
  mapMercadonaProduct,
  mapOpenGymState,
  newToken,
  OffClient,
  offTsvRowToProduct,
  parseCiqual,
  parseCsv,
  sha256,
  tsvParser,
  verifySignature,
} from "../src";

const K = randomBytes(32);

describe("secretos", () => {
  it("cifra y descifra texto y ficheros", () => {
    expect(decrypt(encrypt("hola", K), K)).toBe("hola");
    expect(decryptFile(encryptFile(Buffer.from("foto"), K), K).toString()).toBe("foto");
    expect(() => decrypt(encrypt("x", K), randomBytes(32))).toThrow();
  });
  it("tokens y firmas", () => {
    const t = newToken("ntr");
    expect(t.token.startsWith("ntr_")).toBe(true);
    expect(t.hash).toBe(sha256(t.token));
    expect(verifySignature("s", "body", `sha256=${hmacSha256("s", "body")}`)).toBe(true);
    expect(verifySignature("s", "body", "sha256=00")).toBe(false);
  });
});

describe("SSRF", () => {
  it("bloquea IPs privadas y hosts internos", async () => {
    expect(isPrivateIp("10.1.2.3")).toBe(true);
    expect(isPrivateIp("100.101.1.1")).toBe(true);
    expect(isPrivateIp("192.168.1.10")).toBe(true);
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    await expect(assertPublicUrl("http://127.0.0.1/x")).rejects.toThrow();
    await expect(assertPublicUrl("http://nuc.tu-tailnet.ts.net:8443")).rejects.toThrow();
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow();
  });
});

describe("OFF", () => {
  it("cliente con fetch simulado", async () => {
    const fake = (async (url: string) => {
      expect(String(url)).toContain("/api/v2/product/123456789.json");
      return new Response(JSON.stringify({ status: 1, product: { product_name: "Leche", nutriments: { "energy-kcal_100g": 47 } } }));
    }) as unknown as typeof fetch;
    const f = await new OffClient({ fetch: fake }).product("123456789");
    expect(f?.name).toBe("Leche");
    expect(f?.barcode).toBe("123456789");
  });
  it("fila TSV del volcado → producto y filtro España", () => {
    const parse = tsvParser("code\tproduct_name\tcountries_tags\tenergy-kcal_100g\tproteins_100g\tcategories_tags");
    const p = offTsvRowToProduct(parse("84123\tGalletas\ten:spain,en:france\t450\t6\ten:snacks,en:biscuits"));
    expect(p.nutriments?.["energy-kcal_100g"]).toBe(450);
    expect(keepForMirror(p)).toBe(true);
    expect(keepForMirror({ ...p, countries_tags: ["en:germany"] })).toBe(false);
  });
});

describe("recetas JSON-LD", () => {
  it("extrae receta de @graph con secciones", () => {
    const ld = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebPage", name: "x" },
        {
          "@type": ["Recipe"],
          name: "Lentejas estofadas",
          recipeYield: "4 raciones",
          prepTime: "PT15M",
          cookTime: "PT1H",
          image: [{ url: "https://img/l.jpg" }],
          recipeIngredient: ["300 g de lentejas", "1 cebolla", "2 zanahorias"],
          recipeInstructions: [
            { "@type": "HowToSection", name: "Sofrito", itemListElement: [{ "@type": "HowToStep", text: "Pica la cebolla." }] },
            { "@type": "HowToStep", text: "Cuece 1 hora." },
          ],
          keywords: "legumbres, cuchara",
        },
      ],
    };
    const html = `<html><script type="application/ld+json">${JSON.stringify(ld)}</script></html>`;
    const r = extractJsonLdRecipe(html, "https://x/l")!;
    expect(r.title).toBe("Lentejas estofadas");
    expect(r.servings).toBe(4);
    expect(r.cookMin).toBe(60);
    expect(r.ingredients).toHaveLength(3);
    expect(r.steps[0]).toEqual({ text: "Pica la cebolla.", section: "Sofrito" });
    expect(r.imageUrl).toBe("https://img/l.jpg");
    expect(isoDurationMinutes("PT1H30M")).toBe(90);
  });
});

describe("openGym", () => {
  it("mapea entrenos y pesajes (lb→kg)", () => {
    const { exercises, weights } = mapOpenGymState(
      {
        unit: "lb",
        workouts: [
          { id: "w1", d: "2026-11-01", start: 1, end: 1 + 60 * 60000, name: "Pierna", vol: 22046, entries: [{ id: "squat", sets: [{ w: 100, r: 5, done: true }, { w: 100, r: 5 }] }] },
        ],
        bodyweight: [{ d: "2026-11-01", w: 176.4, t: 1 }],
      },
      80,
    );
    expect(exercises[0]).toMatchObject({ externalId: "w1", durationMin: 60, sets: 2, volumeKg: 10000 });
    expect(exercises[0]!.kcal).toBeGreaterThan(100);
    expect(weights[0]!.kg).toBeCloseTo(80, 0);
  });
});

describe("Mercadona", () => {
  it("mapea producto con precio por kg", () => {
    const p = mapMercadonaProduct({
      id: "4241",
      display_name: "Garbanzo cocido",
      packaging: "Bote",
      thumbnail: "t",
      price_instructions: { unit_price: "0.85", unit_size: 0.4, size_format: "kg", reference_price: "2.125", reference_format: "kg" },
    });
    expect(p).toMatchObject({ id: "4241", price: 0.85, packGrams: 400, pricePerKg: 2.125 });
  });
});

describe("CIQUAL XML", () => {
  it("cruza alimentos, constituyentes y valores", () => {
    const rows = parseCiqual({
      alim: "<TABLE><ALIM><alim_code> 13000 </alim_code><alim_nom_fr> Banane, pulpe, crue </alim_nom_fr><alim_nom_eng> Banana, pulp, raw </alim_nom_eng><alim_grp_code>02</alim_grp_code></ALIM></TABLE>",
      constituents:
        "<TABLE><CONST><const_code>328</const_code><const_nom_fr>Energie, Règlement UE N° 1169/2011 (kcal/100 g)</const_nom_fr></CONST><CONST><const_code>25000</const_code><const_nom_fr>Protéines, N x facteur de Jones (g/100 g)</const_nom_fr></CONST></TABLE>",
      compo:
        "<TABLE><COMPO><alim_code> 13000 </alim_code><const_code>328</const_code><teneur> 90,5 </teneur></COMPO><COMPO><alim_code>13000</alim_code><const_code>25000</const_code><teneur>1,06</teneur></COMPO></TABLE>",
      groups: "<TABLE><ALIM_GRP><alim_grp_code>02</alim_grp_code><alim_grp_nom_fr>fruits</alim_grp_nom_fr></ALIM_GRP></TABLE>",
    });
    expect(rows[0]).toMatchObject({ code: "13000", nameEn: "Banana, pulp, raw", group: "fruits" });
    expect(Object.keys(rows[0]!.values)).toHaveLength(2);
  });
});

describe("importadores CSV", () => {
  it("parser con comillas", () => {
    expect(parseCsv('a,b\n"x, y","z ""q"""\n')).toEqual([{ a: "x, y", b: 'z "q"' }]);
  });
  it("Cronometer", () => {
    const r = importDiaryCsv(
      "Day,Time,Group,Food Name,Amount,Energy (kcal),Protein (g),Carbs (g),Fat (g),Fiber (g),Iron (mg)\n2026-10-01,08:00,Breakfast,Oats,50 g,190,6.5,33,3.5,5,2.1\n",
    );
    expect(r.source).toBe("cronometer");
    expect(r.entries[0]).toMatchObject({ date: "2026-10-01", mealSlot: "breakfast", name: "Oats", grams: 50, quick: false });
    expect(r.entries[0]!.nutrients.iron).toBe(2.1);
  });
  it("MyFitnessPal resumen por comidas", () => {
    const r = importDiaryCsv("Date,Meal,Calories,Fat (g),Carbohydrates (g),Protein (g),Sodium (mg)\n2026-10-02,Lunch,650,20,70,40,900\n");
    expect(r.source).toBe("mfp");
    expect(r.entries[0]).toMatchObject({ mealSlot: "lunch", quick: true });
    expect(r.entries[0]!.nutrients.salt).toBeCloseTo(2.25);
  });
  it("Lose It ignora ejercicio", () => {
    const r = importDiaryCsv(
      "Date,Name,Type,Quantity,Units,Calories,Fat (g),Protein (g),Carbohydrates (g)\n10/03/2026,Apple,Snacks,1,Each,95,0.3,0.5,25\n10/03/2026,Running,Exercise,30,Minutes,-300,,,\n",
    );
    expect(r.source).toBe("loseit");
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.date).toBe("2026-10-03");
  });
});
