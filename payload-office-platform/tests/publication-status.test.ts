import { describe, expect, it } from 'vitest'

import {
  PUBLICATION_STATUSES,
  PUBLICATION_STATUS_LABELS,
  isPublicationStatus,
  PUBLISH_ACTIONS,
  PUBLISH_ACTION_LABELS,
  isPublishAction,
  canTransitionPublication,
  nextPublicationStatus,
  SUPPLY_VISIBILITY_HOLDS,
  SUPPLY_VISIBILITY_HOLD_LABELS,
  isSupplyVisibilityHold,
  mapLegacyStatusToPublication,
} from '@/domain/review/publication-status'

/**
 * M4.6 发布状态机 + M4.8 供给可见性冻结枚举单测（design §3.4）
 *
 * 发布轴独立于审核轴：草稿 → 已发布 → 已下架；任意态 → 已租。
 * 发布到 published 需审核通过 + 有效供给谓词(前置条件在 endpoint 校验,枚举只管转移合法性)。
 */

describe('publication-status/枚举', () => {
  it('四个状态', () => {
    expect(PUBLICATION_STATUSES).toEqual(['draft', 'published', 'unpublished', 'leased'])
  })

  it('每个状态都有非空中文 label', () => {
    for (const s of PUBLICATION_STATUSES) {
      expect(PUBLICATION_STATUS_LABELS[s].trim().length).toBeGreaterThan(0)
    }
  })

  it('isPublicationStatus 守卫', () => {
    expect(isPublicationStatus('draft')).toBe(true)
    expect(isPublicationStatus('leased')).toBe(true)
    expect(isPublicationStatus('archived')).toBe(false)
    expect(isPublicationStatus(null)).toBe(false)
  })
})

describe('publication-status/发布动作', () => {
  it('三个动作:发布/下架/成交', () => {
    expect(PUBLISH_ACTIONS).toEqual(['publish', 'unpublish', 'mark_leased'])
  })

  it('每个动作都有非空中文 label', () => {
    for (const a of PUBLISH_ACTIONS) {
      expect(PUBLISH_ACTION_LABELS[a].trim().length).toBeGreaterThan(0)
    }
  })

  it('isPublishAction 守卫', () => {
    expect(isPublishAction('publish')).toBe(true)
    expect(isPublishAction('submit')).toBe(false)
  })
})

describe('publication-status/状态机', () => {
  it('草稿 -publish-> 已发布', () => {
    expect(canTransitionPublication('draft', 'publish')).toBe(true)
    expect(nextPublicationStatus('draft', 'publish')).toBe('published')
  })

  it('已发布 -unpublish-> 已下架', () => {
    expect(canTransitionPublication('published', 'unpublish')).toBe(true)
    expect(nextPublicationStatus('published', 'unpublish')).toBe('unpublished')
  })

  it('已下架 -publish-> 已发布(重新上架)', () => {
    expect(canTransitionPublication('unpublished', 'publish')).toBe(true)
    expect(nextPublicationStatus('unpublished', 'publish')).toBe('published')
  })

  it('草稿/已发布/已下架 -mark_leased-> 已租', () => {
    expect(nextPublicationStatus('draft', 'mark_leased')).toBe('leased')
    expect(nextPublicationStatus('published', 'mark_leased')).toBe('leased')
    expect(nextPublicationStatus('unpublished', 'mark_leased')).toBe('leased')
  })

  it('已发布不能重复 publish', () => {
    expect(canTransitionPublication('published', 'publish')).toBe(false)
  })

  it('草稿不能直接 unpublish', () => {
    expect(canTransitionPublication('draft', 'unpublish')).toBe(false)
  })

  it('已租为终态,任何动作都非法', () => {
    expect(canTransitionPublication('leased', 'publish')).toBe(false)
    expect(canTransitionPublication('leased', 'unpublish')).toBe(false)
    expect(canTransitionPublication('leased', 'mark_leased')).toBe(false)
  })
})

describe('supply-visibility-hold/枚举', () => {
  it('两个态:正常/待复核', () => {
    expect(SUPPLY_VISIBILITY_HOLDS).toEqual(['normal', 'pending_recheck'])
  })

  it('每个态都有非空中文 label', () => {
    for (const h of SUPPLY_VISIBILITY_HOLDS) {
      expect(SUPPLY_VISIBILITY_HOLD_LABELS[h].trim().length).toBeGreaterThan(0)
    }
  })

  it('isSupplyVisibilityHold 守卫', () => {
    expect(isSupplyVisibilityHold('normal')).toBe(true)
    expect(isSupplyVisibilityHold('pending_recheck')).toBe(true)
    expect(isSupplyVisibilityHold('frozen')).toBe(false)
  })
})

describe('publication-status/legacy status 映射', () => {
  it('available/reserved -> draft(未经审核不得视为已发布)', () => {
    expect(mapLegacyStatusToPublication('available')).toBe('draft')
    expect(mapLegacyStatusToPublication('reserved')).toBe('draft')
  })

  it('leased -> leased', () => {
    expect(mapLegacyStatusToPublication('leased')).toBe('leased')
  })

  it('archived -> unpublished', () => {
    expect(mapLegacyStatusToPublication('archived')).toBe('unpublished')
  })

  it('未知值 -> draft(保守默认)', () => {
    expect(mapLegacyStatusToPublication('whatever')).toBe('draft')
    expect(mapLegacyStatusToPublication(null)).toBe('draft')
  })
})
