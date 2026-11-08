# Despliegue de Nutria en el NUC

Una sola imagen (`nutria-app`) para `migrate`, `web` y `worker`. Además corren `postgres` 16, `whisper` (faster-whisper) y `backup` (copia diaria).

## Primer despliegue

1. En el NUC, crea `~/nutria/docker/.env` a partir de `.env.example`, con permisos 600. Los secretos solo viven ahí.
2. Desde el PC, en la raíz del repo, ejecuta `docker/deploy.sh`. El script copia `HEAD` con `git archive`, construye en el NUC con `nohup` y deja el log en `~/nutria/deploy.log`.
3. La web queda en `http://127.0.0.1:8130`, solo dentro del NUC. Para entrar desde la tailnet: `sudo tailscale serve --bg --https=8459 http://127.0.0.1:8130`.
4. **Protege el primer registro.** La primera cuenta se vuelve administradora y el resto del registro es solo por invitación. Con `ADMIN_EMAIL` en el `.env`, solo ese correo puede crear esa primera cuenta. Si no la pones, regístrate antes de publicar.
5. Publícala por Caddy. Añade a `/etc/caddy/Caddyfile`:

```caddy
dieta.tu-dominio.example {
	import accesslog
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Robots-Tag "noindex, nofollow, noarchive"
		-Server
	}
	request_body {
		max_size 40MB
	}
	handle {
		reverse_proxy localhost:8130
	}
}
```

Luego ejecuta `sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy`.

`BETTER_AUTH_URL` debe ser exactamente `https://dieta.tu-dominio.example`, porque las passkeys quedan atadas a ese dominio.

## IA

| `AI_BACKEND` | Qué necesita |
|---|---|
| `subscription` | `CLAUDE_CODE_OAUTH_TOKEN`, que se obtiene con `claude setup-token` en cualquier equipo con Claude Code. Comparte los límites de tu suscripción. |
| `api` | `ANTHROPIC_API_KEY`. Hay cuota por persona (`AI_DAILY_LIMIT`, `AI_MONTHLY_USD`). |
| `mock` | Nada. Respuestas simuladas para pruebas. |

Después de cambiar el `.env`, aplica los cambios con `cd ~/nutria/docker && docker compose up -d web worker`.

## Operación

| Tarea | Comando (en `~/nutria/docker`) |
|---|---|
| Estado | `docker compose ps` |
| Logs | `docker compose logs -f web worker` |
| Actualizar | `docker/deploy.sh` desde el PC |
| Copia manual | `docker compose exec backup pg_dump -h postgres -U nutria -d nutria -Fc -f /backups/manual.dump` |
| Restaurar | `docker compose stop web worker && docker compose exec -T postgres pg_restore -U nutria -d nutria --clean --if-exists < data/backups/<fichero>.dump && docker compose start web worker` |
| Cargar Open Food Facts | Administración → «Actualizar OFF». La primera vez descarga el dump y tarda bastante. |

- **Copias:** la diaria se guarda en `data/backups/nutria-AAAA-MM-DD.dump` y se conservan 14 días. Antes de cada migración se hace además un snapshot `premigrate-*.dump`, que se conserva 30 días.
- **Ficheros:** las fotos y los ficheros importados están en `data/uploads`. Las fotos de progreso se guardan cifradas con `APP_ENCRYPTION_KEY`.

## E2E

Las pruebas E2E usan una instancia desechable con IA simulada y la base de datos en tmpfs, que no toca la de producción.

1. En el NUC, levántala con `cd ~/nutria/docker && docker compose -f compose.e2e.yml up -d`.
2. En el PC, abre el túnel con `ssh -N -L 8131:127.0.0.1:8131 nuc`.
3. En el PC, lanza las pruebas con `pnpm --filter @nutria/web e2e`.
4. Al acabar, bórrala con `docker compose -f compose.e2e.yml down -v`.
