# MP-105 小程序集成验收与预发布计划

> 状态：执行中（005 已经一次性推广至 100%，独立结算、运行产物 build-info、受保护 attestation 与真实 staging 正常写入/幂等/精确清理均通过；禁止重放推广或自动执行补偿、回滚、recovery；真实 PostgreSQL 异常矩阵、开发者工具网络、图片/COS 与真机验收待执行）
> 创建日期：2026-08-27
> 分支：`feat/miniprogram-mvp-59f9`
> 上游：MP-101–104

## 1. 目标

在不触碰生产写入的前提下，为“首页 → 找房 → 房源详情 → 咨询”上海纵向闭环建立可重复的预发布验收。最终证据必须区分 Node 自动化、微信开发者工具、iOS、Android、服务端持久化和发布配置，任何未实际执行的项目都写明未执行。

## 2. 强制边界

1. trial 不得继续复用生产 API。没有独立预发布 HTTPS origin 时必须 fail-closed；不能猜域名，也不能静默回退 release。
2. 自动写入只允许在显式验收开关、非生产 HTTPS origin、受控 staging 数据库身份和可清理 fixture 同时成立时执行；任一条件缺失立即停止。
3. 用户已授权部署独立 staging、配置微信测试环境、执行隔离数据库写入与清理并生成体验版；仍禁止创建 PR、合并 master、正式发布或触碰生产环境及生产数据库。
4. staging 的 CloudBase 与微信开发者工具环境操作在已授权范围内连续执行；AppSecret、operator bootstrap、签名密钥、数据库连接串和 CI 私钥始终留在仓外受控环境，不进入仓库、日志或证据。
5. MP-106/107 在 MP-105 验收门通过前不开始，避免用后续功能掩盖当前闭环的环境缺口。

## 3. 当前已知环境事实

- Node 22.23.2 / pnpm 8.6.1 下，小程序全量 32 个文件、747/747，双 TypeScript 与 `project:check` 均通过；Web 全量 303 个文件通过、5 个既有跳过，4318 个用例通过、25 个既有跳过，build 通过，lint 0 错误（23 条既有 warning）。跨模块安全终审另行运行 13 个目标文件、561/561，P0/P1/P2 均为 0。
- develop 保持 `wx.request` → `http://127.0.0.1:3717`；trial 已切换为受控 staging env/service manifest → `wx.cloud.callContainer`；release 已切换为仓内固定 production env/service → `wx.cloud.callContainer`。仓内 trial manifest 空字段继续 fail-closed。
- staging 运行层已迁移到 CloudBase 环境 `sbhmini-gateway-d3fbrmn8097478b8` 的服务 `sbhmini`；当前稳定 revision 为 `sbhmini-005`（100% 流量，commit `8eab1a17cfe5800d1778fbad2d47cf4c54542d87`），003/004 均为 0%。数据库按已确认方案不迁移；旧环境与旧 `sbhmini-019` 只读核对无漂移，不再作为新运行层变更目标。
- 004 已承载恢复协议与数据库安全补丁完成一次候选部署、10% 灰度和受控回滚。2026-09-02 两轮独立只读快照先确认 005 创建正确且保持 0%；用户再次明确授权后，005 已通过单次推广写调用切至 100%，003/004 均为 0%，并由独立只读查询结算为 `PROMOTE_005_SETTLED`。005 的实际 `/api/health`、build-info、受保护 attestation 与真实正常写入/幂等/精确清理均已匹配 commit `8eab1a17cfe5800d1778fbad2d47cf4c54542d87` / revision `sbhmini-005`；真实 PostgreSQL 异常矩阵仍未完成。
- 微信开发者工具 Stable `1.06.2409140` 的旧诊断曾能编译并打开首页，但发生在 develop 的 `wx.request` 链路。004 期间已补充部分页面只读证据；真实 AppID 下 trial `callContainer` 的目标 revision、网络闭环、图片/COS、隐私与真机仍需在云端候选身份确认后留证。
- AppSecret、微信 CI 私钥、真实 AppID 本机配置、隐私后台配置和真机账号仍不得进入仓库；不得使用 production 目标代替尚未执行的小程序环境门。

## 4. 交付角色与依赖

| 角色 | 负责人 | 责任 | 预计投入 | 前置依赖 | 验收证据 |
|---|---|---|---:|---|---|
| 小程序实现 | Codex（高级模型实现、Sol 验收） | trial 配置、预检、开发者工具脚本 | 1.5–2 人日 | 独立 staging origin 与部署 revision | 测试日志、构建清单、DevTools 证据 |
| 服务端实现 | Codex（高级模型实现、Sol 验收） | attestation、写许可、fixture ownership/清理 | 2–3 人日 | staging 部署身份、隔离数据库 | API 合同测试、数据库指纹与清理计数 |
| 环境交付 | 项目环境管理员（待指定） | 部署目标 commit、配置微信后台、提供隔离数据库 | 0.5–1 人日 | 云环境与微信小程序管理员权限 | 部署 revision、配置变更前后与回滚记录 |
| 真机验收 | 产品/设计 + Codex 协助 | iOS、Android、隐私和可访问性 | 1 人日 | 可写 staging 门已通过、测试微信账号 | 脱敏截图、设备矩阵、问题清单 |
| 最终放行 | Sol + 项目负责人 | 复核证据、决定是否解锁 MP-106/107 | 0.5 人日 | 前述任务全部通过 | 无 P1/P2 的验收结论 |

当前 staging 环境已交付；005 推广的一次性预算已消费，独立结算确认 005=100%，实际 build-info、受保护 attestation 与正常写验收已经完成。任何新增云端写、异常注入、补偿、回滚或 recovery 仍必须暂停，需按剩余任务另行确认安全条件与授权。开发者工具、真机、图片/COS、隐私和异常矩阵证据齐备前不能声明 MP-105 完成。

## 5. 工作拆解

### Task 1：trial fail-closed

**文件**

- Modify: `sbh-miniprogram/miniprogram/config/environment.ts`
- Modify/Test: `sbh-miniprogram/tests/environment.test.ts`

- [x] 先写失败测试，证明 trial 不使用 production CloudBase 目标、不回退 release，并在 staging env/service manifest 缺失或非法时稳定 fail-closed。
- [x] develop 继续只允许本机 HTTP 或 HTTPS；release 固定仓内 production env/service；trial 的 cloud env/service 必须精确匹配受控 staging，资源名、Git commit SHA 或 deployment revision 非法时在选择传输前拒绝。
- [x] 增加仓内 fail-closed 的 trial deployment manifest 与生成/校验脚本：上传或预览前由受控环境注入非秘密的 staging env/service、目标 Git commit SHA 与期望服务端 deployment revision；字段缺失、工作树不干净或 revision 不符时拒绝生成。当前空 manifest 保持不可运行状态。
- [x] `getCurrentRuntimeEnvironment()` 只能读取已生成并校验的 manifest，不接受页面参数、Storage、远端下发或静默回退；生成物不得包含 Secret、token 或数据库连接串。
- [x] develop 只走 `wx.request`，trial/release 只走 `wx.cloud.callContainer`；cloud env 只初始化一次、service header 由受控环境覆盖、禁止跟随 3xx，业务请求合同在两类传输下保持一致。
- [x] 小程序全量、双 TypeScript 与工程检查通过；前序 `callContainer` 定向矩阵 123/123，当前 Mini 全量 32 个文件、747/747，三条质量门均 exit 0。

### Task 2：预发布验收预检与证据清单

**建议文件**

- Create: `sbh-miniprogram/scripts/staging-acceptance-preflight.mjs`
- Test: `sbh-miniprogram/tests/staging-acceptance-preflight.test.ts`
- Create: `artifacts/verification/MP-105/README.md`

- [x] 本地结构预检只接受显式 `MP_E2E_ALLOW_STAGING_WRITE=1`、非生产 HTTPS API origin、期望 deployment revision、唯一 run UUID 和专用 fixture namespace；拒绝 release origin、localhost、IP、凭据型 URL、query/hash/path。fixture namespace 由 run UUID 派生；输出明确 `writeAuthorized=false`，不自称证明数据库隔离。
- [x] 在任何写入前先只读调用服务端 attestation：返回 staging deployment Git SHA、实际 revision、脱敏数据库指纹和 acceptance 能力；服务端对实际数据库探针计算 HMAC 指纹并命中允许名单，生产环境、生产数据库、别名绕过或信息缺失一律拒绝。本地 mock 合同已通过，后续真实 staging runner 也已核对 attestation；该服务端证据不替代小程序环境验收。
- [x] 日志只输出布尔检查项和脱敏 host，不输出 AppSecret、签名密钥、token、手机号或数据库连接串。
- [x] 未满足环境时返回非零且不发网络请求，不生成“通过”证据；Sol 复核 Task 1/2 定向 70/70、Mini 471/471，无 P1/P2。

### Task 3a：服务端只读 attestation

- [x] 新增只读 attestation 合同。服务端同时要求 acceptance 开关开启、`deploymentEnvironment=staging`、部署 Git SHA/revision 非空、两类高熵 secret 职责分离、数据库 HMAC 指纹命中 staging 允许名单；生产环境或生产数据库 fail-closed。
- [x] 数据库身份来自固定只读 SQL 的实际 `current_database()/inet_server_addr()/inet_server_port()`，不信任客户端或 `DATABASE_URL` 自声明；响应只暴露 opaque HMAC 指纹，不暴露原始数据库身份。
- [x] operator bootstrap 在认证前进行长度与 constant-time 摘要比较；缺失、错误、disabled 或 production 同形 404 且不初始化 Payload。认证后探针失败或 allowlist miss 统一 503、不泄密。
- [x] 本地纯函数/路由 mock 合同 15/15、Web typecheck 与相关 lint 通过，Sol 复核无 P1/P2；本阶段交付时真实 staging 探针仍属外部环境门，后续 runner 已完成实际探针，见 MP-105 证据索引。

### Task 3b-1：run-scoped 写许可签发与验证

- [x] attestation 通过后，只有经过 operator authentication 的验收操作者才能每次换取一个 10 分钟、run/SHA/revision/数据库指纹绑定的许可；公开客户端和匿名微信 session 不能自行领取。bootstrap 凭据由受控环境注入，可按验收轮次轮换，不进入小程序包、query、Storage、日志或证据。
- [x] permit 使用独立高熵签名 secret，与 attestation/operator secret 两两不同；严格验证签名、payload 键集合、purpose、时间、jti 与全部上下文，篡改、过期、未来签发、多段解析或跨上下文均拒绝。
- [x] acceptance 开关关闭或 deployment environment 非 staging 时不能签发许可；本阶段未修改普通咨询入口，也未接入 fixture 写分支，因此生产咨询合同保持不变。
- [x] 签发端使用单条 PostgreSQL 查询从同一连接同时读取 `current_database()/inet_server_addr()/inet_server_port()` 与 `clock_timestamp()`；先计算并核对数据库指纹，再以该数据库时间签发许可，避免连接池切换造成“在 A 库验明、按 B 库时间签发”。
- [x] 纯函数和路由合同覆盖认证前零数据库、production/disabled 拒绝、错误 SHA/revision/数据库指纹、许可过期/篡改/跨有效 run，以及响应脱敏；Task 3a/3b-1 定向 68/68、typecheck 与相关 lint 通过，Sol 两轮复核后 APPROVE。本阶段结论仅来自 mock/合同层；后续真实 staging runner 的独立执行结果另见 MP-105 证据索引。

### Task 3b-2：许可接入咨询写入口

- [x] 服务端只从仓外专用 header 接收 permit；验签内容内含活动 run UUID、fixture namespace、SHA/revision 与数据库指纹。通过当前配置复核后，再用实际只读数据库探针精确匹配，任一步失败都在询盘业务读写前拒绝。
- [x] Acceptance 写使用独立幂等域并绑定 `runId + submissionRequestId + listingSlug`，同 run 重试稳定、跨 run 与普通 Mini 询盘均隔离；成功响应返回可重算的 `leadLocator`，但不把它表述为本轮 ownership 证明。
- [x] 不带 acceptance header 的普通咨询路径保持既有响应与调用顺序，不读取 acceptance 配置、验签或探针；production/disabled 即使收到伪造 header 也同形 404、零 Payload。
- [x] Task 3b-2 定向 105/105、typecheck 与相关 lint 通过；Sol 首轮发现跨 run 幂等错归属后退回，修复为 run-domain-separated key 并复验 APPROVE。本阶段仍为 mock/合同层；后续真实 staging 的写入、重试和清理结果另见 MP-105 证据索引。
- [x] 自动 runner 已实现，operator/bootstrap/permit 只进入受控 runner 当前进程内存，不落 bundle、query、Storage、日志或截图；真机包仍不持有这些凭据，没有安全注入通道前真机只读走查。
- [x] acceptance writer 与 inspect/recover/cleanup 在同一 Payload transaction session 内先取得 locator advisory xact lock，再用同一 executor 单次读取数据库身份与 PostgreSQL 时间并复验 permit/allowlist，最后才允许 Lead 读写；lock busy 路径不读取身份/时钟且业务读写为零。
- [x] Leads 启用回收站后，fixture 的 initial/final Lead 查询与物理删除全部显式 `trash:true`；fresh inspect 不会把仍含 PII 的 trashed Lead 误报为 `0/0/0`。该项无需数据库迁移。

### Task 4：开发者工具只读闭环

> 代码传输层与 Node 验证已完成，本机私有配置已使用真实 AppID，体验版能力已开通；2026-09-03 已在 Node 22.23.2 下完成 DevTools 自动化全场景验收，首页/列表/详情 ready、下拉刷新、404、空态、坏图兜底、四种成本（含面议）及 30 条性能指标均通过并留存截图与 JSON 报告。真机 `callContainer` 真实网络链路归入 Task 6。

- [x] 本地关闭合法域名校验只允许用于 develop 调试，且不能计入合法域名验收证据。若需变更本地安全设置，按操作当下取得确认；仓内配置保持 `urlCheck: true`。
- [x] 使用开发者工具依次通过首页、真实首条列表、详情 ready；记录 commit SHA/dirty 状态、编译错误、网络错误、包体/分包、基础库版本和性能面板（30 条渲染流水线指标）。
- [x] 验证加载、空、错误、刷新、404、坏图、四种成本（含面议）和相关推荐；不调用预览、上传或咨询写入。
- [x] 把模拟器截图、命令结果和未通过原因写入 `artifacts/verification/MP-105/`；2026-09-03 续验记录 8 张状态截图、30 条性能数据与完整报告 `task4-acceptance-report.json`。


### Task 5：隔离预发布咨询写闭环

> fixture ownership 与精确清理的已选方案、接口合同和测试顺序见
> `specs/work-items/MP-105a-acceptance-fixture-ownership-plan.md`。实现采用受保护的 staging
> 核验/清理接口与 runner 本地恢复胶囊；不修改 Lead 业务模型，不允许 runner 直连数据库。

> 状态边界：005 已经一次性推广至 100%，独立结算、实际 build-info、受保护 attestation 与当前协议的正常写入/幂等/精确清理均已通过；真实计数为 `0/0/0 → 1/0/0 → 1/0/0 → 0/0/0`，`writeOutcomeUnknown=false`，清理后无胶囊或锁残留且未执行 recovery。以下复选框按证据范围分别记录，不能用该正常路径结果替代异常/中断矩阵或微信详情页 UI 闭环。

- [x] 真实 runner 只在 Task 2/3 attestation 与本轮 10 分钟写许可通过后写入；已核对目标 commit/revision、非生产 origin、数据库指纹 allowlist、唯一 run UUID 和三类计数均为 0 的干净起点。
- [x] 历史正常路径中唯一创建的 Lead 曾进入 runner ownership manifest；当前实现已升级为本地恢复胶囊，记录固定 run identity、不可变 Lead ID/locator 摘要、writer receipt 和持久阶段。清理仍使用服务端复算 locator + 编码后的实际 Lead ID 双匹配，未按宽泛前缀或时间范围删除。
- [x] 服务端 runner 已直接调用咨询 API 完成首次写入与同一 submission 重提。runner exit 0 的严格解析要求首次 `acceptedExisting=false`、重提 `acceptedExisting=true`；数据库计数保持 `1 → 1`，Lead ID 不变，follow-up 和 ownership history 均为 0。
- [ ] 尚未在微信开发者工具从房源详情页手填测试手机号并重提；因此不能把上述服务端 runner 结果表述为详情页 UI 闭环通过。
- [ ] 真实 staging 尚未覆盖房源降级楼盘、通用需求、限流、session 过期、弱网响应丢失和服务端稳定错误的完整矩阵。已有受信代理 503、隐私版本 422 的写前 fail-closed 记录，以及本地合同测试，但不能外推其余环境路径。
- [x] runner 在任何网络前原子创建单活动恢复胶囊，按 `prepared → first_write_dispatched → first_write_observed → idempotency_verified → cleanup_dispatched → cleanup_confirmed` 持久化阶段推进；任何结果未知、状态落盘失败或中断都保留胶囊，不把单次 HTTP 成功当作终态。
- [x] write permit 只消费一次并携带独立 HMAC recovery receipt；普通 runner 只在幂等性已持久确认后调度清理。独立 recovery CLI 不调用 `/inquiries`，只在旧 writer receipt 按 PostgreSQL 时间到期后领取 recovery permit，并以新请求、新 inspect permit、同 locator 锁确认 `0/0/0` 后才删除胶囊。
- [x] 本地合同覆盖 SIGKILL 后跨进程恢复、SIGINT/SIGTERM、late signal、lease release 失败、commit outcome unknown、busy、清理失败和敏感能力不泄漏；跨模块安全终审 561/561，P0/P1/P2 均为 0。
- [ ] 尚未在当前代码对应的 005 真实 staging revision 主动验证 writer/recovery advisory-lock 竞争、commit outcome unknown 后 fresh inspect、trashed Lead 异常矩阵、主动 cleanup 失败、SIGKILL/断连与迟到请求；这些异常路径当前只有本地合同证据，不记为真实环境通过。

已完成范围：fixture 严格请求/typed Lead ID codec、同事务数据库身份与时间屏障、覆盖回收站的物理清理、恢复胶囊、显式 runner/recovery CLI、本地合同，以及 005 当前 revision 的 build-info、attestation 和真实正常写入/幂等/精确清理。异常矩阵与 Task 4/6–8 仍未完成，MP-105 整体状态保持执行中。

### Task 6：iOS/Android 与隐私验收

- [ ] 真机写路径必须复用 Task 2/3 已验证的同一 staging deployment、隔离数据库、活动 run UUID、写许可和 ownership manifest；不满足时只允许只读走查。
- [ ] iOS、Android 各至少一台真机覆盖手机号同意/拒绝、手工输入、隐私指引打开、重复提交、离线恢复和 token 过期。
- [ ] 分别记录小屏/大屏、键盘顶起、安全区、背景滚动锁定、VoiceOver/TalkBack 弹层关闭后的焦点恢复。
- [ ] 授权欠费、微信 errcode 和 access token 失效继续用可注入 gateway 稳定验证；不在真实账号制造欠费。
- [ ] 真机与自动写验收结束后统一执行 Task 5 的精确清理与残留查询；截图不得包含完整手机号、openid、token、submissionRequestId 或 Lead ID。

### Task 7：预览、回滚与发布前证据

- [x] 新增 staging 专用部署包生成器：只从已提交的 Git 快照打包，校验非生产环境 ID 与独立 HTTPS origin，定向替换包内 Dockerfile 的 build/runtime origin，并注入 `build-info.json`；生产 Dockerfile 保持不变。定向测试与生产部署配置回归 32/32 通过。
- [x] 004 已从冻结 commit `3b88f08` 使用独立一次性工具完成候选部署、10% 灰度和一次受控 `go_back`；三份预算均已消费，结算证据分别为候选完成、`TRAFFIC_004_SETTLED` 与 `ROLLBACK_004_SETTLED`，当前 003=100%，旧环境/019 未变。
- [x] 005 候选工具的一次性预算 marker 已于 2026-09-02 11:03:21 +08:00 创建但没有原始结算报告；marker 因复用 004 helper 而错误记录 004 version/commit。2026-09-02 14:45–14:46 的两轮独立只读对账已确认 005 正确创建、环境 commit/revision 精确匹配且保持 0% 流量。
- [x] 用户再次明确授权后，MP-105M 仅执行一次推广写调用；独立只读结算确认 `PROMOTE_005_SETTLED`、005=100%、003/004=0%。随后 MP-105N 验证 build-info、受保护 attestation，以及正常写入/幂等/精确清理计数 `0/0/0 → 1/0/0 → 1/0/0 → 0/0/0`；`writeOutcomeUnknown=false`，无胶囊残留，未执行 recovery。推广 marker 保持不变，禁止删除、补偿、自动重试、再次推广或回滚。
- [ ] 核对真实 AppID 与 trial staging CloudBase 环境关联、图片/COS 来源及 `downloadFile` 要求、服务端 AppSecret/签名密钥、可信代理层数、隐私政策版本和微信后台声明。`callContainer` 解决 Mini API 的 request 服务器域名链路，不代表图片域名或隐私已通过。微信后台配置与部署由环境管理员执行，记录精确目标、变更前后和回滚；Secret/私钥由用户写入受控环境，证据只记录“已配置/未配置”，不收集其值。
- [ ] staging 体验版与预览授权已取得；仅在目标候选 revision 经独立只读对账、身份与读/写闭环门通过后执行，二维码和 CI 私钥均在仓外，结果不得视为正式上传或发布。
- [ ] 记录回滚到上一个已知良好提交、服务端变量回滚和停止 Mini 写入口的步骤；不实际部署生产。

### Task 8：证据完整性与脱敏

- [ ] 每次证据记录 Git commit SHA、dirty 状态、部署 revision、脱敏 API host/数据库指纹、run UUID 摘要、命令退出码、设备/系统/微信/基础库版本和清理前后计数；不可用项明确写“未执行”。
- [ ] 验证脚本与证据一同提交；报告不能覆盖脚本的失败状态，也不能把 develop 关闭域名校验当成 staging 合法域名通过。
- [ ] 对文本、JSON、截图文件名和可 OCR 内容执行自动敏感信息扫描；发现手机号、openid、token、Secret、数据库连接串、完整 submission/Lead ID 时拒绝归档。

## 6. 验收门

MP-105 只有在以下全部成立时才能标记完成：

1. trial 使用受控 staging env/service manifest，经真实 AppID 与 CloudBase 关联后通过 `wx.cloud.callContainer` 访问目标 revision，且不会访问 production 写接口。
2. 开发者工具、iOS、Android 的上海纵向闭环均有真实证据。
3. 服务端 attestation 证明目标 revision 与数据库指纹均属受控 staging，run-scoped 写许可无法在生产或其它 run 使用。
4. 隔离数据库证明同一 submission ID 只产生一个 Lead，ownership manifest 中所有 fixture 清理无残留。
5. 图片/COS 与微信后台要求、隐私、秘密、可信代理、包体、性能和回滚清单均完成，证据通过敏感信息扫描。
6. Node/Web 回归保持通过，Sol 最终复核无 P1/P2。

在上述环境门未齐备前，允许把“代码传输层、预检工具与 Node 验证完成”提交到功能分支，但状态必须保持“待 AppID/staging 关联、开发者工具、图片/COS、隐私与真机验收”，不得开始 MP-106/107 的实现、集成或合并；只读的需求讨论、设计与合同草案不受此限制。

## 7. 进展回写（更新至 2026-09-02）

- 2026-09-01：004 完成一次性受控部署并灰度 10%（MP-105J：`ReleaseGray` 单次写、预算已消耗、只读结算 `TRAFFIC_004_SETTLED`；当时 003=90/004=10，旧 019 不变）。
- Task 4 部分通过：首页/找房/详情 ready、空态、404、错误态、相关推荐、3 种成本、缺图兜底。2026-09-02 清理失控的 Node 24 本地服务与旧 automation 后，用 Node 22.23.2 重启 3717；精确 XPath 修复先红后绿，tooling 58/58、小程序全量 747/747，Stable bundle 36.6.0 的 develop 首页/找房/详情 smoke exit 0。证据见 `artifacts/verification/MP-105/task4-devtools-read-only.md`。未执行：trial revision/完整网络、下拉刷新、坏图、第 4 种成本、性能面板、真机。
- 集成缺陷修复：mini DTO `availableFrom` 改为上海自然日 date-only（mappers 两处），TDD 43/43 + typecheck 干净；未提交，等待用户授权。
- 本地安全设置：`urlCheck=false` 仅 develop 调试（已确认），不计入合法域名验收证据。
- 2026-09-02：修复 commit `8eab1a1` 已提交并推送；MP-105K 回滚工具单次 `go_back` 已执行并 `ROLLBACK_004_SETTLED`，staging 恢复 003=100%，灰度订单关闭，019 不变。
- 2026-09-02：发现 MP-105L 的 005 一次性 marker 已消费但无结算报告，且 marker 内容因复用 004 helper 被错误绑定到 004 version/commit。已用 TDD 修正本地 helper 身份注入和 MP-105M 测试夹具；纯本地验证 004=26/26、005 候选=10/10、005 推广=17/17，真实 marker 校验和未变化。随后两轮独立云端只读快照确认 005 已正确创建、状态 `normal`、环境 commit/revision 精确匹配、0% 流量，release `2542417` open、task `2054487` running；禁止重放或自动推广。详见 `artifacts/verification/MP-105/mp105l-005-marker-audit.md` 与 `artifacts/verification/MP-105/mp105l-005-read-only-reconciliation.md`。
- 2026-09-02：用户再次明确授权后，MP-105M 单次推广并独立结算为 `PROMOTE_005_SETTLED`，005=100%、003/004=0%；MP-105N 的新鲜只读预检、build-info、受保护 attestation、真实正常写入、同 submission 幂等重提与精确清理均通过，计数为 `0/0/0 → 1/0/0 → 1/0/0 → 0/0/0`，`writeOutcomeUnknown=false`。清理后无恢复胶囊或锁残留，因此未运行 recovery。详见 `artifacts/verification/MP-105/mp105m-005-promote-settlement.md` 与 `artifacts/verification/MP-105/mp105n-staging-acceptance.md`。
- 2026-09-02：在不写 CloudBase 的前提下补充受控 staging 直接 HTTPS 只读探针：健康、首页、列表、有效详情、404 均收到预期 HTTP 响应；`/api/health.version` 匹配 commit `8eab1a17cfe5800d1778fbad2d47cf4c54542d87`。该结果仅补充服务端 HTTPS 可达性与接口合同/端到端耗时，不等于 `wx.cloud.callContainer`、实际 revision 命中或 DevTools 性能面板证据。
- 下一步确认门：正常路径与 develop 页面 smoke 已完成；writer/recovery 竞争、commit outcome unknown、主动 cleanup 失败、SIGKILL/断连/迟到请求、trashed Lead 异常矩阵，以及 DevTools trial revision/完整网络/性能、图片/COS、隐私、真机、预览/上传等仍需分别取得条件与授权后执行。当前 trial manifest 仍为空，因工作树不干净不能生成真实 manifest；不得删除或改写 marker，不得重放 MP-105L/MP-105M，也不得自动执行补偿、回滚或 recovery。
- 2026-09-02：在隔离验收副本 `/Users/liujiayuan/App/wt-mp-trial` 生成并保留真实 trial manifest（绑定 `sbhmini-gateway-d3fbrmn8097478b8/sbhmini/sbhmini-005` 与 commit `8eab1a17cfe5800d1778fbad2d47cf4c54542d87`），Node 22 安全默认态回归 747/747，真实 manifest 副本双 TypeScript 与 `project:check` 通过。真实 AppID DevTools 运行时读取 `envVersion=develop`，未进入 trial，故未产生 `wx.cloud.callContainer`、revision 或性能面板证据；未 mock、未预览、未上传、未部署、未咨询写入。Task 4 的 trial 门继续阻断，结构化记录见 `artifacts/verification/MP-105/task4-devtools-env-diagnostic.json`。

- 2026-09-03：用户提供体验版版本号 `0.0.1.202411041554`、二维码和体验成员截图。二维码只读解码得到 AppID `wx5eeb7f9e3a092204` 与 path `pages/home/home.html`，AppID 与本机私有配置匹配；版本时间戳为 2024-11-04，早于目标 commit 2026-09-02，故尚不能认定该体验包就是当前 `sbhmini-005` 目标包。详见 `artifacts/verification/MP-105/task4-experience-entry-diagnostic.json`。
- 2026-09-03：开发者工具登录态已确认 `login=true`；真实 AppID 启动本地工程后的运行时仍为 `envVersion=develop`（基础库 `3.17.2`，DevTools `8.0.5`），因此登录成功不等于体验版已加载，trial `callContainer`/revision/性能证据仍未取得。
- 2026-09-03：排查并修复 `<listing-card>` 自定义组件类名前缀隔离导致的 XPath 漏选问题（改用 `//*[contains(@class, "listing-card") and @data-slug]`）；小程序单测 32 文件 776/776 全过；随后通过 `task4-acceptance-runner.mjs` 在 DevTools 跑通全场景自动化验收，覆盖首页、找房、下拉刷新、详情、第4种成本（面议）、空态、404、坏图兜底，留存 8 张截图并采集 30 条核心渲染性能指标（`task4-acceptance-report.json`）。Task 4 本地 DevTools 自动化验收全部闭环并通过。
