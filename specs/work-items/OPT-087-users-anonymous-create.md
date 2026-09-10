# Task Packet：OPT-087 封堵后台用户集合的匿名自注册（P0）

> 状态：**待评审**（PR 已开，等用户确认后合并）
> 创建日期：2026-09-10
> 来源：M1 权限审查遗留 P0（2026-09-10 端到端复现，生产同样开放，尚未被利用）

---

## 1. 一句话

`src/collections/Users.ts` 的 `access.create` 把匿名分支由 `return true` 改成 `return false`。

## 2. 缺陷

原代码：

```ts
create: async ({ req }) => {
  // 首次创建管理员（数据库无用户）由 Payload 自身逻辑放行，req.user 为空时通过
  if (!req.user) return true
  ...
}
```

注释里的前提是错的，于是 `users` 成了**匿名可写**的集合：任何人
`POST /api/users {email, password, name}` 就能建出一个 `status: 'active'`、
无角色的后台账号，再 `POST /api/users/login` 拿到会话。

### 影响面

登录后即可读到所有只判 `Boolean(req.user)` 的数据：

| 对象 | 暴露内容 |
| --- | --- |
| `follow-ups` | 全表读（跟进记录） |
| `lead-ownership-history` | 全表读（归属历史） |
| `teams` | 全表读 |
| `listings.roomNumber` | 字段级 access 只判登录 |
| `leads.visitorRef` | 同上 |

`users` / `roles` 本身读不到有效内容：`Users.access.read` 对无 `user:manage`
的账号收窄成 `{ id: { equals: req.user.id } }`，只能读自己。

### 现场证据（本次之前）

- 本地 dev（:3717）端到端：创建 `201` → 登录 `200` → `GET /api/follow-ups` `200`（`totalDocs=2`），探针账号已删。
- 生产：匿名 `POST /api/users` 空 body 返回 **400 校验错**而不是 403，说明 access 同样放行；
  2026-09-10 查生产库 3 个账号均有角色，无被利用痕迹。

## 3. 为什么 `return false` 不会挡住首建管理员与 seed

两条「首次建号」路径都不经过这个 access，**已逐条查证**：

1. `registerFirstUser`（`node_modules/payload/dist/auth/operations/registerFirstUser.js:37-42`）
   自己用 `payload.create({ ..., overrideAccess: true })`；而且它在 `payload.db.findOne`
   查到任意一条 user 时先 `throw new Forbidden`（同文件 26-33 行）——users 表非空时它本就不可用。
2. `scripts/seed.ts` 走 Local API，`payload.create` 默认 `overrideAccess: true`
   （脚本里各处也显式写了 `overrideAccess: true`）。

## 4. 范围与非目标

改动两个文件：

- `payload-office-platform/src/collections/Users.ts`：匿名分支 `true → false`，并改正两处错误注释。
- `payload-office-platform/tests/users-anonymous-create.test.ts`：新增守卫单测。

**非目标**（各自另开任务，本次不碰）：

- `follow-ups` / `lead-ownership-history` 的读权限口径（`tests/collection-write-access-coverage.test.ts`
  里的 `CREATE_ACCESS_TODO` 白名单也记着同族待办）；
- `sessionVersion` 死代码；
- 邮件适配器；
- `Users.access.update` 的自我提权（M1 审查的另一个 P0，仍未修）。

## 5. 不需要迁移

`access` 是运行时函数，不参与 schema 生成。**A/B 实测**：同一棵工作树先用 master 版
`Users.ts` 跑 `pnpm generate:types`，再用修复版跑一次，两份 `src/payload-types.ts`
**逐字节相同**（`diff` 无输出）。

`.githooks/pre-commit` 第 4 条按**路径**匹配拦「改了 `src/collections/` 却没新增迁移」，
区分不了这种纯逻辑改动，因此本次用它自带的逃生舱 `SKIP_MIGRATION_CHECK=1`，
依据即上面那条零 diff 实测，已写进提交信息（先例：OPT-080 / PR #169）。

## 6. 验收

见 `../artifacts/verification/OPT-087/`。

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` | 干净 |
| `pnpm lint`（改动两文件） | 干净 |
| `pnpm test` | 352 文件 / 4799 用例通过，0 失败 |
| `pnpm migrate:dry-run` | 无新增迁移，仅既有 4 条 warning |
| 浏览器：`/admin/login` 用 `e2e-adm@example.com` 登录 | 通过，进入仪表板；用户列表 / 新建表单正常 |
| 匿名 `POST /api/users` | 修复前 201（可登录、可读 follow-ups/teams/归属历史），修复后 **403** 且零落库 |
| ADM 建号（正向对照） | 201（已删除）；BRK 仍 403 |

## 7. E2E 影响面自查

`rg` 过 `tests/e2e/`：只有 `permission-matrix.spec.ts` 打 `POST /api/users`，
两条用例（CSR / BRK）都**带登录态**且断言 `4xx`，本次改动不影响它们。
没有任何用例依赖匿名建号。

## 8. 首建管理员：空库端到端实证

第 3 节原本只有代码推断。已补做实验：新建空库 `sbh_dev_opt087` 跑完迁移，用**修复后的代码**
打开 `/admin/create-first-user`，真实键盘填表提交 → 直接进入后台，`/api/users/me` 返回
`id: 1, first-admin@example.com`；同页匿名 `POST /api/users` 仍 403。空库验完已 DROP。
详见 `../artifacts/verification/OPT-087/browser-and-api-walkthrough.md` §4。
