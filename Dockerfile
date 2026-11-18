# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# OpenBBS production image
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    SITE_URL=http://localhost:3000 \
    DATABASE_PATH=/app/data/openbbs.db \
    TRUST_PROXY=0 \
    COOKIE_SECURE=auto

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /app/data \
  && chown -R node:node /app

USER node

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
