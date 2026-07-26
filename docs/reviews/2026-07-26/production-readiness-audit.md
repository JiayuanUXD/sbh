# 第四阶段：生产上线与工程门禁审查报告

审查日期：2026-07-26  
审查范围：后台 M8、前台 F7、容器与 CloudBase 发布链路  
审查性质：只读审查，未修改业务代码或部署配置

## 结论摘要

当前代码可以通过类型检查、完整单元测试和本地生产构建，但尚不具备安全发布条件。最严重问题是迁移预检“假通过”：迁移目录存在 18 份迁移，索引只注册 16 份，预检却报告全部通过。容器启动仅执行索引中的迁移，因此生产结构可能缺少通知表和询盘上下文字段。

后台 M8 全部任务仍未勾选，前台 F7.8 也未完成。本阶段不能标记通过。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| F7/迁移/限流目标测试 | 6 文件、111 项通过 |
| `pnpm test` | 93 文件、1877 项通过 |
| `NEXT_PUBLIC_SITE_URL=http://localhost:3717 pnpm build` | 通过 |
| `pnpm preflight:migrate` | 命令返回通过，但结论无效：实际识别 0 个迁移 |
| Node 版本 | 本机为 Node 24.14.0，与项目要求 Node 22.x 不一致 |

## 发现

### P0：两份生产迁移未注册，预检仍然假通过 ✅ 已修复（OPT-014）

`src/migrations` 有 18 份迁移文件，`index.ts` 仅注册 16 份，遗漏：

- `20260726_103800_m6_7_notifications`
- `20260726_140000_m5_2_leads_inquiry_context`

预检脚本只识别 `import name from`，而 Payload 生成的索引使用 `import * as name from`，因此本次输出“发现 0 个迁移”后仍将检查判定为通过。

容器启动执行 `payload migrate`，它只会运行索引注册项。后果包括通知 Collection 缺表，以及询盘写入所需的幂等、来源、隐私同意和 request ID 字段缺失。

**修复**：补注册两份迁移到 `index.ts`；重构 `preflight.ts` 为纯函数（解析数组 `name:` 字段、目录/索引集合相等校验、缺 down 升级 fail、风险扫描只针对 up body）。9 项单元测试 + 真实预检验证集合一致。证据见 `artifacts/verification/OPT-014/README.md`。

### P0：生产配置缺失时会降级到临时 SQLite 和固定密钥 ✅ 已修复（OPT-015）

当 `DATABASE_URL` 不存在或格式不以 `postgres` 开头时，配置自动启用本地 SQLite；当 `PAYLOAD_SECRET` 缺失时使用固定字符串。部署工作流没有运行环境预检，只依赖控制台已配置这一假设。

在 CloudRun 中，这种配置错误可能表现为“服务健康但使用实例本地临时数据”，同时采用公开可预测的 Payload 密钥。生产模式必须 fail-closed。

**修复**：新增 `src/lib/runtime/config-guard.ts` 纯函数守卫（`assertProductionConfig`），挂载到 `payload.config.ts` 的 `onInit`。生产缺 PostgreSQL / 强密钥（>=32 字符且非弱默认值）/ 合法 https 站点 URL 时抛错拒绝启动；dev/build 不触发。16 项单元测试 + 全量 1932 项回归通过。证据见 `artifacts/verification/OPT-015/README.md`。

### P1：发布工作流绕过项目质量门禁并直接切流 ✅ 已修复

GitHub Actions 不安装项目依赖、不运行 lint、类型、测试、构建、迁移预检或数据审计。它安装 `@cloudbase/cli@latest`，发布行为不可复现；部署提示通过管道输入回车处理，升级后容易改变语义。

发布后自动全量切流，只等待固定 20 秒并检查单一健康端点。没有灰度比例、业务冒烟、自动回滚或迁移并发锁证据。容器的“迁移后启动”也会让多个新实例竞争执行迁移。

**修复**：`.github/workflows/deploy.yml` 拆为 quality job（lint + typecheck + test + 迁移预检 + build，`deploy.needs: quality`）与 deploy job；CLI 锁定 `@cloudbase/cli@3.6.4`；新增 `scripts/migrate-locked.ts`（PG advisory lock 互斥，多实例只有一个跑迁移）+ `src/lib/runtime/migrate-lock.ts` 纯函数，Dockerfile CMD 改用该脚本；部署走灰度（deploy 0% -> `traffic --stable 90 --canary 10`）-> 冒烟（`/api/health` x10 + `/`）-> `traffic promote` 全量 / `traffic rollback` 回滚。6 项 migrate-lock 单元测试 + 全量 1938 项回归通过。证据见 `artifacts/verification/OPT-016/README.md`。

### P1：询盘限流可被多实例绕过，存储不会回收 ✅ 已修复

询盘 API 使用进程内全局 `Map`。CloudRun 多实例之间不共享计数，重启或扩容即可重置额度；Map 中过期 key 也没有清理机制，攻击者可持续制造新 key 占用内存。

这只能作为单进程弱保护，不能满足生产批量接口限额与滥用防护。

**修复**：新增 `src/lib/rate-limit-distributed.ts`（纯函数：窗口对齐/决策/TTL/容量/失败策略）+ `src/lib/rate-limit-pg.ts`（PG `INSERT...ON CONFLICT` 原子递增，多实例共享 `inquiry_rate_limit` 表）+ 迁移建表（含 `window_start` 索引）；route.ts 改用 `runDistributedRateLimit`，配置 `maxKeys=100_000` 容量保护 + `pruneIntervalMs=5min` TTL 回收 + `failOpen=true` 失败策略（PG 不可用放行 + 告警，下游幂等键兜底）。20 项 distributed 单元测试 + 30 项 route 集成测试（mock PG deps）+ 全量 1953 项回归通过。旧 `src/lib/rate-limit.ts` 已删除。证据见 `artifacts/verification/OPT-017/README.md`。

### P1：任务文档中的性能与监控证据高于实际实现 ✅ 已修复

F7.4 已勾选完成，但文档同时注明 LCP、INP、CLS 尚未在生产环境实测。F7.8 声称已经接入 `web-vitals`，实际依赖和源码中没有该库或采集实现；真实 analytics 闭环也已在 OPT-010 中确认缺失。

因此性能预算、错误率、询盘成功率、无效供给曝光和 Core Web Vitals 均没有生产采集与告警证据。

**修复**：接入 `web-vitals@^6.0.0`，新增 `src/lib/observability/thresholds.ts`（Web Vitals + SLI 阈值与评级，单一事实源）+ `src/lib/frontend/analytics/web-vitals.ts`（复用 OPT-010 collector 流水线采集 LCP/INP/CLS/TTFB/FCP，评级统一走 thresholds）+ `src/lib/observability/sli.ts`（SLI 聚合纯函数，注入查询依赖）+ `/api/observability/sli` 端点（fail-closed API key 鉴权，返回成功率/限流 IP/提交量与评级，不暴露 PII）+ `src/lib/rate-limit-config.ts`（限流配置提取共享）。告警契约见 `docs/observability/alerting.md`（指标分层、阈值表、5 条 SLI + 3 条 Web Vitals p75 告警规则、抑制/恢复、Runbook、待接入清单）。42 项可观测性单测 + 全量 1995 项回归通过，typecheck 通过。证据见 `artifacts/verification/OPT-018/README.md`。

### P2：存在无业务用途的公开示例路由

生产构建包含 `/my-route`，它初始化 Payload 后返回固定示例文本。该路由没有鉴权、限流或业务用途，会增加无谓的数据库初始化入口和公开攻击面。

### P2：缺少统一生产安全响应头

Next 配置只设置 Turbopack 与远程图片规则，没有统一的 CSP、frame-ancestors/X-Frame-Options、Referrer-Policy、Permissions-Policy 和 HSTS 策略。平台层可能补充部分响应头，但仓库没有可验证的契约或自动测试。

## 状态判定

- M8.1～M8.7：保持未完成。
- F7.4：实现了静态性能守护，但不应以此代表生产性能验收完成。
- F7.7：本轮类型、测试、构建通过；lint 仍由 OPT-012 阻断，且本机 Node 版本不等价。
- F7.8：未完成。

## 推荐修复顺序

1. OPT-014：补齐迁移索引，修复预检解析并增加“目录/索引集合相等”测试。
2. OPT-015：生产环境强制 PostgreSQL、强密钥及合法站点 URL，缺失直接启动失败。
3. OPT-016：CI 增加完整质量门禁，将迁移从多实例启动阶段移至单次发布作业，建立灰度与回滚。
4. OPT-017：将限流迁移到带 TTL 的共享原子存储，并设置总容量保护。
5. OPT-019：删除示例路由，建立安全响应头与自动测试。
6. OPT-018：部署候选环境后采集真实 Web Vitals 和业务 SLI，完成告警与生产演练。
