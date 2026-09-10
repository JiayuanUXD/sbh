import { describe, expect, it } from 'vitest'
import {
  availablePublicationActions,
  permissionForPublishAction,
} from '@/domain/listing/publication-actions'
import {
  PUBLICATION_STATUSES,
  PUBLISH_ACTIONS,
  PUBLISH_ACTION_LABELS,
  canTransitionPublication,
} from '@/domain/review/publication-status'

const full = { canPublish: true, canUnpublish: true }

describe('availablePublicationActions', () => {
  it('已上架的租赁房源：下架 + 标记已租，顺序固定', () => {
    const actions = availablePublicationActions({
      publicationStatus: 'published', businessType: 'lease', ...full,
    }).map((a) => a.action)
    expect(actions).toEqual(['unpublish', 'mark_leased'])
  })

  it('已上架的出售房源：下架 + 标记已售，不给标记已租', () => {
    const actions = availablePublicationActions({
      publicationStatus: 'published', businessType: 'sale', ...full,
    }).map((a) => a.action)
    expect(actions).toEqual(['unpublish', 'mark_sold'])
  })

  it('已下架：重新上架 + 成交；标题写「重新上架」', () => {
    const specs = availablePublicationActions({
      publicationStatus: 'unpublished', businessType: 'lease', ...full,
    })
    expect(specs.map((a) => a.action)).toEqual(['publish', 'mark_leased'])
    expect(specs[0].confirmTitle).toContain('重新上架')
  })

  it('终态（leased / sold）没有任何动作', () => {
    for (const status of ['leased', 'sold'] as const) {
      expect(availablePublicationActions({ publicationStatus: status, businessType: null, ...full })).toEqual([])
    }
  })

  it('无 listing:unpublish 时不给下架；无 listing:publish 时不给上架与成交', () => {
    expect(
      availablePublicationActions({ publicationStatus: 'published', businessType: 'lease', canPublish: true, canUnpublish: false }).map((a) => a.action),
    ).toEqual(['mark_leased'])
    expect(
      availablePublicationActions({ publicationStatus: 'published', businessType: 'lease', canPublish: false, canUnpublish: true }).map((a) => a.action),
    ).toEqual(['unpublish'])
  })

  it('与状态机一致：返回的每个动作都是合法转移；有权限时每个合法转移都被返回（按租售各取一个成交动作）', () => {
    for (const status of PUBLICATION_STATUSES) {
      for (const businessType of ['lease', 'sale'] as const) {
        const returned = availablePublicationActions({ publicationStatus: status, businessType, ...full }).map((a) => a.action)
        for (const action of returned) expect(canTransitionPublication(status, action)).toBe(true)
        const expected = PUBLISH_ACTIONS.filter((action) => {
          if (!canTransitionPublication(status, action)) return false
          if (action === 'mark_leased') return businessType !== 'sale'
          if (action === 'mark_sold') return businessType === 'sale'
          return true
        })
        expect([...returned].sort()).toEqual([...expected].sort())
      }
    }
  })

  it('文案来自 PUBLISH_ACTION_LABELS；成交动作正文明写撤销推荐；下架要求原因', () => {
    const specs = availablePublicationActions({ publicationStatus: 'published', businessType: 'lease', ...full })
    for (const s of specs) expect(s.label).toBe(PUBLISH_ACTION_LABELS[s.action])
    const unpublish = specs.find((s) => s.action === 'unpublish')!
    expect(unpublish.requiresReason).toBe(true)
    expect(unpublish.tone).toBe('warning')
    const leased = specs.find((s) => s.action === 'mark_leased')!
    expect(leased.requiresReason).toBe(false)
    expect(leased.tone).toBe('danger')
    expect(leased.confirmBody.join('')).toContain('撤销首页推荐')
    expect(leased.confirmBody.join('')).toContain('不可撤销')
  })
})

describe('permissionForPublishAction', () => {
  it('unpublish → listing:unpublish，其余 → listing:publish（与端点 permissionForAction 同口径）', () => {
    expect(permissionForPublishAction('unpublish')).toBe('listing:unpublish')
    for (const a of ['publish', 'mark_leased', 'mark_sold'] as const) expect(permissionForPublishAction(a)).toBe('listing:publish')
  })
})
