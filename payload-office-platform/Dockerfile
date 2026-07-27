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
# 先生成 payload-types.ts：该文件被 gitignore，不进仓库也不进镜像上下文，
# 缺失时 payload.find().docs 退化为泛型 JsonObject & TypeWithID（无 slug/name），
# next build 的 tsc 检查在 (frontend)/listings/page.tsx 处报 TS2322 而失败。
# generate:types 只读 payload.config、不连库，故在此无 DB 的构建阶段安全。
# generate:importmap 重生成后台 client 组件映射：漏项会让整个 /admin SPA
# 在 hydration 阶段崩溃白屏（含 login 页）。构建期强制重生成，避免有人改
# config（加富文本/存储等 client 组件）后忘了本地生成导致线上后台白屏。
# 构建期不连库：首页 force-dynamic，避免无 DB 时构建失败
# NEXT_PUBLIC_SITE_URL：构建期 /sitemap.xml 与 /robots.txt page data 收集会触发
# site-config fail-closed（生产缺此值抛错），必须在此注入（Next.js 内联 NEXT_PUBLIC_*）。
ENV NEXT_PUBLIC_SITE_URL=https://sbh-286300-10-1253925058.sh.run.tcloudbase.com
# Git 不跟踪空目录；没有静态资源时也要保留 public，供 runner 阶段稳定复制。
RUN mkdir -p public
RUN pnpm generate:types && pnpm payload generate:importmap && pnpm build

# ---------- runner ----------
# 完整镜像（非 standalone）：standalone 产物不含 src/migrations/tsx/payload CLI，
# 无法在容器内建表。完整镜像保留迁移能力，容器启动时自跑迁移（幂等）。
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# NEXT_PUBLIC_SITE_URL：运行时 config-guard（OPT-015 fail-closed）校验 https + 非 localhost。
# 烤进镜像，避免依赖 CloudRun 控制台单独配置（tcb deploy 不传 env-vars）。
ENV NEXT_PUBLIC_SITE_URL=https://sbh-286300-10-1253925058.sh.run.tcloudbase.com
ENV NEXT_TELEMETRY_DISABLED=1
# CloudRun 服务 Port=80，平台把流量发到 80；next start 读 PORT env 监听。
# 平台注入的 PORT 会覆盖此默认值，二者一致即可。
ENV PORT=80
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
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

EXPOSE 80
# 容器启动：先跑迁移（advisory lock 互斥 + 幂等）再启动 Next server。
# 多实例并发拉起时，PG advisory lock 保证只有一个实例真正跑迁移，
# 其余实例等待锁释放后跑幂等 skip；避免并发迁移踩 schema 冲突。
# 不用 disableOnInit：migrate-locked 内部 payload.init 会触发 onInit -> config-guard（OPT-015 fail-closed）。
#
# `&&` 依赖迁移脚本**确定性退出**：Payload adapter 会永久占用一个 PostgreSQL client，
# pool.end() 因此永不返回，脚本必须自己 process.exit(0)（见 src/lib/runtime/migrate-lock.ts），
# 否则 Shell 卡在这一步、Next.js 永不启动、80 端口无人监听（sbh-011 / sbh-012 的失败原因）。
# exec：让 next server 取代 shell 成为 PID 1，CloudRun 的 SIGTERM 才能直达进程做优雅退出。
CMD ["sh", "-c", "pnpm exec tsx scripts/migrate-locked.ts && exec pnpm start"]
