import { describe, expect, it } from 'vitest'

import { MIN_EFFECTIVE_MEDIA } from '@/domain/review/effective-supply'
import { deriveListingSelfVisibility } from '@/domain/review/listing-self-visibility'

/**
 * OPT-030 §4 编辑页「前台可见性」自身条件判定单测。
 *
 * 关键口径：
 *   - 判值必须与 getEffectiveSupplyWhere 查询层谓词一致
 *     （published / approved / normal），这是「复用同一口径」的最小闭环；
 *   - 媒体下限复用 MIN_EFFECTIVE_MEDIA（与提交审核的 MIN_SUBMIT_MEDIA 同一条线）；
 *   - 跨对象条件（商户 / 楼盘 / 服务城市 / 陈旧）不纳入，selfVisible 不冒充前台可见。
 */

const allPass = {
  publicationStatus: 'published',
  reviewStatus: 'approved',
  supplyVisibilityHold: 'normal',
  galleryCount: 3,
  reportPaused: false,
}

describe('deriveListingSelfVisibility', () => {
  it('自身条件全满足时 selfVisible=true 且无主因', () => {
    const result = deriveListingSelfVisibility(allPass)
    expect(result.selfVisible).toBe(true)
    expect(result.primaryBlocker).toBeNull()
    expect(result.checks).toHaveLength(5)
    expect(result.checks.every((c) => c.ok)).toBe(true)
  })

  it('任一状态条件不满足即整体不可见，主因取首个不满足项', () => {
    const result = deriveListingSelfVisibility({
      ...allPass,
      publicationStatus: 'draft',
      reviewStatus: 'not_submitted',
    })
    expect(result.selfVisible).toBe(false)
    // 展示顺序即优先级：发布状态在前。
    expect(result.primaryBlocker?.key).toBe('publicationStatus')
    expect(result.primaryBlocker?.label).toContain('未上架')
  })

  it('判值与 getEffectiveSupplyWhere 查询层谓词一致（published/approved/normal）', () => {
    // 非法 / 缺省值一律按不满足处理（fail-closed），与查询层 equals 谓词语义一致。
    for (const bad of [undefined, null, 'draft', 'unpublished', 'leased', 42]) {
      expect(
        deriveListingSelfVisibility({ ...allPass, publicationStatus: bad }).selfVisible,
        `publicationStatus=${String(bad)} 应判不可见`,
      ).toBe(false)
    }
    for (const bad of [undefined, null, 'pending', 'rejected', 'not_submitted']) {
      expect(
        deriveListingSelfVisibility({ ...allPass, reviewStatus: bad }).selfVisible,
        `reviewStatus=${String(bad)} 应判不可见`,
      ).toBe(false)
    }
    for (const bad of [undefined, null, 'pending_recheck']) {
      expect(
        deriveListingSelfVisibility({ ...allPass, supplyVisibilityHold: bad }).selfVisible,
        `supplyVisibilityHold=${String(bad)} 应判不可见`,
      ).toBe(false)
    }
  })

  it('媒体条件复用 MIN_EFFECTIVE_MEDIA，差 1 张时给出差距与定位', () => {
    const result = deriveListingSelfVisibility({
      ...allPass,
      galleryCount: MIN_EFFECTIVE_MEDIA - 1,
    })
    expect(result.selfVisible).toBe(false)
    const gallery = result.checks.find((c) => c.key === 'gallery')
    expect(gallery?.ok).toBe(false)
    expect(gallery?.label).toBe(`有效图片 ${MIN_EFFECTIVE_MEDIA - 1}/${MIN_EFFECTIVE_MEDIA}`)
    expect(gallery?.hint).toContain('还差 1 张')
    expect(gallery?.locateTab).toBe('展示内容')
  })

  it('举报暂停单独判 false 并给出举报定位（无表单 Tab）', () => {
    const result = deriveListingSelfVisibility({ ...allPass, reportPaused: true })
    expect(result.selfVisible).toBe(false)
    const paused = result.checks.find((c) => c.key === 'reportPaused')
    expect(paused?.ok).toBe(false)
    expect(paused?.locateTab).toBeNull()
  })

  it('状态类检查定位到「审核与发布」Tab，便于点击跳转修复', () => {
    const result = deriveListingSelfVisibility({ ...allPass, publicationStatus: 'draft' })
    expect(result.primaryBlocker?.locateTab).toBe('审核与发布')
  })
})
