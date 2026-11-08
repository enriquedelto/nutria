# syntax=docker/dockerfile:1.7
# One image for web, worker and migrations: the monorepo ships TypeScript sources
# (workspace packages are transpiled by Next and run with tsx in the worker).
FROM node:26-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY packages/ai/package.json packages/ai/
COPY packages/integrations/package.json packages/integrations/
COPY packages/nutrition/package.json packages/nutrition/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
RUN pnpm --filter @nutria/web build

FROM base AS runtime
# yt-dlp + ffmpeg: video recipes. pg_dump: snapshot before migrating. tini: signals.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg tini postgresql-client python3 \
  && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production UPLOAD_DIR=/data/uploads BACKUP_DIR=/data/backups AI_SANDBOX_DIR=/tmp/nutria-ai
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data/uploads /data/backups /tmp/nutria-ai && chown -R node:node /data /tmp/nutria-ai
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["pnpm", "--filter", "@nutria/web", "start", "--port", "3000", "--hostname", "0.0.0.0"]
