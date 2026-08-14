# docs/superpowers 的留存规则

这里放 agent 生成的实施计划与设计文档。**它们是过程产物，默认不入库。**

只有满足下面任一条时才提交，且必须是被引用的那一份：

- 被源码注释引用为"设计依据"（如 `src/domain/supply-submission/*` 指向 entrust-supply 的 PRD）
- 被 `specs/work-items/OPT-0xx-*.md` 当作 Design / Plan 引用
- 承载**仍在生效**且别处没有记载的业务规则（如换乘站入库规则见 `plans/2026-08-10-geography-multi-city-admin.md` B1.5）
- 是生产数据变更的执行记录（如 `plans/2026-08-11-geography-production-import-handoff.md`）

其余一律留在本地。2026-08-15 已按此清掉 31 份零引用的计划/设计/任务报告。

本目录没有加进 `.gitignore`——因为仍有文件被跟踪，ignore 对已跟踪文件无效，加了只会造成"看着被忽略、实际在库"的错觉（同 `payload-types.ts` 的坑）。约束靠这份说明和 review。

规则若与仓库根 `CLAUDE.md` 冲突，以 `CLAUDE.md` 为准。
