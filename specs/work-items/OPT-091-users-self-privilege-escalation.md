# Task Packet：OPT-091 自我提权收口为字段级 access（P0）

> 状态：**待评审**（与 OPT-087 同一个 PR #177）
> 创建日期：2026-09-11
> 来源：用户「顺手把 access.update 的自我提权也修了」；M1 权限审查遗留 P0

---

## 1. 一句话

`roles` / `cityScope` / `status` 三个字段各自加**字段级 `access.update`**（判据 `user:manage`），
`protectSelfPrivilegeEscalation` 由「删字段」改为「回退成原值」降为第二道防线。

## 2. 先纠正来源里的一句

M1 审查记的是「集合层 `access.update` 自己改自己整体放行 → 低权账号可给自己加 ADM」。
**实测这条已不成立**：BRK `PATCH /api/users/4 {"roles":[1]}` 之后重新登录，角色仍是 `["BRK"]`，
`protectSelfPrivilegeEscalation` 钩子早就在剥离敏感字段。

所以本次的价值不在「补一个不存在的防护」，而在两点：

1. 把防护放到**它该在的那一层**（字段级 access，四层权限模型里的字段层），
   顺带让后台把这些控件正确渲染成只读——以前它们对本人可编辑、改了却不生效。
2. 修掉剥离式防护引发的真实故障，见下。

## 3. 剥离式防护引发的故障（本次真正修好的东西）

`status` 是 `required`，字段校验跑在集合 `beforeChange` **之后**。钩子把 `status`
从 data 里 `delete`，于是校验报必填缺失 → **低权账号的任何自改都 400**，
包括只改姓名：

```
PATCH /api/users/4 {"name":"..."}    →  400 账号状态：该字段为必填项目
```

后台表现：BRK / CSR / MGR / OPS 在 `/admin/account` 改姓名或手机号点保存必失败
（dev 日志 `PATCH /api/users/4?depth=0&fallback-locale=null 400`）。
ADM 改他人、ADM 自改（有 `user:manage`，钩子不进剥离分支）都正常——两个对照证明
不是 Payload 的 PATCH 语义问题。

## 4. 为什么字段级 access 能同时解决两件事

Payload 对被拒字段的处理是 `delete siblingData[name]` 后**立刻**
`getFallbackValue` 回填原文档的值（`payload/dist/fields/hooks/beforeValidate/promise.js`
第 215-234 行），并且这一步跑在**字段校验之前**。因此字段改不动，也不会缺失。

钩子保留为第二道：字段级 access 在 `overrideAccess: true` 时被 Payload 整体跳过
（`overrideAccess ? true : await field.access[operation](...)`），而 Local API 调用方
可能带着低权 `req.user`。同理把它的 `delete` 改成回退原值，避免它自己再次触发必填校验。

## 5. 范围

- `payload-office-platform/src/collections/Users.ts`：新增 `requireUserManage`，挂到三个字段。
- `payload-office-platform/src/domain/auth/user-protect.ts`：钩子改为回退 + 关系值归一成 ID。
- `payload-office-platform/tests/users-sensitive-field-access.test.ts`：新增字段级 access 守卫（10 条）。
- `payload-office-platform/tests/user-protect.test.ts`：三条断言改写为回退语义，并加两条回归。

**非目标**：`team` 字段仍可自改（见第 7 节）、`sessionVersion` 死代码、角色复制 endpoint 取参、
`follow-ups` / `lead-ownership-history` 读权限口径。

## 6. 不需要迁移

字段 `access` 是运行时函数，不参与 schema 生成。A/B 实测：master 版与修复版分别跑
`generate:types`，两份 `payload-types.ts` 逐字节相同。

## 7. 留给后续：`team`

`team` 目前**不是**提权路径——`buildPermissionContext` 里 `teamIds: new Set()`，
团队还没接进数据范围。**一旦 teams 参与 dataScope，`team` 必须加进敏感字段集合。**

## 8. 验收

证据见 `../artifacts/verification/OPT-091/self-escalation-walkthrough.md`。

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` | 干净 |
| `pnpm lint`（改动四文件） | 干净 |
| `pnpm test` | 见 PR（全绿） |
| BRK 自改姓名（API + 后台账户页） | 修复前 **400**，修复后 **200**，同一条路由 |
| BRK 自改 roles/status/cityScope | 200 但三者纹丝不动 |
| ADM 改他人角色 / 停用启用 / 自改角色 | 200，行为不变 |
| 字段权限矩阵 `POST /api/users/access/4` | BRK 看自己：三者只有 `read`；ADM：全可写 |
| 夹具还原 | 5 个账号姓名 / 角色 / status / sessionVersion 全部复原 |
