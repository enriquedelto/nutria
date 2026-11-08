#!/usr/bin/env bash
# Activa la IA en el servidor con tu suscripción de Claude (o una API key) y la comprueba.
#   1) En una terminal:  claude setup-token   → copia el token (sk-ant-oat01-…)
#   2) bash docker/set-ai-token.sh [host]      → pégalo cuando lo pida (no se ve al escribir)
# El token solo se guarda en ~/nutria/docker/.env del servidor (permisos 600); nunca en el repo.
set -euo pipefail
HOST="${1:-nuc}"
read -rsp "Pega el token de 'claude setup-token' (o una API key sk-ant-api…): " TOKEN; echo
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
case "$TOKEN" in
  sk-ant-oat*) KEY=CLAUDE_CODE_OAUTH_TOKEN; BACKEND=subscription ;;
  sk-ant-api*) KEY=ANTHROPIC_API_KEY; BACKEND=api ;;
  *) echo "Eso no parece un token de Claude (debe empezar por sk-ant-)." >&2; exit 1 ;;
esac
# The token travels on stdin, never on a command line.
printf '%s\n' "$TOKEN" | ssh "$HOST" "set -e; cd ~/nutria/docker; IFS= read -r T; umask 077
  awk -v k=$KEY -v b=$BACKEND -v t=\"\$T\" 'BEGIN{fk=0; fb=0}
    \$0 ~ \"^\" k \"=\" {print k \"=\" t; fk=1; next}
    /^AI_BACKEND=/ {print \"AI_BACKEND=\" b; fb=1; next}
    {print}
    END{if(!fk) print k \"=\" t; if(!fb) print \"AI_BACKEND=\" b}' .env > .env.tmp && mv .env.tmp .env
  docker compose up -d web worker >/dev/null 2>&1
  echo 'Token guardado; comprobando…'
  docker compose exec -T worker sh -c 'cd /app/apps/worker && node --import tsx src/ai-check.ts'"
