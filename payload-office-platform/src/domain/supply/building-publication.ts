/**
 * 楼盘发布状态（`Buildings.status`）与上下架转移（OPT-113）。
 *
 * 楼盘有两条互相独立的轴：
 *   - 发布状态 `status`：草稿 / 已发布 / 下架——本文件；
 *   - 启停状态 `operationalStatus`：启用 / 停用——`building.ts`，走 building:freeze 专用端点。
 * 两条轴任一不满足，楼盘都不在前台出现（`public-building.ts`）。
 *
 * 转移只有两步，写成表而不是 if，是为了让列表的「将跳过 N 条」预筛与端点的逐条校验
 * 读同一张表：列表说能做的，端点一定认；端点拒绝的，列表事先就能说出来。
 */

export const BUILDING_STATUSES = ['draft', 'published', 'archived'] as const
export type BuildingStatus = (typeof BUILDING_STATUSES)[number]

export const BUILDING_STATUS_LABELS: Record<BuildingStatus, string> = {
  draft: '草稿',
  published: '已发布',
  archived: '下架',
}

export function isBuildingStatus(value: unknown): value is BuildingStatus {
  return typeof value === 'string' && (BUILDING_STATUSES as readonly string[]).includes(value)
}

export const BUILDING_PUBLISH_ACTIONS = ['publish', 'unpublish'] as const
export type BuildingPublishAction = (typeof BUILDING_PUBLISH_ACTIONS)[number]

export const BUILDING_PUBLISH_ACTION_LABELS: Record<BuildingPublishAction, string> = {
  publish: '上架',
  unpublish: '下架',
}

export function isBuildingPublishAction(value: unknown): value is BuildingPublishAction {
  return (
    typeof value === 'string' && (BUILDING_PUBLISH_ACTIONS as readonly string[]).includes(value)
  )
}

/**
 * 合法转移：from → 动作 → to，缺项即不适用。
 *
 * 草稿不能「下架」：它从没上过架，落成 archived 会让运营以为它曾经公开过。
 */
const TRANSITIONS: Record<BuildingStatus, Partial<Record<BuildingPublishAction, BuildingStatus>>> = {
  draft: { publish: 'published' },
  published: { unpublish: 'archived' },
  archived: { publish: 'published' },
}

export function nextBuildingStatus(
  from: unknown,
  action: BuildingPublishAction,
): BuildingStatus | null {
  if (!isBuildingStatus(from)) return null
  return TRANSITIONS[from][action] ?? null
}
