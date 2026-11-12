#!/usr/bin/env bash
# Prepara en el NUC la instancia E2E con el árbol de trabajo actual (también lo que no está en un commit),
# sin tocar producción: construye la imagen nutria-app:e2e en ~/nutria-e2e y levanta compose.e2e.yml
# con la BD limpia. Después, desde el PC:
#   ssh -N -L 8131:127.0.0.1:8131 -L 8132:127.0.0.1:8132 nuc &
#   pnpm --filter @nutria/web e2e
# Uso: docker/e2e.sh [host]   ·   E2E_AI=1 añade compose.e2e.ai.yml (IA real, gasta la suscripción).
#      docker/e2e.sh limpiar [host]  → al terminar: quita la instancia, la imagen nutria-app:e2e (3 GB),
#      ~/nutria-e2e y recorta la caché de build. Cada pasada ocupa ~7 GB y el NUC va justo de disco.
set -euo pipefail
if [ "${1:-}" = limpiar ]; then
  HOST="${2:-nuc}"
  ssh "$HOST" 'if [ -d ~/nutria-e2e/docker ]; then cd ~/nutria-e2e/docker && E2E_IMAGE=nutria-app:e2e docker compose -f compose.e2e.yml down -v; fi
    docker rmi nutria-app:e2e 2>/dev/null; rm -rf ~/nutria-e2e
    docker builder prune -f --max-used-space 3gb | tail -1; df -h ~ | tail -1'
  exit 0
fi
HOST="${1:-nuc}"
cd "$(git rev-parse --show-toplevel)"
free_gb="$(ssh "$HOST" 'df -BG --output=avail ~ | tail -1 | tr -dc 0-9')"
if [ "${free_gb:-0}" -lt 10 ]; then echo "Solo quedan ${free_gb} GB libres en $HOST: la pasada E2E ocupa ~7 GB. Libera espacio antes."; exit 1; fi
# Archivos versionados y nuevos que no están ignorados (lo mismo que verá el commit).
git ls-files -co --exclude-standard -z | tar --null -T - -cf - | ssh "$HOST" 'rm -rf ~/nutria-e2e && mkdir -p ~/nutria-e2e && tar -x -C ~/nutria-e2e'
ENV_FILE=""; AI_FILE=""
# The AI override goes after the base file (later files win; the base says AI_BACKEND=mock).
if [ "${E2E_AI:-}" = 1 ]; then ENV_FILE="--env-file ~/nutria/docker/.env"; AI_FILE="-f compose.e2e.ai.yml"; fi
ssh "$HOST" "set -e; cd ~/nutria-e2e
  nohup sh -c 'docker builder prune -f --max-used-space 6gb >/dev/null; docker build -q -f docker/Dockerfile -t nutria-app:e2e --build-arg APP_VERSION=e2e . && cd docker &&
    E2E_IMAGE=nutria-app:e2e docker compose $ENV_FILE -f compose.e2e.yml $AI_FILE down -v &&
    E2E_IMAGE=nutria-app:e2e docker compose $ENV_FILE -f compose.e2e.yml $AI_FILE up -d; echo FIN \$?' > ~/nutria-e2e/e2e.log 2>&1 &"
echo "Construyendo nutria-app:e2e en $HOST (tail -f ~/nutria-e2e/e2e.log)…"
ssh "$HOST" 'for i in $(seq 1 300); do grep -q "^FIN " ~/nutria-e2e/e2e.log 2>/dev/null && break; sleep 5; done
  grep -E "ERROR|error|^FIN " ~/nutria-e2e/e2e.log | tail -8
  for i in $(seq 1 60); do curl -fsS -o /dev/null http://127.0.0.1:8131/api/health && echo "E2E listo en :8131" && exit 0; sleep 2; done
  echo "La web E2E no responde"; exit 1'
