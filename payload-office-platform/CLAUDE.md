# 应用宪章（payload-office-platform/CLAUDE.md）

本文件每次会话自动加载，只放**非显而易见的常驻约束**。代码结构、git 历史不在此重复。

## 技术栈与包管理

- Next.js 16 + Payload 3.86 单体。富文本 Lexical。媒体走 `@payloadcms/storage-s3`（腾讯云 COS）。
- **包管理器是 pnpm**（`packageManager: pnpm@8.6.1`，用 `pnpm-lock.yaml`）。装依赖用 `pnpm`，不用 `npm`/`yarn`。

## 数据库（关键，别踩）

- **本地/CI/生产统一 PostgreSQL，`push: false`**：`src/payload.config.ts` 只留 postgres 单路径，`DATABASE_URL` 缺省或非 `postgres` 一律 fail-fast（onInit 抛错），已移除 SQLite 回退。本地也必须设 `DATABASE_URL=postgres://...`。
- **生产 Postgres 是共享 TencentDB，`push: false`**：Payload 默认的 dev pushSchema 扫全库会误删腾讯云拨测表、并在非 TTY 下卡死。**本地/CI/生产一律只走显式迁移**（`npx payload migrate`），禁用 dev push。改 collection 配置后必须 `npx payload migrate:create` 生成迁移并提交 `src/migrations/`，**迁移文件正文绝不可手改**。
- 多 worktree 并行各用独立 PG 库（如主树 `sbh_dev`、其它树 `sbh_dev_<task>`），别共用、别指向生产 TencentDB。

## 路由分组

- `src/app/(frontend)/` — C 端公开站（React Server Components，读 DB 的页面一律 `export const dynamic = 'force-dynamic'`，禁止构建期连库）。
- `src/app/(payload)/admin` — 后台。`src/app/(payload)/api` — Payload REST/GraphQL。
- 路径别名 `@/*` → `./src/*`；Local API：`import { getPayload } from 'payload'` + `import config from '@/payload.config'`。

## C 端读数据只走 Local API

C 端 Server Component 用 `getPayload()` + `payload.find()/findOne()`，**不要调 REST `/api/*`**。唯一新增的 HTTP 端点是 `/api/inquiries`（询价留电）。查询/筛选/格式化逻辑集中在 `src/lib/frontend/`（`queries.ts` / `filters.ts` / `format.ts` / `validation.ts`），纯函数有 Vitest 单测。

## C 端在建状态

分支 `feat/c-end-public-site`。计划 `docs/superpowers/plans/2026-07-24-c-end-public-site.md`（P0 基线 → P1 列表筛选 → P2 详情 → P3 询价 → P4 SEO → P5 E2E+部署）。P0 已完成（Leads 加 `source` 字段+迁移、seed 数据、`lib/frontend` 三件套+16 单测）。

## 设计系统

`(frontend)/styles.css` 是奶油+金色设计系统，CSS 变量：`--ink --muted --line --paper --cream --gold --deep --green`。C 端组件复用这些变量与现有 class，**不引新 UI 库**。

## 待验风险

`queries.ts` 用点分键 `'district.slug': { equals }` 过滤楼盘--本地/生产统一 PostgreSQL 后方言差异消除。若类生产环境仍出现异常，回退为两跳查询（先按 slug 查 location，再按 `district: { equals: locationId }` 查楼盘）。

## 测试

- 纯逻辑（`filters`/`format`/`validation`）用 Vitest，严格 TDD（先写失败测试→跑红→实现→跑绿→提交）。
- 页面/路由用 `pnpm build`（类型检查）+ `curl` 烟测。端到端用 Playwright（P5 装计划中已写）。
