# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY package*.json tsconfig.base.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/web/package*.json ./apps/web/

RUN npm ci

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=apps/web

# ── Stage 2: production ────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json tsconfig.base.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/web/package*.json ./apps/web/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public

WORKDIR /app/apps/web
EXPOSE 3000
CMD ["npm", "run", "start"]
