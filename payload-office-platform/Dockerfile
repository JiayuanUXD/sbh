# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.6.1 --activate
COPY package.json pnpm-lock.yaml ./
# 含 devDeps（tsx）：payload CLI 需要 tsx 加载 ts 配置才能在容器内跑迁移
RUN pnpm install --frozen-lockfile

# ---------- builder ----------
FROM node:22-slim AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.6.1 --activate
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 构建期不连库：首页 force-dynamic，避免无 DB 时构建失败
RUN pnpm build

# ---------- runner ----------
# 完整镜像（非 standalone）：standalone 产物不含 src/migrations/tsx/payload CLI，
# 无法在容器内建表。完整镜像保留迁移能力，容器启动时自跑迁移（幂等）。
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# CloudRun 注入 PORT；next start 读取 PORT
ENV PORT=3717
ENV HOSTNAME=0.0.0.0
RUN corepack enable && corepack prepare pnpm@8.6.1 --activate

# 完整 node_modules（含 tsx，供 payload CLI 加载 ts 配置跑迁移）
COPY --from=deps /app/node_modules ./node_modules
# 构建产物
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
# 源码：payload.config、collections、migrations（迁移运行时按文件读）
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/tsconfig.json ./tsconfig.json

EXPOSE 3717
# 容器启动：先跑迁移（幂等，已执行的自动跳过）再启动 Next server
CMD ["sh", "-c", "pnpm exec payload migrate && pnpm start"]
