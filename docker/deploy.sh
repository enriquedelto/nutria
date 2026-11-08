#!/usr/bin/env bash
# Despliega el commit actual en el NUC: copia el árbol (git archive), reconstruye y levanta.
# El build corre en el NUC con nohup (sobrevive a cortes de SSH); el log queda en ~/nutria/deploy.log.
# Uso: docker/deploy.sh [host]   (por defecto "nuc"). El .env vive solo en el NUC: ~/nutria/docker/.env
set -euo pipefail
HOST="${1:-nuc}"
VERSION="$(git rev-parse --short HEAD)"
git diff --quiet || echo "Aviso: hay cambios sin commit; se despliega HEAD ($VERSION)"
git archive --format=tar HEAD | ssh "$HOST" 'mkdir -p ~/nutria && tar -x -C ~/nutria'
ssh "$HOST" "set -e; cd ~/nutria/docker
  test -f .env || { echo 'Falta ~/nutria/docker/.env (copia .env.example)'; exit 1; }
  mkdir -p data/uploads data/backups data/postgres data/whisper
  nohup sh -c 'APP_VERSION=$VERSION docker compose up -d --build --remove-orphans; echo FIN \$?' > ~/nutria/deploy.log 2>&1 &
  echo 'Desplegando $VERSION en segundo plano (tail -f ~/nutria/deploy.log)'"
# Espera al final (hasta 25 min) y muestra el estado.
ssh "$HOST" 'for i in $(seq 1 300); do grep -q "^FIN " ~/nutria/deploy.log && break; sleep 5; done
  grep -E "ERROR|^FIN " ~/nutria/deploy.log | tail -5
  cd ~/nutria/docker && docker compose ps -a --format "{{.Service}}|{{.State}}|{{.Status}}"'
