# MP-105a 验收 fixture 归属与精确清理实施计划

> 状态：Task A–D 本地代码、mock 合同、回归与 Sol 复核已完成；真实 staging 执行待环境
> 日期：2026-08-28
> 所属工作项：MP-105 Task 5
> 决策：采用“受保护的 staging 核验/清理接口 + runner 内存 manifest”，不改 Lead 业务模型，不允许 runner 直连数据库

## 1. 目标与非目标

目标是在真实预发布验收开始前，把每次咨询写入约束为一个可证明、可重试、可精确回收的闭环：

1. runner 先证明本轮 `runId + submissionRequestId + listingSlug` 对应的 Lead 数量为 0；
2. 首次提交后只接受数量为 1，并取得服务端返回的不可变 Lead ID；
3. 同一 submission 重提后仍必须是同一个 Lead ID，数据库计数保持 1；
4. runner 无论成功、失败或收到 SIGINT/SIGTERM，都以 `Lead ID + 本轮幂等键` 双重匹配执行清理；
5. 清理后重新查询 Lead、跟进记录和归属历史，三者都必须为 0。

本计划不部署环境、不连接真实数据库、不执行真实咨询写入，也不处理真机 permit 注入。测试手机号、permit、bootstrap secret、完整 submission ID 与完整 Lead ID 不进入日志或仓库证据。

## 2. 安全不变量

- 新接口只在 acceptance 开关开启且 `deploymentEnvironment=staging` 时存在；disabled/production/错误 permit 同形 404，并且在认证失败前不初始化 Payload。
- 每次请求都复核 permit 的 SHA、revision、数据库指纹，并执行实际只读数据库探针；不信任请求体声明的环境身份。
- 请求体只接受严格 own-key 集合（含 Symbol/非枚举字段检查）。核验参数为 `submissionRequestId + listingSlug`；清理还必须提供不可变 `leadId`，不得接受前缀、时间范围或任意查询条件。
- Lead ID 使用带类型标签的规范编码，数字 ID 与同字面字符串 ID 永不相等；服务端只以 `encode(actualDoc.id)` 与客户端 token 精确比较，禁止把 token 转成数字或直接作为 Payload 删除 ID。
- 服务端重新计算本轮 acceptance 幂等键，不接受客户端传入 `idempotencyKey`。
- 核验只返回计数和不可变 ID；不返回姓名、手机号、公司、备注或其它 Lead 内容。
- 清理前必须同时满足：恰好一个 Lead、ID 精确相等、幂等键精确相等、关联 `follow-ups` 为 0、关联 `lead-ownership-history` 为 0。任何歧义或关联数据存在都返回冲突并冻结本轮，绝不级联删除追加式历史。
- 本仓库当前 Payload 的 `delete()` 是硬删除，`trash` 参数只影响查询过滤，不代表软删除。因此只允许 acceptance service 在上述全部精确条件成立后，以不可变 ID 硬删除这一条隔离 staging 测试 Lead；普通入口不能调用该能力。清理后同一接口必须查询为 0。
- runner 只在当前进程内存持有 permit、bootstrap secret、测试手机号和完整对象 ID；可提交证据只保存布尔结果、脱敏 host、run 摘要和计数。

## 3. API 合同

新增 `POST /api/mini/v1/acceptance/leads`，header 使用现有 `x-sbh-acceptance-permit`。

### inspect

请求：

```json
{
  "action": "inspect",
  "submissionRequestId": "<UUIDv4>",
  "listingSlug": "<canonical listing slug>"
}
```

成功响应只包含：

```json
{
  "ok": true,
  "result": {
    "leadCount": 1,
    "leadId": "<opaque immutable id or null>",
    "followUpCount": 0,
    "ownershipHistoryCount": 0
  },
  "meta": { "requestId": "<request id>" }
}
```

`leadId` 仅在 `leadCount === 1` 时返回；`leadCount > 1` 返回 409，不允许 runner 猜测所有者。

### cleanup

请求在 inspect 参数之外增加 `leadId`。服务端复算幂等键并按 `encode(actual doc.id) + idempotencyKey` 双重匹配；无记录时返回幂等的 `cleaned=false, leadCount=0`。精确命中且删除前两类关系均为 0 时，才以实际文档的原始 ID 硬删除该隔离测试 Lead；删除后再次查询 Lead、follow-ups 与 lead-ownership-history，三类均为 0 才返回 `cleaned=true, leadCount=0`。ID 不匹配、数量大于 1 或存在关系数据均拒绝清理。

## 4. 实现任务

### Task A：纯函数请求合同与查询身份（已完成）

**文件**

- Create: `payload-office-platform/src/domain/mini-program/acceptance-fixture.ts`
- Create/Test: `payload-office-platform/tests/acceptance-fixture.test.ts`

步骤：

1. 先写失败测试，覆盖严格键集合、共享 UUIDv4/listing slug validator、tagged canonical Lead ID codec、长度边界、数字/字符串同字面隔离和额外字段拒绝。
2. 复用 `miniAcceptanceInquiryIdempotencyKey` 计算 locator；测试同 run 稳定、跨 run 隔离、非法 run 拒绝，且请求体不能覆盖计算结果。
3. 只实现使测试通过的解析器和 locator 纯函数。

### Task B：受保护的核验/清理路由（已完成）

**文件**

- Create: `payload-office-platform/src/app/api/mini/v1/acceptance/leads/route.ts`
- Create/Test: `payload-office-platform/tests/mini-acceptance-fixture-route.test.ts`

步骤：

1. 先用依赖注入写失败路由测试：disabled/production/缺失/错误 permit 均 404 且零 Payload；错误 content-type、超大/非法 JSON、上下文不匹配和 DB probe 不匹配均 fail-closed。
2. 写 inspect 测试：0 条返回全零；1 条仅返回 opaque ID 和关系计数；多条返回 409；断言响应无 PII。
3. 写 cleanup 测试：0 条幂等成功；精确 ID + 键且零关系时只硬删除该隔离测试 Lead；ID 不匹配、多 Lead、跟进或归属历史存在均 409 且零删除。
4. 实现最小路由。沿用 permit、runtime config、bounded JSON、actual DB probe 和 no-store 响应；Payload 查询始终使用服务端复算 locator。
5. 定向测试、typecheck、相关 lint 全部通过后再进入 runner。

### Task C：受控 runner 与内存 ownership manifest（已完成）

**文件**

- Create: `sbh-miniprogram/scripts/staging-acceptance-runner.mjs`
- Create/Test: `sbh-miniprogram/tests/staging-acceptance-runner.test.ts`
- Modify: `sbh-miniprogram/package.json`

步骤：

1. 先写失败测试，使用注入 fetch 覆盖：预检 → attestation → permit → inspect 起点为 0 → inquiry 首次创建 → inspect 取得唯一 Lead ID → 同 submission 重提 → inspect 仍为同一 ID/数量 1 → finally cleanup → 最终三项计数为 0。
2. manifest 状态只存在内存，至少记录 `runId`、对象类型、不可变 ID、服务端复算 locator 的公开摘要和状态；格式化输出不得暴露完整值。
3. 覆盖首次或重提 inquiry 在响应头前丢失：runner 先以完全相同的 submission/body 做一次幂等对账，严格验证成功 receipt 后才允许再次 inspect；唯一命中的本轮 Lead 可被收养并精确清理。对账仍不确定、对账确认成功后仍为 0、多条、关系非 0 或 ID 变化均立即冻结，绝不宣称 clean。
4. 覆盖首次提交失败、重试失败、cleanup 503、关系计数非零、ID 变化、SIGINT/SIGTERM。信号处理只触发一次幂等 cleanup，清理失败设置非零退出码并打印“本轮冻结”，不得继续其它写场景。
5. runner 默认不写任何网络；只有 Task 2 的全部显式环境变量通过且命令显式执行时才创建网络请求。测试只使用 fake fetch。
6. package script 仅提供显式入口，不纳入普通测试或构建时自动执行。

### Task D：复核、回归与证据（本地已完成）

**文件**

- Modify: `artifacts/verification/MP-105/README.md`
- Modify: `specs/work-items/MP-105-miniprogram-integration-acceptance-plan.md`

步骤：

1. Sol 安全复核重点：认证前零 Payload、服务端复算 locator、双重精确匹配、追加式历史不被删除、异常路径一定进入 cleanup、输出脱敏。
2. 运行 MP-105 定向测试、小程序全量、Web 全量、双 typecheck、lint 和 build；构建产生的无关生成物恢复到基线。
3. 证据只记录 mock/合同测试结果，明确“未连接真实 staging、未执行真实写入、未完成真机验收”。
4. 经复核后使用显式路径提交并推送功能分支；不创建 PR、不合并、不部署。

## 5. 外部环境执行门

代码与 mock 合同完成后，MP-105 仍保持“执行中”。只有独立 staging HTTPS origin、目标 revision、隔离数据库指纹 allowlist、仓外 operator credential 和明确的真实写验收窗口齐备，才能运行 runner。真实执行前还要再次记录 dirty 状态并确认目标不是生产；执行结束必须以最终三项计数均为 0 才可解冻下一轮。
