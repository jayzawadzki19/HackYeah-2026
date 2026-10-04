# Headroom: NestJS api, the Angular app, and the Garmin connector.
# Open-wearables stays in its own images. Start both with:
#   docker compose up --build

FROM oven/bun:1.3.14 AS web
# Angular CLI rejects the Node version bundled in this Bun image. The CLI itself runs on Node 26.
COPY --from=node:26-bookworm-slim /usr/local/bin/node /usr/local/bin/node
RUN apt-get update \
  && apt-get install -y --no-install-recommends libatomic1 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /src/app/web
COPY app/contracts /src/app/contracts
COPY app/web/package.json app/web/bun.lock ./
RUN bun install --frozen-lockfile
COPY app/web ./
RUN node node_modules/@angular/cli/bin/ng.js build

FROM oven/bun:1.3.14 AS api
WORKDIR /src/app/api
COPY app/api/package.json app/api/bun.lock ./
RUN bun install --frozen-lockfile
COPY app/api ./
COPY app/contracts /src/app/contracts

FROM oven/bun:1.3.14
RUN apt-get update \
  && apt-get install -y --no-install-recommends nginx ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app
COPY --from=api /src/app/api /app/api
COPY --from=api /src/app/contracts /app/contracts
COPY --from=web /src/app/web/dist/web/browser /usr/share/nginx/html
COPY app/connector /app/connector
RUN uv sync --project /app/connector --locked --no-dev

COPY infra/nginx.conf /etc/headroom/nginx.conf
COPY infra/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 4200 3001
ENTRYPOINT ["/entrypoint.sh"]
