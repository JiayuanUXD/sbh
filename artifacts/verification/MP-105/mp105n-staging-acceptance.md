# MP-105N：005 隔离 staging 正常路径写验收

> 执行时间：2026-09-02 15:38–15:39（Asia/Shanghai）  
> 结论：通过。目标 `sbhmini-005` 的受保护正常路径完成干净起点、首次写入、同 submission 幂等重提和精确清理，最终 Lead / follow-up / ownership history 为 `0/0/0`；未留下恢复胶囊。

## 写前只读门

- 控制面：005=100%，003/004=0%，结算断言 `PROMOTE_005_SETTLED`。
- build-info：`/api/health.version` 精确匹配 commit `8eab1a17cfe5800d1778fbad2d47cf4c54542d87`；DB 与 Payload 均为 `ok`。
- 配置：005 `EnvParams` 键集合精确，除部署身份外与 003 继承一致；`MP_ACCEPTANCE_DEPLOYMENT_ENVIRONMENT=staging`、`MP_ACCEPTANCE_ENABLED=1`。
- attestation：真实数据库 fingerprint 命中受控 allowlist；证据仅保存 12 位摘要，不保存完整值。
- 业务只读输入：从真实 listings API 选择有效房源，再从详情 API取得当前隐私政策版本 `MVP-R1`。
- 写前恢复状态：`active.json`、`.runner.lock`、`.runner.lock.claim` 均不存在。

## 运行摘要

- run UUID 摘要：`ccaad095`（仅前 8 位）
- fixture namespace：`mp-e2e-4291876f4240198c`
- locator 摘要：`4f6fad2645a5dd37`
- runner 结果码：`MP105N_STAGING_ACCEPTANCE_PASSED`
- write outcome unknown：`false`

完整脱敏事件流见 `mp105n-staging-acceptance-run.jsonl`（权限 `0600`）。证据不包含完整 run UUID、submission ID、Lead ID、手机号、permit、recovery receipt、Secret、连接串或完整数据库 fingerprint。

## 阶段计数

| 事件 | Lead | follow-up | ownership history | 结论 |
|---|---:|---:|---:|---|
| `clean_start_proven` | 0 | 0 | 0 | 干净起点 |
| `first_write_verified` | 1 | 0 | 0 | 首次写入成功 |
| `idempotency_verified` | 1 | 0 | 0 | 同 submission 重提复用同一 Lead；locator 摘要不变 |
| `cleanup_complete` | 0 | 0 | 0 | 精确清理并 fresh inspect 确认零残留 |

事件顺序严格为：

```text
attestation_verified
permit_issued
clean_start_proven
first_write_verified
idempotency_verified
cleanup_started
cleanup_complete
```

## 清理与恢复胶囊

- runner 仅在 `idempotency_verified` 持久化后调度 cleanup。
- cleanup 响应为零计数，随后使用新 inspect permit 再次观察 `0/0/0`。
- runner 删除已确认胶囊并释放锁；独立本地审计再次确认三个精确路径均不存在。
- 未执行 recovery CLI，因为没有未知写结果、清理失败或残留胶囊。

## 本地证据审计

- JSONL 共 9 行，事件顺序与预期完全一致。
- 文件权限：`0600`。
- 自动扫描未发现测试手机号、bootstrap header、recovery receipt、submission/Lead 字段、连接串或完整 UUID。
- MP-105M marker 的 inode、mtime、大小和 SHA-256 均未变化。

## 尚未覆盖

本轮只验证 005 的真实 staging **正常路径**。以下仍未执行，不能标记为通过：

- writer/recovery advisory-lock 竞争与 busy；
- commit outcome unknown 后 fresh inspect；
- cleanup 主动失败；
- SIGKILL、断连与迟到请求；
- trashed Lead 的主动异常矩阵；
- 微信开发者工具从详情页手填手机号并重提；
- iOS/Android、图片/COS、微信隐私后台、预览/上传与正式发布。
