# MP-105M：005 全量推广、独立结算与运行身份核验

> 日期：2026-09-02  
> 结论：`sbhmini-005` 已通过一次性推广切换为 100% 流量，独立 Describe-only 结算、`/api/health` build-info 与受保护 attestation 均通过。推广预算已经消费，严禁重放。

## 目标身份

- CloudBase 环境/服务：`sbhmini-gateway-d3fbrmn8097478b8` / `sbhmini`
- revision：`sbhmini-005`
- commit：`8eab1a17cfe5800d1778fbad2d47cf4c54542d87`
- task / release：`2054487` / `2542417`
- staging API host：`sbhmini-305971-11-1253925058.sh.run.tcloudbase.com`

## 执行与结算

1. 新鲜只读预检返回 `PROMOTE_005_PREFLIGHT_PASSED`。
2. `ReleaseGray` 推广命令严格执行一次，返回 `PROMOTE_005_SETTLED`；未重试、未补偿、未自动回滚。
3. 推广命令结束后重新创建只读 API 客户端执行独立结算，控制面确认：
   - 005：`normal`、100%、`HasTraffic=true`；
   - 003/004：0%；
   - 旧环境 `sbhmini-019` 基线未漂移。
4. 原始安全输出：`mp105m-005-promote-command.jsonl`；结构化结算：`mp105m-005-promote-settlement.json`。

## 运行产物与 attestation

- 第一次严格 Node `fetch` 在 20 秒窗口内发生不可复现的瞬态传输失败；按异常门暂停写验收，只做 DNS/TLS/HTTPS 分层只读诊断。
- DNS、TLS 1.3 和 HTTPS GET 随后正常；再次使用相同严格 `fetch` 传输栈也成功，未对云端执行修复。
- 最终 `/api/health`：HTTP 200，`status/db/payload` 均为 `ok`，`version` 精确匹配目标 commit，安全码为 `HEALTH_005_BUILD_INFO_VERIFIED`。
- 受保护 attestation：staging、acceptance 开关、commit、revision、数据库真实探针和 allowlist 均精确匹配，安全码为 `ATTESTATION_005_VERIFIED`。
- Secret、连接串和完整数据库 fingerprint 仅在进程内存中使用，未写入日志或证据。

## 一次性 marker

- inode：`267595269`
- 大小：`201` bytes
- 权限：`0600`
- mtime：`2026-09-02 15:09:01 +0800`
- SHA-256：`e951f111ee829490f5c97290f66977e7c91eb142096d89052109acfde35835d7`

MP-105N 完成后再次核验以上元数据与 SHA-256 均未变化。不得删除、改写、重命名该 marker，也不得再次执行 MP-105M。

## 结论边界

该证据证明 005 的控制面流量、运行产物身份、健康状态和受保护 acceptance 配置；不等同于微信开发者工具、图片/COS、隐私后台、iOS/Android 或真实 PostgreSQL 异常注入矩阵通过。
