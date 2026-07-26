# 审查优化清单

> 第二阶段 OPT-005～OPT-008 已完成只读审查，均待修复。统一证据见
> `data-correctness-audit.md`。

## 第一批：发布阻断

| ID | 工作项 | 关联发现 | 完成标准 |
| --- | --- | --- | --- |
| OPT-001 | ✅ 修复审核记录与队列的数据权限 | P0-01 | 已完成；证据见 `artifacts/verification/OPT-001/README.md` |
| OPT-002 | 🔍 实现审核、发布、审计、事件真实事务 | P0-02、P0-03 | 审查完成、待修复；报告见 `opt-002-transaction-audit.md` |
| OPT-003 | 🔍 重构审核任务认领与职责隔离 | P1-01 | 审查完成、待修复；报告见 `opt-003-review-task-audit.md` |
| OPT-004 | ✅ 修复 SQLite schema/迁移冲突 | P1-08 | 已完成：现有副本和全新库通过并发及重复冷启动验证；证据见 `artifacts/verification/OPT-004/README.md` |

## 第二批：数据正确性

| ID | 工作项 | 关联发现 | 完成标准 |
| --- | --- | --- | --- |
| OPT-005 | ✅ 移除有效供给候选截断 | P1-02 | 已完成；见 `artifacts/verification/OPT-005-008/README.md` |
| OPT-006 | ✅ 修复举报暂停 fail-open | P1-03 | 已完成；见 `artifacts/verification/OPT-005-008/README.md` |
| OPT-007 | ✅ 重构当前商户关系与媒体有效性 | P1-05、P1-06、P1-07 | 已完成；见 `artifacts/verification/OPT-005-008/README.md` |
| OPT-008 | 🟡 sitemap 分页/分片 | P1-04 | 已消除数据源截断；50,000+ URL 自动分片待完成 |

## 第三批：前台验收闭环

> 第三阶段 OPT-009～OPT-013 全部修复完成（2026-07-26）：OPT-009 移动筛选预估数、OPT-010 可插拔埋点框架、OPT-011 浏览器验收闭环、OPT-012 lint 与缓存契约、OPT-013 详情页语义。统一证据见 `frontend-acceptance-audit.md` 与各 `artifacts/verification/OPT-0xx/`。

| ID | 工作项 | 关联发现 | 完成标准 |
| --- | --- | --- | --- |
| OPT-009 | ✅ 实现移动筛选预估数 | P2-01 | 暂存条件变化后 N 使用同一 facet/total 口径更新。证据见 `artifacts/verification/OPT-009/README.md` |
| OPT-010 | ✅ 接入真实埋点采集 | P2-02 | 事件名称、属性、隐私、去重和失败策略有自动测试。证据见 `artifacts/verification/OPT-010/README.md` |
| OPT-011 | ✅ 完成桌面/移动浏览器验收 | P2-03 | 关键路径、404、空态、租金单位、停用场景均有截图和结果。证据见 `artifacts/verification/OPT-011/README.md` |
| OPT-012 | ✅ 清理 lint 压制和缓存标签契约 | P2-04、P2-05 | 无规则压制；缓存失效集成测试验证真实 Next 行为。证据见 `artifacts/verification/OPT-012/README.md` |
| OPT-013 | ✅ 修复详情页日期与标题语义 | P2-06 | 日期本地化；页面不存在重复同名章节标题。证据见 `artifacts/verification/OPT-013/README.md` |

## 第四批：生产上线与工程门禁

> 第四阶段已完成只读审查，存在两项发布阻断。统一证据见 `production-readiness-audit.md`。
> 修复进展（2026-07-26）：OPT-014、OPT-015 已完成（P0 发布阻断全部消除）。

| ID | 工作项 | 严重级别 | 完成标准 |
| --- | --- | --- | --- |
| OPT-014 | ✅ 修复迁移清单与预检可信度 | P0 | 迁移目录与索引集合一致；漏项、危险项和不可回滚项能确定性阻断。证据见 `artifacts/verification/OPT-014/README.md` |
| OPT-015 | ✅ 生产配置 fail-closed | P0 | 生产缺少 PostgreSQL、强密钥或合法站点 URL 时拒绝启动。证据见 `artifacts/verification/OPT-015/README.md` |
| OPT-016 | 建立 CI/CD 质量门禁与渐进发布 | P1 | 锁定工具版本；发布前质量门通过；迁移单次执行；支持灰度、冒烟和回滚 |
| OPT-017 | 实现分布式限流与资源上限 | P1 | 多实例共享原子额度、TTL 回收、容量保护及失败策略有测试 |
| OPT-018 | 接入生产可观测性与性能实测 | P1 | Web Vitals 和关键业务 SLI 有真实采集、阈值、看板和告警证据 |
| OPT-019 | 收敛公开调试面与安全响应头 | P2 | 删除示例路由；生产安全头具备自动测试与部署响应证据 |

## 推荐执行顺序

`OPT-014 → OPT-015 → OPT-002 → OPT-003 → OPT-008 → OPT-012 → OPT-009/010 → OPT-016/017/019 → OPT-011/018`

每个工作项应单独建立 task packet，修复提交与任务标记提交分离。只有完成标准和证据均满足后，才能重新勾选相关 tasks.md 条目。
