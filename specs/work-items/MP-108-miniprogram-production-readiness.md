# Task Packet：MP-108 小程序生产就绪与切换

> 状态：执行中（本地自动化、PostgreSQL、HTTP/E2E 与开发者工具验收已通过，等待整分支终审与 staging）
> 更新日期：2026-09-07
> 集成分支：`feat/mp-108-production-readiness-a7c3d2`
> 基线：`origin/master@4d5c5af54692b555564c80a56d2f05a4ea6eae25`
> 功能来源：`feat/miniprogram-mvp-59f9@2169c44c8aff7791ee7561a50fb0a2fe91d55979`
> 本地设计规格：`docs/superpowers/specs/2026-09-07-mp-108-miniprogram-production-readiness-design.md`（按仓库规则忽略，不提交）
> 本地实施计划：`docs/superpowers/plans/2026-09-07-mp-108-miniprogram-production-readiness.md`（按仓库规则忽略，不提交）
> 发布边界：允许独立 staging、隔离 staging 数据写入/清理和体验版；禁止未经单独批准的生产迁移、生产部署、合并 master、提审或正式发布

## 1. 目标

把已完成的小程序及 Mini API 从旧功能分支安全集成到最新 Web 基线，形成唯一、可审计、可回滚的候选提交；完成本地、staging 和 trial 验收，并在首个生产写操作前输出精确执行包和请求单独批准。

MP-108 不是“把 trial 指到生产数据库”。trial 始终使用独立 staging 运行层和隔离数据库；只有 release 版本在正式切换后通过生产 CloudRun 共用 Web 的生产 PostgreSQL。

## 2. 当前事实

- 2026-09-07 生产 `/api/health` 返回 HTTP 200，版本为 `4d5c5af54692b555564c80a56d2f05a4ea6eae25`，Payload 与数据库健康。
- 同时实测生产 `/api/mini/v1/home?city=shanghai` 和 `/api/mini/v1/listings?...` 均为 HTTP 404；生产尚未包含 Mini API。
- 最新 `origin/master` 与小程序分支从共同祖先后分别有 270 与 72 个独有提交，不能直接把旧分支部署成生产候选。
- merge-tree 精确识别 6 个冲突文件：Web 询盘路由、询盘领域导出、公开供给适配器、迁移索引、已停止跟踪的 `payload-types.ts`、迁移预检测试。
- 小程序 `develop` 走本机 HTTP；`trial` 走 `sbhmini-gateway-d3fbrmn8097478b8/sbhmini`；`release` 固定走生产 `sbh-d9gnr8h5ef7e22e30/sbh`。
- staging 当前历史稳定版本为 `sbhmini-005@8eab1a17`；它不能证明新集成候选。旧的一次性 004/005 marker、推广和回滚预算不得重放或改写。
- `sbhmini-005@8eab1a17` 的代码 migration index 只有 66 条，而最新 master 有 80 条；实际 staging 数据库是否另行升级必须只读核对，不能假定仅缺 Mini user assets 迁移。
- 旧分支的 `20260904_144005_mp109_mini_user_assets` 生成于 master 最新快照之前，不能原样作为集成链末项；它会被保留哈希证据后移除，并从最新 master 快照重新生成新的 additive Mini user assets 迁移。新迁移正文不手改，down 的删除影响只记录、不自动执行。
- 历史 staging 005 提交早于该旧迁移提交；仍须在任何 staging 写前通过数据库只读查询证明旧迁移未应用，不能只凭 Git ancestry 推断。
- 集成已由 Payload CLI 生成 `20260907_050043_mp108_mini_user_assets`：TS SHA-256 为 `04a165e7...f2330e9`（与旧生成体一致），新 JSON snapshot 相对 master 最新快照只增加 Mini user assets schema，`migrate:drift` 已通过。

## 3. 不变量

1. 从最新 master 集成，保留双方 Git ancestry，不 rebase/force-push 已发布的小程序分支。
2. `payload-types.ts` 保持不跟踪；合并后重新生成，仅用来做本地与 CI 校验。
3. Web 与 Mini 共用询盘领域服务，但不得丢失 master 新增的 `visitorRef`、公开响应和幂等重放语义。
4. 公开供给仍只有一套有效供给规则；Mini 不复制简化谓词，不回退到全量重查询。
5. 生产 PostgreSQL 继续 `push:false`，只执行显式迁移；不得使用 dev schema push。
6. staging 数据库与生产数据库隔离；测试收藏、会话和咨询不得写入生产。
7. trial manifest 必须绑定干净候选 SHA、staging env/service 和真实 deployment revision；默认空 manifest 保持 fail-closed。
8. 代码通过、开发者工具通过或旧体验版存在，都不能单独等同于生产就绪。
9. 云端写操作采用“新鲜只读预检 → 单次写 → 独立只读结算”；结果未知时冻结，不自动重试、补偿或回滚。
10. 生产备份、迁移、候选部署/切流、小程序上传/提审/发布分别取得明确批准。

## 4. 完整任务清单

### Task 1：最新 master 基线与计划

- [x] 创建独立 worktree 和合规集成分支。
- [x] 用 Node 22、pnpm 8.6.1 和独立 PostgreSQL 验证 master 基线。
- [x] 从空库完成 80 条迁移、seed、二次迁移和 verify。
- [x] 通过 typecheck、lint、4584 项普通测试、41 项 PostgreSQL 测试、迁移 dry-run/drift/preflight 和 production build。
- [x] 审查本 Task Packet 与本地设计/实施计划，只提交并推送 Task Packet。

### Task 2：合并与冲突收敛

- [x] 使用普通 merge 把 `feat/miniprogram-mvp-59f9` 引入集成分支。
- [x] 对 6 个已知冲突逐文件采用双方语义并集，不整文件盲选 ours/theirs。
- [x] 保留 master 的 `visitorRef` 链路和供给扫描优化，同时接入共享公开询盘服务与 Mini 查询。
- [x] 移除旧基线生成的 Mini 迁移对，从最新 master 快照用 Payload CLI 重新生成且不手改正文；通过 drift、up/down 风险与迁移集合检查。
- [x] 保持 `payload-types.ts` 删除状态，重新生成并确认 `Media.prefix` 出现 2 次。
- [x] 用聚焦测试证明 Web 既有语义、Mini 语义和组合语义均通过。

### Task 3：小程序与 Web 本地质量门

- [x] 小程序冻结安装、全量测试、双 TypeScript 和 `project:check` 通过（46 files / 938 tests）。
- [x] Web 的 typecheck、lint、普通全量 test、迁移 dry-run/drift/preflight 通过；终审修复后复验为 366 files / 5175 tests，另有 9 files / 44 个 PostgreSQL 用例按既有条件跳过，未计为数据库验证。
- [x] 在 master 80 迁移的已填充库上只应用第 81 条迁移，验证 upgrade path、原表真实 count 不减少、幂等重跑和迁移核验。
- [x] 在第二个全新库从零执行 81 条完整迁移链、seed、幂等复跑；终审新增收藏并发用例后，以串行共享库命令复验 PostgreSQL 专项测试（9 files / 44 tests，零跳过）。
- [x] production build 通过，12 条 Mini API 动态路由全部进入构建 manifest 且 bundle 存在。
- [x] Mini API 本地真实 HTTP 探针通过：health 为完整候选 SHA，五条合同路径、request ID、no-store、asOf 与固定 24 分页均有本轮日志证据。
- [x] Web 双态 E2E 与小程序开发者工具 develop 冒烟通过；develop 由当前候选 worktree 占用 3717，并以 health commit、服务端访问日志和 request ID 证明真实网络身份。微信 session/login 因本地可信代理与网关未配置返回 fail-closed 503，不计为已验证。
- [x] 终审修复 Mini/Web 供给快照重复扫描与收藏 200 条上限并发竞态；新增提交后主库精确确认，数据库结果不可确认时 fail-closed 且不重放。复验证据见 `artifacts/verification/MP-108/task6-terminal-fixes.md`。

### Task 4：独立审查与候选固化

- [x] 高级模型进行规格符合性审查，P0/P1 全部关闭。
- [x] 高级模型进行代码质量、安全、迁移和发布边界审查，P0/P1 全部关闭；供给快照与收藏事务终审均为 Critical 0 / Important 0 / Minor 0。
- [x] 主 Agent 复核完整 diff、测试证据和未验证项；明确旧 HTTP/E2E/DevTools 证据不替代新候选的 staging/trial 绑定证据。
- [x] 实现与证据提交 `c92f004b8e8eabd31a37951f32102dfd98cc6bcb` 已推送；未跟踪 `.planning/` 已安全归档到仓外 `/Users/liujiayuan/App/mp108-local-archive-20260908-1842/.planning`，归档后完整 untracked 状态为空。本状态提交推送后的远端分支 HEAD 是唯一冻结候选，后续 staging/trial manifest 必须解析并绑定其完整 SHA。

### Task 5：staging 候选与隔离数据验收

- [ ] 对 CloudBase 控制面、当前流量、服务配置和旧 marker 做两轮只读对账。
- [ ] 在部署前只读对账 staging 数据库身份、完整 applied/pending/extra 集合和迁移哈希；applied 必须是候选 index 的有序前缀，任何额外项或旧 Mini 迁移已应用都先冻结并制定兼容方案。
- [ ] 在独立本地库重演旧 005 migration 集合到候选的完整升级，逐份审查所有 pending up/down、批准和数据影响，并验证旧 005 对升级后 schema 的兼容性。
- [ ] 从干净候选 SHA 在仓外生成 staging 部署包与 build-info。
- [ ] 为 staging 建立可验证恢复点；在 CloudRun 部署前一次性执行与本地重演一致的完整 pending 链并独立 verify，禁止自动 down，确认旧 005 仍健康且 0 pending。
- [ ] 创建全新候选 revision，先保持 0% 或平台等价的不可达生产状态，并独立结算。
- [ ] 完成健康、Mini 只读 API、目标 SHA/revision、数据库指纹和配置继承核验。
- [ ] 在既有授权范围内完成一次受控灰度、回滚能力验证和最终 staging 推广；每步均为新鲜预检、单次写、独立结算。
- [ ] 验证收藏、会话、咨询首次写入、幂等、跨会话、限流和精确清理；unknown/frozen 时保留 capsule，不无条件 cleanup 或重放。
- [ ] 覆盖 MP-105 尚缺的恢复/异常矩阵；任何结果未知时保留恢复胶囊并冻结后续写入。

### Task 6：trial 与真机验收

- [ ] 生成绑定候选 SHA 与新 staging revision 的 trial manifest。
- [ ] 用真实 AppID 上传最新体验版，版本和描述可反向定位候选 SHA。
- [ ] 证明真实 `envVersion=trial` 与 `wx.cloud.callContainer` 命中新 revision，而不是 develop 或旧体验包。
- [ ] 开发者工具验证首页、列表、详情、收藏、咨询和“我的”的真实网络、状态码及持久化。
- [ ] 分别核对正常图片、坏图、COS/下载域名、隐私政策、手机号授权拒绝与手工输入。
- [ ] iOS 与 Android 各完成键盘、安全区、弱网、权限、隐私、重复提交和跨会话验证。
- [ ] 结束后执行精确清理、残留只读查询和敏感信息扫描。

### Task 7：生产写前预检

- [ ] 冻结候选 SHA、迁移清单、Docker/环境配置和小程序 release 目标。
- [ ] 取得生产数据库备份/恢复点方案、本任务新生成迁移的影响查询、成功判据和停止条件。
- [ ] 两轮只读核对生产 CloudBase 当前版本/流量、health、Mini 404 基线、迁移状态、容量和数据库身份。
- [ ] 生成按顺序分离的生产执行包：备份 → 数据库迁移 → 候选部署 0% → 冒烟 → 灰度 → 全量 → 小程序上传/提审/发布。
- [ ] 在第一个生产写操作前停止并向用户请求精确批准。

### Task 8：生产切换（需逐项批准）

- [ ] 获批后建立生产备份/恢复点并只读结算。
- [ ] 获批后执行一次本任务新生成的显式迁移并 verify；失败立即停止，不部署不切流。
- [ ] 获批后部署生产候选，0% 状态验证 health、build-info 和 Mini 只读 API。
- [ ] 获批后按批准比例灰度，观察错误率、延迟、数据库与 Mini 写入；异常按已验证路径回滚。
- [ ] 获批后全量切流并保留回滚窗口。
- [ ] 获批后上传、提审和发布 release 小程序；归档最终版本、时间、监控与回滚证据。

## 5. 验收门

只有以下全部成立，才能向用户建议批准生产写入：

1. 集成候选基于最新 master，Git 工作树干净，CI 与本地全门通过。
2. Web 既有 `visitorRef`、供给性能和全部 E2E 无回归；Mini 全量测试与真实开发者工具交互通过。
3. master 现有数据库到新增迁移的升级路径和 fresh path 均在 PostgreSQL 通过。
4. staging revision、候选 SHA、隔离数据库指纹和 trial manifest 四者一致。
5. trial 的真实网络、收藏、咨询、“我的”、图片/COS、隐私、iOS 和 Android 证据闭环。
6. staging 写入已精确清理，无 Lead、follow-up、ownership、用户资产或恢复胶囊残留。
7. 生产备份、迁移、部署、灰度和回滚命令具备精确目标、预期结果、停止条件与独立结算。

生产切换完成还必须额外满足：每个生产写动作均有用户明确批准，并且正式环境只读结算与监控无异常。

## 6. 证据位置

- 本地与集成证据：`artifacts/verification/MP-108/`
- 既有 staging/trial 历史：`artifacts/verification/MP-105/`
- 小程序抽屉与搜索控件证据：`artifacts/verification/MP-109/`

证据必须写明 commit、dirty 状态、环境、revision、命令退出码和未执行项；不得记录 secret、完整数据库连接串、手机号、openid、Lead ID 或私钥路径。
