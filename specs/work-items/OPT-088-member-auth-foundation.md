# Task Packet：OPT-088 会员基座 + 短信 / 密码登录 + 前台登录入口 + 收藏同步

> 状态：**待实施**
> 创建日期：2026-09-10
> 母文档：`OPT-088-member-system-design.md`（总设计，本包只写范围、验收与风险，规则以母文档为准）
> 前置：OPT-087 合入 master
> 分支：`feat/opt-088-member-auth-<hex>`（`pnpm branch:new feat opt-088 member auth`），worktree 建在 `E:\wt-088`
> 实施代理读取顺序：`payload-office-platform/AGENTS.md` → `.agent/core.md` → `.agent/permissions.md` → `.agent/frontend.md` → `.agent/backend.md` → `.agent/migrations.md` → `.agent/testing.md` → 母文档 → 本包 → 实施计划

---

## 1. 一句话

建出 `members` 会员集合与自建会话，前台出现登录入口，外部用户能用手机验证码或手机号加密码登录、设密码、退出，收藏跟着账号走；员工从页脚进后台。

## 2. 范围（按母文档章节）

| 母文档 | 内容 |
| --- | --- |
| §3.2 标 088 的模块 | 三个 collection、`domain/member/` 六个模块、`lib/api/request-guards.ts` 抽共享（含 `clientIp`）、REST 总路由包装、前台组件与页面、权限码与导航、迁移、config-guard |
| §4.1 §4.2 §4.3 §4.5 | 数据模型与授权 |
| §5 | 会话与 cookie |
| §6.1 §6.2 §6.3 §6.4 §6.5 | 限流、短信、登录、密码、收藏、`/api/member/profile` |
| §7 | 封口与守卫，含全后台守卫测试 |
| §8 除微信按钮与 `/login/bind-phone`、`/account/inquiries` | 顶栏、抽屉、页脚、`/login`、`/login/reset`、`/account`、`/account/favorites` |
| §9 | 收藏同步 |
| §10 | 后台会员列表与详情 |
| §11 短信相关变量 | `.env.example`、config-guard |
| §12.1 088 行、§12.2 `member-auth.spec.ts`、§12.3、§12.4 | 测试与证据 |

## 3. 非目标

微信（089）；进度页与既有表变更（090）；邮箱登录；自助注销；后台代登录；员工「忘记密码」邮件；改 `users` 集合的任何行为。

## 4. 迁移清单

| 名称 | 内容 | 回滚 |
| --- | --- | --- |
| `opt_088_members` | 建 `members`、`members_sessions`、`member_sms_codes`、`member_favorites` 及索引；唯一性由 `member_favorites.target_key` 的 `unique` 承载，全部由 collection 配置生成，不手写索引 | 删表 |
| `opt_088_grant_ops_member_codes` | OPS 增量授予菜单码 `members` 与操作码 `member:manage` | 撤销两码 |

由 `pnpm exec payload migrate:create <名称>` 生成后人工审阅；`src/test/factory/roles.ts` 同步改 OPS，否则 seed 会擦掉授权。

## 5. 验收标准

- [ ] 匿名 `POST /api/members/login`、`/logout`、`/refresh-token`、`/me`、`/first-register`、`/forgot-password`、`/reset-password`、`/unlock`、`/verify/x` 全部 404；`GET /api/members` 匿名 403，持 `member:manage` 员工 200；GraphQL 中不存在 `Member` 类型。
- [ ] `POST /api/members` 匿名与会员上下文均被拒；服务端 `memberFlow` 路径可建。
- [ ] 验证码登录（fixture 码 123456）：未勾同意 → `CONSENT_REQUIRED`；勾选 → 201 会员创建、cookie `sbh-member-token` 落下、顶栏显示会员菜单；刷新仍登录。
- [ ] 60 秒内重复发码 429；同号一天第 11 次 429；同 IP 一小时第 21 次 429。
- [ ] 设密码后密码登录成功；错 5 次后正确密码也返回 `INVALID_CREDENTIALS`，10 分钟后恢复。
- [ ] 退出后 `/api/member/me` 返回 null，旧 cookie 重放无效（sid 已撤销）。
- [ ] 后台停用会员后，会员下一次请求即失效。
- [ ] 收藏：未登录收藏两条 → 登录 → 合并上传 → localStorage 键清空 → `/account/favorites` 两条；移除一条后刷新仍是一条。
- [ ] 页脚「员工入口」`href="/admin/login"`、`rel="nofollow"`；`/login` 页底部员工提示存在。
- [ ] `/login` `/account*` 响应头或 meta 含 `noindex`；未登录访问 `/account/favorites` 302 到 `/login?returnTo=/account/favorites`；`returnTo=//evil` 被拒回落。
- [ ] 后台：ADM 与 OPS 见「会员」菜单并可打开列表；BRK 直敲 `/admin/collections/members` 得到无权限；OPS 看到的手机号为 `138****1111`。
- [ ] 四断点截图与三重铁证进 `artifacts/verification/OPT-088/`，随附取证脚本。
- [ ] `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm migrate:dry-run`、`pnpm build` 全绿；`tests/e2e/member-auth.spec.ts` 通过；既有 e2e 不红。
- [ ] `tests/member-never-req-user.test.ts` 存在并通过；`.env.example` 含全部新变量并有注释。

## 6. 风险与注意

- **不要给 `members` 注册任何 `auth.strategies`**，否则会员会进入后台 `req.user`。
- **不要用 Payload 发的 cookie**，`payload.login` 只取返回值里的 `token`。
- `sessions` 字段级 `access.update` 为 false，写入必须 `overrideAccess: true`。
- 改了 collection 必须 `pnpm generate:types`；`payload-types.ts` 不入库（见 `payload-office-platform/CLAUDE.md` 生成物纪律）。
- pre-commit 会拦「改了 collection 没带迁移」，本包每个动 collection 的提交都要带迁移或与迁移同一提交。
- 提交只用显式 `git add <路径>`；不碰 `public/prd/*`；不 `--no-verify`；不自行合并（合并即上线）。
- 头部结构改动会影响 `tests/frontend-shell-hydration.test.ts` 与 `tests/city-switcher.test.ts`，同步更新断言而不是删测试。

## 7. 证据目录

`artifacts/verification/OPT-088/`：迁移 dry-run 输出、PG 结构、四断点截图、抓包 JSON、e2e 报告摘要、取证脚本。
