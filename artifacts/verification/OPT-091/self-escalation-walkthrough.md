# OPT-091 验证证据：自我提权收口 + 它连带修好的自改 400

日期：2026-09-11
被测代码：`fix/users-anon-create-d96c`（在 OPT-087 之上追加）
环境：`E:\wt-esc`（根级短路径，避开 Turbopack 路径长度坑）+ `next dev -p 3729`，本地 `postgres` 库 5 个 E2E 夹具账号

## 0. 先纠正一条过期结论

M1 审查记的是「`access.update` 里 `req.user.id === id → return true` 放行全部字段，
低权账号可给自己加 ADM」。**这一条今天已经不成立**：`protectSelfPrivilegeEscalation`
钩子早就在剥离 `roles / cityScope / status`。实测：

| 编号 | 请求 | 结果 |
| --- | --- | --- |
| A0 | BRK 登录 → `PATCH /api/users/4 {"roles":[1]}`（1 = ADM） | 角色**没有**变化，重新登录 `/me` 仍是 `["BRK"]` |

所以本次不是「补一个不存在的防护」，而是**把防护从钩子式剥离换成字段级 access**，
并修掉剥离方式带来的真实故障（下节）。

## 1. 剥离式防护造成的真实故障（修复前）

`SELF_PROTECTED_FIELDS` 里的 `status` 是 `required`，而字段校验跑在集合 `beforeChange`
**之后**——钩子把 `status` 从 data 里 `delete` 掉，校验就报必填缺失。后果是
**低权账号的任何自改都失败**，不只是敏感字段：

| 编号 | 请求 | 结果 |
| --- | --- | --- |
| P1 | BRK `PATCH /api/users/4 {roles,status,cityScope,name}` | **400** `账号状态：该字段为必填项目` |
| P2 | BRK `PATCH /api/users/4 {"roles":[1],"name":...}` | **400** 同上 |
| P4 | BRK `PATCH /api/users/4 {"name":"..."}`（只改姓名） | **400** 同上 |
| 对照 A | ADM `PATCH /api/users/4 {"name":...}`（改他人，钩子不进分支） | **200** |
| 对照 B | ADM `PATCH /api/users/1 {"name":...}`（自改，有 user:manage） | **200** |

两个对照证明这不是 Payload 的 PATCH 语义问题，就是钩子删字段造成的。

**后台实测**：以 BRK 登录 `/admin/account`，把姓名改一个字符点「保存」→
dev server 日志 `PATCH /api/users/4?depth=0&fallback-locale=null 400`
（`/tmp/dev3729.log` 第 109 行）。即**经纪人 / 客服 / 主管 / 运营都改不了自己的
姓名、手机号**，也走不完账户页的保存。

## 2. 修法

1. **主防线换成字段级 `access.update`**（`roles` / `cityScope` / `status`，判据 `user:manage`）。
   Payload 对被拒字段的处理是 `delete` 后立刻 `getFallbackValue` 回填**原文档的值**
   （`payload/dist/fields/hooks/beforeValidate/promise.js` 第 215-234 行），
   字段既改不动、也不会变成缺失，必填校验照常过。
2. **钩子降为第二道**：`delete` 改成回退成 `originalDoc` 的值（并把关系值归一成 ID）。
   保留它是因为字段级 access 在 `overrideAccess: true` 时被整体跳过，而 Local API
   调用方可能带着低权 `req.user`。

## 3. 修复后（同一台 server）

| 编号 | 请求 | 结果 |
| --- | --- | --- |
| D1 | BRK `PATCH /api/users/4 {"name":"BRK self edit ok"}` | **200**，姓名改成功，`roles` 仍 `["BRK"]`、`status` 仍 `active` |
| D2 | BRK `PATCH /api/users/4 {roles:[ADM], status:'disabled', cityScope:[1], name:...}` | **200**，但 `roles=["BRK"]`、`status=active`、`cityScope=[]` —— 只有姓名生效 |
| E1 | ADM `PATCH /api/users/4 {"roles":[3,4]}` | **200**，`roles=["MGR","BRK"]` |
| E2 | ADM 把 BRK 停用再启用 | **200 / 200**，`sessionVersion` 按设计从 1 涨到 2 |
| E3 | ADM 自改自己的 `roles` | **200**（有 `user:manage`，属正常管理操作） |

**后台实测（同一条路由的前后对照）**：BRK 在 `/admin/account` 改姓名点保存 →
`PATCH /api/users/4?depth=0&fallback-locale=null` **200**（日志第 199 行），
与修复前第 109 行的 400 是同一个 URL、同一个操作者、同一条 UI 路径。

## 4. 字段权限矩阵（Payload 自己算的，`POST /api/users/access/4`）

| 字段 | BRK 看自己 | ADM 看 BRK |
| --- | --- | --- |
| `name` / `phone` / `email` | `{read:true, update:true}` | 可写 |
| `roles` | **`{read:true}`**（无 update） | 可写 |
| `status` | **`{read:true}`**（无 update） | 可写 |
| `cityScope` | **`{read:true}`**（无 update） | 可写 |
| `team` | `{read:true, update:true}` | 可写 |

DOM 侧同源核对：BRK 的 `/admin/account` 上 `#field-roles`、`#field-status`、
`#field-cityScope` 三个容器都渲染成只读；ADM 打开 `/admin/collections/users/4` 时三者均可编辑。
**这是字段级 access 相对钩子的额外收益**：以前这些控件对本人是可编辑的，改了却静默不生效（现在还会 400）。

## 5. 留给后续的一条（本次不做）

`team` 仍可自改。当前**不是**提权路径——`buildPermissionContext` 里 `teamIds: new Set()`，
团队还没接进数据范围（代码注释写的是 M2.5 回填）。**一旦 teams 参与 dataScope，
`team` 必须加进敏感字段集合**，否则同一个洞会以团队范围的形式再来一次。

## 6. 收尾

夹具已还原：5 个账号，姓名 / 角色 / `status=active` / `sessionVersion=1` 全部回到原值
（其中 `sessionVersion` 是我做 E2 停用实验涨上去的，已改回 1）。

**注意**：用 Git Bash 的 `curl -d` 写中文姓名会落成乱码（本机既有的编码坑），
本次中文写入一律走浏览器页内 `fetch`，`curl` 只用 ASCII。
