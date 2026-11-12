<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Versiones fijadas a propósito

- La web y la raíz usan **TypeScript 5.9**: Next.js usa la API JS de TypeScript y typescript-eslint exige TS < 6.1. El worker y los paquetes (`core`, `db`, `nutrition`, `integrations`, `ai`) usan TS 7 (nativo); su código debe compilar con las dos versiones.
- **ESLint 9**: `eslint-plugin-react`, `eslint-plugin-import` y `eslint-plugin-jsx-a11y` (vía `eslint-config-next`) aún no admiten ESLint 10.
- `pnpm lint` en la raíz lanza el lint de worker y paquetes (`eslint.config.mjs` raíz, sin información de tipos) y el de la web.
