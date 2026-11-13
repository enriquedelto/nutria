import { describe, expect, it } from "vitest";
import { exifTakenAt } from "./exif";
import { defaultEntryTime, slotForTime } from "./slots";

/** Minimal JPEG: SOI + APP1 Exif with IFD0 → Exif IFD → DateTimeOriginal (+ optional IFD0 DateTime). */
function jpeg(opts: { original?: string; datetime?: string; bigEndian?: boolean }) {
  const le = !opts.bigEndian;
  const tiff: number[] = [];
  const u16 = (n: number) => (le ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
  const u32 = (n: number) => (le ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24] : [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
  const str = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);
  // Layout: header(8) | IFD0 | Exif IFD | strings
  const ifd0Entries = 1 + (opts.datetime ? 1 : 0);
  const ifd0 = 8;
  const ifd0Size = 2 + ifd0Entries * 12 + 4;
  const exifIfd = ifd0 + ifd0Size;
  const exifSize = 2 + (opts.original ? 1 : 0) * 12 + 4;
  let strings = exifIfd + exifSize;
  const tail: number[] = [];
  const asciiEntry = (tag: number, s: string) => {
    const bytes = str(s);
    const at = strings;
    strings += bytes.length;
    tail.push(...bytes);
    return [...u16(tag), ...u16(2), ...u32(bytes.length), ...u32(at)];
  };
  tiff.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(ifd0));
  tiff.push(...u16(ifd0Entries), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifIfd));
  if (opts.datetime) tiff.push(...asciiEntry(0x0132, opts.datetime));
  tiff.push(...u32(0));
  tiff.push(...u16(opts.original ? 1 : 0));
  if (opts.original) tiff.push(...asciiEntry(0x9003, opts.original));
  tiff.push(...u32(0), ...tail);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...app1, 0xff, 0xd9]).buffer;
}

describe("hora de la foto (EXIF)", () => {
  it("lee DateTimeOriginal en little y big endian", () => {
    expect(exifTakenAt(jpeg({ original: "2026:11:12 14:05:33" }))).toEqual({ date: "2026-11-12", time: "14:05" });
    expect(exifTakenAt(jpeg({ original: "2026:11:12 21:40:00", bigEndian: true }))).toEqual({ date: "2026-11-12", time: "21:40" });
  });
  it("sin DateTimeOriginal usa DateTime; sin EXIF o fecha vacía → null", () => {
    expect(exifTakenAt(jpeg({ datetime: "2026:10:01 08:15:00" }))).toEqual({ date: "2026-10-01", time: "08:15" });
    expect(exifTakenAt(jpeg({ original: "0000:00:00 00:00:00" }))).toBeNull();
    expect(exifTakenAt(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer)).toBeNull();
    expect(exifTakenAt(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBeNull();
  });
});

describe("comida y hora", () => {
  const slots = [
    { key: "breakfast", time: "08:00:00" },
    { key: "lunch", time: "14:30:00" },
    { key: "dinner", time: "21:30:00" },
    { key: "other", time: null },
  ];
  it("comida más cercana a una hora", () => {
    expect(slotForTime(slots, "07:10")).toBe("breakfast");
    expect(slotForTime(slots, "13:50")).toBe("lunch");
    expect(slotForTime(slots, "23:59")).toBe("dinner");
  });
  it("hora por defecto: ahora si es hoy; si no, la habitual de la comida", () => {
    expect(defaultEntryTime("2026-11-12", "2026-11-13", "14:30:00")).toBe("14:30");
    expect(defaultEntryTime("2026-11-12", "2026-11-13", null)).toBe("12:00");
    expect(defaultEntryTime("2026-11-13", "2026-11-13", "14:30:00")).toMatch(/^\d{2}:\d{2}$/);
  });
});
