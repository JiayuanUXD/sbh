import { describe, expect, it } from 'vitest'

import { CitySiteProfiles } from '@/collections/CitySiteProfiles'

// 递归查找字段（row / collapsible / group 布局收口后字段可能嵌套一层）
function field(name: string): Record<string, unknown> {
  const walk = (fields: readonly unknown[]): Record<string, unknown> | undefined => {
    for (const candidate of fields) {
      if (!candidate || typeof candidate !== 'object') continue
      const c = candidate as Record<string, unknown> & {
        fields?: readonly unknown[]
        tabs?: readonly { fields?: readonly unknown[] }[]
      }
      if (c.name === name) return c
      if (Array.isArray(c.fields)) {
        const nested = walk(c.fields)
        if (nested) return nested
      }
      // unnamed/named tabs：字段在 tabs[].fields 下
      if (Array.isArray(c.tabs)) {
        for (const tab of c.tabs) {
          if (Array.isArray(tab?.fields)) {
            const nested = walk(tab.fields)
            if (nested) return nested
          }
        }
      }
    }
    return undefined
  }
  const matched = walk(CitySiteProfiles.fields)
  if (!matched) throw new Error(`missing field: ${name}`)
  return matched
}

function accessHandler(value: unknown): (args: unknown) => unknown {
  if (typeof value !== 'function') throw new Error('missing access handler')
  return (args) => value(args)
}

describe('CitySiteProfiles collection boundary', () => {
  it('exposes a unique city profile with closed write and delete access', () => {
    expect(CitySiteProfiles.slug).toBe('city-site-profiles')
    expect(field('city')).toMatchObject({ type: 'relationship', relationTo: 'locations', required: true, unique: true })
    expect(accessHandler(CitySiteProfiles.access?.read)({})).toBe(true)
    expect(accessHandler(CitySiteProfiles.access?.delete)({})).toBe(false)
  })

  it('keeps profile operations behind location:manage and featured regions bounded', () => {
    expect(field('featuredRegions')).toMatchObject({
      type: 'relationship',
      relationTo: 'locations',
      hasMany: true,
      maxRows: 12,
    })
    // OPT-074 起是两个：地理一致性 guard 在前，原有的 protectCitySiteProfile 在后。
    // 断言身份而不只是数量——数量守卫挡不住「换了个 hook 但个数没变」。
    const beforeChange = CitySiteProfiles.hooks?.beforeChange ?? []
    expect(beforeChange.map((h) => h.name)).toEqual([
      'locationFieldGuard',
      'protectCitySiteProfile',
    ])
  })
})
