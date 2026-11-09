import { describe, expect, it } from "vitest";
import { FOOD_GROUPS, groupOf, NON_FOOD } from "../src/food-groups";

describe("groupOf", () => {
  it("usa las etiquetas de Open Food Facts de lo más concreto a lo general", () => {
    expect(groupOf({ name: "Queso curado", categories: ["en:dairies", "en:cheeses"] })).toBe("quesos");
    expect(groupOf({ name: "Chorizo", categories: ["en:meats", "en:prepared-meats", "en:sausages"] })).toBe("embutidos");
    expect(groupOf({ name: "Pechuga", categories: ["en:meats", "en:poultries"] })).toBe("carne");
    expect(groupOf({ name: "Zumo", categories: ["en:plant-based-foods-and-beverages", "en:beverages", "en:fruits-based-foods", "en:fruit-juices"] })).toBe("bebidas");
    expect(groupOf({ name: "Bebida de avena", categories: ["en:beverages", "en:plant-based-milk-alternatives"] })).toBe("vegetal_proteina");
    expect(groupOf({ name: "Almendras", categories: ["en:snacks", "en:salty-snacks", "en:nuts"] })).toBe("frutos_secos");
    expect(groupOf({ name: "Galletas", categories: ["en:snacks", "en:sweet-snacks", "en:biscuits"] })).toBe("dulces");
  });

  it("afina los grupos de CIQUAL por el nombre", () => {
    const ciq = (g: string, name: string) => groupOf({ name, categories: [`ciqual:${g}`] });
    expect(ciq("viandes, œufs, poissons et assimilés", "Œuf, cru")).toBe("huevos");
    expect(ciq("viandes, œufs, poissons et assimilés", "Saumon, cru")).toBe("pescado");
    expect(ciq("viandes, œufs, poissons et assimilés", "Jambon cuit")).toBe("embutidos");
    expect(ciq("viandes, œufs, poissons et assimilés", "Poulet, filet, cuit")).toBe("carne");
    expect(ciq("fruits, légumes, légumineuses et oléagineux", "Pomme de terre, bouillie")).toBe("patatas");
    expect(ciq("fruits, légumes, légumineuses et oléagineux", "Pomme, crue")).toBe("frutas");
    expect(ciq("fruits, légumes, légumineuses et oléagineux", "Lentille verte, cuite")).toBe("legumbres");
    expect(ciq("fruits, légumes, légumineuses et oléagineux", "Amande, grillée")).toBe("frutos_secos");
    expect(ciq("fruits, légumes, légumineuses et oléagineux", "Brocoli, cuit")).toBe("verduras");
    expect(ciq("produits céréaliers", "Riz blanc, cuit")).toBe("pasta_arroz");
    expect(ciq("produits laitiers et assimilés", "Emmental")).toBe("quesos");
    expect(ciq("eaux et autres boissons", "Bière blonde")).toBe("alcohol");
  });

  it("clasifica el catálogo de Mercadona y aparta lo que no es comida", () => {
    const st = (c: string) => groupOf({ name: "x", categories: [c] });
    expect(st("Charcutería y quesos › Queso curado")).toBe("quesos");
    expect(st("Charcutería y quesos › Jamón serrano")).toBe("embutidos");
    expect(st("Arroz, legumbres y pasta › Garbanzos")).toBe("legumbres");
    expect(st("Huevos, leche y mantequilla › Huevos")).toBe("huevos");
    expect(st("Huevos, leche y mantequilla › Bebidas vegetales")).toBe("vegetal_proteina");
    expect(st("Fruta y verdura › Plátano y uva")).toBe("frutas");
    expect(st("Congelados › Pescado rebozado")).toBe("pescado");
    expect(st("Bodega › Cerveza lata")).toBe("alcohol");
    expect(st("Bebé › Pañal talla de 0 a 3")).toBe(NON_FOOD);
    expect(st("Mascotas › Perro")).toBe(NON_FOOD);
  });

  it("recurre al nombre y respeta el tipo", () => {
    expect(groupOf({ name: "Whey protein vainilla" })).toBe("suplementos");
    expect(groupOf({ name: "Lentejas estofadas", nameEs: null })).toBe("legumbres");
    expect(groupOf({ name: "Creatina", kind: "supplement" })).toBe("suplementos");
    expect(groupOf({ name: "Cosa rara" })).toBeNull();
  });

  it("todos los grupos tienen clave única", () => {
    expect(new Set(FOOD_GROUPS.map((g) => g.key)).size).toBe(FOOD_GROUPS.length);
  });
});

describe("groupOf por nombre (sin categorías)", () => {
  it.each([
    ["Contramuslo deshuesado", "carne"],
    ["Burger meat extra", "carne"],
    ["Jamon de bellota", "embutidos"],
    ["Llonganissa extra de pagès", "embutidos"],
    ["Berberechos al natural", "pescado"],
    ["Mozarella", "quesos"],
    ["Iogurt natural", "lacteos"],
    ["Palmeritas", "dulces"],
    ["Gofio de millo", "cereales"],
    ["Aceitunas rellenas", "verduras"],
    ["Piña en almíbar", "frutas"],
    ["Cacao soluble", "bebidas"],
  ])("%s → %s", (name, group) => {
    expect(groupOf({ name })).toBe(group);
  });
  it("aceitunas y cacao por etiqueta", () => {
    expect(groupOf({ name: "x", categories: ["en:plant-based-foods", "en:pickles", "en:olives"] })).toBe("verduras");
    expect(groupOf({ name: "x", categories: ["en:cocoa-and-its-products", "en:cocoa-powders"] })).toBe("bebidas");
    expect(groupOf({ name: "x", categories: ["en:cocoa-and-its-products", "en:chocolates"] })).toBe("dulces");
  });
});
