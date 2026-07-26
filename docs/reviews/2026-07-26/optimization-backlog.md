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

> 第三阶段 OPT-009～OPT-013 已完成只读审查。OPT-013 已修复完成；OPT-011 为部分完成；OPT-009/010/012 待修复。统一证据见 `frontend-acceptance-audit.md`。

| ID | 工作项 | 关联发现 | 完成标准 |
| --- | --- | --- | --- |
| OPT-009 | 实现移动筛选预估数 | P2-01 | 暂存条件变化后 N 使用同一 facet/total 口径更新 |
| OPT-010 | 接入真实埋点采集 | P2-02 | 事件名称、属性、隐私、去重和失败策略有自动测试 |
| OPT-011 | 完成桌面/移动浏览器验收 | P2-03 | 关键路径、404、空态、租金单位、停用场景均有截图和结果 |
| OPT-012 | 清理 lint 压制和缓存标签契约 | P2-04、P2-05 | 无规则压制；缓存失效集成测试验证真实 Next 行为 |
| OPT-013 | ✅ 修复详情页日期与标题语义 | P2-06 | 日期本地化；页面不存在重复同名章节标题。证据见 `artifacts/verification/OPT-013/README.md` |

## 推荐执行顺序

`OPT-004 → OPT-001 → OPT-002 → OPT-003 → OPT-005/006/007 → OPT-008 → OPT-009/010 → OPT-011/012`

每个工作项应单独建立 task packet，修复提交与任务标记提交分离。只有完成标准和证据均满足后，才能重新勾选相关 tasks.md 条目。
