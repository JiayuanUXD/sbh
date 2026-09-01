# MP-105 验收证据索引

> 状态：部分通过；staging 运行层 003 稳定，恢复协议与安全补丁已通过离线门禁；004 部署、真实 PostgreSQL 异常矩阵、开发者工具网络、图片/COS、iOS/Android 与隐私仍待验收
> 更新日期：2026-09-01

## 证据身份

- 分支：`feat/miniprogram-mvp-59f9`
- 当前恢复协议代码 commit：`b8ed1f99135757bd9f2a01cc96e5c7113bd86d51`
- 当前数据库安全补丁 commit：`ad6e018d9dfdc898dd3f458e4eaf8c3ee6c013b0`
- staging 运行环境/服务：`sbhmini-gateway-d3fbrmn8097478b8` / `sbhmini`
- staging API host：`sbhmini-305971-11-1253925058.sh.run.tcloudbase.com`
- 当前稳定 deployment revision：`sbhmini-003`，commit `1cd3e41c12352e32eadd8c84f065b3d98e6ffc29`，100% 流量
- 待部署 revision：`sbhmini-004`；其 package/commit 尚未冻结，因此本文件不提前记录伪 revision 证据
- staging 数据库指纹：真实数据库探针计算并命中 staging allowlist；证据不保存原值
- 数据库迁移边界：运行层迁移、数据库不迁移；旧环境 `sbhmini-d5g7d6732b2c64a66` 与旧 `sbhmini-019` 仅作只读漂移核对，不是 004 mutation 目标
- 用户未跟踪的 `docs/SBH小程序页面设计/` 不属于本轮交付物，提交与门禁均未触碰

## 2026-09-01 恢复协议与安全加固

- runner 在任何网络前原子创建单活动恢复胶囊，并把首次写调度、首次响应、幂等性确认、清理调度和最终清理确认作为独立持久阶段。单次 writer/cleanup 响应、进程信号或 Payload commit 返回均不能单独证明终态。
- write permit 只使用一次，并附带职责分离的 HMAC recovery receipt；只有在旧 writer receipt 以 PostgreSQL 时间到期后，独立 recovery CLI 才能换取 locator-bound recovery permit。recovery CLI 不调用 `/inquiries`，最终必须用新请求、新 inspect permit 和同 locator advisory lock 观察到 Lead/follow-up/ownership history 为 `0/0/0`，才删除胶囊。
- writer、inspect、recover、cleanup 在同一 Payload transaction session 内先取得 advisory xact lock，再由同一 executor 单次读取数据库身份与 PostgreSQL 时间，并在任何 Lead 读写前复验 permit、运行环境与数据库指纹。lock busy 路径只执行 lock SQL。
- permit 签发端改为单条 PostgreSQL 查询同时取得数据库身份与时间；fixture 的 Lead initial/final 查询和物理删除均显式 `trash:true`，避免将回收站 PII 隐藏为零残留；无需数据库迁移。
- Node 22.23.2 / pnpm 8.6.1：小程序全量 32 个文件、747/747，双 TypeScript 与 `project:check` 通过；Web 全量 303 个文件通过、5 个既有跳过，4318 个用例通过、25 个既有跳过，typecheck/lint/build 通过，lint 仅有 23 条既有 warning。
- 独立安全终审运行服务端 8 个文件 280/280、客户端 5 个文件 281/281，合计 561/561；最终结论 CLEAN，P0/P1/P2 均为 0。该结论只覆盖代码和合同测试。
- CloudBase 两轮只读快照业务投影一致：`001=0%`、`002=0%`、`003=100%`，003 的历史 task/release 已 finished/success；旧环境、旧 `019` 与 001/002/003 配置无漂移。尚未调用 004 的 `UpdateCloudRunServer` 或 `ReleaseGray`。
- 真实 004 仍须验证：Payload session 与 Lead 操作物理同连接、writer/recovery 并发、PG 到期边界、commit outcome unknown 后 fresh inspect、trashed Lead 实库物理删除、断连/迟到请求及生产 acceptance 实际关闭。未执行项不得写为通过。

## 历史已执行证据（保留追溯）

以下条目记录 2026-08-28 及更早的旧运行环境/revision 验收，不能替代上方当前 004 门禁。

### Node 自动化

- 本轮 `callContainer` 传输层前序定向矩阵：123/123 通过；本轮 brief 未要求重复运行定向命令，最终质量门使用全量 `pnpm test` 覆盖。
- 本轮 Mini 全量（Node 22.23.2、pnpm 8.6.1）：`Test Files 30 passed (30)`，`Tests 552 passed (552)`，exit 0。
- 本轮 Mini 双 TypeScript：`tsconfig.json` 与 `tsconfig.node.json` 均通过，`pnpm typecheck` exit 0。
- 本轮 Mini 工程检查：终端末行为“SBH 小程序工程静态检查通过”，`pnpm project:check` exit 0；仓内 `project.config.json` 继续保持 `urlCheck: true`。

- 运行时：Node 22.23.2
- Task 1/2 定向测试（trial manifest + 本地预检）：70/70 通过
- 小程序全量：28 个测试文件、471 项通过
- 小程序双 TypeScript：通过
- 小程序 `project:check`：通过
- Web Task 3a 定向合同测试（runtime config + attestation route）：15/15 通过；Web typecheck 与相关 lint 通过。
- Web Task 3b-1 permit 定向合同测试（签发/验证 + route）：52/52 通过；与 Task 3a 合计 68/68。Sol 首轮发现多段 token 解析与跨 run 假阳性后退回，修复并补回归，第二轮 APPROVE，无遗留 P1/P2。
- Web Task 3b-2 定向合同测试（permit intrinsic verifier + run 隔离幂等键 + Mini inquiry route）：105/105 通过。Sol 首轮发现 acceptance 与普通/跨 run 共用幂等键会错归属，修复为独立 run-domain-separated key 后复验 APPROVE，无遗留 P1/P2。
- Web Task 5a fixture identity/cleanup 定向合同：8 个文件、185/185 通过；小程序 environment/preflight 回归 56/56，Web typecheck、小程序双 TypeScript 与相关 lint 通过。轻量模型初稿被 Sol 以 4 个 P2 退回后，按用户门槛切换为全部高级模型：补齐 number/string tagged Lead ID、严格联合类型、共享小写 UUID/slug validator、非法 run 拒绝、Symbol/非枚举 own-key，并统一 preflight/permit/locator 的小写 UUID 合同。
- 受保护的 `POST /api/mini/v1/acceptance/leads` 只在 permit、部署 SHA/revision、数据库 allowlist 与实际探针全部匹配后核验/清理；locator 由服务端重算，清理必须同时匹配 `encode(actual Lead ID)`，且删除前后 Lead、follow-ups、lead-ownership-history 均为 0 才返回成功。Sol 完整路由合同初版 33/33；主审发现删除后未复查两类关系并退回，修复后 Task B 36/36，合并定向矩阵 185/185。
- Task 5a runner 使用显式命令、同源且禁止重定向的 bounded fetch、进程内 ownership manifest、同 submission 幂等对账、`try/finally` 与 SIGINT/SIGTERM 单例清理。高级模型与主审先后捕获过期 permit、响应体超时、信号早于在途写完成、响应未知后晚写、晚到信号误报成功、非规范 permit/Lead ID 等边界；最终 runner 合同 49/49，小程序全量 29 个文件、521/521，Web acceptance 8 个文件、185/185。Node 22.23.2 下小程序双 TypeScript、`project:check`、runner `node --check` 与 Web typecheck 通过。小程序子工程没有独立 ESLint 配置，因此未把会误读用户主目录配置的无效 lint 命令记录为通过。
- Sol 最终全量审查先因计划文档仍保留“响应丢失后 0 条即 clean”的旧规则返回 REQUEST_CHANGES；同步为“同 body 幂等对账，不确定或确认后仍为 0 均冻结”，并修正硬删除、runner 状态和当前计数后复核 APPROVE，代码与文档均无剩余 P1/P2。
- Web 全量：306 个测试文件中 301 通过、5 个既有跳过；4225 项中 4200 通过、25 项既有跳过。
- Web lint：0 错误、23 条既有 warning；production build：退出成功。构建期记录既有 COS fail-closed 日志并按现有城市静态参数降级完成，不视为 staging attestation 证据。
- Node 22.23.2 下重新验证安全默认态：小程序 `project:check`、双 TypeScript、30 个测试文件与 552/552 用例全部通过。
- 此前在独立临时发布副本中生成 direct-API trial manifest，绑定当时的 commit、revision 与 staging HTTPS origin；生成后 `project:check` 和双 TypeScript 继续通过。该历史 manifest 未写入功能分支，也不能替代当前 cloud env/service manifest 的 AppID 关联与网络验收。
- 真实 staging 健康检查返回 HTTP 200，Payload 与数据库均为 `ok`；首页、Mini 首页 API、房源列表 API 和 `jingan-serviced-office-42-seats` 详情 API 均返回 HTTP 200。

### 历史 staging 写闭环（旧运行环境/revision）

- 当时的 CloudBase 运行/数据库环境：`sbhmini-d5g7d6732b2c64a66`；服务：`sbhmini`。该记录发生在运行层迁移前；当前只保留数据库连接与只读核对，不再向该环境部署新 revision。
- 隔离数据库：AIDA Supabase 项目；迁移从初始迁移执行到 `20260826_065228_opt_054_nav_config`，随后完成 seed。连接串、账号、密码和数据库指纹原值不归档。
- runner 在 revision `sbhmini-016` 上完成真实 attestation、10 分钟 run-scoped permit、干净起点证明、首次咨询写入、相同 submission 幂等重试与精确清理。
- 首次写入核验：Lead 计数 `1`，follow-up `0`，ownership history `0`；幂等重试后计数保持 `1/0/0`。runner 对响应做严格解析，exit 0 要求首次 `acceptedExisting=false`、同 submission 重提 `acceptedExisting=true`；这是由已归档 exit 0 与随仓 runner 合同共同得出的可复验判断，未归档原始响应或敏感请求体。
- `finally` 清理后再次查询：Lead `0`、follow-up `0`、ownership history `0`；runner 退出码 `0`。
- 预检期间曾分别命中缺少受信代理跳数（503）和隐私版本不匹配（422）的 fail-closed 分支；两轮均在零写入状态完成清理。最终配置使用 CloudRun 公网入口 1 跳代理和服务端合同版本 `MVP-R1`。
- 结论范围：旧 revision 的部署身份、staging 数据库、写许可、幂等性与正常路径精确清理曾得到运行证据；它既不能替代当前 004 的恢复/回收站/并发异常矩阵，也不能替代微信开发者工具、iOS/Android 真机和隐私指引验收。

### 历史 Task 5 证据范围

| 子项 | 状态 | 证据边界 |
|---|---|---|
| 服务端 attestation、permit 与干净起点 | 已通过 | revision `sbhmini-016` 的真实 runner 已完成，写前 Lead/follow-up/ownership history 均为 0 |
| 服务端首次写入、同 submission 幂等重提 | 已通过 | runner exit 0 且计数 `1 → 1`；严格响应合同要求第二次 `acceptedExisting=true` |
| 服务端精确清理 | 已通过 | `finally` 后 Lead/follow-up/ownership history 均为 0，runner exit 0 |
| 房源详情页手填手机号与重提 UI | 未执行 | 当时尚未关联真实 AppID/staging，未运行切换后的微信开发者工具网络 |
| 真实 staging 完整异常矩阵 | 未执行 | 仅有写前受信代理 503、隐私版本 422 阻断实录；降级楼盘、通用需求、限流、session 过期、弱网响应丢失和稳定服务端错误未完整执行 |
| 真实 staging 中断/未知结果/清理失败 | 未执行 | `try/finally`、部分创建、结果未知、SIGINT/SIGTERM 和冻结行为已有本地合同测试，但未在真实环境主动制造 |

### 微信开发者工具诊断

- 版本：Stable 1.06.2409140
- 基础库：3.17.2
- 工具服务端口：2026-08-28 再检查时已关闭；用户随后已授权在本任务中开启，当前是否仍开启需在 004 开发者工具验收前重新只读确认
- 历史项目结果：切换前能编译并打开首页；自动化连接成功后，develop API `http://127.0.0.1:3717` 被 request 合法域名校验拒绝，未到达 `#home-ready`。
- 该历史轮结果：当时未执行，且当时尚未完成真实 AppID 与 staging CloudBase 环境关联；没有运行 trial `callContainer` 网络、没有关闭合法域名校验，也没有预览、上传、部署或咨询写入。
- 结论范围：历史 develop 阻断不能证明切换后的 staging 调用通过；Node mock/合同测试也不能替代微信开发者工具网络证据。

## 未执行与阻断

| 验收项 | 状态 | 阻断条件 |
|---|---|---|
| staging 服务端 HTTPS API 与写闭环 | 部分通过 | 003 健康与只读基线稳定，旧 revision 正常写闭环有历史证据；当前恢复协议的 004 尚未部署和实测 |
| 服务端 attestation | 部分通过 | 003 的 revision/commit/数据库指纹已有历史与只读证据；004 必须重新 attestation，不继承旧结论 |
| staging 数据库咨询写入 | 部分通过 | 旧正常路径为 `1 → 1 → 0`；当前协议的并发、未知提交、回收站物理删除和断连矩阵待 004 验证 |
| 真实 AppID 与 staging CloudBase 关联 | 部分完成 | 本机私有项目配置使用真实 AppID，目标 env/service 已固定；仍需在开发者工具确认新环境 trial 关联和网络结果 |
| 开发者工具 trial `callContainer` 网络 | 未执行 | 待 004 完成后核对首页、列表、详情、错误、网络面板与实际命中 revision |
| 图片/COS 来源与加载 | 未执行 | 待从真实 DTO 核对图片来源、微信平台要求和正常图/坏图；Mini API 传输不能替代 |
| iOS 真机 | 未执行 | 待可验收 trial 包、AppID/环境关联、账号与隐私条件 |
| Android 真机 | 未执行 | 待可验收 trial 包、AppID/环境关联、账号与隐私条件 |
| 微信隐私配置与交互 | 未执行 | 需要管理员配置隐私声明，并在开发者工具和两类真机留证 |
| 预览/上传 | 未执行 | 本轮未调用 `pnpm ci:preview`，未使用微信 CI 私钥 |
| 正式发布 | 未执行 | 未正式上传、提审、发布或触碰 production |

## 安全说明

- 本证据不保存 AppSecret、上传私钥、token、完整手机号、openid、数据库连接串或完整业务对象 ID。
- `callContainer` 只替代 Mini API 的 request 服务器域名链路；图片/COS、AppID 关联、隐私、设备和持久化均按独立证据判断。
- 本地关闭合法域名校验即使未来获批，也只能算 develop 调试，不能替代微信后台合法域名验收。
- MP-105 全部门通过前，MP-106/107 不进入实现、集成或合并。
