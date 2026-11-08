// Renders PNG icons from public/icons/icon.svg (run once; outputs are committed).
import sharp from "sharp";
import { readFile } from "node:fs/promises";
const svg = await readFile(new URL("../public/icons/icon.svg", import.meta.url));
const out = (n) => new URL(`../public/icons/${n}`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180], ["badge-72.png", 72]]) {
  await sharp(svg).resize(size, size).png().toFile(out(name));
}
// Maskable: icon on a full-bleed background with 10% safe padding.
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#1f6b58" } })
  .composite([{ input: await sharp(svg).resize(410, 410).png().toBuffer(), gravity: "center" }])
  .png()
  .toFile(out("maskable-512.png"));
console.log("iconos generados");
