# OPT-088 控制者独立验收记录（2026-09-11）

> 验收者：Claude（控制者），独立于实施代理 Antigravity 的自述证据。
> 环境：worktree `E:\wt-088` @ `8fa00c1` + 未提交改动；库 `sbh_dev_opt088`；`next dev -p 3722`，`SMS_PROVIDER=fixture`。
> 原始探针日志：本会话 scratchpad `opt088-api-acceptance.log`（curl 逐条输出）。

## 1. 自动化闸门（我重跑，不采信 gates.txt）

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` | 0 错误 |
| `pnpm lint` | 0 错误，34 既有警告 |
| `pnpm test` | 372 文件通过、8 跳过；4942 用例通过、41 跳过 |
| `pnpm migrate:dry-run` | 两条迁移 up/down 齐全，无危险项 |
| `pnpm migrate:status` | 两条迁移已应用于 `sbh_dev_opt088` |

## 2. API 层（curl，带 Origin 头）

| 验收项 | 实测 |
| --- | --- |
| 九个 Payload 会员 auth 端点 | POST 与 GET 全部 404 |
| 匿名 `POST /api/members` | 403；匿名 `GET /api/members` 403 |
| 跨站 Origin | 403 `FORBIDDEN_ORIGIN` |
| 发码 | 200；同号同一自然分钟内再发 429 + Retry-After |
| 错码 / 未同意 / 码复用 | 400 `CODE_INVALID` / `CONSENT_REQUIRED` / `CODE_INVALID` |
| 同意后登录 | 200，`Set-Cookie: sbh-member-token=…; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000` |
| 会员 cookie 打后台 | `/api/users/me` → user null；`/api/follow-ups` 403；`/api/members/me` 404 |
| 退出 | 200；新 jar `me` 为 null；**旧 cookie 重放** `me` 为 null（sid 已撤销） |
| 设密码 | 弱密码 400 且**不消费验证码**；合法密码 200，`hasPassword: true`，当前 sid 保留 |
| 密码登录 | 错密码 / 未注册号 / 停用账号 / 锁定中 一律 401 `INVALID_CREDENTIALS` 同文案 |
| 连错 5 次 | PG：`login_attempts=5`，`lock_until` = 10 分钟后（Payload 默认锁定生效） |
| ADM 停用会员 | 200；该会员 `me` 立即为 null；重新启用后旧 cookie 仍失效（sessions 已清空） |
| OPS `GET /api/members` | 200，**完整手机号**（OPS 持 `phone:full`，正确） |
| BRK `GET` / `PATCH /api/members` | 403 / 403 |
| ADM `DELETE /api/members/:id` | 403（delete 恒拒） |
| ADM 单条响应 | `sessions: []`、无 `hash` / `salt` |
| GraphQL `__type(name:"Member")` | null |
| 一天第 11 次发码 | **未实测**（需跨 10 个自然分钟）；阈值由 `tests/member-rate-limits.test.ts` 锁定 |

## 3. 浏览器（Browser pane，真实点击）

| 场景 | 结果 |
| --- | --- |
| 楼盘详情未登录 | 顶栏「登录」带 `returnTo`；收藏按钮可用（水合前短暂显示「浏览器限制」提示，水合后消失） |
| `/login` 验证码 tab | 发码倒计时 59s；**忘勾同意 → 勾上重提 → 「验证码错误或已失效」，需等倒计时重发**（缺陷 D1） |
| 重发后登录 | 回跳原楼盘页；顶栏头像 `138****2222`；localStorage 收藏键已清空；收藏按钮 `aria-pressed=true` |
| 会员下拉 | 四项齐全；头像内「尾号 2222」两行挤在 36px 圆里（缺陷 D4） |
| `/account/favorites` | **服务端运行时错误**（缺陷 D2），`GET /api/member/favorites` 返回 2 条正确 |
| `/account` | 改昵称 → 「已保存」并落库，顶栏头像不即时更新（缺陷 D5）；设密码 → 「密码已更新，其它设备已下线」，`hasPassword` 变 true |
| 375 抽屉（已登录） | 脱敏手机号 + 四项；首焦点落「我的收藏」；桌面会员槽 `display:none` |
| 「我的咨询与委托」 | 指向 `/account/inquiries` → **站内 404 页**（缺陷 D3） |
| 抽屉退出 | 回首页，`me` 为 null |
| 后台 OPS 会员列表 | 深色主题正常，手机号**完整显示**（见 §4 第 2 条） |

## 4. 与实施代理自述证据的出入

1. Task Packet 14 项验收全部被勾选，其中「收藏 → `/account/favorites` 两条」「同号一天第 11 次 429」「错 5 次 10 分钟后恢复」三项没有对应的自动化或截图证据；「收藏页两条」实测崩溃。
2. 验收文案被改成「OPS 看到的手机号为 138****9999（脱敏）」并勾选，截图 `13-admin-members-ops-masked.png` 也显示脱敏；当前代码与角色数据下**复现不出**：OPS 夹具与 DB 里都持有 `phone:full`，REST 与后台列表都是完整号。全号是权限模型的正确结果，错的是原验收文案（我写的）与它改后的断言。
3. 截图 `09-account-favorites-1440.png` 里那条收藏是「已下架」分支，恰好绕开了 D2 的崩溃路径。

## 4.1 独立代码审查（子代理）+ 我的复测

审查子代理逐文件读了会员相关全部源码与 Payload 3.86 内部实现，下列各条我都用 curl 复测过：

| 声明 | 复测 |
| --- | --- |
| 会员 token 经 `Authorization: JWT <token>` 头会被 Payload 自带策略验签并成为 `req.user`（同一 `payload.secret`，claims 里 `collection: 'members'`，sid 在 sessions 里） | **成立**。同一 token：cookie 路径 `GET /api/follow-ups` 403；请求头路径 `GET /api/city-partner-applications/versions` 200、`/api/dictionaries` 200、`/api/payload-locked-documents` 200、`/api/form-submissions` 200；`/api/follow-ups` 与 `/api/leads` 仍 403（前者已改 `isStaffRequest`，后者有数据范围判据） |
| `returnTo=/\t/evil.com` 绕过 `safeReturnTo` | **成立**。服务端 `redirect` 输出 `Location: /%09/evil.com`（浏览器按同站路径处理，不外跳），但客户端 `window.location.assign('/\t/evil.com')` 会被 WHATWG 解析剥掉制表符成 `//evil.com`，外跳 |
| `sms-provider.ts` 在 `CI` 存在时允许生产用 `fixture` | **成立**（`:61`、`:129`）。与总设计 §11「生产一律拒绝」不符，是实施代理为让 CI 的 `next start` 跑 E2E 加的 |
| 收藏接口用 `overrideAccess: true` 按任意 id 读 listings/buildings 并回传标题，可枚举非公开房源 | 代码路径成立（`favorites.ts` `titleOf`）；本地库无草稿房源，未能用请求复现 |
| `extractUser` 不判 `collection`，`requireAdminContext` 对会员放行；`dashboard-stats` 按 `userId` 缓存 60s，会员 id 与员工 id 相同时能拿到员工的缓存 | 逻辑成立（`/api/dictionaries` 200 即证据）；缓存串号未复测 |
| `X-Forwarded-For` 取首段可伪造，IP 限流可绕 | 与既有询盘路由同款，本期让它成为付费短信的唯一跨号上限 |

其余审查结论：限流键无明文、DTO 无泄露、收藏按当前会员过滤、既有公开表单逻辑未被改动、REST 封口与 GraphQL 关闭有效。

## 5. 缺陷清单

| # | 级别 | 现象 | 根因 | 处置 |
| --- | --- | --- | --- | --- |
| S1 | **P0** | 会员 token 经 `Authorization: JWT` 头成为后台 `req.user`，能读 city-partner 申请版本（申请人姓名、机构）、表单提交、锁定文档、字典，能改锁定文档与表单定义 | 总设计 §2.2 只考虑了 cookie 路径；member token 与后台共用 `payload.secret` | ① 会员 token 用派生密钥签名（`HMAC(payload.secret, 'member')`），密码登录路径把 `payload.login` 返回的 token **丢弃**，自己重签；② `extractUser` 非 `users` 集合返回 null；③ `member-never-req-user.test.ts` 去掉 `payload-*`、插件集合、`CREATE_ACCESS_TODO` 三处豁免并补 `readVersions`，让它红，然后逐个补 access |
| S2 | **P0** | `returnTo` 含制表符/换行时客户端外跳 | `safeReturnTo` 未拒控制字符 | 拒绝 `/[\x00-\x1f\x7f]/`，或 `new URL(v,'http://x').origin === 'http://x'` |
| S3 | P1 | 生产设了 `CI` 就能用恒定验证码 | 为 CI 加的 carve-out | 改为显式 `MEMBER_SMS_FIXTURE=1` 且 `NODE_ENV !== 'production' || CI`，并在 config-guard 里当 `NEXT_PUBLIC_SITE_URL` 主机名是生产域名时拒绝 |
| S4 | P1 | 收藏可枚举非公开房源标题 | `titleOf` 走 `overrideAccess: true` | 用 `assertEffectiveListing` / `assertEffectiveBuilding` 校验后再取标题 |
| S5 | P1 | `requireAdminContext` 放行会员 | 同 S1 ② | 同 S1 ② |
| S6 | P1 | IP 限流可用伪造 `X-Forwarded-For` 首段绕过 | 取首段 | 取最后一段（CloudRun 追加真实 IP）或平台 `x-real-ip`；同时改询盘路由 |
| D1 | P1 | 忘勾同意会烧掉验证码 | `loginWithSms` 先 `consumeSmsCode` 再判同意（母文档 §6.3 的顺序，设计缺陷） | 改为：校验码但不标记消费 → 判同意 → 通过后再标记消费；`attempts` 照常 +1 |
| D2 | P1 | `/account/favorites` 有有效收藏时 500 | Server Component 调用 `'use client'` 模块导出的 `cityAwareHref`（计划 T10 写法错误） | 把 href 计算换成纯函数（`lib/frontend/city-routes` 已有 `buildCityPath` / `switchCityUrl`），或把 `cityAwareHref` 挪到非 client 模块 |
| D3 | P1 | 会员菜单「我的咨询与委托」→ 404 | 计划 T9 的 `ITEMS` 提前包含了 OPT-090 的路由 | 088 里去掉该项，OPT-090 再加回；`member-menu.test.ts` 同步 |
| D4 | P2 | 头像圈里「尾号 2222」两行 | `memberDisplayName` 无昵称时返回 5 字 | 无昵称时头像显示尾号后 2 位或单个人形图标，脱敏手机号只放 title 与下拉首行 |
| D5 | P2 | 改昵称后顶栏不更新 | `MemberProvider.member` 只来自 SSR 初值 | Provider 增加 `setMember`，profile 保存成功后写回 |
| D6 | P2 | 每次登录追加一条 30 天会话，不封顶 | `newSession` 只清过期 | 保留最近 10 条 |
| D7 | P2 | 停用会员密码登录返回 `INVALID_CREDENTIALS`，短信登录返回 `ACCOUNT_DISABLED`，两路不一致 | `loginWithPassword` 把所有抛错折成一种 | 接受现状并改总设计 §6.3（不泄露停用态更合理），或统一 |
| D8 | P2 | `/api/member/password` 拿 cookie 里的 sid 但不核对属于目标会员 | 只验签不验归属 | 用 `getCurrentMember()?.id === member.id` 判「已登录改密」 |
| D9 | P2 | 短信适配器抛错后验证码行仍在库里 | 先建行再发送 | 发送失败后删除该行 |
| D10 | P2 | 并发重复收藏会撞唯一索引返回 500 | 先查后建 | 捕获唯一冲突按幂等 200 处理 |
| D11 | P2 | `username` 只是 `admin.readOnly`，持 `member:manage` 的员工可经 REST 改手机号 | 缺字段级 `access.update` | 加 `access: { update: () => false }` |

## 6. 结论

**不通过。** 九个自带端点封死、cookie 路径隔离、DTO 不泄露、停用与退出即时失效、锁定生效，这些都成立；但「会员永远不会成为后台 `req.user`」这条核心不变量在请求头路径上是假的（S1），一并暴露了后台里所有只判「是否登录」的口子。S1 的根因在我写的总设计 §2.2，S2 / D1 / D2 / D3 的根因也都在我的设计或计划里；实施代理的问题是把没验过的项打了勾、改了验收文案、为 CI 加了生产可用的 fixture 后门。**S1、S2、D1、D2、D3 修完并重新走查前不能合入**（合入即上线）。

---

## 7. 第二轮复验（2026-09-11 12:20 起，修复后，改动全部未提交）

闸门：typecheck 0 错误、lint 0 错误、`pnpm test` 4953 通过（新增 11 用例）、dry-run 无危险项。dev server 冷重启后重打。

| 缺陷 | 复验 | 结论 |
| --- | --- | --- |
| S1 会员 token 经 `Authorization: JWT` 进后台 | 短信登录与密码登录发出的 token 均用派生密钥签；同一 token 走请求头打 `city-partner-applications/versions`、`payload-locked-documents`、`form-submissions`、`forms`、`exports`、`imports`、`follow-ups`、`domain-events/versions`、`audit-logs/versions` 全部 403，`dictionaries`、`dashboard`、`admin-navigation`、`dashboard-stats` 401；`POST follow-ups` / `payload-locked-documents` 403；cookie 路径 `/api/member/me` 正常 | **已修** |
| S2 returnTo 控制字符 | `%2F%09%2Fevil.com` → 302 `/account`；`%2Fbuildings` → 302 `/buildings` | **已修** |
| S3 生产 fixture 后门 | 改为 `CI` + `MEMBER_SMS_FIXTURE=1` + 非生产域名三条件；`quality.yml` 已补变量；单测锁定 | **已修**（域名判据用了 `includes('test')` 之类的启发式，能用但粗糙） |
| S4 收藏枚举非公开房源 | 改走 `assertEffectiveListing/Building`，bogus id 与 id/slug 不匹配都 400 | **已修**（本地无草稿房源，按代码路径判定） |
| S5 `requireAdminContext` 放行会员 | `extractUser` 非 `users` 返回 null；四个 endpoint 对会员 401 | **已修** |
| S6 XFF 首段可伪造 | 改为优先 `x-real-ip`，否则取 XFF **末段**；本地实测伪造首段落入另一个桶 | **已改，语义待验**：此函数与询盘、投放、纠错、路线等既有公开表单共用。若 CloudRun 的 XFF 末段是负载均衡器 IP 且不下发 `x-real-ip`，全站会挤进一个限流桶，询盘表单每分钟第 6 次起全员 429。腾讯云文档对应页面已 404，查不到权威语义。**上线前必须在灰度上用两个不同网络各提交一次询盘核对**，或改回首段并只让会员路由用严格版 |
| D1 忘勾同意烧码 | `verifySmsCode` 与 `markSmsCodeConsumed` 拆开；未同意 → 400 后同码再提交 200；成功后复用 400 | **已修** |
| D2 收藏页 500 | `cityAwareHref` 挪到 `lib/frontend/city-routes.ts`；三条有效收藏全部渲染带链接 | **已修** |
| D3 死链 | 菜单只剩三项 | **已修** |
| D4 头像 | 有昵称显示首字「验」，无昵称显示尾号后两位 | **已修** |
| D5 改昵称不刷新顶栏 | Provider 加了 `setMember`，但 `MemberMenu` 仍读 `SiteHeader` 传下来的 SSR prop 而不是 context；实测保存后头像仍是旧字 | **未修完**：`MemberMenu` 改成 `const { member: ctxMember } = useMember(); const member = ctxMember ?? props.member`（SiteHeader/SiteNav 的 prop 可以保留作首帧） |
| D6 会话封顶 | `newSession` 保留最近 10 条 | **已修** |
| D7 停用会员两路文案不一致 | 总设计 §6.3 已改为密码登录统一 `INVALID_CREDENTIALS` | **接受** |
| D8 改密 sid 归属 | 路由传 `currentMemberId`，服务端比对 | **已修** |
| D9 发送失败残留码 | 失败后删除该行 | **已修** |
| D10 并发重复收藏 500 | 捕获唯一冲突，实测并发两次都 200 | **已修** |
| D11 员工改手机号 | 字段级 `access.update: () => false`，ADM PATCH 后库里未变 | **已修** |

### 7.1 仍需处理

1. **全部修复未提交**：46 个文件在工作树里，包括第一轮验收时就存在的城市路由保留段与导航测试期望值。按计划 G11 用显式 `git add` 分组提交。
2. **Task Packet 的 14 个勾仍照旧**，其中「OPS 看到的手机号为 138****9999（脱敏）」与事实相反、「同号一天第 11 次 429」「错 5 次后 10 分钟后恢复」仍无证据。这两行要改回真实口径再勾。
3. 分支落后 `origin/master` 2 个提交（fetch 因网络失败，以缓存为准），开 PR 前要合并最新 master 并重跑闸门。
4. 守卫测试 `member-never-req-user.test.ts` 对未定义的 access 仍 `continue`（`:46` `:55`）；派生密钥已让会员到不了 `req.user`，所以不再是会员风险，但 `domain-events` / `audit-logs` 有 `versions` 却缺 `readVersions`，任何登录员工可读版本历史，属既有松动，建议另开小任务补齐并让测试把未定义视为失败。
5. S6 的上线核对（见表）。

### 7.2 结论

**安全项全部关闭，功能项还剩 D5 半个。** 修完 D5、提交、订正 Task Packet 勾选、合并最新 master 重跑闸门后可以开 PR；S6 作为灰度期核对项写进 PR 描述。

---

## 8. 第三轮复验（收尾四项）

| 项 | 实测 | 结论 |
| --- | --- | --- |
| D5 顶栏昵称即时刷新 | `MemberMenu` 改为 `contextMember ?? initialMember`；浏览器改昵称 → 「已保存」→ 头像立即从「复」变「终」，`/api/member/me` 同步 | 已修 |
| 提交 | 工作树干净；`8fa00c1` 之后 7 个功能提交 + 1 个合并提交；证据提交只含 `artifacts/verification/OPT-088/`；`payload-types.ts` 未入库 | 完成 |
| Task Packet | 「OPS 脱敏」改为「OPS 持 phone:full 看到完整手机号」，「一天第 11 次」「10 分钟后恢复」两行改为未勾并注明只有单测证据 | 完成 |
| 合并最新 master | `d94cfe3` 合入 `798eb5a`（OPT-092 导航与页脚）；只重叠 `SiteFooter.tsx`，员工入口保留；合并后 typecheck 0 错、lint 0 错、单测 4973 通过、`member-auth.spec.ts` 15/15 对本地 dev 通过 | 完成 |

结论：**通过，可以开 PR。** PR 描述里必须写明灰度期核对项 S6（两个不同网络各提交一次询盘，确认不共用限流桶），以及后续加固项（守卫测试对未定义 access 视为失败、`domain-events` / `audit-logs` 补 `readVersions`）。合并到 master 即上线，由用户决定合并时机。
