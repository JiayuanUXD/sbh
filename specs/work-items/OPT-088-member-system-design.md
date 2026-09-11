# 总设计：会员体系与前台登录入口（OPT-088 / 089 / 090 共用）

> 状态：**设计已获用户逐节确认（2026-09-10），待审阅后进入实施计划**
> 创建日期：2026-09-10
> 来源：用户提问「目前登录注册模块的完成度如何，可以在前台显示登录注册入口么」→ 明确诉求「公司内部员工日常运营和外部用户访问网站使用」
> 分期：OPT-088（会员基座 + 短信/密码登录 + 入口 + 收藏同步）、OPT-089（微信扫码登录）、OPT-090（我的咨询与委托进度）
> 前置：OPT-087（封堵 `users` 匿名自注册）必须先合入
> 实施代理：Antigravity（Gemini 3.8 Flash）。本文与三份 Task Packet 是它的唯一需求来源，措辞刻意具体，**不要在实施中自行改口径**。

---

## 0. 一句话

前台顶栏与移动抽屉出现「登录」入口；外部用户用手机验证码、手机号加密码、微信扫码三种方式登录，登录后收藏跨设备同步、能看到自己的咨询与委托进度；员工从页脚「员工入口」进后台。会员是 Payload 的第二个 auth collection，借它的凭据与会话存储，**不借它的 HTTP 入口**。

## 1. 产品裁定（用户逐条确认）

| 议题 | 裁定 | 备注 |
| --- | --- | --- |
| 入口服务对象 | **员工 + 外部用户** | 员工进后台；外部用户在前台注册登录 |
| 外部用户登录后能做什么 | **收藏跨设备同步；查看自己的咨询与委托进度** | 不做业主自助发布；不做「仅留资」 |
| 登录方式 | **手机验证码 + 手机号加密码 + 微信扫码** | 无邮箱登录；密码在短信验证后自行设置；找回密码走短信 |
| 架构 | **方案 B：`members` 作为 Payload 第二个 auth collection，保留本地密码策略** | 但 HTTP 入口全部自建，Payload 自带的 auth REST 端点对 members 封死，见 §7 |
| 外部资质 | **腾讯云短信签名与模板已有；微信开放平台网站应用已有；SMTP 没有** | 员工「忘记密码」邮件不在本项目范围 |
| 员工入口位置 | **页脚底栏「员工入口」→ `/admin/login`** | 顶栏不放 |
| 分期 | **三个 PR，各自可独立上线** | 088 → 089 → 090，见 §13 |
| 微信上线方式 | **受 `WECHAT_LOGIN_ENABLED` 开关控制，默认关** | 合入后配好凭据再打开，用户真机扫码验收，失败即关开关 |

## 2. 现状与事实（实施前必须知道）

### 2.1 仓库现状

- 唯一 auth collection 是 `users`（后台员工）。Payload 默认邮箱加密码；`loginName` / 手机号字段的描述称可登录但**没有接** `loginWithUsername`；`failedLoginCount` / `lockedUntil` 两个自定义字段无人写入，真正生效的是 Payload 自带的 `loginAttempts` / `lockUntil`；没有邮件适配器。这些都**不在本项目范围**，别顺手修。
- OPT-087 正在封堵 `Users.access.create` 对匿名放行的漏洞。本项目的 `members` 从第一天就不能有同类口子（§7）。
- 前台 `SiteNav.tsx` 的右侧动作区已预留 `actions` 插槽（`SiteHeader.tsx:103` 传入），注释明写「未来扩展的客服电话、登录/注册等」。
- 站点设置里的导航目标池是封闭枚举（`src/lib/frontend/nav-targets.ts`），加目标要发版加 PG 枚举迁移；登录入口**不走**这套配置，直接渲染在动作区与抽屉里。
- 「收藏」今天只存浏览器 `localStorage`，键 `sbh:saved-details:v1`，条目 `{ type, id, slug, savedAt }`，上限 100，实现在 `src/components/frontend/ShareSaveActions.tsx`。
- 线索 `leads.phone`：前台表单创建的线索由 `src/domain/inquiry/schema.ts:356` 写入**规范化 11 位手机号**，但该列**没有索引**。投放申请 `supply-submissions.contactPhone` 有索引但**按原样入库**，没有规范化列。
- 限流：`src/lib/rate-limit-distributed.ts` + `src/lib/rate-limit-pg.ts`，PG 表 `inquiry_rate_limit`，多实例安全；询盘用它是 fail-open。
- 同源校验 `isSameOrigin`、严格 JSON `isStrictJsonContentType`、`extractPgPool` 在 `src/app/api/city-partner-applications/request-guards.ts` 与 `src/app/api/supply-submissions/request-guards.ts` 各有一份副本。
- 隐私同意版本常量 `PRIVACY_POLICY_VERSION`（`src/lib/frontend/site-config.ts:31`），隐私页在 `/pages/privacy`。
- 手机号脱敏日志 `maskPhone`（`src/domain/inquiry/privacy-log.ts`）；手机号规范化 `normalizePhone`（`src/domain/shared/phone`）。

### 2.2 Payload 3.86 事实（已读源码核实，路径均在 `node_modules/payload/dist/`）

| 事实 | 位置 | 对本设计的含义 |
| --- | --- | --- |
| 内置 JWT 策略只读 `Authorization: JWT` 头或 cookie `${cookiePrefix}-token`，即 `payload-token`；`cookiePrefix` 是全局唯一 | `auth/extractJWT.js:13` | 我们的会员 cookie 用别的名字，Payload 自带策略永远看不到它，后台 `req.user` 不会变成会员 |
| 策略按 `payload.authStrategies` 顺序执行，第一个返回 user 的胜出 | `auth/executeAuthStrategies.js` | 不给 members 注册任何自定义策略，避免会员进入 `req.user` |
| 校验 token 后按 `decodedPayload.collection` 找用户，`useSessions` 默认 true 时要求 `sid` 在 `user.sessions` 里 | `auth/strategies/jwt.js` | 我们签发的 token 必须带 `sid` 且写进 `sessions` |
| `sessions` 是 auth collection 自动注入的 array 字段，字段级 `access.update: () => false`，`admin.disabled: true` | `auth/baseFields/sessions.js` | 写入必须 `overrideAccess: true`（覆盖字段级 access） |
| `jwtSign({ fieldsToSign, secret, tokenExpiration })`、`getFieldsToSign({ collectionConfig, email, sid, user })` 都是 `payload` 顶层导出 | `auth/jwt.js`、`auth/getFieldsToSign.js` | 自己签 token 不需要复制实现 |
| `payload.login({ collection, data: { username, password }, context })` Local API 返回 `{ token, user, exp }`，内部已写 session、处理锁定 | `auth/operations/login.js`、`auth/operations/local/login.d.ts` | 密码登录复用它 |
| `beforeLogin` 钩子在签发 token 之前执行，能拿到 `context`，抛错即中止 | `auth/operations/login.js:242-250` | 用它拒绝不带 `memberFlow` 的登录（封 REST 登录的第二道门） |
| 本地策略开启时 `create` 必填 `password` | `collections/operations/create.js:181-186` | 短信 / 微信首建会员要生成随机密码 |
| `loginWithUsername: { allowEmailLogin: false, requireEmail: false, requireUsername: true }` 合法；注入的 `username` 字段可通过在 `fields` 里同名声明覆写标签、校验（`mergeBaseFields` 深合并） | `auth/types.d.ts:162-170`、`fields/mergeBaseFields.js`、`auth/baseFields/username.js` | `username` 就是手机号，不另存 phone |
| 每个 auth collection 都会挂 REST 端点：`login` `logout` `refresh-token` `me` `first-register` `forgot-password` `reset-password` `unlock` `verify/:token`；`first-register` 在表为空时用 `overrideAccess: true` 建用户并登录 | `auth/endpoints/`、`auth/operations/registerFirstUser.js` | 全部对 members 封死（§7） |
| `me` 只在 `req.user.collection === collection` 时返回用户 | `auth/operations/me.js:8` | 会员 token 即使进了 `payload-token`，后台 `/api/users/me` 也返回 null |
| 默认 `maxLoginAttempts: 5`、`lockTime: 600000`、`tokenExpiration: 7200` | `collections/config/defaults.js` | members 把 `tokenExpiration` 改成 30 天 |
| `jose` 是 Payload 的依赖（5.10.0）但 pnpm 严格模式下应用不能直接 import | `node_modules/.pnpm/jose@5.10.0` | 加同版本直接依赖 |

## 3. 架构与模块边界

### 3.1 一句话架构

`members` 存凭据与会话；`src/domain/member/` 提供纯函数与领域服务；`src/app/api/member/*` 是唯一 HTTP 入口；前台经 `MemberProvider` 拿到会员 DTO；后台经 `member:manage` 管理会员。会员**永远不会**成为 Payload 的 `req.user`。

### 3.2 模块清单（路径相对 `payload-office-platform/`）

| 模块 | 职责 | 依赖 | 分期 |
| --- | --- | --- | --- |
| `src/collections/Members.ts` | auth collection 配置、字段、access、钩子（创建闸门、登录闸门、脱敏） | `domain/member/member-access.ts`、`domain/auth/field-hooks` | 088 |
| `src/collections/MemberSmsCodes.ts` | 验证码存储，后台隐藏，REST 全拒 | 无 | 088 |
| `src/collections/MemberFavorites.ts` | 收藏存储，后台隐藏，REST 全拒 | 无 | 088 |
| `src/domain/member/session.ts` | 签发 / 校验 / 撤销会话，cookie 名与属性，`getCurrentMember()` | `payload`（`jwtSign`、`getFieldsToSign`）、`jose`、`next/headers` | 088 |
| `src/domain/member/sms-code.ts` | 验证码生成、HMAC、比对、生命周期规则（纯函数） | `node:crypto` | 088 |
| `src/domain/member/sms-provider.ts` | `SmsProvider` 接口 + `console` / `fixture` / `tencent` 三个实现 + 按环境变量选择 | `tencentcloud-sdk-nodejs-sms` | 088 |
| `src/domain/member/member-access.ts` | members 的 access 函数、创建闸门、登录闸门、`member:manage` 判据 | `domain/auth/access` | 088 |
| `src/domain/member/rest-fence.ts` | `isBlockedMemberAuthPath(segments)` 纯函数 | 无 | 088 |
| `src/domain/member/member-dto.ts` | `MemberDto` 类型与映射，手机号脱敏 | `domain/inquiry/privacy-log`（`maskPhone`） | 088 |
| `src/domain/member/favorites.ts` | 合并、去重、上限（纯函数） | 无 | 088 |
| `src/domain/member/rate-limits.ts` | 限流键与阈值常量、fail 策略 | `lib/rate-limit-distributed` | 088 |
| `src/domain/member/wechat-oauth.ts` | 授权 URL、state 签名与校验、code 换 token、userinfo（fetch 注入） | `node:crypto` | 089 |
| `src/domain/member/member-status.ts` | `toMemberFacingLeadStatus`、投放申请状态透传 | `domain/crm/lead-stage` | 090 |
| `src/lib/api/request-guards.ts` | 从既有副本抽出的 `isSameOrigin` / `isStrictJsonContentType` / `extractPgPool`（城市合伙人与投放申请两处）与 `clientIp`（询盘路由）；三处原文件改为引用 | `lib/frontend/site-config` | 088 |
| `src/app/api/member/**/route.ts` | HTTP 入口，见 §6 | 上述领域模块 | 088 / 089 / 090 |
| `src/app/(payload)/api/[...slug]/route.ts` | 在 Payload REST 总路由外包一层：命中 `isBlockedMemberAuthPath` 直接 404 | `domain/member/rest-fence` | 088 |
| `src/components/frontend/member/MemberProvider.tsx` | client context：会员 DTO、收藏列表、乐观增删 | `/api/member/favorites` | 088 |
| `src/components/frontend/member/MemberMenu.tsx` | 顶栏登录按钮 / 会员下拉 | `MemberProvider` | 088 |
| `src/components/frontend/SiteHeader.tsx`、`SiteNav.tsx` | 接 `member` prop；动作区与抽屉渲染入口 | `MemberMenu` | 088 |
| `src/components/frontend/SiteFooter.tsx` | 底栏「员工入口」 | 无 | 088 |
| `src/app/(frontend)/login/**`、`account/**` | 页面与表单 | `MemberProvider`、`/api/member/*` | 088 / 089 / 090 |
| `src/domain/auth/permission-codes.ts`、`src/test/factory/roles.ts`、`src/domain/admin-navigation/navigation-config.ts` | 菜单码 `members`、操作码 `member:manage`、导航叶子 | 无 | 088 |
| `src/migrations/*` | 三个新表 + 授权；`leads.phone` 索引；投放申请规范化列 | 无 | 088 / 090 |
| `src/lib/runtime/config-guard.ts` | 生产环境拒绝 `SMS_PROVIDER=console|fixture`；开微信开关时必须有 AppID/Secret | 无 | 088 / 089 |

### 3.3 不变量（守卫测试逐条钉死）

1. 任何 Payload access 函数收到 `req.user.collection === 'members'` 时必须拒绝（返回 `false`）。全后台遍历断言，见 §12。
2. `members` 的创建只有两条路：`req.context.memberFlow` 存在（服务端验证流程）或 `req.user` 为持 `member:manage` 的员工；其余在 `beforeChange` 抛 `ForbiddenError`。这一条同时堵住 `first-register`。
3. `members` 的密码登录只接受 `req.context.memberFlow === 'password'`，其余在 `beforeLogin` 抛错。
4. Payload 自带的会员 auth REST 端点全部 404；`members.graphQL = false`。
5. 会员 DTO 永远不含 `hash` `salt` `sessions` `wechatUnionId` `wechatOpenId` `loginAttempts` `lockUntil` 与完整手机号。
6. 客户端没有任何「按手机号查询」的接口；进度页与收藏页在服务端按当前会员定向过滤。
7. 验证码明文只存在于短信正文与（非生产）控制台，永不落库、永不落日志。

## 4. 数据模型

### 4.1 `members`（auth）

```ts
auth: {
  loginWithUsername: { allowEmailLogin: false, requireEmail: false, requireUsername: true },
  tokenExpiration: 60 * 60 * 24 * 30,   // 30 天，sessions.expiresAt 同源
  useAPIKey: false,
  cookies: { secure: process.env.NODE_ENV === 'production' }, // 仅为一致性，我们不用 Payload 发的 cookie
}
graphQL: false
trash: false
```

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `username` | text（Payload 注入，本地覆写） | unique、required、自定义校验：`normalizePhone` 后须为大陆 11 位手机号（`isValidCnMobile`） | 标签「手机号」。beforeChange 先 `normalizePhone` 再交给 Payload 的 lowercase/trim。**唯一事实源，不另存 phone** |
| `email` | email（Payload 注入） | 可空 | 不使用，后台隐藏（`admin.hidden`） |
| `nickname` | text | ≤ 30 字 | 微信昵称或自填 |
| `hasPassword` | checkbox | 默认 false | 用户主动设过密码才为 true |
| `status` | select `active` / `disabled` | 默认 `active` | 停用即清空 `sessions`（钩子） |
| `wechatUnionId` | text | unique、可空、索引 | 089 使用；同一 unionid 只能绑一个会员 |
| `wechatOpenId` | text | 可空 | 089 使用 |
| `wechatBoundAt` | date | 可空 | 089 使用 |
| `consentPolicyVersion` | text | 注册时必填 | 取 `PRIVACY_POLICY_VERSION` |
| `consentAcceptedAt` | date | 注册时必填 | 服务端时间 |
| `lastLoginAt` | date | 可空 | 每次登录成功更新 |
| `sessions`、`loginAttempts`、`lockUntil`、`hash`、`salt` | Payload 注入 | 不显示 | — |

后台脱敏：`afterRead` 用 `createFieldMaskHooks([{ field: 'username', requiredPermission: 'phone:full', mask: maskPhone }])`，缺权限显示 `138****1111`。

可空且带唯一约束的列（`wechatUnionId`、`email`）**写 `null` 不写空串**：唯一索引下空串会互相冲突，`null` 可并存（`Users.phoneNormalized` 的既有教训）。

### 4.2 `member-sms-codes`

`admin.hidden: true`；`access` 四项全 `() => false`；只由服务端 Local API `overrideAccess: true` 读写。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `phone` | text，索引 | 规范化手机号 |
| `purpose` | select `login` / `set-password` / `bind-wechat` | 一次发码只能用于一种用途 |
| `codeHash` | text | `HMAC-SHA256(PAYLOAD_SECRET, "member-sms|" + phone + "|" + purpose + "|" + code)` 的 hex |
| `expiresAt` | date | 发码时间 + 5 分钟 |
| `attempts` | number，默认 0 | 每次校验先 +1，>5 作废 |
| `consumedAt` | date，可空 | 校验通过即写入，不可重用 |
| `ipHash` | text | `sha256(ip)` 前 16 位，只作排障 |

清理：每次发码时，以 `PruneTimestampRef` 同款的模块级时间戳做节流，最多每 10 分钟删一次 `expiresAt < now - 1 天` 的行（`payload.delete({ where })`）。不引入新 job。

### 4.3 `member-favorites`

`admin.hidden: true`；`access` 四项全 `() => false`。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `member` | relationship → members，索引 | 所属会员 |
| `targetType` | select `listing` / `building` | — |
| `targetId` | number | 目标文档 id |
| `targetSlug` | text | 保存时的 slug |
| `titleSnapshot` | text | 保存时服务端从目标文档读的标题；目标下架后仍能显示名称 |
| `savedAt` | date | 客户端合并时保留原时间，新建取服务端时间 |
| `targetKey` | text，`unique: true`、索引 | `beforeChange` 派生为 `${memberId}:${targetType}:${targetId}`。Payload 配置声明不了复合唯一，用这一列承载唯一性，让唯一索引进入 Payload 的 schema 快照；**不要在迁移里手写复合唯一索引**，手写的索引不在快照里，下一次 `migrate:create` 会生成 `DROP INDEX` |

每人上限 200 条。

### 4.4 既有表变更（090）

- `Leads.ts` 的 `phone` 字段加 `index: true`，由 `migrate:create` 生成索引迁移（`opt_090_leads_phone_index`）。**索引一律在 collection 配置里声明再生成**，不手写 `CREATE INDEX`，理由同 §4.3 `targetKey`。
- `SupplySubmissions.ts` 新增 `contactPhoneNormalized`（text，`index: true`，可空）；`beforeChange` 从 `contactPhone` 派生。生成的迁移只会加列加索引；回填另写一条 TS 迁移（`opt_090_supply_submission_phone_backfill`）读全表逐行调 `normalizePhone`，只更新 `contact_phone_normalized IS NULL` 的行，输出影响行数与无法规范化的行 id。规范化在 SQL 里做不了完整版，所以不用 `UPDATE ... SET` 一句话回填。

### 4.5 权限与角色数据

- `MENU_CODES` 增加 `'members'`；`OPERATION_CODES` 增加 `'member:manage'`。
- `src/test/factory/roles.ts` 的 OPS：`menuPermissions` 加 `'members'`，`operationPermissions` 加 `'member:manage'`。ADM 持 `'*'` 不用改。
- 迁移 `opt_088_grant_ops_member_codes`：与 `20260908_150000_grant_ops_supply_write_codes.ts` 同款的幂等增量写法，同时写 `menu_permissions` 与 `operation_permissions`。
- 导航：`navigation-config.ts` 的 `crm` 组追加 `leaf('members', '会员', '/admin/collections/members', ['members'], { requiredOperationCode: 'member:manage' })`。OPT-084 正在重排后台导航，落地时以当时的分组为准，叶子定义不变。

## 5. 会话与 cookie

| 项 | 取值 |
| --- | --- |
| cookie 名 | `sbh-member-token` |
| 属性 | `Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`；生产加 `Secure`；不设 `Domain` |
| token | HS256 JWT，`jwtSign({ fieldsToSign: { id, collection: 'members', sid }, secret: payload.secret, tokenExpiration: 2592000 })`。members 没有任何 `saveToJWT` 字段，手写这三个 claim 与 Payload 的 `getFieldsToSign` 产出等价，且不必把 `email` 传成空串 |
| 签发 | `issueMemberSession(payload, member)`：`sid = crypto.randomUUID()`；`sessions = 未过期旧会话 + { id: sid, createdAt: now, expiresAt: now + 30 天 }`；`payload.update({ collection: 'members', id, data: { sessions, lastLoginAt: now }, overrideAccess: true, context: { memberFlow: 'session' } })`；再签 token。密码登录用 `payload.login` 得到的 token，它内部已写 session，只需另更新 `lastLoginAt` |
| 校验 `getCurrentMember()` | 读 cookie → `jose.jwtVerify(token, secretKey, { algorithms: ['HS256'] })` → `payload.collection === 'members'` 且 `id`、`sid` 存在 → `payload.findByID({ collection: 'members', id, depth: 0, overrideAccess: true })` → `status === 'active'` → `sessions` 中存在 `id === sid` 且 `expiresAt > now` → 返回 `MemberDto`。任一步失败返回 `null`，不抛错。用 React `cache()` 做请求级去重 |
| 撤销 | 退出：从 `sessions` 删除当前 `sid` 并写回，响应带 `Max-Age=0` 的同名 cookie。设密码：只保留当前 `sid`。停用：钩子清空 `sessions` |
| 到期 | 固定 30 天，不滑动续期 |

`MemberDto`：

```ts
type MemberDto = Readonly<{
  id: number
  phoneMasked: string        // 138****1111
  nickname: string | null
  hasPassword: boolean
  wechatBound: boolean
  createdAt: string
}>
```

## 6. HTTP 契约（全部在 `src/app/api/member/`）

通用规则：

- 只接受 `Content-Type: application/json`（`isStrictJsonContentType`），非 GET 一律先过同源校验，失败 403 `FORBIDDEN_ORIGIN`。同源判据是 **Origin 的 host 等于 Host 头、缺任一头即拒绝**（`isSameOriginHost`），不是城市合伙人那种钉死 `siteConfig.siteOrigin` 的写法——后者在 CI 的 `next start` 下恒 403（`tests/e2e/multi-city-forms.spec.ts:239`），会员 E2E 过不去。
- 请求体以 `unknown` 收口，手写类型守卫，不用 `any`。
- 成功 `{ ok: true, ...}`；失败 `{ ok: false, code, message }`，`message` 是可直接展示的简体中文。
- 错误码与状态码：

| code | HTTP | 场景 |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | 体结构不合法 |
| `INVALID_PHONE` | 400 | 非大陆 11 位手机号 |
| `CONSENT_REQUIRED` | 400 | 首次注册未勾选隐私同意 |
| `CODE_INVALID` | 400 | 验证码错误、已消费、超 5 次 |
| `CODE_EXPIRED` | 400 | 验证码过期 |
| `INVALID_CREDENTIALS` | 401 | 密码登录失败或账号锁定，文案统一「手机号或密码错误」 |
| `UNAUTHENTICATED` | 401 | 需要登录 |
| `ACCOUNT_DISABLED` | 403 | 会员被停用 |
| `FORBIDDEN_ORIGIN` | 403 | 跨站请求 |
| `WECHAT_ALREADY_BOUND` | 409 | unionid 已绑其他会员 |
| `FAVORITE_LIMIT` | 409 | 收藏超 200 |
| `RATE_LIMITED` | 429 | 触发限流，带 `Retry-After` |
| `SMS_UNAVAILABLE` | 503 | 生产未配短信或短信服务失败 |
| `WECHAT_DISABLED` | 404 | 开关关闭 |
| `WECHAT_UNAVAILABLE` | 503 | 开关打开但非生产缺凭据 |
| `WECHAT_STATE_INVALID` / `WECHAT_EXCHANGE_FAILED` / `WECHAT_PENDING_MISSING` | 400 | 微信流程错误 |

### 6.1 限流（`domain/member/rate-limits.ts`）

| 键 | 窗口 | 上限 | 失败策略 |
| --- | --- | --- | --- |
| `member-sms:phone:<sha256(phone)前16位>` | 60 秒 | 1 | fail-closed |
| `member-sms:phone-day:<同上>` | 24 小时 | 10 | fail-closed |
| `member-sms:ip:<sha256(ip)前16位>` | 1 小时 | 20 | fail-closed |
| `member-login:ip:<同上>` | 15 分钟 | 30 | fail-open |

`runDistributedRateLimit` 的 `RateLimitConfig.failOpen` 已支持 `false`（`decideOnStoreFailure`），短信三条配置直接取 `failOpen: false`，存储不可用时返回 `RATE_LIMITED`。发短信花钱，不能放行。IP 取法沿用询盘路由里的 `clientIp`（`x-forwarded-for` 第一段，缺省 `unknown`），该函数随 `isSameOrigin` 一起抽到 `src/lib/api/request-guards.ts`。

### 6.2 短信

`POST /api/member/sms/send`
请求 `{ phone: string, purpose: 'login' | 'set-password' | 'bind-wechat' }`
流程：校验格式 → 三条限流 → 生成 6 位随机码（`crypto.randomInt(0, 1_000_000)` 补零）→ 写 `member-sms-codes` → `smsProvider.send({ phone, code, minutes: 5 })` → 200 `{ ok: true }`。**不论号码是否已注册都返回 200**。provider 抛错返回 503 且不留码。生产 `SMS_PROVIDER` 未配时直接 503。

`SmsProvider` 接口：`send(input: { phone: string; code: string; minutes: number }): Promise<void>`。

| provider | 行为 | 允许环境 |
| --- | --- | --- |
| `console` | `payload.logger.info` 打印 `[sms:console] phone=<脱敏> code=<code>` | 非生产 |
| `fixture` | 不发送，验证码恒为 `123456`（`sms-code.ts` 的生成函数在 fixture 模式返回常量） | 非生产，E2E 用 |
| `tencent` | `tencentcloud-sdk-nodejs-sms` v20210111 `SendSms`，`PhoneNumberSet: ['+86' + phone]`，`TemplateParamSet` 按 `TENCENT_SMS_TEMPLATE_PARAMS` 模板展开 | 任意 |

`TENCENT_SMS_TEMPLATE_PARAMS` 是逗号分隔的占位串，默认 `{code},{minutes}`；`{code}` `{minutes}` 替换后逐项放进 `TemplateParamSet`。用户的模板若只有一个参数，配成 `{code}` 即可，不改代码。

### 6.3 登录

`POST /api/member/login/sms`
请求 `{ phone, code, consent?: { accepted: true, policyVersion: string } }`
流程：格式校验 → `member-login:ip` 限流 → 取该号码 `purpose = login`、`consumedAt` 为空、最新一条 → `attempts + 1` 写回 → 过期 `CODE_EXPIRED`；`attempts > 5` 或 HMAC 不等 `CODE_INVALID`（`timingSafeEqual`）→ 写 `consumedAt` → 按 `username` 找会员：无则要求 `consent.accepted === true` 且 `policyVersion === PRIVACY_POLICY_VERSION`，否则 `CONSENT_REQUIRED`；创建会员（`password` 为 32 字节随机 hex，`hasPassword: false`，`context: { memberFlow: 'sms' }`）→ 停用返回 `ACCOUNT_DISABLED` → `issueMemberSession` → 设 cookie → 200 `{ ok: true, member: MemberDto, isNew: boolean }`。

`POST /api/member/login/password`
请求 `{ phone, password }`
流程：格式校验 → `member-login:ip` 限流 → `payload.login({ collection: 'members', data: { username: phone, password }, context: { memberFlow: 'password' } })`，任何抛错（含 `LockedAuth`、账号停用、账号不存在、密码错误）一律统一返回 401 `INVALID_CREDENTIALS`（文案统一「手机号或密码错误」，防账号存在性与状态枚举；短信登录因已完成手机所有权核身故返回 `ACCOUNT_DISABLED`） → 更新 `lastLoginAt` → 设 cookie → 200 `{ ok: true, member }`。

`GET /api/member/me` → 200 `{ ok: true, member: MemberDto | null }`。
`POST /api/member/logout` → 撤销 sid，清 cookie，200 `{ ok: true }`；未登录也 200。

### 6.4 密码

`POST /api/member/password`
请求 `{ phone, code, newPassword }`，`code` 的用途必须是 `set-password`。
规则：8 到 64 位，至少一个字母和一个数字。流程同短信校验 → 找会员（不存在返回 `CODE_INVALID`，不暴露存在性）→ `payload.update({ id, data: { password: newPassword, hasPassword: true, sessions: [当前 sid 或空] }, overrideAccess: true, context: { memberFlow: 'password-set' } })` → 若请求本身未登录则顺带 `issueMemberSession` 并设 cookie → 200 `{ ok: true, member }`。登录页「忘记密码」与账户中心「设置 / 修改密码」都走这一个端点。

### 6.5 收藏

- `GET /api/member/favorites` → `{ ok: true, items: FavoriteItem[] }`
- `POST /api/member/favorites` 体 `{ type, id, slug }` → 幂等，返回全量 `items`
- `DELETE /api/member/favorites` 体 `{ type, id }` → 返回全量 `items`
- `POST /api/member/favorites/merge` 体 `{ items: Array<{ type, id, slug, savedAt }> }`（≤ 100 条）→ 返回全量 `items`

`FavoriteItem = { type: 'listing' | 'building', id: number, slug: string, title: string, savedAt: string }`。新增时服务端 `findByID`（`overrideAccess: true, depth: 0`）确认目标存在并取 `title` 写入 `titleSnapshot`，不存在返回 `BAD_REQUEST`。上限 200，两种入口处理不同：单条新增时已满返回 `FAVORITE_LIMIT`；合并时把「服务端已有 + 本地上传」按 `savedAt` 倒序裁到 200 条并返回 200，被裁掉的不报错。全部未登录返回 `UNAUTHENTICATED`。

### 6.5.1 资料

`PATCH /api/member/profile` 体 `{ nickname: string }`：需登录；去首尾空白后 1 到 30 字，否则 `BAD_REQUEST`；`payload.update({ overrideAccess: true, context: { memberFlow: 'profile' } })`；返回 `{ ok: true, member }`。

### 6.6 微信（089）

- `GET /api/member/wechat/start?returnTo=/path`：开关关闭 404 `WECHAT_DISABLED`。`returnTo` 只接受以 `/` 开头且不以 `//` 开头的站内路径，否则回落 `/account`。生成 `nonce`（16 字节 hex），cookie `sbh-wx-state` = `base64url(JSON{ nonce, returnTo, iat })` + `.` + HMAC（10 分钟，HttpOnly，SameSite=Lax）。302 到 `https://open.weixin.qq.com/connect/qrconnect?appid=<WECHAT_APP_ID>&redirect_uri=<encode(siteOrigin + '/api/member/wechat/callback')>&response_type=code&scope=snsapi_login&state=<nonce>#wechat_redirect`。
- `GET /api/member/wechat/callback?code&state`：校验 cookie 签名、未过期、`nonce === state`，失败 302 到 `/login?error=wechat_state`。`GET https://api.weixin.qq.com/sns/oauth2/access_token?appid&secret&code&grant_type=authorization_code` 取 `openid`、`unionid`（可能缺失）、`access_token`；再 `GET https://api.weixin.qq.com/sns/userinfo?access_token&openid` 取 `nickname`。失败 302 到 `/login?error=wechat_exchange`。身份键 `identityKey = unionid ?? openid`。按 `wechatUnionId === identityKey` 找会员：找到且启用 → 更新 `wechatOpenId`、`nickname`（会员未自填时）→ `issueMemberSession` → 302 `returnTo`。未找到 → cookie `sbh-wx-pending` = 签名的 `{ identityKey, openId, nickname, returnTo, iat }`（10 分钟）→ 302 `/login/bind-phone`。清除 `sbh-wx-state`。
- `POST /api/member/wechat/bind` 体 `{ phone, code, consent? }`，`code` 用途 `bind-wechat`：读 `sbh-wx-pending` 缺失或过期 `WECHAT_PENDING_MISSING` → 短信校验 → 按手机号找或建会员（建时同 6.3 的同意要求）→ 若该会员已有不同的 `wechatUnionId`，或 `identityKey` 已绑在其他会员 → `WECHAT_ALREADY_BOUND` → 写 `wechatUnionId`、`wechatOpenId`、`wechatBoundAt`、`nickname`（未自填时）→ 发会话 → 200 `{ ok: true, member, returnTo }`，清 `sbh-wx-pending`。
- `POST /api/member/wechat/unbind`：需登录，且 `hasPassword === true`（否则解绑后只剩短信登录，允许；不设限制，仅提示）→ 清三个微信字段 → 200。
- 账户中心「绑定微信」复用 `start`，`returnTo=/account`；callback 里若当前请求已有登录会员且身份键未被占用，直接绑定到当前会员，不进 bind-phone。

`domain/member/wechat-oauth.ts` 的网络调用通过注入的 `fetch` 完成，单测用 mock。

### 6.7 咨询与委托进度（090）

无新增 HTTP 端点。`/account/inquiries` 是 Server Component，服务端直接查：

```ts
payload.find({ collection: 'leads', where: { phone: { equals: member.username } }, sort: '-createdAt', limit: 50, depth: 1, overrideAccess: true })
payload.find({ collection: 'supply-submissions', where: { contactPhoneNormalized: { equals: member.username } }, sort: '-createdAt', limit: 50, depth: 0, overrideAccess: true })
```

映射成 `ProgressItem = { kind: 'inquiry' | 'entrust' | 'supply', submittedAt, title, href: string | null, statusLabel, advisorName: string | null }`：线索 `sourcePageType === 'entrust'` 为委托找房，其余为咨询；`title` 取意向房源标题、否则楼盘名、否则「租赁需求咨询」；`href` 仅当目标仍通过 `getListingBySlug` / `getBuildingBySlug` 返回非空时给出；`advisorName` 取 `owner`（brokers）的姓名。投放申请 `title` 取楼盘名加面积摘要，`statusLabel` 直接用 `SUPPLY_SUBMISSION_STATUS_LABELS`。

`toMemberFacingLeadStatus(lead)`：`stage` 优先，缺失回落 `status`。

| 输入 | 输出 |
| --- | --- |
| stage `new` / `pending_assignment`；status `new` | 已收到 |
| stage `following` / `qualified`；status `contacted` | 顾问跟进中 |
| stage `viewing`；status `visited` | 已安排带看 |
| stage `negotiation` | 洽谈中 |
| stage `converted`；status `won` | 已完成 |
| stage `lost`；status `lost` | 已关闭 |
| 两者皆空或未知 | 已收到 |

## 7. Payload 入口封口与守卫

### 7.1 REST 封口

`src/domain/member/rest-fence.ts`：

```ts
export const BLOCKED_MEMBER_AUTH_PATHS = ['login', 'logout', 'refresh-token', 'me', 'first-register', 'forgot-password', 'reset-password', 'unlock', 'verify'] as const
export function isBlockedMemberAuthPath(segments: readonly string[]): boolean
// segments[0] === 'members' && BLOCKED_MEMBER_AUTH_PATHS.includes(segments[1])；'verify' 允许后面再跟一段 token
```

`src/app/(payload)/api/[...slug]/route.ts` 改为：先取 `params.slug`，命中则 `return new Response(null, { status: 404 })`，否则交给 Payload 的 `REST_*`。文件头的「自动生成」注释保留并追加说明为何要包一层。GET / POST / PATCH / PUT / DELETE / OPTIONS 六个方法都包。

### 7.2 access 矩阵（`domain/member/member-access.ts`）

| 操作 | 匿名 | `req.user` 是会员 | 员工无 `member:manage` | 员工持 `member:manage` |
| --- | --- | --- | --- | --- |
| read | ✗ | ✗ | ✗ | ✓ |
| create | ✗（钩子放行 `memberFlow`） | ✗ | ✗ | ✓ |
| update | ✗ | ✗ | ✗ | ✓ |
| delete | ✗ | ✗ | ✗ | ✗（会员不物理删，停用即可） |
| unlock | ✗ | ✗ | ✗ | ✓ |

`member-sms-codes`、`member-favorites` 四项全 ✗。所有服务端读写用 Local API `overrideAccess: true`。

### 7.3 钩子

- `beforeChange`（create）：`req.context.memberFlow` 缺失且操作者不是持 `member:manage` 的员工 → 抛 `ForbiddenError`。
- `beforeChange`（update）：`status` 从 `active` 变 `disabled` → `data.sessions = []`。
- `beforeLogin`：`req.context.memberFlow !== 'password'` → 抛错；`user.status !== 'active'` → 抛错。
- `afterRead`：手机号脱敏（§4.1）。

### 7.4 全后台守卫

`tests/member-never-req-user.test.ts`：遍历 `payload.config.ts` 的全部 collections 与 globals，对每个已定义的 access 函数（read / create / update / delete / unlock / readVersions）以 `req = { user: { id: 1, collection: 'members', status: 'active' }, payload: mock }` 调用，断言返回 `false`。两类例外：

- **公开读白名单**：`read: () => true` 的集合与 global 对匿名都开放，对会员自然也开放，只允许 `read` 进白名单，写操作照常必须为 `false`。现状里公开读的是 `media`、`pages`、`articles`、`locations`、`buildings`、`brokers`、`merchants`、`building-merchant-relations`、`display-tags`、`city-site-profiles`、`amenities`、`business-area-extensions` 与 global `site-settings`、`advisor-service-hours`，测试里把这份清单写死，新增公开读集合时测试必须红、必须有人决定。
- **缺省 access 不允许存在**：Payload 对缺省的 access 落到 `Boolean(req.user)`，会员会通过。四项写 access 已由 `tests/collection-write-access-coverage.test.ts` 保证存在；本测试补 `read`：任何 collection 缺 `access.read` 直接断言失败。2026-09-11 核对：已注册的全部 collection 都有显式 `read`（`src/collections/listing-publish-marks.ts` 不是集合，是字段标记辅助模块，不在此列）。

## 8. 前台页面与入口

### 8.1 顶栏与抽屉

- `layout.tsx`：`const member = await getCurrentMember()`，传给 `SiteHeader`（新增 `member: MemberDto | null` prop）并包一层 `<MemberProvider initialMember={member}>`。
- 桌面（≥ 1024）：`SiteNav` 的 `actions` 插槽在 `HeaderSearch` 之后渲染 `MemberMenu`。未登录：一个 `.btn .btn--ghost .btn--sm` 的「登录」链接（两个修饰类都已存在于 `styles.css`），高度与搜索框一致，指向 `/login?returnTo=<当前路径>`。已登录：触发器显示昵称首字或手机尾号四位，下拉四项：我的收藏 `/account/favorites`、我的咨询与委托 `/account/inquiries`、账号设置 `/account`、退出登录（POST `/api/member/logout` 后 `router.refresh()`）。下拉的开合、Esc、外点关闭、焦点归还照 `SiteNav` 抽屉的实现。
- 移动（< 1024）：顶栏不渲染 `MemberMenu`；抽屉最上方一块：未登录一行「登录 / 注册」链接；已登录显示脱敏手机号加同样四项。
- 断点常量复用 `SiteNav.tsx` 的 `DESKTOP_NAV_MIN_WIDTH`，CSS 侧与 `.site-nav` 同一条 `@media (min-width: 1024px)`。

### 8.2 页脚员工入口

`SiteFooter.tsx` 的 `.site-footer__bar-inner` 右侧追加 `<a href="/admin/login" rel="nofollow" className="site-footer__staff-link">员工入口</a>`，视觉与底栏其它文字同级。

### 8.3 页面

| 路由 | 类型 | 内容 |
| --- | --- | --- |
| `/login` | client 表单 + server 壳 | 两个 tab：「验证码登录」（手机号、验证码、60 秒倒计时发送按钮、隐私同意勾选）与「密码登录」（手机号、密码、「忘记密码」链到 `/login/reset`）；tab 下方「微信扫码登录」按钮（开关关时不渲染，由服务端把 `wechatEnabled` 传给客户端）；页底一行「员工请从员工入口登录」链到 `/admin/login`；已登录访问直接 302 到 `returnTo` 或 `/account` |
| `/login/reset` | 同上 | 手机号、验证码（用途 set-password）、新密码；成功后已登录并跳 `/account`。页面顶部说明「仅限已注册手机号；未注册请先用验证码登录」，未注册号码走完流程会得到 `CODE_INVALID`，文案不区分 |
| `/login/bind-phone` | 089 | 读不到 `sbh-wx-pending` 时 302 `/login`；表单：手机号、验证码（用途 bind-wechat）、首次注册时的隐私同意 |
| `/account` | server | 昵称编辑（`PATCH /api/member/profile` 体 `{ nickname }`）、设置或修改密码（复用 `/login/reset` 的表单组件，用途 set-password）、绑定或解绑微信（089）、退出 |
| `/account/favorites` | server | 收藏列表，房源用现有房源卡、楼盘用现有楼盘卡；不再有效供给的显示「已下架」标签并保留移除按钮 |
| `/account/inquiries` | server（090） | 进度列表，见 §6.7 |

所有登录与账户页 `robots: noindex`（`buildPageMetadata({ robots: 'noindex' })`）；`/account/*` 未登录 302 `/login?returnTo=`；`returnTo` 校验同 §6.6。

`PATCH /api/member/profile`：需登录，体 `{ nickname: string }`，≤ 30 字，去首尾空白，返回 `member`。

### 8.4 视觉与可访问性

- 只用 `(frontend)/styles.css` §1.1 的 token 与 `styles/surface.css` 基元；表单控件复用 `modal__input`、按钮复用 `.btn`；新增样式放 `styles/member.css`，在 `layout.tsx` 里排在 `recruit.css` 之后 import。
- 页面容器 `--w` 1180，表单卡最大宽 440，居中；section padding 沿用 `--pad`。
- 触达 ≥ 44px；焦点可见；错误文案就地显示在字段下方；验证码输入 `inputmode="numeric"` `autocomplete="one-time-code"`；手机号 `inputmode="tel"`。
- 尊重 `prefers-reduced-motion`；下拉出现用 `--ease-enter`。
- 走查断点 375 / 768 / 1440 / 1920。

### 8.5 多城市路由

`/login`、`/account` 是顶层静态路由，Next 优先于 `[city]` 动态段。页头在这些页面按默认城市渲染，`resolveTrustedCity` 返回 null 时的既有回落即可，不改城市解析。

## 9. 收藏同步细节

- `MemberProvider` 持有 `member`、`favorites`、`addFavorite`、`removeFavorite`、`isFavorite`。登录态下挂载时 `GET /api/member/favorites` 一次；增删乐观更新，失败回滚并用现有非阻断提示样式显示错误。
- `ShareSaveActions`：读 `useMember()`；有会员走 provider，无会员走今天的 localStorage 分支，代码路径清晰分开，不混写。
- 登录成功（短信 / 密码 / 微信绑定完成 / 微信直登回跳到页面后）由 `MemberProvider` 在**首次检测到「有会员且 localStorage 里有条目」**时调用 `merge`，成功后清空 localStorage 键。这样微信 302 回跳的场景也能覆盖，不依赖某个登录表单的成功回调。
- `/account/favorites` 服务端按会员查 `member-favorites`，逐条用 `getListingBySlug` / `getBuildingBySlug` 取 DTO；返回 null 的渲染「已下架」卡（`titleSnapshot` + 移除按钮）。

## 10. 后台形态

- 「会员」列表：列 `username`（脱敏）、`nickname`、`status`、`hasPassword`、`wechatBoundAt`、`lastLoginAt`、`createdAt`；默认每页 25。
- 详情页可改：`nickname`、`status`。`username` 只读；微信三字段只读；`sessions` 等隐藏。
- 停用会员：保存即清空 `sessions`，前台下一次请求失效。
- 不做后台「代会员登录」、不做后台改密码。

## 11. 环境变量与外部资质

| 变量 | 分期 | 说明 |
| --- | --- | --- |
| `SMS_PROVIDER` | 088 | `console` / `fixture` / `tencent` / `cloudmarket`。非生产缺省 `console`；生产缺省视为未配置，短信端点 503；生产取值 `console` / `fixture` → `assertProductionConfig` 抛错 |
| `TENCENT_SMS_SECRET_ID` `TENCENT_SMS_SECRET_KEY` `TENCENT_SMS_SDK_APP_ID` `TENCENT_SMS_SIGN_NAME` `TENCENT_SMS_TEMPLATE_ID` | 088 | `tencent` 时必填，缺任一项启动即报错 |
| `TENCENT_SMS_TEMPLATE_PARAMS` | 088 | 缺省 `{code},{minutes}` |
| `TENCENT_SMS_REGION` | 088 | 缺省 `ap-guangzhou` |
| `CLOUDMARKET_SMS_SECRET_ID` `CLOUDMARKET_SMS_SECRET_KEY` `CLOUDMARKET_SMS_TEMPLATE_ID` | 088 | `cloudmarket` 时必填。2026-09-11 用户裁定：腾讯云自营短信认证门槛高，改用云市场第三方短信（杭州华际云数「短信验证码」，产品 32818）。鉴权是云市场网关通用签名：`Authorization` 为 JSON `{id, x-date, signature}`，`signature = Base64(HMAC-SHA1(secretKey, "x-date: <GMT>"))`；请求体表单 `mobile` / `templateId` / `tag` |
| `CLOUDMARKET_SMS_TAG_PARAMS` | 088 | 缺省 `{code}`；多变量按模板顺序逗号分隔，发送时用竖线拼接 |
| `CLOUDMARKET_SMS_ENDPOINT` | 088 | 缺省产品页地址，服务商换地址时覆盖 |
| `WECHAT_LOGIN_ENABLED` | 089 | `true` 才渲染入口与启用端点；缺省 false |
| `WECHAT_APP_ID` `WECHAT_APP_SECRET` | 089 | 开关为 true 时必填。生产缺任一项 `assertProductionConfig` 抛错；非生产缺则启动 warn，三个微信端点返回 503 `SMS_UNAVAILABLE` 同款的 `WECHAT_UNAVAILABLE`，入口按钮仍按开关渲染 |

全部是**服务端运行时变量**，在 CloudBase 控制台配成服务级环境变量，CI 不传。`.env.example` 补齐并注明。

外部前置：微信开放平台网站应用的授权回调域名填生产域名 `sbh-286300-10-1253925058.sh.run.tcloudbase.com`（或届时绑定的正式域名）。隐私政策补会员条款（账号、收藏、微信绑定、注销联系方式），随 088 一起把 `PRIVACY_POLICY_VERSION` 升到下一版。

## 12. 测试策略

### 12.1 单测（vitest，`tests/`）

| 文件 | 覆盖 |
| --- | --- |
| `member-session.test.ts` | 签发 → 校验往返；sid 缺失 / 不在 sessions / 过期；collection 不符；停用；cookie 序列化属性 |
| `member-sms-code.test.ts` | 6 位生成、fixture 常量、HMAC 稳定、`timingSafeEqual` 比对、过期判定、attempts 上限、消费不可重用 |
| `member-sms-provider.test.ts` | 按环境选择；`tencent` 参数展开（模板占位）；缺凭据报错；生产拒绝 `console` / `fixture` |
| `member-rate-limits.test.ts` | 键格式、阈值、fail-closed 行为 |
| `member-rest-fence.test.ts` | 九个路径 404、`verify/<token>` 404、`members`（列表）与 `members/123` 不拦、`users/login` 不拦 |
| `member-access.test.ts` | §7.2 矩阵逐格；创建闸门；登录闸门；停用清 sessions |
| `member-never-req-user.test.ts` | §7.4 全后台守卫 |
| `member-dto.test.ts` | 快照断言不含敏感字段；脱敏格式 |
| `member-favorites.test.ts` | 合并去重、`savedAt` 保留、上限裁剪、类型守卫 |
| `member-routes.test.ts` | 路由层：非 JSON 415/400、跨站 403、错误码映射、短信端点恒 200、未登录 401 |
| `member-wechat-oauth.test.ts`（089） | 授权 URL、state 签名与篡改、returnTo 校验、code 换 token 的成功 / 失败分支（mock fetch）、identityKey 回落 openid |
| `member-status.test.ts`（090） | `toMemberFacingLeadStatus` 穷举 `LEAD_STAGES` 与旧 `status` 全部取值 |
| `frontend-shell-hydration.test.ts`、`city-switcher.test.ts`（既有） | 头部结构变化后更新断言 |

### 12.2 E2E（Playwright，CI；本地按 `.agent/testing.md` 的「CI 等价环境」跑）

`tests/e2e/member-auth.spec.ts`（088）：`SMS_PROVIDER=fixture`。用例：验证码登录首次注册（勾同意）→ 顶栏出现会员菜单 → 退出；未勾同意 400 文案；密码设置 → 密码登录 → 连错 5 次后正确密码也失败；未登录访问 `/account` 跳 `/login?returnTo=/account`；页脚「员工入口」`href="/admin/login"`；匿名 `POST /api/members/login` 与 `first-register` 均 404；收藏：未登录收藏两条 → 登录 → `/account/favorites` 出现两条。
`tests/e2e/member-inquiries.spec.ts`（090）：seed 一条该手机号的线索与一条投放申请 → 进度页出现两条且状态文案正确。
微信不做 E2E，真机验收。

### 12.3 浏览器走查（控制者做，证据进 `artifacts/verification/OPT-08x/`）

- 四断点截图：`/`（登录前后顶栏）、抽屉、`/login` 两 tab、`/account`、`/account/favorites`。
- 表单三重铁证：登录与设密码抓 Request Payload、响应 200、刷新后会员菜单仍在。
- 后台会员列表与详情：深浅色、脱敏、无 `phone:full` 的 OPS 看到 `138****1111`。
- 控制台无新增错误。

### 12.4 迁移

每条迁移 `pnpm migrate:dry-run` 输出、PG 上的 `\d` 结构证据、回滚说明（`down` 可逆：删表 / 删索引 / 撤销授权 / 删列）进 `artifacts/verification/`。

## 13. 分期与验收

### 13.1 OPT-088 会员基座（Task Packet：`OPT-088-member-auth-foundation.md`）

范围：§3 中标 088 的全部模块；§4.1–4.3、4.5；§5；§6.1–6.5；§7；§8 除微信与进度页；§9；§10；§11 的短信变量；§12 的 088 部分。

验收：

- [ ] 匿名 `POST /api/users`（OPT-087 已合入）与 `POST /api/members/*` 九个 auth 端点全部拒绝。
- [ ] 手机验证码登录、密码登录、退出、设密码全流程在浏览器走通，四断点无布局问题。
- [ ] 顶栏 / 抽屉 / 页脚三个入口各就各位；未登录与已登录两态。
- [ ] 收藏：本地 → 登录合并 → 服务端；退出后回到本地分支。
- [ ] 后台会员列表可见、脱敏正确、OPS 有权、BRK 无权（403）。
- [ ] `pnpm typecheck && pnpm lint && pnpm test`、`migrate:dry-run`、`build` 全绿；e2e 新增 spec 通过；既有 e2e 不红。
- [ ] `member-never-req-user.test.ts` 在仓库里且通过。

### 13.2 OPT-089 微信扫码（Task Packet：`OPT-089-member-wechat-login.md`）

范围：§6.6；`/login` 微信按钮与 `/login/bind-phone`；账户中心绑定 / 解绑；`config-guard` 开关校验；单测。

验收：

- [ ] 开关关：入口不渲染，三个端点 404。
- [ ] 开关开、mock 微信：首登绑手机 → 会员创建并绑定；二次扫码直登；已绑他人 409。
- [ ] 上线后用户真机扫码走通并记录到 `artifacts/verification/OPT-089/`。

### 13.3 OPT-090 咨询与委托进度（Task Packet：`OPT-090-member-inquiry-progress.md`）

范围：§4.4；§6.7；`/account/inquiries`；三个公开表单登录态预填手机号并只读；`member-status.test.ts`；e2e。

验收：

- [ ] 迁移回填影响行数与抽样核对写进证据。
- [ ] 进度页只展示 §6.7 允许的字段；线索的备注、跟进、报价快照、归属历史零出现（快照测试）。
- [ ] 登录前提交的咨询登录后可见。

## 14. 风险与取舍

| 风险 | 处置 |
| --- | --- |
| 短信费用被刷 | 三层限流 fail-closed；恒定 200 响应；生产必须 `tencent` |
| 验证码暴力猜测 | 6 位 + 5 次 + 5 分钟 + IP 限流，成功率 < 1e-5 |
| 手机号被冒用查看他人记录 | 只有短信验证过的手机号才能成为会员；进度页按会员手机号服务端过滤 |
| 微信 unionid 缺失 | 回落 openid 作身份键，文档说明绑定开放平台可提升跨应用一致性 |
| 会员 token 混进后台 | 独立 cookie 名 + 不注册策略 + 全后台守卫测试 + `me` 按 collection 隔离 |
| Payload 升级改变 auth 内部 | 只依赖顶层导出 `jwtSign` / `getFieldsToSign` 与公开的 `sessions` 字段形态；守卫测试会先红 |
| 多实例 | 会话在库、验证码在库、限流在 PG，无进程内状态 |
| 主键为手机号，换号 | 不支持换号；换号 = 新会员；后台可停用旧会员 |
| 自助注销缺失 | 隐私政策写明联系方式；后台停用 + 人工处理；后续工作项 |

## 15. 非目标

邮箱登录；自助注销；浏览记录同步；站内消息；业主自助发布；后台代登录；员工「忘记密码」邮件；换绑手机号；多语言。
