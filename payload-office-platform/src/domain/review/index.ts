/**
 * 领域：房源审核和快照（domain/review）
 *
 * 职责边界（AGENTS.md §4, §5.5, tasks.md M4.4-M4.5）：
 *   - listing_reviews：不可删除、不可改写历史
 *   - 不可变提交快照（含工作版本锁定）
 *   - 状态机：未提交 → 待审核 → 审核通过 / 已驳回 → 重新提交
 *   - 审核中工作版本锁定，使用版本号防并发覆盖（409）
 *
 * M4 实施清单：
 *   - listing_reviews Collection
 *   - 审核快照
 *   - 状态机服务
 *   - 审核 Custom View（队列 / 领取 / 详情对比 / 历史 / 通过 / 驳回）
 *
 * M0 阶段：仅占位。
 */
export const DOMAIN_TAG = 'review' as const
