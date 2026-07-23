# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.6.1 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------- builder ----------
FROM node:22-slim AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.6.1 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 构建期不连库，避免无 DB 时构建失败
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---------- runner ----------
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# CloudRun 注入 PORT；standalone server.js 读取 PORT/HOSTNAME
ENV PORT=3717
ENV HOSTNAME=0.0.0.0

# Next standalone 产物：server.js + 精简 node_modules
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3717
CMD ["node", "server.js"]
