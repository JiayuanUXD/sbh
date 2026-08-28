# MP-105 小程序集成验收与预发布计划

> 状态：执行中（安全收口与本地证据）；独立预发布环境、微信账号与真机验收待外部条件
> 创建日期：2026-08-27
> 分支：`feat/miniprogram-mvp-59f9`
> 上游：MP-101–104

## 1. 目标

在不触碰生产写入的前提下，为“首页 → 找房 → 房源详情 → 咨询”上海纵向闭环建立可重复的预发布验收。最终证据必须区分 Node 自动化、微信开发者工具、iOS、Android、服务端持久化和发布配置，任何未实际执行的项目都写明未执行。

## 2. 强制边界

1. trial 不得继续复用生产 API。没有独立预发布 HTTPS origin 时必须 fail-closed；不能猜域名，也不能静默回退 release。
2. 自动写入只允许在显式验收开关、非生产 HTTPS origin、隔离测试数据库和可清理 fixture 同时成立时执行；任一条件缺失立即停止。
3. 本工作项不部署、不正式上传、不创建 PR、不合并 master、不执行生产数据库写入。
4. 关闭微信合法域名校验、开启网络/安全入口、录入 AppID/Secret 或 CI 私钥属于环境操作，按操作当下的用户确认执行；仓库不保存秘密。
5. MP-106/107 在 MP-105 验收门通过前不开始，避免用后续功能掩盖当前闭环的环境缺口。

## 3. 当前已知环境事实

- Node 22.23.2 下，小程序当前 29 个文件、521/521，双 TypeScript 和工程检查通过；Web 当前 306 个文件中 301 通过、5 个既有跳过，4200 个用例通过、25 个既有跳过，build 通过，lint 0 错误（23 条既有 warning）。
- 微信开发者工具 Stable `1.06.2409140` 能编译并打开首页；工具服务端口当前显示开启。
- develop 使用 `http://127.0.0.1:3717`，被微信 request 合法域名校验拒绝，真实冒烟无法到达 `#home-ready`。
- 独立预发布 API origin、隔离数据库、测试 AppID/Secret、隐私配置和真机账号尚未提供；不得使用生产域名替代。

## 4. 交付角色与依赖

| 角色 | 负责人 | 责任 | 预计投入 | 前置依赖 | 验收证据 |
|---|---|---|---:|---|---|
| 小程序实现 | Codex（高级模型实现、Sol 验收） | trial 配置、预检、开发者工具脚本 | 1.5–2 人日 | 独立 staging origin 与部署 revision | 测试日志、构建清单、DevTools 证据 |
| 服务端实现 | Codex（高级模型实现、Sol 验收） | attestation、写许可、fixture ownership/清理 | 2–3 人日 | staging 部署身份、隔离数据库 | API 合同测试、数据库指纹与清理计数 |
| 环境交付 | 项目环境管理员（待指定） | 部署目标 commit、配置微信后台、提供隔离数据库 | 0.5–1 人日 | 云环境与微信小程序管理员权限 | 部署 revision、配置变更前后与回滚记录 |
| 真机验收 | 产品/设计 + Codex 协助 | iOS、Android、隐私和可访问性 | 1 人日 | 可写 staging 门已通过、测试微信账号 | 脱敏截图、设备矩阵、问题清单 |
| 最终放行 | Sol + 项目负责人 | 复核证据、决定是否解锁 MP-106/107 | 0.5 人日 | 前述任务全部通过 | 无 P1/P2 的验收结论 |

环境管理员未指定、独立环境未交付时，代码可以推进到 fail-closed 和本地合同测试，但不能执行写验收或声明 MP-105 完成。

## 5. 工作拆解

### Task 1：trial fail-closed

**文件**

- Modify: `sbh-miniprogram/miniprogram/config/environment.ts`
- Modify/Test: `sbh-miniprogram/tests/environment.test.ts`

- [x] 先写失败测试，证明 trial 不返回生产 origin、不回退 release，并给出稳定的“独立预发布 API 未配置”错误。
- [x] develop 继续只允许本机 HTTP 或 HTTPS；release 继续只接受非本机 HTTPS；staging origin 必须用标准 URL 规范化并拒绝生产 origin/host 的大小写、默认端口与数字 IP 等价形式，以及 localhost、IPv4/IPv6 和其缩写/整数表示。
- [x] 增加仓内 fail-closed 的 trial deployment manifest 与生成/校验脚本：上传或预览前由受控环境注入非秘密的 staging origin、目标 Git commit SHA 与期望服务端 deployment revision；字段缺失、工作树不干净或 revision 不符时拒绝生成。当前无环境值时 manifest 保持不可运行状态。
- [x] `getCurrentRuntimeEnvironment()` 只能读取已生成并校验的 manifest，不接受页面参数、Storage、远端下发或静默回退；生成物不得包含 Secret、token 或数据库连接串。
- [x] 小程序全量、双 TypeScript 与工程检查通过；Sol 最终复核无 P1/P2（Task 1 定向 41/41，Mini 442/442）。

### Task 2：预发布验收预检与证据清单

**建议文件**

- Create: `sbh-miniprogram/scripts/staging-acceptance-preflight.mjs`
- Test: `sbh-miniprogram/tests/staging-acceptance-preflight.test.ts`
- Create: `artifacts/verification/MP-105/README.md`

- [x] 本地结构预检只接受显式 `MP_E2E_ALLOW_STAGING_WRITE=1`、非生产 HTTPS API origin、期望 deployment revision、唯一 run UUID 和专用 fixture namespace；拒绝 release origin、localhost、IP、凭据型 URL、query/hash/path。fixture namespace 由 run UUID 派生；输出明确 `writeAuthorized=false`，不自称证明数据库隔离。
- [x] 在任何写入前先只读调用服务端 attestation：返回 staging deployment Git SHA、实际 revision、脱敏数据库指纹和 acceptance 能力；服务端对实际数据库探针计算 HMAC 指纹并命中允许名单，生产环境、生产数据库、别名绕过或信息缺失一律拒绝。本地 mock 合同已通过，真实环境调用仍未执行。
- [x] 日志只输出布尔检查项和脱敏 host，不输出 AppSecret、签名密钥、token、手机号或数据库连接串。
- [x] 未满足环境时返回非零且不发网络请求，不生成“通过”证据；Sol 复核 Task 1/2 定向 70/70、Mini 471/471，无 P1/P2。

### Task 3a：服务端只读 attestation

- [x] 新增只读 attestation 合同。服务端同时要求 acceptance 开关开启、`deploymentEnvironment=staging`、部署 Git SHA/revision 非空、两类高熵 secret 职责分离、数据库 HMAC 指纹命中 staging 允许名单；生产环境或生产数据库 fail-closed。
- [x] 数据库身份来自固定只读 SQL 的实际 `current_database()/inet_server_addr()/inet_server_port()`，不信任客户端或 `DATABASE_URL` 自声明；响应只暴露 opaque HMAC 指纹，不暴露原始数据库身份。
- [x] operator bootstrap 在认证前进行长度与 constant-time 摘要比较；缺失、错误、disabled 或 production 同形 404 且不初始化 Payload。认证后探针失败或 allowlist miss 统一 503、不泄密。
- [x] 本地纯函数/路由 mock 合同 15/15、Web typecheck 与相关 lint 通过，Sol 复核无 P1/P2；真实 staging 探针仍属外部环境门。

### Task 3b-1：run-scoped 写许可签发与验证

- [x] attestation 通过后，只有经过 operator authentication 的验收操作者才能每次换取一个 10 分钟、run/SHA/revision/数据库指纹绑定的许可；公开客户端和匿名微信 session 不能自行领取。bootstrap 凭据由受控环境注入，可按验收轮次轮换，不进入小程序包、query、Storage、日志或证据。
- [x] permit 使用独立高熵签名 secret，与 attestation/operator secret 两两不同；严格验证签名、payload 键集合、purpose、时间、jti 与全部上下文，篡改、过期、未来签发、多段解析或跨上下文均拒绝。
- [x] acceptance 开关关闭或 deployment environment 非 staging 时不能签发许可；本阶段未修改普通咨询入口，也未接入 fixture 写分支，因此生产咨询合同保持不变。
- [x] 纯函数和路由合同覆盖认证前零数据库、production/disabled 拒绝、错误 SHA/revision/数据库指纹、许可过期/篡改/跨有效 run，以及响应脱敏；Task 3a/3b-1 定向 68/68、typecheck 与相关 lint 通过，Sol 两轮复核后 APPROVE。全部为 mock/合同层，不连接真实数据库，也不代表真实 staging 写验收。

### Task 3b-2：许可接入咨询写入口

- [x] 服务端只从仓外专用 header 接收 permit；验签内容内含活动 run UUID、fixture namespace、SHA/revision 与数据库指纹。通过当前配置复核后，再用实际只读数据库探针精确匹配，任一步失败都在询盘业务读写前拒绝。
- [x] Acceptance 写使用独立幂等域并绑定 `runId + submissionRequestId + listingSlug`，同 run 重试稳定、跨 run 与普通 Mini 询盘均隔离；成功响应返回可重算的 `leadLocator`，但不把它表述为本轮 ownership 证明。
- [x] 不带 acceptance header 的普通咨询路径保持既有响应与调用顺序，不读取 acceptance 配置、验签或探针；production/disabled 即使收到伪造 header 也同形 404、零 Payload。
- [x] Task 3b-2 定向 105/105、typecheck 与相关 lint 通过；Sol 首轮发现跨 run 幂等错归属后退回，修复为 run-domain-separated key 并复验 APPROVE。当前仍为 mock/合同层，未连接真实数据库。
- [x] 自动 runner 已实现，operator/bootstrap/permit 只进入受控 runner 当前进程内存，不落 bundle、query、Storage、日志或截图；真机包仍不持有这些凭据，没有安全注入通道前真机只读走查。

### Task 4：开发者工具只读闭环

- [ ] 本地关闭合法域名校验只允许用于 develop 调试，且不能计入合法域名验收证据。若需变更本地安全设置，按操作当下取得确认。
- [ ] 使用开发者工具依次通过首页、真实首条列表、详情 ready；记录 commit SHA/dirty 状态、编译错误、网络错误、包体/分包、基础库版本和性能面板。
- [ ] 验证加载、空、错误、刷新、404、坏图、四种成本和相关推荐；不调用预览、上传或咨询写入。
- [ ] 把模拟器截图、命令结果和未通过原因写入 `artifacts/verification/MP-105/`。

### Task 5：隔离预发布咨询写闭环

> fixture ownership 与精确清理的已选方案、接口合同和测试顺序见
> `specs/work-items/MP-105a-acceptance-fixture-ownership-plan.md`。实现采用受保护的 staging
> 核验/清理接口与 runner 内存 manifest；不修改 Lead 业务模型，不允许 runner 直连数据库。

- [ ] 只在 Task 2/3 attestation 与本轮写许可全部通过后写入；先证明目标 commit/revision、origin 非生产、数据库指纹在 staging 允许名单、run UUID 唯一且 ownership manifest 起点干净。
- [ ] 每个创建对象进入精确 ownership manifest（对象类型 + 不可变 ID + run UUID），禁止按宽泛前缀或时间范围删除；任何未记录的创建都使验收失败。
- [ ] 走详情 → 手填测试手机号 → 同 submissionRequestId 重提；验证首次成功语义、第二次 `acceptedExisting=true`、数据库只有一个 Lead。
- [ ] 覆盖房源有效、降级楼盘、通用需求、限流、session 过期、弱网响应丢失和服务端稳定错误；测试号码和日志必须脱敏。
- [ ] runner 必须用 `try/finally` 覆盖正常、失败和部分创建，处理 SIGINT/SIGTERM 后执行幂等重清理；分别查询 Lead、关系数据及所有 ownership 对象的清理前后计数。清理失败立即冻结本轮写入并禁止继续验收。

本地代码进度：fixture 严格请求/typed Lead ID codec、受保护的 staging 核验/精确清理接口和显式 runner 已完成 mock 合同；接口在 permit、部署身份和实际数据库探针通过前保持不可见，清理只按服务端复算 locator + 编码后的实际 Lead ID 双匹配，并在删除前后复查 Lead、跟进和归属历史。runner 使用进程内 manifest、同 submission 幂等对账、`try/finally` 与 SIGINT/SIGTERM 单例清理；结果未知时不会宣称 clean。真实 staging 执行仍未完成，因此上述验收项继续保持未勾选。

### Task 6：iOS/Android 与隐私验收

- [ ] 真机写路径必须复用 Task 2/3 已验证的同一 staging deployment、隔离数据库、活动 run UUID、写许可和 ownership manifest；不满足时只允许只读走查。
- [ ] iOS、Android 各至少一台真机覆盖手机号同意/拒绝、手工输入、隐私指引打开、重复提交、离线恢复和 token 过期。
- [ ] 分别记录小屏/大屏、键盘顶起、安全区、背景滚动锁定、VoiceOver/TalkBack 弹层关闭后的焦点恢复。
- [ ] 授权欠费、微信 errcode 和 access token 失效继续用可注入 gateway 稳定验证；不在真实账号制造欠费。
- [ ] 真机与自动写验收结束后统一执行 Task 5 的精确清理与残留查询；截图不得包含完整手机号、openid、token、submissionRequestId 或 Lead ID。

### Task 7：预览、回滚与发布前证据

- [ ] 核对 request/downloadFile 合法域名、AppID、服务端 AppSecret/签名密钥、可信代理层数、隐私政策版本和微信后台声明。微信后台配置与部署由环境管理员执行，记录精确目标、变更前后和回滚；Secret/私钥由用户写入受控环境，证据只记录“已配置/未配置”，不收集其值。
- [ ] 只有获得明确上传/预览授权后才运行 `pnpm ci:preview`；二维码和 CI 私钥均在仓外，结果不得视为正式上传。
- [ ] 记录回滚到上一个已知良好提交、服务端变量回滚和停止 Mini 写入口的步骤；不实际部署生产。

### Task 8：证据完整性与脱敏

- [ ] 每次证据记录 Git commit SHA、dirty 状态、部署 revision、脱敏 API host/数据库指纹、run UUID 摘要、命令退出码、设备/系统/微信/基础库版本和清理前后计数；不可用项明确写“未执行”。
- [ ] 验证脚本与证据一同提交；报告不能覆盖脚本的失败状态，也不能把 develop 关闭域名校验当成 staging 合法域名通过。
- [ ] 对文本、JSON、截图文件名和可 OCR 内容执行自动敏感信息扫描；发现手机号、openid、token、Secret、数据库连接串、完整 submission/Lead ID 时拒绝归档。

## 6. 验收门

MP-105 只有在以下全部成立时才能标记完成：

1. trial 使用独立预发布 HTTPS origin，且不会访问生产写接口。
2. 开发者工具、iOS、Android 的上海纵向闭环均有真实证据。
3. 服务端 attestation 证明目标 revision 与数据库指纹均属受控 staging，run-scoped 写许可无法在生产或其它 run 使用。
4. 隔离数据库证明同一 submission ID 只产生一个 Lead，ownership manifest 中所有 fixture 清理无残留。
5. 合法域名、隐私、秘密、可信代理、包体、性能和回滚清单均完成，证据通过敏感信息扫描。
6. Node/Web 回归保持通过，Sol 最终复核无 P1/P2。

在上述环境门未齐备前，允许把“代码与预检工具完成”提交到功能分支，但状态必须保持“待预发布与真机验收”，不得开始 MP-106/107 的实现、集成或合并；只读的需求讨论、设计与合同草案不受此限制。
