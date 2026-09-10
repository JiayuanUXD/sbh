import { describe, expect, it } from 'vitest'
import {
  availablePublicationActions,
  permissionForPublishAction,
  resolveLiveListingState,
} from '@/domain/listing/publication-actions'
import {
  PUBLICATION_STATUSES,
  PUBLICATION_STATUS_LABELS,
  PUBLISH_ACTIONS,
  PUBLISH_ACTION_LABELS,
  canTransitionPublication,
  nextPublicationStatus,
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

  // businessType 缺省按 lease 处理（与 Listings 的 defaultValue: 'lease' 同口径）。
  // 这条缺省路径通向的是 mark_leased——不可逆动作，历史数据 / 未回填字段一旦落到这里
  // 而实现悄悄改成按 sale 处理，运营就会在租赁房源上看到「标记已售」。所以两个缺省值各钉一条。
  it('businessType 为 null：按租赁处理，给标记已租', () => {
    const actions = availablePublicationActions({
      publicationStatus: 'published',
      businessType: null,
      canPublish: true,
      canUnpublish: true,
    }).map((a) => a.action)
    expect(actions).toEqual(['unpublish', 'mark_leased'])
  })

  it('businessType 为 undefined：同样按租赁处理，给标记已租', () => {
    const actions = availablePublicationActions({
      publicationStatus: 'published',
      businessType: undefined,
      canPublish: true,
      canUnpublish: true,
    }).map((a) => a.action)
    expect(actions).toEqual(['unpublish', 'mark_leased'])
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

  // 确认正文里的「当前状态 → 目标状态」两端都必须来自权威常量：写死目标状态名，
  // 改一次 PUBLICATION_STATUS_LABELS 就会出现「状态徽标说 A、确认弹层说 B」。
  // 本用例同时钉住目标状态取自状态机——把 mark_sold 的目标写成「已租」立刻红。
  it('确认正文的目标状态名来自 nextPublicationStatus + PUBLICATION_STATUS_LABELS', () => {
    for (const status of PUBLICATION_STATUSES) {
      for (const businessType of ['lease', 'sale'] as const) {
        const specs = availablePublicationActions({
          publicationStatus: status,
          businessType,
          ...full,
        })
        for (const spec of specs) {
          const next = nextPublicationStatus(status, spec.action)
          expect(next).not.toBeNull()
          expect(spec.confirmBody[0]).toContain(
            `${PUBLICATION_STATUS_LABELS[status]} → ${PUBLICATION_STATUS_LABELS[next!]}`,
          )
        }
      }
    }
  })
})

describe('permissionForPublishAction', () => {
  it('unpublish → listing:unpublish，其余 → listing:publish（与端点 permissionForAction 同口径）', () => {
    expect(permissionForPublishAction('unpublish')).toBe('listing:unpublish')
    for (const a of ['publish', 'mark_leased', 'mark_sold'] as const) expect(permissionForPublishAction(a)).toBe('listing:publish')
  })
})

/**
 * 动作条在编辑页里读的是 Payload 表单的实时值，不是 RSC 渲染那一刻的快照：
 * 保存一次 protectListing 就把 version +1，而编辑视图保存成功后不重渲染
 * beforeDocumentControls，快照会停在旧版本号 → 第一次点「下架」必撞 409。
 * 这个纯函数就是「实时值优先、脏值回落初始快照」那条规则，单独钉住。
 */
describe('resolveLiveListingState', () => {
  const initial = {
    publicationStatus: 'published',
    businessType: 'lease',
    version: 21,
  } as const

  it('表单实时值优先于初始快照（保存后 21 → 22 必须跟上）', () => {
    expect(
      resolveLiveListingState(
        { publicationStatus: 'unpublished', businessType: 'sale', version: 22 },
        initial,
      ),
    ).toEqual({ publicationStatus: 'unpublished', businessType: 'sale', version: 22 })
  })

  it('字段缺失（不在表单状态里）时整体回落到初始快照', () => {
    expect(resolveLiveListingState({}, initial)).toEqual({
      publicationStatus: 'published',
      businessType: 'lease',
      version: 21,
    })
  })

  it('publicationStatus 不是合法枚举时回落', () => {
    expect(
      resolveLiveListingState({ publicationStatus: 'archived' }, initial).publicationStatus,
    ).toBe('published')
    expect(
      resolveLiveListingState({ publicationStatus: null }, initial).publicationStatus,
    ).toBe('published')
  })

  // version 会被原样当作 expectedVersion 发给端点：字符串 '22' 或 NaN 传出去就是一次
  // 说不清的 409/422，所以非有限数字一律回落，宁可用旧版本号撞一次可解释的冲突。
  it('version 不是有限数字时回落', () => {
    for (const bad of [null, undefined, '22', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveLiveListingState({ version: bad }, initial).version).toBe(21)
    }
  })

  it('businessType 非字符串时回落', () => {
    expect(resolveLiveListingState({ businessType: 3 }, initial).businessType).toBe('lease')
    expect(resolveLiveListingState({ businessType: null }, initial).businessType).toBe('lease')
  })

  it('初始快照本身允许 businessType / version 为 null', () => {
    expect(
      resolveLiveListingState(
        {},
        { publicationStatus: 'draft', businessType: null, version: null },
      ),
    ).toEqual({ publicationStatus: 'draft', businessType: null, version: null })
  })
})
