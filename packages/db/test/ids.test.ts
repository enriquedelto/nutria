import { describe, expect, it } from "vitest";
import { newId } from "../src/schema/_shared";

describe("ids (uuid v7)", () => {
  it("son UUID v7 válidos y ordenan por tiempo de creación", async () => {
    const a = newId();
    await new Promise((r) => setTimeout(r, 2));
    const b = newId();
    for (const id of [a, b]) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
    // The first 48 bits are the Unix time in ms.
    const ms = parseInt(a.replace(/-/g, "").slice(0, 12), 16);
    expect(Math.abs(ms - Date.now())).toBeLessThan(5_000);
  });
  it("no se repiten en ráfaga", () => {
    const ids = Array.from({ length: 5000 }, newId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });
});
