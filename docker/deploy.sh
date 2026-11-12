#!/usr/bin/env bash
# Despliega el commit actual en el NUC: copia el árbol (git archive), reconstruye y levanta.
# El build corre en el NUC con nohup (sobrevive a cortes de SSH); el log queda en ~/nutria/deploy.log.
# Uso: docker/deploy.sh [host]   (por defecto "nuc"). El .env vive solo en el NUC: ~/nutria/docker/.env
set -euo pipefail
HOST="${1:-nuc}"
VERSION="$(git rev-parse --short HEAD)"
git diff --quiet || echo "Aviso: hay cambios sin commit; se despliega HEAD ($VERSION)"
# El 2026-11-11 el disco del NUC se llenó y Postgres cayó: no construir con menos de 10 GB libres (un build ocupa 3–5 GB).
MIN_FREE_GB="${MIN_FREE_GB:-10}"
free_gb="$(ssh "$HOST" 'df -BG --output=avail ~ | tail -1 | tr -dc 0-9')"
if [ "${free_gb:-0}" -lt "$MIN_FREE_GB" ]; then
  echo "Solo quedan ${free_gb} GB libres en $HOST (mínimo $MIN_FREE_GB). Revisa 'docker system df' y libera espacio."
  exit 1
fi
git archive --format=tar HEAD | ssh "$HOST" 'mkdir -p ~/nutria && tar -x -C ~/nutria'
# tar no borra: quita en el NUC los archivos versionados que estaban en el despliegue anterior y ya no
# están en HEAD (lista en ~/nutria/.deployed-files). Solo toca rutas de esa lista; nunca .env ni data/.
git ls-files | ssh "$HOST" 'cd ~/nutria && cat > .deployed-files.new
  if [ -f .deployed-files ]; then
    sort .deployed-files > .df-old; sort .deployed-files.new > .df-new
    comm -23 .df-old .df-new | while IFS= read -r f; do
      case "$f" in ""|/*|*..*|docker/.env|docker/data/*) continue ;; esac
      [ -f "$f" ] && rm -f -- "$f" && echo "borrado: $f"
    done
    rm -f .df-old .df-new
  fi
  mv .deployed-files.new .deployed-files'
ssh "$HOST" "set -e; cd ~/nutria/docker
  test -f .env || { echo 'Falta ~/nutria/docker/.env (copia .env.example)'; exit 1; }
  mkdir -p data/uploads data/backups data/postgres data/whisper
  # Tras construir: quita las imágenes de Nutria que quedan sin etiqueta y limita la caché de build.
  nohup sh -c 'APP_VERSION=$VERSION docker compose up -d --build --remove-orphans; rc=\$?
    docker image prune -f --filter label=com.docker.compose.project=nutria
    docker builder prune -f --max-used-space 3gb
    echo FIN \$rc' > ~/nutria/deploy.log 2>&1 &
  echo 'Desplegando $VERSION en segundo plano (tail -f ~/nutria/deploy.log)'"
# Espera al final (hasta 25 min) y muestra el estado.
ssh "$HOST" 'for i in $(seq 1 300); do grep -q "^FIN " ~/nutria/deploy.log && break; sleep 5; done
  grep -E "ERROR|^FIN " ~/nutria/deploy.log | tail -5
  cd ~/nutria/docker && docker compose ps -a --format "{{.Service}}|{{.State}}|{{.Status}}"
  df -h ~ | tail -1'
