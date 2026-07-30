# Task Packet：FPD-P0 详情页核心结构化字段

> 状态：已完成  
> 创建日期：2026-07-30  
> 最后更新：2026-07-30

## 1. 目标

为房源和楼盘详情页建立可迁移、可校验的结构化字段，覆盖空间、费用、媒体、认证与核验信息。

## 2. 非目标

- 本任务不实现详情页前台渲染、搜索筛选或历史数据回填。

## 3. 权威上下文

- Task：`.superpowers/sdd/task-1-brief.md`
- 页面 PRD：P0 详情页核心字段要求。

## 4. 当前行为与证据

- 当前房源、楼盘仅有通用租赁参数、图库和配套，缺少详情页专用结构化字段。

## 5. 影响范围

- 数据模型/迁移：Listings、Buildings 及 Payload 生成类型。
- 风险：认证公开状态必须受有效期约束；原有图库字段保持不变。

## 6. 实施清单

- [x] 建立失败的保护测试。
- [x] 增加原生 Payload 结构化字段、枚举与保护校验。
- [x] 生成类型和数据库迁移。
- [x] 完成聚焦、类型与全量测试。

## 7. 验收

- 房源提供 spaceDetails、costTerms、registrationStatus、mediaItems、verificationInfo。
- 楼盘提供 developerAndScale、verticalTransport、buildingServices、certifications、mediaItems、verificationInfo。
- 得房率/工位区间和公开过期认证均被保护 hook 拒绝。

## 8. 结果

- 修改文件：Listings、Buildings、保护 hook、枚举、Payload 类型和生成迁移。
- 实际结果：详情页结构化字段与不变量保护已建立。
- 验证摘要：聚焦测试 40/40、类型检查、全量测试 2128/2128 均通过。
- 剩余风险：生成迁移同时收敛既有 audit_logs 与 legacy listings.status 的 schema drift；已由迁移保护测试明确记录。
