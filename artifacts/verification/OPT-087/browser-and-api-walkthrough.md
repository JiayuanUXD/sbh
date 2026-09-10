# OPT-087 验证证据：匿名自注册封堵

日期：2026-09-10
被测代码：`fix/users-anon-create-d96c`（`Users.access.create` 匿名分支 `true → false`）

## 0. 环境

| 项 | 值 |
| --- | --- |
| 实施工作树 | `E:\github\sbh\.claude\worktrees\serene-ardinghelli-8075c1`（路径 81 字符） |
| 验收工作树 | `E:\wt-anon`（`git worktree add --detach E:/wt-anon origin/master`，再把改后的 `Users.ts` 拷进去） |
| dev server | `next dev -p 3725`（`NODE_ENV=development`，cookie 非 Secure，本地可登录） |
| 库（主验证） | 本地 `postgres`（5 个 E2E 夹具账号） |
| 库（首建管理员验证） | 新建空库 `sbh_dev_opt087`，跑完全部迁移，**验完已 DROP** |

**为什么换工作树**：实施工作树路径 81 字符，`next dev` 报 **37 个 `Module not found`**、
`/admin/login` 恒 500——即 `CLAUDE.md` 记的 Windows 路径长度 + Turbopack 坑。
换到根级短路径 `E:\wt-anon` 后 `Module not found` 归零、`/admin/login` 200。
这条再次复现，不是新问题。

## 1. 修复前（master 代码，同一台 server）

| 编号 | 请求 | 结果 |
| --- | --- | --- |
| A1 | 匿名 `POST /api/users`，body `{}` | **400** `ValidationError`（缺姓名/邮箱）→ **access 已放行**，只是字段没过 |
| A2 | 匿名 `POST /api/users` 完整 body | **201**，建出 `id=7`、`status: 'active'`、`roles: []` |
| A3 | 用该账号 `POST /api/users/login` | **200**，拿到 token |
| A4 | 该账号 `GET /api/follow-ups?limit=2` | **200**，`totalDocs=2` |
| A5 | 该账号 `GET /api/teams?limit=2` | **200**，`totalDocs=1` |
| A6 | 该账号 `GET /api/lead-ownership-history?limit=2` | **200**，`totalDocs=2` |

判据说明：Payload 的 create 操作里 `executeAccess` 在字段校验**之前**
（`node_modules/payload/dist/collections/operations/create.js`：access 在 70 行，
`beforeValidate` 在 95 行），所以「空 body 返回 400 而不是 403」即证明 access 放行。
生产环境当时给的正是 400。

探针账号 `id=7` 已用 ADM 登录态 `DELETE /api/users/7`（200），复查该邮箱 `totalDocs=0`。

## 2. 修复后（同一台 server，HMR 载入新 access）

| 编号 | 请求 | 结果 |
| --- | --- | --- |
| B1 | 匿名 `POST /api/users`，body `{}` | **403** `您无权执行此操作。` |
| B2 | 匿名 `POST /api/users` 完整 body | **403**，且复查该邮箱 `totalDocs=0`（什么都没建） |
| C0 | `e2e-adm@example.com` 重新登录 | **200**，`roles: ["ADM"]` |
| C1 | ADM `POST /api/users`（正向对照） | **201**，建出 `id=8`；验完已 `DELETE`（200） |
| C2 | `e2e-brk@example.com` 登录后 `POST /api/users` | **403**（与 `permission-matrix.spec.ts` 的 4xx 期望一致） |

收尾复查：`GET /api/users?limit=50` → `totalDocs=5`，只剩 5 个 E2E 夹具账号，无探针残留。

## 3. 浏览器实测（Browser pane，真实键盘输入）

1. `/admin/logout` → `/admin/login`，渲染正常的登录表单（不是「创建第一个用户」）。
   - 注意：浏览器 cookie **不区分端口**，首次打开 3725 时带着别的 dev server（localhost:3717）
     的登录态直接进了仪表板；必须先登出才算验到登录流程。
2. 点邮箱框键入 `e2e-adm@example.com`、点密码框键入夹具密码、点「登录」
   → 进入「运营工作台」仪表板（全部房源 38 / 当前可租 26 / 咨询线索 69）。
3. `/admin/collections/users` → 「用户管理」列表渲染 5 行（CSR/BRK/MGR/OPS/ADM）。
4. `/admin/collections/users/create` → 新建表单渲染完整（邮箱 / 新的密码 / 确认密码 / 姓名 / 手机号…），
   「保存」按钮在位。

夹具账号 `e2e-adm@example.com` / `Test1234!` 出自 `scripts/seed.ts`，是公开测试夹具，不是真实凭据。

## 4. 首建管理员没有被这次改动挡住（空库端到端实证）

这是本次唯一「只有代码推断、还没有实测」的断言，因此单独做了实验：

1. 新建空库 `sbh_dev_opt087`，`pnpm exec payload migrate` 跑完全部迁移（含 `20260910_141436_opt_086_audit_log_reason`）。
2. 用**修复后的代码** + 该空库起 dev server：`GET /admin` → 200，日志显示路由落在 `/admin/create-first-user`。
3. 浏览器打开 `/admin/create-first-user`，真实键盘填入邮箱 / 密码 / 确认密码 / 姓名，点「创建」。
4. **结果：直接进入后台仪表板**，`GET /api/users/me` 返回 `{ id: 1, email: 'first-admin@example.com' }`。
   （仪表板显示「运营数据暂时加载失败」是空库无业务夹具所致，与本次改动无关。）
5. 同一页面内匿名 `fetch('/api/users', { method: 'POST', credentials: 'omit' })` → **403**。

即：**首建管理员照常可用，而匿名自注册这条路已经封死**。机理与代码一致——
`registerFirstUser` 走 `payload.create({ overrideAccess: true })`，不经过本 access。

### 顺带观察（非本次范围）

首建出来的管理员 `roles: []`，因此它自己也不具 `user:manage`，无法在后台再建第二个账号；
这是 `registerFirstUser` 的既有行为，**改动前后一致**，不是本次引入的回归。真实部署靠
`scripts/seed.ts`（Local API，`overrideAccess`）建号授权。若要让首建账号自动获得 ADM，
需另开工作项。

## 5. 收尾

- 探针账号 `id=7`、正向对照账号 `id=8` 均已删除，主库回到 5 个夹具账号。
- 空库 `sbh_dev_opt087` 已 `DROP DATABASE`。
- dev server 已停，`E:\wt-anon` 工作树已移除。
