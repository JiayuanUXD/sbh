# 应用宪章（payload-office-platform/CLAUDE.md）

本文件每次会话自动加载，只放**非显而易见的常驻约束**。代码结构、git 历史不在此重复。

## 技术栈与包管理

- Next.js 16 + Payload 3.86 单体。富文本 Lexical。媒体走 `@payloadcms/storage-s3`（腾讯云 COS）。后台部分 UI 用 `@arco-design/web-react`（带 pnpm patch）。
- **包管理器是 pnpm**（`packageManager: pnpm@8.6.1`，用 `pnpm-lock.yaml`）。装依赖用 `pnpm`，不用 `npm`/`yarn`。

## 按任务读取的领域规则

`.agent/` 下的规则**不会自动加载**，按任务显式读取（路由表见仓库根 `CLAUDE.md`）：`core.md`（每个任务）/ `backend.md` / `frontend.md` / `supply.md` / `permissions.md` / `migrations.md` / `testing.md`。工作项在 `../specs/work-items/`，验证证据存 `../artifacts/verification/<编号>/`。

## 命令与预检顺序

本地按**与 `quality.yml` 同一顺序**自检，别攒到 PR 才炸：

```bash
pnpm generate:types && pnpm payload generate:importmap
pnpm typecheck
pnpm test              # vitest run
pnpm migrate:dry-run   # 迁移源码静态校验，不连库
pnpm build
```

- 首次克隆：`pnpm setup:hooks` 启用 `.githooks/`（提交/推送闸门，说明见仓库根 `CLAUDE.md`）。
- 开发：`pnpm dev`（固定 3717，多 worktree 必须换 `PORT`）。
- E2E：`pnpm test:e2e`（Playwright；`E2E_PROD_SERVER=1` 走 `next start` 生产 server，避开 dev JIT 超时）。
- 迁移：`pnpm exec payload migrate` / `migrate:status` / `migrate:verify`；上线前 `pnpm preflight`（环境变量 + 迁移完整性 + 风险扫描）。
- 种子：`pnpm seed`；`pnpm seed:media`（**gallery < 3 张图会被有效供给精筛全部排除 → 前台 0 套房源**，别只跑 `seed`）。

`next start`（NODE_ENV=production）首个请求会触发 `src/lib/runtime/config-guard.ts` 的 fail-closed 校验：缺 PG 连接串 / 弱或短于 32 位 `PAYLOAD_SECRET` / 非 https 或 localhost 的 `NEXT_PUBLIC_SITE_URL`，任一不满足直接拒绝启动。

## 生成物纪律（最贵的坑，动 payload.config 前先读）

- **`src/payload-types.ts` 是生成物，但在 `master` 上仍被 git 跟踪**（`.gitignore:7` 列了它，对已跟踪文件无效；而 `quality.yml` / `Dockerfile` 的注释假设它不在仓库里）。开工前用 `git ls-files src/payload-types.ts` 确认当前分支真实状态，别凭记忆假设已忽略。
- **本地 `.env.local` 缺 COS 配置时，重生成会静默删掉 `Media.prefix` 两行**（该字段只在 storage-s3 启用时存在，见迁移 `20260805_033418_cos_media_prefix`）；跑 `migrate:status` / `migrate:dry-run` 等加载 payload.config 的 tsx 脚本也会触发。规避：`.env.local` 里给**语法合法的占位 COS_\***（`COS_BUCKET` 形如 `local-dev-1250000000`、`COS_REGION` 为 `ap-*`、`COS_ENDPOINT` 为 `https://cos.<region>.myqcloud.com`，五个变量要么全给要么全不给）。提交前 `grep -c "prefix" src/payload-types.ts` **必须是 2**。
- **`src/app/(payload)/admin/importMap.js` 是提交进仓库的源文件，不是构建产物**。payload.config 新增任何 client 组件（富文本 feature、存储适配器、自定义字段 UI）后没重生成，**整个 `/admin` SPA 会在 hydration 阶段白屏（含 login 页）**，而 HTML 与所有 JS/CSS 都返回 200。诊断口诀：白屏 + 资源全 200 = client hydration 失败，不是 404。修复：`pnpm payload generate:importmap`。

## 并行开发纪律（多 worktree / 多 IDE，别踩）

本仓库常多任务并行，以下几条是硬约束，专治"幽灵 bug、分支漂移、重复劳动"：

- **一任务一 worktree，运行时资源必须隔离**：每个 worktree 用**独立 dev 端口**（`PORT` 区分，别都抢 3717）和**独立 PG 库**。并行任务之间**不共享任何有状态资源**（端口 / DB / 缓存）——否则 API 会静默打到别的服务上（真实教训：主树 3717 与 worktree 3718 混用，E2E 一度假失败，误判"安全修复没生效"）。
- **每个 worktree 独立 `.env.local`**：端口、DB 各自配；别在多个树间复制同一份、别指向共享的 `sbh_dev`。
- **永远从最新 master 开分支**：`pnpm branch:new <类型> <短描述>`（自动 fetch + 基于 `origin/master` + 生成合规分支名，规范见仓库根 `CLAUDE.md`）。别基于旧基线（真实教训：`opt`/`codex` 基于旧提交，与 master 分叉后合并才发现惊喜）。
- **每天至少推一次 WIP**：`git push -u origin <branch>`，哪怕没做完。防"本地黑洞"、让在建工作可见（真实教训：大量本地未推送提交，且重写了别的分支早已完成的部署修复）。
- **开工前先查在建**：`git branch -a` + `gh pr list`，确认没人在做同一件事，避免重复劳动。
- **短命分支 + 勤 rebase**：分支活 1–3 天，常 `git rebase origin/master`，把大冲突拆成每天的小冲突。
- **早开 draft PR**：让 `quality.yml` 尽早在小改动上跑，别攒到最后一起爆（CI 坑常只在 PR 才触发）。
- **真正"在写"的任务 ≤ 2 件**；有依赖关系的任务串行做，别并行。

## 数据库（关键，别踩）

- **本地/CI/生产统一 PostgreSQL，`push: false`**：`src/payload.config.ts` 只留 postgres 单路径，`DATABASE_URL` 缺省或非 `postgres` 一律 fail-fast（onInit 抛错），**SQLite 回退已移除**。本地也必须设 `DATABASE_URL=postgres://...`。
- **生产 Postgres 是共享 TencentDB，`push: false`**：Payload 默认的 dev pushSchema 扫全库会误删腾讯云拨测表、并在非 TTY 下卡死。**本地/CI/生产一律只走显式迁移**（`npx payload migrate`），禁用 dev push。改 collection 配置后必须 `npx payload migrate:create` 生成迁移并提交 `src/migrations/`，**迁移文件正文绝不可手改**。
- PG 的 ENUM 校验比 SQLite 严：字段 `defaultValue` 必须在 `options` 里，否则插入被拒（真实教训：`Listings.listingType` 默认值不在选项内）。
- 多 worktree 并行各用独立 PG 库（如主树 `sbh_dev`、其它树 `sbh_dev_<task>`），别共用、别指向生产 TencentDB。

## 路由分组

- `src/app/(frontend)/` — C 端公开站（React Server Components，读 DB 的页面一律 `export const dynamic = 'force-dynamic'`，禁止构建期连库）。
- `src/app/(payload)/admin` — 后台。`src/app/(payload)/api` — Payload REST/GraphQL。
- 路径别名 `@/*` → `./src/*`；Local API：`import { getPayload } from 'payload'` + `import config from '@/payload.config'`。

## C 端读数据只走 Local API

C 端 Server Component 用 `getPayload()` + `payload.find()/findOne()`，**不要调 REST `/api/*`**。唯一新增的 HTTP 端点是 `/api/inquiries`（询价留电）。查询/筛选/格式化逻辑集中在 `src/lib/frontend/`（`queries.ts` / `filters.ts` / `format.ts` / `validation.ts`），纯函数有 Vitest 单测。

## 设计系统

`(frontend)/styles.css` 是奶油+金色设计系统，CSS 变量：`--ink --muted --line --paper --cream --gold --deep --green`。C 端组件复用这些变量与现有 class，**不引新 UI 库**（后台的 Arco 不外溢到 C 端）。

## 测试与验收铁律（血泪教训，必须严格执行）

- **纯逻辑严格 TDD**（`filters`/`format`/`validation`）：Vitest 先红后绿。
- **UI 与深色模式：严禁全局盲视**：必须在 Playwright 中截取全屏像素图；严禁仅看“大背景是否变黑”，必须逐个对账微观控件（Select/Radio/Tab/Popup/Modal），严禁在 Dark Mode 下残留 `#FFFFFF` 白底；必须主动点击展开下拉浮层并截取展开态。
- **表单保存与持久化：三步铁证**：
  1. 抓包核验：拦截并打印实际发出的 `POST/PATCH` 请求体（Request Payload），确保行级数据完整序列化；
  2. 响应核验：确认 HTTP `200/201` 且响应文档结构正确；
  3. 强刷重载核验：执行 `page.reload` / `page.goto` 重新进入目标区域，核验 DOM 回显与数量 100% 保持，杜绝删图残留或调序瞬态复原。
- **复杂拖拽交互**：外层 `draggable` 容器必须隔离子控件事件（`stopPropagation`）。
- **自定义 array 字段组件**：本地 state 只作展示投影，增删改序一律走 Payload 行级 action（`addFieldRow` / `removeFieldRow` / `moveFieldRow` / 针对 `<path>.<行号>.<子字段>` 的 `UPDATE`）。**严禁用 `setValue` 往 array 父路径写整个数组**——有行的 array 会被标记 `disableFormData`，该路径提交时整体跳过，内容不会落库。
- 完成判据与详细浏览器验收清单见 `.agent/testing.md`。无真实证据严禁宣布完成。
