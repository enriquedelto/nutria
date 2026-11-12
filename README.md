# Nutria

Aplicación web autoalojada de dieta y nutrición con IA, pensada para una familia o un grupo de amigos. Se instala como PWA en el móvil y funciona sin conexión para lo básico.

- **Diario de comidas**: búsqueda en Open Food Facts, CIQUAL y el catálogo de Mercadona; foto del plato, voz (Whisper local) o texto libre; plantillas y «Como ayer».
- **Objetivos que se ajustan solos**: gasto energético adaptativo a partir del peso real, reparto de macros, proteína por comida y días de entreno.
- **Coach con IA**: conversación con acceso a tus datos, informe semanal con un cambio concreto para la semana siguiente.
- **Cocina y compra**: recetas (importables desde una URL), planificador de menús, despensa, lista de la compra, tickets leídos con IA e historial de precios. Opcionalmente comparte precios con [Open Prices](https://prices.openfoodfacts.org).
- **Salud** (opcional, por persona): sueño, ciclo, ayuno, síntomas, analíticas, medicación, suplementos y medidas corporales.
- **Entreno**: lectura del historial de una instancia de openGym, revisión semanal del volumen por músculo.
- **Familia**: varias personas por cuenta, invitaciones, retos.

> Nutria no es un producto sanitario ni sustituye el consejo de un profesional.

## Estructura

```
apps/web               Next.js 16 (PWA): interfaz, acciones de servidor y API
apps/worker            pg-boss: importaciones, resúmenes, avisos, sincronizaciones y copias
packages/nutrition     cálculos puros: objetivos, TDEE adaptativo, nutrientes, volumen, composición
packages/core          casos de uso: diario, objetivos, cocina, compra, informes, avisos
packages/ai            proveedores de IA (suscripción de Claude, API o simulado), prompts y cuotas
packages/integrations  Open Food Facts, CIQUAL, Mercadona, Open Prices, openGym, importación de recetas
packages/db            esquema Drizzle, migraciones y datos iniciales
docker/                imagen, compose, despliegue, copias y pruebas E2E
```

## Uso rápido

```bash
pnpm install
pnpm test        # vitest: nutrition, core, integrations, ai
pnpm typecheck
pnpm dev         # necesita DATABASE_URL (Postgres 16)
```

Despliegue con Docker, variables de entorno y opciones de IA: [`docker/README.md`](docker/README.md). Copia `docker/.env.example` a `docker/.env` y rellénalo; los secretos solo viven ahí.

## IA

La IA es intercambiable con `AI_BACKEND`:

- `subscription`: Claude Agent SDK con el token de una suscripción de Claude (`claude setup-token`).
- `api`: clave de la API de Anthropic, con cuota diaria y mensual por persona.
- `mock`: respuestas simuladas, para pruebas.

## Licencia

[MIT](LICENSE). Los datos de terceros (Open Food Facts, CIQUAL, Open Prices) tienen sus propias licencias.
