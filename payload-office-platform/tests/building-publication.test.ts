import { describe, expect, it } from 'vitest'

import {
  BUILDING_PUBLISH_ACTIONS,
  BUILDING_STATUSES,
  BUILDING_STATUS_LABELS,
  isBuildingPublishAction,
  isBuildingStatus,
  nextBuildingStatus,
} from '@/domain/supply/building-publication'

/**
 * 楼盘发布状态（status：草稿 / 已发布 / 下架）的上下架转移（OPT-113）。
 *
 * 与启停轴 operationalStatus 正交；这里只管列表批量上下架会用到的两步转移。
 */

describe('nextBuildingStatus', () => {
  it('草稿 → 上架 → 已发布', () => {
    expect(nextBuildingStatus('draft', 'publish')).toBe('published')
  })

  it('下架 → 上架 → 已发布（重新上架）', () => {
    expect(nextBuildingStatus('archived', 'publish')).toBe('published')
  })

  it('已发布 → 下架 → 下架', () => {
    expect(nextBuildingStatus('published', 'unpublish')).toBe('archived')
  })

  it('已发布再上架不适用', () => {
    expect(nextBuildingStatus('published', 'publish')).toBeNull()
  })

  it('草稿不能下架（从没上过架）', () => {
    expect(nextBuildingStatus('draft', 'unpublish')).toBeNull()
  })

  it('已下架再下架不适用', () => {
    expect(nextBuildingStatus('archived', 'unpublish')).toBeNull()
  })

  it.each([null, undefined, '', 'active', 42])('当前状态非法（%s）→ 不适用', (status) => {
    expect(nextBuildingStatus(status, 'publish')).toBeNull()
    expect(nextBuildingStatus(status, 'unpublish')).toBeNull()
  })
})

describe('类型守卫与标签', () => {
  it('动作只有上架 / 下架两种', () => {
    expect(BUILDING_PUBLISH_ACTIONS).toEqual(['publish', 'unpublish'])
    expect(isBuildingPublishAction('publish')).toBe(true)
    expect(isBuildingPublishAction('unpublish')).toBe(true)
    expect(isBuildingPublishAction('mark_leased')).toBe(false)
    expect(isBuildingPublishAction(undefined)).toBe(false)
  })

  it('状态值域与 Buildings.status 选项一致', () => {
    expect(BUILDING_STATUSES).toEqual(['draft', 'published', 'archived'])
    expect(isBuildingStatus('archived')).toBe(true)
    expect(isBuildingStatus('unpublished')).toBe(false)
  })

  it('每个状态都有中文标签', () => {
    for (const status of BUILDING_STATUSES) {
      expect(BUILDING_STATUS_LABELS[status].length).toBeGreaterThan(0)
    }
  })
})
