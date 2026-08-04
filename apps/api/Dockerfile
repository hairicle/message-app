# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package*.json tsconfig.base.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/api/package*.json ./apps/api/

RUN npm ci

# Copy source and build shared types then API
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=apps/api

# ── Stage 2: production ────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json tsconfig.base.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/api/package*.json ./apps/api/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/main"]
