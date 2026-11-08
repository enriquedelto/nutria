# Procedencia de las skills (descargadas y revisadas el 2026-11-08)

| Skill(s) | Origen | Tipo |
|---|---|---|
| next-dev-loop, next-cache-components-adoption, next-bundle-optimizer | vercel/next.js `canary/skills` | oficial |
| react-best-practices, composition-patterns, web-design-guidelines | vercel-labs/agent-skills | oficial (Vercel) |
| better-auth-* (best-practices, create-auth, emailAndPassword, organization, twoFactor, security) | better-auth/skills | oficial |
| shadcn | shadcn-ui/ui `skills/shadcn` | oficial |
| postgres-best-practices | supabase/agent-skills `supabase-postgres-best-practices` | oficial (Supabase, Postgres genérico) |
| frontend-design, webapp-testing, mcp-builder | anthropics/skills | oficial (Anthropic) |
| playwright-cli | microsoft/playwright-cli | oficial |
| drizzle-orm, tailwind, vitest-testing, zod-validation | oakoss/agent-skills | comunitaria (revisada) |

Cambios locales:
- `web-design-guidelines`: usa `guidelines.md` local en vez de descargar reglas en cada uso; nota sobre mayúsculas en español.
- `drizzle-orm`: quitadas las recomendaciones de instalar otras skills y la referencia de ElectricSQL.

Next.js 16.3+ genera además `AGENTS.md`/`CLAUDE.md` con la documentación empaquetada (`next/dist/docs/`) al ejecutar `next dev`.
Para el SDK de Claude (Agent SDK / API) se usa la skill integrada `claude-api`.
Actualizar: volver a descargar de los repos de origen y revisar el diff antes de sustituir.
