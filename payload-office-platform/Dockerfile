# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.6.1 --activate
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/
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
ENV NEXT_PUBLIC_AMAP_JS_KEY=1d41019b28b9dc0c7b91b9f7f0927b75
# OPT-064b：自托管 Umami 采集开关。这三个值必须在**构建期**存在——Next 把
# NEXT_PUBLIC_* 内联成字面量写进客户端 bundle，配在 CloudRun 的服务级环境变量里
# 对浏览器不可见（tcb cloudrun deploy 也没有 --env-vars）。改了要重新构建才生效。
# 判据的单一真源是 src/lib/frontend/analytics/umami-config.ts。
ENV NEXT_PUBLIC_ANALYTICS_ENABLED=true
ENV NEXT_PUBLIC_UMAMI_SRC=https://umami-286300-10-1253925058.sh.run.tcloudbase.com
ENV NEXT_PUBLIC_UMAMI_WEBSITE_ID=3a281820-ae20-43f9-b082-dc0224ed874f
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
ENV NEXT_PUBLIC_AMAP_JS_KEY=1d41019b28b9dc0c7b91b9f7f0927b75
# OPT-064b：运行期也要有，且必须与 builder 阶段逐字一致。
# next.config.ts 顶层 import 了 src/lib/security-headers，由它按 NEXT_PUBLIC_UMAMI_SRC
# 往 CSP 的 script-src 追加 Umami 的 origin。少了这一半，采集脚本会被 CSP 拦掉——
# 而 CSP 拦截除了控制台一行之外**没有任何症状**，页面照常渲染、埋点静默归零。
ENV NEXT_PUBLIC_ANALYTICS_ENABLED=true
ENV NEXT_PUBLIC_UMAMI_SRC=https://umami-286300-10-1253925058.sh.run.tcloudbase.com
ENV NEXT_PUBLIC_UMAMI_WEBSITE_ID=3a281820-ae20-43f9-b082-dc0224ed874f
ENV NEXT_TELEMETRY_DISABLED=1
# CloudRun 服务 Port=80，平台把流量发到 80；next start 读 PORT env 监听。
# 平台注入的 PORT 会覆盖此默认值，二者一致即可。
ENV PORT=80
ENV HOSTNAME=0.0.0.0
RUN corepack enable && corepack prepare pnpm@8.6.1 --activate

# OPT-069：水印合成靠 sharp/librsvg 把中文文案画进 SVG 再栅格化，
# node:22-slim 不带任何中文字体，缺字体时 librsvg 把文字渲染成方框/空白且不报错。
# 选 fonts-wqy-zenhei 而非 fonts-noto-cjk：水印只用到「商办荟」等寥寥数字，
# 用不上 Noto CJK 的全字库覆盖。镜像增量实测（依赖闭包减去基础镜像已有的包）：
#   fonts-wqy-zenhei        新增 9 个包，装后 23.0 MiB   ← 本行
#   fonts-noto-cjk          新增 1 个包，装后 88.9 MiB
#   fonts-noto-cjk+fontconfig                装后 95.9 MiB
# 那 23.0 MiB 里字体本体只占 16.0，其余 7 MiB 是 `Depends: fontconfig` 拉进来的链
# （fontconfig → fontconfig-config → fonts-dejavu-core 等）。这条链不是纯成本：
# 它顺带把 /etc/fonts/fonts.conf 与 fc-list 带进镜像，验收命令因此才跑得起来。
# 反过来 fonts-noto-cjk 没有任何 Depends——单装它会得到「有字体但没有 /etc/fonts、
# 且 fc-list not found」的费解现场。取证见 artifacts/verification/OPT-069/
# container-cjk-font-verification.md，复现用 scripts/verify-container-cjk-font.sh。
# 只装在 runner 阶段——水印在请求时烘焙（上传/重刷接口调用 sharp），
# builder 阶段的 next build 不连库、不会触发渲染。
# 谁以后为瘦身把这行删掉，唯一会拦住这个改动的是 tests/media-watermark-font-guard.test.ts；
# 没有它，typecheck/lint/build 全绿，线上水印会悄悄变回方框，且不报错。
# 换包也一样要走那条守卫：包名在 src/domain/media/watermark.ts 里有一份
# WATERMARK_FONT_PACKAGE，两边必须一致（守卫测试钉住），而那个常量进水印版本哈希——
# 换成 fonts-noto-cjk 字形全变，哈希不跟着变的话，存量图会被每一轮重刷判成
# 「已是当前版本」跳过，新旧字形永久共存。
RUN apt-get update && apt-get install -y --no-install-recommends fonts-wqy-zenhei \
  && rm -rf /var/lib/apt/lists/*

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
