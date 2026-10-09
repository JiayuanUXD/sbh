# MP-104 小程序房源详情与咨询闭环实施计划

> 状态：Node 侧代码完成，待预发布与微信环境验收
> 创建日期：2026-08-27
> 分支：`feat/miniprogram-mvp-59f9`
> 上游：MP-101 详情 DTO、MP-102 小程序工程、MP-103 首页/列表闭环

## 1. 目标

匿名用户可以从房源列表进入真实房源详情，优先理解月租估算、物业费和预计月度占用成本；点击“咨询顾问”后只填写期望入驻时间与手机号，在同意隐私政策后完成一次幂等咨询。微信手机号授权失败、拒绝或额度不足时，必须能改用手工手机号，不阻断咨询。

## 2. 已确认决策

1. 详情页采用原生微信小程序页面，用户可见顺序锁定为：画廊 → 标题/位置/核验时间 → 月租主价格与单位报价 → 月度成本拆项 → 核心规格 → 其他事实 → 所在楼盘 → 相关推荐。WXML 合同测试必须锁定该顺序，避免成本信息被长详情下压。
2. 固定底栏首版只保留“分享 + 咨询顾问”；这是对设计稿“收藏 + 分享 + 预约看房”的显式裁决：收藏归 MP-107，当前没有排期、顾问分配和通知闭环，因此不提供预约死按钮。分享使用原生分享能力，路径只含当前 slug，不带手机号、匿名 token、submissionRequestId 或筛选隐私数据。
3. 留资弹层只问手机号与期望入驻时间；房源、面积、单位报价和月租估算从详情上下文预填，不要求姓名、公司或长留言。
4. 手机号有两条等价路径：
   - 微信授权：`button open-type="getPhoneNumber"` 取得一次性动态 `code`，传服务端换手机号；
   - 手工输入：中国大陆手机号校验。两种入口从弹层打开起同时可见；拒绝、接口失败或配额不足时自动切到手填、保留入驻时间与隐私选择、聚焦手机号输入且不再自动索权。
5. `wx.login` 只在用户打开咨询时按需调用。服务端用 `code2Session` 校验后返回 15 分钟“匿名上下文 bearer token”，不是账户登录 session。token 只含 HMAC 化的匿名主体、随机 `jti`、固定 `iss/aud/purpose/version/alg` 与时间声明，不含 openid、session_key、手机号或角色。
6. 匿名上下文 token 不用于授权、手机号归属证明、幂等键、读取个人数据或提高/绕过限流；同一有效 token 在有效期内可重放，仍受完整限流。MVP 不新增用户/会话 Collection，不能承诺逐 token 撤销；签名密钥轮换只提供“一次性撤销全部 token”。如未来需要单次使用、逐 token 撤销或跨实例封禁，另立持久化工作项。
7. 新版手机号动态 code 按微信官方规则独立消费，不与 `wx.login` code 混用，也不要求先登录。匿名 token 获取失败时，微信手机号和手工手机号两条路径仍可提交。
8. 不放宽现有 Web `/api/inquiries` 的同源/CSRF 守卫。抽取共享“有效供给复核 + 幂等 + Lead 创建”领域服务，Web 与 Mini 路由分别保留自己的传输、身份和防滥用适配。
9. Mini Lead 继续写 `source='frontend-form'`，固定写入 `utm_source=wechat-mini-program`、`utm_medium=mini-program`；可信城市为 `shanghai`，`sourcePath/sourceUrl` 由服务端用当前 slug 与可信站点 origin 生成。不新增数据库字段，不接受客户端伪造来源、城市、页面类型、URL 或活动归因。
10. 隐私政策使用微信原生 `wx.openPrivacyContract` 打开《小程序用户隐私保护指引》，不引入 `web-view` 或业务域名。详情 DTO 只下发可信政策版本；平台指引无法打开时不得勾选或提交，表单内容保留并可重试。
11. 不修改 Collection/Global，不生成数据库迁移；如果实施中发现必须新增持久化字段，立即停止该部分并另立迁移工作项。
12. Web 幂等算法保持现状：`requestId + normalizedPhone + targetType + targetSlug`。Mini 使用服务端专属 `mini-v1 + submissionRequestId + submittedTargetType + submittedTargetSlug`，不含手机号；submission ID 代表一次表单意图而不是某个号码。服务端在消费 phoneCode 前即可查已成功结果，并用现有 `Leads.idempotencyKey` 唯一约束解决同 ID 的并发授权/手填竞争，不需要迁移。该 key 只能由可信 Mini adapter 计算，客户端不能直接提交。

## 3. 安全与外部配置

服务端只从环境读取以下秘密，不进入仓库、小程序包、响应、日志或截图：

- `WECHAT_MINIPROGRAM_APP_ID`
- `WECHAT_MINIPROGRAM_APP_SECRET`
- `MINI_SESSION_SIGNING_SECRET`

`MINI_SESSION_SIGNING_SECRET` 至少 32 字节随机熵，不能以 `NEXT_PUBLIC_*` 暴露。Mini 路由采用局部 fail-closed 配置，不把缺少微信配置升级为阻断现有 Web 容器启动的全局守卫；缺配置时 session/微信手机号返回稳定服务不可用，手工手机号咨询仍可运行。

微信访问令牌使用稳定版 access token 普通模式，仅在服务端内存按过期时间提前刷新并做进程内 Promise 去重；多实例不假装共享缓存。只有明确的 token 失效错误允许清缓存、强制刷新并重试一次，手机号 code 错误不得自动重试。手机号动态 code 与登录 code 都是一次性短期凭证，日志只记录稳定错误码、脱敏手机号、HTTP 关联 requestId、是否幂等和目标降级结果。

ID 分工：请求体使用高熵 `submissionRequestId` 参与 Mini 业务幂等；响应 `meta.requestId` / `X-Request-Id` 是每次 HTTP 调用的关联 ID，二者不得混用。弹层打开时创建 submission ID；关闭/取消、成功、换房源或页面卸载后重建。同一表单内授权/手填切换与号码修改都保留 ID，服务端以 submission ID + 提交时目标原子去重。手机号授权 code 每次提交尝试后立即废弃；模糊失败必须由新用户手势取得新 code，或切到手填路径。

## 4. 工作拆解

### Task 1：详情 DTO 运行时契约与客户端目录服务

**文件**

- Modify: `sbh-miniprogram/miniprogram/services/catalog-contracts.ts`
- Modify: `sbh-miniprogram/miniprogram/services/catalog.ts`
- Test: `sbh-miniprogram/tests/catalog-contracts.test.ts`
- Test: `sbh-miniprogram/tests/catalog-service.test.ts`

- [x] 先写失败测试：合法详情、月度成本四种包含状态、画廊、事实分组、核验时间、相关推荐和隐私版本；畸形金额、非法日期、跨房源 slug 或空政策版本必须拒绝且不泄露原响应。
- [x] 实现 `parseMiniListingDetailData(value)`；所有金额有限且非负，`total` 只能由 API 提供，不在客户端计算。
- [x] 实现 `getListingDetail(slug)`，slug 先按既有安全段规则收口，最终只请求 `/api/mini/v1/listings/<encoded>?city=shanghai`。
- [x] 运行定向契约/服务测试并确认通过。

### Task 2：详情展示模型与组件

**文件**

- Create: `sbh-miniprogram/miniprogram/domain/listing-detail-presentation.ts`
- Create: `sbh-miniprogram/miniprogram/components/detail-gallery/*`
- Create: `sbh-miniprogram/miniprogram/components/monthly-cost-card/*`
- Create: `sbh-miniprogram/miniprogram/components/spec-grid/*`
- Test: `sbh-miniprogram/tests/listing-detail-presentation.test.ts`
- Test: `sbh-miniprogram/tests/detail-components.test.ts`

- [x] 先写失败测试：月租/物业费/合计的“—”降级、包含时不重复加总、不包含但信息不全时不伪造合计、四列网格缺值不塌格、长中文值、系统字体放大、Android 窄屏不溢出、核验日期和图片失败。
- [x] 展示模型只格式化 API 值；主价格为月租估算，单位报价为次信息；`assumptions` 原样作为计算条件说明。
- [x] 画廊使用原生 `swiper`，声明宽高比、页码和图片失败占位；不自动轮播。
- [x] 组件触控目标 ≥44px，卡圆角 8px、图片/输入 6px、标签 3px，数字等宽。

### Task 3：房源详情页面状态机与路由

**文件**

- Create: `sbh-miniprogram/miniprogram/pages/listing-detail/controller.ts`
- Create: `sbh-miniprogram/miniprogram/pages/listing-detail/index.{ts,json,wxml,wxss}`
- Modify: `sbh-miniprogram/miniprogram/app.json`
- Modify: `sbh-miniprogram/miniprogram/services/listing-navigation.ts`
- Modify: `sbh-miniprogram/miniprogram/pages/home/index.ts`
- Modify: `sbh-miniprogram/miniprogram/pages/listings/index.ts`
- Modify: `sbh-miniprogram/scripts/check-project.mjs`
- Test: `sbh-miniprogram/tests/listing-detail-controller.test.ts`
- Test: `sbh-miniprogram/tests/listing-detail-page-contract.test.ts`
- Test: `sbh-miniprogram/tests/listing-navigation.test.ts`
- Modify/Test: `sbh-miniprogram/tests/home-page-contract.test.ts`
- Modify/Test: `sbh-miniprogram/tests/listings-page-contract.test.ts`
- Modify/Test: `sbh-miniprogram/tests/project-contract.test.ts`
- Modify/Test: `sbh-miniprogram/tests/tooling-scripts.test.ts`

- [x] 先写失败测试：`loading/ready/refreshing/stale/error/not-found`、旧响应不能覆盖新 slug、刷新失败保留旧数据、404 给“查看其他房源”出口、相关推荐导航，以及 WXML 中锁定的用户可见内容顺序。
- [x] 页面状态合同如下；每个状态都有可自动观察的 `data-page-state`，只有 ready/stale 出现 `#listing-detail-ready`：

| 状态 | 内容 | 底栏/咨询 | 出口 |
|---|---|---|---|
| loading | 首屏骨架，不展示旧价格 | 隐藏 | 无 |
| ready | 完整可信详情 | 可用 | 分享、咨询、相关推荐 |
| refreshing | 保留当前详情并显示刷新状态 | 可用，防重复打开 | 等待/取消刷新 |
| stale | “刷新失败，以下为上次核验数据” + 旧详情 | CTA 改为“咨询当前状态”，提交仍由服务端复核有效供给 | 重试刷新、咨询当前状态 |
| error | 不展示价格/详情 | 隐藏 | 重试、返回找房 |
| not-found | 明确房源失效/不存在，不展示旧价格 | 隐藏 | 返回找房、加载普通推荐；不冒充与失效房源相似 |

- [x] 固定底栏为“分享 + 咨询顾问”，高度含安全区；正文底部 padding 覆盖 56px + 安全区。
- [x] `listing-navigation` 增加严格 slug 验证的真实详情导航；首页和列表页移除 MP-103 的“详情即将开放”预留提示，统一调用该服务并对导航失败给非阻断反馈。
- [x] 工程合同同步注册详情页四件套和 ready/stale 就绪标记，保证路由加入后项目检查立即保持绿色；Task 9 再扩展真实房源冒烟与完整状态 marker 验收。

### Task 4：共享咨询落库领域服务

**文件**

- Create: `payload-office-platform/src/domain/inquiry/public-service.ts`
- Create: `payload-office-platform/src/domain/mini-program/inquiry-idempotency.ts`
- Modify: `payload-office-platform/src/domain/inquiry/idempotency.ts`
- Modify: `payload-office-platform/src/domain/inquiry/index.ts`
- Modify: `payload-office-platform/src/app/api/inquiries/route.ts`
- Test: `payload-office-platform/tests/inquiry-public-service.test.ts`
- Test: `payload-office-platform/tests/mini-inquiry-idempotency.test.ts`
- Modify/Test: `payload-office-platform/tests/inquiry-api-route.test.ts`

- [x] 用既有 Web 路由行为写服务失败测试：城市可信解析、幂等命中/并发唯一冲突、房源失效降级、楼盘归属防伪、价格快照、隐私版本、脱敏日志和 Lead 字段。本任务不新增 Customer 或 30 天 CRM 查重语义。
- [x] 抽出精确合同 `findExistingInquiryResult(trustedIdempotencyKey, deps) -> existing | null` 与 `submitPublicInquiry(canonicalCommand, deps) -> { idempotent, targetResolution }`。两者属于同一领域 service，均不依赖 `Request`、`NextResponse`、微信 gateway 或 Authorization；前者只按可信 key 只读预查，后者仍再次预查并拥有可信城市复核、唯一冲突回读、有效 listing/building 与归属复核及 Lead 创建，避免预查到写入之间的 TOCTOU。客户端 body 绝不能直接提供最终 idempotencyKey。
- [x] Web adapter 继续调用现有 `computeIdempotencyKey(requestId, phone, targetType, targetSlug)`；Mini adapter 新增 `computeMiniInquiryIdempotencyKey(submissionRequestId, submittedTargetType, submittedTargetSlug)`，输入带固定 `mini-v1` 域分隔并输出同格式 hash。两条算法分别做固定向量和互不碰撞测试。
- [x] Web/Mini 计算函数返回统一编译期品牌 key，领域服务在读写边界仍强制校验小写 64 位 hex；可信城市由私有运行时 capability 产生并验证，结构化请求体不能伪造城市关系 ID 或最终 key。
- [x] 幂等命中继续在供给复核之前返回首次成功语义；Web 特有 viewing preference 先由 Web route 验证，再作为已验证可选值传入。Web route 仍拥有同源、Content-Type、16KB、IP 限流、JSON/schema、HTTP 状态与响应映射。
- [x] Web 路由响应、状态码、日志事件和既有测试保持不变；不得让 Mini 适配器绕过 `assertEffectiveListing`。

### Task 5：微信登录、手机号与短期 session 领域适配

**文件**

- Create: `payload-office-platform/src/domain/mini-program/session.ts`
- Create: `payload-office-platform/src/lib/mini-program/wechat-gateway.ts`
- Create: `payload-office-platform/src/lib/mini-program/runtime-config.ts`
- Modify: `payload-office-platform/.env.example`
- Test: `payload-office-platform/tests/mini-api-session-domain.test.ts`
- Test: `payload-office-platform/tests/mini-api-wechat-gateway.test.ts`

- [x] 先写失败测试：配置缺失/格式错误/签名密钥熵不足、上游非 2xx/畸形 JSON/微信 errcode、访问令牌提前过期缓存与并发去重、token 篡改/过期/算法混淆/超长有效期，以及模拟异常对象含 secret/openid/session_key/完整手机号时所有 logger 参数序列化后仍不含这些值。
- [x] Gateway 只暴露 `exchangeLoginCode(loginCode)` 与 `exchangePhoneCode(phoneCode)` 两个独立函数和请求类型，禁止通用 `exchangeCode(kind, code)` 或共享 code cache。加负向测试：loginCode 永不进入手机号 API，phoneCode 永不进入 code2Session，失败不回退尝试另一端点。
- [x] `code2Session` 只接受 1–128 字符 `loginCode`；返回值只在服务端转成 HMAC 匿名主体，原始 openid/session_key 随请求结束丢弃。
- [x] 匿名上下文 token 使用固定 `iss/aud/purpose/version/alg`、`iat/exp` 和 15 分钟最大跨度；验证使用常量时间比较。测试证明有效 token 可重放，但不能绕过同一限流。
- [x] 手机号 `phoneCode` 只传给 `phonenumber.getPhoneNumber`，可选绑定可信 openid 的能力不在 MVP；只接受中国大陆手机号并统一规范化。code 复用只验证微信上游拒绝和稳定错误映射，不在本机用内存 Map 冒充跨实例已消费记录。
- [x] access token 使用稳定版普通模式；只有明确 token 失效错误可刷新并重试一次，任意手机号 code 错误均不重试。

### Task 6：Mini session 与咨询 API

**文件**

- Create: `payload-office-platform/src/domain/mini-program/inquiry-schema.ts`
- Modify: `payload-office-platform/src/domain/mini-program/inquiry-idempotency.ts`
- Create: `payload-office-platform/src/app/api/mini/v1/session/route.ts`
- Create: `payload-office-platform/src/app/api/mini/v1/inquiries/route.ts`
- Modify: `payload-office-platform/src/domain/mini-program/contracts.ts`
- Modify: `payload-office-platform/src/domain/mini-program/mappers.ts`
- Modify: `payload-office-platform/src/domain/mini-program/response.ts`
- Modify: `payload-office-platform/src/lib/mini-program/catalog-service.ts`
- Modify: `payload-office-platform/src/lib/rate-limit-config.ts`
- Create: `payload-office-platform/src/app/api/mini/v1/rate-limit-state.ts`
- Test: `payload-office-platform/tests/mini-api-session-route.test.ts`
- Test: `payload-office-platform/tests/mini-api-inquiry-route.test.ts`

- [x] Session 白名单只接受 `loginCode`；Mini inquiry 白名单只接受 `submissionRequestId/listingSlug/buildingSlug?/moveInTime?/phoneCode?/phone?/consent/priceSnapshot?`，未知字段严格拒绝；手机号授权 code 与手工 phone 必须二选一。
- [x] 详情 DTO 增加只读 `inquiryPolicy.version`，由服务端可信配置注入；客户端不得硬编码政策版本。
- [x] route 固定城市 `shanghai`、来源 `/listings/<slug>`、页面类型 `listing`、区块 `mobile-bar`、`source='frontend-form'` 和 Mini UTM；`sourceUrl` 由可信站点 origin 生成，姓名由服务端生成为“微信用户 + 手机尾号”，客户端不能覆盖。
- [x] 可选 Bearer token 若出现则在消费手机号 code 前验证；无 token 时授权手机号和手填手机号均可提交。invalid/expired token 返回稳定 `session_invalid`，不静默忽略伪造身份，也不消费 phoneCode。
- [x] 固定顺序为：限流 → JSON/body/schema/consent → 可选 bearer 验证 → 按 submissionRequestId + 提交时目标计算 Mini key 并调用 `findExistingInquiryResult` → miss 后才消费 phoneCode → `submitPublicInquiry` 再次预查并尝试写入。已有 key + 无效 bearer 必须返回 `session_invalid` 且不消费 phoneCode；已有 key + 有效或未携带 bearer 才返回首次成功语义且不消费 phoneCode。
- [x] 两个预查同时 miss、同 submission ID/目标的并发请求即使携带不同号码，也由现有 `Leads.idempotencyKey` 唯一约束只落一条；唯一冲突回读返回数据库中先成功的 targetResolution。code 已消费但 Lead 尚未建立时返回可重新授权/改手填的稳定错误，不能伪称提交成功。
- [x] POST 保持单次尝试；响应只返回 `accepted/acceptedExisting/targetResolution` 与每次 HTTP 的 `meta.requestId`，其中 `acceptedExisting` 是非敏感布尔值，表示本次返回首次成功结果且当前重输号码未被采用；不返回 submissionRequestId、Lead ID、手机号、openid 或内部错误。新受理成功文案按 listing/building/general 分支，降级后不得暗示仍绑定原房源。
- [x] Mini session 与 inquiry 使用现有分布式表但键前缀分别为 `mini-session:`、`mini-inquiry:`，配置和 prune ref 独立于 Web；测试同 IP 交替调用三者时额度不串用。限流在 code2Session/getPhoneNumber/Payload 前执行，存储故障 fail-closed。客户端 IP 只从显式受信代理链解析，不无条件信任任意首个 `X-Forwarded-For`。
- [x] Mini 路由独立执行 JSON Content-Type、16KB、no-store 与稳定错误映射；不复制 Web 同源校验，也不调用 Web HTTP 路由。

> Task 6 实施例外（不新建数据库连接池）：Mini 限流复用 Payload 已初始化的共享 PG pool，因此真实顺序为“服务端受信代理配置/链校验 → `getPayload` 单例初始化（仅取 pool）→ 分布式限流 → 任何 Payload 业务查询/写入与微信调用”。`MINI_TRUSTED_PROXY_HOPS` 必须按 CloudBase 实际反代层数配置；缺失、非 1..5 整数、代理链过短或节点非法 IP 均 fail-closed 503。

### Task 7：小程序 session、写请求协议与咨询服务

**文件**

- Modify: `sbh-miniprogram/miniprogram/services/mini-api-contracts.ts`
- Modify: `sbh-miniprogram/miniprogram/services/request.ts`
- Create: `sbh-miniprogram/miniprogram/services/session.ts`
- Create: `sbh-miniprogram/miniprogram/services/inquiry.ts`
- Test: `sbh-miniprogram/tests/request.test.ts`
- Test: `sbh-miniprogram/tests/session-service.test.ts`
- Test: `sbh-miniprogram/tests/inquiry-service.test.ts`

- [x] 先写失败测试：GET 仍要求 `asOf/maxAgeSeconds=300`；POST 成功只要求 write meta requestId；POST 永不自动重试；Authorization 只能由受限 anonymousContextToken 选项生成，不能注入任意头。响应 meta requestId 不得覆盖表单 submissionRequestId。
- [x] 匿名上下文 token 只保存在模块内存，按 `expiresAt` 提前失效；不写本地持久存储。打开咨询时最多并发一个 `wx.login` 请求，失败不阻断两种手机号路径。
- [x] submissionRequestId 使用高熵生成器并代表一次表单意图：弹层打开创建；可恢复失败、授权/手填切换和号码修改都保留；关闭/取消、成功、更换目标、换房源或页面卸载后重建。响应丢失后用新 phoneCode + 原 submission ID，或手填 + 原 submission ID 重试。
- [x] 请求层和咨询服务均不暗中重试 POST。`session_invalid` 时清 token并提示用户重新提交；服务端保证该错误在 phoneCode 消费前返回，但客户端仍废弃旧 code，授权路径需新用户手势，手填路径保留已输入号码。
- [x] 每次授权提交尝试无论成功、业务失败、网络失败或超时都立即清除本地 phoneCode；同一个 code 不进入第二次 POST。
- [x] 服务层不读取中文错误文案做分支，只按稳定错误码与 `acceptedExisting` 映射 UI 状态；解析器必须要求该标志为布尔值，不能从 HTTP 重试或文案推断。

### Task 8：留资半屏弹层与详情集成

**文件**

- Create: `sbh-miniprogram/miniprogram/components/inquiry-sheet/*`
- Modify: `sbh-miniprogram/miniprogram/pages/listing-detail/index.{ts,json,wxml,wxss}`
- Test: `sbh-miniprogram/tests/inquiry-sheet.test.ts`
- Modify/Test: `sbh-miniprogram/tests/listing-detail-controller.test.ts`

- [x] 先写失败组件/状态测试：上下文摘要、两入口默认同时可见、手机号授权成功、拒绝/失败/欠费转手工输入、隐私未勾选/政策无法打开、重复点击、提交失败可重试、三种 targetResolution 成功结果、`acceptedExisting` 首次联系方式提示、关闭重开 submissionRequestId 生命周期。
- [x] 实现明确状态机：`closed → preparing → choosing-phone | manual → authorizing → submitting → success | recoverable-error`；`session-invalid/rate-limited/phone-code-consumed` 是可恢复错误原因。每条转移测试保留或清除入驻时间、手机号、隐私勾选和 submission ID 的精确规则。
- [x] 弹层先展示房源名、面积、单位报价、月租估算摘要；表单只显示期望入驻、手机号和隐私同意。“微信手机号快捷填写”与“手动填写”从初始态同时可见。
- [x] 微信手机号按钮必须由用户手势直接触发；授权事件 code 与 `wx.login` code 分开命名和传输。
- [x] 隐私文案、详情 DTO policyVersion、提交版本三者完全一致；点击政策调用 `wx.openPrivacyContract`。打开失败时禁用勾选/提交并提供重试，已有表单状态不丢失。
- [x] 提交中禁用所有提交入口，且 `authorizing/submitting` 阶段关闭按钮、遮罩和 controller 均不能中断不可取消 POST；`preparing` 仍可安全退出。新受理成功后按目标解析显示：房源仍有效时“已收到该房源咨询”，降级楼盘时“已转为该楼盘需求”，通用需求时“已收到找房需求”。`acceptedExisting=true` 时优先显示“已按首次提交的联系方式受理；如需更换号码，请关闭后重新发起”，后续联系文案也只指向首次联系方式；关闭后生成新 submission ID。所有结果只承诺顾问后续联系，不承诺时效。
- [ ] 弹层安全区、键盘顶起、滚动锁定、44px 触达、错误 live region 和关闭焦点/触发点恢复进入模拟器验收矩阵。
- [ ] 弹层打开时详情底栏和背景不可交互；关闭后页面交互已由状态恢复。微信公开 `button` 能力没有可靠的程序化焦点接口，因此不保留伪造的 focus token；触发点的 VoiceOver/TalkBack 实际焦点恢复列入 iOS/Android 真机验收。

### Task 9：工程合同、回归与验收证据

**文件**

- Modify: `sbh-miniprogram/scripts/check-project.mjs`
- Modify: `sbh-miniprogram/scripts/devtools-smoke.mjs`
- Modify: `sbh-miniprogram/tests/project-contract.test.ts`
- Modify: `sbh-miniprogram/tests/tooling-scripts.test.ts`
- Modify: `sbh-miniprogram/README.md`
- Modify: `payload-office-platform/.env.example`
- Modify: `payload-office-platform/README.md`
- Modify: `specs/work-items/MP-002-miniprogram-delivery-roadmap.md`
- Create: `artifacts/verification/MP-104/README.md`

- [x] 工程检查注册详情页四件套和所有页面状态 marker；普通冒烟从列表页面层读取真实首条 `data-listing-slug`，再进入详情，不硬编码测试房源；slug 查询、属性读取、路由与 ready 均有超时和运行时异常清理合同。
- [ ] 另建隔离预发布 fixture 矩阵覆盖四种成本、坏图、失效和相关推荐；fixture 脚本先断言干净起点，测试后清理并自查。自动写闭环仅在显式预发布开关、非生产 API origin 和隔离测试库同时满足时运行：详情 → 手填手机号 → 同 submissionRequestId 重提 → 首次成功语义 → 数据库只有一个 Lead。严禁向生产写入。
- [x] 小程序完整测试、双 TypeScript、工程检查通过；全量依赖审计仍按 MP-103 工具链阻断单独报告，不伪装为本任务引入。
- [x] Web 完整 typecheck/test/build；Web `/api/inquiries` 定向回归必须全绿。
- [ ] 微信开发者工具与 iOS、Android 各至少一台真机分别走：详情首屏、图片失败、成本四态、失效房源、微信手机号同意/拒绝、手工手机号、隐私拒绝、重复提交、弱网、匿名 token 过期和三种成功结果；分别记录安全区、键盘、授权弹窗和背景滚动锁定。
- [ ] 欠费、微信 errcode、token 过期和访问令牌失效用可注入 gateway/时钟稳定验证，不要求在真实账号制造欠费。授权同意/拒绝必须在真实设备验证。
- [ ] request 合法域名、图片 downloadFile 域名、服务端 AppID/AppSecret/签名配置、微信《小程序用户隐私保护指引》配置和真机 `wx.openPrivacyContract` 打开结果逐项留证；本方案不使用 web-view，因此不新增业务域名。没有真实证据的项写未执行。

## 5. 验收门

MP-104 只有在以下全部成立时才能标记完成：

1. 详情页正常、加载、刷新失败、404/失效、图片失败和相关推荐出口均可复核。
2. 月度成本不在客户端推算；包含/不包含/待确认/缺失四态与 API 一致。
3. 微信手机号授权不是唯一入口；拒绝或失败后手工手机号可完成咨询。
4. 同一 submissionRequestId + 提交时目标至多建立一条 Lead；覆盖首次响应丢失后以新 phoneCode 或手填号码重试、不同号码并发竞争、phoneCode 转手填、号码修改与数据库唯一冲突，以上场景均保留原 submission ID 并返回 `acceptedExisting=true` 的首次成功语义，UI 明示采用首次联系方式。
5. 失效房源不建立兴趣关系，最多降级为可信楼盘或通用需求。
6. Web 同源/CSRF、限流、schema、日志和响应没有因 Mini 接入而放宽。
7. 响应、日志、分析和证据不出现 AppSecret、访问令牌、session_key、openid、完整手机号或 Lead ID。
8. 模拟器与 iOS、Android 各至少一台真机完成咨询闭环；未具备微信环境时只能标记“代码完成，待微信环境验收”。

## 6. 非目标

- 收藏、咨询记录、用户中心和跨设备账户
- 预约看房排期、顾问分配和通知
- 地图、楼盘闭环、在线聊天或顾问 IM
- 上传/部署/提审、生产数据库写入或正式微信配置变更
- 为匿名上下文 token 新增 Collection、Global 或数据库表
