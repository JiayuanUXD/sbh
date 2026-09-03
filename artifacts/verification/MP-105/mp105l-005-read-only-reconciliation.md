# MP-105L 005 云端只读对账

> 日期：2026-09-02
> 观察窗口：2026-09-02 14:45:29–14:46:30（Asia/Shanghai）
> 范围：CloudBase/CloudRun Describe-only 查询；未调用 mutation、未发起 revision 定向 HTTP、未删除或改写 marker

## 1. 只读边界

本轮临时探针仅允许以下 API：

- `tcbr`：`DescribeCloudRunServerDetail`、`DescribeCloudRunDeployRecord`、`DescribeVersionDetail`、`DescribeReleaseOrder`、`DescribeServerManageTask`
- `tcb`：`DescribeCloudBaseRunServerVersion`

探针源代码在执行前通过静态禁写扫描，不包含 `UpdateCloudRunServer`、`ReleaseGray`、创建、回滚、删除、构建服务、直接 HTTP `fetch` 或本地 marker 写操作。真实 MP-105L marker 在对账前后保持同一 inode、大小、mtime 和 SHA-256：

```text
ab9edf3d70f921d22d904d664df38b54600b1434110a793a3153d6c91fe838f8
```

## 2. 两轮一致快照

两轮独立只读快照除观察时间外完全一致：

- staging 服务状态：`normal`
- 当前权威流量：`sbhmini-003 = 100%`
- `sbhmini-004`：存在、状态 `normal`、0% 流量；环境身份为 commit `3b88f0858399234f204ff7b8668b18c387a5508f` / revision `sbhmini-004`
- `sbhmini-005`：存在、状态 `normal`、0% 流量；环境身份为 commit `8eab1a17cfe5800d1778fbad2d47cf4c54542d87` / revision `sbhmini-005`
- 005 非身份环境变量与 003 完全继承，版本配置精确匹配预期
- 005 deploy record：`normal`、`FLOW`、`0%`、`HasTraffic=false`、`IsReleasing=true`
- release order：ID `2542417`，`003 → 005`，状态 `open`，`IsReleasing=true`，灰度比例 `0%`
- latest task 与按 ID 复查结果一致：task ID `2054487`，release ID `2542417`，`003 → 005`，`GRAY/CODE/package`，状态 `running`
- 旧环境 `sbhmini-019` 仍为 100% 权威版本

仓内严格候选态断言 `assertCandidate005State()` 通过，因此本轮分类为：

```text
005_CREATED_CORRECTLY_WITH_ZERO_TRAFFIC
```

该分类只表示 005 候选 revision 已正确创建并保持 0% 流量，不表示已完成灰度、推广、数据库写验收或 MP-105 总验收。

## 3. build-info 证据边界

`DescribeVersionDetail` 能确认 005 的环境身份、revision 配置和 commit 环境变量，但响应不包含部署包 `build-info.json` 内容。由于 005 为 0% 流量，本轮也没有通过默认域名请求 `/api/health` 来冒充 005 证据，更没有尝试未评审的 revision 定向路由。

因此结论拆分为：

- 005 环境 commit/revision 身份：**已确认**
- 005 版本配置与 003 非身份变量继承：**已确认**
- 005 实际运行产物的 `build-info.json` / `/api/health.version`：**未确认**

## 4. 后续硬门

本轮没有也不得自动执行：

- MP-105L 重放或 marker 删除/改写；
- MP-105M 流量推广；
- 自动补偿或回滚；
- 数据库写、咨询写或真实异常矩阵；
- 微信开发者工具、预览、上传、真机或 production 操作。

若要让 005 获得流量、核对运行产物 build-info、执行 staging 数据库写验收或采取任何补偿动作，必须重新取得用户明确授权，并继续保持 production 禁写边界。

## 5. 结构化证据

脱敏后的完整查询投影见：

- `artifacts/verification/MP-105/mp105l-005-read-only-reconciliation.json`
