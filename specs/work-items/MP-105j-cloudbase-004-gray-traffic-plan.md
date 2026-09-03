# MP-105j：CloudBase 004 灰度流量工具计划

## 背景

MP-105H 已完成候选 004（`sbhmini-004`，commit `3b88f0858399234f204ff7b8668b18c387a5508f`）的受控部署。当前云端事实（2026-09-01 读态诊断）：

- 004 存在且 `status=normal`，流量 0%
- 发布单 `2535263`：`open`、`IsReleasing=true`、`TrafficType=FLOW`、`FlowRatio=0`
- 任务 `2047061`：`ReleaseType=GRAY`、`Status=running`，与发布单精确绑定
- 003 承载 100%；旧环境 019 基线不变

读侧闭环已由 MP-105I 诊断（`strictStandalone=true`）与 `mp105h-cloudrun-reconcile-004.mjs` 双严格读（`CANDIDATE_004_READ_ONLY_VERIFIED`）关闭。本阶段实现唯一受控写：灰度比例 0→N。

## 写动作与参数钉死

仅允许 `tcbr.ReleaseGray`，形状对齐官方 `@cloudbase/cloudbase-mcp` 的 `setTraffic`：

- `GrayType: "gray"`，`TrafficType: "FLOW"`，`GrayFlowRatio: N`
- `VersionFlowItems`：
  - `{ VersionName: sbhmini-003, FlowRatio: 100-N, IsDefaultPriority: true, Priority: 1 }`
  - `{ VersionName: sbhmini-004, FlowRatio: N, IsDefaultPriority: false, Priority: 2 }`

N 仅允许 `{5, 10, 20}`，默认建议 10。

## 前置门禁（连续两轮严格读全部成立才放行）

1. `assertCandidate004StandaloneSnapshot` 通过（绑定、019 基线、配置继承、order FlowRatio=0）
2. 最新任务（`TaskId=0`）等于期望任务，且 `ReleaseType=GRAY`、`Status=running`、`ReleaseId` 匹配
3. 持久写标记不存在（一次性预算）

## 写预算

一次性：`<git-common-dir>/codex-state/mp105j-cloudrun-004-traffic.write-consumed`，目录 0700、文件 0600；标记存在即拒绝任何写。

## 结算

写后只读轮询 ≤120s，按平台真实语义断言：

- order `FlowRatio===N` 且 `ReleaseStatus∈{open, gray}`
- `OnlineVersionInfos` 为权威流量分布：003===100-N、004===N（比例可为字符串）
- records 004===N；稳定版 record 的 FlowRatio 平台不回写，允许 {0, 100-N}
- 019 基线不变

超时只输出结算状态，不重发、不补偿写。2026-09-01 实测：写后 order 为 `gray`、`GrayStatus=success`、线上 90/10。

## 非目标

- 不做回滚（平台入口 `OperateServerManage go_back` 保留人工操作）
- 不做全量推进（`CloseGrayRelease`）
- 不碰生产环境、不碰数据库

## CLI

- 只读预检：`--preflight-004-gray --expected-version sbhmini-004 --expected-commit <sha> --task-id <id> --release-id <id> [--ratio N]`
- 唯一写：`--set-004-gray-flow --expected-version sbhmini-004 --expected-commit <sha> --task-id <id> --release-id <id> --ratio N`

## 测试与上线流程

离线 `node:test` 矩阵：argv 严格性、读白名单/写形状钉死、门禁反例、写预算、结算成功/超时、输出脱敏。测试全绿后，真实写必须经人工确认比例与时机，且仅一次。

## 成功标准

preflight 通过；单次写结算到 N/100-N；019 不变；无第二次写。
