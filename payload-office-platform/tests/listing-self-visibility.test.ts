import { describe, expect, it } from 'vitest'

import { deriveListingSelfVisibility } from '@/domain/review/listing-self-visibility'

/**
 * OPT-030 §4 编辑页「前台可见性」自身条件判定单测。
 *
 * 关键口径：
 *   - 判值必须与 getEffectiveSupplyWhere 查询层谓词一致
 *     （published / approved / normal），这是「复用同一口径」的最小闭环；
 *   - **图片数量不在可见性条件里**（2026-08-19 起）；提交审核的 3 张门槛由
 *     完整度引导负责，两者不能混为一谈；
 *   - 跨对象条件（商户 / 楼盘 / 服务城市 / 陈旧）不纳入，selfVisible 不冒充前台可见。
 */

const allPass = {
  publicationStatus: 'published',
  reviewStatus: 'approved',
  supplyVisibilityHold: 'normal',
  reportPaused: false,
}

describe('deriveListingSelfVisibility', () => {
  it('自身条件全满足时 selfVisible=true 且无主因', () => {
    const result = deriveListingSelfVisibility(allPass)
    expect(result.selfVisible).toBe(true)
    expect(result.primaryBlocker).toBeNull()
    expect(result.checks).toHaveLength(4)
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

  // 2026-08-19 反转：图片数量移出前台可见性。锁住「可见性卡片不再有 gallery 条」
  // ——以后谁把提交审核的 3 张门槛混回可见性判定，这里会红。
  it('无图仍判 selfVisible，且 checks 里没有 gallery 条', () => {
    const result = deriveListingSelfVisibility(allPass)
    expect(result.selfVisible).toBe(true)
    expect(result.checks.map((c) => c.key)).not.toContain('gallery')
  })

  it('举报暂停单独判 false 并给出举报定位（无表单 Tab）', () => {
    const result = deriveListingSelfVisibility({ ...allPass, reportPaused: true })
    expect(result.selfVisible).toBe(false)
    const paused = result.checks.find((c) => c.key === 'reportPaused')
    expect(paused?.ok).toBe(false)
    expect(paused?.locateTab).toBeNull()
  })

  it('状态类检查定位到「房源信息」Tab，便于点击跳转修复', () => {
    // OPT-032：5 个 tab 收成 2 个，「审核与发布」降级为 collapsible 分节，
    // 状态类检查的定位目标随之变为「房源信息」，再由 locateFieldLabel 滚到具体字段。
    // locateCheck 按 tab 按钮文字匹配，取值与 Listings.ts 的 tab label 必须逐字一致，
    // 对不上会静默不动作——这条断言就是那道闸。
    const result = deriveListingSelfVisibility({ ...allPass, publicationStatus: 'draft' })
    expect(result.primaryBlocker?.locateTab).toBe('房源信息')
    expect(result.primaryBlocker?.locateFieldLabel).toBe('发布状态')
  })
})
