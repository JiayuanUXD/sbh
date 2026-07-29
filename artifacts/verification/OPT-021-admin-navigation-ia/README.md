# OPT-021 后台导航信息架构 — 验证证据

> 分支：`codex/opt-021-admin-navigation`
> 记录日期：2026-07-29
> 范围：**自动化验证已完成**；五角色浏览器截图证据待补（见文末「待补」）。

## 0. 环境说明（复核者必读）

- 本验证在 git worktree `.worktrees/opt-021-admin-navigation` 内执行，node `v24.14.0`（`package.json` 期望 22.x，仅告警不影响结果）、pnpm `8.6.1`。
- worktree 首次的 `node_modules` 为 **x64** 原生二进制（`sharp` / `esbuild` 报 `darwin-x64 runtime`），当前 node 为 **arm64**，导致 Payload CLI 与 `tsx` 迁移脚本无法加载。**已通过 `pnpm install` 重新安装 arm64 原生依赖修复**（未改动 `pnpm-lock.yaml`）。这是 worktree 环境问题，与 OPT-021 代码无关。
- worktree 缺 `.env.local`（gitignored），已从主工作树复制。`DATABASE_URL` 指向本地 Postgres `sbh_dev`（`pg_isready` 通过）。
- 生产构建需要 `NEXT_PUBLIC_SITE_URL`（前端 `site-config` 要求，来自前端提交 543c6b4，非 OPT-021）。构建时以 `NEXT_PUBLIC_SITE_URL=https://sbh-286300-10-1253925058.sh.run.tcloudbase.com` 提供。

## 1. 生成与静态检查

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm exec payload generate:types` | 0 | 无 diff（类型已最新） |
| `pnpm exec payload generate:importmap` | 0 | 无 diff（import map 含 `AdminNavigation`） |
| `pnpm exec tsc --noEmit --pretty false` | 0 | 无类型错误 |
| `pnpm lint` | 0 | 8 条 `@next/next/no-img-element` warning（均为前端既有 `<img>`，非 OPT-021），0 error |

### lint 修复记录（本次改动）
首轮 `pnpm lint` 退出码 1，1 个 error：
`src/components/admin/AdminNavigation.tsx:46 — Avoid constructing JSX within try/catch (react-hooks/error-boundaries)`。
修复：把 `resolveAdminNavigation` 的解析保留在 `try/catch` 内（失败仍记录日志并回退 `null`，不阻塞页面），`<AdminNavigationClient>` JSX 构造移出 `try` 块。复跑 `tsc`(0) 与 `lint`(0) 均通过。

## 2. 自动化测试

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm test`（vitest run） | 0 | **120 个测试文件，2125 个测试全部通过**，用时约 10.4s |
| `pnpm exec vitest run tests/lead-read-access.test.ts` | 0 | 3 passed（安全缺口专项，见 §4） |

## 3. 生产构建

| 命令 | 退出码 | 结果 |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL=… pnpm build` | 0 | `✓ Compiled successfully`；TypeScript 通过；静态页 5/5 生成；`/admin/[[...segments]]` 等全部路由在产物中；0 error |

> 说明：未设 `NEXT_PUBLIC_SITE_URL` 时构建在 `/robots.txt`、`/dev-story` 因前端 `site-config` 缺失该变量而失败，与 OPT-021 无关。

## 4. 安全缺口验证：BRK 只能读自有线索（E2E 发现项）

**缺口**：BRK 经纪人调用 `GET /api/leads` 可读取「负责人为空」或「不属于自己」的线索——Leads 缺服务端 read 数据范围。

**修复**（已在提交 541b290 落地，master 上不存在此文件）：
- `src/domain/crm/lead-read-access.ts` 的 `buildLeadReadScope`：`dataScope === 'self'` 时返回 `{ 'owner.user': { equals: userId } }`，再叠加账号 `cityScope` 城市上限；`dataScope === 'none'` 返回 `false`；其余保持全局。
- 挂到 `Leads.access.read = leadReadAccess`。
- 链路：`Lead.owner`(→brokers) → `broker.user`(→users, required) `=== 当前 userId`。**负责人为空**（owner.user 无值）与**他人线索**（userId 不等）均被 `where` 排除。城市范围取自 `req.user`，不取 URL 参数。
- BRK 内置角色 `dataScope: 'self'`（`src/test/factory/roles.ts`），`permission-context.ts` 读取 `role.dataScope`。

**证据**：
- 单测 `tests/lead-read-access.test.ts`：3 passed（self 仅匹配 `owner.user`、叠加城市上限、未登录拒绝、global 保持全局）。
- E2E 回归 `tests/e2e/permission-matrix.spec.ts`：`BRK 查看 leads → 逐条证明归属本人`、`BRK 传 city=999 不扩大数据范围`（需运行中的 seeded 环境，随浏览器验收一并执行）。

## 5. 迁移检查

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm migrate:dry-run` | 0 | 两个 OPT-021 迁移 `up: true, down: true, no forbidden patterns`；2 条 warning 为既有 `locations` 枚举 `ALTER COLUMN`，非 OPT-021 |
| `pnpm migrate:verify` | 0 | **100 checks, 0 fail, 11 warn**；`payload_migrations` 等关键表存在、行数正常 |

OPT-021 迁移（均已在 `src/migrations/index.ts` 注册）：
- `20260728_180000_opt_021_admin_navigation_roles`
- `20260728_181000_opt_021_form_submission_status`

## 6. 待补（本轮范围外，用户已选「先跑自动化验证」）

以下为 Task 11 剩余的**浏览器证据**，需启动 dev server + seed 数据库后采集：
- 五角色（ADM/OPS/MGR/BRK/CSR）× 桌面 1440×900 / 移动 390×844 × 亮/暗色截图。
- badge 数量边界 0 / 1 / 99 / 100（100 显示 `99+`、0 隐藏）。
- 未授权直接 URL 被服务端拒绝（403 / Not Found / 无数据）。
- E2E `admin-navigation.spec.ts` + `permission-matrix.spec.ts`（`--project=chromium`）实跑。

截图占位文件：`adm-desktop.png` / `ops-desktop.png` / `brk-mobile.png` / `dark-mode.png`（待生成）。

## 7. 结论

自动化验证（生成 / 类型 / lint / 单测 / 构建 / 迁移 dry-run+verify）**全部通过**，安全缺口有实现 + 单测 + E2E 回归三重覆盖。剩余仅浏览器截图证据，待用户确认后补齐即可收口。
