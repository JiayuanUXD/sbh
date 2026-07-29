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

## 6. 浏览器 / E2E 证据（已完成）

**环境**：隔离 SQLite（注释 `.env.local` 的 `DATABASE_URL`）+ `pnpm seed`（5 角色 + 5 个 `e2e-*@example.com` + 演示数据）。因主树 dev server 占用 3717，worktree server 跑在 **3718**。

### 6.1 E2E（Playwright chromium）

```bash
PORT=3718 pnpm exec playwright test \
  tests/e2e/admin-navigation.spec.ts tests/e2e/permission-matrix.spec.ts --project=chromium
```

结果：**34 passed / 0 failed**（退出码 0）。覆盖五角色一级分组矩阵、单组手风琴、当前路由高亮、移动全屏抽屉、badge 边界 0/1/99/100（100→`99+`、0 隐藏）、`/api/leads` 字段脱敏、BRK 自有范围与伪造 `city` 参数不扩权、越权直接 API 被拒。

> 排障记录（重要）：首轮出现 2 个 BRK 假失败。根因是 `permission-matrix.spec.ts` 的 `BASE` 硬编码 `?? 'http://localhost:3717'`，忽略 `PORT`，导致 API 请求打到主树 3717（`master` 代码、无本次 read-scope 修复、Postgres `sbh_dev`，e2e-brk 在那边是 user 5）而非 worktree 3718。curl 直连 3718 证明修复正确（BRK=user4 只见自有 lead 1；未认证返回 0 条）。已修 `BASE` 为 `?? http://localhost:${PORT ?? 3717}`，与 `playwright.config.ts` 对齐；仅 `PORT=3718` 复跑即 **34 passed**。

### 6.2 截图（`scripts/opt021-shots.ts` 生成）

| 文件 | 内容 | 校验 |
|---|---|---|
| `adm-desktop.png` | ADM 桌面 1440×900 亮色 | 9 个一级分组全显示 |
| `ops-desktop.png` | OPS 桌面 1440×900 亮色 | 仅 6 组，无 客户运营/团队管理/系统管理 |
| `brk-mobile.png` | BRK 移动 390×844 全屏抽屉 | 仅 3 组（工作台/房源运营/客户运营）+ 关闭按钮 |
| `dark-mode.png` | ADM 桌面暗色 | 暗色主题，9 组，切换按钮变「浅色」 |

## 7. 结论

自动化验证（生成 / 类型 / lint / 单测 / 构建 / 迁移 dry-run+verify）+ **E2E 34 passed** + 四张角色/响应式/暗色截图**全部通过**。安全缺口有实现 + 单测 + E2E 回归 + curl 直连四重确认。Task 11 证据齐备。
