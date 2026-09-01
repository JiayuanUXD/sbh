# MP-105b CloudBase staging 运行层迁移实施计划

> **状态：历史迁移记录。** 新环境服务与 001–003 已完成，当前稳定基线为 003=100%。本文件中的 bootstrap/Create/旧 003 发布步骤禁止重放；004 只按 `MP-105-miniprogram-integration-acceptance-plan.md` Task 7 的一次性候选/推广流程执行，结果不明只读对账，不自动重试、回滚或修改旧环境。
>
> **历史说明：** 原迁移曾按分任务 agent 流程执行；本文件不得继续逐项实施。004 只能执行 `MP-105-miniprogram-integration-acceptance-plan.md` Task 7 的当前步骤。

**Goal:** 把完整 staging 后端重新部署到传统 CloudBase 环境，使小程序 trial 通过 `wx.cloud.callContainer` 访问同一套 Mini API，同时继续使用原隔离 PostgreSQL。

**Architecture:** 新环境 `sbhmini-gateway-d3fbrmn8097478b8` 承载完整服务 `sbhmini`，服务端 `DATABASE_URL` 继续连接旧环境 `sbhmini-d5g7d6732b2c64a66` 中的 staging PostgreSQL。小程序只切换 trial env ID，服务名和 API 合同不变；不新增代理转发层。

**Tech Stack:** 原生微信小程序 TypeScript、Vitest 4.1.11、Node 22、pnpm 8.6.1、Next.js/Payload、PostgreSQL、CloudBase CloudRun、微信开发者工具。

## Global Constraints

- 运行环境固定为 `sbhmini-gateway-d3fbrmn8097478b8`，数据库归属环境固定为 `sbhmini-d5g7d6732b2c64a66`，服务名固定为 `sbhmini`。
- release 的生产 env `sbh-d9gnr8h5ef7e22e30`、服务 `sbh`、生产数据库、DNS、证书、ICP 和生产权限均不得修改。
- 新服务必须从当前 clean commit 构建；trial manifest 必须同时绑定该 commit SHA 与平台实际 revision。
- 旧 PostgreSQL 环境不得作为 trial `callContainer` 目标；部署准备脚本必须显式拒绝该环境。
- 不把 `DATABASE_URL`、`PAYLOAD_SECRET`、微信服务端凭据、operator secret、permit 或手机号写入仓库、终端证据、小程序包或聊天输出。
- `DATABASE_URL` 只在服务端继承；部署后以受保护 attestation 的数据库指纹证明仍连接原 staging 数据库。
- 写验收继续使用 run-scoped permit、幂等对账和精确清理；只有已持久确认幂等性的正常路径可调度清理，结果未知或中断必须保留恢复胶囊，待 writer receipt 到期后由独立 recovery CLI 在同 locator 锁下对账/清理。
- 严格 TDD；测试先证明旧环境仍被接受的失败，再做最小常量/守卫修改。
- `git add` 必须逐项写出具体路径；不得暂存用户未跟踪的 `docs/SBH小程序页面设计/`。
- 实施与审查均使用 GPT-5.6-Sol；不创建 PR、不合并 master、不部署生产。

---

## 文件结构

- Modify: `sbh-miniprogram/miniprogram/config/environment.ts` — trial 运行环境唯一目标。
- Modify: `sbh-miniprogram/scripts/prepare-trial-deployment.mjs` — private clone manifest 唯一目标。
- Modify: `sbh-miniprogram/tests/environment.test.ts` — 新环境成功与旧 PostgreSQL 环境拒绝合同。
- Modify: `sbh-miniprogram/tests/trial-deployment-tooling.test.ts` — 生成器新目标与秘密扫描合同。
- Modify: `sbh-miniprogram/tests/request.test.ts` — cloud-container fixture 与实际 trial 环境对齐。
- Modify: `sbh-miniprogram/tests/wx-transport.test.ts` — `callContainer` fixture 与实际 trial 环境对齐。
- Modify: `payload-office-platform/scripts/prepare-cloudrun-staging.mjs` — 只允许新运行环境生成部署包。
- Modify: `payload-office-platform/tests/staging-cloudrun-package.test.ts` — 新运行环境通过、旧数据库环境与生产环境拒绝。
- Modify: `sbh-miniprogram/README.md` — 运行环境与数据库归属分离说明。
- Modify: `specs/work-items/MP-105-miniprogram-integration-acceptance-plan.md` — 真实平台限制、迁移方案和验收状态。
- Modify: `artifacts/verification/MP-105/README.md` — 脱敏云端、开发者工具和清理证据。
- Generated outside repository: private clone 的 `trial-deployment.generated.ts`。

---

### Task 1: 把 trial 与 staging 部署守卫切到新运行环境

**Files:**
- Modify: `sbh-miniprogram/tests/environment.test.ts`
- Modify: `sbh-miniprogram/tests/trial-deployment-tooling.test.ts`
- Modify: `payload-office-platform/tests/staging-cloudrun-package.test.ts`
- Modify: `sbh-miniprogram/miniprogram/config/environment.ts`
- Modify: `sbh-miniprogram/scripts/prepare-trial-deployment.mjs`
- Modify: `sbh-miniprogram/tests/request.test.ts`
- Modify: `sbh-miniprogram/tests/wx-transport.test.ts`
- Modify: `payload-office-platform/scripts/prepare-cloudrun-staging.mjs`

**Interfaces:**
- Produces: trial `cloudEnvId = 'sbhmini-gateway-d3fbrmn8097478b8'`、`cloudServiceName = 'sbhmini'`。
- Consumes: 既有 `RuntimeEnvironment`、`prepareTrialDeployment()`、`validateStagingEnvId()`；签名不变。

- [ ] **Step 1: 先把三组测试改成目标合同**

在 `environment.test.ts` 的有效 manifest 中使用：

```ts
const validTrialManifest = {
  cloudEnvId: 'sbhmini-gateway-d3fbrmn8097478b8',
  cloudServiceName: 'sbhmini',
  gitCommitSha: 'a'.repeat(40),
  serverDeploymentRevision: 'sbhmini-002',
}
```

拒绝矩阵新增旧 PostgreSQL 环境：

```ts
[
  'PostgreSQL 数据库环境',
  'cloudEnvId',
  'sbhmini-d5g7d6732b2c64a66',
  /trial cloud env 与受控 staging 不一致/,
]
```

在 `trial-deployment-tooling.test.ts` 中把有效 env 改为新环境，并新增：

```ts
[
  'postgres database env',
  { ...environment, TRIAL_CLOUD_ENV_ID: 'sbhmini-d5g7d6732b2c64a66' },
  sha,
  'clean',
  /trial cloud env 与受控 staging 不一致/,
]
```

在 `staging-cloudrun-package.test.ts` 中定义：

```ts
const STAGING_RUNTIME_ENV_ID = 'sbhmini-gateway-d3fbrmn8097478b8'
const STAGING_DATABASE_ENV_ID = 'sbhmini-d5g7d6732b2c64a66'
```

并断言 `validateStagingEnvId(STAGING_RUNTIME_ENV_ID)` 成功，旧数据库环境与 `PRODUCTION_ENV_ID` 均抛出稳定错误。

- [ ] **Step 2: 运行红灯测试**

Run:

```bash
cd sbh-miniprogram
pnpm exec vitest run tests/environment.test.ts tests/trial-deployment-tooling.test.ts
cd ../payload-office-platform
pnpm exec vitest run tests/staging-cloudrun-package.test.ts
```

Expected: Mini 测试因生产常量仍指向旧 env 而失败；Web 测试因 `validateStagingEnvId()` 仍接受旧数据库 env 而失败。

- [ ] **Step 3: 做最小生产代码修改**

在两个 Mini 文件中使用同一个固定值：

```ts
const STAGING_ENV_ID = 'sbhmini-gateway-d3fbrmn8097478b8'
const STAGING_SERVICE_NAME = 'sbhmini'
```

在 `prepare-cloudrun-staging.mjs` 中加入：

```js
export const STAGING_RUNTIME_ENV_ID = 'sbhmini-gateway-d3fbrmn8097478b8'
export const STAGING_DATABASE_ENV_ID = 'sbhmini-d5g7d6732b2c64a66'
```

并把 `validateStagingEnvId()` 的成功条件收紧为仅接受 `STAGING_RUNTIME_ENV_ID`：

```js
if (rawEnvId !== STAGING_RUNTIME_ENV_ID) {
  if (rawEnvId === PRODUCTION_ENV_ID) throw new Error('staging 环境 ID 不得指向生产环境')
  if (rawEnvId === STAGING_DATABASE_ENV_ID) {
    throw new Error('staging 运行层不得指向 PostgreSQL 数据库环境')
  }
  throw new Error('staging 环境 ID 与受控运行环境不一致')
}
return rawEnvId
```

保留原格式校验在精确目标比较之前。把 `request.test.ts` 和 `wx-transport.test.ts` 中表示真实 trial 的 fixture 同步到新 env，不改变 path、method、data、headers、重试或解析期望。

- [ ] **Step 4: 运行定向绿灯与类型检查**

Run:

```bash
cd sbh-miniprogram
pnpm exec vitest run tests/environment.test.ts tests/trial-deployment-tooling.test.ts tests/request.test.ts tests/wx-transport.test.ts
pnpm typecheck
cd ../payload-office-platform
pnpm exec vitest run tests/staging-cloudrun-package.test.ts
pnpm typecheck
```

Expected: 全部 exit 0；无测试减少；双项目 TypeScript exit 0。

- [ ] **Step 5: 扫描旧 env 的剩余语义**

Run:

```bash
rg -n "sbhmini-d5g7d6732b2c64a66|sbhmini-gateway-d3fbrmn8097478b8" \
  sbh-miniprogram payload-office-platform/scripts payload-office-platform/tests
```

Expected: 新 env 出现在 trial/运行层配置；旧 env 只出现在“数据库归属/拒绝矩阵”语义中，不再作为 `callContainer` 或部署目标。

- [ ] **Step 6: 显式提交 Task 1**

```bash
git add sbh-miniprogram/tests/environment.test.ts \
  sbh-miniprogram/tests/trial-deployment-tooling.test.ts \
  sbh-miniprogram/tests/request.test.ts \
  sbh-miniprogram/tests/wx-transport.test.ts \
  sbh-miniprogram/miniprogram/config/environment.ts \
  sbh-miniprogram/scripts/prepare-trial-deployment.mjs \
  payload-office-platform/tests/staging-cloudrun-package.test.ts \
  payload-office-platform/scripts/prepare-cloudrun-staging.mjs
git commit -m "feat: 切换小程序预发布运行环境"
```

Expected: pre-commit 通过；用户设计目录未暂存。

---

### Task 2: 在新环境部署完整 staging 后端

**Files:**
- Read: `scripts/cloudrun-release.sh`
- Read: `payload-office-platform/scripts/prepare-cloudrun-staging.mjs`
- Cloud mutation: 仅 env `sbhmini-gateway-d3fbrmn8097478b8`、service `sbhmini`

**Interfaces:**
- Consumes: Task 1 的 clean commit、旧服务 revision `sbhmini-019` 的服务端配置和隔离数据库。
- Produces: 新环境中的服务 `sbhmini`、实际 revision、默认 HTTPS origin、attestation 四元组。

- [ ] **Step 1: 记录只读基线并拒绝重复目标**

Run:

```bash
tcb cloudrun list --json
tcb api tcbr DescribeCloudRunServerDetail --api-version 2022-02-17 \
  --body '{"EnvId":"sbhmini-d5g7d6732b2c64a66","ServerName":"sbhmini"}' --json
tcb api tcbr DescribeCloudRunServers --api-version 2022-02-17 \
  --body '{"EnvId":"sbhmini-gateway-d3fbrmn8097478b8"}' --json
```

Expected: 旧服务 normal、`AccessTypes` 含 `MINIAPP`；新环境尚无名为 `sbhmini` 的服务。只记录 env ID、服务名、revision、状态、配置键名和数据库指纹，不输出任何配置值。

- [ ] **Step 2: 完整质量门并确认 clean commit**

Run:

```bash
cd sbh-miniprogram
pnpm test
pnpm typecheck
pnpm project:check
cd ../payload-office-platform
pnpm project:check
pnpm typecheck
git -C .. diff --quiet
git -C .. diff --cached --quiet
git -C .. rev-parse HEAD
```

Expected: 所有命令 exit 0，工作树仅允许用户未跟踪设计目录；部署 SHA 是 Task 1 提交后的完整 40 位 SHA。

- [ ] **Step 3: 从旧版本配置在内存中生成新服务配置**

使用官方 SDK 单进程执行器读取 `DescribeCloudBaseRunServerVersion` 的 `EnvParams` JSON 字符串，只保留以下 16 个键并在内存中修改环境特定字段。不得把完整请求体传入 CLI `--body`，避免秘密短暂暴露在进程参数中；原始响应、上传签名材料和最终请求体不得写入文件或 stdout/stderr：

```bash
current_head_sha=$(git rev-parse HEAD)
```

```text
DATABASE_URL
MINI_SESSION_SIGNING_SECRET
MINI_TRUSTED_PROXY_HOPS
MP_ACCEPTANCE_ATTESTATION_SECRET
MP_ACCEPTANCE_DB_FINGERPRINT_ALLOWLIST
MP_ACCEPTANCE_DEPLOYMENT_ENVIRONMENT
MP_ACCEPTANCE_DEPLOYMENT_GIT_COMMIT_SHA
MP_ACCEPTANCE_DEPLOYMENT_REVISION
MP_ACCEPTANCE_ENABLED
MP_ACCEPTANCE_OPERATOR_BOOTSTRAP_SECRET
MP_ACCEPTANCE_PERMIT_SIGNING_SECRET
NEXT_PUBLIC_SALE_CHANNEL_ENABLED
NEXT_PUBLIC_SITE_URL
NODE_ENV
PAYLOAD_DISABLE_JOB_AUTORUN
PAYLOAD_SECRET
```

精确设置：

```text
MP_ACCEPTANCE_DEPLOYMENT_ENVIRONMENT=staging
MP_ACCEPTANCE_DEPLOYMENT_GIT_COMMIT_SHA=$current_head_sha
MP_ACCEPTANCE_ENABLED=1
NODE_ENV=development
PAYLOAD_DISABLE_JOB_AUTORUN=1
```

`MP_ACCEPTANCE_ENABLED` 和 `PAYLOAD_DISABLE_JOB_AUTORUN` 都必须使用字符串 `1`；服务端对这两个值做严格比较，不能写成布尔语义的 `true`。`NODE_ENV` 继续继承现有 staging 的 `development`：当前 staging 的 16 键配置不含生产模式强制要求的 5 个 COS 凭据，改成 `production` 会被启动期配置守卫拒绝；本次不得因此复用生产 COS 桶或凭据，也不得临时扩大到新的存储迁移。`DATABASE_URL`、签名秘密、operator/permit 秘密和数据库指纹 allowlist 原值继承但绝不输出。创建请求只允许 `OA`，不在 bootstrap revision 开放 `PUBLIC` 或 `MINIAPP`。

- [x] **Step 4（历史完成，禁止重放）: 从迁移提交创建 package bootstrap 服务并取得平台实际编号**

先从当前 clean commit 生成 bootstrap package；临时 origin 固定使用 `https://bootstrap.invalid`，并把 bootstrap 环境变量精确设置为 `NEXT_PUBLIC_SITE_URL=https://bootstrap.invalid`、`MP_ACCEPTANCE_DEPLOYMENT_REVISION=bootstrap`、`MP_ACCEPTANCE_ENABLED=0`。该版本只允许 `OA`，不得用于 trial。通过 `DescribeCloudBaseBuildService` 上传代码包，再用上一步内存配置调用 `tcbr.CreateCloudRunServer`，目标精确为新 env/service，规格与旧服务一致：Port 80、CPU 1、内存 2、MinNum 0、MaxNum 1、alwaysScale。等待 `DescribeServerManageTask` 和 `DescribeCloudRunServerDetail` 返回 normal，记录平台实际 bootstrap revision、默认 origin 和全部部署记录的最大编号。

不得默认复用旧环境的个人版 CCR 镜像：只有平台明确证明新环境已获得该镜像拉取权限时才可作为失败后的备选。创建前后均应核对新环境没有同名服务和未完成任务。

Expected: 服务只存在于新环境；旧环境服务、流量和数据库未变化。若 bootstrap revision 不是服务的第一个序号，停止并重新计算下一 revision，不生成 trial manifest。

- [x] **Step 5（历史完成，禁止用于 004）: 生成迁移 commit 的部署包并发布 003**

先把内存配置中的 `NEXT_PUBLIC_SITE_URL` 设置为新服务默认 origin，把 `MP_ACCEPTANCE_ENABLED` 改回字符串 `1`，并根据全部部署记录最大编号预测下一 revision，将其写入 `MP_ACCEPTANCE_DEPLOYMENT_REVISION`；再从同一 clean commit 生成部署包：

```bash
node payload-office-platform/scripts/prepare-cloudrun-staging.mjs \
  --env-id sbhmini-gateway-d3fbrmn8097478b8 \
  --origin "$NEW_STAGING_ORIGIN"
```

历史发布使用 `DescribeCloudBaseBuildService` 上传临时目录，并以 `UpdateCloudRunServer` 的 `GRAY` 模式发布 package revision；`Items` 精确包含 Port 80、`AccessTypes=["OA","PUBLIC","MINIAPP"]` 和内存中的完整 `EnvParam`。004 不继承“编号不符后另发新版本”的旧做法：写调用前必须冻结期望 revision，只允许一次 `UpdateCloudRunServer`；实际身份不符、超时或响应未知时停止并只读对账，不自动重发，也不生成 trial manifest。

Expected: 实际 revision 与预先绑定的 `MP_ACCEPTANCE_DEPLOYMENT_REVISION` 完全一致；不一致则停止并保持 trial 未生成。

- [ ] **Step 6: 验证服务、部署身份和数据库不变**

Run:

```bash
curl --fail --silent --show-error "$NEW_STAGING_ORIGIN/api/health"
```

随后通过现有受保护 bootstrap/attestation 流程调用：

```text
/api/mini/v1/acceptance/attestation
```

Expected（历史 003）：canary health 与受保护 attestation 均通过后才提升到 100%。004 的任何失败或结果未知均不得由脚本立即回滚、重放 `UpdateCloudRunServer` 或重放 `ReleaseGray`；只运行独立只读 reconciler 并冻结 trial，待人工根据精确平台状态决定后续。原始数据库身份和秘密不进入证据。

---

### Task 3: 生成 trial 并完成 `callContainer` 只读闭环

**Files:**
- Generated outside repository: private clone 的 `sbh-miniprogram/miniprogram/config/trial-deployment.generated.ts`
- Modify after evidence: `artifacts/verification/MP-105/README.md`

**Interfaces:**
- Consumes: Task 2 的 env/service/SHA/revision 四元组。
- Produces: 目标小程序关联、新环境微信网关、首页/列表/详情真实证据。

- [ ] **Step 1: 在 private clean clone 生成 trial manifest**

Run:

```bash
trial_clone_root=$(mktemp -d /private/tmp/sbhmini-runtime-migration.XXXXXX)
git clone --local --branch feat/miniprogram-mvp-59f9 \
  /Users/liujiayuan/App/wt-mp-59f9 "$trial_clone_root"
cd "$trial_clone_root/sbh-miniprogram"
trial_commit_sha=$(git rev-parse HEAD)
TRIAL_CLOUD_ENV_ID=sbhmini-gateway-d3fbrmn8097478b8 \
TRIAL_CLOUD_SERVICE_NAME=sbhmini \
TRIAL_DEPLOYMENT_COMMIT_SHA="$trial_commit_sha" \
TRIAL_SERVER_DEPLOYMENT_REVISION="$NEW_STAGING_REVISION" \
TRIAL_DEPLOYMENT_OUTPUT_PATH="$trial_clone_root/sbh-miniprogram/miniprogram/config/trial-deployment.generated.ts" \
pnpm prepare:trial-deployment
```

Expected: exit 0；生成物只包含 env/service/SHA/revision；主工作树无生成物变化。

- [ ] **Step 2: 关联目标小程序到新传统环境**

在微信开发者工具的“腾讯云环境”选择 `sbhmini-gateway-d3fbrmn8097478b8`。如果平台要求环境共享，只向当前脱敏 AppID `wx…2204` 开启同主体最小共享；不向其它 AppID 或生产环境开放。

Expected: 开发者工具环境列表能选择新环境；`DescribeWxGateways` 或等价只读状态出现该环境微信网关；新服务保持 `MINIAPP` 访问类型。

- [ ] **Step 3: 打开 private clone 并运行只读 smoke**

使用已经开启服务端口的微信开发者工具打开 private clone，保持基础库 3.17.2 与 URL 校验开启。依次验证：

```text
#home-ready
首条真实 listing slug
#listing-detail-ready
```

Expected: 首页、列表和详情成功；网络请求为 `wx.cloud.callContainer`，env 为新环境、`X-WX-SERVICE=sbhmini`；无 request 合法域名错误、`Permission denied` 或未处理运行时异常。

- [ ] **Step 4: 单独记录图片结果**

从真实 DTO 收集图片 origin，验证模拟器首屏与详情图片。API 成功但图片失败时只把 API 标为通过，并记录实际 `downloadFile` 域名阻断；不把图片结果并入 `callContainer` 成功结论。

---

### Task 4: 回归受控写闭环、更新证据并推送

**Files:**
- Modify: `sbh-miniprogram/README.md`
- Modify: `specs/work-items/MP-105-miniprogram-integration-acceptance-plan.md`
- Modify: `artifacts/verification/MP-105/README.md`
- Modify scratch ledger: `.superpowers/sdd/progress.md`

**Interfaces:**
- Consumes: Task 1–3 的测试、部署、attestation、DevTools 和图片证据。
- Produces: 可审计的真实 staging 结论；不产生生产变更。

- [ ] **Step 1: 运行一次受控咨询写入与精确清理**

通过 `staging-acceptance-runner.mjs` 取得 bootstrap/permit，使用新的 SHA/revision 完成咨询写入、idempotency 对账和 cleanup。runner 必须先持久确认 `idempotency_verified` 才能调度正常清理；结果未知、信号或进程中断保留恢复胶囊，禁止在 `finally` 中无条件清理。

Expected: 写入返回预期成功；server locator 与实际 Lead ID 一致；pre/post Lead、follow-up、ownership 均恢复零残留。失败或未知时不声明清理完成，待 writer receipt 到期后由独立 recovery CLI 在同 locator 锁下对账，并以全新 inspect 的 `0/0/0` 作为唯一终态证据。

- [ ] **Step 2: 更新三份文档的真实状态**

必须明确记录：

```text
运行环境：sbhmini-gateway-d3fbrmn8097478b8 / sbhmini
数据库归属：sbhmini-d5g7d6732b2c64a66 PostgreSQL
部署身份：实际 Git SHA / 实际 revision
传输：wx.cloud.callContainer
```

只写脱敏 AppID、通过/失败项、测试计数、错误码和数据库 opaque 指纹。iOS、Android、隐私、图片中尚未真实执行的项保持未勾选。

- [ ] **Step 3: 运行最终质量门与秘密扫描**

Run:

```bash
cd sbh-miniprogram
pnpm test
pnpm typecheck
pnpm project:check
cd ../payload-office-platform
pnpm project:check
pnpm typecheck
cd ..
git diff --check
rg -n "postgres://|postgresql://|Bearer [A-Za-z0-9._~-]{20,}|APP_SECRET|SECRET_KEY" \
  sbh-miniprogram payload-office-platform/scripts artifacts/verification/MP-105 \
  specs/work-items/MP-105-miniprogram-integration-acceptance-plan.md
rg -n "as any|@ts-ignore|@ts-nocheck" \
  sbh-miniprogram/miniprogram sbh-miniprogram/tests sbh-miniprogram/scripts
```

Expected: 所有质量门 exit 0；秘密扫描只命中安全字段名/测试占位，无真实值；无新增类型逃逸。

- [ ] **Step 4: 独立整分支审查**

审查范围从本计划开始前的 `545ae70` 到当前 HEAD，重点检查：旧 PG env 不再作为运行目标、生产常量未改、数据库只保留归属语义、无代理层、证据不过度声称。

Expected: GPT-5.6-Sol 给出 spec compliance 与 code quality 双通过；Critical/Important 归零。

- [ ] **Step 5: 显式提交并推送证据**

```bash
git add sbh-miniprogram/README.md \
  specs/work-items/MP-105-miniprogram-integration-acceptance-plan.md \
  artifacts/verification/MP-105/README.md
git commit -m "docs: 记录小程序预发布运行层迁移验收"
git push origin feat/miniprogram-mvp-59f9
```

Expected: pre-push 全部通过；远端分支包含设计、计划、实现与脱敏证据；用户设计目录未暂存；不创建 PR、不合并、不触碰生产。

## 最终完成判据

- 新传统环境承载完整 `sbhmini` 服务，不存在独立代理网关代码或转发跳数。
- trial 只把新环境作为 `callContainer` 目标；旧环境只作为 PostgreSQL 数据归属出现。
- 新服务 SHA/revision 与 private trial manifest 一致，数据库 opaque 指纹与旧 staging 基线一致。
- 首页、列表、详情无合法域名和权限错误；受控咨询写入对账并零残留清理。
- 测试、类型检查、工程检查、秘密扫描与独立审查通过。
- 旧 PostgreSQL 环境未删除并继续作为 staging 数据库；旧服务只读保留，不作为 004 自动回滚或 mutation 目标；生产环境完全未变。
