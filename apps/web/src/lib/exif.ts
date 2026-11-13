/**
 * When a photo was taken, from its EXIF (JPEG APP1): DateTimeOriginal, else DateTime. Camera time is
 * local wall time, returned as-is ("YYYY-MM-DD", "HH:MM"). HEIC and stripped photos (WhatsApp…) → null.
 */
export function exifTakenAt(buf: ArrayBuffer): { date: string; time: string } | null {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 4 <= v.byteLength) {
    const marker = v.getUint16(off);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null; // not a marker / start of scan
    const len = v.getUint16(off + 2);
    if (marker === 0xffe1 && off + 10 <= v.byteLength && v.getUint32(off + 4) === 0x45786966 /* "Exif" */) return readTiff(v, off + 10);
    off += 2 + len;
  }
  return null;
}

const ASCII = 2;
const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME = 0x0132;
const TAG_DATETIME_ORIGINAL = 0x9003;

function readTiff(v: DataView, tiff: number) {
  if (tiff + 8 > v.byteLength) return null;
  const order = v.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const le = order === 0x4949;
  const u16 = (o: number) => v.getUint16(o, le);
  const u32 = (o: number) => v.getUint32(o, le);
  const entries = (ifd: number) => {
    const out = new Map<number, number>(); // tag → entry offset
    if (ifd + 2 > v.byteLength) return out;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > v.byteLength) break;
      out.set(u16(e), e);
    }
    return out;
  };
  const ascii = (e: number | undefined) => {
    if (e == null || u16(e + 2) !== ASCII) return null;
    const count = u32(e + 4);
    const start = count > 4 ? tiff + u32(e + 8) : e + 8;
    if (start + count > v.byteLength) return null;
    let s = "";
    for (let i = 0; i < count; i++) {
      const c = v.getUint8(start + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const ifd0 = entries(tiff + u32(tiff + 4));
  const exifPtr = ifd0.get(TAG_EXIF_IFD);
  const exif = exifPtr != null ? entries(tiff + u32(exifPtr + 8)) : new Map<number, number>();
  return parse(ascii(exif.get(TAG_DATETIME_ORIGINAL)) ?? ascii(ifd0.get(TAG_DATETIME)));
}

/** "2026:11:12 14:05:33" → { date: "2026-11-12", time: "14:05" }. */
function parse(s: string | null) {
  const m = s?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/);
  if (!m || m[1] === "0000") return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}

/** Taken-at of a picked file: EXIF, else its modification time (gallery picks), in local time. */
export async function photoTakenAt(file: Blob): Promise<{ date: string; time: string; source: "exif" | "file" } | null> {
  try {
    const exif = exifTakenAt(await file.slice(0, 256 * 1024).arrayBuffer());
    if (exif) return { ...exif, source: "exif" };
  } catch {
    // unreadable header: fall back to the file date
  }
  if (!(file instanceof File) || !file.lastModified) return null;
  const d = new Date(file.lastModified);
  const p = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}`, source: "file" };
}
