# MP-105L 005 一次性 marker 本地审计

> 日期：2026-09-02
> 范围：仅本地代码、Git 公共状态文件和隔离测试；未读取云端、未调用 mutation、未删除或改写真实 marker

## 1. 观察事实

- 分支：`feat/miniprogram-mvp-59f9`
- HEAD：`8eab1a17cfe5800d1778fbad2d47cf4c54542d87`
- 公共 marker：`.git/codex-state/mp105l-cloudrun-005-candidate.write-consumed`
- marker 创建时间：`2026-09-02T11:03:21+0800`
- marker 文件名属于 MP-105L/005，但正文记录的是 `sbhmini-004` 与 commit `3b88f0858399234f204ff7b8668b18c387a5508f`。
- 未找到 MP-105L 005 候选部署结算报告；本地也没有正在运行的 MP-105L/MP-105M 进程。

## 2. 根因

`mp105l-cloudrun-005-candidate.mjs` 原先直接复用 `mp105h-cloudrun-candidate-004.mjs` 导出的 `createAtomicWriteMarker()`。该 helper 的 marker 正文使用其 004 模块闭包内的候选版本和 commit 常量，因此换成 005 的 marker 路径后，正文仍会固定写成 004 身份。

执行顺序同时确认：

1. 本地身份与 003 回滚后基线检查；
2. 生成并上传候选包；
3. 再次读取基线；
4. **先持久化一次性 marker**；
5. 后调用一次 `UpdateCloudRunServer`；
6. 无论写响应是否明确，都只读结算且禁止重放。

因此，现有 marker 能证明一次性预算已消费，但不能单独证明：

- 005 是否已创建；
- 写请求是否到达云端；
- task/release 是否生成或完成；
- 005 是否获得流量；
- 云端实际 commit/build-info 是否为 `8eab1a1`。

marker 正文中的 004 身份是本地序列化缺陷，也不能反向证明云端请求目标是 004。

## 3. 本地修正

- `createAtomicWriteMarker()` 增加显式且受校验的 `markerIdentity` 注入，默认 004 行为保持不变。
- MP-105L 增加 `makeCandidate005Marker()`，固定写入 `sbhmini-005` 与 commit `8eab1a17cfe5800d1778fbad2d47cf4c54542d87`。
- 新增回归测试，验证临时 005 marker 的 version/commit 身份。
- MP-105M 测试夹具补齐遗漏的 `OLD_ENV_ID` 导入；此前该遗漏会触发 `ReferenceError` 并被安全映射为 `PROMOTE_005_READ_FAILED`。

这些工具位于被忽略的 `.superpowers/sdd/`，本轮未提交、未推送。

## 4. 纯本地验证

```text
node --test .superpowers/sdd/mp105h-cloudrun-004.test.mjs
结果：26/26 通过

node --test .superpowers/sdd/mp105l-cloudrun-005-candidate.test.mjs
结果：10/10 通过

node --test .superpowers/sdd/mp105m-cloudrun-005-promote.test.mjs
结果：17/17 通过
```

三组测试只使用临时 marker。真实 MP-105L marker 的 SHA-256 在测试前后保持一致，未被改写。

## 5. 本地审计时点的结论与硬门

在本地审计完成、尚未执行后续云端只读对账的时点，云端结论必须保持：**005 状态未确认**。

禁止执行：

- 重放 MP-105L 候选写；
- 删除、重命名或覆盖现有 marker；
- MP-105M 全量推广；
- 自动补偿、回滚或任何数据库写；
- 根据 marker 正文宣称 005 已部署成功。

该审计时点的下一步只能在用户再次明确确认后执行独立只读对账：读取 003/004/005 revision、流量、release/task、版本环境与 commit/build-info 身份；不得调用 mutation，也不得在对账后自动采取补偿动作。后续执行结果见第 6 节。


## 6. 后续只读对账（2026-09-02）

用户确认后已执行两轮独立 Describe-only 云端快照，确认 005 正确创建、状态 `normal`、环境 commit/revision 精确匹配且保持 0% 流量；release `2542417` 为 open，task `2054487` 为 running。实际运行产物 build-info 尚未确认。该后续结果见 `mp105l-005-read-only-reconciliation.md`，并不改变本审计关于 marker 缺陷、一次性预算已消费和禁止重放的结论。
