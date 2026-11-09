import { describe, expect, it } from "vitest";
import { chainKey, nameSimilarity, normReceiptText, packGramsOf, receiptLinePrice } from "../src/receipts";

describe("tickets", () => {
  it("normaliza líneas y cadenas", () => {
    expect(normReceiptText("  LECHE SEMI. HDO 1L ")).toBe("leche semi hdo 1l");
    expect(normReceiptText("PLÁTANO")).toBe("platano");
    expect(chainKey("MERCADONA, S.A.")).toBe("mercadona");
    expect(chainKey("Lidl Supermercados S.A.U.")).toBe("lidl");
    expect(chainKey(null)).toBe("");
  });

  it("lee el tamaño del envase", () => {
    expect(packGramsOf("500 g")).toBe(500);
    expect(packGramsOf("1,5 kg")).toBe(1500);
    expect(packGramsOf("Pack 6 x 200 ml")).toBe(1200);
    expect(packGramsOf("75cl")).toBe(750);
    expect(packGramsOf("1 l")).toBe(1000);
    expect(packGramsOf("12 huevos")).toBeNull();
  });

  it("precio comparable de cada línea", () => {
    expect(receiptLinePrice({ quantity: 0.85, unit: "kg", unitPrice: 1.99, lineTotal: 1.69 })).toEqual({ price: 1.69, pricePerKg: 1.99, packGrams: 850 });
    expect(receiptLinePrice({ quantity: 2, unit: "ud", unitPrice: 1.2, lineTotal: 2.4 }, "500 g")).toEqual({ price: 1.2, pricePerKg: 2.4, packGrams: 500 });
    expect(receiptLinePrice({ quantity: 1, unit: "ud", lineTotal: 0.9 })).toEqual({ price: 0.9, pricePerKg: null, packGrams: null });
    expect(receiptLinePrice({ quantity: 1, unit: "ud", lineTotal: 0 })).toBeNull();
  });

  it("parecido de nombres con abreviaturas", () => {
    expect(nameSimilarity("Leche semi 1L", "Leche semidesnatada")).toBe(1);
    expect(nameSimilarity("Quinoa ecológica Nutria", "Quinoa ecológica Nutria")).toBe(1);
    expect(nameSimilarity("Plátano", "Yogur natural")).toBe(0);
  });
});
