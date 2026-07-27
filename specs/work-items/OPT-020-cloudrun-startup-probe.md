# Task Packet：OPT-020 CloudRun 部署迁移阻断

> 状态：进行中
> 创建日期：2026-07-27
> 最后更新：2026-07-27

## 1. 目标

修复 CloudBase CloudRun 新版本因生产旧区域数据无法执行 M2.1 迁移而部署失败的问题，使迁移能够兼容既有数据并让应用正常启动。

## 2. 非目标

- 本次不处理 OPT-002 审核事务、OPT-003 审核认领或媒体持久化。
- 本次不调整 CloudRun 流量、不修改用户可见功能。

## 3. 权威上下文

- Task：`specs/backend-mvp/task-details/M8-launch.md#86-完成生产演练`
- Design/Requirement：`specs/backend-mvp/design.md`
- Agent：`payload-office-platform/AGENTS.md` + `.agent/core.md` + `.agent/testing.md`
- CloudBase：CloudRun Container mode，服务 `sbh`。

## 4. 当前行为与证据

- 复现路径：GitHub Actions `Deploy to CloudBase CloudRun`，run `30251208259`。
- 当前结果：quality 全部通过；CloudBase 构建并推送镜像成功；版本 `sbh-008` 表面报告存活探针连接失败。
- 根因证据：隔离灰度版本 `sbh-009` 的容器日志显示，启动脚本在 M2.1 迁移时报错：旧值 `business-district` 无法转换为新版 `enum_locations_type`；Next.js 因迁移失败从未启动，探针失败是后续症状。
- 后续风险：原迁移即使通过枚举转换，直接新增 `immutable_code varchar NOT NULL` 也会被历史行阻断。
- 线上数据只读核对：共 5 条区域，其中 2 条为 `business-district`；现网版本仍为 `sbh-007` 且保持 100% 流量。
- 期望结果：先归一化旧类型、为历史行回填确定性唯一编码，再施加新版枚举、非空和唯一约束；失败版本不得切流。

## 5. 影响范围

- 修改文件：M2.1 既有迁移、迁移回归测试、验证证据。
- 数据模型/迁移：不新增迁移编号；修正尚未在生产成功执行的 M2.1 迁移。
- 权限：无。
- API/路由：不修改；复用 `/api/health`。
- 缓存/事件：无。
- 风险：历史 `metro` 的旧语义只有“最近地铁站”，因此升级映射为 `metro_station`；回滚时 `metro_line` 与 `metro_station` 均收敛为旧枚举 `metro`。

## 6. 实施清单

- [x] 建立失败测试或可复现用例。
- [x] 修复旧枚举归一化、历史编码回填及回滚映射。
- [x] 使用隔离 PostgreSQL 旧数据样本验证升级与回滚。
- [ ] 重新部署并验证灰度、`/api/health`、首页和后台。
- [ ] 更新文档与任务状态。

## 7. 验收

- 对应 PRD 条款：M8.6 生产演练与回滚。
- 自动化测试：CI quality 全部通过。
- 浏览器路径：`/`、`/admin`、`/api/health`。
- 数据/迁移检查：容器迁移成功；5 条线上旧区域保留；服务仍连接 PostgreSQL；旧版本在失败时不被切流。

## 8. 结果

- 修改文件：`20260725_130727_m2_1_locations_geo_node.ts`、`location-geo-migration.test.ts`。
- 实际结果：本地修复与数据库隔离验证完成，尚未提交、推送或重新部署。
- 验证摘要：专项 16 个测试通过；迁移预检 0 失败、1 个已知类型变更警告；隔离 PostgreSQL 升级和回滚成功。
- 详细证据：`../../artifacts/verification/OPT-020/README.md`
- 剩余风险：需在提交/推送后重新运行 CI 与 CloudBase 灰度，确认生产真实迁移和三个访问路径。
- 下一步：经用户确认后提交并推送，观察灰度；成功后完成 OPT-002。
