import { describe, expect, it } from 'vitest'

import { SITE_SETTINGS_FALLBACK } from '@/lib/frontend/site-settings-view'
import { SiteSettings } from '@/globals/SiteSettings'

/**
 * OPT-060：类型卡封面可配。
 *
 * 这里锁两件事：字段确实挂在**槽位行上**（不是挂在数组外、也不是靠下标绑定），
 * 以及 fallback 的形状与新类型一致——fallback 是「Global 尚未创建」和「字段被
 * 清空」两种情形的共同出口，形状对不上会在运行时才炸。
 */
function findTypeCardsField() {
  const stack: unknown[] = [...SiteSettings.fields]
  while (stack.length > 0) {
    const f = stack.pop() as Record<string, unknown>
    if (f && typeof f === 'object') {
      if (f.name === 'typeCards') return f
      if (Array.isArray(f.fields)) stack.push(...f.fields)
      if (Array.isArray(f.tabs)) stack.push(...f.tabs)
    }
  }
  return null
}

describe('SiteSettings.typeCards 封面字段', () => {
  it('coverImage 挂在槽位行上，是 media 的 upload 字段且选填', () => {
    const typeCards = findTypeCardsField() as { fields?: Array<Record<string, unknown>> } | null
    expect(typeCards).not.toBeNull()
    const cover = typeCards?.fields?.find((f) => f.name === 'coverImage')
    expect(cover).toBeDefined()
    expect(cover?.type).toBe('upload')
    expect(cover?.relationTo).toBe('media')
    expect(cover?.required).not.toBe(true)
  })

  it('槽位行仍保留 slot / label / sublabel / visible（新增字段没顶掉原有的）', () => {
    const typeCards = findTypeCardsField() as { fields?: Array<Record<string, unknown>> } | null
    const names = (typeCards?.fields ?? []).map((f) => f.name)
    expect(names).toEqual(expect.arrayContaining(['slot', 'label', 'sublabel', 'visible', 'coverImage']))
  })

  it('fallback 的每一行都带 coverImage: null（形状与新类型一致）', () => {
    expect(SITE_SETTINGS_FALLBACK.typeCards.length).toBe(5)
    for (const row of SITE_SETTINGS_FALLBACK.typeCards) {
      expect(row).toHaveProperty('coverImage', null)
    }
  })
})
