# MP-105b CloudBase staging 运行层迁移设计

> 日期：2026-08-31
>
> 分支：`feat/miniprogram-mvp-59f9`
>
> 关联工作项：MP-105
>
> 决策：迁移 staging 运行层，不迁 PostgreSQL，不建设独立反向代理网关。

## 1. 背景与已验证约束

现有 staging 环境 `sbhmini-d5g7d6732b2c64a66` 是 PostgreSQL 模式。微信开发者工具可以看到该环境，但平台明确拒绝把 PostgreSQL 环境选作微信云开发环境；该环境也没有生成微信网关，`wx.cloud.callContainer` 因权限被拒绝。

已创建传统模式个人版环境 `sbhmini-gateway-d3fbrmn8097478b8`，其传统云数据库、云存储和云函数资源均正常，PostgreSQL 资源为空，自动续费与超限按量均关闭。该环境可以作为目标小程序关联环境和 `callContainer` 承载环境。

现有应用通过服务端 `DATABASE_URL` 连接 PostgreSQL，仓库记录确认该连接使用公网 TencentDB 地址，不依赖旧 CloudRun 环境的同环境内网。因此完整后端可以在新环境重新部署，同时继续使用原隔离 staging PostgreSQL。

## 2. 方案比较与选择

### A. 迁移完整 staging 运行层（采用）

- 在新传统环境中重新部署与旧 staging 相同提交的完整后端服务，服务名继续使用 `sbhmini`。
- 新服务继续连接旧环境中的隔离 staging PostgreSQL。
- 小程序 trial 只切换 CloudBase 环境 ID，Mini API、服务名和业务合同不变。
- 不增加代理转发、第二次 HTTP 调用或新的鉴权边界。

### B. 部署轻量网关并转发到旧服务（放弃）

- 优点是旧服务不用迁移。
- 缺点是增加一次网络跳转、两层超时与错误映射、网关到旧服务的鉴权和额外运维面。
- 在完整后端可直接连接原数据库的前提下，没有必要承担这些成本。

### C. 把 PostgreSQL 数据迁入新环境（本阶段放弃）

- 新环境是传统数据库模式，不能直接承载现有 CloudBase PostgreSQL。
- Payload 当前以 PostgreSQL 为唯一数据库路径；迁成文档型数据库会改变数据模型、迁移和查询实现。
- 数据层迁移应作为独立项目评估，不与本次微信调用链解阻捆绑。

## 3. 目标架构

```text
微信小程序 trial
  -> wx.cloud.callContainer
  -> env: sbhmini-gateway-d3fbrmn8097478b8
  -> service: sbhmini（完整后端）
  -> /api/mini/v1/*
  -> 原 sbhmini 隔离 staging PostgreSQL

旧 env: sbhmini-d5g7d6732b2c64a66
  -> PostgreSQL：保留并继续作为 staging 数据库
  -> 旧 sbhmini CloudRun：迁移期间作为回滚入口，验收后可停用
```

环境名称带有 `gateway` 仅表示它是微信入口环境，不代表部署独立网关进程。不同 CloudBase 环境允许服务重名，因此新环境内服务继续命名为 `sbhmini`，减少小程序配置和运维认知变化。

## 4. 配置与安全边界

- 新服务必须从当前已提交快照构建，Git SHA 与部署 revision 必须由服务端 attestation 精确证明。
- 只复制运行所需的 staging 环境变量；值不得写入仓库、日志、聊天或小程序包。
- `DATABASE_URL` 继续指向原隔离 staging PostgreSQL；部署前后均通过受保护 attestation 的数据库指纹核对，不信任连接串自述。
- 环境特定值必须重算：新 CloudBase 环境 ID、服务 origin、revision、构建 SHA 和需要绑定 origin 的配置不得沿用旧值。
- `PAYLOAD_SECRET`、Mini session、微信服务端凭据和验收 operator/permit 仅存在于服务端秘密配置；小程序包只包含非秘密的 env ID、服务名、SHA 和 revision。
- 新服务的 `AccessTypes` 只保留实际需要的入口；小程序验收必须包含 `MINIAPP`。是否保留 `PUBLIC` 由受保护 attestation 与仓外验收 runner 的需要决定，不为解决 `callContainer` 放宽其它访问控制。
- 不修改生产环境、生产 CloudRun、生产数据库、生产 AppID 共享、DNS、证书或 ICP。

## 5. 代码与配置变化

- trial CloudBase 环境常量从旧 PostgreSQL 环境切换为 `sbhmini-gateway-d3fbrmn8097478b8`。
- trial 服务名保持 `sbhmini`，release 的生产 env/service 常量保持不变。
- trial manifest 仍绑定 `cloudEnvId`、`cloudServiceName`、Git SHA 和服务 revision；不得回退到公网 URL。
- 更新生成器测试、运行环境测试、README 和 MP-105 证据，使“运行环境”和“数据库归属环境”明确分离。
- 现有 `wx-transport`、Mini API 路径、认证、重试、幂等和响应解析不改业务语义。
- 不新增代理路由、转发服务或网关专用代码。

## 6. 部署顺序

1. 记录新旧环境、服务、数据库指纹和现有 staging revision 的只读基线。
2. 从当前 clean commit 生成 staging 部署包；生产 env/service 必须在所有目标参数中缺席。
3. 在新环境创建服务 `sbhmini`，复制经分类审核的 staging 服务端配置，并重算环境特定值。
4. 部署新 revision，将流量仅切到新环境内的新服务；旧环境服务不删除。
5. 调用新服务的受保护 attestation，核对 staging 标志、Git SHA、revision 和数据库指纹。
6. 在 private clone 生成绑定新 env/service/SHA/revision 的 trial manifest。
7. 将目标小程序关联到新传统环境；若平台要求环境共享，只允许同主体指定 AppID 的最小共享。
8. 在微信开发者工具验证首页、列表、详情和一条受控咨询写入/精确清理；图片来源单独验收。
9. 验收稳定后再决定是否停用旧环境内的 CloudRun 服务；旧环境及 PostgreSQL 不删除。

## 7. 失败处理与回滚

- 新服务构建、启动、attestation 或数据库指纹任一不匹配时，不生成 trial manifest，不切换小程序目标。
- `callContainer` 仍失败时保留平台原始稳定错误码并系统化排查，不回退测试域名或关闭微信安全校验。
- 数据库连接失败时只回滚新环境服务/小程序关联；不修改、迁移或清理旧 PostgreSQL。
- 运行层回滚为停止生成/上传该 trial，并撤销新环境关联或共享；开发态继续使用本机 HTTP，旧 staging 公网服务继续供仓外验收 runner 使用。旧 PostgreSQL 环境本身不能作为 `callContainer` 回滚目标。
- 写验收必须使用既有 run-scoped permit、幂等对账和精确清理，失败也执行 finally 清理。

## 8. 验收标准

- 新环境存在服务 `sbhmini`，revision 与当前 Git SHA 一致并处于正常状态。
- 新服务 attestation 明确为 staging，并返回与旧 staging 相同的数据库指纹。
- 小程序 trial manifest 只包含新 env ID、服务名、SHA 和 revision，不包含 URL 凭据或秘密。
- 微信开发者工具中的首页、列表和详情通过 `callContainer` 成功，不再出现 request 合法域名或权限拒绝。
- 受控咨询写入可对账且精确清理，数据库基线恢复为零残留。
- 图片、iOS/Android、隐私和正式发布仍按 MP-105 独立验收；未执行不得宣称完成。
- 无生产部署、生产写入或生产环境权限变化。

## 9. 后续生产方向（不在本次执行范围）

正式上线时，小程序生产运行层可以部署在独立传统 CloudBase 环境，并通过服务端连接 Web 生产 PostgreSQL，使 Web 与小程序共享单一业务数据源。staging 继续使用独立数据库；生产数据库共享需另行完成最小权限账号、单一迁移所有权、备份恢复和数据库指纹门，不在本次 staging 迁移中执行。
