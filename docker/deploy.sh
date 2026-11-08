#!/usr/bin/env bash
# Despliega el commit actual en el NUC: copia el árbol (git archive), reconstruye y levanta.
# Uso: docker/deploy.sh [host]   (por defecto "nuc"). El .env vive solo en el NUC: ~/nutria/docker/.env
set -euo pipefail
HOST="${1:-nuc}"
VERSION="$(git rev-parse --short HEAD)"
git diff --quiet || echo "Aviso: hay cambios sin commit; se despliega HEAD ($VERSION)"
git archive --format=tar HEAD | ssh "$HOST" 'mkdir -p ~/nutria && tar -x -C ~/nutria'
ssh "$HOST" "cd ~/nutria/docker && test -f .env || { echo 'Falta ~/nutria/docker/.env (copia .env.example)'; exit 1; }
  mkdir -p data/uploads data/backups data/postgres data/whisper
  APP_VERSION=$VERSION docker compose up -d --build --remove-orphans
  docker compose ps"
