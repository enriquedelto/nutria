// Bundles src/sw/sw.ts → public/sw.js (run before `next dev` / `next build`).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.env.GIT_SHA ?? new Date().toISOString();

await build({
  entryPoints: [join(root, "src/sw/sw.ts")],
  outfile: join(root, "public/sw.js"),
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: process.env.NODE_ENV === "production",
  define: { __SW_VERSION__: JSON.stringify(version), "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production") },
  logLevel: "warning",
});
console.log("sw.js listo", version);
