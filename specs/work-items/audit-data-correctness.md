# Task Packet：AUDIT-DATA-002 数据正确性审查

> 状态：已完成
> 日期：2026-07-26

## 目标

只读核验优化清单第二阶段 OPT-005～OPT-008 的真实状态，包括公开目录分页与排序、举报暂停排除、商户关系时点一致性和 sitemap 完整性。

## 范围

- `src/domain/public-catalog/`
- `src/domain/review/effective-supply*.ts`
- `src/domain/supply/building-aggregate.ts`
- `src/app/(frontend)/sitemap.ts`
- 对应有效供给、举报、聚合和生产等价性测试

## 非目标

- 本任务不修改业务实现。
- 本任务不恢复相关 Tasks 完成标记。
- OPT-002、OPT-003 的修复不在本次审查范围。

## 结论

OPT-005～OPT-008 均未达到完成标准。详细证据和建议见：

`../../docs/reviews/2026-07-26/data-correctness-audit.md`
