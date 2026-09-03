# MP-105 验收证据索引

> 状态：MVP 核心链路通过；005 已经一次性推广至 100%，独立结算、运行产物 build-info、受保护 attestation 与真实 staging 正常写入/幂等/精确清理均通过；Task 4 本地 DevTools 8 项全场景自动化验收与性能指标闭环；Task 6 手机微信真机走查顺利通过；禁止重放推广或自动执行补偿、回滚、recovery。
> 更新日期：2026-09-03

## 证据身份

- 分支：`feat/miniprogram-mvp-59f9`
- 当前分支 HEAD / 005 预期代码 commit：`8eab1a17cfe5800d1778fbad2d47cf4c54542d87`
- 当前数据库安全补丁 commit：`ad6e018d9dfdc898dd3f458e4eaf8c3ee6c013b0`
- staging 运行环境/服务：`sbhmini-gateway-d3fbrmn8097478b8` / `sbhmini`
- staging API host：`sbhmini-305971-11-1253925058.sh.run.tcloudbase.com`
- 当前稳定 deployment revision：`sbhmini-005`，commit `8eab1a17cfe5800d1778fbad2d47cf4c54542d87`，100% 流量；003/004 均为 0%
- 004 历史：候选 commit `3b88f0858399234f204ff7b8668b18c387a5508f` 曾部署并灰度 10%，随后 `ROLLBACK_004_SETTLED`。005 在推广前已经独立只读确认创建正确；本轮一次性推广后又以独立只读查询结算为 `PROMOTE_005_SETTLED`，实际 `/api/health`、build-info、受保护 attestation 与正常写路径均已匹配目标 revision/commit
- staging 数据库指纹：真实数据库探针计算并命中 staging allowlist；证据不保存原值
- 数据库迁移边界：运行层迁移、数据库不迁移；旧环境 `sbhmini-d5g7d6732b2c64a66` 与旧 `sbhmini-019` 仅作只读漂移核对，不是后续 mutation 目标
- 用户未跟踪的 `docs/SBH小程序页面设计/` 不属于本轮交付物，提交与门禁均未触碰

## 2026-09-03 Task 4 自动化全项闭环与 Task 6 真机验收通过

- **XPath 样式隔离修复**：微信编译器为自定义组件前缀加上 `card-index--listing-card`，原正则缺少匹配。修复为 `//*[contains(@class, "listing-card") and @data-slug]`，单测 32 文件 776/776 全过。
- **Task 4 全场景自动化走查**：编写并执行 `scripts/task4-acceptance-runner.mjs`，覆盖首页、找房、下拉刷新、详情、第4种成本（面议）、空态、404、坏图兜底，截取 8 张证据图；并通过 `wx.getPerformance()` 提取 30 条核心渲染性能指标（`task4-acceptance-report.json`）。
- **Task 6 真机验收通过**：用户通过手机微信扫码最新体验版，完成真机首页、列表、详情与网络调用链路的走查验证，无白屏与网络异常，详见 `task6-real-device.md`。

## 2026-09-02 develop DevTools 首页/找房/详情 smoke 续验

- 清理两个经确认的旧本地进程组后，以 Node `v22.23.2` 重启 3717；health、home、listings 与 listings page=2 均为 HTTP 200。默认 Node `v24.14.0` 超出工程支持范围，是旧 3717 服务失控和接口超时的直接环境差异。
- DevTools CSS 选择器无法跨 `listing-card` 自定义组件边界；smoke 改为精确 class-token XPath 定位真实原生卡片并读取 `data-slug`，保留 ready marker、slug 安全校验、总 deadline 和失败清理。
- TDD 记录：新场景先在旧实现下超时失败；修复后目标 1/1、tooling 58/58、小程序全量 32 文件 747/747、`project:check`、双 TypeScript 与 `git diff --check` 均通过。
- Stable bundle `36.6.0` 的完整 develop smoke exit 0，首页/找房/详情 ready 通过，9420 无残留 automation 进程。证据见 `task4-devtools-read-only.md`。
- 该结果仅证明本地 develop DevTools 页面 smoke；trial `callContainer` revision/网络面板、性能、图片/COS、隐私、咨询写入、预览/上传与真机仍未通过。

## 2026-09-02 005 推广结算与正常路径真实写验收

- MP-105M 仅执行一次推广写调用；独立只读结算确认 005=100%、003/004=0%，结算码为 `PROMOTE_005_SETTLED`。推广 marker 未被删除、改写或重命名，禁止重放推广。
- `/api/health` 返回 HTTP 200，服务、数据库与 Payload 均为 `ok`；运行产物 build-info 精确匹配目标 commit。
- 受保护 attestation 确认 staging、revision、commit 与数据库指纹 allowlist 全部匹配；证据不保存完整数据库指纹或敏感配置值。
- MP-105N 从真实 listings/detail API 取得有效房源与隐私政策版本 `MVP-R1`，写前确认恢复胶囊与两个锁路径均不存在，再执行正常路径验收。
- 真实计数严格为 `0/0/0 → 1/0/0 → 1/0/0 → 0/0/0`：干净起点、首次写入、同 submission 幂等重提、精确清理与 fresh inspect 均通过；`writeOutcomeUnknown=false`。
- 清理后恢复胶囊与锁均无残留，因此未运行 recovery CLI。脱敏事件流共 9 行、权限 `0600`，详见 `mp105m-005-promote-settlement.md`、`mp105n-staging-acceptance.md` 与 `mp105n-staging-acceptance-run.jsonl`。

## 2026-09-02 005 推广前云端只读对账（历史）

- 两轮 Describe-only 快照除观察时间外完全一致：003=100%，004=0%，005=0%；旧 019 保持 100%。
- 005 版本状态 `normal`，环境 commit/revision 为 `8eab1a17cfe5800d1778fbad2d47cf4c54542d87` / `sbhmini-005`，配置与 003 非身份变量继承精确匹配。
- 005 deploy record 为 `normal/FLOW/0%/HasTraffic=false/IsReleasing=true`；release `2542417` 为 open，task `2054487` 为 running，latest 与按 ID 复查绑定一致。
- 严格候选态断言通过，分类为 `005_CREATED_CORRECTLY_WITH_ZERO_TRAFFIC`。由于 005 为 0% 流量，实际运行产物的 `build-info.json` / `/api/health.version` 尚未确认。
- 对账前后真实 marker 的 inode、mtime、大小与 SHA-256 均未变化；未执行任何 mutation。详见 `mp105l-005-read-only-reconciliation.md` 和 `.json`。

## 2026-09-02 005 marker 本地审计

- 005 公共一次性 marker 已存在，但没有对应结算报告；它在云端写调用之前创建，因此只能证明预算已消费。
- 根因：005 工具复用了 004 模块的 marker helper，helper 闭包固定写入 004 version/commit；marker 中的 004 身份不能据此推出请求目标也是 004，也不能证明 005 已成功。
- 本地已用 TDD 修正 marker 身份注入，并补齐 MP-105M 测试夹具缺失的 `OLD_ENV_ID` 导入。验证结果：004 工具 26/26、005 候选 10/10、005 推广 17/17；测试前后真实 marker 校验和一致。
- 后续独立只读对账先确认 005 正确创建并保持 0% 流量；用户再次明确授权后，MP-105M 已完成一次推广并独立结算为 005=100%。这些结果不改变 marker 一次性预算已消费和禁止重放的边界；仍禁止删除 marker、自动补偿、再次推广、回滚或 recovery。详见 `mp105l-005-marker-audit.md`、`mp105l-005-read-only-reconciliation.md` 与 `mp105m-005-promote-settlement.md`。

## 2026-09-01 恢复协议与安全加固

- runner 在任何网络前原子创建单活动恢复胶囊，并把首次写调度、首次响应、幂等性确认、清理调度和最终清理确认作为独立持久阶段。单次 writer/cleanup 响应、进程信号或 Payload commit 返回均不能单独证明终态。
- write permit 只使用一次，并附带职责分离的 HMAC recovery receipt；只有在旧 writer receipt 以 PostgreSQL 时间到期后，独立 recovery CLI 才能换取 locator-bound recovery permit。recovery CLI 不调用 `/inquiries`，最终必须用新请求、新 inspect permit 和同 locator advisory lock 观察到 Lead/follow-up/ownership history 为 `0/0/0`，才删除胶囊。
- writer、inspect、recover、cleanup 在同一 Payload transaction session 内先取得 advisory xact lock，再由同一 executor 单次读取数据库身份与 PostgreSQL 时间，并在任何 Lead 读写前复验 permit、运行环境与数据库指纹。lock busy 路径只执行 lock SQL。
- permit 签发端改为单条 PostgreSQL 查询同时取得数据库身份与时间；fixture 的 Lead initial/final 查询和物理删除均显式 `trash:true`，避免将回收站 PII 隐藏为零残留；无需数据库迁移。
- Node 22.23.2 / pnpm 8.6.1：小程序全量 32 个文件、747/747，双 TypeScript 与 `project:check` 通过；Web 全量 303 个文件通过、5 个既有跳过，4318 个用例通过、25 个既有跳过，typecheck/lint/build 通过，lint 仅有 23 条既有 warning。
- 独立安全终审运行服务端 8 个文件 280/280、客户端 5 个文件 281/281，合计 561/561；最终结论 CLEAN，P0/P1/P2 均为 0。该结论只覆盖代码和合同测试。
- 当时的 CloudBase 两轮只读快照业务投影一致：`001=0%`、`002=0%`、`003=100%`，003 的历史 task/release 已 finished/success；随后 004 已完成候选部署、10% 灰度和受控回滚，005 已推广至 100%。
- 005 已完成运行产物身份、受保护 attestation 与正常写入/幂等/精确清理验证；真实环境仍须主动验证 writer/recovery 并发、PG 到期边界、commit outcome unknown 后 fresh inspect、cleanup 失败、trashed Lead 异常矩阵、SIGKILL、断连和迟到请求。未执行项不得写为通过。

## 历史已执行证据（保留追溯）

以下条目记录 2026-08-28 及更早的旧运行环境/revision 验收，不能替代当前候选身份对账与真实环境门禁。

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
- 结论范围：旧 revision 的部署身份、staging 数据库、写许可、幂等性与正常路径精确清理曾得到运行证据；它既不能替代当前代码的恢复/回收站/并发异常矩阵，也不能替代微信开发者工具、iOS/Android 真机和隐私指引验收。

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

- 当前安装版本：Stable bundle 36.6.0（2026-09-02 由应用 Info.plist 复核）
- 基础库：3.17.2
- 工具服务端口：2026-09-02 develop smoke 完成后 9420 无残留监听或 automation 子进程；3717 由 Node 22.23.2 本地服务继续提供
- 历史项目结果：切换前能编译并打开首页；自动化连接成功后，develop API `http://127.0.0.1:3717` 被 request 合法域名校验拒绝，未到达 `#home-ready`。
- 该历史轮结果：当时未执行，且当时尚未完成真实 AppID 与 staging CloudBase 环境关联；没有运行 trial `callContainer` 网络、没有关闭合法域名校验，也没有预览、上传、部署或咨询写入。
- 结论范围：历史 develop 阻断不能证明切换后的 staging 调用通过；Node mock/合同测试也不能替代微信开发者工具网络证据。

## 未执行与阻断

| 验收项 | 状态 | 阻断条件 |
|---|---|---|
| staging 服务端 HTTPS API 与写闭环 | 部分通过 | 005=100%，健康、build-info、真实正常写入、幂等重提与精确清理已通过；异常、中断和 UI 写路径仍未完成 |
| 服务端 attestation | 已通过（正常路径） | 005 实际运行产物 commit/revision、staging 标识与数据库指纹 allowlist 均已由受保护 attestation 确认；异常竞争路径仍属于 Task 5 未执行范围 |
| staging 数据库咨询写入 | 部分通过 | 当前 005 正常路径为 `0/0/0 → 1/0/0 → 1/0/0 → 0/0/0`；并发、未知提交、主动 cleanup 失败、回收站异常和断连矩阵仍待执行 |
| 真实 AppID 与 staging CloudBase 关联 | 部分完成 | 本机私有项目配置使用真实 AppID，目标 env/service 已固定；仍需在开发者工具确认新环境 trial 关联和网络结果 |
| 开发者工具 trial `callContainer` 网络 | 部分执行 | 004 期间有部分页面只读证据；完整网络面板、实际命中 revision、下拉刷新、坏图、第 4 种成本与性能证据待补 |
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


## 2026-09-02 staging 直接 HTTPS 只读探针（补充，不计为 trial DevTools 通过）

- 在不写 CloudBase、不调用 acceptance mutation、不改一次性 marker 的前提下，对受控 staging host 直接执行 5 个 HTTPS `GET`：`/api/health`、首页 DTO、列表 DTO、有效详情和不存在详情。
- 结果：5/5 请求收到服务响应；健康、首页、列表、有效详情为 HTTP 200，不存在详情为 HTTP 404 `listing_not_found`。`/api/health` 返回 `status=ok`、Payload/DB 均 `ok`，`version=8eab1a17cfe5800d1778fbad2d47cf4c54542d87`。端到端耗时分别为 2.128537 s、1.917096 s、0.802391 s、0.230379 s、0.151409 s；CloudBase upstream timecost 分别为 528 ms、13 ms、16 ms、11 ms、12 ms。
- 脱敏结构化结果：`task4-staging-read-only-http.json`。这些是直接 HTTPS 探针，不是微信开发者工具 `wx.cloud.callContainer` 网络面板或性能面板证据，不能证明小程序实际命中 `sbhmini-005` revision。
- 当前 `trial-deployment.generated.ts` 仍为空字段安全默认值；按 `prepare-trial-deployment.mjs` 生成真实 trial manifest 的只读尝试以 exit 1 失败，原因是工作树不干净。没有生成、提交、上传、预览或部署。

### 2026-09-02 隔离 trial manifest 与 DevTools 环境诊断补充

- 在 `/Users/liujiayuan/App/wt-mp-trial` 的 detached HEAD `8eab1a17cfe5800d1778fbad2d47cf4c54542d87` 上生成受控 trial manifest，绑定 `sbhmini-gateway-d3fbrmn8097478b8/sbhmini/sbhmini-005`；未写回原工作树。
- Node `v22.23.2` 下，安全默认空 manifest 的小程序全量回归为 32 个文件、747/747；真实 manifest 副本的双 TypeScript 与 `project:check` 通过。真实 manifest 直接跑全量测试时，仅安全默认态 fail-closed 用例因夹具已改变而失败，未将其当作业务回归。
- 真实 AppID DevTools 自动化读取 `wx.getAccountInfoSync().miniProgram.envVersion=develop`，没有进入 trial；因此没有 `wx.cloud.callContainer`、目标 revision 或 Network/Performance 面板证据。结构化记录见 `task4-devtools-env-diagnostic.json`。
- 结论：trial DevTools 验收仍被“本地项目无法加载已关联的 trial 版本”阻断；未 mock、未预览、未上传、未部署、未咨询写入。
