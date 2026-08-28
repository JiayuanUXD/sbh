# MP-105 验收证据索引

> 状态：部分通过；独立 staging 服务端写闭环、自动清理、`callContainer` 代码与 Node 验证已通过，真实 AppID/staging 关联、开发者工具网络、图片/COS、iOS/Android、隐私和正式发布仍待验收
> 更新日期：2026-08-28

## 证据身份

- 分支：`feat/miniprogram-mvp-59f9`
- 本轮 Node 验证代码 commit：`2aab7a5ba9103c6990431e828f3ed7ba5b288897`
- Task 4 文档提交：`1365374af879d7f532820a8e2c0ca7b795c4b0c3`
- Task 4 最终质量门在提交前运行：当时三份目标文档相对代码基线为 tracked dirty，内容与随后提交的 `1365374` 完全一致；另有用户未跟踪的 `docs/SBH小程序页面设计/`。提交后 tracked 工作树干净，仅保留该用户未跟踪目录；它不属于交付物且未触碰。
- staging API host：`sbhmini-304306-11-1253925058.sh.run.tcloudbase.com`
- staging deployment revision：`sbhmini-016`
- staging 数据库指纹：真实数据库探针计算并命中 staging allowlist；证据不保存原值
- acceptance run ID：仅记录摘要 `23e57b67`，完整 UUID 不归档

## 已执行

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

### 真实 staging 写闭环

- CloudBase 独立体验环境：`sbhmini-d5g7d6732b2c64a66`；服务：`sbhmini`。与生产环境和生产服务名称不同，部署与写入过程中未操作生产环境。
- 隔离数据库：AIDA Supabase 项目；迁移从初始迁移执行到 `20260826_065228_opt_054_nav_config`，随后完成 seed。连接串、账号、密码和数据库指纹原值不归档。
- runner 在 revision `sbhmini-016` 上完成真实 attestation、10 分钟 run-scoped permit、干净起点证明、首次咨询写入、相同 submission 幂等重试与精确清理。
- 首次写入核验：Lead 计数 `1`，follow-up `0`，ownership history `0`；幂等重试后计数保持 `1/0/0`。runner 对响应做严格解析，exit 0 要求首次 `acceptedExisting=false`、同 submission 重提 `acceptedExisting=true`；这是由已归档 exit 0 与随仓 runner 合同共同得出的可复验判断，未归档原始响应或敏感请求体。
- `finally` 清理后再次查询：Lead `0`、follow-up `0`、ownership history `0`；runner 退出码 `0`。
- 预检期间曾分别命中缺少受信代理跳数（503）和隐私版本不匹配（422）的 fail-closed 分支；两轮均在零写入状态完成清理。最终配置使用 CloudRun 公网入口 1 跳代理和服务端合同版本 `MVP-R1`。
- 结论范围：真实 staging 的部署身份、隔离数据库、写许可、幂等性与精确清理已经得到运行证据；仍不能替代微信开发者工具、微信后台合法域名、iOS/Android 真机和隐私指引验收。

### Task 5 证据范围

| 子项 | 状态 | 证据边界 |
|---|---|---|
| 服务端 attestation、permit 与干净起点 | 已通过 | revision `sbhmini-016` 的真实 runner 已完成，写前 Lead/follow-up/ownership history 均为 0 |
| 服务端首次写入、同 submission 幂等重提 | 已通过 | runner exit 0 且计数 `1 → 1`；严格响应合同要求第二次 `acceptedExisting=true` |
| 服务端精确清理 | 已通过 | `finally` 后 Lead/follow-up/ownership history 均为 0，runner exit 0 |
| 房源详情页手填手机号与重提 UI | 未执行 | 未关联真实 AppID/staging，未运行切换后的微信开发者工具网络 |
| 真实 staging 完整异常矩阵 | 未执行 | 仅有写前受信代理 503、隐私版本 422 阻断实录；降级楼盘、通用需求、限流、session 过期、弱网响应丢失和稳定服务端错误未完整执行 |
| 真实 staging 中断/未知结果/清理失败 | 未执行 | `try/finally`、部分创建、结果未知、SIGINT/SIGTERM 和冻结行为已有本地合同测试，但未在真实环境主动制造 |

### 微信开发者工具诊断

- 版本：Stable 1.06.2409140
- 基础库：3.17.2
- 工具服务端口：2026-08-28 再检查时已关闭；重新开启属于待确认的本机安全设置
- 历史项目结果：切换前能编译并打开首页；自动化连接成功后，develop API `http://127.0.0.1:3717` 被 request 合法域名校验拒绝，未到达 `#home-ready`。
- 本轮结果：未执行，待真实 AppID 与 staging CloudBase 环境关联。没有运行 trial `callContainer` 网络、没有关闭合法域名校验，也没有预览、上传、部署或咨询写入。
- 结论范围：历史 develop 阻断不能证明切换后的 staging 调用通过；Node mock/合同测试也不能替代微信开发者工具网络证据。

## 未执行与阻断

| 验收项 | 状态 | 阻断条件 |
|---|---|---|
| staging 服务端 HTTPS API 与写闭环 | 已通过 | 既有证据已核对 commit、revision、健康检查、三类 Mini 只读 API、幂等写入与精确清理；不等于小程序 `callContainer` 已通过 |
| 服务端 attestation | 已通过 | 真实 revision、commit 与数据库指纹 allowlist 匹配 |
| 隔离数据库咨询写入 | 已通过 | 首次写入、幂等重试与精确清理为 `1 → 1 → 0`，关系残留为 0 |
| 真实 AppID 与 staging CloudBase 关联 | 未执行 | 需要微信与 CloudBase 管理员确认精确 AppID、env 和 service，并留变更/回滚证据 |
| 开发者工具 trial `callContainer` 网络 | 未执行 | 待 AppID 与 staging 环境关联后核对首页、列表、详情、错误和网络面板 |
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
